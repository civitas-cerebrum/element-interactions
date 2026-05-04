#!/bin/bash
# npm-install-foreground-scripts-hint.sh — surface --foreground-scripts hint
#
# Hook    : PreToolUse:Bash  (filters to `npm install` invocations only)
# Mode    : WARN (systemMessage) — never DENY. The hint is informational;
#           the install is allowed regardless.
# State   : per-cwd sentinel at <repo-or-cwd>/.civitas-fg-scripts-hinted to
#           avoid emitting the same hint on every successive install.
# Env     : NPM_FOREGROUND_SCRIPTS_HINT=off → silent allow (manual escape
#           hatch when the user has globally configured foreground-scripts
#           via npm config or .npmrc and finds the hint redundant).
#
# Rule
# ----
# When an agent runs `npm install` (with or without further args) in a
# project that depends on `@civitas-cerebrum/element-interactions`, AND
# the command does NOT pass `--foreground-scripts`, AND the hint hasn't
# already been shown for this CWD, emit a `systemMessage` recommending
# the flag. Otherwise silent allow.
#
# Why
# ---
# npm 7+ buffers postinstall stdout and discards it on success. This
# package's postinstall emits load-bearing notices (skills installed +
# "restart Claude Code", hooks registered, chromium fetched / failed)
# that an agent driving the install must see in its tool transcript or
# subsequent skill activations will run on stale state. Markdown alone in
# the README is insufficient — agents under context pressure won't read
# the README before running `npm install`. See issue #153.
#
# Canonical reference
# -------------------
# README.md §"📦 Installation"
# scripts/postinstall.js (the script whose output the flag surfaces)
#
# Failure → action
# ----------------
# - `npm install` AND project depends on element-interactions AND
#   --foreground-scripts absent AND not yet hinted in this CWD → WARN
# - --foreground-scripts present                                → silent allow
# - hint sentinel already exists for this CWD                   → silent allow
# - Project does not depend on element-interactions             → silent allow
# - Anything else                                               → silent allow

set -euo pipefail

if [ "${NPM_FOREGROUND_SCRIPTS_HINT:-on}" = "off" ]; then
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

# Filter to `npm install` (or `npm i` shorthand). Match either word at a
# command boundary so we don't fire on `npm run install-something`.
if ! echo "$CMD" | grep -qE '\bnpm[[:space:]]+(install|i)\b'; then
  exit 0
fi

# `--foreground-scripts` already present → silent allow.
if echo "$CMD" | grep -qE '(^|[[:space:]])--foreground-scripts(\b|=)'; then
  exit 0
fi

CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")

# Only fire when the project depends on element-interactions. Look for the
# package name in package.json — covers dependencies, devDependencies, and
# peerDependencies in one grep without a JSON parser dependency.
PKG_JSON="$REPO_ROOT/package.json"
[ -f "$PKG_JSON" ] || exit 0
if ! grep -qF '"@civitas-cerebrum/element-interactions"' "$PKG_JSON" 2>/dev/null; then
  exit 0
fi

# Per-CWD one-time hint. The sentinel is tiny and untracked (consumers
# should add it to .gitignore if they care; the suggestion is in the hint
# message). Removing the sentinel resets the hint, useful for testing.
SENTINEL="$REPO_ROOT/.civitas-fg-scripts-hinted"
if [ -f "$SENTINEL" ]; then
  exit 0
fi

# Best-effort sentinel write — never fail the hook on filesystem issues.
touch "$SENTINEL" 2>/dev/null || true

emit_warn "[WARN] \`npm install\` in a project that depends on @civitas-cerebrum/element-interactions, without --foreground-scripts.

npm 7+ buffers postinstall stdout and discards it on success. This package's postinstall emits load-bearing notices that you should see in the install transcript:

  - Skills installed to .claude/skills/ — \"restart Claude Code to pick it up\"
  - Harness hooks copied + registered in ~/.claude/settings.json
  - Chromium auto-fetched (or fail-loud warning if the probe missed)

Do this instead — pass the flag once:

  npm install --foreground-scripts

Or set it permanently for this project:

  echo 'foreground-scripts=true' >> .npmrc

Or globally:

  npm config set foreground-scripts true

This hint is shown once per project. The sentinel \`.civitas-fg-scripts-hinted\` was written at the repo root to suppress repeats. Delete it to re-enable.

Reference: README.md §\"📦 Installation\", scripts/postinstall.js, issue #153.

Escape hatch (silent for the rest of this session): set NPM_FOREGROUND_SCRIPTS_HINT=off in the environment."
exit 0
