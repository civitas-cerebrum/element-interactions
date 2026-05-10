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
# G6 fix requires a positive Playwright reporter signal in stdout
# (`[0-9]+ passed` or `Running [0-9]+ test`) before counting `passed`.
# Use `3 passed` so the hook records the run and migrates the legacy
# shape in the same operation.
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test' exit_code=0 stdout='3 passed' cwd="$REPO")"
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

section "suite-gate: G6 — non-running playwright invocations don't count as passed (BookHive Run-5)"

# G6.1: --help exit 0 → not recorded
REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test --help' exit_code=0 stdout='Usage: playwright test ...' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "$REPO/.claude/last-suite-result.json" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} G6 — playwright test --help exit 0 → no record"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("G6: --help wrote a record"); echo "${CLR_FAIL}  ✗${CLR_RST} G6 — --help should not record"
fi
rm -rf "$REPO"

# G6.2: --version exit 0 → not recorded
REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test --version' exit_code=0 stdout='Version 1.59.1' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "$REPO/.claude/last-suite-result.json" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} G6 — playwright test --version exit 0 → no record"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("G6: --version wrote a record"); echo "${CLR_FAIL}  ✗${CLR_RST} G6 — --version should not record"
fi
rm -rf "$REPO"

# G6.3: --list exit 0 → not recorded
REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test --list' exit_code=0 stdout='Listing tests...' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "$REPO/.claude/last-suite-result.json" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} G6 — playwright test --list exit 0 → no record"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("G6: --list wrote a record"); echo "${CLR_FAIL}  ✗${CLR_RST} G6 — --list should not record"
fi
rm -rf "$REPO"

# G6.4: --reporter=null exit 0 → not recorded
REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test --reporter=null' exit_code=0 stdout='' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "$REPO/.claude/last-suite-result.json" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} G6 — playwright test --reporter=null → no record"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("G6: --reporter=null wrote a record"); echo "${CLR_FAIL}  ✗${CLR_RST} G6 — --reporter=null should not record"
fi
rm -rf "$REPO"

# G6.5: exit 0 with no pass-signal stdout (e.g., --grep nomatch matched 0 tests) → not recorded
REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test --grep zzz_no_match_zzz' exit_code=0 stdout='' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "$REPO/.claude/last-suite-result.json" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} G6 — exit 0 without any pass-signal → no record"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("G6: empty-stdout exit 0 wrote a record"); echo "${CLR_FAIL}  ✗${CLR_RST} G6 — empty-stdout exit 0 should not record"
fi
rm -rf "$REPO"

# G6 inverse: real test run with `[N] passed` does record.
REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test' exit_code=0 stdout='12 passed (5.4s)' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$REPO/.claude/last-suite-result.json" ] && [ "$(jq -r '.runs[0].status' "$REPO/.claude/last-suite-result.json")" = "passed" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} G6 inverse — real test run with N-passed signal → recorded as passed"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("G6 inverse: real run not recorded"); echo "${CLR_FAIL}  ✗${CLR_RST} G6 inverse — real test run should record"
fi
rm -rf "$REPO"

# G6 inverse: failed test (exit 1 + `1 failed`) records as failed regardless of pass-signal absence.
REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Bash hook_event_name=PostToolUse command='npx playwright test' exit_code=1 stdout='1 failed' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$REPO/.claude/last-suite-result.json" ] && [ "$(jq -r '.runs[0].status' "$REPO/.claude/last-suite-result.json")" = "failed" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} G6 inverse — real failed test → recorded as failed"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("G6 inverse: failed run not recorded"); echo "${CLR_FAIL}  ✗${CLR_RST} G6 inverse — failed test should record"
fi
rm -rf "$REPO"
