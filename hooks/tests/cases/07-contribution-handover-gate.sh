#!/bin/bash
# Edge-case tests for hooks/contribution-handover-gate.sh
H="$HOOK_DIR/contribution-handover-gate.sh"

# Each fixture dir holds:
#   .contribution-handover.json   — the handover under test
#   _README_IN_DIFF (file existence == "README modified vs. origin/main")
#   _PKG_FROM / _PKG_TO           — fake package.json delta
# We export CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR so the hook reads from the
# fixture instead of doing real git lookups.

# A helper to construct a fully-populated handover. Caller can override any
# nested field by piping the result through `jq` again before saving.
make_valid_handover() {
  cat <<'EOF'
{
  "$schema": "./schemas/contribution-handover.schema.json",
  "schemaVersion": 1,
  "pr": {
    "title": "feat: example",
    "branch": "feat/example",
    "summary": "Adds an example to verify the handover gate end-to-end."
  },
  "preflight": {
    "branchSyncedWithMain": true,
    "duplicateIssuesSearched": true,
    "duplicatePRsSearched": true,
    "depVersionsChecked": true
  },
  "design": {
    "argumentOrderConvention": true,
    "asyncEverywhere": true,
    "stepsKeptLightweight": true,
    "namingConvention": true,
    "noRawLocatorInSrc": true,
    "presenceDetectInActions": "n/a",
    "presenceDetectInActionsReason": "PR adds verifications only — no new action methods on Element layer.",
    "webOnlyCastAtSite": "n/a",
    "webOnlyCastAtSiteReason": "PR is page-level (storage); no web-only-at-cast-site narrowing involved.",
    "errorMessageFormatFollowed": true,
    "loggingPresent": true,
    "typescriptDiscipline": true
  },
  "tests": {
    "implemented": true,
    "exerciseRealVueApp": true,
    "nonTautologicalAssertions": true,
    "passing": true,
    "specFiles": ["tests/storage-api.spec.ts"]
  },
  "build": {
    "buildPasses": true,
    "fullSuitePassing": true,
    "knownFailures": ""
  },
  "coverage": {
    "apiCoverageGate100": true
  },
  "docs": {
    "readmeUpdated": true,
    "apiReferenceUpdated": true,
    "skillFilesUpdated": true
  },
  "version": {
    "patchBumpedOnce": true,
    "from": "0.3.4",
    "to":   "0.3.5"
  }
}
EOF
}

# Set up a fresh fixture dir, write the handover, and signal "README in
# diff" + version tuple. The caller can override the handover path with a
# transform.
mk_fixture() {
  local dir="$1" handover_transform="${2:-.}" readme_in_diff="${3:-1}" \
        pkg_from="${4:-0.3.4}" pkg_to="${5:-0.3.5}"
  mkdir -p "$dir"
  make_valid_handover | jq "$handover_transform" > "$dir/.contribution-handover.json"
  if [ "$readme_in_diff" = "1" ]; then
    : > "$dir/_README_IN_DIFF"
  else
    rm -f "$dir/_README_IN_DIFF"
  fi
  printf '%s' "$pkg_from" > "$dir/_PKG_FROM"
  printf '%s' "$pkg_to" > "$dir/_PKG_TO"
}

TMPROOT=$(mktemp -d -t contribhand.XXXXXX)
trap 'rm -rf "$TMPROOT"' EXIT

# Helper that runs the hook with the right env var set against a given
# fixture dir. We can't inline this into assert_*'s stdin captures because
# the helpers don't accept env vars — so we wrap it.
run_against_fixture() {
  local dir="$1" stdin="$2"
  CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$dir" \
    bash "$H" <<<"$stdin" 2>/dev/null
}

# --- pass-through: only fires on git push origin / gh pr create ---

section "tool-name filter"
assert_allow "$H" "$(payload tool_name=Read file_path=/tmp/x)" "Read invocation → silent allow"
assert_allow "$H" "$(payload tool_name=Edit file_path=/tmp/x)" "Edit invocation → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-x: cycle 1')" "Agent invocation → silent allow"

section "command filter — non-share Bash invocations pass through"
assert_allow "$H" "$(payload tool_name=Bash command='git status')" "git status → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='git commit -m foo')" "git commit → silent allow (commit-message-gate handles)"
assert_allow "$H" "$(payload tool_name=Bash command='git push fork feat/x')" "git push to non-origin → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='gh pr view 42')" "gh pr view → silent allow"

# --- DENY paths via fixtures ---

section "missing handover file"
fixture="$TMPROOT/missing"
mkdir -p "$fixture"   # no handover file
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='git push origin feat/x')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && echo "$out" | grep -q '\[BLOCKED\]' \
   && echo "$out" | grep -q 'Contribution handover missing'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} missing handover → DENY with [BLOCKED] header"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("missing handover: did not emit expected DENY: ${out:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} missing handover → DENY with [BLOCKED] header"
fi

section "invalid JSON"
fixture="$TMPROOT/badjson"
mkdir -p "$fixture"
echo '{ this is not json' > "$fixture/.contribution-handover.json"
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='git push origin feat/x')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && echo "$out" | grep -q 'not valid JSON'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} invalid JSON → DENY"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("invalid JSON: ${out:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} invalid JSON → DENY"
fi

section "unset (null) required field"
fixture="$TMPROOT/unset"
# Set tests.implemented to null to simulate the template placeholder.
mk_fixture "$fixture" '.tests.implemented = null'
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='git push origin feat/x')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && echo "$out" | grep -q 'unset fields' \
   && echo "$out" | grep -q 'tests.implemented'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} unset field → DENY listing the field"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("unset field: ${out:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} unset field → DENY listing the field"
fi

section 'false / "n/a" without reason'
fixture="$TMPROOT/noreason"
# Flip presenceDetectInActions to "n/a" but DROP its reason field.
mk_fixture "$fixture" 'del(.design.presenceDetectInActionsReason)'
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='gh pr create --title x --body y')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && echo "$out" | grep -q 'without justification' \
   && echo "$out" | grep -q 'presenceDetectInActions'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} \"n/a\" without paired reason → DENY"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("no reason: ${out:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} \"n/a\" without paired reason → DENY"
fi

section "vague reason (< 20 chars)"
fixture="$TMPROOT/vague"
mk_fixture "$fixture" '.design.presenceDetectInActionsReason = "skip"'
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='git push origin feat/x')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && echo "$out" | grep -q 'without justification'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} vague reason → DENY"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("vague reason: ${out:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} vague reason → DENY"
fi

section "README claim mismatch — claims true but README not in diff"
fixture="$TMPROOT/readme-claimed"
mk_fixture "$fixture" '.docs.readmeUpdated = true' "0"   # readme NOT in diff
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='git push origin feat/x')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && echo "$out" | grep -q 'readmeUpdated: true' \
   && echo "$out" | grep -q 'not in the diff'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} readme claim true + README absent → DENY"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("readme claim mismatch (true): ${out:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} readme claim true + README absent → DENY"
fi

section 'README claim mismatch — claims "n/a" but README IS in diff'
fixture="$TMPROOT/readme-na-but-modified"
mk_fixture "$fixture" \
  '.docs.readmeUpdated = "n/a" | .docs.readmeUpdatedReason = "Internal-only Verifications change, no public Steps surface."' \
  "1"   # readme IS in diff
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='git push origin feat/x')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && echo "$out" | grep -q 'README\.md \*is\* modified'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} readme claim n/a + README present → DENY"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("readme claim mismatch (n/a): ${out:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} readme claim n/a + README present → DENY"
fi

section "version delta mismatch"
fixture="$TMPROOT/version"
mk_fixture "$fixture" '.version.to = "0.3.99"' "1" "0.3.4" "0.3.5"
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='git push origin feat/x')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
   && echo "$out" | grep -q '0.3.4 → 0.3.99'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} version mismatch → DENY"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("version mismatch: ${out:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} version mismatch → DENY"
fi

# --- ALLOW path: fully populated, README diff matches, version delta matches ---
section "fully populated + consistent → silent allow"
fixture="$TMPROOT/happy"
mk_fixture "$fixture" '.' "1" "0.3.4" "0.3.5"
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='git push origin feat/storage-api')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$out" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} valid handover → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("happy path: expected silent allow, got: ${out:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} valid handover → silent allow"
fi

section "valid handover + gh pr create → silent allow"
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='gh pr create --title x --body y')" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$out" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} valid handover + gh pr create → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("happy path (gh): ${out:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} valid handover + gh pr create → silent allow"
fi

section "DENY messages always include the standard layout"
# Shape-only: confirm one representative DENY message has every standard
# section header. We use the unset-field case from above.
fixture="$TMPROOT/shape"
mk_fixture "$fixture" '.tests.implemented = null'
out=$(CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR="$fixture" \
  bash "$H" <<<"$(payload tool_name=Bash command='git push origin feat/x')" 2>/dev/null || true)
reason=$(echo "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
TESTS_RUN=$((TESTS_RUN + 1))
ok=1
for header in "[BLOCKED]" "Do this instead:" "What was wrong:" "References:"; do
  echo "$reason" | grep -qF "$header" || ok=0
done
if [ "$ok" -eq 1 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} DENY message contains the four standard sections"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("standard layout: missing one of [BLOCKED]/Do this instead/What was wrong/References — ${reason:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} DENY message contains the four standard sections"
fi
