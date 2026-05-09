#!/bin/bash
# 26-replicate-state-fake-dispatches.sh — exploit-replication test for
# hooks/coverage-state-schema-guard.sh.
#
# Replicates the BookHive Run-2 bypass byte-for-byte:
#   - Phase ledger: phases 1-4 greenlit, phases 5-7 absent (verbatim).
#   - Sentinel: absent.
#   - Diff: the verbatim 136-line coverage-expansion-state.json the bypass
#     produced — `currentPass: 1`, 6 dispatches all stamped
#     `review_status: "blocked-dispatch-failure"` + `stage_b_cycles: 0` +
#     `stage_b_deferral_reason: "context-budget — orchestrator exit #2"`.
#
# Asserts:
#   - DENY fires (the framing-token detector catches "context-budget —
#     orchestrator exit #2" inside the reason fields).
#   - Deny reason names the no-skip contract / sentinel path.
#
# Inverse case: same shape but with stage_b_deferral_reason set to a
# legitimate transport failure ("transport timeout: connection reset") →
# allow (real dispatch failure, not agent-chosen scope reduction).

H="$HOOK_DIR/coverage-state-schema-guard.sh"
FIX="$HOOK_DIR/tests/fixtures/bookhive-bypass-artifacts"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

plant_ledger() {
  cp "$FIX/onboarding-phase-ledger-bypass.json" "$1/tests/e2e/docs/onboarding-phase-ledger.json"
}

# The verbatim 136-line state file the bypass committed.
STATE_BYPASS_BLOB=$(cat "$FIX/coverage-expansion-state-bypass.json")

section "exploit-replication 26a: verbatim state-file bypass write → DENY"

REPO=$(make_repo)
plant_ledger "$REPO"
assert_deny "$H" "$(payload tool_name=Write \
  file_path="$REPO/tests/e2e/docs/coverage-expansion-state.json" \
  content="$STATE_BYPASS_BLOB")" \
  "verbatim 136-line bypass state file Write → DENY" "framing"
rm -rf "$REPO"

section "exploit-replication 26b: deny reason names no-skip + sentinel + framing"

REPO=$(make_repo)
plant_ledger "$REPO"
run_hook "$H" "$(payload tool_name=Write \
  file_path="$REPO/tests/e2e/docs/coverage-expansion-state.json" \
  content="$STATE_BYPASS_BLOB")"

TESTS_RUN=$((TESTS_RUN + 1))
REASON=$(echo "$HOOK_OUT" | "$JQ" -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null)
# The schema-guard's deny payload (the "framing in reason field" branch)
# names the kernel rule, sentinel path, and the framing-token-detected
# justification.
if echo "$REASON" | grep -qF -- ".claude/onboarding-stop-authorized" && \
   echo "$REASON" | grep -qiE "(kernel rule|no-skip|onboarding/SKILL.md)" && \
   echo "$REASON" | grep -qF "blocked-dispatch-failure" && \
   echo "$REASON" | grep -qiE "(framing|context-budget|pre-emptive|final-step|loophole)"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} deny reason names no-skip + sentinel + framing + enum semantics"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("26b: deny reason missing required messaging. reason=${REASON:0:700}")
  echo "${CLR_FAIL}  ✗${CLR_RST} deny reason missing required messaging"
fi
rm -rf "$REPO"

section "exploit-replication 26c: same state shape with legitimate transport failure → ALLOW"

# Inverse case: replace every framing-token deferral reason with a
# legitimate transport failure. Same dispatch shape, same blocked-dispatch-
# failure status — but the reason names a real structural cause.
LEGIT=$(echo "$STATE_BYPASS_BLOB" | "$JQ" -c '
  .passes."1-compositional"."stop-reason" = "transport-timeout: subagent never returned within 600s window after Pass-1 dispatch"
  | .dispatches |= map(.stage_b_deferral_reason = "transport timeout: connection reset by playwright-cli subagent")
')

REPO=$(make_repo)
plant_ledger "$REPO"
assert_allow "$H" "$(payload tool_name=Write \
  file_path="$REPO/tests/e2e/docs/coverage-expansion-state.json" \
  content="$LEGIT")" \
  "state file with legitimate transport-failure reason → silent allow"
rm -rf "$REPO"

section "exploit-replication 26d: state shape with explicit early-stop sentinel → ALLOW"

# The schema guard does NOT directly read the sentinel (it only validates
# shape + framings). However, when the sentinel is present, the partial
# state is by definition the user-authorised path. Here we re-affirm the
# guard's behaviour: with framings present AND no sentinel, DENY (already
# tested in 26a). The 26d affirmative path: a state file with a legit
# transport-failure reason works regardless of the sentinel.
REPO=$(make_repo)
plant_ledger "$REPO"
touch "$REPO/.claude/onboarding-stop-authorized"
# Even with the sentinel, a state file with framing tokens DENIES — the
# schema-guard's bookhive-run-2 logic is a write-time semantic check,
# independent of the "user authorised the stop" gate that lives in the
# stop-deny / write-guard hooks. The carve-out path for honest partial is
# Option B in the deny payload (use the sentinel + a clean reason
# string, not framing-token language). We assert DENY still fires here
# to lock that behaviour.
assert_deny "$H" "$(payload tool_name=Write \
  file_path="$REPO/tests/e2e/docs/coverage-expansion-state.json" \
  content="$STATE_BYPASS_BLOB")" \
  "framing-token state file even with sentinel → still DENY (schema-guard scope)" "framing"
rm -rf "$REPO"
