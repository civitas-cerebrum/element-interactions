#!/bin/bash
# coverage-expansion-dispatch-guard.sh
#
# PreToolUse hook for the Agent tool. Enforces the @civitas-cerebrum/
# element-interactions per-subagent dispatch contract: each composer/reviewer/
# probe Agent covers ONE journey (or one named phase), and its `description`
# field begins with a recognized role prefix that names that subagent's
# identity. The same prefix appears on the subagent's playwright-cli session
# slug — see playwright-cli-isolation-guard.sh.
#
# Recognized role prefixes (subagent ID schemes):
#   j-<slug>:         single-journey composer / reviewer / probe
#   sj-<slug>:        sub-journey
#   phase1-<entry>:   Phase-1 discovery subagent
#   phase2-<scope>:   Phase-2+ discovery
#   stage2-<scenario>:element inspection (stage 2 of element-interactions)
#   composer-<slug>:  test-composer subagent
#   reviewer-<slug>:  Stage B reviewer
#   probe-<slug>:     adversarial probe (passes 4-5)
#   cleanup-<scope>:  ledger dedup / cleanup
#   [P3-batch] j-<slug>,j-<slug>,...:  P3 batch (max 7, P3 only)

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // ""')
PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // ""')

# Only inspect dispatches that look like coverage-expansion / orchestration work.
# Each marker chosen to be specific to the skill suite so unrelated prompts
# that happen to mention "Pass 1" or "Stage A" don't trigger inspection.
if ! echo "$PROMPT" | grep -qE 'coverage-expansion|test-composer|JOURNEYS YOU OWN|cycle-[0-9]+ Stage [AB]|journey-map\.md|element-interactions[ /]|playwright-cli[[:space:]]+-s='; then
  exit 0
fi

# Allowed description prefixes (single-journey scope).
ALLOWED_PREFIX_REGEX='^(j-[a-z0-9-]+|sj-[a-z0-9-]+|phase1-[a-z0-9-]+|phase2-[a-z0-9-]+|stage2-[a-z0-9-]+|composer-[a-z0-9-]+|reviewer-[a-z0-9-]+|probe-[a-z0-9-]+|cleanup-[a-z0-9-]+)(:|[[:space:]]|$)'

# P3 batch form: `[P3-batch] j-a, j-b, j-c:`  (cap 7 enforced via comma count).
# Allows optional whitespace after each comma for human-friendly listings.
P3_BATCH_REGEX='^\[P3-batch\][[:space:]]+j-[a-z0-9-]+([[:space:]]*,[[:space:]]*j-[a-z0-9-]+){0,6}([[:space:]]*:|[[:space:]]|$)'

if echo "$DESCRIPTION" | grep -qE "$ALLOWED_PREFIX_REGEX"; then
  exit 0
fi
if echo "$DESCRIPTION" | grep -qE "$P3_BATCH_REGEX"; then
  exit 0
fi

# Count distinct j-<slug> references in the prompt body. If 2+ appear, this
# is almost certainly a batched composer/reviewer dispatch against the rules.
# Word-boundary anchors the match so substrings like `obj-foo`, `subj-x`,
# `proj-bar` are NOT counted as journey IDs.
DISTINCT=$(echo "$PROMPT" | grep -oE '(^|[^a-zA-Z0-9_])(j-[a-z0-9-]+)' | grep -oE 'j-[a-z0-9-]+' | sort -u | wc -l | tr -d '[:space:]')

if [ "$DISTINCT" -ge 2 ]; then
  REASON="[BLOCKED] Subagent dispatch missing role-prefixed description.

Description: \"${DESCRIPTION}\"
Found: ${DISTINCT} distinct j-<slug> IDs in prompt → looks like batched dispatch.

Fix: re-issue as N parallel single-journey Agent calls in one message. Each call's description must START with a recognized role prefix:

  j-<slug>:           single-journey composer / reviewer / probe
  sj-<slug>:          sub-journey
  phase1-<entry>:     Phase-1 discovery
  stage2-<scenario>:  element inspection
  composer-<slug>:    test-composer
  reviewer-<slug>:    Stage B reviewer
  probe-<slug>:       adversarial probe
  cleanup-<scope>:    ledger / cleanup
  [P3-batch] j-a,j-b,...:  P3 batch (≤7, P3 priority only)

The same prefix appears on the subagent's CLI session slug (see playwright-cli-isolation-guard) so .playwright-cli/<slug>* trace files map 1:1 to the subagent.

Why: P0/P1/P2 journeys never batch — see coverage-expansion SKILL.md §\"Stage A per-journey dispatch is non-negotiable\". A batched composer rations attention across siblings and skips Test-expectations bullets, surfacing as Stage B improvements-needed."

  jq -n --arg r "$REASON" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
fi

exit 0
