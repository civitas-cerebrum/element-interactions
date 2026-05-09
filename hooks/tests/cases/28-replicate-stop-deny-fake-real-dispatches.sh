#!/bin/bash
# 28-replicate-stop-deny-fake-real-dispatches.sh — exploit-replication
# test for hooks/onboarding-pipeline-incomplete-stop-deny.sh.
#
# Replicates the BookHive Run-2 Stop-event bypass surface byte-for-byte:
#   - Phase ledger: phases 1-4 greenlit (verbatim, phases 5-7 absent).
#   - State file: verbatim 6-dispatch shape with stage_b_cycles=0 + every
#     review_status="blocked-dispatch-failure" (the fake "we dispatched 6
#     times" pad designed to sneak past a count-based dispatch check).
#   - Sentinel: absent.
#
# Asserts:
#   - REAL_DISPATCH_COUNT computes to 0 despite dispatches[].length == 6.
#   - BLOCK fires with deterministic kind (escalated because real-
#     dispatch-count=0 < 0.5 * completedJourneys=6).
#   - Reason names the no-skip contract (kernel rule + sentinel path).
#
# Inverse: same shape but each entry mutated to be a real cycle
# (stage_b_cycles>=1, review_status='greenlight', phases 5-7 greenlit) →
# silent allow.

H="$HOOK_DIR/onboarding-pipeline-incomplete-stop-deny.sh"
FIX="$HOOK_DIR/tests/fixtures/bookhive-bypass-artifacts"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

sid() { echo "test-$RANDOM-$(date +%s%N 2>/dev/null || date +%s)"; }
cleanup_counter() { rm -f "/tmp/civitas-onboarding-stop-deny-$1" 2>/dev/null || true; }

plant_bypass_state_and_ledger() {
  cp "$FIX/coverage-expansion-state-bypass.json" "$1/tests/e2e/docs/coverage-expansion-state.json"
  cp "$FIX/onboarding-phase-ledger-bypass.json" "$1/tests/e2e/docs/onboarding-phase-ledger.json"
}

section "exploit-replication 28a: verbatim 6-dispatch state + 1-4 ledger → BLOCK deterministic"

REPO=$(make_repo)
SID=$(sid)
plant_bypass_state_and_ledger "$REPO"

run_hook "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
DECISION=$(echo "$HOOK_OUT" | "$JQ" -r '.decision // empty' 2>/dev/null)
REASON=$(echo "$HOOK_OUT" | "$JQ" -r '.reason // empty' 2>/dev/null)
# Required arithmetic: 6 dispatches recorded, REAL_DISPATCH_COUNT = 0
# (because every entry has stage_b_cycles=0 + blocked-dispatch-failure
# review_status — neither of which satisfies the real-dispatch rule),
# COMPLETED_JOURNEYS = 6 (the verbatim state file's completedJourneys[]
# array length), HALF = 3, 0 < 3 → escalate to deterministic.
if [ "$DECISION" = "block" ] && \
   echo "$REASON" | grep -qF "Real dispatches" && \
   echo "$REASON" | grep -qF ": 0" && \
   echo "$REASON" | grep -qF "Completed journeys claimed: 6" && \
   echo "$REASON" | grep -qF "deterministic"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} BLOCK fires with REAL=0 + COMPLETED=6 + deterministic kind"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("28a: expected BLOCK with REAL=0 + COMPLETED=6 + deterministic. decision=${DECISION} reason=${REASON:0:500}")
  echo "${CLR_FAIL}  ✗${CLR_RST} expected BLOCK with REAL=0 + deterministic"
fi
cleanup_counter "$SID"
rm -rf "$REPO"

section "exploit-replication 28b: deny reason names no-skip + sentinel"

REPO=$(make_repo)
SID=$(sid)
plant_bypass_state_and_ledger "$REPO"

run_hook "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
REASON=$(echo "$HOOK_OUT" | "$JQ" -r '.reason // empty' 2>/dev/null)
if echo "$REASON" | grep -qF -- ".claude/onboarding-stop-authorized" && \
   echo "$REASON" | grep -qiE "(kernel rule|no-skip|onboarding/SKILL.md|finish the pipeline|pipeline phases cannot be skipped)" && \
   echo "$REASON" | grep -qiE "(framing|context-budget|pre-emptive|final-step|loophole)"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} deny reason names no-skip + sentinel + framing reminder"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("28b: deny reason missing required messaging. reason=${REASON:0:600}")
  echo "${CLR_FAIL}  ✗${CLR_RST} deny reason missing required messaging"
fi
cleanup_counter "$SID"
rm -rf "$REPO"

section "exploit-replication 28c: bypass cap-bypass — three blocks all deterministic"

# Three consecutive Stop attempts must all BLOCK with deterministic kind —
# the 3-strike auto-allow bypass for hook-bug runaways doesn't apply when
# the block is deterministic. Verifies the BookHive Run-2 retry-evasion
# pattern is closed.
REPO=$(make_repo)
SID=$(sid)
plant_bypass_state_and_ledger "$REPO"

assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "deterministic block 1 → BLOCK" "deterministic"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "deterministic block 2 → BLOCK" "deterministic"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "deterministic block 3 → still BLOCK (no cap escape)" "deterministic"
cleanup_counter "$SID"
rm -rf "$REPO"

section "exploit-replication 28d: real cycles (stage_b>=1 + greenlight + ledger complete) → silent allow"

# Inverse: mutate every dispatch to be a real Stage A+B cycle (cycles>=1
# + review_status=greenlight) AND fully greenlit phase ledger → pipeline
# is genuinely complete; Stop-event must allow.
REPO=$(make_repo)
SID=$(sid)
"$JQ" -c '
  .completedJourneys = .completedJourneys
  | .dispatches |= map(. + {
      "stage_a_cycles": 1,
      "stage_b_cycles": 1,
      "review_status": "greenlight",
      "stage_b_deferral_reason": null
    })
' "$FIX/coverage-expansion-state-bypass.json" \
  | "$JQ" -c '.status = "complete" | .currentPass = 5 | .passes."1-compositional".dispatches = .dispatches' \
  > "$REPO/tests/e2e/docs/coverage-expansion-state.json"

cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"greenlight"},"7":{"status":"greenlight"}}}
EOF
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "real cycles + complete ledger → silent allow (pipeline genuinely complete)"
cleanup_counter "$SID"
rm -rf "$REPO"

section "exploit-replication 28e: same shape + sentinel → silent allow (early-stop authorised)"

REPO=$(make_repo)
SID=$(sid)
plant_bypass_state_and_ledger "$REPO"
touch "$REPO/.claude/onboarding-stop-authorized"
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "verbatim bypass state + sentinel → silent allow (early-stop authorised)"
cleanup_counter "$SID"
rm -rf "$REPO"
