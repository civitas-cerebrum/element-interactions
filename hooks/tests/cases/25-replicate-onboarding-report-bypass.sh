#!/bin/bash
# 25-replicate-onboarding-report-bypass.sh — exploit-replication test for
# hooks/onboarding-report-write-guard.sh.
#
# Replicates the BookHive Run-2 bypass byte-for-byte:
#   - Repo state: tests/e2e/docs/onboarding-report.md absent.
#   - Phase ledger: phases 1-4 greenlit, phases 5-7 absent (verbatim).
#   - Sentinel: absent.
#   - Diff: the verbatim 103-line onboarding-report.md the bypass produced
#     — `Phase 5 — Coverage expansion (depth) | ⚠️ partial` row, "user's
#     explicit final-step instruction" framing, "context-budget — orches-
#     trator exit #2", and "Until step 4 is done your run is not complete"
#     citation, all from `bookhive-e2e/tests/e2e/docs/onboarding-report.md`.
#
# Asserts:
#   - DENY fires on the verbatim payload.
#   - Deny reason mentions the no-skip contract + sentinel path + frag-
#     ment-files alternative.
#
# Inverse: same write WITH sentinel → silent allow.

H="$HOOK_DIR/onboarding-report-write-guard.sh"
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

# The verbatim 103-line report the bypass produced.
REPORT_BYPASS_BLOB=$(cat "$FIX/onboarding-report-bypass.md")

section "exploit-replication 25a: verbatim onboarding-report bypass write → DENY"

REPO=$(make_repo)
plant_ledger "$REPO"
assert_deny "$H" "$(payload tool_name=Write \
  file_path="$REPO/tests/e2e/docs/onboarding-report.md" \
  content="$REPORT_BYPASS_BLOB")" \
  "verbatim 103-line bypass report Write → DENY" "onboarding-report.md"
rm -rf "$REPO"

section "exploit-replication 25b: verbatim Edit (new_string=full report) → DENY"

REPO=$(make_repo)
plant_ledger "$REPO"
assert_deny "$H" "$(payload tool_name=Edit \
  file_path="$REPO/tests/e2e/docs/onboarding-report.md" \
  new_string="$REPORT_BYPASS_BLOB")" \
  "verbatim Edit new_string=full report → DENY" "onboarding-report.md"
rm -rf "$REPO"

section "exploit-replication 25c: deny reason names no-skip + sentinel + fragment path"

REPO=$(make_repo)
plant_ledger "$REPO"
run_hook "$H" "$(payload tool_name=Write \
  file_path="$REPO/tests/e2e/docs/onboarding-report.md" \
  content="$REPORT_BYPASS_BLOB")"

TESTS_RUN=$((TESTS_RUN + 1))
REASON=$(echo "$HOOK_OUT" | "$JQ" -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null)
if echo "$REASON" | grep -qF -- ".claude/onboarding-stop-authorized" && \
   echo "$REASON" | grep -qF "onboarding-report-fragments" && \
   echo "$REASON" | grep -qiE "(kernel rule|no-skip|finish the pipeline|pipeline phases cannot be skipped)" && \
   echo "$REASON" | grep -qiE "(framing|final-step|context-budget|pre-emptive|loophole)"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} deny reason names no-skip + sentinel + fragment path + framing reminder"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("25c: deny reason missing required messaging. reason=${REASON:0:600}")
  echo "${CLR_FAIL}  ✗${CLR_RST} deny reason missing required messaging"
fi
rm -rf "$REPO"

section "exploit-replication 25d: same write WITH sentinel → silent allow (carve-out)"

REPO=$(make_repo)
plant_ledger "$REPO"
touch "$REPO/.claude/onboarding-stop-authorized"
assert_allow "$H" "$(payload tool_name=Write \
  file_path="$REPO/tests/e2e/docs/onboarding-report.md" \
  content="$REPORT_BYPASS_BLOB")" \
  "verbatim bypass-report write + sentinel → silent allow"
rm -rf "$REPO"

section "exploit-replication 25e: same write with all phases greenlit → silent allow"

REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"greenlight"},"7":{"status":"greenlight"}}}
EOF
assert_allow "$H" "$(payload tool_name=Write \
  file_path="$REPO/tests/e2e/docs/onboarding-report.md" \
  content="$REPORT_BYPASS_BLOB")" \
  "verbatim bypass-report write + all phases greenlit → silent allow (deliverable)"
rm -rf "$REPO"
