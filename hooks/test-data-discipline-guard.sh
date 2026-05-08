#!/bin/bash
# test-data-discipline-guard.sh — enforce two test-data hygiene rules:
#   (1) Project secrets MUST live in `.env` and load via `process.env.X` —
#       no hardcoded credentials, API keys, tokens, or bearer strings inside
#       a spec file.
#   (2) Test-data variables (URLs, accounts, magic strings) SHOULD be
#       centralised in a single class / module — no scattered top-level
#       `const NAME = "literal"` declarations across spec files.
#
# Hook    : PreToolUse:Edit|Write|MultiEdit
# Scope   : files matching `tests/.*\.(spec|test)\.(t|j)s$` only.
# Mode    : DENY for rule (1) (hardcoded secrets are a security concern,
#           never opt-in). WARN for rule (2) (centralisation is a
#           maintainability concern, agents may have a justified
#           one-off).
# State   : none
# Env     : TEST_DATA_DISCIPLINE_GUARD
#             unset / "deny" / "on"  → DENY+WARN as documented above
#             "warn"                 → DOWNGRADE secrets-deny to a warn
#                                       (escape hatch for legacy suites
#                                       being incrementally cleaned up)
#             "off"                  → silent allow (manual escape hatch)
#
# Allow path:
# - Any line containing `process.env.` cancels the hardcoded-secret check
#   on that line (the literal there is treated as a fallback / default).
# - Imports / re-exports of a centralised data module bypass rule (2):
#     import { TestData } from '...'
#     import * as TestData from '...'
#     export { TestData } from '...'
#
# Deny / warn payload follows the standard hookSpecificOutput shape used
# by the rest of this package's PreToolUse guards.

set -euo pipefail

# Resolve jq: prefer the binary bundled with the hook install, fall back to
# system jq for in-repo testing before postinstall has run.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

MODE=$(printf '%s' "${TEST_DATA_DISCIPLINE_GUARD:-deny}" | tr '[:upper:]' '[:lower:]')
case "$MODE" in
  off)        exit 0 ;;
  warn)       ;;
  deny|on|"") MODE="deny" ;;
  *)          MODE="deny" ;;
esac

emit_deny() {
  "$JQ" -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

emit_warn() {
  "$JQ" -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null)

case "$TOOL_NAME" in
  Write|Edit|MultiEdit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // ""' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0

# Filter to spec / test files only. Match by path suffix so the rule applies
# regardless of the project's `tests/` directory layout (`tests/`, `tests/e2e`,
# `__tests__`, etc.).
if ! echo "$FILE_PATH" | grep -qE '\.(spec|test)\.(ts|js|mjs|cjs|tsx|jsx)$'; then
  exit 0
fi

# Collect the candidate text we are about to write.
NEW_TEXT=""
case "$TOOL_NAME" in
  Write)
    NEW_TEXT=$(echo "$INPUT" | "$JQ" -r '.tool_input.content // ""' 2>/dev/null)
    ;;
  Edit)
    NEW_TEXT=$(echo "$INPUT" | "$JQ" -r '.tool_input.new_string // ""' 2>/dev/null)
    ;;
  MultiEdit)
    NEW_TEXT=$(echo "$INPUT" | "$JQ" -r '[.tool_input.edits[]?.new_string] | join("\n")' 2>/dev/null)
    ;;
esac

[ -z "$NEW_TEXT" ] && exit 0

# --- Rule 1: hardcoded secrets ---
# Match `<secret-keyword> [: =] "literal"` where the secret keyword names a
# credential-shaped variable / property and the literal is non-empty. The
# rule covers the canonical names (password, passwd, pwd, api_key, apiKey,
# secret, token, bearer, access_key, accessKey, auth) on either side of
# either `=` (assignment) or `:` (object literal / type annotation).
SECRET_KEYWORDS='password|passwd|pwd|api[_-]?key|secret|token|bearer|access[_-]?key|auth'
SECRET_REGEX="(^|[^A-Za-z0-9_])($SECRET_KEYWORDS)[[:space:]]*[:=][[:space:]]*[\"'][^\"']{1,}[\"']"

# Lines matching the secret pattern that DON'T also reference process.env.
OFFENDING_SECRETS=$(printf '%s' "$NEW_TEXT" \
  | grep -niE "$SECRET_REGEX" \
  | grep -viE 'process\.env\.' \
  || true)

if [ -n "$OFFENDING_SECRETS" ]; then
  REASON=$(printf '%s\n' \
    "Hardcoded credential detected in spec file: $FILE_PATH" \
    "" \
    "Project secrets MUST live in .env and load via \`process.env.<NAME>\` — never as literals in tests." \
    "" \
    "Offending lines:" \
    "$OFFENDING_SECRETS" \
    "" \
    "Fix:" \
    "  1. Move the literal to .env (gitignored)." \
    "  2. Read it in the spec via \`process.env.<NAME>\` (loaded by your test runner / dotenv)." \
    "  3. Reference the env var in the test, not the literal." \
    "" \
    "Escape hatch (legacy suites only): TEST_DATA_DISCIPLINE_GUARD=warn|off")

  if [ "$MODE" = "deny" ]; then
    emit_deny "$REASON"
    exit 0
  else
    emit_warn "$REASON"
    # warn-mode: continue to centralisation check; do not return early.
  fi
fi

# --- Rule 2: top-level magic constants outside a centralised data module ---
# Heuristic: top-level `const NAME = "literal"` (uppercase identifier, single
# string literal value) outside imports. These are the scattered test-data
# constants the rule asks to centralise. We never DENY this (centralisation
# is a maintainability call, not a security one) — always WARN.
#
# Allowlist: if the file imports from a centralised test-data module, the
# author is already on the right path — skip the warn.
if printf '%s' "$NEW_TEXT" \
  | grep -qE "^[[:space:]]*(import|export)[[:space:]].*['\"]([^'\"]*\b(test-data|testData|fixtures?|constants?)\b[^'\"]*)['\"]"; then
  exit 0
fi

OFFENDING_CONSTANTS=$(printf '%s' "$NEW_TEXT" \
  | grep -nE '^[[:space:]]*(export[[:space:]]+)?(const|let|var)[[:space:]]+[A-Z][A-Z0-9_]+[[:space:]]*=[[:space:]]*["'\''][^"'\'']*["'\'']' \
  || true)

if [ -n "$OFFENDING_CONSTANTS" ]; then
  WARN_MSG=$(printf '%s\n' \
    "[test-data-discipline-guard] Top-level magic constants detected in $FILE_PATH:" \
    "$OFFENDING_CONSTANTS" \
    "" \
    "Centralise test-data variables in a single class / module (e.g. \`tests/fixtures/test-data.ts\`)" \
    "and import from there. Scattered top-level constants drift across spec files and resist refactor." \
    "" \
    "Escape hatch: TEST_DATA_DISCIPLINE_GUARD=off")
  emit_warn "$WARN_MSG"
fi

exit 0
