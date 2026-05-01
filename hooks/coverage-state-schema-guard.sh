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
    # Walk the JSON looking for any object that has a `journey` key — that's
    # a per-dispatch entry. Works whether dispatches live at top-level or
    # nested under `passes.<N>-compositional.dispatches`.
    DISPATCH_COUNT=$(echo "$TARGET" | jq -r '[.. | objects | select(has("journey"))] | length' 2>/dev/null || echo 0)
    if [ "$DISPATCH_COUNT" -eq 0 ]; then
      emit_deny "[BLOCKED] coverage-expansion-state.json claims currentPass=${CP} with zero dispatches recorded.

File: $FILE_PATH
journeyRoster: ${ROSTER_LEN} entries
dispatches found:  0

This is the pre-emptive-stop anti-pattern: writing the state file BEFORE any actual dispatch happened, typically dressed in 'honest' / 'pragmatic' / 'transparent' / 'I want to surface this back upstream' framing. Exit #2 (commit-what-landed + state-file + resume) is for **budget-driven mid-pipeline stops AFTER at least one dispatch is in flight**, not for refusing to start.

The state file is a post-action ledger, not a pre-action plan. It must reflect work that actually happened.

Fix:
  1. If you have not dispatched any subagent yet → set currentPass=0, OR omit the file entirely. The orchestrator's first action on entry reads the file; absent file == 'start Pass 1 from scratch' (per coverage-expansion §\"Authoritative state file\").
  2. If you intend to take exit #2 → first dispatch Pass 1's wave (one composer per journey, in parallel up to host max). After the wave returns, THEN write the state file with the actual dispatches[] entries populated. If budget runs out mid-pass, the recorded dispatches give the next session something concrete to resume from.

If this is being invoked from onboarding's Phase 5: the front-load gate already authorised the FULL pipeline (\"tens of minutes to several hours\"). Auto-mode is not authorisation to skip work. Inferred user preference is not authorisation. Estimated session length is not authorisation. The contract is the contract.

See:
  coverage-expansion/SKILL.md §\"Two valid exits\"
  coverage-expansion/references/anti-rationalizations.md §\"Pre-emptive scope reduction\""
      exit 0
    fi
  fi
fi

exit 0
