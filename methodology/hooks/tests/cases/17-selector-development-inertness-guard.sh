#!/bin/bash
# 17-selector-development-inertness-guard.sh
# Tests for methodology/hooks/selector-development-inertness-guard.sh
#
# Hook: PreToolUse:Edit|Write
# Mode:
#   - silent allow when no .current-scope sentinel exists (the
#     pipeline isn't running — this hook has no opinion on frontend
#     edits outside the selector-development workflow)
#   - silent allow when CIVITAS_DISABLE_SELECTOR_DEVELOPMENT=1
#   - DENY when scope is in flight AND the frontend file change is not
#     a single-attribute additive edit (the inertness contract)

H="$HOOK_DIR/selector-development-inertness-guard.sh"

# Fixture paths
FIX="$HOOK_DIR/tests/lib-fixtures/selector-development"

# ---------------------------------------------------------------------------
# Shared workspace setup
# ---------------------------------------------------------------------------
# The inertness-guard only fires when a selector-development scope is
# in flight (sentinel at <ws>/tests/e2e/.selector-development/.current-scope).
# Every "DENY" test below assumes the pipeline is running, so we seed a
# scope-active workspace once at the top of the file and point
# WORKSPACE_ROOT at it. Specific sections that test the no-scope path
# unset / overwrite WORKSPACE_ROOT inline.
INERT_WS=$(mktemp -d)
mkdir -p "$INERT_WS/tests/e2e/.selector-development"
printf 'test-scope\n' > "$INERT_WS/tests/e2e/.selector-development/.current-scope"
export WORKSPACE_ROOT="$INERT_WS"

# ---------------------------------------------------------------------------
# Helper: read fixture file content
# ---------------------------------------------------------------------------
baseline_content=$(cat "$FIX/jsx-baseline.tsx")
additive_content=$(cat "$FIX/jsx-additive.tsx")
structural_content=$(cat "$FIX/jsx-structural-change.tsx")
classname_content=$(cat "$FIX/jsx-classname-changed.tsx")

# ---------------------------------------------------------------------------
# Section 1 — additive JSX Write → ALLOW
# ---------------------------------------------------------------------------
section "inertness-guard: additive jsx → ALLOW"

# Pre-stage the baseline on disk at /tmp/inertness-x.tsx
printf '%s' "$baseline_content" > /tmp/inertness-x.tsx

export CONVENTION_OVERRIDE=data-testid
assert_allow "$H" \
  "$(payload tool_name=Write file_path=/tmp/inertness-x.tsx content="$additive_content")" \
  "additive Write .tsx → silent allow"
unset CONVENTION_OVERRIDE

# ---------------------------------------------------------------------------
# Section 2 — structural change → DENY
# ---------------------------------------------------------------------------
section "inertness-guard: structural change → DENY"

printf '%s' "$baseline_content" > /tmp/inertness-x.tsx

export CONVENTION_OVERRIDE=data-testid
assert_deny "$H" \
  "$(payload tool_name=Write file_path=/tmp/inertness-x.tsx content="$structural_content")" \
  "structural Write .tsx → DENY" \
  "structural-change"
unset CONVENTION_OVERRIDE

# ---------------------------------------------------------------------------
# Section 3 — className change → DENY
# ---------------------------------------------------------------------------
section "inertness-guard: classname change → DENY"

printf '%s' "$baseline_content" > /tmp/inertness-x.tsx

export CONVENTION_OVERRIDE=data-testid
assert_deny "$H" \
  "$(payload tool_name=Write file_path=/tmp/inertness-x.tsx content="$classname_content")" \
  "classname-change Write .tsx → DENY" \
  "modifies-existing-attribute"
unset CONVENTION_OVERRIDE

# ---------------------------------------------------------------------------
# Section 4 — wrong attribute name → DENY
# ---------------------------------------------------------------------------
section "inertness-guard: wrong attribute name → DENY"

printf '%s' "$baseline_content" > /tmp/inertness-x.tsx

# additive_content uses data-testid; convention is data-cy → wrong-attribute-name
export CONVENTION_OVERRIDE=data-cy
assert_deny "$H" \
  "$(payload tool_name=Write file_path=/tmp/inertness-x.tsx content="$additive_content")" \
  "wrong-attribute Write .tsx → DENY" \
  "wrong-attribute-name"
unset CONVENTION_OVERRIDE

# ---------------------------------------------------------------------------
# Section 5 — non-frontend file → silent ALLOW
# ---------------------------------------------------------------------------
section "inertness-guard: non-frontend file → silent ALLOW"

export CONVENTION_OVERRIDE=data-testid
assert_allow "$H" \
  "$(payload tool_name=Write file_path=/tmp/note.md content="some note")" \
  "Write .md → silent allow"
unset CONVENTION_OVERRIDE

# ---------------------------------------------------------------------------
# Section 6 — Edit (old_string → new_string) flow → ALLOW
# ---------------------------------------------------------------------------
section "inertness-guard: Edit (old→new replacement) → ALLOW"

printf '%s' "$baseline_content" > /tmp/inertness-y.tsx

# The Edit replaces the button line without data-testid with one that has it.
old_line='  return <button className="btn-primary" onClick={onClick}>{label}</button>;'
new_line='  return <button className="btn-primary" onClick={onClick} data-testid="submit-button">{label}</button>;'

export CONVENTION_OVERRIDE=data-testid
assert_allow "$H" \
  "$(payload tool_name=Edit file_path=/tmp/inertness-y.tsx old_string="$old_line" new_string="$new_line")" \
  "additive Edit .tsx → silent allow"
unset CONVENTION_OVERRIDE

# ---------------------------------------------------------------------------
# Section 7 — new-file Write (file not on disk) → silent ALLOW
# ---------------------------------------------------------------------------
section "inertness-guard: new-file Write → silent ALLOW"

rm -f /tmp/inertness-new.tsx

export CONVENTION_OVERRIDE=data-testid
assert_allow "$H" \
  "$(payload tool_name=Write file_path=/tmp/inertness-new.tsx content="$additive_content")" \
  "new-file Write (no on-disk before) → silent allow"
unset CONVENTION_OVERRIDE

# ---------------------------------------------------------------------------
# Section 8 — Bash / Read tool → silent ALLOW
# ---------------------------------------------------------------------------
section "inertness-guard: Bash / Read tool → silent ALLOW"

assert_allow "$H" \
  "$(payload tool_name=Bash command="echo hello")" \
  "Bash tool → silent allow"

assert_allow "$H" \
  "$(payload tool_name=Read file_path=/tmp/inertness-x.tsx)" \
  "Read tool → silent allow"

# ---------------------------------------------------------------------------
# Section 9 — C2: HOOK_DIR/lib path resolution works even when WORKSPACE_ROOT
#              points at a temp dir with no methodology/hooks/lib/ subdirectory
#
# In a consumer workspace the hook lives at ~/.claude/hooks/ which has its own
# lib/ sibling; $ws/methodology/hooks/lib won't exist. We simulate this by setting
# WORKSPACE_ROOT to a fresh temp dir that has no methodology/hooks/lib/, then confirming
# the hook still resolves the validator via HOOK_DIR/lib.
# ---------------------------------------------------------------------------
section "inertness-guard: C2 — HOOK_DIR/lib used when WORKSPACE_ROOT has no methodology/hooks/lib"

_tmp_ws=$(mktemp -d)
# Deliberately do NOT create $_tmp_ws/methodology/hooks/lib — simulates consumer workspace
# Seed .current-scope so the gate fires (otherwise no-scope silent-allow
# would bypass the validator entirely and the test wouldn't exercise
# its intended concern).
mkdir -p "$_tmp_ws/tests/e2e/.selector-development"
printf 'test-scope\n' > "$_tmp_ws/tests/e2e/.selector-development/.current-scope"

printf '%s' "$baseline_content" > /tmp/inertness-c2.tsx

export CONVENTION_OVERRIDE=data-testid
export WORKSPACE_ROOT="$_tmp_ws"
assert_allow "$H" \
  "$(payload tool_name=Write file_path=/tmp/inertness-c2.tsx content="$additive_content")" \
  "WORKSPACE_ROOT has no methodology/hooks/lib → validator resolves via HOOK_DIR/lib → ALLOW"
unset CONVENTION_OVERRIDE
unset WORKSPACE_ROOT
rm -rf "$_tmp_ws"

# Restore the shared scope-active workspace for any tests that follow.
export WORKSPACE_ROOT="$INERT_WS"

# ---------------------------------------------------------------------------
# Section 10 — no selector-development scope in flight → silent ALLOW
# ---------------------------------------------------------------------------
# Without a .current-scope sentinel the inertness contract does NOT
# apply — frontend edits go through unchanged. This is the friendly-
# default for any consumer who isn't using selector-development.
section "inertness-guard: no scope in flight → silent ALLOW"

_no_scope_ws=$(mktemp -d)
# Deliberately NO .current-scope under tests/e2e/.selector-development/
printf '%s' "$baseline_content" > /tmp/inertness-noscope.tsx

export CONVENTION_OVERRIDE=data-testid
export WORKSPACE_ROOT="$_no_scope_ws"

# A diff that WOULD fail the inertness contract (structural change) —
# but with no scope active, the gate is silent.
assert_allow "$H" \
  "$(payload tool_name=Write file_path=/tmp/inertness-noscope.tsx content="$structural_content")" \
  "no scope: structural Write → silent ALLOW (contract doesn't apply)"

unset CONVENTION_OVERRIDE
unset WORKSPACE_ROOT
rm -rf "$_no_scope_ws"

# Restore the shared scope-active workspace.
export WORKSPACE_ROOT="$INERT_WS"

# ---------------------------------------------------------------------------
# Section 11 — CIVITAS_DISABLE_SELECTOR_DEVELOPMENT=1 → silent ALLOW
# ---------------------------------------------------------------------------
# Kill-switch for consumers who never use this workflow. The hook
# yields regardless of scope state or inertness contract.
section "inertness-guard: CIVITAS_DISABLE_SELECTOR_DEVELOPMENT=1 → silent ALLOW"

printf '%s' "$baseline_content" > /tmp/inertness-kill.tsx

export CONVENTION_OVERRIDE=data-testid
CIVITAS_DISABLE_SELECTOR_DEVELOPMENT=1 \
  assert_allow "$H" \
    "$(payload tool_name=Write file_path=/tmp/inertness-kill.tsx content="$structural_content")" \
    "kill-switch on + scope in flight + bad diff → silent ALLOW"
unset CONVENTION_OVERRIDE

# Final cleanup
unset WORKSPACE_ROOT
rm -rf "$INERT_WS"
