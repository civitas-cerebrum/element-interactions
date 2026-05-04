#!/bin/bash
H="$HOOK_DIR/phase-validator-dispatch-required.sh"

# Each test sets up its own temp repo so ledger mutations are isolated.
make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs"
  echo "$d"
}

section "phase-validator-dispatch-required: PreToolUse — gate Phase 5 advance"

# T1: no ledger, composer dispatch → DENY
REPO=$(make_repo)
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$REPO")" "no ledger + composer dispatch → DENY" "before phase-validator-4 greenlight"
rm -rf "$REPO"

# T2: ledger with Phase 4 greenlight → composer ALLOW
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"greenlight","validator":"phase-validator-4","cycle":1,"at":"2026-05-02T00:00:00Z","evidence":["tests/e2e/docs/journey-map.md"]}}}
EOF
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$REPO")" "Phase 4 greenlight + composer dispatch → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='reviewer-j-checkout: cycle 1' prompt='review j-checkout' cwd="$REPO")" "Phase 4 greenlight + reviewer dispatch → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='probe-j-checkout: pass 4' prompt='probe j-checkout' cwd="$REPO")" "Phase 4 greenlight + probe dispatch → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='process-validator-stage-a-wave: validate' prompt='validate' cwd="$REPO")" "Phase 4 greenlight + process-validator dispatch → ALLOW"
rm -rf "$REPO"

# T3: ledger with Phase 4 in-progress (improvements-needed cycle 1) → composer DENY
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"in-progress","validator":"phase-validator-4","cycle":1,"at":"2026-05-02T00:00:00Z"}}}
EOF
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$REPO")" "Phase 4 in-progress + composer dispatch → DENY" "before phase-validator-4 greenlight"
rm -rf "$REPO"

# T4: ledger with Phase 4 stalled (cycle 10 cap) → composer DENY with stalled message
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"blocked-phase-validator-stalled","validator":"phase-validator-4","cycle":10,"at":"2026-05-02T00:00:00Z","unresolved-findings":["pv-4-01","pv-4-02"]}}}
EOF
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$REPO")" "Phase 4 stalled + composer dispatch → DENY (stalled)" "Phase 4 is stalled"
rm -rf "$REPO"

section "phase-validator-dispatch-required: PreToolUse — phase-validator dispatches always allowed"

# T5: phase-validator dispatch with no ledger → ALLOW (gate doesn't gate itself)
REPO=$(make_repo)
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase-validator-4: cycle 1' prompt='verify Phase 4' cwd="$REPO")" "phase-validator-4 with no ledger → ALLOW"
rm -rf "$REPO"

# T6: phase-validator dispatch with stalled prior phase → ALLOW (gate doesn't gate itself)
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"blocked-phase-validator-stalled","validator":"phase-validator-4","cycle":10,"at":"2026-05-02T00:00:00Z","unresolved-findings":["pv-4-01"]}}}
EOF
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase-validator-5: cycle 1' prompt='verify Phase 5' cwd="$REPO")" "phase-validator-5 with stalled Phase 4 → ALLOW"
rm -rf "$REPO"

section "phase-validator-dispatch-required: PreToolUse — non-phase-mapped prefixes silent allow"

REPO=$(make_repo)
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase1-root: discovery' prompt='discover root' cwd="$REPO")" "phase1- → silent allow (Phase 4 internal, not yet phase-mapped)"
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='stage2-cart-form: inspect' prompt='inspect cart' cwd="$REPO")" "stage2- → silent allow (Phase 3 internal, not yet phase-mapped)"
rm -rf "$REPO"

# cleanup-* IS in the entering-Phase-5 list (coverage-expansion's post-pass-5 dedup role).
REPO=$(make_repo)
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='cleanup-ledger: dedup' prompt='cleanup' cwd="$REPO")" "cleanup-ledger with no ledger → DENY (coverage-expansion role = entering Phase 5)" "before phase-validator-4 greenlight"
rm -rf "$REPO"

section "phase-validator-dispatch-required: PreToolUse — tool-name filtering"

REPO=$(make_repo)
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='echo composer-j-x' cwd="$REPO")" "Bash invocation → silent allow"
assert_allow "$H" "$(payload tool_name=Write hook_event_name=PreToolUse file_path='/x' cwd="$REPO")" "Write invocation → silent allow"
rm -rf "$REPO"

section "phase-validator-dispatch-required: PostToolUse — record ledger on greenlight"

# T9: phase-validator-4 returns greenlight → ledger written
REPO=$(make_repo)
GREEN_RETURN='status: greenlight
phase: 4
sub-skill: journey-mapping
exit-criteria-checked:
  - criterion: journey-map.md sentinel on line 1
    satisfied: true
    evidence: tests/e2e/docs/journey-map.md
  - criterion: coverage-checkpoint signature present
    satisfied: true
    evidence: tests/e2e/docs/journey-map.md (line 245)
findings: []
summary: Phase 4 verified.'
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='phase-validator-4: cycle 1' response_text="$GREEN_RETURN" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
LEDGER_STATUS=$(jq -r '.phases."4".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
if [ "$LEDGER_STATUS" = "greenlight" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} phase-validator-4 greenlight → ledger.phases.4.status = greenlight"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("greenlight ledger write: expected status=greenlight, got '$LEDGER_STATUS'")
  echo "${CLR_FAIL}  ✗${CLR_RST} phase-validator-4 greenlight ledger write"
fi
rm -rf "$REPO"

section "phase-validator-dispatch-required: PostToolUse — increment cycle on improvements-needed"

# T10: phase-validator-4 cycle 1 returns improvements-needed → ledger.cycle = 1, status = in-progress
REPO=$(make_repo)
IN_RETURN='status: improvements-needed
phase: 4
sub-skill: journey-mapping
exit-criteria-checked:
  - criterion: journey-map.md sentinel on line 1
    satisfied: false
    evidence: absent
findings:
  - **pv-4-01** [must-fix] — sentinel missing
    - criterion: journey-map.md sentinel on line 1
    - issue: line 1 is "# Map" not the sentinel
    - fix: prepend the sentinel
summary: 1 finding.'
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='phase-validator-4: cycle 1' response_text="$IN_RETURN" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
LEDGER_STATUS=$(jq -r '.phases."4".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
LEDGER_CYCLE=$(jq -r '.phases."4".cycle // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
if [ "$LEDGER_STATUS" = "in-progress" ] && [ "$LEDGER_CYCLE" = "1" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} phase-validator-4 cycle 1 improvements-needed → ledger.status=in-progress, cycle=1"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("improvements-needed ledger write: status=$LEDGER_STATUS, cycle=$LEDGER_CYCLE")
  echo "${CLR_FAIL}  ✗${CLR_RST} phase-validator-4 cycle 1 improvements-needed ledger write"
fi
rm -rf "$REPO"

section "phase-validator-dispatch-required: PostToolUse — cycle 10 cap → blocked-phase-validator-stalled"

# T11: prior ledger shows cycle 9; this cycle 10 returns improvements-needed → stalled
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"in-progress","validator":"phase-validator-4","cycle":9,"at":"2026-05-02T00:00:00Z"}}}
EOF
IN_RETURN='status: improvements-needed
phase: 4
exit-criteria-checked:
  - criterion: x
    satisfied: false
findings:
  - **pv-4-01** [must-fix] — still missing
    - criterion: x
    - issue: y
    - fix: z
  - **pv-4-02** [must-fix] — also still missing
    - criterion: a
    - issue: b
    - fix: c
summary: 2 findings, cycle 10.'
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='phase-validator-4: cycle 10' response_text="$IN_RETURN" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
LEDGER_STATUS=$(jq -r '.phases."4".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
LEDGER_CYCLE=$(jq -r '.phases."4".cycle // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
LEDGER_FINDINGS=$(jq -r '.phases."4"."unresolved-findings" | length' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo 0)
if [ "$LEDGER_STATUS" = "blocked-phase-validator-stalled" ] && [ "$LEDGER_CYCLE" = "10" ] && [ "$LEDGER_FINDINGS" = "2" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} cycle 10 improvements-needed → blocked-phase-validator-stalled with 2 unresolved findings"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("cycle 10 stalled: status=$LEDGER_STATUS, cycle=$LEDGER_CYCLE, findings=$LEDGER_FINDINGS")
  echo "${CLR_FAIL}  ✗${CLR_RST} cycle 10 stalled ledger write"
fi
rm -rf "$REPO"

section "phase-validator-dispatch-required: PostToolUse — non-phase-validator returns silent"

REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='composer-j-checkout: cycle 1' response_text='status: new-tests-landed' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} composer-* PostToolUse → no ledger written"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("composer-* should not write ledger")
  echo "${CLR_FAIL}  ✗${CLR_RST} composer-* should not write ledger"
fi
rm -rf "$REPO"
