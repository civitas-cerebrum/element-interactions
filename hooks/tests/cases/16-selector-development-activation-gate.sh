#!/bin/bash
# 16-selector-development-activation-gate.sh
# Tests for hooks/selector-development-activation-gate.sh
#
# Hook: PreToolUse:Edit|Write
# Mode: DENY when frontend-source path is targeted but workspace lacks
#       BOTH a framework dep in package.json AND a tests/e2e/*.spec.ts tree.

H="$HOOK_DIR/selector-development-activation-gate.sh"

# ---------------------------------------------------------------------------
# Workspace builders
# ---------------------------------------------------------------------------

# _make_full_ws — package.json (react dep) + src/X.tsx + tests/e2e/x.spec.ts
_make_full_ws() {
  local ws
  ws=$(mktemp -d)
  printf '{"devDependencies":{"react":"^18.0.0"}}\n' > "$ws/package.json"
  mkdir -p "$ws/src"
  printf '// placeholder\n' > "$ws/src/X.tsx"
  mkdir -p "$ws/tests/e2e"
  printf '// spec\n' > "$ws/tests/e2e/x.spec.ts"
  echo "$ws"
}

# _make_frontend_only_ws — package.json (react) + src/X.tsx, NO tests/e2e
_make_frontend_only_ws() {
  local ws
  ws=$(mktemp -d)
  printf '{"devDependencies":{"react":"^18.0.0"}}\n' > "$ws/package.json"
  mkdir -p "$ws/src"
  printf '// placeholder\n' > "$ws/src/X.tsx"
  echo "$ws"
}

# _make_tests_only_ws — tests/e2e/x.spec.ts + package.json without framework dep
_make_tests_only_ws() {
  local ws
  ws=$(mktemp -d)
  printf '{"devDependencies":{"typescript":"^5.0.0"}}\n' > "$ws/package.json"
  mkdir -p "$ws/tests/e2e"
  printf '// spec\n' > "$ws/tests/e2e/x.spec.ts"
  echo "$ws"
}

# ---------------------------------------------------------------------------
# Section 1 — full workspace (both halves present) → ALLOW frontend Edit
# ---------------------------------------------------------------------------
section "selector-development-activation-gate: full workspace → ALLOW"

WS=$(_make_full_ws)
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/X.tsx")" \
  "full workspace: Edit .tsx → ALLOW"

assert_allow "$H" \
  "$(payload tool_name=Write file_path="$WS/src/MyComp.jsx")" \
  "full workspace: Write .jsx → ALLOW"

assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/views/Home.vue")" \
  "full workspace: Edit .vue → ALLOW"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 2 — frontend-only workspace (no tests/e2e) → DENY with reason
# ---------------------------------------------------------------------------
section "selector-development-activation-gate: frontend-only → DENY"

WS=$(_make_frontend_only_ws)
export WORKSPACE_ROOT="$WS"

assert_deny "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/X.tsx")" \
  "frontend-only: Edit .tsx → DENY" \
  "tests not present"

assert_deny "$H" \
  "$(payload tool_name=Write file_path="$WS/src/Button.tsx")" \
  "frontend-only: Write .tsx → DENY" \
  "tests not present"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 3 — tests-only workspace (no framework dep) → DENY with reason
# ---------------------------------------------------------------------------
section "selector-development-activation-gate: tests-only → DENY"

WS=$(_make_tests_only_ws)
export WORKSPACE_ROOT="$WS"

assert_deny "$H" \
  "$(payload tool_name=Write file_path="$WS/src/X.tsx")" \
  "tests-only: Write .tsx → DENY" \
  "frontend source not present"

assert_deny "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/App.vue")" \
  "tests-only: Edit .vue → DENY" \
  "frontend source not present"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 4 — non-frontend file paths → silent ALLOW (even in bad workspace)
# ---------------------------------------------------------------------------
section "selector-development-activation-gate: non-frontend path → silent ALLOW"

WS=$(_make_frontend_only_ws)
export WORKSPACE_ROOT="$WS"

# Test spec file (under tests/) — not a frontend source path
assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/tests/e2e/login.spec.ts")" \
  "non-frontend: Edit spec.ts not in src → ALLOW"

# README
assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/README.md")" \
  "non-frontend: Edit README → ALLOW"

# .json config
assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/package.json")" \
  "non-frontend: Edit package.json → ALLOW"

# A .ts file that lives in tests/ (not /src/ /app/ /pages/ /components/)
assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/tests/helpers/utils.ts")" \
  "non-frontend: .ts in tests/ not a frontend src path → ALLOW"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 5 — tool-name filtering: Bash and Read → silent ALLOW
# ---------------------------------------------------------------------------
section "selector-development-activation-gate: tool-name filtering"

WS=$(_make_frontend_only_ws)
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="echo hello")" \
  "Bash tool → silent ALLOW"

assert_allow "$H" \
  "$(payload tool_name=Read file_path="$WS/src/X.tsx")" \
  "Read tool → silent ALLOW"

assert_allow "$H" \
  "$(payload tool_name=Agent description='some agent' prompt='do stuff')" \
  "Agent tool → silent ALLOW"

unset WORKSPACE_ROOT
