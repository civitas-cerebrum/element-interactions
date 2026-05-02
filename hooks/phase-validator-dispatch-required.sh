#!/bin/bash
# phase-validator-dispatch-required.sh — gate Phase N+1 advance on Phase N's validator greenlight
#
# Hook    : PreToolUse:Agent  (gate advance) + PostToolUse:Agent  (record ledger)
# Mode    : DENY (PreToolUse — block phase-N+1 dispatches without phase-N greenlight)
#           + RECORD (PostToolUse — append phase-validator return to ledger)
# State   : <repo>/tests/e2e/docs/onboarding-phase-ledger.json
# Env     : none
#
# Rule
# ----
# PreToolUse:  every Agent dispatch that maps to a "Phase N+1" boundary
#              (currently: composer-*, reviewer-*, probe-*, cleanup-*, and
#              process-validator-* with `coverage-expansion-state.json`
#              context = entering Phase 5) is denied unless the ledger
#              shows Phase N greenlight. `phase-validator-<N>:` dispatches
#              are always allowed (don't gate the gate).
# PostToolUse: every `phase-validator-<N>:` Agent return is parsed for
#              `status:` and recorded in the ledger:
#              - status: greenlight   → write phase N entry, cycle reset
#              - status: improvements-needed → increment cycle counter
#              - cycle 10 reached     → write blocked-phase-validator-stalled
#
# Why
# ---
# Onboarding's per-phase completion contract is markdown-only at the dispatch
# level today (PR A — v0.3.6 — landed schema validation but not dispatch
# enforcement). The v0.3.4 onboarding test demonstrated agents will skip
# phase-validator dispatch under context pressure and advance to Phase N+1
# anyway. This hook is the mechanical enforcement that makes phase-validator
# unskippable: Onboarding cannot enter Phase 5 until phase-validator-4 has
# greenlit. The same shape generalises to every phase boundary; this initial
# release covers Phase 4 → 5 (the v0.3.4 failure case). Other transitions
# (Phase 3 → 4, Phase 5 → 6, etc.) are future-work additions to the
# phase-mapping table.
#
# Canonical reference
# -------------------
# skills/onboarding/references/phase-validator-workflow.md §"Onboarding's
#   response handling" + §"Mechanical enforcement"
# skills/element-interactions/references/subagent-return-schema.md §2.5
#
# State-file shape
# ----------------
# tests/e2e/docs/onboarding-phase-ledger.json:
#   {
#     "phases": {
#       "<N>": {
#         "status": "greenlight" | "in-progress" | "blocked-phase-validator-stalled",
#         "validator": "phase-validator-<N>",
#         "cycle": <int 1-10>,
#         "at": "<ISO-8601>",
#         "evidence": [<list of evidence pointers from validator return>],
#         "unresolved-findings": [<finding-IDs>]   # only on blocked-phase-validator-stalled
#       },
#       ...
#     }
#   }
#
# Phase-mapping table (description prefix → Phase boundary it crosses)
# ---------------------------------------------------------------------
# composer-*, reviewer-*, probe-*, cleanup-*  → Phase 5 (entering coverage-expansion work)
# process-validator-*                          → Phase 5 (entering coverage-expansion work)
# phase-validator-*                            → always allowed (gate is not gated)
# phase1-*, phase2-*, stage2-*                 → not yet phase-mapped (silent allow)
# (Phase 3 → 4, Phase 5 → 6, Phase 6 → 7 transitions: future work)
#
# Failure → action
# ----------------
# - Coverage-expansion-role dispatch + ledger missing or no Phase 4 greenlight  → DENY
# - Phase-validator-<N>: dispatch                                                → silent allow (PreToolUse)
# - Phase-validator-<N>: return                                                  → RECORD ledger update (PostToolUse)
# - Cycle 10 reached (10 consecutive improvements-needed for one phase)         → RECORD blocked-phase-validator-stalled
# - Anything else                                                                → silent allow

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
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // ""')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // ""')

# Resolve repo root for state-file location.
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
LEDGER="$REPO_ROOT/tests/e2e/docs/onboarding-phase-ledger.json"

# Helper: ensure ledger directory exists; doesn't write the file.
mkdir -p "$REPO_ROOT/tests/e2e/docs" 2>/dev/null || true

# === PreToolUse branch: gate Phase N+1 dispatches ==========================
if [ "$EVENT_NAME" = "PreToolUse" ]; then
  # Phase-validator dispatches are always allowed — gating the gate is a deadlock.
  case "$DESCRIPTION" in
    phase-validator-*) exit 0 ;;
  esac

  # Map the dispatch's description prefix to a Phase boundary it crosses.
  # Only one transition is enforced today: Phase 4 → 5 (composer/reviewer/
  # probe/cleanup/process-validator dispatches mean the orchestrator is
  # entering coverage-expansion work).
  ENTERING_PHASE=""
  case "$DESCRIPTION" in
    composer-*|reviewer-*|probe-*|cleanup-*|process-validator-*)
      ENTERING_PHASE=5 ;;
    *) exit 0 ;;  # not yet phase-mapped — silent allow
  esac

  PRIOR_PHASE=$((ENTERING_PHASE - 1))

  # No ledger → no greenlight has been recorded for any phase. If we're
  # entering Phase 5, the orchestrator hasn't run phase-validator-4 yet.
  if [ ! -f "$LEDGER" ]; then
    emit_deny "[BLOCKED] Phase ${ENTERING_PHASE} dispatch attempted before phase-validator-${PRIOR_PHASE} greenlight.

──────────────────────────────────────────────────────────────────
Do this instead — dispatch the phase-validator first:
──────────────────────────────────────────────────────────────────

  Agent({
    description: \"phase-validator-${PRIOR_PHASE}: cycle 1\",
    prompt: <<EOF
## Phase-validator brief — Phase ${PRIOR_PHASE}
**Phase:** ${PRIOR_PHASE}
**Sub-skill:** <sub-skill name>
**Project root:** <abs path>
## Artifacts to verify
<list of artifacts the validator will check, per the per-phase completion contract>
## Per-phase completion contract (verbatim from onboarding/SKILL.md)
<paste the row for Phase ${PRIOR_PHASE}>
## Cycle context
This is cycle 1 of 10 for Phase ${PRIOR_PHASE}. Previous improvements-needed findings: none — first cycle.
## Return shape
See \`skills/element-interactions/references/subagent-return-schema.md\` §2.5.
EOF,
    subagent_type: \"general-purpose\"
  })

…then dispatch the Phase ${ENTERING_PHASE} work only after the validator returns greenlight.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Ledger:      ${LEDGER} (does not exist)
Required:    phase-validator-${PRIOR_PHASE} greenlight before any Phase ${ENTERING_PHASE} dispatch

Onboarding advances to a new phase only after that phase's predecessor has been greenlit by a phase-validator dispatch. The ledger \`tests/e2e/docs/onboarding-phase-ledger.json\` is the authoritative record. No ledger means no greenlights yet — the orchestrator must dispatch phase-validator-${PRIOR_PHASE} before this Phase ${ENTERING_PHASE} dispatch.

References:
  skills/onboarding/SKILL.md §\"Phase-validator checkpoint\"
  skills/onboarding/references/phase-validator-workflow.md
  skills/element-interactions/references/subagent-return-schema.md §2.5"
    exit 0
  fi

  # Ledger exists — check Phase N-1 entry.
  PRIOR_STATUS=$(jq -r --arg p "$PRIOR_PHASE" '.phases[$p].status // empty' "$LEDGER" 2>/dev/null || echo "")

  case "$PRIOR_STATUS" in
    greenlight) exit 0 ;;  # ALL GOOD — advance allowed
    blocked-phase-validator-stalled)
      emit_deny "[BLOCKED] Phase ${PRIOR_PHASE} is stalled (cycle 10 reached without greenlight).

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

The phase-validator-${PRIOR_PHASE} reached the 10-cycle cap with unresolved findings. Onboarding cannot advance to Phase ${ENTERING_PHASE}; this is a terminal state requiring user intervention.

Surface back to the user with the unresolved findings list:

  cat ${LEDGER} | jq '.phases[\"${PRIOR_PHASE}\"].\"unresolved-findings\"'

Onboarding must report the stalled state — do NOT continue silently.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Phase ${PRIOR_PHASE} status: blocked-phase-validator-stalled (cycle 10 cap reached)

References:
  skills/onboarding/references/phase-validator-workflow.md §\"Cycle cap\"
  skills/onboarding/SKILL.md §\"Phase-validator checkpoint\""
      exit 0
      ;;
    *)
      # Status is in-progress, missing entirely, or unknown.
      CYCLE=$(jq -r --arg p "$PRIOR_PHASE" '.phases[$p].cycle // 0' "$LEDGER" 2>/dev/null || echo 0)
      emit_deny "[BLOCKED] Phase ${ENTERING_PHASE} dispatch attempted before phase-validator-${PRIOR_PHASE} greenlight.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

Re-dispatch the phase-validator for Phase ${PRIOR_PHASE}:

  Agent({
    description: \"phase-validator-${PRIOR_PHASE}: cycle $((CYCLE + 1))\",
    prompt: <<EOF
## Phase-validator brief — Phase ${PRIOR_PHASE}
**Phase:** ${PRIOR_PHASE}
## Cycle context
This is cycle $((CYCLE + 1)) of 10. Previous improvements-needed findings:
<paste from prior validator return>
EOF,
    subagent_type: \"general-purpose\"
  })

…then dispatch Phase ${ENTERING_PHASE} work only after the validator returns greenlight.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Phase ${PRIOR_PHASE} ledger entry: status=\"${PRIOR_STATUS:-absent}\", cycle=${CYCLE}
Required:    phase-validator-${PRIOR_PHASE} greenlight (status: \"greenlight\") before Phase ${ENTERING_PHASE} dispatch

The ledger shows Phase ${PRIOR_PHASE} is not yet greenlit — either the previous validator returned improvements-needed (and the orchestrator hasn't re-dispatched yet) or no validator has been dispatched at all. The orchestrator must address the validator's findings (if any) and re-dispatch before advancing.

References:
  skills/onboarding/SKILL.md §\"Phase-validator checkpoint\"
  skills/onboarding/references/phase-validator-workflow.md"
      exit 0
      ;;
  esac
fi

# === PostToolUse branch: record phase-validator returns to ledger ==========
if [ "$EVENT_NAME" = "PostToolUse" ]; then
  # Only fire on phase-validator dispatches.
  case "$DESCRIPTION" in
    phase-validator-*) ;;
    *) exit 0 ;;
  esac

  # Extract the phase number from the description: "phase-validator-<N>:".
  PHASE=$(echo "$DESCRIPTION" | sed -E 's/^phase-validator-([1-7])[^a-zA-Z0-9].*/\1/')
  if ! echo "$PHASE" | grep -qE '^[1-7]$'; then
    exit 0   # malformed phase number; let schema-guard surface it
  fi

  # Extract the response text using the same defensive pattern as
  # subagent-return-schema-guard.sh.
  RESPONSE=$(
    echo "$INPUT" | jq -r '
      [
        (.tool_response.output? | if type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
        (.tool_response.result? // empty | tostring),
        (if (.tool_response | type) == "string" then .tool_response else empty end)
      ] | map(select(. != null and . != "")) | unique | join("\n")
    ' 2>/dev/null || echo ""
  )
  [ -z "$RESPONSE" ] && exit 0   # no response to parse

  # Determine status from the response.
  STATUS=""
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*greenlight'; then
    STATUS="greenlight"
  elif echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*improvements-needed'; then
    STATUS="improvements-needed"
  else
    exit 0   # malformed status; schema-guard handles
  fi

  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Read existing ledger (or initialise empty).
  if [ -f "$LEDGER" ]; then
    EXISTING=$(jq '.' "$LEDGER" 2>/dev/null || echo '{"phases":{}}')
  else
    EXISTING='{"phases":{}}'
  fi

  # Read current cycle count for this phase (default 0).
  CURRENT_CYCLE=$(echo "$EXISTING" | jq -r --arg p "$PHASE" '.phases[$p].cycle // 0' 2>/dev/null || echo 0)
  NEW_CYCLE=$((CURRENT_CYCLE + 1))

  if [ "$STATUS" = "greenlight" ]; then
    # Extract evidence pointers (lines under exit-criteria-checked with `evidence:`).
    EVIDENCE=$(echo "$RESPONSE" | grep -E '^[[:space:]]*evidence:' | sed -E 's/^[[:space:]]*evidence:[[:space:]]*//' | jq -R . | jq -s 'unique')
    [ -z "$EVIDENCE" ] && EVIDENCE='[]'

    UPDATED=$(echo "$EXISTING" | jq --arg p "$PHASE" \
      --arg s "greenlight" \
      --arg t "$TIMESTAMP" \
      --argjson c "$NEW_CYCLE" \
      --argjson ev "$EVIDENCE" \
      '.phases[$p] = {
         status: $s,
         validator: ("phase-validator-" + $p),
         cycle: $c,
         at: $t,
         evidence: $ev
       }')
    echo "$UPDATED" > "$LEDGER.tmp" && mv "$LEDGER.tmp" "$LEDGER" || rm -f "$LEDGER.tmp"
    exit 0
  fi

  # improvements-needed: increment cycle; if cycle reaches cap, mark stalled.
  CAP=10
  if [ "$NEW_CYCLE" -ge "$CAP" ]; then
    STALLED_STATUS="blocked-phase-validator-stalled"
    UNRESOLVED=$(echo "$RESPONSE" | grep -oE '\*\*pv-[1-7]-[0-9]+\*\*' | sed -E 's/^\*\*//;s/\*\*$//' | sort -u | jq -R . | jq -s '.')
    [ -z "$UNRESOLVED" ] && UNRESOLVED='[]'

    UPDATED=$(echo "$EXISTING" | jq --arg p "$PHASE" \
      --arg s "$STALLED_STATUS" \
      --arg t "$TIMESTAMP" \
      --argjson c "$NEW_CYCLE" \
      --argjson uf "$UNRESOLVED" \
      '.phases[$p] = {
         status: $s,
         validator: ("phase-validator-" + $p),
         cycle: $c,
         at: $t,
         "unresolved-findings": $uf
       }')
    echo "$UPDATED" > "$LEDGER.tmp" && mv "$LEDGER.tmp" "$LEDGER" || rm -f "$LEDGER.tmp"
    exit 0
  fi

  # Normal improvements-needed (cycle < 10): record in-progress with cycle bumped.
  UPDATED=$(echo "$EXISTING" | jq --arg p "$PHASE" \
    --arg s "in-progress" \
    --arg t "$TIMESTAMP" \
    --argjson c "$NEW_CYCLE" \
    '.phases[$p] = {
       status: $s,
       validator: ("phase-validator-" + $p),
       cycle: $c,
       at: $t
     }')
  echo "$UPDATED" > "$LEDGER.tmp" && mv "$LEDGER.tmp" "$LEDGER" || rm -f "$LEDGER.tmp"
  exit 0
fi

exit 0
