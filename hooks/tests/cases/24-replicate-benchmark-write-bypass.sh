#!/bin/bash
# 24-replicate-benchmark-write-bypass.sh — exploit-replication test for
# hooks/benchmark-write-guard.sh.
#
# Replicates the BookHive Run-2 bypass byte-for-byte:
#   - Repo state: BENCHMARK.md contains Run 0 + Run 1 sections (verbatim
#     from bookhive-e2e/BENCHMARK.md lines 1-308 — pre-bypass state).
#   - Phase ledger: phases 1-4 greenlit, phases 5-7 absent (verbatim from
#     bookhive-e2e/tests/e2e/docs/onboarding-phase-ledger.json).
#   - Sentinel: absent (the bypass did not create one).
#   - Diff: the verbatim Run-2 section the bypass produced (172 lines,
#     including "## Run 2", "### Verdict", "MIXED" tag, plus a wealth of
#     framing tokens — "context-budget — orchestrator exit #2", "Pass 1
#     first wave only", "honest partial", etc.).
#
# Asserts:
#   - DENY fires on the verbatim payload.
#   - Deny reason mentions the no-skip contract / sentinel path.
#
# Inverse case: same edit with sentinel present → silent allow (early-stop
# authorised, the carve-out path).
#
# Fixtures live under hooks/tests/fixtures/bookhive-bypass-artifacts/.
# DO NOT paraphrase — the point is to lock against literal inputs.

H="$HOOK_DIR/benchmark-write-guard.sh"
FIX="$HOOK_DIR/tests/fixtures/bookhive-bypass-artifacts"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

# Reproduce the BookHive Run-2 fixture set in $1.
plant_bypass_artifacts() {
  local repo="$1"
  cp "$FIX/BENCHMARK-pre-bypass.md" "$repo/BENCHMARK.md"
  cp "$FIX/onboarding-phase-ledger-bypass.json" "$repo/tests/e2e/docs/onboarding-phase-ledger.json"
}

# The verbatim Run-2 section the bypass committed (172 lines from
# bookhive-e2e/BENCHMARK.md). Loaded from the fixture file.
RUN2_BYPASS_BLOB=$(cat "$FIX/BENCHMARK-run-2-bypass-section.md")

section "exploit-replication 24a: verbatim BENCHMARK Run-2 bypass write → DENY"

REPO=$(make_repo)
plant_bypass_artifacts "$REPO"

# The bypass shape: an Edit appending the Run-2 section. We model it as a
# Write of the full appended file (Run 0 + Run 1 + Run 2) — the hook
# inspects content for Run-N / Verdict / framing signals regardless of
# whether the prior sections were already there. The diff carries every
# bypass framing the original incident did.
APPENDED_FILE=$(printf '%s\n\n---\n\n%s\n' \
  "$(cat "$FIX/BENCHMARK-pre-bypass.md")" \
  "$RUN2_BYPASS_BLOB")

assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content="$APPENDED_FILE")" \
  "verbatim Run-2 bypass write → DENY" "BENCHMARK"
rm -rf "$REPO"

section "exploit-replication 24b: verbatim Run-2 Edit (new_string only) → DENY"

# The actual bypass commit (c23fbdd) was an append — modelled here as an
# Edit whose new_string is the verbatim Run-2 blob alone. The hook's diff-
# inspection path (Edit branch) reads new_string and must catch every
# Run-N / Verdict / framing-token signal in it.
REPO=$(make_repo)
plant_bypass_artifacts "$REPO"
assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/BENCHMARK.md" new_string="$RUN2_BYPASS_BLOB")" \
  "verbatim Run-2 Edit (new_string=Run-2 blob) → DENY" "BENCHMARK"
rm -rf "$REPO"

section "exploit-replication 24c: deny reason names the no-skip contract"

REPO=$(make_repo)
plant_bypass_artifacts "$REPO"
run_hook "$H" "$(payload tool_name=Edit file_path="$REPO/BENCHMARK.md" new_string="$RUN2_BYPASS_BLOB")"

TESTS_RUN=$((TESTS_RUN + 1))
REASON=$(echo "$HOOK_OUT" | "$JQ" -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null)
# The no-skip contract is communicated through several phrases. At least
# one of these must appear in the deny payload:
#   - "no-skip" / "cannot be skipped" / "kernel rule"
#   - sentinel reference (.claude/onboarding-stop-authorized)
#   - framings-not-authorisation reminder
if echo "$REASON" | grep -qF -- ".claude/onboarding-stop-authorized" && \
   echo "$REASON" | grep -qiE "(kernel rule|no-skip|finish the pipeline|pipeline phases cannot be skipped)" && \
   echo "$REASON" | grep -qiE "(framing|final-step|context-budget|pre-emptive|pragmatic)"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} deny reason references no-skip + sentinel + framing reminder"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("24c: deny reason missing no-skip / sentinel / framing language. reason=${REASON:0:600}")
  echo "${CLR_FAIL}  ✗${CLR_RST} deny reason missing required messaging"
fi
rm -rf "$REPO"

section "exploit-replication 24d: same write WITH sentinel → silent allow (carve-out)"

# Inverse case: when the user has explicitly authorised the early stop
# (sentinel present), the same verbatim bypass diff is the LEGITIMATE
# capture-the-partial path. Hook must allow.
REPO=$(make_repo)
plant_bypass_artifacts "$REPO"
touch "$REPO/.claude/onboarding-stop-authorized"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/BENCHMARK.md" new_string="$RUN2_BYPASS_BLOB")" \
  "verbatim Run-2 Edit + sentinel → silent allow (early-stop authorised)"
rm -rf "$REPO"

section "exploit-replication 24e: same write with all phases greenlit → silent allow (post-pipeline)"

# Final inverse: pipeline genuinely complete (all 7 phases greenlit) →
# the Run-N section is the deliverable, not a bypass. Hook must allow.
REPO=$(make_repo)
cp "$FIX/BENCHMARK-pre-bypass.md" "$REPO/BENCHMARK.md"
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"greenlight"},"7":{"status":"greenlight"}}}
EOF
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/BENCHMARK.md" new_string="$RUN2_BYPASS_BLOB")" \
  "verbatim Run-2 Edit + all phases greenlit → silent allow (post-pipeline deliverable)"
rm -rf "$REPO"
