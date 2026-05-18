#!/bin/bash
# Tests for workflow-reviewer-brief-gate.sh — PreToolUse:Agent gate that
# denies workflow-reviewer-* dispatches whose brief lacks the canonical
# ledger reference, a verification verb, or minimum length.
H="$HOOK_DIR/workflow-reviewer-brief-gate.sh"

# Helper: a brief that satisfies all three checks (ledger + Read + ≥400 chars).
GOOD_BRIEF='You are workflow-reviewer-phase1. Read the ledger at tests/e2e/docs/onboarding-status.json and verify that phases[0].handoverEnvelope + .deliverables match the Phase 1 exit criteria documented in skills/onboarding/SKILL.md. The canonical return shape is workflow-reviewer.schema.json. Inspect the on-disk Playwright config, tests/e2e/fixtures/, tests/e2e/docs/ structure, and confirm .gitignore additions. Emit verdict: approve only after this verification; otherwise verdict: reject with surgical findings naming each gap.'

section "reviewer-brief-gate: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/tmp/x')" "Write → silent allow"

section "reviewer-brief-gate: non-reviewer Agent prefixes are silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-x' prompt='compose')" "composer- → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='probe-j-y' prompt='probe')" "probe- → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-1' prompt='validate')" "phase-validator- → silent allow"

section "reviewer-brief-gate: well-formed brief allows"
assert_allow "$H" "$(payload tool_name=Agent description='workflow-reviewer-phase1' prompt="$GOOD_BRIEF")" "complete brief → ALLOW"

section "reviewer-brief-gate: missing ledger reference DENIES"
NO_LEDGER='You are workflow-reviewer-phase1. Read the deliverables and verify them against the exit criteria. Use the workflow-reviewer.schema.json shape. Inspect the on-disk Playwright config and fixtures. Emit verdict: approve only after this verification; otherwise verdict: reject with surgical findings naming each gap. The reviewer must run the methodology checklist in full.'
assert_deny "$H" "$(payload tool_name=Agent description='workflow-reviewer-phase1' prompt="$NO_LEDGER")" "missing ledger ref → DENY" "Missing ledger reference"

section "reviewer-brief-gate: missing verification verb DENIES"
NO_VERB='You are workflow-reviewer-phase1. The dispatcher knows that phases[0].handoverEnvelope at tests/e2e/docs/onboarding-status.json shows everything is fine. Phase 1 is done. The deliverables array is populated. The status is completed. The handoverEnvelope has the right shape. The exit criteria from skills/onboarding/SKILL.md are satisfied. Return verdict approve with the workflow-reviewer.schema.json shape.'
assert_deny "$H" "$(payload tool_name=Agent description='workflow-reviewer-phase1' prompt="$NO_VERB")" "missing verification verb → DENY" "Missing verification verb"

section "reviewer-brief-gate: too-short brief DENIES"
SHORT='workflow-reviewer-phase1: Read tests/e2e/docs/onboarding-status.json, approve if good.'
assert_deny "$H" "$(payload tool_name=Agent description='workflow-reviewer-phase1' prompt="$SHORT")" "too short → DENY" "Brief too short"

section "reviewer-brief-gate: multiple violations enumerated in a single DENY"
BAD='do the thing'
assert_deny "$H" "$(payload tool_name=Agent description='workflow-reviewer-pass2' prompt="$BAD")" "all three violations → DENY" "Brief too short"

section "reviewer-brief-gate: bypass env disables the gate"
BYPASS_INPUT=$(payload tool_name=Agent description='workflow-reviewer-cycle1' prompt='short')
TESTS_RUN=$((TESTS_RUN+1))
BYPASS_OUT=$(printf '%s' "$BYPASS_INPUT" | WORKFLOW_REVIEWER_BRIEF_GATE=off bash "$H" 2>/dev/null)
BYPASS_EC=$?
if [ -z "$BYPASS_OUT" ] && [ "$BYPASS_EC" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED+1)); echo "${CLR_PASS}  ✓${CLR_RST} WORKFLOW_REVIEWER_BRIEF_GATE=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED+1)); echo "${CLR_FAIL}  ✗${CLR_RST} bypass did not disable the gate"
fi

section "reviewer-brief-gate: workflow-reviewer-pass<N> and -cycle<N> also gated"
assert_deny "$H" "$(payload tool_name=Agent description='workflow-reviewer-pass2' prompt='quick approval')" "pass2 short brief → DENY" "Brief too short"
assert_deny "$H" "$(payload tool_name=Agent description='workflow-reviewer-cycle1' prompt='quick approval')" "cycle1 short brief → DENY" "Brief too short"
