#!/bin/bash
# playwright-cli-isolation-guard.sh
#
# PreToolUse hook for the Bash tool. Enforces that every `playwright-cli`
# invocation runs in a role-prefixed isolated session — the slug must follow
# the SAME naming convention as the dispatching subagent's `description`
# prefix (see coverage-expansion-dispatch-guard.sh).
#
# Convention (subagent ID ↔ CLI slug):
#   Agent description prefix    →   CLI -s= slug pattern
#   ----------------------------    -------------------------------------
#   j-<slug>:                       j-<slug>-<pass>-stage-{a,b}[-cycleN]
#   sj-<slug>:                      sj-<slug>-<pass>-stage-{a,b}
#   phase1-<entry>:                 phase1-<entry>
#   stage2-<scenario>:              stage2-<scenario>
#   composer-<slug>:                composer-<slug>
#   reviewer-<slug>:                reviewer-<slug>
#   probe-<slug>:                   probe-<slug>
#   cleanup-<scope>:                cleanup-<scope>
#
# The shared prefix means `.playwright-cli/<slug>*` files trace 1:1 back to
# the subagent that produced them.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Filter: only fire when playwright-cli is actually being INVOKED as a command,
# not just mentioned inside a string argument (echo, error message, JSON literal).
# A real invocation appears at:
#   - start of the command line, optionally via npx | bunx | pnpm exec | yarn exec
#   - after a command separator (;, &&, ||, |) with the same optional runners
# Crucially, NOT inside a quoted string — those are preceded by " or ' or :.
RUNNERS='(npx|bunx|pnpm[[:space:]]+exec|yarn[[:space:]]+exec)[[:space:]]+'
SEP='(^|[;|][[:space:]]*|&&[[:space:]]*|\|\|[[:space:]]*)'
if ! echo "$CMD" | grep -qE "${SEP}(${RUNNERS})?playwright-cli[[:space:]]"; then
  exit 0
fi

# Allow session-agnostic subcommands. These run without `-s=` by design.
if echo "$CMD" | grep -qE 'playwright-cli[[:space:]]+(install-browser|close-all|kill-all|list-sessions|sessions|--help|-h|--version|-v)([[:space:]]|$)'; then
  exit 0
fi

# Truncate command for inclusion in error messages.
CMD_PREVIEW="$CMD"
if [ ${#CMD} -gt 160 ]; then
  CMD_PREVIEW="${CMD:0:160}..."
fi

# Extract slug from either form: `-s=<slug>` or `-s <slug>`.
SLUG=$(echo "$CMD" | grep -oE -- '-s=[A-Za-z0-9_.-]+' | head -1 | sed 's/^-s=//' || true)
if [ -z "$SLUG" ]; then
  SLUG=$(echo "$CMD" | grep -oE -- '-s[[:space:]]+[A-Za-z0-9_.-]+' | head -1 | sed -E 's/^-s[[:space:]]+//' || true)
fi

# Allowed slug prefixes — must match dispatch-guard's role prefixes. The
# trailing `[a-z0-9-]+` enforces a non-empty suffix so bare prefixes like
# `phase1-` or `j--` are rejected.
SLUG_PREFIX_REGEX='^(j|sj|phase1|phase2|stage2|composer|reviewer|probe|cleanup)-[a-z0-9][a-z0-9-]*'

emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# Case 1: -s= flag is missing entirely.
if [ -z "$SLUG" ]; then
  emit_deny "[BLOCKED] Missing -s=<slug> flag.

Command: $CMD_PREVIEW

Fix: add an isolated session slug matching this subagent's role.

  npx playwright-cli -s=<slug> <subcommand> ...

Slug convention (must match the Agent description prefix that dispatched this subagent):

  j-<slug>-<pass>-stage-{a,b}[-cycleN]   composer / reviewer / probe
  sj-<slug>-<pass>-stage-{a,b}           sub-journey
  phase1-<entry>                          Phase-1 discovery
  stage2-<scenario>                       element inspection
  composer-<slug> | reviewer-<slug> | probe-<slug> | cleanup-<scope>

Why: without -s=, playwright-cli uses the shared default session — two parallel subagents fight over one browser process and isolation breaks. See element-interactions Rule 11 + playwright-cli-protocol.md §3.1."
  exit 0
fi

# Case 2: slug is in collision-prone blocklist.
case "$SLUG" in
  default|test|session|temp|tmp|x|y|main|stage1|stage3|stage4|pass1|pass2|pass3|pass4|pass5)
    emit_deny "[BLOCKED] Slug '-s=$SLUG' is collision-prone.

Command: $CMD_PREVIEW

Fix: use a slug that names the specific subagent context, matching the dispatching Agent's description prefix:

  j-<slug>-<pass>-stage-{a,b}[-cycleN]
  phase1-<entry>
  stage2-<scenario>
  composer-<slug> | reviewer-<slug> | probe-<slug>

Why: when two subagents both use '-s=$SLUG', the second's open reuses the first's browser and isolation breaks silently. See playwright-cli-protocol.md §3.1."
    exit 0
    ;;
esac

# Case 3: slug doesn't follow the role-prefix convention.
if ! echo "$SLUG" | grep -qE "$SLUG_PREFIX_REGEX"; then
  emit_deny "[BLOCKED] Slug '-s=$SLUG' missing role prefix.

Command: $CMD_PREVIEW

Fix: prefix the slug with this subagent's role so .playwright-cli/<slug>* files trace 1:1 to it.

  -s=j-<journey-slug>-<pass>-stage-a       composer
  -s=j-<journey-slug>-<pass>-stage-b       reviewer
  -s=j-<journey-slug>-<pass>-stage-a       probe (passes 4-5)
  -s=phase1-<entry>                         Phase-1 discovery
  -s=stage2-<scenario>                      element inspection

Allowed prefixes: j- | sj- | phase1- | phase2- | stage2- | composer- | reviewer- | probe- | cleanup-

Why: a slug without a role prefix is unreviewable — you can't tell from .playwright-cli/<slug>* which subagent or pass produced the artifacts. The convention also locks subagent description ↔ CLI slug into a mechanical mapping (same prefix on both ends). See coverage-expansion-dispatch-guard.sh and playwright-cli-protocol.md §3.1."
  exit 0
fi

# Case 4: slug is too short even with prefix (defense-in-depth).
if [ ${#SLUG} -lt 6 ]; then
  emit_deny "[BLOCKED] Slug '-s=$SLUG' is too short (≥6 chars required).

Command: $CMD_PREVIEW

Fix: add the scope after the role prefix.

  -s=j-checkout-1-stage-a    not    -s=j-x

Why: ≥6 chars + role prefix is required to disambiguate parallel subagents. See playwright-cli-protocol.md §3.1."
  exit 0
fi

exit 0
