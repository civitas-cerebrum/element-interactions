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
#   composer-<slug>:        test-composer subagent (Stage A compositional)
#   reviewer-<slug>:        Stage B reviewer
#   probe-<slug>:           adversarial probe (passes 4-5)
#   process-validator-<scope>: sub-orchestrator validating a planned dispatch wave
#   phase1-<entry>:         Phase-1 discovery subagent
#   phase2-<scope>:         Phase-2+ discovery
#   stage2-<scenario>:      element inspection (stage 2 of element-interactions)
#   cleanup-<scope>:        ledger dedup / cleanup
#   [P3-batch] composer-<slug>,composer-<slug>,...: P3 batch (max 7, P3 only)
#
# Journey-scoped slugs follow the pattern <role>-j-<slug> (e.g.
# composer-j-checkout, reviewer-j-checkout, probe-j-checkout). Bare j-<slug>
# and sj-<slug> were dropped per issue #126 — they're role-ambiguous and
# downstream return-schema validation can't map them to a return shape.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // ""')
PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // ""')

# Allowed description prefixes (single-journey scope, plus process-validator).
# process-validator-<scope>: dispatched by the parent orchestrator BEFORE a
# wave of composer/reviewer/probe subagents to validate the planned dispatch
# manifest against the skill's contract. The validator returns greenlight or
# improvements-needed; only on greenlight does the parent fan out the wave.
#
# Bare `j-<slug>:` / `sj-<slug>:` were dropped per issue #126 — every
# journey-scoped dispatch must declare its role (composer / reviewer / probe).
# The role-prefix is the routing key for the downstream return-schema
# validator (hooks/subagent-return-schema-guard.sh).
ALLOWED_PREFIX_REGEX='^(phase1-[a-z0-9-]+|phase2-[a-z0-9-]+|stage2-[a-z0-9-]+|composer-[a-z0-9-]+|reviewer-[a-z0-9-]+|probe-[a-z0-9-]+|cleanup-[a-z0-9-]+|process-validator-[a-z0-9-]+)(:|[[:space:]]|$)'

# P3 batch form: `[P3-batch] composer-j-a, composer-j-b, composer-j-c:`
# (cap 7 enforced via comma count). Allows optional whitespace after each
# comma for human-friendly listings. Items must be role-explicit composer-
# slugs — P3 batches are composer dispatches by definition.
P3_BATCH_REGEX='^\[P3-batch\][[:space:]]+composer-[a-z0-9-]+([[:space:]]*,[[:space:]]*composer-[a-z0-9-]+){0,6}([[:space:]]*:|[[:space:]]|$)'

DESCRIPTION_HAS_ROLE_PREFIX=false
if echo "$DESCRIPTION" | grep -qE "$ALLOWED_PREFIX_REGEX"; then
  DESCRIPTION_HAS_ROLE_PREFIX=true
elif echo "$DESCRIPTION" | grep -qE "$P3_BATCH_REGEX"; then
  DESCRIPTION_HAS_ROLE_PREFIX=true
fi

# === Anti-pattern A: subagent asking another subagent to fan-out =======
# Subagents CANNOT dispatch their own sub-subagents in this environment
# (the Agent / Task tool is parent-only). A prompt instructing a subagent
# to "dispatch N parallel subagents", "fan out", or to "use the Agent tool
# to spawn workers" is a methodology bug — the work either belongs to the
# parent (recursive dispatch impossible) or the prompt should ask the
# subagent to RETURN A MANIFEST the parent will dispatch from.
if echo "$PROMPT" | grep -qiE '(dispatch|spawn|fan[ -]?out|fire) [0-9]+ (parallel|sub|sub-?agents?|agents)|use (the )?Agent tool to (dispatch|spawn|fan)|you are .{0,20} dispatch (subagents|N parallel)'; then
  REASON_FANOUT="[BLOCKED] Subagent brief asks the subagent to dispatch sub-subagents.

Description: \"${DESCRIPTION}\"

Subagents in this environment CANNOT recursively dispatch other subagents — the Agent / Task tool is parent-only. A subagent that tries to fan out hits a hard wall (\"no Agent / Task tool available in my toolset\"). This is an environment limitation, not a contract.

Fix the methodology, not the prompt. Two valid patterns:
  (a) Parent dispatches the wave directly. The subagent does ONE focused job.
  (b) Sub-orchestrator pattern: this subagent PLANS the wave and RETURNS A
      MANIFEST (a structured list of N briefs). The parent reads the
      manifest and dispatches the wave. The sub-orchestrator never tries
      to fire its own children.

If you intended (b), reword the brief: ask the subagent to *return* a
dispatch plan, not to *execute* it. See coverage-expansion §\"Orchestrator
context discipline\" + §\"Recursive dispatch is impossible — plan, don't
fan out\"."
  jq -n --arg r "$REASON_FANOUT" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
  exit 0
fi

# === Anti-pattern B: orchestrator meta-content leak ===========================
# Composer / reviewer / probe / cleanup subagents should NOT receive pipeline
# meta-content (depth mode, 5-pass, Pass 4/5, etc.) — that belongs to the
# parent orchestrator's context only.
if [ "$DESCRIPTION_HAS_ROLE_PREFIX" = true ] && echo "$DESCRIPTION" | grep -qE '^(composer-|reviewer-|probe-|cleanup-|phase1-|phase2-|stage2-)'; then
  # `|| true` guards against set -e + pipefail: when no leak phrase matches,
  # grep -o returns 1 and the substitution would otherwise abort the script.
  LEAK=$(echo "$PROMPT" | grep -oiE 'depth mode|breadth mode|5-pass pipeline|5-pass|3 compositional|2 adversarial|pass(es)? [2-5]([[:space:]]|$|/|,|\.)|pipeline (orchestrator|stage|coordinator)|adversarial pass(es)?' | sort -u | head -5 | tr '\n' '|' | sed 's/|$//' || true)
  if [ -n "$LEAK" ]; then
    WARNING="[WARN] Subagent brief contains orchestrator meta-content: ${LEAK//|/, }

This subagent only needs: journey block + must-fix list + slug + return shape. References to the broader pipeline (depth/breadth mode, Pass 4/5, 5-pass structure, adversarial passes) belong to the parent orchestrator's context — they bloat the subagent's context and risk it consulting parts of the skill outside its scope.

Suggested cleanup: remove pipeline meta-talk from the brief. Subagent role + must-fix list + return contract is enough. See coverage-expansion §\"Orchestrator context discipline\"."
    jq -n --arg m "$WARNING" '{
      "systemMessage": $m,
      "suppressOutput": false
    }'
  fi
fi

# If the description carries a recognized role prefix, no further checks.
if [ "$DESCRIPTION_HAS_ROLE_PREFIX" = true ]; then
  exit 0
fi

# === Anti-pattern C: bare j-/sj- prefix (deprecated, role-ambiguous) ====
# Pre-issue-#126 form `j-<slug>:` / `sj-<slug>:` was role-ambiguous — the
# hook layer + downstream return-schema validator can't tell whether the
# dispatch is composer / reviewer / probe. Block with redirect.
if echo "$DESCRIPTION" | grep -qE '^(j-|sj-)[a-z0-9-]+(:|[[:space:]]|$)'; then
  REASON_BARE="[BLOCKED] Subagent dispatch uses deprecated role-ambiguous prefix.

Description: \"${DESCRIPTION}\"

Bare \`j-<slug>:\` and \`sj-<slug>:\` prefixes were dropped per issue #126 — the hook layer + downstream return-schema validator (hooks/subagent-return-schema-guard.sh) can't map the prefix to a role schema (composer / reviewer / probe). Use a role-explicit form instead:

  composer-j-<slug>:    test-composer Stage A
  reviewer-j-<slug>:    Stage B reviewer
  probe-j-<slug>:       adversarial probe (passes 4-5)
  composer-sj-<slug>:   sub-journey composer
  reviewer-sj-<slug>:   sub-journey reviewer

The role prefix appears unchanged on the playwright-cli session slug (see playwright-cli-isolation-guard.sh), so .playwright-cli/<slug>* trace files map 1:1 to the dispatching subagent's role + journey.

See coverage-expansion/SKILL.md §\"Role prefixes\" for the full mapping table."
  jq -n --arg r "$REASON_BARE" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
  exit 0
fi

# === Anti-pattern D: prompt body looks coverage-expansion-related but ===
# description has no role prefix → batched-dispatch attempt.
# Only inspect for batched-dispatch when the prompt looks coverage-related.
if ! echo "$PROMPT" | grep -qE 'coverage-expansion|test-composer|JOURNEYS YOU OWN|cycle-[0-9]+ Stage [AB]|journey-map\.md|element-interactions[ /]|playwright-cli[[:space:]]+-s='; then
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

Fix: re-issue as N parallel single-journey Agent calls in one message. Each call's description must START with a role-explicit prefix:

  composer-j-<slug>:        test-composer Stage A
  reviewer-j-<slug>:        Stage B reviewer
  probe-j-<slug>:           adversarial probe (passes 4-5)
  composer-sj-<slug>:       sub-journey composer
  reviewer-sj-<slug>:       sub-journey reviewer
  process-validator-<scope>: sub-orchestrator validating a planned wave
  phase1-<entry>:           Phase-1 discovery
  stage2-<scenario>:        element inspection
  cleanup-<scope>:          ledger / cleanup
  [P3-batch] composer-j-a,composer-j-b,...:  P3 batch (≤7, P3 priority only)

The role-prefix appears unchanged on the subagent's CLI session slug (see playwright-cli-isolation-guard) so .playwright-cli/<slug>* trace files map 1:1 to the subagent's role + journey.

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
