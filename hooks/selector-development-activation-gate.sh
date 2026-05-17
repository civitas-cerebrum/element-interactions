#!/bin/bash
# selector-development-activation-gate.sh — workspace-shape gate for
#                                            selector-development frontend edits.
#
# Hook    : PreToolUse:Edit|Write
# Mode    : DENY (when a selector-development scope is in flight AND the
#                 workspace lacks the frontend marker — the case where the
#                 pipeline cannot do its job; that's why it's a hard block)
# Mode    : WARN (when a selector-development scope is in flight AND the
#                 workspace has frontend source but no tests/e2e/*.spec.ts —
#                 the pipeline can still write the attribute; landing the
#                 corresponding test is the human's follow-up)
# Mode    : silent allow (when no .current-scope sentinel exists — the
#                 selector-development pipeline isn't running; this hook
#                 has no opinion on edits made outside the pipeline)
# State   : reads tests/e2e/.selector-development/.current-scope (sentinel)
#           and workspace layout (no writes)
# Env     : WORKSPACE_ROOT (defaults to git toplevel of cwd)
#           CIVITAS_DISABLE_SELECTOR_DEVELOPMENT=1 disables the hook
#           (kill-switch for consumers who never use this workflow)
#
# Rule
# ----
# Only fires when a selector-development scope is in flight (the
# pipeline-stepper has written a .current-scope sentinel). Outside the
# pipeline, this hook is silent — the orchestrator's normal Edit/Write
# calls to frontend source pass through unchanged.
#
# Inside the pipeline, on frontend source paths (extensions: .tsx .jsx
# .vue .svelte .html .htm, plus .ts/.js under /src/ /app/ /pages/
# /components/), the workspace MUST contain BOTH:
#   1. A frontend project marker — package.json with a known framework
#      dep (react|vue|svelte|@angular/core|solid-js|preact|lit), AND
#   2. A tests/e2e/ directory with at least one *.spec.ts file.
#
# Missing the frontend marker → DENY (the pipeline cannot proceed —
# there is no frontend source to add a selector to).
# Missing tests/e2e/*.spec.ts → WARN (the pipeline can land the
# attribute; the consumer is expected to author the matching test as
# the next step of their workflow).

set -euo pipefail

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name // empty')
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

case "$tool_name" in Edit|Write) ;; *) exit 0 ;; esac

# Kill-switch for consumers who never use selector-development.
if [ "${CIVITAS_DISABLE_SELECTOR_DEVELOPMENT:-0}" = "1" ]; then
  exit 0
fi

case "$file_path" in
  *.tsx|*.jsx|*.vue|*.svelte|*.html|*.htm) ;;
  *.ts|*.js)
    case "$file_path" in */src/*|*/app/*|*/pages/*|*/components/*) ;; *) exit 0 ;; esac
    ;;
  *) exit 0 ;;
esac

ws="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")}"

# Sentinel gate: only fire when a selector-development scope is in
# flight. The pipeline-stepper writes .current-scope on scope-init and
# clears it on commit. Without it, every frontend edit is the
# orchestrator's normal authoring work — this hook has no opinion.
if [ ! -f "$ws/tests/e2e/.selector-development/.current-scope" ]; then
  exit 0
fi

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

# Missing the frontend marker is a hard block — the pipeline literally
# has no source to write a selector into. DENY.
if [ "$fe_present" -eq 0 ]; then
  cat <<EOF
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "selector-development-activation-gate: frontend source not present (no framework dep in package.json under ${ws}). selector-development requires a frontend project to add inert selectors to. If this consumer doesn't use selector-development, disable the hook with CIVITAS_DISABLE_SELECTOR_DEVELOPMENT=1."
  }
}
EOF
  exit 0
fi

# Missing tests/e2e/*.spec.ts is the friendlier case — the pipeline
# can still land the attribute; the consumer is expected to author
# the matching test as their next step. WARN, don't DENY.
if [ "$tests_present" -eq 0 ]; then
  jq -n --arg ws "$ws" '{
    "systemMessage": ("[WARN] selector-development-activation-gate: tests/e2e/*.spec.ts not yet present under " + $ws + ". The pipeline will land the inert attribute, but the matching test is the human follow-up — without it the selector has no consumer and visual-diff verification will not cover this edit. Add tests/e2e/<journey>.spec.ts that uses the new selector before commit."),
    "suppressOutput": false
  }'
  exit 0
fi

exit 0
