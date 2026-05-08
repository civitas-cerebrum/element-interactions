#!/bin/bash
# 18-selector-development-pipeline-stepper.sh
# Tests for hooks/selector-development-pipeline-stepper.sh
#
# Hook: PreToolUse:Bash|Edit|Write  — deny if predecessor step not in journal as pass
#       PostToolUse:Bash|Edit|Write — append step entry to journal on success/fail

H="$HOOK_DIR/selector-development-pipeline-stepper.sh"

# ---------------------------------------------------------------------------
# Workspace builders
# ---------------------------------------------------------------------------

# _make_ws_no_scope — workspace with .selector-development dir but NO .current-scope
_make_ws_no_scope() {
  local ws
  ws=$(mktemp -d)
  mkdir -p "$ws/tests/e2e/.selector-development"
  mkdir -p "$ws/src"
  echo "$ws"
}

# _boot_state <scope> <mode> [additional steps as JSON array string]
# Creates a full workspace with .current-scope and an initialized receipt.
# Prints the workspace path.
_boot_state() {
  local scope="$1"
  local mode="${2:-jit}"
  local steps="${3:-[]}"
  local ws
  ws=$(mktemp -d)
  mkdir -p "$ws/tests/e2e/.selector-development"
  mkdir -p "$ws/src"
  printf '%s' "$scope" > "$ws/tests/e2e/.selector-development/.current-scope"
  jq -n \
    --arg schema_version "2" \
    --arg mode "$mode" \
    --arg scope "$scope" \
    --argjson steps "$steps" \
    '{
      schema_version: 2,
      mode: $mode,
      scope: $scope,
      git_diff_hash: null,
      attribute: { name: "data-testid", value: $scope },
      files: [],
      steps: $steps
    }' > "$ws/tests/e2e/.selector-development/${scope}.receipt.json"
  echo "$ws"
}

# _boot_state_with_hash <scope> <git_diff_hash> [steps]
# Like _boot_state but sets git_diff_hash in the receipt.
_boot_state_with_hash() {
  local scope="$1"
  local hash="$2"
  local steps="${3:-[]}"
  local ws
  ws=$(mktemp -d)
  mkdir -p "$ws/tests/e2e/.selector-development"
  mkdir -p "$ws/src"
  printf '%s' "$scope" > "$ws/tests/e2e/.selector-development/.current-scope"
  jq -n \
    --arg mode "jit" \
    --arg scope "$scope" \
    --arg hash "$hash" \
    --argjson steps "$steps" \
    '{
      schema_version: 2,
      mode: "jit",
      scope: $scope,
      git_diff_hash: $hash,
      attribute: { name: "data-testid", value: $scope },
      files: [],
      steps: $steps
    }' > "$ws/tests/e2e/.selector-development/${scope}.receipt.json"
  echo "$ws"
}

# _steps_json <name:status> [...] — emit a JSON array of step objects
_steps_json() {
  local arr="[]"
  for ns in "$@"; do
    local name="${ns%%:*}"
    local status="${ns#*:}"
    arr=$(jq -n \
      --argjson arr "$arr" \
      --arg name "$name" \
      --arg status "$status" \
      '$arr + [{name: $name, status: $status, ts: "2025-01-01T00:00:00Z"}]')
  done
  echo "$arr"
}

# ---------------------------------------------------------------------------
# Section 1 — no scope active → silent ALLOW (hook is inert)
# ---------------------------------------------------------------------------
section "pipeline-stepper: no scope active → silent ALLOW"

WS=$(_make_ws_no_scope)
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="playwright-cli screenshot /before/submit-button.png" hook_event_name=PreToolUse cwd="$WS")" \
  "no .current-scope: before_snapshot Bash → silent ALLOW"

assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/Button.tsx" hook_event_name=PreToolUse cwd="$WS")" \
  "no .current-scope: Edit .tsx → silent ALLOW"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 2 — scope active, initialized receipt, before_snapshot (step 1)
#             has no predecessor → ALLOW
# ---------------------------------------------------------------------------
section "pipeline-stepper: step 1 (before_snapshot) with initialized receipt → ALLOW"

WS=$(_boot_state "submit-button" "jit" "[]")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="playwright-cli page screenshot --output /tmp/before/submit-button.png" hook_event_name=PreToolUse cwd="$WS")" \
  "step 1 (before_snapshot) with empty journal → ALLOW (no predecessor needed)"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 3 — step 2 (Edit/patch_applied) requires before_snapshot=pass
# ---------------------------------------------------------------------------
section "pipeline-stepper: step 2 (patch_applied) predecessor check"

# 3a: no before_snapshot in journal → DENY
WS=$(_boot_state "submit-button" "jit" "[]")
export WORKSPACE_ROOT="$WS"

assert_deny "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/Button.tsx" hook_event_name=PreToolUse cwd="$WS")" \
  "patch_applied with no before_snapshot → DENY" \
  "before_snapshot"

unset WORKSPACE_ROOT

# 3b: before_snapshot=fail → DENY (fail blocks successor)
STEPS=$(_steps_json "before_snapshot:fail")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_deny "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/Button.tsx" hook_event_name=PreToolUse cwd="$WS")" \
  "patch_applied with before_snapshot=fail → DENY" \
  "before_snapshot"

unset WORKSPACE_ROOT

# 3c: before_snapshot=pass → ALLOW
STEPS=$(_steps_json "before_snapshot:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/Button.tsx" hook_event_name=PreToolUse cwd="$WS")" \
  "patch_applied with before_snapshot=pass → ALLOW"

unset WORKSPACE_ROOT

# 3d: Write also triggers patch_applied — ALLOW when predecessor is pass
STEPS=$(_steps_json "before_snapshot:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Write file_path="$WS/src/NewComp.tsx" hook_event_name=PreToolUse cwd="$WS")" \
  "Write .tsx with before_snapshot=pass → ALLOW (patch_applied)"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 4 — step 3 (typecheck) requires patch_applied=pass
# ---------------------------------------------------------------------------
section "pipeline-stepper: step 3 (typecheck) predecessor check"

# 4a: no patch_applied → DENY
STEPS=$(_steps_json "before_snapshot:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_deny "$H" \
  "$(payload tool_name=Bash command="npm run typecheck" hook_event_name=PreToolUse cwd="$WS")" \
  "typecheck with no patch_applied → DENY" \
  "patch_applied"

unset WORKSPACE_ROOT

# 4b: patch_applied=pass → ALLOW
STEPS=$(_steps_json "before_snapshot:pass" "patch_applied:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="npm run typecheck" hook_event_name=PreToolUse cwd="$WS")" \
  "typecheck with patch_applied=pass → ALLOW"

unset WORKSPACE_ROOT

# 4c: tsc --noEmit variant → ALLOW
STEPS=$(_steps_json "before_snapshot:pass" "patch_applied:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="tsc --noEmit" hook_event_name=PreToolUse cwd="$WS")" \
  "tsc --noEmit with patch_applied=pass → ALLOW (typecheck)"

unset WORKSPACE_ROOT

# 4d: npx tsc variant → ALLOW
STEPS=$(_steps_json "before_snapshot:pass" "patch_applied:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="npx tsc" hook_event_name=PreToolUse cwd="$WS")" \
  "npx tsc with patch_applied=pass → ALLOW (typecheck)"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 5 — step 5 (unit_tests) requires typecheck=pass
# ---------------------------------------------------------------------------
section "pipeline-stepper: step 5 (unit_tests) predecessor check"

# 5a: typecheck=fail blocks unit_tests
STEPS=$(_steps_json "before_snapshot:pass" "patch_applied:pass" "typecheck:fail")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_deny "$H" \
  "$(payload tool_name=Bash command="npm test" hook_event_name=PreToolUse cwd="$WS")" \
  "unit_tests with typecheck=fail → DENY" \
  "typecheck"

unset WORKSPACE_ROOT

# 5b: typecheck=pass → ALLOW
STEPS=$(_steps_json "before_snapshot:pass" "patch_applied:pass" "typecheck:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="npm test" hook_event_name=PreToolUse cwd="$WS")" \
  "unit_tests with typecheck=pass → ALLOW"

unset WORKSPACE_ROOT

# 5c: vitest variant → ALLOW
STEPS=$(_steps_json "before_snapshot:pass" "patch_applied:pass" "typecheck:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="vitest run" hook_event_name=PreToolUse cwd="$WS")" \
  "vitest with typecheck=pass → ALLOW (unit_tests)"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 6 — step 8 (commit) requires all 7 priors + git_diff_hash match
# ---------------------------------------------------------------------------
section "pipeline-stepper: step 8 (commit) full predecessor chain"

# 6a: all 7 priors as pass, hash matches → ALLOW
ALL_7=$(_steps_json \
  "before_snapshot:pass" \
  "patch_applied:pass" \
  "typecheck:pass" \
  "unit_tests:pass" \
  "e2e:pass" \
  "after_snapshot:pass" \
  "visual_diff:pass")

WS=$(_boot_state_with_hash "submit-button" "deadbeef" "$ALL_7")
export WORKSPACE_ROOT="$WS"
export FAKE_STAGED_HASH="deadbeef"

assert_allow "$H" \
  "$(payload tool_name=Bash command="git commit -m 'feat: add testid'" hook_event_name=PreToolUse cwd="$WS")" \
  "commit with all 7 priors + matching hash → ALLOW"

unset FAKE_STAGED_HASH
unset WORKSPACE_ROOT

# 6b: all 7 priors but hash MISMATCH → DENY
WS=$(_boot_state_with_hash "submit-button" "deadbeef" "$ALL_7")
export WORKSPACE_ROOT="$WS"
export FAKE_STAGED_HASH="cafebabe"

assert_deny "$H" \
  "$(payload tool_name=Bash command="git commit -m 'feat: add testid'" hook_event_name=PreToolUse cwd="$WS")" \
  "commit with hash mismatch → DENY" \
  "git_diff_hash"

unset FAKE_STAGED_HASH
unset WORKSPACE_ROOT

# 6c: missing visual_diff → DENY
SIX_STEPS=$(_steps_json \
  "before_snapshot:pass" \
  "patch_applied:pass" \
  "typecheck:pass" \
  "unit_tests:pass" \
  "e2e:pass" \
  "after_snapshot:pass")

WS=$(_boot_state_with_hash "submit-button" "deadbeef" "$SIX_STEPS")
export WORKSPACE_ROOT="$WS"
export FAKE_STAGED_HASH="deadbeef"

assert_deny "$H" \
  "$(payload tool_name=Bash command="git commit -m 'feat: add testid'" hook_event_name=PreToolUse cwd="$WS")" \
  "commit with visual_diff missing → DENY" \
  "visual_diff"

unset FAKE_STAGED_HASH
unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 7 — PostToolUse: appends step to journal
# ---------------------------------------------------------------------------
section "pipeline-stepper: PostToolUse appends step entry"

# 7a: PostToolUse for before_snapshot success → journal gets entry
WS=$(_boot_state "submit-button" "jit" "[]")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="playwright-cli page screenshot --output /tmp/before/submit-button.png" hook_event_name=PostToolUse exit_code=0 cwd="$WS")" \
  "PostToolUse before_snapshot success → silent ALLOW (records pass)"

# Check the receipt was updated
RECEIPT="$WS/tests/e2e/.selector-development/submit-button.receipt.json"
STEP_COUNT=$(jq '.steps | length' "$RECEIPT" 2>/dev/null || echo "0")
STEP_NAME=$(jq -r '.steps[0].name // ""' "$RECEIPT" 2>/dev/null || echo "")
STEP_STATUS=$(jq -r '.steps[0].status // ""' "$RECEIPT" 2>/dev/null || echo "")

TESTS_RUN=$((TESTS_RUN + 1))
if [ "$STEP_COUNT" = "1" ] && [ "$STEP_NAME" = "before_snapshot" ] && [ "$STEP_STATUS" = "pass" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} PostToolUse appended before_snapshot:pass to journal"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("PostToolUse append: expected steps=[{name:before_snapshot,status:pass}], got count=$STEP_COUNT name=$STEP_NAME status=$STEP_STATUS")
  echo "${CLR_FAIL}  ✗${CLR_RST} PostToolUse did not append before_snapshot:pass (count=$STEP_COUNT name=$STEP_NAME status=$STEP_STATUS)"
fi

unset WORKSPACE_ROOT

# 7b: PostToolUse for before_snapshot failure → journal gets fail entry
WS=$(_boot_state "submit-button" "jit" "[]")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="playwright-cli page screenshot --output /tmp/before/submit-button.png" hook_event_name=PostToolUse exit_code=1 cwd="$WS")" \
  "PostToolUse before_snapshot failure → silent ALLOW (records fail)"

RECEIPT="$WS/tests/e2e/.selector-development/submit-button.receipt.json"
STEP_STATUS=$(jq -r '.steps[0].status // ""' "$RECEIPT" 2>/dev/null || echo "")

TESTS_RUN=$((TESTS_RUN + 1))
if [ "$STEP_STATUS" = "fail" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} PostToolUse appended before_snapshot:fail to journal"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("PostToolUse fail append: expected status=fail, got status=$STEP_STATUS")
  echo "${CLR_FAIL}  ✗${CLR_RST} PostToolUse did not append before_snapshot:fail (got status=$STEP_STATUS)"
fi

unset WORKSPACE_ROOT

# 7c: PostToolUse for patch_applied (Edit) success → journal gets entry
STEPS=$(_steps_json "before_snapshot:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/src/Button.tsx" hook_event_name=PostToolUse exit_code=0 cwd="$WS")" \
  "PostToolUse patch_applied (Edit) success → silent ALLOW"

RECEIPT="$WS/tests/e2e/.selector-development/submit-button.receipt.json"
STEP_COUNT=$(jq '.steps | length' "$RECEIPT" 2>/dev/null || echo "0")
LAST_NAME=$(jq -r '.steps[-1].name // ""' "$RECEIPT" 2>/dev/null || echo "")
LAST_STATUS=$(jq -r '.steps[-1].status // ""' "$RECEIPT" 2>/dev/null || echo "")

TESTS_RUN=$((TESTS_RUN + 1))
if [ "$STEP_COUNT" = "2" ] && [ "$LAST_NAME" = "patch_applied" ] && [ "$LAST_STATUS" = "pass" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} PostToolUse appended patch_applied:pass to journal"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("PostToolUse patch_applied append: expected count=2 name=patch_applied status=pass, got count=$STEP_COUNT name=$LAST_NAME status=$LAST_STATUS")
  echo "${CLR_FAIL}  ✗${CLR_RST} PostToolUse did not append patch_applied:pass (count=$STEP_COUNT name=$LAST_NAME status=$LAST_STATUS)"
fi

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 8 — unrecognized Bash command → silent ALLOW (hook doesn't enforce)
# ---------------------------------------------------------------------------
section "pipeline-stepper: unrecognized command → silent ALLOW"

WS=$(_boot_state "submit-button" "jit" "[]")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="echo hello" hook_event_name=PreToolUse cwd="$WS")" \
  "unrecognized Bash command → silent ALLOW"

assert_allow "$H" \
  "$(payload tool_name=Bash command="ls -la" hook_event_name=PreToolUse cwd="$WS")" \
  "ls command → silent ALLOW"

# Non-frontend file path for Edit → silent ALLOW
assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/README.md" hook_event_name=PreToolUse cwd="$WS")" \
  "Edit non-frontend file → silent ALLOW"

assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/package.json" hook_event_name=PreToolUse cwd="$WS")" \
  "Edit package.json → silent ALLOW"

# A .ts file under tests/ is not a frontend source path
assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$WS/tests/e2e/x.spec.ts" hook_event_name=PreToolUse cwd="$WS")" \
  "Edit test spec.ts → silent ALLOW (not frontend src)"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 9 — tool-name filtering: Read, Agent → silent ALLOW
# ---------------------------------------------------------------------------
section "pipeline-stepper: tool-name filtering"

WS=$(_boot_state "submit-button" "jit" "[]")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Read file_path="$WS/src/Button.tsx" hook_event_name=PreToolUse cwd="$WS")" \
  "Read tool → silent ALLOW"

assert_allow "$H" \
  "$(payload tool_name=Agent description='dispatch' prompt='do stuff' hook_event_name=PreToolUse cwd="$WS")" \
  "Agent tool → silent ALLOW"

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 10 — PostToolUse commit archives receipt + clears .current-scope
# ---------------------------------------------------------------------------
section "pipeline-stepper: PostToolUse commit archives receipt"

ALL_7=$(_steps_json \
  "before_snapshot:pass" \
  "patch_applied:pass" \
  "typecheck:pass" \
  "unit_tests:pass" \
  "e2e:pass" \
  "after_snapshot:pass" \
  "visual_diff:pass")

WS=$(_boot_state_with_hash "submit-button" "deadbeef" "$ALL_7")
export WORKSPACE_ROOT="$WS"
export FAKE_STAGED_HASH="deadbeef"

assert_allow "$H" \
  "$(payload tool_name=Bash command="git commit -m 'feat: add testid'" hook_event_name=PostToolUse exit_code=0 cwd="$WS")" \
  "PostToolUse commit success → silent ALLOW (archives + clears scope)"

# After commit, .current-scope should be cleared
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "$WS/tests/e2e/.selector-development/.current-scope" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} PostToolUse commit cleared .current-scope"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("PostToolUse commit: .current-scope was not cleared after successful commit")
  echo "${CLR_FAIL}  ✗${CLR_RST} PostToolUse commit did not clear .current-scope"
fi

unset FAKE_STAGED_HASH
unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 11 — PostToolUse patch_applied: per-step extras
#   - step entry includes files: [<file_path>]
#   - top-level receipt.files is appended
#   - top-level receipt.git_diff_hash is set (via FAKE_STAGED_HASH)
# ---------------------------------------------------------------------------
section "pipeline-stepper: PostToolUse patch_applied extras (files + git_diff_hash)"

STEPS=$(_steps_json "before_snapshot:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"
export FAKE_STAGED_HASH="aabbccdd"

FILE="$WS/src/Button.tsx"

assert_allow "$H" \
  "$(payload tool_name=Edit file_path="$FILE" hook_event_name=PostToolUse exit_code=0 cwd="$WS")" \
  "PostToolUse patch_applied extras → silent ALLOW"

RECEIPT="$WS/tests/e2e/.selector-development/submit-button.receipt.json"

# 11a: step entry has files field with the edited file
STEP_FILES=$(jq -r '.steps[-1].files[0] // ""' "$RECEIPT" 2>/dev/null || echo "")
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$STEP_FILES" = "$FILE" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} patch_applied step entry has files:[<file_path>]"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("patch_applied step files: expected '$FILE', got '$STEP_FILES'")
  echo "${CLR_FAIL}  ✗${CLR_RST} patch_applied step entry missing files (got '$STEP_FILES')"
fi

# 11b: top-level receipt.git_diff_hash is set to FAKE_STAGED_HASH
RECEIPT_HASH=$(jq -r '.git_diff_hash // ""' "$RECEIPT" 2>/dev/null || echo "")
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$RECEIPT_HASH" = "aabbccdd" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} patch_applied set top-level git_diff_hash"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("patch_applied git_diff_hash: expected 'aabbccdd', got '$RECEIPT_HASH'")
  echo "${CLR_FAIL}  ✗${CLR_RST} patch_applied did not set git_diff_hash (got '$RECEIPT_HASH')"
fi

# 11c: top-level receipt.files contains the edited file
TOP_FILE=$(jq -r '.files[0] // ""' "$RECEIPT" 2>/dev/null || echo "")
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$TOP_FILE" = "$FILE" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} patch_applied appended to top-level receipt.files"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("patch_applied top-level files: expected '$FILE', got '$TOP_FILE'")
  echo "${CLR_FAIL}  ✗${CLR_RST} patch_applied did not append to top-level files (got '$TOP_FILE')"
fi

unset FAKE_STAGED_HASH
unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 12 — PostToolUse visual_diff: per-step extras (diff_pixels)
# ---------------------------------------------------------------------------
section "pipeline-stepper: PostToolUse visual_diff extras (diff_pixels)"

STEPS=$(_steps_json \
  "before_snapshot:pass" \
  "patch_applied:pass" \
  "typecheck:pass" \
  "unit_tests:pass" \
  "e2e:pass" \
  "after_snapshot:pass")
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

# Simulate visual-diff.js stdout with diffPixels=42
VD_STDOUT='{"pass":true,"diffPixels":42,"threshold":0.1}'

assert_allow "$H" \
  "$(payload tool_name=Bash command="node /tmp/visual-diff.js" hook_event_name=PostToolUse exit_code=0 stdout="$VD_STDOUT" cwd="$WS")" \
  "PostToolUse visual_diff with diffPixels=42 → silent ALLOW"

RECEIPT="$WS/tests/e2e/.selector-development/submit-button.receipt.json"

# 12a: step entry has diff_pixels = 42
DIFF_PIXELS=$(jq -r '.steps[-1].diff_pixels // "MISSING"' "$RECEIPT" 2>/dev/null || echo "MISSING")
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$DIFF_PIXELS" = "42" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} visual_diff step entry has diff_pixels=42"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("visual_diff diff_pixels: expected 42, got '$DIFF_PIXELS'")
  echo "${CLR_FAIL}  ✗${CLR_RST} visual_diff step entry missing diff_pixels (got '$DIFF_PIXELS')"
fi

# 12b: visual_diff with no stdout → diff_pixels defaults to 0
WS=$(_boot_state "submit-button" "jit" "$STEPS")
export WORKSPACE_ROOT="$WS"

assert_allow "$H" \
  "$(payload tool_name=Bash command="node /tmp/visual-diff.js" hook_event_name=PostToolUse exit_code=0 cwd="$WS")" \
  "PostToolUse visual_diff with no stdout → silent ALLOW"

RECEIPT="$WS/tests/e2e/.selector-development/submit-button.receipt.json"
DIFF_PIXELS_DEFAULT=$(jq -r '.steps[-1].diff_pixels // "MISSING"' "$RECEIPT" 2>/dev/null || echo "MISSING")
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$DIFF_PIXELS_DEFAULT" = "0" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} visual_diff with no stdout defaults diff_pixels to 0"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("visual_diff default diff_pixels: expected 0, got '$DIFF_PIXELS_DEFAULT'")
  echo "${CLR_FAIL}  ✗${CLR_RST} visual_diff no-stdout did not default diff_pixels to 0 (got '$DIFF_PIXELS_DEFAULT')"
fi

unset WORKSPACE_ROOT

# ---------------------------------------------------------------------------
# Section 13 — PostToolUse commit idempotency (already cleared .current-scope)
# ---------------------------------------------------------------------------
section "pipeline-stepper: PostToolUse commit idempotency"

ALL_7=$(_steps_json \
  "before_snapshot:pass" \
  "patch_applied:pass" \
  "typecheck:pass" \
  "unit_tests:pass" \
  "e2e:pass" \
  "after_snapshot:pass" \
  "visual_diff:pass")

WS=$(_boot_state_with_hash "submit-button" "deadbeef" "$ALL_7")
export WORKSPACE_ROOT="$WS"

# Remove .current-scope to simulate already-archived state
rm -f "$WS/tests/e2e/.selector-development/.current-scope"

assert_allow "$H" \
  "$(payload tool_name=Bash command="git commit -m 'feat: add testid'" hook_event_name=PostToolUse exit_code=0 cwd="$WS")" \
  "PostToolUse commit when scope already cleared → idempotent ALLOW"

unset WORKSPACE_ROOT
