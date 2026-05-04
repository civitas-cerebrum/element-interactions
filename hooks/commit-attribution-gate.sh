#!/bin/bash
# commit-attribution-gate.sh — surface missing issue-reporter attribution
#
# Hook    : PreToolUse:Bash  (filters to `git commit` invocations only)
# Mode    : WARN (systemMessage) — never DENY. Self-reported issues are a
#           legitimate path; the hook makes the omission visible, doesn't
#           block it.
# State   : none
# Env     : COMMIT_ATTRIBUTION_GATE=off → silent allow (manual escape hatch
#           for self-reported / chore commits where attribution is moot)
#
# Rule
# ----
# When a `git commit` references a GitHub issue via `Closes #N`, `Fixes #N`,
# `Resolves #N`, or `Closes <repo>#N` / `closes #N` (case-insensitive), the
# commit body MUST also include a `Reported-by:` (or `Issue-reported-by:`)
# line crediting the issue's author. The credit format is:
#
#   Reported-by: @<github-handle>
#
# Multi-reporter support:
#
#   Reported-by: @umutayb, @Emmdb
#
# Why
# ---
# Issues filed by users are the load-bearing input that makes this package's
# methodology improve faster than any internal review process could. The
# minimum acknowledgement is a verifiable line in the commit body (it
# travels with the merge commit, survives squash-merge, surfaces in `git
# log`, and is mechanically detectable). Without it, the issue author's
# contribution silently disappears into the maintainer's PR description and
# the credit graph rots over time.
#
# Hard rule: contributing-to-element-interactions/SKILL.md §"Attribute
# issue reporters" (this hook's canonical reference).
#
# Canonical reference
# -------------------
# skills/contributing-to-element-interactions/SKILL.md §"Attribute issue reporters"
#
# Failure → action
# ----------------
# - `git commit` references Closes/Fixes/Resolves #N AND no Reported-by:
#   line in the same command body                                  → WARN
# - Body has Reported-by: @<handle>                                 → silent allow
# - `git commit` does not reference an issue                        → silent allow
# - Anything else                                                   → silent allow

set -euo pipefail

if [ "${COMMIT_ATTRIBUTION_GATE:-on}" = "off" ]; then
  exit 0
fi

emit_warn() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

[ "$TOOL_NAME" = "Bash" ] || exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
[ -z "$CMD" ] && exit 0

# Filter to `git commit` invocations.
echo "$CMD" | grep -qE '\bgit\s+commit\b' || exit 0

# Issue-reference patterns (case-insensitive). We accept the full GitHub
# closing-keyword set so any of them triggers the check.
ISSUE_REF=$(echo "$CMD" | grep -oiE '\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b[[:space:]]+(([a-zA-Z0-9._/-]+)?#[0-9]+)' | head -1 || true)

# No issue reference → nothing to enforce.
[ -z "$ISSUE_REF" ] && exit 0

# Look for an attribution line. Accept either form.
if echo "$CMD" | grep -qiE '(^|[^a-z])(reported-by|issue-reported-by):[[:space:]]*@?[A-Za-z0-9_-]+'; then
  exit 0
fi

# Extract the issue reference for the message (e.g. "Closes #156").
ISSUE_NUM=$(echo "$ISSUE_REF" | grep -oE '#[0-9]+' | head -1 || echo "#?")

emit_warn "[WARN] commit references ${ISSUE_REF} but is missing issue-reporter attribution.

Add a line to the commit body crediting the issue's author:

  Reported-by: @<github-handle>

Multi-reporter is fine:

  Reported-by: @umutayb, @Emmdb

Why this matters: issue-driven improvements are the load-bearing input the methodology improves on. A 'Reported-by:' line travels with the merge commit, survives squash-merge, surfaces in git log, and is mechanically detectable — without it, credit silently disappears into the PR description.

To find the issue author for ${ISSUE_NUM}:

  gh issue view ${ISSUE_NUM#\\#} --json author -q .author.login

Hard rule: skills/contributing-to-element-interactions/SKILL.md §\"Attribute issue reporters\"
Hook: hooks/commit-attribution-gate.sh

Escape hatch (e.g. self-reported issues, chore commits): set COMMIT_ATTRIBUTION_GATE=off in the environment for that commit."
exit 0
