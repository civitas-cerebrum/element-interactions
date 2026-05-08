#!/bin/bash
# cases/19-selector-development-revert-on-stop.sh
# Test suite for selector-development-revert-on-stop hook.
# Covers: no scope, complete journal (visual_diff/commit), incomplete journal (mid-pipeline).

H="$HOOK_DIR/selector-development-revert-on-stop.sh"

tmpdir=""

setup_workspace() {
  tmpdir=$(mktemp -d)
  export WORKSPACE_ROOT="$tmpdir"
  mkdir -p "$tmpdir/tests/e2e/.selector-development"
}

teardown_workspace() {
  [ -n "$tmpdir" ] && rm -rf "$tmpdir"
  unset WORKSPACE_ROOT
}

trap 'teardown_workspace' EXIT

section "19 • selector-development-revert-on-stop"

# Case 1: no scope pointer → silent allow
setup_workspace
assert_allow "$H" "$(payload hook_event_name=Stop)" "no scope pointer → silent allow"
teardown_workspace

# Case 2: complete journal (last step = visual_diff) → silent allow
setup_workspace
echo "submit-button" > "$tmpdir/tests/e2e/.selector-development/.current-scope"
receipt="$tmpdir/tests/e2e/.selector-development/submit-button.receipt.json"
cat > "$receipt" << 'EOF'
{
  "scope": "submit-button",
  "files": ["selectors.json"],
  "steps": [
    {"name": "capture_baseline", "status": "pass"},
    {"name": "generate_initial", "status": "pass"},
    {"name": "patch_applied", "status": "pass"},
    {"name": "visual_diff", "status": "pass"}
  ]
}
EOF
assert_allow "$H" "$(payload hook_event_name=Stop)" "complete journal (last = visual_diff) → silent allow"
teardown_workspace

# Case 3: complete journal (last step = commit) → silent allow
setup_workspace
echo "button-group" > "$tmpdir/tests/e2e/.selector-development/.current-scope"
receipt="$tmpdir/tests/e2e/.selector-development/button-group.receipt.json"
cat > "$receipt" << 'EOF'
{
  "scope": "button-group",
  "files": ["locators.json"],
  "steps": [
    {"name": "capture_baseline", "status": "pass"},
    {"name": "generate_initial", "status": "pass"},
    {"name": "patch_applied", "status": "pass"},
    {"name": "visual_diff", "status": "pass"},
    {"name": "commit", "status": "pass"}
  ]
}
EOF
assert_allow "$H" "$(payload hook_event_name=Stop)" "complete journal (last = commit) → silent allow"
teardown_workspace

# Case 4: incomplete journal (last step = patch_applied) → WARN with recovery hint
setup_workspace
echo "login-form" > "$tmpdir/tests/e2e/.selector-development/.current-scope"
receipt="$tmpdir/tests/e2e/.selector-development/login-form.receipt.json"
cat > "$receipt" << 'EOF'
{
  "scope": "login-form",
  "files": ["selectors.json", "auth.json"],
  "steps": [
    {"name": "capture_baseline", "status": "pass"},
    {"name": "generate_initial", "status": "pass"},
    {"name": "patch_applied", "status": "pass"}
  ]
}
EOF
assert_warn "$H" "$(payload hook_event_name=Stop)" "incomplete (last = patch_applied) → WARN" "incomplete patch"
teardown_workspace

# Case 5: incomplete journal (last step = generate_initial) → WARN with recovery hint
setup_workspace
echo "search-box" > "$tmpdir/tests/e2e/.selector-development/.current-scope"
receipt="$tmpdir/tests/e2e/.selector-development/search-box.receipt.json"
cat > "$receipt" << 'EOF'
{
  "scope": "search-box",
  "files": ["selectors.json"],
  "steps": [
    {"name": "capture_baseline", "status": "pass"},
    {"name": "generate_initial", "status": "pass"}
  ]
}
EOF
assert_warn "$H" "$(payload hook_event_name=Stop)" "incomplete (last = generate_initial) → WARN" "incomplete patch"
teardown_workspace

# Case 6: scope pointer exists but no receipt → silent allow (edge case)
setup_workspace
echo "orphan-scope" > "$tmpdir/tests/e2e/.selector-development/.current-scope"
# No receipt file created
assert_allow "$H" "$(payload hook_event_name=Stop)" "scope exists but no receipt → silent allow"
teardown_workspace
