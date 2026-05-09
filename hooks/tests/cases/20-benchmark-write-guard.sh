#!/bin/bash
# 20-benchmark-write-guard.sh — tests for hooks/benchmark-write-guard.sh
H="$HOOK_DIR/benchmark-write-guard.sh"

# Per-test temp repo so the ledger fixture is isolated.
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

section "benchmark-write-guard: no ledger → silent allow"

REPO=$(make_repo)
assert_allow "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content='# BENCHMARK
## Run 1
Verdict: BETTER')" "BENCHMARK write with no ledger → silent allow"
rm -rf "$REPO"

section "benchmark-write-guard: ledger all greenlight → ALLOW"

REPO=$(make_repo)
write_ledger_complete "$REPO"
assert_allow "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content='# BENCHMARK Comparisons

## Run 1 — full pipeline

### Verdict: BETTER

The agent ran the full onboarding pipeline.')" "all phases greenlight + Run-N + Verdict → ALLOW"
rm -rf "$REPO"

section "benchmark-write-guard: mid-pipeline + Run-N section header → DENY"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content='# BENCHMARK

## Run 2 — partial

The orchestrator stopped after Pass-1 first wave.')" "mid-pipeline + Run-N header → DENY" "BENCHMARK"
rm -rf "$REPO"

section "benchmark-write-guard: mid-pipeline + Verdict line → DENY"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content='# BENCHMARK

Some prose without a Run header.

### Verdict
MIXED — partial pipeline.')" "mid-pipeline + Verdict heading → DENY" "BENCHMARK"
rm -rf "$REPO"

section "benchmark-write-guard: mid-pipeline + 'Verdict: MIXED' line → DENY"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content='# BENCHMARK

Some prose.
Verdict: MIXED — orchestrator exited early.')" "mid-pipeline + Verdict: MIXED line → DENY" "BENCHMARK"
rm -rf "$REPO"

section "benchmark-write-guard: mid-pipeline + framing-token in diff → DENY"

REPO=$(make_repo)
write_ledger_partial "$REPO"
# No Run-N / Verdict structure, but the prose itself carries a framing token.
assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content='# BENCHMARK

Notes from this session: pragmatic Pass 1 was the right call given the time we had.')" "mid-pipeline + framing token → DENY" "framing"
rm -rf "$REPO"

section "benchmark-write-guard: mid-pipeline + structural typo fix (no signals) → ALLOW"

REPO=$(make_repo)
write_ledger_partial "$REPO"
# An Edit with new_string that does NOT add a Run-N header / Verdict / framing
# token must pass even mid-pipeline. Reviewers can adjust prose in their own
# copy without tripping the gate.
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/BENCHMARK.md" new_string='Fixed a small typo in the prose.')" "mid-pipeline + benign edit → silent allow"
rm -rf "$REPO"

section "benchmark-write-guard: authorisation sentinel → ALLOW"

REPO=$(make_repo)
write_ledger_partial "$REPO"
touch "$REPO/.claude/onboarding-stop-authorized"
assert_allow "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content='# BENCHMARK

## Run 2 — partial (authorised)

### Verdict
MIXED — explicit early stop.')" "mid-pipeline + sentinel + Run-N → silent allow (explicit auth)"
rm -rf "$REPO"

section "benchmark-write-guard: docs-dir authorisation sentinel → ALLOW"

REPO=$(make_repo)
write_ledger_partial "$REPO"
touch "$REPO/tests/e2e/docs/.onboarding-stop-authorized"
assert_allow "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content='## Run 3 — partial
### Verdict: SAME')" "mid-pipeline + docs-dir sentinel → silent allow"
rm -rf "$REPO"

section "benchmark-write-guard: case-insensitive filename match"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/benchmark.md" content='## Run 4
Verdict: WORSE')" "lower-case benchmark.md still gated → DENY" "BENCHMARK"
rm -rf "$REPO"

section "benchmark-write-guard: subdir BENCHMARK.md still gated"

REPO=$(make_repo)
write_ledger_partial "$REPO"
mkdir -p "$REPO/docs"
assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/docs/BENCHMARK.md" content='## Run 5
Verdict: BETTER')" "BENCHMARK.md in subdir → DENY" "BENCHMARK"
rm -rf "$REPO"

section "benchmark-write-guard: non-BENCHMARK file → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_allow "$H" "$(payload tool_name=Write file_path="$REPO/README.md" content='## Run 6 — partial
Verdict: MIXED')" "non-BENCHMARK filename → silent allow even with matching content"
rm -rf "$REPO"

section "benchmark-write-guard: env-var off → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
HOOK_OUT=$(BENCHMARK_WRITE_GUARD=off bash "$H" <<<"$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content='## Run 7
Verdict: WORSE')" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} BENCHMARK_WRITE_GUARD=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("BENCHMARK_WRITE_GUARD=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} BENCHMARK_WRITE_GUARD=off (expected silent allow)"
fi
rm -rf "$REPO"

section "benchmark-write-guard: non-Write/Edit tool → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_allow "$H" "$(payload tool_name=Read file_path="$REPO/BENCHMARK.md")" "Read tool → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='cat BENCHMARK.md')" "Bash tool → silent allow"
rm -rf "$REPO"
