#!/bin/bash
# Tests for subagent-return-schema-guard.sh — JSON-Schema-backed validator
# (WARN mode). Validates subagent returns against schemas/subagent-returns/
# using Ajv. Hook fires on PostToolUse:Agent only.
H="$HOOK_DIR/subagent-return-schema-guard.sh"

section "subagent-return-schema: tool-name + description filtering"
assert_allow "$H" "$(payload tool_name=Bash command='echo hi')" "Bash tool → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='phase1-root' response_text='free-form scaffold output')" "phase1- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='stage2-cart' response_text='free-form page repo entries')" "stage2- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-ledger' response_text='free-form cleanup summary')" "cleanup- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='unknown-role-x' response_text='whatever')" "unknown prefix → silent allow"

section "subagent-return-schema: empty / null responses are silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout' response_text='null')" "literal null → silent allow"

section "subagent-return-schema: well-formed composer return is silent allow"
GOOD_COMPOSER="handover:
  role: composer-j-checkout-1-c1
  cycle: 1
  status: new-tests-landed
  next-action: reviewer
journey: j-checkout
pass: 1
tests-added: 3
run-time: 42s
summary: Added three regression scenarios covering the checkout journey."
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout-1-c1' response_text="$GOOD_COMPOSER")" "well-formed composer → silent allow"

section "subagent-return-schema: composer missing handover envelope WARNs"
NO_ENVELOPE="journey: j-checkout
tests-added: 2
run-time: 30s
summary: some tests"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-checkout-1-c1' response_text="$NO_ENVELOPE")" "missing envelope → WARN" "must have required property 'handover'"

section "subagent-return-schema: composer status=new-tests-landed missing tests-added WARNs"
MISSING_FIELD="handover:
  role: composer-j-x-1-c1
  cycle: 1
  status: new-tests-landed
  next-action: reviewer
journey: j-x
pass: 1"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-x-1-c1' response_text="$MISSING_FIELD")" "missing tests-added → WARN" "tests-added"

section "subagent-return-schema: composer invalid status enum WARNs"
INVALID_STATUS="handover:
  role: composer-j-x-1-c1
  cycle: 1
  status: no-new-tests-by-rationalisation
  next-action: reviewer
journey: j-x
pass: 1"
assert_warn "$H" "$(payload tool_name=Agent description='composer-j-x-1-c1' response_text="$INVALID_STATUS")" "invalid status enum → WARN" "allowed values"

section "subagent-return-schema: reviewer improvements-needed without finding arrays WARNs"
IMPROVEMENTS_NO_FINDINGS="handover:
  role: reviewer-j-x-1-c1
  cycle: 1
  status: improvements-needed
  next-action: composer
journey: j-x
pass: 1
cycle: 1
summary: improvements needed but no finding arrays"
assert_warn "$H" "$(payload tool_name=Agent description='reviewer-j-x-1-c1' response_text="$IMPROVEMENTS_NO_FINDINGS")" "improvements-needed without findings → WARN" "missing-scenarios"

section "subagent-return-schema: well-formed reviewer return is silent allow"
GOOD_REVIEWER="handover:
  role: reviewer-j-checkout-1-c1
  cycle: 1
  status: greenlight
  next-action: orchestrator
journey: j-checkout
pass: 1
cycle: 1
summary: all expectations covered"
assert_allow "$H" "$(payload tool_name=Agent description='reviewer-j-checkout-1-c1' response_text="$GOOD_REVIEWER")" "well-formed reviewer → silent allow"

section "subagent-return-schema: probe findings-emitted without count WARNs"
PROBE_NO_COUNT="handover:
  role: probe-j-checkout-4-c1
  cycle: 1
  status: findings-emitted
  next-action: orchestrator
journey: j-checkout"
assert_warn "$H" "$(payload tool_name=Agent description='probe-j-checkout-4-c1' response_text="$PROBE_NO_COUNT")" "probe findings-emitted without count → WARN" "findings-emitted"

section "subagent-return-schema: well-formed probe return is silent allow"
GOOD_PROBE="handover:
  role: probe-j-checkout-4-c1
  cycle: 1
  status: clean
  next-action: orchestrator
journey: j-checkout
summary: No adversarial findings discovered."
assert_allow "$H" "$(payload tool_name=Agent description='probe-j-checkout-4-c1' response_text="$GOOD_PROBE")" "well-formed probe → silent allow"

section "subagent-return-schema: phase-validator greenlight without exit-criteria-checked WARNs"
PV_NO_EXIT_CRITERIA="handover:
  role: phase-validator-2
  cycle: 1
  status: greenlight
  next-action: orchestrator
phase: 2
summary: phase 2 complete"
assert_warn "$H" "$(payload tool_name=Agent description='phase-validator-2' response_text="$PV_NO_EXIT_CRITERIA")" "phase-validator greenlight no exit-criteria-checked → WARN" "exit-criteria-checked"

section "subagent-return-schema: well-formed phase-validator greenlight is silent allow"
GOOD_PV="handover:
  role: phase-validator-3
  cycle: 1
  status: greenlight
  next-action: orchestrator
phase: 3
exit-criteria-checked:
  - criterion: happy-path spec exists
    satisfied: true
summary: phase 3 complete"
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-3' response_text="$GOOD_PV")" "well-formed phase-validator greenlight → silent allow"
