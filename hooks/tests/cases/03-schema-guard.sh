#!/bin/bash
H="$HOOK_DIR/subagent-return-schema-guard.sh"

section "schema-guard: composer (Stage A)"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: new-tests-landed
tests-added: 6
run-time: 12s')" "composer status=new-tests-landed full → ALLOW"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='I added some tests')" "composer no status → WARN" "status: <new-tests-landed"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: new-tests-landed
some other text')" "composer status=new-tests-landed missing tests-added → WARN" "tests-added"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: covered-exhaustively

| Expectation | Covering spec | Test name |
|---|---|---|
| happy path | tests/e2e/j-checkout.spec.ts | covers happy |')" "composer covered-exhaustively with mapping table → ALLOW"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: covered-exhaustively

I think it is covered.')" "composer covered-exhaustively no mapping table → WARN" "mapping table"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: blocked

I cannot work on this.')" "composer blocked missing reason → WARN" "reason"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: blocked
reason: tenant data missing — admin seed user not present in demo tenant')" "composer blocked with reason → ALLOW"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: skipped
reason: out of scope')" "composer skipped without authorizer → WARN" "authorizer"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: skipped
reason: out of scope
authorizer: user')" "composer skipped with reason+authorizer → ALLOW"

section "schema-guard: composer banned tokens"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: no-new-tests-by-rationalisation
I judged this redundant.')" "composer banned 'no-new-tests-by-rationalisation' → WARN" "no-new-tests-by-rationalisation"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' response_text='status: no-new-tests')" "composer legacy 'status: no-new-tests' → WARN" "no-new-tests"

section "schema-guard: reviewer (Stage B per §2.4)"
assert_allow "$H" "$(payload tool_name=Agent description='reviewer-j-checkout: cycle 1' response_text='status: greenlight
journey: j-checkout
pass: 1
cycle: 1
summary: All 8 test-expectations covered, craft clean, live DOM matches assertions.')" "reviewer greenlight + summary → ALLOW"
assert_warn "$H" "$(payload tool_name=Agent description='reviewer-j-checkout: cycle 1' response_text='status: greenlight
journey: j-checkout
pass: 1
cycle: 1')" "reviewer greenlight missing summary → WARN" "summary"
assert_allow "$H" "$(payload tool_name=Agent description='reviewer-j-checkout: cycle 2' response_text='status: improvements-needed
journey: j-checkout
pass: 1
cycle: 2

missing-scenarios:
  - **j-checkout-1-2-R-01** [must-fix] — mobile variant missing
    - why: Test expectations bullet 4 mentions mobile')" "reviewer improvements-needed + missing-scenarios → ALLOW"
assert_warn "$H" "$(payload tool_name=Agent description='reviewer-j-checkout: cycle 2' response_text='status: improvements-needed
journey: j-checkout
pass: 1
cycle: 2')" "reviewer improvements-needed without findings sub-list → WARN" "missing-scenarios"

section "schema-guard: reviewer banned tokens"
assert_warn "$H" "$(payload tool_name=Agent description='reviewer-j-checkout: cycle 1' response_text='status: greenlight
journey: j-checkout
pass: 1
cycle: 1
summary: clean
notes:
  - mobile UX could be better')" "reviewer banned 'notes:' → WARN" "notes"
assert_warn "$H" "$(payload tool_name=Agent description='reviewer-j-checkout: cycle 1' response_text='status: greenlight-with-notes
journey: j-checkout
pass: 1
cycle: 1')" "reviewer banned 'greenlight-with-notes' → WARN" "greenlight-with-notes"

section "schema-guard: probe (passes 4-5)"
assert_allow "$H" "$(payload tool_name=Agent description='probe-j-checkout: pass 4' response_text='probes: 12
boundaries: 8
findings:
  - **j-checkout-4-01** [high] — server accepts negative quantity')" "probe full shape → ALLOW"
assert_warn "$H" "$(payload tool_name=Agent description='probe-j-checkout: pass 4' response_text='probes: 12
findings: []')" "probe missing boundaries → WARN" "boundaries"
assert_warn "$H" "$(payload tool_name=Agent description='probe-j-checkout: pass 4' response_text='probes: 12
boundaries: 8
findings:
  - **AF-04-01** [high] — legacy finding ID')" "probe with banned AF- prefix → WARN" "AF-NN"

section "schema-guard: process-validator"
assert_allow "$H" "$(payload tool_name=Agent description='process-validator-stage-a-wave: validate' response_text='status: greenlight
findings: []
summary: 16 dispatches conform.')" "process-validator full → ALLOW"
assert_warn "$H" "$(payload tool_name=Agent description='process-validator-stage-a-wave: validate' response_text='status: greenlight
findings: []')" "process-validator missing summary → WARN" "summary"

section "schema-guard: phase-validator (§2.5)"
PV_GREEN_FULL='status: greenlight
phase: 5
sub-skill: coverage-expansion
exit-criteria-checked:
  - criterion: coverage-expansion-state.json status complete
    satisfied: true
    evidence: tests/e2e/docs/coverage-expansion-state.json
findings: []
summary: All 5 passes + cleanup verified.'
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' response_text="$PV_GREEN_FULL")" "phase-validator greenlight full → ALLOW"

PV_GREEN_NO_SUMMARY='status: greenlight
phase: 5
exit-criteria-checked:
  - criterion: x
    satisfied: true
findings: []'
assert_warn "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' response_text="$PV_GREEN_NO_SUMMARY")" "phase-validator greenlight missing summary → WARN" "summary"

PV_GREEN_NO_EMPTY_FINDINGS='status: greenlight
phase: 5
exit-criteria-checked:
  - criterion: x
    satisfied: true
summary: ok'
assert_warn "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' response_text="$PV_GREEN_NO_EMPTY_FINDINGS")" "phase-validator greenlight missing findings: [] → WARN" "findings: []"

PV_NO_PHASE='status: greenlight
exit-criteria-checked:
  - criterion: x
    satisfied: true
findings: []
summary: ok'
assert_warn "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' response_text="$PV_NO_PHASE")" "phase-validator missing phase: → WARN" "phase: <1-7>"

PV_NO_CRITERIA='status: greenlight
phase: 5
findings: []
summary: ok'
assert_warn "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' response_text="$PV_NO_CRITERIA")" "phase-validator missing exit-criteria-checked → WARN" "exit-criteria-checked"

PV_IN_FULL='status: improvements-needed
phase: 5
sub-skill: coverage-expansion
exit-criteria-checked:
  - criterion: all 5 passes complete
    satisfied: false
    evidence: absent — passes 4 and 5 missing
findings:
  - **pv-5-01** [must-fix] — Pass 4 not run
    - criterion: every journey terminal review_status on every pass
    - issue: state file lacks 4-adversarial entry
    - fix: re-invoke coverage-expansion with resume marker
summary: 1 finding — Pass 4 missing.'
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' response_text="$PV_IN_FULL")" "phase-validator improvements-needed full → ALLOW"

PV_IN_NO_FINDINGS='status: improvements-needed
phase: 5
exit-criteria-checked:
  - criterion: x
    satisfied: false
    evidence: absent
findings:
summary: missing pass.'
assert_warn "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' response_text="$PV_IN_NO_FINDINGS")" "phase-validator improvements-needed without pv- finding → WARN" "pv-<phase>-<nn>"

PV_BANNED='status: greenlight
phase: 5
exit-criteria-checked:
  - criterion: x
    satisfied: true
findings: []
summary: ok
notes:
  - extra observation'
assert_warn "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' response_text="$PV_BANNED")" "phase-validator with banned notes: → WARN" "notes"

section "schema-guard: roles that skip validation"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-ledger: dedup' response_text='Consolidated 4 cross-cutting findings.')" "cleanup → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='phase1-root: discovery' response_text='## Site map\n- /\n- /login')" "phase1 → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='stage2-cart: inspect' response_text='cart selectors documented')" "stage2 → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='j-x: legacy bare prefix' response_text='whatever')" "bare j- (legacy, blocked upstream) → silent allow"

section "schema-guard: defensive payload extraction"
# tool_response.output as array of {type, text}
assert_allow "$H" '{"tool_name":"Agent","tool_input":{"description":"composer-j-x:"},"tool_response":{"output":[{"type":"text","text":"status: new-tests-landed\ntests-added: 1\nrun-time: 1s"}]}}' "composer return as text-block array → ALLOW"
# tool_response top-level string
assert_warn "$H" '{"tool_name":"Agent","tool_input":{"description":"composer-j-x:"},"tool_response":"status: new-tests-landed"}' "composer return as top-level string → WARN missing fields"
# Empty / null tool_response → silent allow
assert_allow "$H" '{"tool_name":"Agent","tool_input":{"description":"composer-j-x:"},"tool_response":null}' "tool_response=null → silent allow"
assert_allow "$H" '{"tool_name":"Agent","tool_input":{"description":"composer-j-x:"},"tool_response":{}}' "tool_response={} → silent allow"
assert_allow "$H" '{"tool_name":"Agent","tool_input":{"description":"composer-j-x:"},"tool_response":""}' "tool_response='' → silent allow"

section "schema-guard: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='git commit -m \"x\"')" "Bash invocation → silent allow"
