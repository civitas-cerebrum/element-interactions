#!/bin/bash
# coverage-expansion-direct-compose-warning.sh — orchestrator-direct-composition warning
#
# Hook    : PostToolUse:Write|Edit  (filters to journey spec files only)
# Mode    : WARN (no DENY — orchestrator may legitimately write specs in
#                 element-interactions Stage 3 / companion-mode contexts;
#                 this warns when it happens during a coverage-expansion run)
# State   : reads `<repo>/tests/e2e/docs/coverage-expansion-state.json`
#           as the signal for "active coverage-expansion run"
# Env     : none
#
# Rule
# ----
# Writes / edits to `tests/e2e/j-*.spec.ts` (or `tests/e2e/sj-*.spec.ts`,
# or `tests/e2e/j-*-regression.spec.ts`) emit a `systemMessage` warning
# WHEN `coverage-expansion-state.json` exists in the project. The signal:
# the orchestrator is in coverage-expansion mode, and journey-spec writes
# should come from a `composer-j-<slug>:` (or `probe-j-<slug>:`) subagent
# dispatch, not from direct orchestrator action.
#
# Why
# ---
# coverage-expansion §"Orchestrator context discipline" mandates that DOM
# snapshots, test source, CLI transcripts, and stabilization output live
# in dispatched-subagent contexts — the orchestrator stays at index-level
# state only. When the orchestrator absorbs composer work (writes the
# spec, runs `playwright-cli` for selectors, runs `npx playwright test`
# itself), it violates that discipline.
#
# This pattern was observed during the v0.3.4 onboarding test: the agent
# correctly identified that 22 parallel composer-j- dispatches against a
# shared MongoDB would race on /api/reset, so it bailed into orchestrator-
# direct serial composition. The fix is the per-test-user pattern (Stage
# 4a §1.A under `global-reset:cross-test-race`), which makes parallel
# composer dispatch safe again. This hook surfaces the violation so the
# orchestrator gets a nudge to dispatch instead.
#
# happy-path.spec.ts is exempt (Phase 3 of onboarding writes it before
# coverage-expansion's Pass 1). Specs without a j-/sj- prefix are exempt
# (companion-mode / element-interactions Stage 3 ad-hoc tests).
#
# Canonical reference
# -------------------
# skills/coverage-expansion/SKILL.md §"Orchestrator context discipline"
# skills/coverage-expansion/references/anti-rationalizations.md
#   §"Orchestrator-direct composition"
#
# Failure → action
# ----------------
# - Write/Edit to `tests/e2e/j-*.spec.ts` or
#   `tests/e2e/sj-*.spec.ts` or
#   `tests/e2e/j-*-regression.spec.ts`
#   AND `coverage-expansion-state.json` exists  → WARN (systemMessage)
# - Anything else                               → silent allow
# - happy-path.spec.ts (Phase 3 path)           → silent allow

set -euo pipefail

# --- helpers ---
emit_warn() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
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

# Active coverage-expansion run signal: state file present.
[ ! -f "$STATE_FILE" ] && exit 0

# Extract a short journey-slug guess from the file path for the warning.
SLUG=$(basename "$FILE_PATH" | sed -E 's/\.spec\.ts$//' | sed -E 's/-regression$//')

emit_warn "[WARN] Direct composition of \`$SLUG\` during active coverage-expansion run.

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

…and fan out one Agent call per journey IN THE SAME MESSAGE for parallel
dispatch (subject to the P_dispatch cap from the audit).

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
File: $FILE_PATH

This warning fires because \`coverage-expansion-state.json\` exists — you're
in an active coverage-expansion run. Journey-spec writes here belong to a
dispatched \`composer-j-<slug>:\` subagent (or \`probe-j-<slug>:\` for
adversarial passes), not to direct orchestrator action. Writing the spec
yourself absorbs DOM snapshots, test source, and stabilization output into
your own context — violates §\"Orchestrator context discipline\".

Cost of staying on this path:
  • 3× slower wall-clock vs parallel dispatch with P_dispatch composers.
  • Orchestrator context burns proportional to total work (vs O(structured-
    return summaries) with subagent dispatch).
  • Stage B reviewers disappear → dual-stage no-skip contract silently broken.

──────────────────────────────────────────────────────────────────
If parallel dispatch felt unsafe — read this:
──────────────────────────────────────────────────────────────────

If you bailed because of shared-DB races (e.g. \`/api/reset\` across workers),
the upstream fix is the per-test-user pattern. The audit emits a
\`global-reset:cross-test-race\` tag when it detects this; under that tag,
test-optimization.md §1.A inverts §1 — forbids \`beforeEach(reset)\`,
mandates a \`freshUser\` helper + once-per-suite \`globalSetup\`. Per-test-
user makes parallel composer dispatch safe; you can fan out to P_dispatch
composers per wave again.

References:
  coverage-expansion/SKILL.md §\"Orchestrator context discipline\"
  coverage-expansion/references/anti-rationalizations.md §\"Orchestrator-direct composition\"
  element-interactions/references/test-optimization.md §1.A (per-test-user isolation)"

exit 0
