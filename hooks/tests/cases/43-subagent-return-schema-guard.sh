#!/bin/bash
# Tests for subagent-return-schema-guard.sh — canonical-return-shape validator
# (WARN mode). Validates both the §2.0 handover envelope and per-role body
# schemas. Hook fires on PostToolUse:Agent only.
H="$HOOK_DIR/subagent-return-schema-guard.sh"

section "subagent-return-schema: tool-name + description filtering"
assert_allow "$H" "$(payload tool_name=Bash command='echo hi')" "Bash tool → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='phase1-root' response_text='free-form scaffold output')" "phase1- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='stage2-cart' response_text='free-form page repo entries')" "stage2- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-ledger' response_text='free-form cleanup summary')" "cleanup- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='unknown-role-x' response_text='whatever')" "unknown prefix → silent allow"

section "subagent-return-schema: empty / null responses are silent allow"
# A response that resolves to literally "null" / "{}" / "[]" — typically
# from an aborted subagent — is treated as silent allow per the hook's
# RESPONSE-shape gate. Skipping the empty-string variant: the
# tool_response.output="" path serializes the whole object back to
# {"output":""} via the jq fallback, which is non-empty and therefore
# validated (warns about missing schema fields, which is correct
# behaviour — empty output IS malformed).
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout' response_text='null')" "literal null → silent allow"

section "subagent-return-schema: well-formed composer return is silent allow"
GOOD_COMPOSER="handover:
  role: composer-j-checkout-1-c1
  cycle: 1
  status: new-tests-landed
  next-action: reviewer
status: new-tests-landed
journey: j-checkout
pass: 1
cycle: 1
tests-added: 3
run-time: 42s"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout-1-c1' response_text="$GOOD_COMPOSER")" "well-formed composer → silent allow"

section "subagent-return-schema: composer missing handover envelope WARNs"
NO_ENVELOPE="status: new-tests-landed
journey: j-checkout
tests-added: 2
run-time: 30s"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-checkout-1-c1' response_text="$NO_ENVELOPE")" "missing envelope → WARN" "envelope missing entirely"

section "subagent-return-schema: composer status=new-tests-landed missing tests-added WARNs"
MISSING_FIELD="handover:
  role: composer-j-x-1-c1
  cycle: 1
  status: new-tests-landed
  next-action: reviewer
status: new-tests-landed
journey: j-x"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-x-1-c1' response_text="$MISSING_FIELD")" "missing tests-added → WARN" "tests-added"

section "subagent-return-schema: composer banned token WARNs"
BANNED_TOKEN="handover:
  role: composer-j-x-1-c1
  cycle: 1
  status: no-new-tests-by-rationalisation
  next-action: reviewer
status: no-new-tests-by-rationalisation"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-x-1-c1' response_text="$BANNED_TOKEN")" "banned rationalisation token → WARN" "no-new-tests-by-rationalisation"

section "subagent-return-schema: reviewer greenlight without summary WARNs"
GREENLIGHT_NO_SUMMARY="handover:
  role: reviewer-j-checkout-1-c1
  cycle: 1
  status: greenlight
  next-action: orchestrator
status: greenlight
journey: j-checkout
pass: 1
cycle: 1"
assert_warn "$H" "$(payload tool_name=Agent description='reviewer-j-checkout-1-c1' response_text="$GREENLIGHT_NO_SUMMARY")" "reviewer greenlight no summary → WARN" "summary"

section "subagent-return-schema: well-formed reviewer return is silent allow"
GOOD_REVIEWER="handover:
  role: reviewer-j-checkout-1-c1
  cycle: 1
  status: greenlight
  next-action: orchestrator
status: greenlight
journey: j-checkout
pass: 1
cycle: 1
summary: all expectations covered"
assert_allow "$H" "$(payload tool_name=Agent description='reviewer-j-checkout-1-c1' response_text="$GOOD_REVIEWER")" "well-formed reviewer → silent allow"

section "subagent-return-schema: reviewer banned 'nice-to-have' token WARNs"
NICE_TO_HAVE="handover:
  role: reviewer-j-x-1-c1
  cycle: 1
  status: improvements-needed
  next-action: composer
status: improvements-needed
journey: j-x
pass: 1
cycle: 1
findings:
  - nice-to-have: extra coverage"
assert_warn "$H" "$(payload tool_name=Agent description='reviewer-j-x-1-c1' response_text="$NICE_TO_HAVE")" "nice-to-have banned → WARN" "nice-to-have"

section "subagent-return-schema: probe missing fields WARNs"
PROBE_MISSING="handover:
  role: probe-j-checkout-4-c1
  cycle: 1
  status: clean
  next-action: orchestrator"
assert_warn "$H" "$(payload tool_name=Agent description='probe-j-checkout-4-c1' response_text="$PROBE_MISSING")" "probe missing fields → WARN" "probes:"

section "subagent-return-schema: well-formed probe return is silent allow"
GOOD_PROBE="handover:
  role: probe-j-checkout-4-c1
  cycle: 1
  status: clean
  next-action: orchestrator
probes: 5
boundaries: 3
findings: 0"
assert_allow "$H" "$(payload tool_name=Agent description='probe-j-checkout-4-c1' response_text="$GOOD_PROBE")" "well-formed probe → silent allow"

section "subagent-return-schema: phase-validator on greenlight without findings:[] WARNs"
PV_NO_EMPTY_FINDINGS="handover:
  role: phase-validator-2
  cycle: 1
  status: greenlight
  next-action: orchestrator
status: greenlight
phase: 2
exit-criteria-checked:
  - criterion: app-context.md exists
summary: phase 2 complete"
assert_warn "$H" "$(payload tool_name=Agent description='phase-validator-2' response_text="$PV_NO_EMPTY_FINDINGS")" "phase-validator greenlight no findings:[] → WARN" "findings: []"

section "subagent-return-schema: well-formed phase-validator greenlight is silent allow"
GOOD_PV="handover:
  role: phase-validator-3
  cycle: 1
  status: greenlight
  next-action: orchestrator
status: greenlight
phase: 3
exit-criteria-checked:
  - criterion: happy-path spec exists
summary: phase 3 complete
findings: []"
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-3' response_text="$GOOD_PV")" "well-formed phase-validator greenlight → silent allow"
