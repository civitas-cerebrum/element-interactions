#!/bin/bash
# coverage-state-schema-guard.sh — coverage-expansion-state.json shape validator
#
# Hook    : PreToolUse:Write|Edit  (filters to coverage-expansion-state.json only)
# Mode    : DENY (malformed state-file writes)
# State   : none (the file being written is itself the state — this hook
#                 validates writes, doesn't track state)
# Env     : none
#
# Rule
# ----
# Writes / edits to `tests/e2e/docs/coverage-expansion-state.json` must
# conform to the schema documented in
#   skills/coverage-expansion/references/state-file-schema.md
# (canonical) and summarised in
#   skills/coverage-expansion/SKILL.md §"Authoritative state file"
# (kernel-resident invariants).
#
# Why
# ---
# The state file is the resume marker — corrupt writes break resume on the
# next invocation, which silently restarts the entire pipeline from scratch.
# Catching shape violations at the write boundary is cheap; debugging a
# silent-restart after the fact is not.
#
# Canonical reference
# -------------------
# skills/coverage-expansion/references/state-file-schema.md
#
# Failure → action
# ----------------
# - Top-level not an object                                → DENY
# - Missing required fields (status, currentPass, etc.)    → DENY
# - dispatches[] entry missing dual-stage fields           → DENY
# - currentPass >= 1 with zero dispatches recorded         → DENY (pre-emptive-stop pattern)
# - adversarialSkippedJourneys not an array                → DENY
# - adversarialSkippedJourneys[] entry missing journey/rationale → DENY
# - adversarialSkippedJourneys[] entry with missing or malformed criteria → DENY
# - Anything else                                          → silent allow

set -euo pipefail

# --- helpers ---
emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
case "$FILE_PATH" in
  *tests/e2e/docs/coverage-expansion-state.json) ;;
  *) exit 0 ;;
esac

# Resolve target content: for Write, the new content. For Edit, simulate.
if [ "$TOOL_NAME" = "Write" ]; then
  TARGET=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
elif [ "$TOOL_NAME" = "Edit" ]; then
  # Edit-resolution is non-trivial; just validate that the new_string portion
  # doesn't introduce malformed JSON.
  TARGET=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""')
fi

# 1. Must be valid JSON (Write only — Edit's new_string may be a partial slice).
if [ "$TOOL_NAME" = "Write" ]; then
  if ! echo "$TARGET" | jq empty 2>/dev/null; then
    emit_deny "[BLOCKED] coverage-expansion-state.json must be valid JSON.

File: $FILE_PATH

Fix: re-emit as well-formed JSON. The state file is read by the orchestrator on every entry — a malformed state file aborts the pipeline.

Schema (skills/coverage-expansion/SKILL.md §\"Authoritative state file\"):

  {
    \"status\": \"in-progress\" | \"complete\",
    \"mode\": \"depth\" | \"breadth\",
    \"currentPass\": <integer>,
    \"journeyRoster\": [\"j-<slug>\", ...],
    \"passes\": { \"<N>-compositional\": { \"dispatches\": [...] }, ... },
    \"updatedAt\": \"<ISO-8601>\"
  }"
    exit 0
  fi

  # 2. Required top-level keys.
  for KEY in status mode currentPass journeyRoster passes updatedAt; do
    if ! echo "$TARGET" | jq -e ".$KEY" >/dev/null 2>&1; then
      emit_deny "[BLOCKED] coverage-expansion-state.json missing required key '$KEY'.

File: $FILE_PATH

Fix: include all required top-level keys: status, mode, currentPass, journeyRoster, passes, updatedAt. See coverage-expansion SKILL.md §\"Authoritative state file\"."
      exit 0
    fi
  done

  # 3. journeyRoster must be a non-empty array.
  ROSTER_LEN=$(echo "$TARGET" | jq -r '.journeyRoster | length' 2>/dev/null || echo 0)
  if [ "$ROSTER_LEN" -eq 0 ]; then
    emit_deny "[BLOCKED] coverage-expansion-state.json has empty journeyRoster.

File: $FILE_PATH

Fix: populate journeyRoster from tests/e2e/docs/journey-map.md. An empty roster is meaningless — the orchestrator can't dispatch."
    exit 0
  fi

  # 4. currentPass must be an integer 0-5.
  CP=$(echo "$TARGET" | jq -r '.currentPass' 2>/dev/null)
  if ! echo "$CP" | grep -qE '^[0-5]$'; then
    emit_deny "[BLOCKED] coverage-expansion-state.json currentPass invalid.

File: $FILE_PATH
currentPass: $CP

Fix: must be an integer 0-5 (0 = before pass 1, 1-3 = compositional, 4-5 = adversarial). See coverage-expansion SKILL.md."
    exit 0
  fi

  # 5. Pre-emptive-stop detection. If currentPass >= 1, at least one dispatch
  # MUST be recorded somewhere in the file. A state file with currentPass=1
  # and zero dispatches is the "honest stopping point before doing any work"
  # anti-pattern: the orchestrator writes the state file framed as exit #2
  # (commit-what-landed + resume) BEFORE actually dispatching anything. Exit
  # #2 is for budget-driven mid-pipeline stops AFTER at least one dispatch
  # is in flight, NOT for refusing to start.
  #
  # The state file is a post-action ledger, not a pre-action plan. It must
  # reflect work that actually happened.
  #
  # Reference: coverage-expansion/references/anti-rationalizations.md
  #   §"Pre-emptive scope reduction" + §"Honest pre-dispatch stop"
  if [ "$CP" -ge 1 ]; then
    # Walk the JSON looking for evidence of work: either a dispatch entry
    # (has `journey` plus dual-stage fields stage_a_cycles or review_status)
    # OR a gated-skip entry (has `journey` plus `gated_skip: true` plus
    # `triggers_checked` — issue #164.1). Both shapes count as "work
    # happened" for the pre-emptive-stop check; the orchestrator-side
    # trigger evaluation is real work.
    #
    # `adversarialSkippedJourneys[]` entries (issue #164.4) also carry a
    # `journey` key but have neither dual-stage fields nor `gated_skip:
    # true`, so they are naturally excluded from this count — declaring a
    # P3 adversarial opt-out is not, on its own, evidence of dispatched
    # work.
    DISPATCH_COUNT=$(echo "$TARGET" | jq -r '[.. | objects | select(has("journey") and ((has("stage_a_cycles") or has("review_status")) or (.gated_skip == true and has("triggers_checked"))))] | length' 2>/dev/null || echo 0)
    if [ "$DISPATCH_COUNT" -eq 0 ]; then
      emit_deny "[BLOCKED] State-file write claims currentPass=${CP} with zero dispatches recorded.

──────────────────────────────────────────────────────────────────
Do this instead — pick one:
──────────────────────────────────────────────────────────────────

  Option A — you have NOT dispatched any subagent yet.
    Either:
      (a) Don't write this file. An absent file means 'start Pass 1 from
          scratch' on the next orchestrator entry — that's the legitimate
          'haven't started' state.
      (b) OR set \"currentPass\": 0 (with empty passes:{}). currentPass=0
          is also a legitimate 'haven't started' marker.
    Then dispatch Pass 1's first wave:
      Agent({ description: \"composer-j-<slug>: cycle 1\", ... })
      ...one Agent call per journey, in parallel in the SAME message.

  Option B — you intend exit #2 (mid-pipeline stop with resume marker).
    Exit #2 requires AT LEAST ONE dispatch in flight before it's invocable.
    Dispatch the first wave first. Capture the structured returns. THEN
    write the state file with the actual dispatches[] entries populated —
    that's the resume marker the next session reads.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
File:           $FILE_PATH
journeyRoster:  ${ROSTER_LEN} entries
dispatches:     0  ← required: at least 1 when currentPass >= 1

The state file is a post-action ledger, not a pre-action plan. A state
file with currentPass>=1 and zero recorded dispatches is the pre-emptive-
stop anti-pattern — writing the resume marker BEFORE any actual work
happened, typically dressed in 'honest' / 'pragmatic' / 'I want to surface
this back upstream' framing.

If the run feels too long: the front-load gate already authorised the
FULL pipeline ('tens of minutes to several hours'). Auto-mode is not
authorisation to skip work. Inferred user preference is not authorisation.
Estimated session length is not authorisation.

References:
  coverage-expansion/SKILL.md §\"Two valid exits\"
  coverage-expansion/references/anti-rationalizations.md §\"Pre-emptive scope reduction\""
      exit 0
    fi
  fi

  # 6. gated-skip entry validation (issue #164.1 — trigger-gated re-pass).
  # Every entry with `gated_skip: true` MUST also carry:
  #   - triggers_checked: object with three boolean fields:
  #       map_delta, sibling_ledger_update, must_fix_carry_over
  #   - All three booleans MUST be false (any true means a trigger fired
  #     and the orchestrator should have dispatched, not skipped).
  # An invalid gated_skip is silent scope narrowing — the orchestrator
  # claiming work is done without recording the evidence the triggers
  # were checked.
  INVALID_SKIP=$(echo "$TARGET" | jq -r '
    [.. | objects
      | select(.gated_skip == true)
      | (.journey // "<missing>") as $j
      | (.triggers_checked // {}) as $tc
      | if ($tc | type) != "object"
            or ($tc.map_delta | type) != "boolean"
            or ($tc.sibling_ledger_update | type) != "boolean"
            or ($tc.must_fix_carry_over | type) != "boolean"
            or $tc.map_delta == true
            or $tc.sibling_ledger_update == true
            or $tc.must_fix_carry_over == true
        then $j
        else empty
        end
    ] | join(", ")
  ' 2>/dev/null || echo "")
  if [ -n "$INVALID_SKIP" ]; then
    emit_deny "[BLOCKED] gated_skip entries malformed or missing trigger evidence.

File: $FILE_PATH
Offending journeys: ${INVALID_SKIP}

Fix: every \`gated_skip: true\` entry MUST carry \`triggers_checked\` with all three booleans (map_delta, sibling_ledger_update, must_fix_carry_over), and ALL THREE MUST be \`false\`. A trigger evaluating to \`true\` means the orchestrator should have dispatched, not skipped. The shape:

  {
    \"journey\": \"j-<slug>\",
    \"gated_skip\": true,
    \"result\": \"covered-exhaustively\",
    \"review_status\": \"greenlight\",
    \"triggers_checked\": {
      \"map_delta\": false,
      \"sibling_ledger_update\": false,
      \"must_fix_carry_over\": false
    }
  }

Why: the gated-skip is a contract claim that the orchestrator checked all three triggers and found nothing. Without the field, the skip is silent scope narrowing dressed as efficiency. With any trigger == true, the skip is a contract violation — that journey needed re-pass work and the orchestrator skipped it.

Reference: skills/coverage-expansion/SKILL.md §\"Trigger-gated re-pass for Passes 2 & 3\"
           skills/coverage-expansion/references/state-file-schema.md §\"Gated-skip entries\""
    exit 0
  fi

  # 7. adversarialSkippedJourneys[] shape validation (issue #164.4 — opt-in
  # P3 adversarial-skip). The field is optional; when present it MUST be an
  # array, and every entry MUST have a non-empty `journey` and a non-empty
  # `rationale`. Missing rationale = silent scope narrowing in disguise.
  HAS_SKIP_FIELD=$(echo "$TARGET" | jq -e 'has("adversarialSkippedJourneys")' >/dev/null 2>&1 && echo yes || echo no)
  if [ "$HAS_SKIP_FIELD" = "yes" ]; then
    SKIP_TYPE=$(echo "$TARGET" | jq -r '.adversarialSkippedJourneys | type' 2>/dev/null || echo "null")
    if [ "$SKIP_TYPE" != "array" ]; then
      emit_deny "[BLOCKED] adversarialSkippedJourneys must be an array.

File: $FILE_PATH
Got: ${SKIP_TYPE}

Fix: shape per skills/coverage-expansion/references/state-file-schema.md §\"adversarialSkippedJourneys[] field\":

  \"adversarialSkippedJourneys\": [
    {
      \"journey\": \"j-<slug>\",
      \"rationale\": \"<non-empty explanation>\",
      \"criteria\": [\"priority-p3\", \"page-subset-covered\", \"zero-prior-findings\", \"low-surface-shape\"]
    }
  ]"
      exit 0
    fi

    # Each entry: journey + rationale required.
    INVALID=$(echo "$TARGET" | jq -r '
      [.adversarialSkippedJourneys[]
        | select((.journey // "") == "" or (.rationale // "") == "")
        | (.journey // "<missing>")
      ] | join(", ")
    ' 2>/dev/null || echo "")
    if [ -n "$INVALID" ]; then
      emit_deny "[BLOCKED] adversarialSkippedJourneys[] entries missing required fields.

File: $FILE_PATH
Offending entries (by journey or '<missing>'): ${INVALID}

Fix: every entry MUST have a non-empty 'journey' and a non-empty 'rationale'. Vague rationales (\"low value\", \"P3 doesn't need it\") fail the contract; specific rationales naming the covered surface and the app-wide entry that subsumes it pass. The opt-out is meaningful only if the project-time author explained WHY this journey is excluded — silent skip is what the field is here to prevent.

See skills/coverage-expansion/SKILL.md §\"P3 small-surface journeys may opt OUT of adversarial passes\" for the four exclusion criteria the orchestrator must satisfy."
      exit 0
    fi

    # Each entry's `criteria` array MUST contain ALL FOUR canonical strings
    # (priority-p3, page-subset-covered, zero-prior-findings, low-surface-shape).
    # Order doesn't matter; missing or extra strings → DENY. Per #164.4 the
    # criteria array is mechanical evidence the orchestrator checked each rule;
    # missing criteria = silent partial-evidence opt-out.
    BAD_CRITERIA=$(echo "$TARGET" | jq -r '
      def canonical: ["priority-p3","page-subset-covered","zero-prior-findings","low-surface-shape"];
      [.adversarialSkippedJourneys[]
        | select(
            (.criteria // null) == null
            or (.criteria | type) != "array"
            or ((.criteria | sort) != (canonical | sort))
          )
        | (.journey // "<missing>")
      ] | join(", ")
    ' 2>/dev/null || echo "")
    if [ -n "$BAD_CRITERIA" ]; then
      emit_deny "[BLOCKED] adversarialSkippedJourneys[] entries with missing or malformed 'criteria' array.

File: $FILE_PATH
Offending entries (by journey or '<missing>'): ${BAD_CRITERIA}

Fix: every entry's 'criteria' MUST be an array containing exactly the four canonical strings (order doesn't matter):
  - priority-p3
  - page-subset-covered
  - zero-prior-findings
  - low-surface-shape

Missing criteria, extra non-canonical strings, an empty array, or an absent field all DENY — the array is the orchestrator's mechanical evidence that all four exclusion criteria hold. Silent partial evidence is silent scope narrowing; that is what this field is here to prevent.

See skills/coverage-expansion/SKILL.md §\"P3 small-surface journeys may opt OUT of adversarial passes\"."
      exit 0
    fi
  fi
fi

exit 0
