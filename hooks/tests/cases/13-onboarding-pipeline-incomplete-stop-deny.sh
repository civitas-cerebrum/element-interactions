#!/bin/bash
H="$HOOK_DIR/onboarding-pipeline-incomplete-stop-deny.sh"

# Each test gets its own temp repo so file fixtures + per-session counters are isolated.
make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

# Unique session id per test so the per-session counter doesn't bleed.
sid() {
  echo "test-$RANDOM-$(date +%s%N 2>/dev/null || date +%s)"
}

cleanup_counter() {
  rm -f "/tmp/civitas-onboarding-stop-deny-$1" 2>/dev/null || true
}

section "onboarding-pipeline-incomplete-stop-deny: no mid-pipeline signals → ALLOW"

REPO=$(make_repo)
SID=$(sid)
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "fresh repo, no signals → silent allow"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: journey-map with sentinel → BLOCK"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/journey-map.md" <<'EOF'
<!-- journey-mapping:generated -->
# Journey Map

## Phase 2 — Pages
EOF
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "journey-map sentinel + no other signals → BLOCK" "Onboarding pipeline mid-flight"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: journey-map without sentinel → ALLOW"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/journey-map.md" <<'EOF'
# Some unrelated journey map note
EOF
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "journey-map.md without sentinel → silent allow"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: in-progress coverage-expansion-state.json → BLOCK"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "in-progress state file → BLOCK" "Phase 5"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: status=complete state file alone → ALLOW (Phase 6/7 case)"

# Reviewer Critical #1: file persists with status=complete after coverage-
# expansion finishes. Phase 6/7 stops must not be blocked by stale presence.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"complete","mode":"depth","currentPass":5,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "status=complete state file, no other signals → silent allow"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: status=complete state + ledger Phase 6 in-progress → ALLOW"

# Reviewer Critical #1 happy-path: post-Phase-5 stops with the state file
# present must allow when phases 1-5 are greenlight (Phase 6 is in-progress
# in onboarding terms but coverage-expansion has finished).
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"complete","mode":"depth","currentPass":5,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"in-progress"}}}
EOF
# Phase 7 is not greenlight → ledger signal still engages → BLOCK is correct.
# But the status=complete state file must not contribute a redundant signal.
# We assert BLOCK here (ledger drives it), and verify the SIGNALS string
# doesn't mention the state file.
run_hook "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
DECISION=$(echo "$HOOK_OUT" | jq -r '.decision // empty' 2>/dev/null)
REASON=$(echo "$HOOK_OUT" | jq -r '.reason // empty' 2>/dev/null)
if [ "$DECISION" = "block" ] && \
   echo "$REASON" | grep -qF "phase 7 status: missing" && \
   ! echo "$REASON" | grep -qF "coverage-expansion-state.json"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} status=complete state + Phase 6 in-progress → BLOCK from ledger only (state file NOT in SIGNALS)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("status=complete + Phase 6 in-progress: expected BLOCK driven by ledger only. decision=${DECISION} reason=${REASON:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} status=complete state + Phase 6 in-progress (expected BLOCK from ledger, state file NOT in SIGNALS)"
fi
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: status=complete state + all phases greenlit → ALLOW"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"complete","mode":"depth","currentPass":5,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"greenlight"},"7":{"status":"greenlight"}}}
EOF
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "status=complete + all phases greenlit → silent allow"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: Phase 5 currentPass>=1 + zero dispatches → tailored redirect"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "Phase 5 currentPass=1 + zero dispatches → BLOCK with first-wave redirect" "ZERO dispatches recorded"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: in-flight dispatch (review_status null) + no scratch → auto-compact redirect"

# Reviewer Critical #2 happy-path: at least one dispatches[] entry has
# review_status null/missing AND no scratch files → auto-compact redirect
# fires.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{"1-compositional":{"dispatches":[{"journey":"j-a","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"},{"journey":"j-b","stage_a_cycles":1,"stage_b_cycles":1,"review_status":null}]}},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "Phase 5 with one in-flight dispatch + no scratch → BLOCK with auto-compact redirect" "auto-compact"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: all dispatches review_status set + no scratch → default redirect (NOT auto-compact)"

# Reviewer Critical #2: scratch files are deleted after each per-pass commit
# (depth-mode-pipeline.md). The auto-compact redirect must NOT fire when all
# dispatches have a terminal review_status, because the absence of scratch
# files is then the normal post-commit state, not a "never auto-compacted"
# signal.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{"1-compositional":{"dispatches":[{"journey":"j-a","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}]}},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
run_hook "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
DECISION=$(echo "$HOOK_OUT" | jq -r '.decision // empty' 2>/dev/null)
REASON=$(echo "$HOOK_OUT" | jq -r '.reason // empty' 2>/dev/null)
if [ "$DECISION" = "block" ] && \
   ! echo "$REASON" | grep -qF "auto-compact" && \
   echo "$REASON" | grep -qF "Continue dispatching the next pipeline phase"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} all dispatches stamped + no scratch → default redirect (NOT auto-compact)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("all dispatches stamped + no scratch: expected BLOCK with default redirect (no auto-compact mention). decision=${DECISION} reason=${REASON:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} all dispatches stamped + no scratch (expected default redirect, not auto-compact)"
fi
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: onboarding-report.md alone → ALLOW (no marker check)"

# Reviewer Critical #3: the "Phase 7 complete" string doesn't exist in any
# template; the marker check has been removed entirely. A bare report.md
# with no other mid-pipeline signals must allow.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/onboarding-report.md" <<'EOF'
# Onboarding report
Phase 1 done.
Phase 2 done.
EOF
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "report.md alone (no markers) → silent allow"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: report.md + Phase 7 ledger missing → BLOCK from ledger only"

# Verify the report.md presence does not contribute a redundant signal.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/onboarding-report.md" <<'EOF'
# Onboarding report
Phase 1 done.
EOF
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"4":{"status":"greenlight"},"5":{"status":"in-progress"}}}
EOF
run_hook "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
DECISION=$(echo "$HOOK_OUT" | jq -r '.decision // empty' 2>/dev/null)
REASON=$(echo "$HOOK_OUT" | jq -r '.reason // empty' 2>/dev/null)
if [ "$DECISION" = "block" ] && \
   echo "$REASON" | grep -qF "phase 7 status: missing" && \
   ! echo "$REASON" | grep -qF "onboarding-report.md"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} report.md + ledger Phase 7 missing → BLOCK from ledger only (report not in SIGNALS)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("report.md + ledger missing: expected BLOCK from ledger only, report not mentioned. decision=${DECISION} reason=${REASON:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} report.md + ledger Phase 7 missing (expected BLOCK from ledger, report NOT in SIGNALS)"
fi
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: phase ledger — phase 7 missing → BLOCK"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"4":{"status":"greenlight"},"5":{"status":"in-progress"}}}
EOF
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "ledger — phase 7 missing → BLOCK" "phase 7 status: missing"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: phase ledger — all greenlit → ALLOW"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"greenlight"},"7":{"status":"greenlight"}}}
EOF
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "ledger — all phases greenlit → silent allow"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: authorisation sentinel → ALLOW"

REPO=$(make_repo)
SID=$(sid)
# Mid-pipeline state…
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
# …but the user-authorised sentinel is present.
touch "$REPO/.claude/onboarding-stop-authorized"
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" ".claude/onboarding-stop-authorized → silent allow"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: docs-dir authorisation sentinel → ALLOW"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
touch "$REPO/tests/e2e/docs/.onboarding-stop-authorized"
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "tests/e2e/docs/.onboarding-stop-authorized → silent allow"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: stop_hook_active=true → ALLOW silently"

# Reviewer Critical #5: Claude Code sets stop_hook_active=true when the
# agent is already running because of a previous Stop block. The hook must
# silent-allow so we don't create an unrecoverable loop.
# (The shared payload() helper doesn't yet support boolean fields, so we
#  splice stop_hook_active into the payload via jq inline.)
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
PAYLOAD_BASE=$(payload tool_name=Stop session_id="$SID" cwd="$REPO")
PAYLOAD_WITH_FLAG=$(printf '%s' "$PAYLOAD_BASE" | jq -c '. + {stop_hook_active: true}')
assert_allow "$H" "$PAYLOAD_WITH_FLAG" "stop_hook_active=true mid-pipeline → silent allow"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: deferredJourneys[] without dispatches[] → BLOCK (DISPATCH_COUNT excludes them)"

# Reviewer Critical #7: PR #173 adds deferredJourneys[] entries that have a
# `journey` key. The previous recursive jq walk over-counted these as
# dispatches, masking the "currentPass>=1 AND zero dispatches" first-wave
# redirect. The tightened query under .passes[].dispatches must exclude them.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"deferredJourneys":[{"journey":"j-c","reason":"auth-locked"}],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
# DISPATCH_COUNT must be 0 (the deferredJourneys[].journey doesn't count) so
# the first-wave redirect must still fire — proves we didn't fall through to
# the auto-compact branch by accident.
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "deferredJourneys[] only → BLOCK with first-wave redirect (DISPATCH_COUNT excludes them)" "ZERO dispatches recorded"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: consecutive-block cap"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
# Three blocks then allow.
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "block 1/3 → BLOCK" "Block attempt: 1/3"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "block 2/3 → BLOCK" "Block attempt: 2/3"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "block 3/3 → BLOCK" "Block attempt: 3/3"
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "after cap reached → silent allow"
# Counter cleared by the cap-reached path; next call should re-block.
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "after cap allow + counter clear → BLOCK 1/3 again" "Block attempt: 1/3"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: deterministic block kind (state file mid-pass + ledger incomplete) bypasses 3-strike cap"

# Bypass-hardening: deterministic denies bypass the consecutive-block escape.
# Setup: currentPass>=1 AND ledger incomplete (phase 7 != greenlight). The
# block kind becomes deterministic and the 3-strike cap should NOT apply —
# the agent retrying Stop without acting on the pipeline shouldn't be able
# to escape via repetition alone.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{"1-compositional":{"dispatches":[{"journey":"j-a","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}]}},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"5":{"status":"in-progress"}}}
EOF
# The signals here are deterministic: state file says currentPass=1 +
# dispatch present, ledger says phase 7 missing AND phase 5 in-progress.
# That's a strict superset of the "real dispatch + currentPass>=1 + ledger
# missing" case — the block kind escalates to deterministic.
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "deterministic block 1 → BLOCK (no cap reset)" "deterministic"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "deterministic block 2 → BLOCK" "deterministic"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "deterministic block 3 → BLOCK" "deterministic"
# Fourth attempt — cap WOULD have allowed if this were suspect, but
# deterministic denies bypass the cap entirely.
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "deterministic block 4 → still BLOCK (cap bypassed)" "deterministic"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: real-dispatch arithmetic — blocked-dispatch-failure does NOT count"

# Bypass-hardening: a state file with 6 entries all stamped review_status:
# blocked-dispatch-failure (the BookHive Run-2 shape) MUST be treated as
# zero real dispatches. The previous count check accepted any non-empty
# dispatches[], so the orchestrator could pad with placeholder failures
# to clear the count. The new arithmetic requires:
#   - stage_a_cycles >= 1
#   - stage_b_cycles >= 1
#   - review_status ∈ {greenlight, blocked-cycle-stalled,
#                       blocked-cycle-exhausted}
# blocked-dispatch-failure does NOT satisfy clause 3 even when cycle counts
# are positive.
REPO=$(make_repo)
SID=$(sid)
# Six dispatches, all blocked-dispatch-failure with stage_b_cycles:0 (the
# canonical Run-2 shape). completedJourneys claims all six are done.
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{
  "status": "in-progress",
  "mode": "depth",
  "currentPass": 1,
  "journeyRoster": ["j-a","j-b","j-c","j-d","j-e","j-f"],
  "completedJourneys": ["j-a","j-b","j-c","j-d","j-e","j-f"],
  "passes": {
    "1-compositional": {
      "dispatches": [
        {"journey":"j-a","stage_a_cycles":1,"stage_b_cycles":0,"review_status":"blocked-dispatch-failure"},
        {"journey":"j-b","stage_a_cycles":1,"stage_b_cycles":0,"review_status":"blocked-dispatch-failure"},
        {"journey":"j-c","stage_a_cycles":1,"stage_b_cycles":0,"review_status":"blocked-dispatch-failure"},
        {"journey":"j-d","stage_a_cycles":1,"stage_b_cycles":0,"review_status":"blocked-dispatch-failure"},
        {"journey":"j-e","stage_a_cycles":1,"stage_b_cycles":0,"review_status":"blocked-dispatch-failure"},
        {"journey":"j-f","stage_a_cycles":1,"stage_b_cycles":0,"review_status":"blocked-dispatch-failure"}
      ]
    }
  },
  "updatedAt": "2026-05-09T07:30:00Z"
}
EOF
# The hook should:
#   1. count REAL_DISPATCH_COUNT = 0 (none of the 6 satisfy the strict rule)
#   2. compute COMPLETED_JOURNEYS = 6, HALF = 3
#   3. 0 < 3 → escalate to BLOCK_KIND=deterministic
#   4. emit a BLOCK with the deterministic line + Real dispatches: 0 / Completed journeys claimed: 6 line.
run_hook "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
DECISION=$(echo "$HOOK_OUT" | jq -r '.decision // empty' 2>/dev/null)
REASON=$(echo "$HOOK_OUT" | jq -r '.reason // empty' 2>/dev/null)
if [ "$DECISION" = "block" ] && \
   echo "$REASON" | grep -qF "Real dispatches" && \
   echo "$REASON" | grep -qF ": 0" && \
   echo "$REASON" | grep -qF "Completed journeys claimed: 6" && \
   echo "$REASON" | grep -qF "deterministic"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} 6 blocked-dispatch-failure entries → BLOCK with REAL_DISPATCH=0 + deterministic kind"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("real-dispatch arithmetic: expected BLOCK with REAL_DISPATCH=0 + deterministic. decision=${DECISION} reason=${REASON:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} 6 blocked-dispatch-failure → expected REAL_DISPATCH=0 + deterministic"
fi
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: real-dispatch arithmetic — blocked-cycle-stalled DOES count"

# Inverse case: blocked-cycle-stalled (an actual cycle-exhaustion state)
# DOES satisfy the rule when paired with stage_b_cycles>=1.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{
  "status": "in-progress",
  "mode": "depth",
  "currentPass": 1,
  "journeyRoster": ["j-a","j-b"],
  "completedJourneys": ["j-a","j-b"],
  "passes": {
    "1-compositional": {
      "dispatches": [
        {"journey":"j-a","stage_a_cycles":2,"stage_b_cycles":2,"review_status":"blocked-cycle-stalled"},
        {"journey":"j-b","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}
      ]
    }
  },
  "updatedAt": "2026-05-09T07:30:00Z"
}
EOF
# Both entries satisfy the real-dispatch rule (cycle counts + acceptable
# review_status). REAL=2, COMPLETED=2, HALF=1. 2 >= 1 — no count-shortfall
# escalation; only a suspect-class block (the 3-strike escape still applies).
run_hook "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
DECISION=$(echo "$HOOK_OUT" | jq -r '.decision // empty' 2>/dev/null)
REASON=$(echo "$HOOK_OUT" | jq -r '.reason // empty' 2>/dev/null)
if [ "$DECISION" = "block" ] && \
   echo "$REASON" | grep -qF "Real dispatches" && \
   echo "$REASON" | grep -qF ": 2" && \
   echo "$REASON" | grep -qF "Completed journeys claimed: 2"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} blocked-cycle-stalled + greenlight → REAL_DISPATCH=2"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("real-dispatch (stalled): expected REAL_DISPATCH=2. decision=${DECISION} reason=${REASON:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} blocked-cycle-stalled + greenlight → expected REAL_DISPATCH=2"
fi
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: escape hatch via env var"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
HOOK_OUT=$(ONBOARDING_STOP_DENY=off bash "$H" <<<"$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} ONBOARDING_STOP_DENY=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("ONBOARDING_STOP_DENY=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} ONBOARDING_STOP_DENY=off (expected silent allow)"
fi
cleanup_counter "$SID"
rm -rf "$REPO"
