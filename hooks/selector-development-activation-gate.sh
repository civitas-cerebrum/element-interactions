#!/bin/bash
# selector-development-activation-gate.sh — workspace-shape gate for
#                                            selector-development frontend edits.
#
# Hook    : PreToolUse:Edit|Write
# Mode    : DENY (when filtered file is a frontend source path AND workspace is misshaped)
# State   : reads workspace layout (no writes)
# Env     : WORKSPACE_ROOT (defaults to git toplevel of cwd)
#
# Rule
# ----
# If the tool is Edit|Write AND file_path is a frontend source path under the workspace
# (extensions: .tsx .jsx .vue .svelte .html .htm), the workspace MUST contain BOTH:
#   1. A frontend project marker — package.json with a known framework dep
#      (react|vue|svelte|@angular/core|solid-js|preact|lit), AND
#   2. A tests/e2e/ directory with at least one *.spec.ts file.
#
# .ts/.js are accepted only when the path lives under /src/ /app/ /pages/ /components/.

set -euo pipefail

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // empty')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

case "$tool_name" in Edit|Write) ;; *) exit 0 ;; esac

case "$file_path" in
  *.tsx|*.jsx|*.vue|*.svelte|*.html|*.htm) ;;
  *.ts|*.js)
    case "$file_path" in */src/*|*/app/*|*/pages/*|*/components/*) ;; *) exit 0 ;; esac
    ;;
  *) exit 0 ;;
esac

ws="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")}"

# Frontend marker check
fe_present=0
if [ -f "$ws/package.json" ]; then
  if jq -e '(.dependencies // {}) + (.devDependencies // {}) | has("react") or has("vue") or has("svelte") or has("@angular/core") or has("solid-js") or has("preact") or has("lit")' "$ws/package.json" >/dev/null 2>&1; then
    fe_present=1
  fi
fi

# Tests presence check
tests_present=0
if [ -d "$ws/tests/e2e" ]; then
  if find "$ws/tests/e2e" -maxdepth 4 -name '*.spec.ts' | head -n 1 | grep -q . ; then
    tests_present=1
  fi
fi

if [ "$fe_present" -eq 1 ] && [ "$tests_present" -eq 1 ]; then
  exit 0
fi

reason=""
if [ "$fe_present" -eq 0 ]; then
  reason="frontend source not present (no framework dep in package.json under $ws)"
elif [ "$tests_present" -eq 0 ]; then
  reason="tests not present (no tests/e2e/*.spec.ts under $ws)"
fi

cat <<EOF
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "selector-development-activation-gate: ${reason}. selector-development requires test work to live in the same project as the frontend source."
  }
}
EOF
exit 0
