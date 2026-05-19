#!/bin/bash
# Tests for workflow-reviewer-attestation-gate.sh — PostToolUse:Agent
# WARN gate. Surfaces a systemMessage when verdict == approve but the
# combined attestation + checklist evidence cites no real on-disk paths.
H="$HOOK_DIR/workflow-reviewer-attestation-gate.sh"

# Skip the suite if the `yaml` package isn't available (the hook then
# silent-allows on parse failure, which makes deny-expectation tests
# meaningless).
if ! command -v node >/dev/null 2>&1; then
  echo "  ${CLR_DIM}(node not on PATH — skipping attestation-gate cases)${CLR_RST}"
  return 0 2>/dev/null || exit 0
fi
NODE_BIN=$(command -v node)
if ! "$NODE_BIN" -e "require('yaml');" >/dev/null 2>&1; then
  echo "  ${CLR_DIM}(yaml package unavailable — skipping attestation-gate cases)${CLR_RST}"
  return 0 2>/dev/null || exit 0
fi

# Isolated repo so the hook resolves REPO_ROOT to a temp dir.
ATTEST_TMP=$(mktemp -d)
trap 'rm -rf "$ATTEST_TMP"' EXIT
( cd "$ATTEST_TMP" && git init -q && git config user.email t@t && git config user.name t && git commit -q --allow-empty -m init ) >/dev/null 2>&1
mkdir -p "$ATTEST_TMP/tests/e2e/docs" "$ATTEST_TMP/scripts"

# Seed two real files in the temp repo.
echo "{}" > "$ATTEST_TMP/tests/e2e/docs/onboarding-status.json"
echo "// stub" > "$ATTEST_TMP/scripts/postinstall.js"

section "attestation-gate: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/tmp/x')" "Write → silent allow"

section "attestation-gate: non-reviewer Agent descriptions are silent allow"
RESP_GENERIC='verdict: approve\nattestation: ok'
P_GEN=$(payload tool_name=Agent description='composer-j-x' response_text="$RESP_GENERIC")
assert_allow "$H" "$P_GEN" "composer- → silent allow"

section "attestation-gate: reviewer with non-approve verdict silent-allows"
RESP_REJECT='handover:
  role: workflow-reviewer-phase1
  cycle: 1
  status: rejected
  next-action: orchestrator
verdict: reject
findings:
  - checklist-item: foo
    what-missing: bar
    fix-instruction: baz'
P_REJ=$(payload tool_name=Agent description='workflow-reviewer-phase1' response_text="$RESP_REJECT" cwd="$ATTEST_TMP")
assert_allow "$H" "$P_REJ" "reject verdict → silent allow"

RESP_ESCALATE=$(printf '%s' "$RESP_REJECT" | sed 's/verdict: reject/verdict: escalate/' | sed 's/status: rejected/status: escalated-to-user/')
P_ESC=$(payload tool_name=Agent description='workflow-reviewer-phase1' response_text="$RESP_ESCALATE" cwd="$ATTEST_TMP")
assert_allow "$H" "$P_ESC" "escalate verdict → silent allow"

section "attestation-gate: approve with no path citation WARNS"
RESP_NOPATH='handover:
  role: workflow-reviewer-phase1
  cycle: 1
  status: approved
  next-action: orchestrator
verdict: approve
attestation: all checks passed'
P_NOPATH=$(payload tool_name=Agent description='workflow-reviewer-phase1' response_text="$RESP_NOPATH" cwd="$ATTEST_TMP")
assert_warn "$H" "$P_NOPATH" "approve no-path → WARN" "approval without on-disk evidence"

section "attestation-gate: approve citing existent path silent-allows"
RESP_OK='handover:
  role: workflow-reviewer-phase1
  cycle: 1
  status: approved
  next-action: orchestrator
verdict: approve
attestation: verified tests/e2e/docs/onboarding-status.json and methodology/scripts/postinstall.js on disk'
P_OK=$(payload tool_name=Agent description='workflow-reviewer-phase1' response_text="$RESP_OK" cwd="$ATTEST_TMP")
assert_allow "$H" "$P_OK" "approve + existing paths → silent allow"

section "attestation-gate: approve citing non-existent path WARNS"
RESP_FAKE='handover:
  role: workflow-reviewer-phase1
  cycle: 1
  status: approved
  next-action: orchestrator
verdict: approve
attestation: verified tests/e2e/docs/nonexistent.json on disk'
P_FAKE=$(payload tool_name=Agent description='workflow-reviewer-phase1' response_text="$RESP_FAKE" cwd="$ATTEST_TMP")
assert_warn "$H" "$P_FAKE" "approve + missing path → WARN" "cites paths that do not exist"

section "attestation-gate: approve with checklist evidence citing real paths silent-allows"
RESP_CHECKLIST='handover:
  role: workflow-reviewer-phase1
  cycle: 1
  status: approved
  next-action: orchestrator
verdict: approve
attestation: all phase 1 exit criteria met
checklist:
  - item: ledger file exists
    satisfied: true
    evidence: read tests/e2e/docs/onboarding-status.json on disk
  - item: postinstall present
    satisfied: true
    evidence: confirmed methodology/scripts/postinstall.js exists'
P_CL=$(payload tool_name=Agent description='workflow-reviewer-phase1' response_text="$RESP_CHECKLIST" cwd="$ATTEST_TMP")
assert_allow "$H" "$P_CL" "approve + checklist evidence + real paths → silent allow"

section "attestation-gate: malformed YAML response silent-allows (return-schema-guard owns shape)"
P_MAL=$(payload tool_name=Agent description='workflow-reviewer-phase1' response_text='::: not yaml :::' cwd="$ATTEST_TMP")
assert_allow "$H" "$P_MAL" "malformed return → silent allow"
