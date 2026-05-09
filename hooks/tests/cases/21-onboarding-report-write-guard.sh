#!/bin/bash
# 21-onboarding-report-write-guard.sh — tests for hooks/onboarding-report-write-guard.sh
H="$HOOK_DIR/onboarding-report-write-guard.sh"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

write_ledger_partial() {
  cat > "$1/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"in-progress"}}}
EOF
}

write_ledger_complete() {
  cat > "$1/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"greenlight"},"7":{"status":"greenlight"}}}
EOF
}

REPORT_PATH() { echo "$1/tests/e2e/docs/onboarding-report.md"; }

section "onboarding-report-write-guard: no ledger → silent allow"

REPO=$(make_repo)
assert_allow "$H" "$(payload tool_name=Write file_path="$(REPORT_PATH "$REPO")" content='# Report')" "no ledger → silent allow"
rm -rf "$REPO"

section "onboarding-report-write-guard: ledger all greenlight → ALLOW"

REPO=$(make_repo)
write_ledger_complete "$REPO"
assert_allow "$H" "$(payload tool_name=Write file_path="$(REPORT_PATH "$REPO")" content='# Onboarding Report

Phase 1 deferred for context-budget reasons.')" "all phases greenlight + framing in content → ALLOW (post-pipeline)"
rm -rf "$REPO"

section "onboarding-report-write-guard: mid-pipeline + framing token → DENY"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_deny "$H" "$(payload tool_name=Write file_path="$(REPORT_PATH "$REPO")" content='# Onboarding Report

The session ended with context-budget exit #2 after Pass-1 first wave only.')" "mid-pipeline + framing-token → DENY" "onboarding-report.md"
rm -rf "$REPO"

section "onboarding-report-write-guard: mid-pipeline + 'Phase N partial' prose → DENY"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_deny "$H" "$(payload tool_name=Write file_path="$(REPORT_PATH "$REPO")" content='# Onboarding Report

Status:
- Phase 4 greenlight
- Phase 5 partial — Stage B reviewer dispatches not run

The orchestrator returned to surface the partial state for review.')" "mid-pipeline + 'Phase 5 partial' prose → DENY" "onboarding-report.md"
rm -rf "$REPO"

section "onboarding-report-write-guard: mid-pipeline + 'Phase N deferred' prose → DENY"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_deny "$H" "$(payload tool_name=Write file_path="$(REPORT_PATH "$REPO")" content='# Onboarding Report

Phase 5 deferred for the next session.')" "mid-pipeline + 'Phase 5 deferred' prose → DENY" "onboarding-report.md"
rm -rf "$REPO"

section "onboarding-report-write-guard: mid-pipeline + benign skeleton → ALLOW"

REPO=$(make_repo)
write_ledger_partial "$REPO"
# Pre-allocating headings before the closing phase is fine — only the
# narrative claims about phase status trip the gate.
assert_allow "$H" "$(payload tool_name=Write file_path="$(REPORT_PATH "$REPO")" content='# Onboarding Report

## Phase 1 — Repository Crawl

(content TBD)

## Phase 2 — Page Discovery

(content TBD)')" "mid-pipeline + skeleton headings only → silent allow"
rm -rf "$REPO"

section "onboarding-report-write-guard: authorisation sentinel → ALLOW"

REPO=$(make_repo)
write_ledger_partial "$REPO"
touch "$REPO/.claude/onboarding-stop-authorized"
assert_allow "$H" "$(payload tool_name=Write file_path="$(REPORT_PATH "$REPO")" content='# Onboarding Report

Phase 5 partial — explicitly authorised early stop.')" "mid-pipeline + sentinel + partial prose → silent allow"
rm -rf "$REPO"

section "onboarding-report-write-guard: docs-dir authorisation sentinel → ALLOW"

REPO=$(make_repo)
write_ledger_partial "$REPO"
touch "$REPO/tests/e2e/docs/.onboarding-stop-authorized"
assert_allow "$H" "$(payload tool_name=Write file_path="$(REPORT_PATH "$REPO")" content='# Onboarding Report
Phase 5 deferred')" "mid-pipeline + docs-dir sentinel → silent allow"
rm -rf "$REPO"

section "onboarding-report-write-guard: Edit with new_string framing → DENY"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_deny "$H" "$(payload tool_name=Edit file_path="$(REPORT_PATH "$REPO")" new_string='Status: pragmatic Pass 1 — Phase 5 partial')" "Edit new_string with framing → DENY" "onboarding-report.md"
rm -rf "$REPO"

section "onboarding-report-write-guard: non-report file → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_allow "$H" "$(payload tool_name=Write file_path="$REPO/README.md" content='Phase 1 partial — context-budget exit')" "non-report path → silent allow"
rm -rf "$REPO"

section "onboarding-report-write-guard: fragment file path → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
mkdir -p "$REPO/tests/e2e/docs/onboarding-report-fragments"
assert_allow "$H" "$(payload tool_name=Write file_path="$REPO/tests/e2e/docs/onboarding-report-fragments/phase-5.md" content='Phase 5 partial — Stage B not run; context-budget exit')" "fragment file path → silent allow"
rm -rf "$REPO"

section "onboarding-report-write-guard: env-var off → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
HOOK_OUT=$(ONBOARDING_REPORT_WRITE_GUARD=off bash "$H" <<<"$(payload tool_name=Write file_path="$(REPORT_PATH "$REPO")" content='Phase 5 partial — context-budget')" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} ONBOARDING_REPORT_WRITE_GUARD=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("ONBOARDING_REPORT_WRITE_GUARD=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} ONBOARDING_REPORT_WRITE_GUARD=off (expected silent allow)"
fi
rm -rf "$REPO"

section "onboarding-report-write-guard: non-Write/Edit tool → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_allow "$H" "$(payload tool_name=Read file_path="$(REPORT_PATH "$REPO")")" "Read tool → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='cat tests/e2e/docs/onboarding-report.md')" "Bash tool → silent allow"
rm -rf "$REPO"
