#!/bin/bash
# coverage-expansion-dispatch-guard.sh
#
# PreToolUse hook for the Agent tool. Blocks subagent dispatches that violate
# the coverage-expansion per-journey dispatch contract from the
# civitas-cerebrum/element-interactions skill suite.
#
# Contract (see skills/coverage-expansion/SKILL.md §"Stage A per-journey
# dispatch is non-negotiable"):
#   - Each Stage A composer / Stage B reviewer dispatch covers ONE journey.
#   - The Agent's `description` must start with a single `j-<slug>:` prefix.
#   - P0/P1/P2 journeys NEVER batch.
#   - P3 batching is allowed only when description starts with
#     `[P3-batch] j-<slug>,j-<slug>,...` (cap 7 per the skill).
#
# Detection logic:
#   1. Read tool_input from stdin (JSON).
#   2. Extract `description` and `prompt` fields.
#   3. If the prompt is NOT coverage-expansion related (no journey-map / Stage A /
#      Stage B / Pass-N / coverage-expansion markers), allow without inspection.
#   4. If description matches `^j-[a-z0-9-]+:` (one journey) OR
#      `^\[P3-batch\]\s+j-[a-z0-9-]+(,j-[a-z0-9-]+){0,6}\s*:` (P3 batch), allow.
#   5. Otherwise, count distinct `j-<slug>` references in the prompt body.
#      If ≥ 2 distinct journey IDs appear, BLOCK with an instructive error.
#
# Output: standard PreToolUse hook JSON with permissionDecision: "deny" on block.

set -euo pipefail

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
if [ "$TOOL_NAME" != "Agent" ]; then
  exit 0
fi

DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // ""')
PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // ""')

# Only inspect dispatches that look like coverage-expansion work.
if ! echo "$PROMPT" | grep -qE 'coverage-expansion|test-composer|Stage [AB]|journey-map\.md|pass[ -][0-9]|j-[a-z0-9-]+|JOURNEYS YOU OWN'; then
  exit 0
fi

# Allow if description matches single-journey form.
if echo "$DESCRIPTION" | grep -qE '^j-[a-z0-9-]+(:|[[:space:]]|$)'; then
  exit 0
fi

# Allow if description matches P3-batch form.
if echo "$DESCRIPTION" | grep -qE '^\[P3-batch\][[:space:]]+j-[a-z0-9-]+(,j-[a-z0-9-]+){0,6}'; then
  exit 0
fi

# Count distinct j-<slug> references in the prompt body.
DISTINCT_JOURNEYS=$(echo "$PROMPT" | grep -oE 'j-[a-z0-9-]+' | sort -u | wc -l | tr -d '[:space:]')

if [ "$DISTINCT_JOURNEYS" -ge 2 ]; then
  REASON="Coverage-expansion dispatch contract violation: this Agent dispatch references ${DISTINCT_JOURNEYS} distinct j-<slug> journey IDs in its prompt, but its description (\"${DESCRIPTION}\") does not start with a single \"j-<slug>:\" prefix or a \"[P3-batch] j-<slug>,...\" prefix. Per coverage-expansion SKILL.md §\"Stage A per-journey dispatch is non-negotiable\", every composer/reviewer dispatch covers ONE journey (P3 batching is the only exception). Re-issue as N parallel single-journey Agent calls in one message, each description starting with the journey's j-<slug>: prefix."
  jq -n --arg r "$REASON" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
  exit 0
fi

exit 0
