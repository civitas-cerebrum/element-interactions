#!/bin/bash
# journey-mapping-cycle-gate.sh — gate journey-mapping iterative-cycle dispatches
#
# Hook    : PreToolUse:Agent  (gate cycle + author dispatches)
#         + PostToolUse:Agent (record returns to .phase4-cycle-state.json)
# Mode    : DENY (PreToolUse — block invalid cycle / author dispatches)
#         + RECORD (PostToolUse — append section returns to state)
# State   : <repo>/tests/e2e/docs/.phase4-cycle-state.json
# Env     : JOURNEY_MAPPING_CYCLE_GATE=off → silent allow (escape hatch; not recommended)
#
# Rule (PreToolUse)
# -----------------
# 1. Cycle-N dispatches (description: phase4-cycle-<N>-section-<id>:)
#    a. N must be 1..5 (5-cycle hard cap)
#    b. For N == 1: section <id> must be in
#       .discovery-draft.json's handover-to-phase4.cycle-1-targets
#    c. For N >= 2:
#       - cycle (N-1) must exist in state file with at least one entry in
#         returned-sections (the previous cycle has at least started returning)
#       - section <id> must NOT already be in cycles[1..N-1].dispatched-sections
#         (deduplication is the orchestrator's job; the hook catches bypasses)
# 2. Author dispatches (description: phase4-prioritise-author:)
#    - state file must exist
#    - convergence-status must be one of: converged | hard-cap-reached
#    - author-dispatched must be false (single-dispatch contract)
#
# Rule (PostToolUse)
# ------------------
# 1. Cycle-N section returns: append <id> to cycles.<N>.returned-sections
#    and append every entry in the return's new-sections-discovered to
#    cycles.<N>.new-sections-discovered (the orchestrator dedups; the hook
#    just records what was reported).
# 2. Author returns: set author-dispatched: true.
#
# Why
# ---
# Without this hook, the cycle protocol degenerates to the single-sequential
# walkthrough — the orchestrator dispatches one cycle agent that "covers
# everything", calls Phase 4 done, and the parallel discipline is silently
# lost. This hook makes that impossible: cycle-1 must dispatch sections from
# the draft, cycle-N must wait for cycle-(N-1)'s returns, and the author
# can't run until convergence is mechanically established.
#
# Canonical references
# --------------------
# skills/journey-mapping/SKILL.md §"Iterative discovery cycles"
# skills/journey-mapping/SKILL.md §"Cycle protocol"
# skills/journey-mapping/SKILL.md §"Harness enforcement"
# skills/element-interactions/references/subagent-return-schema.md §2.7

set -euo pipefail

# Resolve jq.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

# --- helpers ---
emit_deny() {
  "$JQ" -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# Escape hatch.
if [ "${JOURNEY_MAPPING_CYCLE_GATE:-}" = "off" ]; then
  exit 0
fi

# --- input ---
INPUT=$(cat)
EVENT_NAME=$(echo "$INPUT" | "$JQ" -r '.hook_event_name // ""')
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""')

# Resolve repo root.
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
DRAFT="$REPO_ROOT/tests/e2e/docs/.discovery-draft.json"
STATE="$REPO_ROOT/tests/e2e/docs/.phase4-cycle-state.json"

# Ensure docs dir exists for state file writes (PostToolUse only).
mkdir -p "$REPO_ROOT/tests/e2e/docs" 2>/dev/null || true

# Helper: extract <N> and <id> from "phase4-cycle-<N>-section-<id>[:...]".
parse_cycle_dispatch() {
  local desc="$1"
  # Match phase4-cycle-<N>-section-<id> where <N> is 1..9 (validated below)
  echo "$desc" | sed -nE 's/^phase4-cycle-([0-9]+)-section-([a-z0-9_-]+).*/\1 \2/p'
}

# === PreToolUse branch ======================================================
if [ "$EVENT_NAME" = "PreToolUse" ]; then

  # ---- Cycle-N dispatch ---------------------------------------------------
  if [[ "$DESCRIPTION" == phase4-cycle-* ]]; then
    PARSED=$(parse_cycle_dispatch "$DESCRIPTION")
    if [ -z "$PARSED" ]; then
      emit_deny "[BLOCKED] Malformed cycle dispatch description.

Description: \"${DESCRIPTION}\"
Expected:    \"phase4-cycle-<N>-section-<section-id>: <optional suffix>\"
             where N is 1..5 and <section-id> is kebab-case.

References:
  skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\""
      exit 0
    fi

    CYCLE_N=$(echo "$PARSED" | awk '{print $1}')
    SECTION_ID=$(echo "$PARSED" | awk '{print $2}')

    # Check 1 — N in 1..5 (hard cap).
    if [ "$CYCLE_N" -lt 1 ] || [ "$CYCLE_N" -gt 5 ]; then
      emit_deny "[BLOCKED] Cycle ${CYCLE_N} is outside the 1..5 range.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
The iterative-cycle protocol is bounded at 5 cycles. If cycle 5 still
surfaced new sections post-dedup, dispatch \`phase4-prioritise-author:\`
with \`convergence-status: hard-cap-reached\` and let the author note the
remaining sections under \`## Gated Areas (Not Mapped)\` for coverage-
expansion to handle.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Cycle:       ${CYCLE_N} (must be 1, 2, 3, 4, or 5)

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\" → \"Decision\""
      exit 0
    fi

    # Check 2 — Cycle 1: section must be in draft's cycle-1-targets.
    if [ "$CYCLE_N" -eq 1 ]; then
      if [ ! -f "$DRAFT" ]; then
        # Defensively re-emit the missing-draft deny here too — the
        # discovery-draft hook also catches it, but doubling up keeps the
        # message clean if the other hook is uninstalled.
        emit_deny "[BLOCKED] Cycle 1 dispatch with no discovery-draft.json present.

Draft path:  ${DRAFT} (does not exist)
Description: \"${DESCRIPTION}\"

Re-run Phase 3 to produce the draft. See
skills/element-interactions/references/autonomous-mode-callers.md
§\"Mandatory output for \`onboarding\` Phase 3 — discovery draft\"."
        exit 0
      fi

      IN_TARGETS=$("$JQ" -r --arg s "$SECTION_ID" '
        ."handover-to-phase4"."cycle-1-targets" // [] | index($s) // empty
      ' "$DRAFT" 2>/dev/null || echo "")

      if [ -z "$IN_TARGETS" ]; then
        TARGET_LIST=$("$JQ" -r '."handover-to-phase4"."cycle-1-targets" // [] | join(", ")' "$DRAFT" 2>/dev/null || echo "(unparseable)")
        emit_deny "[BLOCKED] Cycle-1 section \"${SECTION_ID}\" not in discovery-draft cycle-1-targets.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
Cycle 1's section roster is fixed by the discovery draft. Pick one of:
  ${TARGET_LIST}

If the section legitimately should be in the cycle-1 roster but isn't,
re-run Phase 3 to refresh the draft — do NOT bypass the gate by
dispatching outside the roster.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description:        \"${DESCRIPTION}\"
Section requested:  ${SECTION_ID}
Cycle-1 targets:    [${TARGET_LIST}]

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\" → step 1
  skills/element-interactions/references/autonomous-mode-callers.md
    §\"Mandatory output for \`onboarding\` Phase 3 — discovery draft\""
        exit 0
      fi
    fi

    # Check 3 — Cycle N >= 2: prior cycle must have at least one return.
    if [ "$CYCLE_N" -ge 2 ]; then
      if [ ! -f "$STATE" ]; then
        emit_deny "[BLOCKED] Cycle ${CYCLE_N} dispatch with no cycle-state file.

Cycle ${CYCLE_N} requires that cycle $((CYCLE_N - 1)) ran and returned at
least one section. The state file is missing, so no prior cycle has
recorded returns.

State path:  ${STATE} (does not exist)
Description: \"${DESCRIPTION}\"

Dispatch cycle 1 first."
        exit 0
      fi

      PRIOR_RETURNS=$("$JQ" -r --arg p "$((CYCLE_N - 1))" '
        .cycles[$p]."returned-sections" // [] | length
      ' "$STATE" 2>/dev/null || echo 0)

      if [ "$PRIOR_RETURNS" -lt 1 ]; then
        emit_deny "[BLOCKED] Cycle ${CYCLE_N} dispatch before cycle $((CYCLE_N - 1)) has any returns.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
Wait for at least one cycle-$((CYCLE_N - 1)) section-agent to return before
dispatching cycle ${CYCLE_N}. Cycles run in strict sequence — cycle N+1's
section roster is computed from cycle N's new-sections-discovered, which
isn't available until cycle N has returned.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description:                    \"${DESCRIPTION}\"
Cycle $((CYCLE_N - 1)) returned-sections count: ${PRIOR_RETURNS}

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\""
        exit 0
      fi

      # Check 4 — section <id> not already dispatched in cycles 1..N-1.
      DUPLICATE_CYCLE=$("$JQ" -r --arg s "$SECTION_ID" --arg n "$((CYCLE_N - 1))" '
        [.cycles | to_entries[]
          | select((.key | tonumber) <= ($n | tonumber))
          | select(.value."dispatched-sections" // [] | index($s))
          | .key] | first // empty
      ' "$STATE" 2>/dev/null || echo "")

      if [ -n "$DUPLICATE_CYCLE" ]; then
        emit_deny "[BLOCKED] Section \"${SECTION_ID}\" already dispatched in cycle ${DUPLICATE_CYCLE}.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
The cycle-N+1 roster is the SET DIFFERENCE between cycle-N's
new-sections-discovered and the union of cycles 1..N's dispatched-sections.
Apply the orchestrator's dedup step before dispatching.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description:           \"${DESCRIPTION}\"
Section:               ${SECTION_ID}
Already dispatched in: cycle ${DUPLICATE_CYCLE}

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\" → step 5 (dedup)"
        exit 0
      fi
    fi

    # All checks pass — allow.
    exit 0
  fi

  # ---- Author dispatch ----------------------------------------------------
  if [[ "$DESCRIPTION" == phase4-prioritise-author* ]]; then
    if [ ! -f "$STATE" ]; then
      emit_deny "[BLOCKED] phase4-prioritise-author dispatch with no cycle-state file.

State path: ${STATE} (does not exist)

The author runs only after the iterative cycles complete. No state file
means no cycles have run yet. Dispatch cycle 1 first."
      exit 0
    fi

    CONVERGENCE=$("$JQ" -r '."convergence-status" // "continuing"' "$STATE" 2>/dev/null || echo "continuing")
    AUTHOR_DISPATCHED=$("$JQ" -r '."author-dispatched" // false' "$STATE" 2>/dev/null || echo "false")

    if [ "$AUTHOR_DISPATCHED" = "true" ]; then
      emit_deny "[BLOCKED] phase4-prioritise-author already dispatched (single-dispatch contract).

State: author-dispatched: true

The author runs once per Phase-4 invocation. If you need to re-author after
fixing an issue, delete tests/e2e/docs/.phase4-cycle-state.json AND the
authored journey-map.md, then re-run the cycle protocol from scratch."
      exit 0
    fi

    case "$CONVERGENCE" in
      converged|hard-cap-reached)
        # OK — author may run.
        exit 0
        ;;
      continuing|*)
        emit_deny "[BLOCKED] phase4-prioritise-author dispatch before cycles converge.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
Continue the cycle loop until either:
  - convergence-status: converged          (no new sections post-dedup AND
                                            cycle N >= 3)
  - convergence-status: hard-cap-reached   (cycle 5 ran with new sections
                                            still in the queue)

The orchestrator updates convergence-status after each cycle's returns
are processed. If you believe convergence has been reached but the state
file says \"continuing\", the dedup step in the orchestrator's cycle loop
is missing — apply it and re-write the state file.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description:         \"${DESCRIPTION}\"
convergence-status:  ${CONVERGENCE}

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\" → \"Decision\"
  skills/journey-mapping/SKILL.md §\"Author step\""
        exit 0
        ;;
    esac
  fi

  # Other Agent dispatches — silent allow.
  exit 0
fi

# === PostToolUse branch =====================================================
if [ "$EVENT_NAME" = "PostToolUse" ]; then

  # ---- Cycle-N section return --------------------------------------------
  if [[ "$DESCRIPTION" == phase4-cycle-* ]]; then
    PARSED=$(parse_cycle_dispatch "$DESCRIPTION")
    [ -z "$PARSED" ] && exit 0

    CYCLE_N=$(echo "$PARSED" | awk '{print $1}')
    SECTION_ID=$(echo "$PARSED" | awk '{print $2}')

    # Initialise state file if missing.
    if [ ! -f "$STATE" ]; then
      DRAFT_PATH_REL="tests/e2e/docs/.discovery-draft.json"
      INIT='{
        "phase4-cycle-state-version": 1,
        "started-at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'",
        "draft-path": "'"$DRAFT_PATH_REL"'",
        "cycles": {},
        "convergence-status": "continuing",
        "author-dispatched": false
      }'
      echo "$INIT" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE" || rm -f "$STATE.tmp"
    fi

    # Extract response text for new-sections parsing.
    RESPONSE=$(
      echo "$INPUT" | "$JQ" -r '
        [
          (.tool_response.output? | if type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
          (.tool_response.result? // empty | tostring)
        ] | map(select(. != null and . != "")) | unique | join("\n")
      ' 2>/dev/null || echo ""
    )

    # Pull new-sections-discovered IDs from the return body.
    # Match lines like:    - id: <kebab-case>
    # under a `new-sections-discovered:` block. Best-effort YAML-like parse.
    NEW_SECTIONS=$(
      echo "$RESPONSE" | awk '
        /^[[:space:]]*new-sections-discovered:[[:space:]]*$/ { in_block=1; next }
        in_block && /^[[:space:]]*-[[:space:]]+id:[[:space:]]*/ {
          sub(/^[[:space:]]*-[[:space:]]+id:[[:space:]]*/, "")
          gsub(/^[[:space:]]+|[[:space:]]+$/, "")
          print
          next
        }
        in_block && /^[a-zA-Z]/ { in_block=0 }
      ' | "$JQ" -R . | "$JQ" -s 'unique'
    )
    [ -z "$NEW_SECTIONS" ] && NEW_SECTIONS='[]'

    # Append section ID to dispatched-sections + returned-sections; merge
    # new-sections-discovered. Initialise the cycle's slot if needed.
    UPDATED=$("$JQ" --arg n "$CYCLE_N" \
                    --arg s "$SECTION_ID" \
                    --argjson new "$NEW_SECTIONS" \
                    --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
      .cycles[$n] = (
        (.cycles[$n] // {
          "dispatched-sections": [],
          "returned-sections": [],
          "new-sections-discovered": [],
          "duplicates-merged": []
        })
        | .["dispatched-sections"]      = (.["dispatched-sections"]      + [$s] | unique)
        | .["returned-sections"]        = (.["returned-sections"]        + [$s] | unique)
        | .["new-sections-discovered"]  = (.["new-sections-discovered"]  + $new | unique)
        | .["completed-at"]             = $now
      )
    ' "$STATE" 2>/dev/null || cat "$STATE")

    echo "$UPDATED" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE" || rm -f "$STATE.tmp"
    exit 0
  fi

  # ---- Author return ------------------------------------------------------
  if [[ "$DESCRIPTION" == phase4-prioritise-author* ]]; then
    [ ! -f "$STATE" ] && exit 0

    UPDATED=$("$JQ" '."author-dispatched" = true' "$STATE" 2>/dev/null || cat "$STATE")
    echo "$UPDATED" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE" || rm -f "$STATE.tmp"
    exit 0
  fi

  exit 0
fi

exit 0
