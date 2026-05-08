#!/bin/bash
# selector-development-inertness-guard.sh — diff-shape validator.
#
# Hook    : PreToolUse:Edit|Write
# Mode    : DENY (when frontend file change is not a single-attribute additive edit)
# State   : reads tests/e2e/.selector-development/.detected-convention if present
# Env     : CONVENTION_OVERRIDE (overrides the cached convention; for tests)
#           WORKSPACE_ROOT (defaults to git toplevel of cwd)

set -uo pipefail

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // empty')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

case "$tool_name" in Edit|Write) ;; *) exit 0 ;; esac

# Extension filter — same set as activation-gate
case "$file_path" in
  *.tsx|*.jsx|*.vue|*.svelte|*.html|*.htm) ;;
  *.ts|*.js)
    case "$file_path" in */src/*|*/app/*|*/pages/*|*/components/*) ;; *) exit 0 ;; esac
    ;;
  *) exit 0 ;;
esac

ws="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")}"

# New-file Write: no inertness contract on creation.
if [ ! -f "$file_path" ]; then
  exit 0
fi

before_content=$(cat "$file_path")

# Compute after content from tool payload
if [ "$tool_name" = "Write" ]; then
  after_content=$(echo "$input" | jq -r '.tool_input.content // empty')
elif [ "$tool_name" = "Edit" ]; then
  old_string=$(echo "$input" | jq -r '.tool_input.old_string // empty')
  new_string=$(echo "$input" | jq -r '.tool_input.new_string // empty')
  # Apply the Edit's single-occurrence replacement via python3 (safe for arbitrary content).
  after_content=$(python3 -c "import sys, json
data = json.load(sys.stdin)
print(data['before'].replace(data['old'], data['new'], 1), end='')" <<<"$(jq -n \
    --arg before "$before_content" \
    --arg old "$old_string" \
    --arg new "$new_string" \
    '{before:$before, old:$old, new:$new}')")
fi

# Convention detection
convention="${CONVENTION_OVERRIDE:-}"
if [ -z "$convention" ]; then
  if [ -f "$ws/tests/e2e/.selector-development/.detected-convention" ]; then
    convention=$(cat "$ws/tests/e2e/.selector-development/.detected-convention")
  else
    convention="data-testid"
  fi
fi

# Run validator via temp files to avoid heredoc-with-python quoting issues
before_tmp=$(mktemp)
after_tmp=$(mktemp)
trap 'rm -f "$before_tmp" "$after_tmp"' EXIT

printf '%s' "$before_content" > "$before_tmp"
printf '%s' "$after_content"  > "$after_tmp"

result=$(node -e "
const v = require('$ws/hooks/lib/selector-diff-validator.js');
const fs = require('fs');
const r = v.validate({
  before: fs.readFileSync(process.argv[1], 'utf8'),
  after:  fs.readFileSync(process.argv[2], 'utf8'),
  expectedAttr: process.argv[3],
  filePath: process.argv[4]
});
process.stdout.write(JSON.stringify(r));
" "$before_tmp" "$after_tmp" "$convention" "$file_path" 2>/dev/null) \
  || result='{"ok":false,"reason":"node-error","detail":"validator failed to run"}'

ok=$(echo "$result" | jq -r '.ok')
if [ "$ok" = "true" ]; then
  exit 0
fi

suffix="The only allowed edit is appending exactly one ${convention} attribute (kebab-case value) to one opening tag, with no other byte changes."
echo "$result" | jq -c \
  --arg sfx "$suffix" \
  '{hookSpecificOutput:{permissionDecision:"deny",permissionDecisionReason:("selector-development-inertness-guard: " + .reason + ". " + (.detail // "") + ". " + $sfx)}}'
exit 0
