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

section "onboarding-pipeline-incomplete-stop-deny: coverage-expansion-state.json present → BLOCK"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "state file present → BLOCK" "Phase 5"
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

section "onboarding-pipeline-incomplete-stop-deny: Phase 5 with dispatches but no auto-compact → tailored redirect"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{"1-compositional":{"dispatches":[{"journey":"j-a","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}]}},"updatedAt":"2026-05-04T00:00:00Z"}
EOF
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "Phase 5 with dispatches + no auto-compact → BLOCK with auto-compact redirect" "auto-compact"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: onboarding-report.md without Phase 7 marker → BLOCK"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/onboarding-report.md" <<'EOF'
# Onboarding report
Phase 1 done.
Phase 2 done.
EOF
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "report without Phase 7 complete → BLOCK" "Onboarding pipeline mid-flight"
cleanup_counter "$SID"
rm -rf "$REPO"

section "onboarding-pipeline-incomplete-stop-deny: onboarding-report.md WITH Phase 7 marker → ALLOW"

REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/onboarding-report.md" <<'EOF'
# Onboarding report
Phase 1 done.
Phase 7 complete.
EOF
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "report with Phase 7 complete → silent allow"
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
