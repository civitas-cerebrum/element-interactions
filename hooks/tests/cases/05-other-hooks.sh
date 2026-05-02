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
# Valid: currentPass=0, no dispatches yet (orchestrator hasn't started)
INIT='{"status":"in-progress","mode":"depth","currentPass":0,"journeyRoster":["j-a","j-b"],"passes":{},"updatedAt":"2026-05-01T00:00:00Z"}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$INIT")" "currentPass=0 with empty passes → ALLOW (haven't started)"
# Valid: currentPass=1 with at least one dispatch recorded
PROGRESS='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{"1-compositional":{"dispatches":[{"journey":"j-a","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}]}},"updatedAt":"2026-05-01T00:00:00Z"}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$PROGRESS")" "currentPass=1 with one dispatch → ALLOW"
# Pre-emptive-stop: currentPass=1 with empty passes (the v0.3.4-test failure mode)
EMPTY='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{},"updatedAt":"2026-05-01T00:00:00Z"}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$EMPTY")" "currentPass=1 with empty passes → DENY (pre-emptive stop)" "zero dispatches recorded"
# Pre-emptive-stop with passes object but empty dispatches[]
EMPTY_DISPATCHES='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{"1-compositional":{"dispatches":[]}},"updatedAt":"2026-05-01T00:00:00Z"}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$EMPTY_DISPATCHES")" "currentPass=1 with empty dispatches[] → DENY (pre-emptive stop)" "zero dispatches recorded"
# Top-level dispatches[] form (older schema variant) — still satisfies the at-least-one rule
TOP_DISPATCHES='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"dispatches":[{"journey":"j-a","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}],"updatedAt":"2026-05-01T00:00:00Z"}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$TOP_DISPATCHES")" "currentPass=1 with top-level dispatches[] → ALLOW (compat)"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content='not json')" "malformed JSON → DENY"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content='{}')" "empty object → DENY (missing required fields)"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content='{\"status\":\"in-progress\"}')" "missing required keys → DENY"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/some-other-file.json' content='{}')" "non-state file → silent allow"

section "coverage-expansion-direct-compose-block (in-flight gated)"
H="$HOOK_DIR/coverage-expansion-direct-compose-block.sh"

# Set up a temp project with an active coverage-expansion state file
TMP_PROJ=$(mktemp -d)
mkdir -p "$TMP_PROJ/tests/e2e/docs"
cd "$TMP_PROJ" && git init -q && cd - >/dev/null
echo '{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-x"],"passes":{"1-compositional":{"dispatches":[{"journey":"j-x","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}]}},"updatedAt":"2026-05-02T00:00:00Z"}' > "$TMP_PROJ/tests/e2e/docs/coverage-expansion-state.json"

# No in-flight registrations → all journey-spec writes DENY
assert_deny "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/j-checkout.spec.ts" content='test stuff' cwd="$TMP_PROJ")" "j-spec write during coverage-expansion + no in-flight → DENY" "Direct composition"
assert_deny "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/sj-payment.spec.ts" content='test stuff' cwd="$TMP_PROJ")" "sj-spec write during coverage-expansion + no in-flight → DENY" "Direct composition"
assert_deny "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/j-checkout-regression.spec.ts" content='test stuff' cwd="$TMP_PROJ")" "j-regression-spec write during coverage-expansion + no in-flight → DENY" "Direct composition"

# happy-path / non-spec / non-j-prefixed → exempt
assert_allow "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/happy-path.spec.ts" content='test stuff' cwd="$TMP_PROJ")" "happy-path.spec.ts → ALLOW (exempt)"
assert_allow "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/utils.ts" content='helpers' cwd="$TMP_PROJ")" "non-spec file → ALLOW"
assert_allow "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/scenarios.spec.ts" content='test stuff' cwd="$TMP_PROJ")" "non-j-prefixed spec → ALLOW"

# In-flight registration ALLOWS legitimate composer-subagent writes for that slug.
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" <<EOF
{"composers":{"j-checkout":{"description_prefix":"composer-j-checkout","started_at":"$NOW_ISO"}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/j-checkout.spec.ts" content='test stuff' cwd="$TMP_PROJ")" "j-checkout in-flight + j-checkout write → ALLOW (legit composer subagent)"
# Edit also allowed
assert_allow "$H" "$(payload tool_name=Edit file_path="$TMP_PROJ/tests/e2e/j-checkout.spec.ts" new_string='small fix' cwd="$TMP_PROJ")" "j-checkout in-flight + j-checkout edit → ALLOW"
# Different slug NOT in-flight → still DENY
assert_deny "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/j-cart.spec.ts" content='test stuff' cwd="$TMP_PROJ")" "j-checkout in-flight + j-cart write → DENY (different slug)" "Direct composition"
# Regression spec uses the base slug (j-checkout-regression strips to j-checkout)
assert_allow "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/j-checkout-regression.spec.ts" content='regression' cwd="$TMP_PROJ")" "j-checkout in-flight + j-checkout-regression write → ALLOW (regression maps to base slug)"

# TTL expired (>30 min ago) → entry stale, DENY
OLD_ISO="2026-04-30T15:00:00Z"
cat > "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" <<EOF
{"composers":{"j-checkout":{"description_prefix":"composer-j-checkout","started_at":"$OLD_ISO"}}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/j-checkout.spec.ts" content='test stuff' cwd="$TMP_PROJ")" "j-checkout in-flight but stale (>30min) → DENY" "Direct composition"

# Without active coverage-expansion run, j-spec writes are allowed (Stage 3 / companion-mode)
rm "$TMP_PROJ/tests/e2e/docs/coverage-expansion-state.json"
rm -f "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json"
assert_allow "$H" "$(payload tool_name=Write file_path="$TMP_PROJ/tests/e2e/j-checkout.spec.ts" content='test stuff' cwd="$TMP_PROJ")" "j-spec write WITHOUT coverage-expansion state → ALLOW"

rm -rf "$TMP_PROJ"

section "dispatch-guard: in-flight composer registration"
H="$HOOK_DIR/coverage-expansion-dispatch-guard.sh"
TMP_PROJ=$(mktemp -d)
mkdir -p "$TMP_PROJ/tests/e2e/docs"
cd "$TMP_PROJ" && git init -q && cd - >/dev/null

# Dispatching composer-j-checkout: should write the in-flight entry.
out=$(printf '%s' "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$TMP_PROJ")" | bash "$H")
TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" ] && \
   jq -e '.composers."j-checkout".description_prefix == "composer-j-checkout: cycle 1"' "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} composer-j-checkout: dispatch → in-flight registered"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("dispatch registration: in-flight file missing or wrong shape")
  echo "${CLR_FAIL}  ✗${CLR_RST} composer-j-checkout: dispatch in-flight registration"
fi

# probe-j-foo: also registers
out=$(printf '%s' "$(payload tool_name=Agent description='probe-j-foo: pass 4' prompt='probe j-foo' cwd="$TMP_PROJ")" | bash "$H")
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-foo".description_prefix == "probe-j-foo: pass 4"' "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} probe-j-foo: dispatch → in-flight registered"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("probe registration: missing")
  echo "${CLR_FAIL}  ✗${CLR_RST} probe-j-foo: registration"
fi

# composer-sj-bar: with sj- prefix
out=$(printf '%s' "$(payload tool_name=Agent description='composer-sj-bar: cycle 1' prompt='compose sj-bar' cwd="$TMP_PROJ")" | bash "$H")
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."sj-bar".description_prefix == "composer-sj-bar: cycle 1"' "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} composer-sj-bar: dispatch → sj- slug registered"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("composer-sj registration: missing")
  echo "${CLR_FAIL}  ✗${CLR_RST} composer-sj-bar: registration"
fi

# reviewer-j-x: should NOT register (reviewers don't write spec files).
out=$(printf '%s' "$(payload tool_name=Agent description='reviewer-j-baz: cycle 1' prompt='review j-baz' cwd="$TMP_PROJ")" | bash "$H")
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-baz" // empty' "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" >/dev/null 2>&1; then
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("reviewer-j-baz wrongly registered")
  echo "${CLR_FAIL}  ✗${CLR_RST} reviewer-j-baz: should NOT register"
else
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} reviewer-j-baz: dispatch → NOT registered (reviewers don't write specs)"
fi

# phase-validator-5: should NOT register
out=$(printf '%s' "$(payload tool_name=Agent description='phase-validator-5: cycle 1' prompt='validate' cwd="$TMP_PROJ")" | bash "$H")
TESTS_RUN=$((TESTS_RUN + 1))
COUNT=$(jq -r '.composers | keys | length' "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" 2>/dev/null || echo 0)
if [ "$COUNT" = "3" ]; then  # j-checkout, j-foo, sj-bar — phase-validator added nothing
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} phase-validator-5: dispatch → NOT registered (count stays 3)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("phase-validator wrongly registered. count=$COUNT")
  echo "${CLR_FAIL}  ✗${CLR_RST} phase-validator-5: registration count is $COUNT (expected 3)"
fi

rm -rf "$TMP_PROJ"

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
