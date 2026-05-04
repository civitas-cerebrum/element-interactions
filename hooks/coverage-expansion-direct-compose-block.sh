#!/bin/bash
# coverage-expansion-direct-compose-block.sh — orchestrator-direct-composition gate
#
# Hook    : PostToolUse:Write|Edit  (filters to journey spec files only)
# Mode    : DENY when an active coverage-expansion run has no in-flight composer
#           registered for the slug being written. ALLOW when the writer is a
#           legitimate composer / probe subagent (recognised via the in-flight
#           registration file written by coverage-expansion-dispatch-guard.sh).
# State   : reads `<repo>/tests/e2e/docs/coverage-expansion-state.json`
#           (active-run signal) +
#           `<repo>/tests/e2e/docs/.in-flight-composers.json`
#           (legitimate-writer registration)
# Env     : none
#
# Rule
# ----
# Writes / edits to `tests/e2e/j-*.spec.ts` (or `tests/e2e/sj-*.spec.ts`,
# or `tests/e2e/j-*-regression.spec.ts`) are gated when
# `coverage-expansion-state.json` exists in the project — signal the
# orchestrator is in coverage-expansion mode. Journey-spec writes during
# such a run belong to a dispatched `composer-j-<slug>:` (or
# `probe-j-<slug>:` for adversarial passes) subagent, not to direct
# orchestrator action.
#
# To distinguish a legitimate composer-subagent write from an
# orchestrator-direct-composition violation without a harness-level
# `is_subagent` field, the dispatch-guard hook
# (coverage-expansion-dispatch-guard.sh) registers each composer / probe
# dispatch in `.in-flight-composers.json` with a 30-min rolling TTL. This
# hook reads that file: if the slug being written is in-flight, ALLOW
# (legitimate subagent doing its work); else DENY (direct orchestrator
# composition).
#
# Why
# ---
# coverage-expansion §"Orchestrator context discipline" mandates that DOM
# snapshots, test source, CLI transcripts, and stabilization output live
# in dispatched-subagent contexts — the orchestrator stays at index-level
# state only. When the orchestrator absorbs composer work directly, it
# violates that discipline AND pollutes its own context for the rest of
# the run (DOM snapshots + spec source + stabilization output stack up).
#
# This pattern was observed during the v0.3.4 onboarding test: the agent
# correctly identified that 22 parallel composer-j- dispatches against a
# shared MongoDB would race on /api/reset, so it bailed into orchestrator-
# direct serial composition. The fix is the per-test-user pattern (Stage
# 4a §1.A under `global-reset:cross-test-race`), which makes parallel
# composer dispatch safe again. This hook now BLOCKS the orchestrator-
# direct write and points at that upstream fix.
#
# happy-path.spec.ts is exempt (Phase 3 of onboarding writes it before
# coverage-expansion's Pass 1, and `coverage-expansion-state.json` doesn't
# exist yet at that point — but the explicit exempt is defense-in-depth
# for resume scenarios). Specs without a j-/sj- prefix are exempt
# (companion-mode / element-interactions Stage 3 ad-hoc tests).
#
# Canonical reference
# -------------------
# skills/coverage-expansion/SKILL.md §"Orchestrator context budget"
#   ("Hard rules — kernel-resident" block)
# skills/coverage-expansion/references/anti-rationalizations.md
#   §"Orchestrator-direct composition"
# skills/element-interactions/references/test-optimization.md §1.A
#   (per-test-user pattern under global-reset:cross-test-race)
#
# Failure → action
# ----------------
# - Write/Edit to tests/e2e/{j,sj}-*.spec.ts (incl. -regression):
#     - active coverage-expansion run AND slug is in-flight    → silent allow (legit composer subagent)
#     - active coverage-expansion run AND slug is NOT in-flight → DENY (orchestrator-direct composition)
#     - no active coverage-expansion run (state file absent)    → silent allow (Stage 3 / companion-mode context)
# - happy-path.spec.ts                                          → silent allow (always exempt)
# - Anything else                                               → silent allow

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

# Filter to journey spec files only. happy-path.spec.ts is exempt.
case "$FILE_PATH" in
  *tests/e2e/happy-path.spec.ts) exit 0 ;;
  *tests/e2e/j-*.spec.ts|*tests/e2e/sj-*.spec.ts) ;;
  *) exit 0 ;;
esac

# Resolve repo root.
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
STATE_FILE="$REPO_ROOT/tests/e2e/docs/coverage-expansion-state.json"
IN_FLIGHT="$REPO_ROOT/tests/e2e/docs/.in-flight-composers.json"

# Active coverage-expansion run signal: state file present.
[ ! -f "$STATE_FILE" ] && exit 0

# Extract the journey slug (strip directory + .spec.ts + -regression suffix).
SLUG=$(basename "$FILE_PATH" | sed -E 's/\.spec\.ts$//' | sed -E 's/-regression$//')

# In-flight check — is THIS slug registered as a legitimate composer/probe write?
# Without the registration file, treat all journey-spec writes during an active
# coverage-expansion run as orchestrator-direct (the strictest interpretation).
IN_FLIGHT_HIT="false"
if [ -f "$IN_FLIGHT" ]; then
  if jq -e --arg s "$SLUG" '.composers[$s] // empty' "$IN_FLIGHT" >/dev/null 2>&1; then
    # Optional TTL freshness check — entries older than 30 min are GC'd by the
    # dispatch-guard, but if a stale entry slips through, ignore it.
    STARTED_AT=$(jq -r --arg s "$SLUG" '.composers[$s].started_at // ""' "$IN_FLIGHT")
    if [ -n "$STARTED_AT" ]; then
      NOW_EPOCH=$(date -u +%s)
      THEN_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$STARTED_AT" +%s 2>/dev/null || date -u -d "$STARTED_AT" +%s 2>/dev/null || echo "0")
      if [ "$THEN_EPOCH" != "0" ]; then
        AGE=$((NOW_EPOCH - THEN_EPOCH))
        if [ "$AGE" -le 1800 ]; then
          IN_FLIGHT_HIT="true"
        fi
      fi
    fi
  fi
fi

if [ "$IN_FLIGHT_HIT" = "true" ]; then
  # Legitimate composer/probe subagent doing its work — silent allow.
  exit 0
fi

# No in-flight registration for this slug → orchestrator-direct composition.
emit_deny "[BLOCKED] Direct composition of \`$SLUG\` during active coverage-expansion run.

──────────────────────────────────────────────────────────────────
Do this instead — dispatch a composer subagent:
──────────────────────────────────────────────────────────────────

  Agent({
    description: \"composer-$SLUG: cycle 1\",
    prompt: \`
## Journey block
<paste the ### $SLUG: block from journey-map.md, this journey only>

## Must-fix list
(none — cycle 1)

## Session slug
composer-$SLUG-1-c1

## Return shape
See skills/element-interactions/references/subagent-return-schema.md.
\`,
    subagent_type: \"general-purpose\"
  })

…fan out one Agent call per journey IN THE SAME MESSAGE for parallel dispatch (subject to the \`P_dispatch\` cap from the audit). The dispatch-guard hook will register each composer in \`.in-flight-composers.json\`; this hook then ALLOWS the subagent's spec write because its slug is in-flight.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
File:           $FILE_PATH
Active run:     $STATE_FILE present (coverage-expansion is running)
In-flight check: \`$SLUG\` NOT registered in $IN_FLIGHT
                  ↳ no \`composer-$SLUG:\` or \`probe-$SLUG:\` Agent dispatch is currently active

Journey-spec writes during a coverage-expansion run come from dispatched composer / probe subagents (the dispatch-guard records each one in the in-flight file with a 30-min TTL). When this hook runs and the slug isn't in-flight, the writer is the orchestrator itself — that's the contract violation.

Why this matters:
  • 3× slower wall-clock vs parallel dispatch with \`P_dispatch\` composers per wave.
  • Orchestrator context burns proportional to total work (vs O(structured-return summaries) with subagent dispatch).
  • Stage B reviewers disappear from the loop → dual-stage no-skip contract silently broken.
  • Phase-validator-5 catches it eventually (no per-journey \`review_status\` entries) but only at phase exit; this hook catches it at the write boundary.

──────────────────────────────────────────────────────────────────
If parallel dispatch felt unsafe — read this:
──────────────────────────────────────────────────────────────────

If you bailed because of shared-DB races (e.g. \`/api/reset\` across workers), the upstream fix is the per-test-user pattern. The audit emits a \`global-reset:cross-test-race\` tag when it detects this; under that tag, test-optimization.md §1.A inverts §1 — forbids \`beforeEach(reset)\`, mandates a \`freshUser\` helper + once-per-suite \`globalSetup\`. Per-test-user makes parallel composer dispatch safe; you can fan out to \`P_dispatch\` composers per wave again.

References:
  coverage-expansion/SKILL.md §\"Orchestrator context budget\" (kernel-resident)
  coverage-expansion/references/anti-rationalizations.md §\"Orchestrator-direct composition\"
  element-interactions/references/test-optimization.md §1.A (per-test-user isolation)"

exit 0
