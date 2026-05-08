#!/bin/bash
H="$HOOK_DIR/failure-diagnosis-stage0-preread-guard.sh"

# Each test sets up its own temp repo so file fixtures are isolated.
make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/tests/data" "$d/tests/specs" "$d/playwright-report"
  echo "$d"
}

# Place the documented context files in the repo (Stage 0 targets).
seed_docs() {
  local d="$1"
  echo "# App Context" > "$d/tests/e2e/docs/app-context.md"
  echo "# Test Scenarios" > "$d/tests/e2e/docs/test-scenarios.md"
  echo "# Journey Map" > "$d/tests/e2e/docs/journey-map.md"
}

# Build a transcript JSONL with optional Read entries for the listed paths.
# Args: <path-to-transcript-file> [read-rel-paths...]
make_transcript() {
  local tf="$1"; shift
  : > "$tf"
  for p in "$@"; do
    printf '{"type":"tool_use","name":"Read","input":{"file_path":"%s"}}\n' "$p" >> "$tf"
  done
}

section "failure-diagnosis-stage0-preread-guard: tool-name filtering"

REPO=$(make_repo); seed_docs "$REPO"
TF="$REPO/.transcript"; make_transcript "$TF"
assert_allow "$H" "$(payload tool_name=Bash command='ls' cwd="$REPO" transcript_path="$TF")" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path="$REPO/tests/specs/x.spec.ts" cwd="$REPO" transcript_path="$TF")" "Read → silent allow"
rm -rf "$REPO"

section "failure-diagnosis-stage0-preread-guard: target classification"

# Non-test-tree edits should silent-allow even with FD context active.
REPO=$(make_repo); seed_docs "$REPO"
TF="$REPO/.transcript"; make_transcript "$TF"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/README.md" new_string='whatever' cwd="$REPO" transcript_path="$TF")" "non-test markdown edit → silent allow"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/src/index.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" "non-test source edit → silent allow"
rm -rf "$REPO"

section "failure-diagnosis-stage0-preread-guard: FD context inactive → allow"

# No playwright-report, no error-context, no FD mention in transcript → allow
REPO=$(mktemp -d); ( cd "$REPO" && git init -q )
mkdir -p "$REPO/tests/specs" "$REPO/tests/e2e/docs"
echo "# App Context" > "$REPO/tests/e2e/docs/app-context.md"
TF="$REPO/.transcript"; make_transcript "$TF"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/tests/specs/x.spec.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" "FD inactive + no required reads → silent allow"
rm -rf "$REPO"

section "failure-diagnosis-stage0-preread-guard: FD active + Stage 0 reads missing → DENY"

REPO=$(make_repo); seed_docs "$REPO"
TF="$REPO/.transcript"; make_transcript "$TF"
# FD active because playwright-report/ exists. Transcript has no Reads.
assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/tests/specs/x.spec.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" "FD active + no Stage 0 reads + test edit → DENY" "Stage 0"
assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/tests/data/page-repository.json" new_string='{}' cwd="$REPO" transcript_path="$TF")" "FD active + no Stage 0 reads + page-repository edit → DENY" "page-repository"
assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/bug-report.md" content='# Application Bug Report

Test: x' cwd="$REPO" transcript_path="$TF")" "FD active + no Stage 0 reads + bug report write → DENY" "Application Bug Report"
rm -rf "$REPO"

section "failure-diagnosis-stage0-preread-guard: FD active + all reads present → ALLOW"

REPO=$(make_repo); seed_docs "$REPO"
TF="$REPO/.transcript"; make_transcript "$TF" \
  "$REPO/tests/e2e/docs/app-context.md" \
  "$REPO/tests/e2e/docs/test-scenarios.md" \
  "$REPO/tests/e2e/docs/journey-map.md"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/tests/specs/x.spec.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" "FD active + all Stage 0 reads → ALLOW (test edit)"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/tests/data/page-repository.json" new_string='{}' cwd="$REPO" transcript_path="$TF")" "FD active + all Stage 0 reads → ALLOW (page-repo)"
rm -rf "$REPO"

section "failure-diagnosis-stage0-preread-guard: FD active + partial reads → DENY"

REPO=$(make_repo); seed_docs "$REPO"
TF="$REPO/.transcript"; make_transcript "$TF" "$REPO/tests/e2e/docs/app-context.md"
# Only app-context.md was read. test-scenarios.md and journey-map.md still missing.
assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/tests/specs/x.spec.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" "FD active + only app-context read → DENY (others missing)" "test-scenarios.md"
rm -rf "$REPO"

section "failure-diagnosis-stage0-preread-guard: documented files absent → ALLOW"

# FD active but the project has no journey-mapping output yet — nothing to enforce.
REPO=$(mktemp -d); ( cd "$REPO" && git init -q )
mkdir -p "$REPO/tests/specs" "$REPO/playwright-report"
TF="$REPO/.transcript"; make_transcript "$TF"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/tests/specs/x.spec.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" "FD active but no docs in repo → silent allow (nothing to enforce)"
rm -rf "$REPO"

section "failure-diagnosis-stage0-preread-guard: error-context signal → activates FD"

REPO=$(mktemp -d); ( cd "$REPO" && git init -q )
mkdir -p "$REPO/tests/specs" "$REPO/tests/e2e/docs" "$REPO/test-results"
echo "# App Context" > "$REPO/tests/e2e/docs/app-context.md"
echo "context" > "$REPO/test-results/error-context.md"
TF="$REPO/.transcript"; make_transcript "$TF"
assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/tests/specs/x.spec.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" "error-context.md present → FD active → DENY" "Stage 0"
rm -rf "$REPO"

section "failure-diagnosis-stage0-preread-guard: escape hatch via env var"

REPO=$(make_repo); seed_docs "$REPO"
TF="$REPO/.transcript"; make_transcript "$TF"
# Run the hook with FD_STAGE0_GUARD=off — should silent allow even with FD active.
HOOK_OUT=$(FD_STAGE0_GUARD=off bash "$H" <<<"$(payload tool_name=Edit file_path="$REPO/tests/specs/x.spec.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} FD_STAGE0_GUARD=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("FD_STAGE0_GUARD=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} FD_STAGE0_GUARD=off (expected silent allow)"
fi
rm -rf "$REPO"
