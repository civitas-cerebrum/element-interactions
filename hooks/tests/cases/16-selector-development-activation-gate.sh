#!/bin/bash
# 16-selector-development-activation-gate.sh
# Tests for hooks/selector-development-activation-gate.sh
#
# Hook: PreToolUse:Edit|Write
# Mode:
#   - silent allow when no .current-scope sentinel exists (the
#     selector-development pipeline isn't running — this hook has no
#     opinion on edits made outside the pipeline)
#   - silent allow when CIVITAS_DISABLE_SELECTOR_DEVELOPMENT=1
#   - DENY when scope is in flight AND the workspace lacks a frontend
#     framework dep (the pipeline has no source to edit)
#   - WARN when scope is in flight AND the workspace has frontend source
#     but no tests/e2e/*.spec.ts (the pipeline can still land the
#     attribute; the matching test is the human follow-up)
#   - ALLOW when scope is in flight AND both halves are present

H="$HOOK_DIR/selector-development-activation-gate.sh"

# ---------------------------------------------------------------------------
# Workspace builders (each seeds .current-scope by default so the gate
# fires — outside-the-pipeline behaviour is exercised in its own
# section below).
# ---------------------------------------------------------------------------

# _seed_scope — drop a .current-scope sentinel under <ws>/tests/e2e/.selector-development/
# so the activation-gate treats the workspace as a pipeline-in-flight.
_seed_scope() {
  local ws="$1"
  mkdir -p "$ws/tests/e2e/.selector-development"
  printf 'test-scope\n' > "$ws/tests/e2e/.selector-development/.current-scope"
}

# _make_full_ws — package.json (react dep) + src/X.tsx + tests/e2e/x.spec.ts + scope
_make_full_ws() {
  local ws
  ws=$(mktemp -d)
  printf '{"devDependencies":{"react":"^18.0.0"}}\n' > "$ws/package.json"
  mkdir -p "$ws/src"
  printf '// placeholder\n' > "$ws/src/X.tsx"
  mkdir -p "$ws/tests/e2e"
  printf '// spec\n' > "$ws/tests/e2e/x.spec.ts"
  _seed_scope "$ws"
  echo "$ws"
}

# _make_frontend_only_ws — package.json (react) + src/X.tsx, NO tests/e2e + scope
_make_frontend_only_ws() {
  local ws
  ws=$(mktemp -d)
  printf '{"devDependencies":{"react":"^18.0.0"}}\n' > "$ws/package.json"
  mkdir -p "$ws/src"
  printf '// placeholder\n' > "$ws/src/X.tsx"
  _seed_scope "$ws"
  echo "$ws"
}

# _make_tests_only_ws — tests/e2e/x.spec.ts + package.json without framework dep + scope
_make_tests_only_ws() {
  local ws
  ws=$(mktemp -d)
  printf '{"devDependencies":{"typescript":"^5.0.0"}}\n' > "$ws/package.json"
  mkdir -p "$ws/tests/e2e"
  printf '// spec\n' > "$ws/tests/e2e/x.spec.ts"
  _seed_scope "$ws"
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
# Section 2 — frontend-only workspace (no tests/e2e) → WARN
# ---------------------------------------------------------------------------
# The pipeline can still land the inert attribute; the matching test is
# the human follow-up. WARN flags the gap in the audit trail without
# blocking the pipeline.
section "selector-development-activation-gate: frontend-only → WARN"

WS=$(_make_frontend_only_ws)
export WORKSPACE_ROOT="$WS"

assert_warn "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/X.tsx")" \
  "frontend-only: Edit .tsx → WARN" \
  "tests/e2e/*.spec.ts not yet present"

assert_warn "$H" \
  "$(payload tool_name=Write file_path="$WS/src/Button.tsx")" \
  "frontend-only: Write .tsx → WARN" \
  "tests/e2e/*.spec.ts not yet present"

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

# ---------------------------------------------------------------------------
# Section 6 — no selector-development scope in flight → silent ALLOW
# ---------------------------------------------------------------------------
# Without a .current-scope sentinel the gate must NEVER fire — every
# frontend edit goes through. This is the friendly-default behaviour
# for any consumer who hasn't opted into selector-development.
section "selector-development-activation-gate: no scope in flight → silent ALLOW"

# Workspace without the sentinel (similar shape to _make_tests_only_ws
# but without _seed_scope — explicitly the "no scope" case).
WS=$(mktemp -d)
printf '{"devDependencies":{"typescript":"^5.0.0"}}\n' > "$WS/package.json"
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Write file_path="$WS/src/X.tsx")" \
  "no scope: Write .tsx → silent ALLOW (regardless of workspace shape)"

assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/App.vue")" \
  "no scope: Edit .vue → silent ALLOW"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 7 — kill-switch via env var → silent ALLOW (even with scope)
# ---------------------------------------------------------------------------
section "selector-development-activation-gate: CIVITAS_DISABLE_SELECTOR_DEVELOPMENT=1 → silent ALLOW"

# Workspace WITH scope + WITH the kill switch on. The gate must yield.
WS=$(_make_tests_only_ws)  # would normally DENY (frontend missing) with scope
export WORKSPACE_ROOT="$WS"

CIVITAS_DISABLE_SELECTOR_DEVELOPMENT=1 \
  assert_allow "$H" \
    "$(payload tool_name=Write file_path="$WS/src/X.tsx")" \
    "kill-switch enabled → silent ALLOW (even with scope in flight)"

unset WORKSPACE_ROOT
