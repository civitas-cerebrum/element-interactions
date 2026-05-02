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

# Dispatching composer-j-checkout: should write the in-flight entry with cycle.
out=$(printf '%s' "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$TMP_PROJ")" | bash "$H")
TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" ] && \
   jq -e '.composers."j-checkout".description_prefix == "composer-j-checkout: cycle 1" and .composers."j-checkout".cycle == 1' "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} composer-j-checkout cycle 1: dispatch → in-flight registered with cycle=1"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("dispatch registration: in-flight file missing or wrong shape (cycle field expected)")
  echo "${CLR_FAIL}  ✗${CLR_RST} composer-j-checkout cycle 1: dispatch in-flight registration"
fi

# Re-dispatching composer-j-checkout: cycle 2 should refresh cycle field.
out=$(printf '%s' "$(payload tool_name=Agent description='composer-j-checkout: cycle 2' prompt='retry j-checkout with must-fix list' cwd="$TMP_PROJ")" | bash "$H")
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-checkout".cycle == 2' "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} composer-j-checkout cycle 2: redispatch → cycle refreshed to 2"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("redispatch did not refresh cycle field")
  echo "${CLR_FAIL}  ✗${CLR_RST} composer-j-checkout cycle 2: redispatch cycle refresh"
fi

# probe-j-foo: also registers (no explicit cycle in description → defaults to 1)
out=$(printf '%s' "$(payload tool_name=Agent description='probe-j-foo: pass 4' prompt='probe j-foo' cwd="$TMP_PROJ")" | bash "$H")
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-foo".description_prefix == "probe-j-foo: pass 4" and .composers."j-foo".cycle == 1' "$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} probe-j-foo: dispatch → in-flight registered with cycle=1 (default)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("probe registration: missing or no default cycle")
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

section "subagent-return-schema-guard: handover envelope + deregistration"
H="$HOOK_DIR/subagent-return-schema-guard.sh"
TMP_PROJ=$(mktemp -d)
mkdir -p "$TMP_PROJ/tests/e2e/docs"
cd "$TMP_PROJ" && git init -q && cd - >/dev/null
NL=$'\n'
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
REG_FILE="$TMP_PROJ/tests/e2e/docs/.in-flight-composers.json"

write_registry() {
  cat > "$REG_FILE" <<EOF
{"composers":$1}
EOF
}

# --- Terminal handover (composer new-tests-landed cycle 1) → deregisters ---
write_registry '{"j-checkout":{"description_prefix":"composer-j-checkout: cycle 1","cycle":1,"started_at":"'"$NOW_ISO"'"}}'
RESPONSE_TEXT="handover:${NL}  role: composer-j-checkout${NL}  cycle: 1${NL}  status: new-tests-landed${NL}  next-action: dispatch reviewer-j-checkout cycle 1${NL}${NL}status: new-tests-landed${NL}tests-added: 6${NL}run-time: 47s${NL}"
out=$(printf '%s' "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text="$RESPONSE_TEXT" cwd="$TMP_PROJ")" | bash "$H" 2>/dev/null)
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-checkout" // empty' "$REG_FILE" >/dev/null 2>&1; then
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("terminal handover: slot still registered (should have deregistered)")
  echo "${CLR_FAIL}  ✗${CLR_RST} composer terminal new-tests-landed → deregister"
else
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} composer terminal new-tests-landed → slug deregistered"
fi

# --- Terminal probe handover (clean) → deregisters ---
write_registry '{"j-foo":{"description_prefix":"probe-j-foo: pass 4","cycle":1,"started_at":"'"$NOW_ISO"'"}}'
RESPONSE_TEXT="handover:${NL}  role: probe-j-foo${NL}  cycle: 1${NL}  status: clean${NL}  next-action: advance to pass 5${NL}${NL}probes: 12${NL}boundaries: 8${NL}findings: 0${NL}"
out=$(printf '%s' "$(payload tool_name=Agent description='probe-j-foo: pass 4' response_text="$RESPONSE_TEXT" cwd="$TMP_PROJ")" | bash "$H" 2>/dev/null)
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-foo" // empty' "$REG_FILE" >/dev/null 2>&1; then
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("probe terminal clean: slot still registered")
  echo "${CLR_FAIL}  ✗${CLR_RST} probe terminal clean → deregister"
else
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} probe terminal clean → slug deregistered"
fi

# --- Non-terminal reviewer handover (improvements-needed) → registry untouched ---
# (Reviewer roles aren't in the registry, but verify a registered composer slot
# survives a sibling reviewer's improvements-needed return.)
write_registry '{"j-checkout":{"description_prefix":"composer-j-checkout: cycle 1","cycle":1,"started_at":"'"$NOW_ISO"'"}}'
RESPONSE_TEXT="handover:${NL}  role: reviewer-j-checkout${NL}  cycle: 1${NL}  status: improvements-needed${NL}  next-action: redispatch composer-j-checkout cycle 2${NL}${NL}status: improvements-needed${NL}journey: j-checkout${NL}pass: 1${NL}cycle: 1${NL}${NL}missing-scenarios:${NL}  - **j-checkout-1-1-R-01** [must-fix] — mobile breakpoint never exercised${NL}    - why: high-value variant${NL}    - category: mobile${NL}    - suggested-test: add mobile checkpoint test${NL}"
out=$(printf '%s' "$(payload tool_name=Agent description='reviewer-j-checkout: cycle 1' response_text="$RESPONSE_TEXT" cwd="$TMP_PROJ")" | bash "$H" 2>/dev/null)
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-checkout".cycle == 1' "$REG_FILE" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} reviewer non-terminal improvements-needed → composer slot held"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("reviewer improvements-needed wrongly cleared composer slot")
  echo "${CLR_FAIL}  ✗${CLR_RST} reviewer non-terminal → slot held"
fi

# --- Non-terminal phase-validator handover → registry untouched ---
# Phase-validator isn't in the registry, but the test ensures the schema-guard
# doesn't accidentally clear unrelated entries.
write_registry '{"j-checkout":{"description_prefix":"composer-j-checkout: cycle 1","cycle":1,"started_at":"'"$NOW_ISO"'"}}'
RESPONSE_TEXT="handover:${NL}  role: phase-validator-5${NL}  cycle: 1${NL}  status: improvements-needed${NL}  next-action: address pv-5-01 and re-dispatch${NL}${NL}status: improvements-needed${NL}phase: 5${NL}exit-criteria-checked:${NL}  - criterion: foo${NL}    satisfied: false${NL}    evidence: absent${NL}summary: 1 finding${NL}findings:${NL}  - **pv-5-01** [must-fix] — bar${NL}    - criterion: foo${NL}    - issue: x${NL}    - fix: y${NL}"
out=$(printf '%s' "$(payload tool_name=Agent description='phase-validator-5: cycle 1' response_text="$RESPONSE_TEXT" cwd="$TMP_PROJ")" | bash "$H" 2>/dev/null)
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-checkout".cycle == 1' "$REG_FILE" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} phase-validator handover → unrelated composer slot untouched"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("phase-validator handover wrongly cleared composer slot")
  echo "${CLR_FAIL}  ✗${CLR_RST} phase-validator handover → unrelated slot untouched"
fi

# --- Cycle mismatch (envelope cycle 1, registry cycle 2) → refuses + warns ---
write_registry '{"j-checkout":{"description_prefix":"composer-j-checkout: cycle 2","cycle":2,"started_at":"'"$NOW_ISO"'"}}'
RESPONSE_TEXT="handover:${NL}  role: composer-j-checkout${NL}  cycle: 1${NL}  status: new-tests-landed${NL}  next-action: dispatch reviewer-j-checkout cycle 1${NL}${NL}status: new-tests-landed${NL}tests-added: 6${NL}run-time: 47s${NL}"
PAYLOAD=$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text="$RESPONSE_TEXT" cwd="$TMP_PROJ")
assert_warn "$H" "$PAYLOAD" "cycle mismatch (envelope=1, registry=2) → WARN" "cycle-mismatch"
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-checkout".cycle == 2' "$REG_FILE" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} cycle mismatch → slot NOT deregistered (still cycle=2)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("cycle mismatch wrongly deregistered slot")
  echo "${CLR_FAIL}  ✗${CLR_RST} cycle mismatch → slot preserved"
fi

# --- Missing envelope entirely → WARN ---
write_registry '{"j-checkout":{"description_prefix":"composer-j-checkout: cycle 1","cycle":1,"started_at":"'"$NOW_ISO"'"}}'
RESPONSE_TEXT="status: new-tests-landed${NL}tests-added: 6${NL}run-time: 47s${NL}"
PAYLOAD=$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text="$RESPONSE_TEXT" cwd="$TMP_PROJ")
assert_warn "$H" "$PAYLOAD" "envelope missing entirely → WARN" "envelope missing entirely"
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-checkout"' "$REG_FILE" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} envelope missing → slot held (TTL takes over)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("envelope missing wrongly cleared slot")
  echo "${CLR_FAIL}  ✗${CLR_RST} envelope missing → slot held"
fi

# --- Malformed envelope (missing fields) → WARN ---
write_registry '{"j-checkout":{"description_prefix":"composer-j-checkout: cycle 1","cycle":1,"started_at":"'"$NOW_ISO"'"}}'
RESPONSE_TEXT="handover:${NL}  role: composer-j-checkout${NL}  cycle: 1${NL}${NL}status: new-tests-landed${NL}tests-added: 6${NL}run-time: 47s${NL}"
PAYLOAD=$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text="$RESPONSE_TEXT" cwd="$TMP_PROJ")
assert_warn "$H" "$PAYLOAD" "envelope missing status+next-action → WARN" "malformed"

# --- Slug not in registry (already deregistered) → silent on registry, schema check still runs ---
# Use a malformed schema response so the schema-check trips a WARN (otherwise this would be silent allow).
# This verifies the slug-not-found case doesn't crash.
write_registry '{}'
RESPONSE_TEXT="handover:${NL}  role: composer-j-checkout${NL}  cycle: 1${NL}  status: new-tests-landed${NL}  next-action: continue${NL}${NL}status: new-tests-landed${NL}"
PAYLOAD=$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text="$RESPONSE_TEXT" cwd="$TMP_PROJ")
# Schema check will fire on missing tests-added/run-time for new-tests-landed status — verify hook doesn't crash.
TESTS_RUN=$((TESTS_RUN + 1))
out=$(printf '%s' "$PAYLOAD" | bash "$H" 2>/dev/null)
ec=$?
if [ "$ec" = "0" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} slug not in registry → hook completes cleanly (no crash)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("slug-not-in-registry case crashed: exit=$ec")
  echo "${CLR_FAIL}  ✗${CLR_RST} slug not in registry → hook completes"
fi

# --- TTL still GCs orphans (dispatch-guard side, after handover-envelope landing) ---
# Verify the dispatch-guard still drops stale entries (>30 min old) on next run.
DG_HOOK="$HOOK_DIR/coverage-expansion-dispatch-guard.sh"
OLD_ISO="2026-04-30T00:00:00Z"
write_registry '{"j-stale":{"description_prefix":"composer-j-stale: cycle 1","cycle":1,"started_at":"'"$OLD_ISO"'"}}'
out=$(printf '%s' "$(payload tool_name=Agent description='composer-j-fresh: cycle 1' prompt='cover j-fresh' cwd="$TMP_PROJ")" | bash "$DG_HOOK" 2>/dev/null)
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-stale" // empty' "$REG_FILE" >/dev/null 2>&1; then
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("TTL did not GC stale entry")
  echo "${CLR_FAIL}  ✗${CLR_RST} TTL still GCs orphans (stale entry should have been dropped)"
else
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} TTL still GCs orphans → stale entry dropped on next dispatch"
fi
TESTS_RUN=$((TESTS_RUN + 1))
if jq -e '.composers."j-fresh".cycle == 1' "$REG_FILE" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} TTL GC + fresh dispatch coexist → j-fresh registered"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("fresh dispatch did not register alongside TTL GC")
  echo "${CLR_FAIL}  ✗${CLR_RST} TTL GC + fresh dispatch coexist"
fi

rm -rf "$TMP_PROJ"

section "subagent-spillover-rewrite-gate (§2.6 hard enforcement)"
H="$HOOK_DIR/subagent-spillover-rewrite-gate.sh"
TMP_PROJ=$(mktemp -d)
mkdir -p "$TMP_PROJ/tests/e2e/docs/.subagent-returns"
cd "$TMP_PROJ" && git init -q && cd - >/dev/null

NL=$'\n'
ENV_REV='handover:'"$NL"'  role: reviewer-j-checkout'"$NL"'  cycle: 1'"$NL"'  status: improvements-needed'"$NL"'  next-action: redispatch composer cycle 2'"$NL"''"$NL"
ENV_REV_GREEN='handover:'"$NL"'  role: reviewer-j-checkout'"$NL"'  cycle: 1'"$NL"'  status: greenlight'"$NL"'  next-action: advance pass'"$NL"''"$NL"

# --- Compliant: spillover-shape body + spill file present → silent allow ---
SPILL_FILE="$TMP_PROJ/tests/e2e/docs/.subagent-returns/reviewer-j-checkout-1-c1.md"
echo "<!-- subagent-returns:reviewer:j-checkout:pass-1:cycle-1 -->" > "$SPILL_FILE"
COMPLIANT_BODY="${ENV_REV}status: improvements-needed${NL}journey: j-checkout${NL}pass: 1${NL}cycle: 1${NL}spill: tests/e2e/docs/.subagent-returns/reviewer-j-checkout-1-c1.md${NL}findings:${NL}  - **j-checkout-1-1-R-01**${NL}  - **j-checkout-1-1-R-02**"
PAYLOAD=$(payload last_assistant_message="$COMPLIANT_BODY" agent_id="agent-test-001" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
assert_allow "$H" "$PAYLOAD" "compliant body + spill file present → silent allow"

# --- Non-compliant: spill file absent → exit 2 with stderr feedback -------
rm -f "$SPILL_FILE"
rm -f "/tmp/sst-rewrite-counter-agent-test-002"
PAYLOAD=$(payload last_assistant_message="$COMPLIANT_BODY" agent_id="agent-test-002" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
assert_block_subagent "$H" "$PAYLOAD" "spill file absent → exit 2 + REWRITE-NEEDED stderr" "SPILLOVER-REWRITE-NEEDED"

# Counter incremented to 1.
TESTS_RUN=$((TESTS_RUN + 1))
if [ "$(cat /tmp/sst-rewrite-counter-agent-test-002 2>/dev/null)" = "1" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} non-compliant attempt 1 → counter=1"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("counter not incremented to 1"); echo "${CLR_FAIL}  ✗${CLR_RST} counter increment"
fi

# --- Non-compliant: body inlines sub-list → exit 2 ------------------------
echo "<!-- subagent-returns:reviewer:j-checkout:pass-1:cycle-1 -->" > "$SPILL_FILE"
INLINE_BODY="${ENV_REV}status: improvements-needed${NL}journey: j-checkout${NL}pass: 1${NL}cycle: 1${NL}${NL}missing-scenarios:${NL}  - **j-checkout-1-1-R-01** [must-fix] — mobile breakpoint missing${NL}    - why: high-value variant${NL}    - category: mobile${NL}    - suggested-test: add it"
rm -f "/tmp/sst-rewrite-counter-agent-test-003"
PAYLOAD=$(payload last_assistant_message="$INLINE_BODY" agent_id="agent-test-003" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
assert_block_subagent "$H" "$PAYLOAD" "body inlines sub-list → exit 2" "body inlines"

# --- Cap: counter=3 → exit 0 with [CAP-REACHED] stderr WARN ---------------
echo "3" > "/tmp/sst-rewrite-counter-agent-test-004"
rm -f "$SPILL_FILE"
PAYLOAD=$(payload last_assistant_message="$COMPLIANT_BODY" agent_id="agent-test-004" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
TESTS_RUN=$((TESTS_RUN + 1))
err=$(printf '%s' "$PAYLOAD" | bash "$H" 2>&1 >/dev/null) || ec=$?
ec=${ec:-0}
if [ "$ec" = "0" ] && echo "$err" | grep -q "CAP-REACHED"; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} counter≥cap → exit 0 with [CAP-REACHED] WARN"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("cap behavior: exit=$ec stderr=${err:0:200}"); echo "${CLR_FAIL}  ✗${CLR_RST} counter≥cap behavior"
fi
ec=0
# Counter cleared after cap.
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "/tmp/sst-rewrite-counter-agent-test-004" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} counter cleared after cap reached"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("counter not cleared at cap"); echo "${CLR_FAIL}  ✗${CLR_RST} counter cleanup at cap"
fi

# --- Counter cleared on success ------------------------------------------
echo "<!-- subagent-returns:reviewer:j-checkout:pass-1:cycle-1 -->" > "$SPILL_FILE"
echo "1" > "/tmp/sst-rewrite-counter-agent-test-005"
PAYLOAD=$(payload last_assistant_message="$COMPLIANT_BODY" agent_id="agent-test-005" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
assert_allow "$H" "$PAYLOAD" "rewrite became compliant → silent allow + counter cleared"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "/tmp/sst-rewrite-counter-agent-test-005" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1)); echo "${CLR_PASS}  ✓${CLR_RST} counter cleared on compliant return"
else
  TESTS_FAILED=$((TESTS_FAILED + 1)); FAIL_DETAILS+=("counter not cleared on success"); echo "${CLR_FAIL}  ✗${CLR_RST} counter cleanup on success"
fi

# --- Greenlight is exempt → silent allow ---------------------------------
GREEN_BODY="${ENV_REV_GREEN}status: greenlight${NL}journey: j-checkout${NL}pass: 1${NL}cycle: 1${NL}summary: All 8 expectations covered."
PAYLOAD=$(payload last_assistant_message="$GREEN_BODY" agent_id="agent-test-006" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
assert_allow "$H" "$PAYLOAD" "greenlight reviewer → silent allow"

# --- Non-reviewer roles → silent allow -----------------------------------
ENV_COMP='handover:'"$NL"'  role: composer-j-checkout'"$NL"'  cycle: 1'"$NL"'  status: new-tests-landed'"$NL"'  next-action: dispatch reviewer'"$NL"''"$NL"
COMP_BODY="${ENV_COMP}status: new-tests-landed${NL}tests-added: 6${NL}run-time: 12s"
PAYLOAD=$(payload last_assistant_message="$COMP_BODY" agent_id="agent-test-007" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
assert_allow "$H" "$PAYLOAD" "composer return → silent allow (out of §2.6 scope)"

# --- No envelope → silent allow (defer to PostToolUse audit) -------------
NO_ENV_BODY="status: improvements-needed${NL}journey: j-checkout${NL}pass: 1${NL}cycle: 1"
PAYLOAD=$(payload last_assistant_message="$NO_ENV_BODY" agent_id="agent-test-008" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
assert_allow "$H" "$PAYLOAD" "no envelope → silent allow (defer to schema-guard)"

# --- Empty last_assistant_message → silent allow -------------------------
PAYLOAD=$(payload last_assistant_message="" agent_id="agent-test-009" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
assert_allow "$H" "$PAYLOAD" "empty last_assistant_message → silent allow"

# --- Missing journey/pass/cycle → silent allow (defer) -------------------
INCOMPLETE_BODY="${ENV_REV}status: improvements-needed${NL}findings:${NL}  - **j-checkout-1-1-R-01**"
PAYLOAD=$(payload last_assistant_message="$INCOMPLETE_BODY" agent_id="agent-test-010" cwd="$TMP_PROJ" hook_event_name=SubagentStop)
assert_allow "$H" "$PAYLOAD" "missing journey/pass/cycle → silent allow (PostToolUse schema-guard catches)"

# Cleanup
rm -f /tmp/sst-rewrite-counter-agent-test-*
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
