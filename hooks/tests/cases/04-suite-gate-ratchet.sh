#!/bin/bash
H="$HOOK_DIR/suite-gate-ratchet.sh"

# Each test sets up its own temp repo so state-file mutations are isolated.
make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/.claude"
  echo "$d"
}

section "suite-gate: PreToolUse — empty state, commit blocked"
REPO=$(make_repo)
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m "test(j-checkout): add"' cwd="$REPO")" "empty state → DENY (no window)" "No suite-gate window"
rm -rf "$REPO"

section "suite-gate: PostToolUse — append run records to window"
REPO=$(make_repo)
# 1 passed run
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test --reporter=list' exit_code=0 stdout='All 50 passed' cwd="$REPO")"
# Verify state-file shape
LEN=$(jq '.runs | length' "$REPO/.claude/last-suite-result.json" 2>/dev/null)
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$LEN" = "1" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} 1 PostToolUse → 1 run in window"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("PostToolUse window-len: expected 1 got $LEN"); echo "${CLR_FAIL}  ✗${CLR_RST} 1 PostToolUse → expected 1 got $LEN"
fi
# Window not yet filled, commit denied
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m "test(j-x): add"' cwd="$REPO")" "1/3 runs → DENY (window not yet filled)" "window not yet filled"
rm -rf "$REPO"

section "suite-gate: PreToolUse — 3 passed runs ALLOW commit"
REPO=$(make_repo)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$REPO/.claude/last-suite-result.json" <<EOF
{"window_size":3,"runs":[
  {"status":"passed","timestamp":"$NOW","exitCode":"0"},
  {"status":"passed","timestamp":"$NOW","exitCode":"0"},
  {"status":"passed","timestamp":"$NOW","exitCode":"0"}
]}
EOF
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m "test(j-x): add"' cwd="$REPO")" "3 passed runs → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m "docs(ledger): j-x — 12 probes, 8 boundaries, 0 suspected bugs"' cwd="$REPO")" "ledger commit with 3 passed → ALLOW"
rm -rf "$REPO"

section "suite-gate: PreToolUse — any-red in window blocks commit"
REPO=$(make_repo)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$REPO/.claude/last-suite-result.json" <<EOF
{"window_size":3,"runs":[
  {"status":"passed","timestamp":"$NOW","exitCode":"0"},
  {"status":"failed","timestamp":"$NOW","exitCode":"1"},
  {"status":"passed","timestamp":"$NOW","exitCode":"0"}
]}
EOF
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m "test(j-x): add"' cwd="$REPO")" "2 passed + 1 failed → DENY (any-red)" "failed runs"
rm -rf "$REPO"

section "suite-gate: PreToolUse — stale window (oldest >1h)"
REPO=$(make_repo)
OLD="2026-04-30T15:00:00Z"
cat > "$REPO/.claude/last-suite-result.json" <<EOF
{"window_size":3,"runs":[
  {"status":"passed","timestamp":"$OLD","exitCode":"0"},
  {"status":"passed","timestamp":"$OLD","exitCode":"0"},
  {"status":"passed","timestamp":"$OLD","exitCode":"0"}
]}
EOF
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m "test(j-x): add"' cwd="$REPO")" "3 passed but oldest >1h → DENY (stale)" "stale"
rm -rf "$REPO"

section "suite-gate: legacy single-object format auto-migrates"
REPO=$(make_repo)
echo '{"status":"passed","timestamp":"2026-05-01T19:00:00Z","exitCode":"0"}' > "$REPO/.claude/last-suite-result.json"
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test' exit_code=0 stdout='All passed' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
SHAPE=$(jq -r 'if has("runs") then "array" else "legacy" end' "$REPO/.claude/last-suite-result.json")
if [ "$SHAPE" = "array" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} legacy single-object → migrated to array shape"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("legacy migration: shape stayed $SHAPE"); echo "${CLR_FAIL}  ✗${CLR_RST} legacy migration"
fi
rm -rf "$REPO"

section "suite-gate: env-var window-size override"
REPO=$(make_repo)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Build a 3-run window then check whether window=5 enforces "need more runs"
cat > "$REPO/.claude/last-suite-result.json" <<EOF
{"window_size":3,"runs":[
  {"status":"passed","timestamp":"$NOW","exitCode":"0"},
  {"status":"passed","timestamp":"$NOW","exitCode":"0"},
  {"status":"passed","timestamp":"$NOW","exitCode":"0"}
]}
EOF
TESTS_RUN=$((TESTS_RUN + 1))
out=$(CIVITAS_SUITE_GATE_WINDOW=5 printf '%s' "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m "test(j-x): add"' cwd="$REPO")" | CIVITAS_SUITE_GATE_WINDOW=5 bash "$H")
decision=$(echo "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)
if [ "$decision" = "deny" ] && echo "$out" | grep -q "3/5\|window not yet filled"; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} CIVITAS_SUITE_GATE_WINDOW=5 with 3 runs → DENY (3/5)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("env override: decision='$decision' out=${out:0:200}"); echo "${CLR_FAIL}  ✗${CLR_RST} CIVITAS_SUITE_GATE_WINDOW=5 with 3 runs"
fi
rm -rf "$REPO"

section "suite-gate: non-progression commits pass through"
REPO=$(make_repo)
# State file empty — but a non-phase-progression commit should pass.
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m "chore: tweak readme"' cwd="$REPO")" "chore commit → ALLOW (not phase-progression)"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m "fix(steps): adjust timeout"' cwd="$REPO")" "fix commit → ALLOW (not phase-progression)"
rm -rf "$REPO"

section "suite-gate: PostToolUse only fires on playwright test"
REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npm install' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -s "$REPO/.claude/last-suite-result.json" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} 'npm install' PostToolUse → no state mutation"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("Non-playwright command shouldn't mutate state"); echo "${CLR_FAIL}  ✗${CLR_RST} unexpected state mutation"
fi
rm -rf "$REPO"
