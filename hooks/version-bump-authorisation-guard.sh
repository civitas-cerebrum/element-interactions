#!/bin/bash
# version-bump-authorisation-guard.sh — deny `npm version` invocations that
# lack explicit user authorisation.
#
# Hook    : PreToolUse:Bash  (filters to `npm version` invocations)
# Mode    : DENY (no version bumps unless the user explicitly says so)
# State   : none
# Env     : BUMP_AUTHORISATION_GUARD=off → silent allow (manual escape
#           hatch when the user has already authorised via prose and
#           wants the tool to run without re-stating the in-band marker)
#
# Rule
# ----
# `npm version <patch|minor|major|<X.Y.Z>>` (and `npm version` with
# `--no-git-tag-version` or any flag) MUST NOT run unless the bash command
# is explicitly authorised. Authorisation is signalled by the literal
# in-band marker `VERSION_BUMP_AUTHORISED=1` as an env-var prefix on the
# same command line:
#
#   ✓ VERSION_BUMP_AUTHORISED=1 npm version patch --no-git-tag-version
#   ✓ VERSION_BUMP_AUTHORISED=1 npm version 0.4.0
#   ✗ npm version patch
#   ✗ npm version 0.4.0
#
# This is the canonical contract: the marker travels with the command,
# auditable in git log, copy-pasteable from a user message. The
# alternative — env-var-set-elsewhere — was rejected because it
# de-correlates authorisation from the actual command being authorised.
# Every bump is a deliberate inline gesture.
#
# Why
# ---
# Versioning is release-time, not per-PR. Multiple open PRs colliding on
# the same version number was the symptom; per-PR bumping was the
# disease. The user directive (2026-05-06) is binding: "no version bumps
# unless the user explicitly says so". Markdown alone is not a guardrail
# — under context pressure, an agent reading "one bump per PR" in older
# docs will bump anyway. The harness layer is the second-reader.
#
# This hook supersedes the WARN-only `version-bump-against-npm-guard.sh`
# (PR #158 followup): bumping against npm-latest is no longer the
# question; the question is whether bumping is authorised at all.
#
# Canonical reference
# -------------------
# skills/contributing-to-element-interactions/SKILL.md §"No version bumps
#   without explicit authorisation" (replaces the legacy Rule 15 "one-PR-
#   one-bump" rule)
# memory/feedback_no_version_bumps.md (user's directive, 2026-05-06)
#
# Failure → action
# ----------------
# - `npm version <X>` without `VERSION_BUMP_AUTHORISED=1` prefix       → DENY
# - `VERSION_BUMP_AUTHORISED=1 npm version <X>`                         → silent allow
# - `BUMP_AUTHORISATION_GUARD=off` env var                              → silent allow
# - `npm install` / `npm test` / `npm publish` etc.                     → silent allow
# - `git tag v<X.Y.Z>` (manual tag without npm version)                 → silent allow
#                                                                          (out of scope; the npm-version path is the canonical bump,
#                                                                          and a manual git tag without a package.json change is
#                                                                          a separate failure mode worth a separate hook if needed)
# - Anything else                                                       → silent allow

set -euo pipefail

if [ "${BUMP_AUTHORISATION_GUARD:-on}" = "off" ]; then
  exit 0
fi

emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" = "Bash" ] || exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
[ -z "$CMD" ] && exit 0

# Filter to `npm version <something>` only. Match `npm version` (with any
# trailing args / flags) but NOT `npm install` / `npm test` / `npm publish`
# / `npm run version-bump` (project-defined script) etc. The `\bnpm\b`
# anchor + literal `version` token keeps the filter tight.
if ! echo "$CMD" | grep -qE '\bnpm\b[[:space:]]+(--[A-Za-z0-9=._-]+[[:space:]]+)*version\b'; then
  exit 0
fi

# Echo / shell-string false positive — `echo "npm version 0.4.0"` shouldn't
# fire. If the entire command is a shell builtin or a string literal,
# skip. Conservative heuristic: command must START with `npm` (after any
# env-var prefix). Allow leading `VAR=val ` env-var prefixes.
STRIPPED=$(echo "$CMD" | sed -E 's/^([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)+//')
case "$STRIPPED" in
  npm[[:space:]]*) ;;
  *) exit 0 ;;
esac

# Authorisation check — `VERSION_BUMP_AUTHORISED=1` as an env-var prefix
# on the same command line. Tolerant of single quotes, double quotes,
# multiple env vars, and surrounding whitespace.
if echo "$CMD" | grep -qE '(^|[[:space:]])VERSION_BUMP_AUTHORISED=(1|true|yes|on)([[:space:]]|$)'; then
  exit 0
fi

# --- DENY ---
emit_deny "[BLOCKED] \`npm version\` without explicit authorisation.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

  Versioning is release-time, not per-PR. The user controls when bumps
  happen. To run \`npm version <X>\`, **the user must explicitly authorise
  this specific bump in the conversation**, then prefix the command with
  the in-band marker:

      VERSION_BUMP_AUTHORISED=1 npm version patch --no-git-tag-version
      VERSION_BUMP_AUTHORISED=1 npm version 0.4.0

  The marker travels with the command — auditable in git log, copy-
  pasteable from the user's message. Don't set the env var globally;
  inline it on the bump command only.

  If you're authoring a PR / fix-up / review-followup commit:
  do NOT bump. The branch's existing version (or main's) is the version.
  Reviewers will refresh the version at release time.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Command: ${CMD}

The command attempts to bump package.json's version without the
\`VERSION_BUMP_AUTHORISED=1\` in-band marker. Per the user directive
'no version bumps unless the user explicitly says so' (2026-05-06,
captured in memory/feedback_no_version_bumps.md), every bump must be
deliberately and inline-authorised.

──────────────────────────────────────────────────────────────────
If the user already authorised — read this:
──────────────────────────────────────────────────────────────────
Re-issue with the prefix on the same line. The hook checks the bash
command itself, not the conversation transcript. The marker is the
proof; without it the hook denies.

References:
  skills/contributing-to-element-interactions/SKILL.md §\"No version bumps without explicit authorisation\"
  memory/feedback_no_version_bumps.md (user's directive)

Escape hatch (rare; e.g. release-script automation that already proved
authorisation upstream): set BUMP_AUTHORISATION_GUARD=off in the parent
shell that runs the bash command."
exit 0
