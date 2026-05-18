#!/bin/bash
# onboarding-ledger-gate.sh — pipeline-state-machine gate for the onboarding
#                             workflow. Forces a workflow-reviewer-*
#                             dispatch at every phase / pass / cycle
#                             transition and blocks out-of-order phase
#                             advancement.
#
# Hook    : PreToolUse:Agent
# Mode    : DENY (blocks the dispatch before the subagent starts)
# State   : reads tests/e2e/docs/onboarding-status.json
# Env     : none
#
# Why
# ---
# Markdown-text contract enforcement permits silent scope compression even
# when the methodology rules are crisp. An empirical 21-journey benchmark
# onboarding run demonstrated the orchestrator skipping phases entirely,
# stopping early, and accepting subagent returns whose declared "complete"
# status omitted required sub-deliverables. The status ledger + workflow-
# reviewer subagent family are the contract layer; this hook is their
# enforcement.
#
# What it gates
# -------------
# 1. **No phase N+1 dispatch without reviewer-approved phase N.** If the
#    ledger shows currentPhase = N + 1 (or a dispatch description names a
#    later phase) and phase N's `reviewerVerdict` is not `approved`, DENY.
# 2. **No pass-N+1 (Phase-5) or cycle-N+1 (Phase-4) dispatch without
#    reviewer-approved pass-N / cycle-N.** Same logic at the substage level.
# 3. **Force the workflow-reviewer dispatch at transition points.** If the
#    last completed phase's `reviewerVerdict` is `pending` AND the
#    incoming Agent's role prefix is NOT `workflow-reviewer-*`, DENY.
#    The orchestrator must dispatch the matching `workflow-reviewer-*`
#    subagent FIRST.
# 4. **Always allow `workflow-reviewer-*` dispatches** — those don't gate
#    themselves, and they may fire even with a pending ledger row.
# 5. **Silent-allow when the ledger is absent or malformed.** A brand-new
#    onboarding run starts before any ledger exists; the hook must not
#    block Phase 1 from beginning.
#
# Role prefix → phase / pass / cycle mapping
# ------------------------------------------
# The hook reads the Agent description and extracts which phase / pass /
# cycle the dispatch is targeting. The matching is heuristic and tolerant:
# only dispatches whose target can be confidently identified are gated.
# Free-form prefixes that don't carry a phase / pass / cycle hint
# silent-allow.
#
# Canonical reference
# -------------------
# schemas/onboarding-status.schema.json     — ledger shape
# schemas/subagent-returns/workflow-reviewer.schema.json — reviewer return
# skills/onboarding/SKILL.md §"Status ledger + workflow reviewer"
# skills/workflow-reviewer/SKILL.md         — reviewer methodology
#
# Failure → action
# ----------------
# Out-of-order phase dispatch         → DENY with the missing reviewer hint
# Non-reviewer at transition point    → DENY naming the reviewer prefix
# Workflow-reviewer-*                 → ALWAYS allow
# Malformed / missing ledger          → silent allow

# Intentional: `set -uo pipefail` without `-e`. Input-tolerant by design.
set -uo pipefail

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH." >&2
  exit 1
fi

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")

# Only act on Agent dispatches.
[ "$TOOL_NAME" = "Agent" ] || exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""' 2>/dev/null || echo "")
[ -n "$DESCRIPTION" ] || exit 0

# Rule 4 (allow-list): workflow-reviewer-* dispatches always pass.
if echo "$DESCRIPTION" | grep -qE '^[[:space:]]*workflow-reviewer-(phase[1-8]|pass[1-5]|cycle[1-5])[:_-]'; then
  exit 0
fi

# Resolve repo root + ledger path.
GUARD_CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
GUARD_REPO_ROOT=$(git -C "$GUARD_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$GUARD_CWD")
LEDGER="$GUARD_REPO_ROOT/tests/e2e/docs/onboarding-status.json"

# Rule 5: silent-allow when the ledger is missing — brand-new run.
[ -f "$LEDGER" ] || exit 0

# Probe the ledger. Any extraction failure → silent allow (malformed
# ledger should not jam the pipeline; the write-gate is responsible for
# ledger integrity).
SCHEMA_VERSION=$("$JQ" -r '.schemaVersion // empty' "$LEDGER" 2>/dev/null || echo "")
[ -n "$SCHEMA_VERSION" ] || exit 0

CURRENT_PHASE=$("$JQ" -r '.currentPhase // empty' "$LEDGER" 2>/dev/null || echo "")
case "$CURRENT_PHASE" in
  ''|*[!0-9]*) exit 0 ;;
esac

# Helper: emit a DENY payload with the supplied reason.
emit_deny() {
  local reason="$1"
  "$JQ" -n --arg r "$reason" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# ---------------------------------------------------------------------------
# Detect a transition-point: last in-progress phase's reviewerVerdict is
# `pending` AND the phase's `status` is `completed` OR `blocked`. That
# means the phase work is done but no workflow-reviewer-* has fired yet.
# ---------------------------------------------------------------------------
# Find the highest-id phase whose status is `completed` or `blocked`.
LAST_DONE_PHASE=$("$JQ" -r '
  [.phases[]? | select(.status == "completed" or .status == "blocked")] |
  if length == 0 then "" else (.[-1].id | tostring) end
' "$LEDGER" 2>/dev/null || echo "")

LAST_DONE_VERDICT=""
if [ -n "$LAST_DONE_PHASE" ]; then
  LAST_DONE_VERDICT=$("$JQ" -r --argjson id "$LAST_DONE_PHASE" '
    [.phases[]? | select(.id == $id)] | .[0].reviewerVerdict // "pending"
  ' "$LEDGER" 2>/dev/null || echo "")
fi

# ---------------------------------------------------------------------------
# Rule 3: transition-point enforcement.
# If the last-done phase has reviewerVerdict pending, force a reviewer
# dispatch BEFORE any non-reviewer Agent.
# ---------------------------------------------------------------------------
if [ -n "$LAST_DONE_PHASE" ] && [ "$LAST_DONE_VERDICT" = "pending" ]; then
  emit_deny "[BLOCKED] Phase ${LAST_DONE_PHASE} completed but no workflow-reviewer-phase${LAST_DONE_PHASE}: has approved the transition yet.

Description: \"${DESCRIPTION}\"

The ledger at tests/e2e/docs/onboarding-status.json shows phase ${LAST_DONE_PHASE}
finished (status = completed / blocked) but reviewerVerdict is still
\"pending\". Every phase / pass / cycle transition is gated by a
workflow-reviewer-* subagent — the orchestrator cannot start the next
unit of work until the reviewer for the prior unit has returned
\`verdict: approve\`.

Fix: dispatch \`workflow-reviewer-phase${LAST_DONE_PHASE}:\` next. Brief
the reviewer with the ledger row + the closing subagent's handoverEnvelope
and the canonical exit criteria from skills/onboarding/SKILL.md §\"Phase
${LAST_DONE_PHASE}\".

See:
  - skills/onboarding/SKILL.md §\"Status ledger + workflow reviewer\"
  - skills/workflow-reviewer/SKILL.md
  - schemas/subagent-returns/workflow-reviewer.schema.json"
  exit 0
fi

# ---------------------------------------------------------------------------
# Rule 1 & 2: out-of-order phase / pass / cycle dispatch.
# Heuristic: if the description names a target phase / pass / cycle that
# is ahead of the ledger's currentPhase or currentSubStage, and the
# previous unit has not been reviewer-approved, DENY.
# ---------------------------------------------------------------------------
# Extract a target-phase hint from the description. Patterns observed:
#   phase<N>-*           → target N
#   composer-happy-path  → Phase 3
#   phase4-*             → Phase 4
#   composer-j-*         → Phase 5
#   probe-j-*            → Phase 6 (if currentPhase >= 5) or Phase 5 adversarial
#   secrets-sweep-*      → Phase 7
#   work-summary-deck-*  → Phase 8
TARGET_PHASE=""
case "$DESCRIPTION" in
  phase1-*|phase1_*) TARGET_PHASE=1 ;;
  phase2-*|phase2_*) TARGET_PHASE=2 ;;
  phase3-*|phase3_*) TARGET_PHASE=3 ;;
  phase4-*|phase4_*) TARGET_PHASE=4 ;;
  phase5-*|phase5_*) TARGET_PHASE=5 ;;
  phase6-*|phase6_*) TARGET_PHASE=6 ;;
  phase7-*|phase7_*) TARGET_PHASE=7 ;;
  phase8-*|phase8_*) TARGET_PHASE=8 ;;
  secrets-sweep-*|secrets_sweep-*) TARGET_PHASE=7 ;;
  work-summary-deck-*|qa-summary-*) TARGET_PHASE=8 ;;
esac

# If the target-phase is known AND ahead of the current phase, check the
# prior phase's verdict.
if [ -n "$TARGET_PHASE" ] && [ "$TARGET_PHASE" -gt "$CURRENT_PHASE" ]; then
  PRIOR_PHASE=$((TARGET_PHASE - 1))
  PRIOR_VERDICT=$("$JQ" -r --argjson id "$PRIOR_PHASE" '
    [.phases[]? | select(.id == $id)] | .[0].reviewerVerdict // "pending"
  ' "$LEDGER" 2>/dev/null || echo "pending")
  if [ "$PRIOR_VERDICT" != "approved" ]; then
    emit_deny "[BLOCKED] Out-of-order phase dispatch — phase ${TARGET_PHASE} cannot start while phase ${PRIOR_PHASE} is not reviewer-approved.

Description: \"${DESCRIPTION}\"

The ledger at tests/e2e/docs/onboarding-status.json shows:
  currentPhase     = ${CURRENT_PHASE}
  target phase     = ${TARGET_PHASE} (inferred from the dispatch description)
  prior phase      = ${PRIOR_PHASE}
  prior verdict    = \"${PRIOR_VERDICT}\" (must be \"approved\")

Every phase transition is state-machine-enforced via the
workflow-reviewer-* subagent family.

Fix: dispatch \`workflow-reviewer-phase${PRIOR_PHASE}:\` first. If the
reviewer returns \`verdict: approve\`, the orchestrator updates the
ledger (reviewerVerdict → approved, currentPhase → ${TARGET_PHASE}) and
re-issues this dispatch.

See:
  - skills/onboarding/SKILL.md §\"Status ledger + workflow reviewer\"
  - skills/workflow-reviewer/SKILL.md
  - schemas/onboarding-status.schema.json
  - schemas/subagent-returns/workflow-reviewer.schema.json"
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Sub-stage gate (Phase 4 cycles + Phase 5 passes).
# If the description targets a specific pass-N or cycle-N within the
# current phase, check the prior substage's reviewerVerdict.
# ---------------------------------------------------------------------------
# Phase 5 — composer-j-<slug>-<pass>-<...> or probe-j-<slug>-<pass>-<...>
#   when currentPhase = 5. We only block when the pass number is
#   strictly greater than the highest-substage's pass and that prior
#   pass is unapproved.
TARGET_PASS=""
if [ "$CURRENT_PHASE" = "5" ]; then
  TARGET_PASS=$(echo "$DESCRIPTION" | grep -oE '(composer|probe)-j-[a-z0-9-]+-[1-5]' | grep -oE '[1-5]$' | head -1 || true)
fi
if [ -n "$TARGET_PASS" ]; then
  PRIOR_PASS=$((TARGET_PASS - 1))
  if [ "$PRIOR_PASS" -ge 1 ]; then
    PRIOR_PASS_ID="pass-${PRIOR_PASS}"
    PRIOR_PASS_VERDICT=$("$JQ" -r --arg id "$PRIOR_PASS_ID" '
      [.phases[]? | select(.id == 5) | .subStages[]? | select(.id == $id)] |
      .[0].reviewerVerdict // "pending"
    ' "$LEDGER" 2>/dev/null || echo "pending")
    if [ "$PRIOR_PASS_VERDICT" != "approved" ]; then
      emit_deny "[BLOCKED] Out-of-order Phase-5 pass dispatch — pass-${TARGET_PASS} cannot start while pass-${PRIOR_PASS} is not reviewer-approved.

Description: \"${DESCRIPTION}\"

Ledger shows pass-${PRIOR_PASS}.reviewerVerdict = \"${PRIOR_PASS_VERDICT}\"
(must be \"approved\").

Fix: dispatch \`workflow-reviewer-pass${PRIOR_PASS}:\` first. The
reviewer checks every per-pass completion criterion from
skills/coverage-expansion/SKILL.md §\"Per-pass completion criteria\".

See:
  - skills/coverage-expansion/SKILL.md §\"Authoritative state file\"
  - skills/workflow-reviewer/SKILL.md
  - schemas/onboarding-status.schema.json"
      exit 0
    fi
  fi
fi

# Phase 4 — phase4-cycle-<N>-section-<id>: when currentPhase = 4.
TARGET_CYCLE=""
if [ "$CURRENT_PHASE" = "4" ]; then
  TARGET_CYCLE=$(echo "$DESCRIPTION" | sed -nE 's/.*phase4-cycle-([1-5])-.*/\1/p' | head -1)
fi
if [ -n "$TARGET_CYCLE" ]; then
  PRIOR_CYCLE=$((TARGET_CYCLE - 1))
  if [ "$PRIOR_CYCLE" -ge 1 ]; then
    PRIOR_CYCLE_ID="cycle-${PRIOR_CYCLE}"
    PRIOR_CYCLE_VERDICT=$("$JQ" -r --arg id "$PRIOR_CYCLE_ID" '
      [.phases[]? | select(.id == 4) | .subStages[]? | select(.id == $id)] |
      .[0].reviewerVerdict // "pending"
    ' "$LEDGER" 2>/dev/null || echo "pending")
    if [ "$PRIOR_CYCLE_VERDICT" != "approved" ]; then
      emit_deny "[BLOCKED] Out-of-order Phase-4 cycle dispatch — cycle-${TARGET_CYCLE} cannot start while cycle-${PRIOR_CYCLE} is not reviewer-approved.

Description: \"${DESCRIPTION}\"

Ledger shows cycle-${PRIOR_CYCLE}.reviewerVerdict = \"${PRIOR_CYCLE_VERDICT}\"
(must be \"approved\").

Fix: dispatch \`workflow-reviewer-cycle${PRIOR_CYCLE}:\` first. The
reviewer checks the iterative-discovery-cycle criteria from
skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\".

See:
  - skills/journey-mapping/SKILL.md
  - skills/workflow-reviewer/SKILL.md
  - schemas/onboarding-status.schema.json"
      exit 0
    fi
  fi
fi

# All checks passed — silent allow.
exit 0
