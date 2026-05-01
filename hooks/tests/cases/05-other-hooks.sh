#!/bin/bash
# Quick-coverage tests for the remaining hooks.

section "commit-message-gate"
H="$HOOK_DIR/commit-message-gate.sh"
assert_allow "$H" "$(payload tool_name=Bash command='git commit -m "test(j-checkout): add cart spec"')" "test(j-…) → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash command='git commit -m "docs(ledger): j-x — 12 probes, 8 boundaries, 0 suspected bugs"')" "docs(ledger) → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash command='git commit -m "chore: scaffold"')" "chore → ALLOW"
assert_deny "$H" "$(payload tool_name=Bash command='git commit -m "feat(e2e): add tests"')" "feat(e2e) → DENY"
assert_deny "$H" "$(payload tool_name=Bash command='git commit -m "test(j-a, j-b): multi"')" "multi-journey scope → DENY"
assert_deny "$H" "$(payload tool_name=Bash command='git commit -m "test(j-x): x" --no-verify')" "--no-verify flag → DENY (hook bypass)"
assert_deny "$H" "$(payload tool_name=Bash command='git commit -m "review(j-x): review notes"')" "review(j-…) → DENY (Stage B never commits)"
assert_allow "$H" "$(payload tool_name=Bash command='echo \"git commit -m feat(e2e): not actually a commit\"')" "echo with text → silent allow"

section "journey-map-sentinel-guard"
H="$HOOK_DIR/journey-map-sentinel-guard.sh"
NL=$'\n'
SENT="<!-- journey-mapping:generated -->"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/journey-map.md' content="${SENT}${NL}# Map")" "Write preserves sentinel → ALLOW"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/journey-map.md' content="# Map${NL}no sentinel")" "Write strips sentinel → DENY"
assert_allow "$H" "$(payload tool_name=Edit file_path='/x/tests/e2e/docs/other.md' new_string='whatever')" "non-journey-map file → silent allow"

section "coverage-state-schema-guard"
H="$HOOK_DIR/coverage-state-schema-guard.sh"
GOOD='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":[],"updatedAt":"2026-05-01T00:00:00Z"}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$GOOD")" "valid state file → ALLOW"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content='not json')" "malformed JSON → DENY"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content='{}')" "empty object → DENY (missing required fields)"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content='{\"status\":\"in-progress\"}')" "missing required keys → DENY"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/some-other-file.json' content='{}')" "non-state file → silent allow"

section "raw-playwright-api-warning"
H="$HOOK_DIR/raw-playwright-api-warning.sh"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/foo.spec.ts' content='await page.click(\"#submit\");')" "page.click → WARN" "page.click"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/foo.spec.ts' content='await page.fill(\"#input\", \"text\");')" "page.fill → WARN"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/foo.spec.ts' content='await page.context().clearCookies();')" "page.context().clearCookies → silent allow (framework bridge)"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/foo.spec.ts' content='// page.click in a comment\nawait steps.click(\"x\")')" "page.click in comment → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/some-other.ts' content='await page.click(\"x\");')" "non-spec file → silent allow"

section "mcp-browser-tool-redirect"
H="$HOOK_DIR/mcp-browser-tool-redirect.sh"
for tool in browser_navigate browser_snapshot browser_click browser_type browser_close browser_take_screenshot; do
  assert_deny "$H" "$(payload tool_name="mcp__plugin_playwright_playwright__${tool}")" "MCP $tool → DENY" "playwright-cli"
done
assert_allow "$H" "$(payload tool_name=Bash command='echo x')" "non-MCP tool → silent allow"

section "playwright-cli-cleanup-on-stop"
H="$HOOK_DIR/playwright-cli-cleanup-on-stop.sh"
# Always exits 0 silently. Just check exit code.
TESTS_RUN=$((TESTS_RUN + 1))
out=$(echo '{"hook_event_name":"SubagentStop"}' | bash "$H" 2>/dev/null)
ec=$?
if [ "$ec" = "0" ] && [ -z "$out" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} SubagentStop → exit 0, no output"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("cleanup-on-stop: exit=$ec out=$out"); echo "${CLR_FAIL}  ✗${CLR_RST} cleanup-on-stop"
fi
