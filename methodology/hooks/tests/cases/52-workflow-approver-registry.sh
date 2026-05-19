#!/bin/bash
# Tests for workflow-approver-registry.sh — PreToolUse:Agent registrar
# of approver-prefixed dispatches. Always silent-allow; the side effect
# is the registry file written under tests/e2e/docs/.workflow-approvers.json.
H="$HOOK_DIR/workflow-approver-registry.sh"

# Isolated test repo so EI's own tests/e2e/docs is never polluted.
TMPREG=$(mktemp -d)
trap 'rm -rf "$TMPREG"' EXIT
mkdir -p "$TMPREG/tests/e2e/docs"
( cd "$TMPREG" && git init -q && git config user.email t@t && git config user.name t && git commit -q --allow-empty -m init ) >/dev/null 2>&1
REG="$TMPREG/tests/e2e/docs/.workflow-approvers.json"

section "approver-registry: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/tmp/x' content='y')" "Write → silent allow"

section "approver-registry: non-approver Agent prefixes silent-allow, no registry write"
rm -f "$REG"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-x-1-c1' cwd="$TMPREG")" "composer- → silent allow"
TESTS_RUN=$((TESTS_RUN+1))
if [ ! -f "$REG" ]; then TESTS_PASSED=$((TESTS_PASSED+1)); echo "${CLR_PASS}  ✓${CLR_RST} composer- did NOT write registry"; else TESTS_FAILED=$((TESTS_FAILED+1)); echo "${CLR_FAIL}  ✗${CLR_RST} composer- unexpectedly wrote registry"; fi
assert_allow "$H" "$(payload tool_name=Agent description='probe-j-x-4-c1' cwd="$TMPREG")" "probe- → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-pass-1' cwd="$TMPREG")" "cleanup- → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='reviewer-j-x-1-c1' cwd="$TMPREG")" "reviewer-j- → silent allow (not an approver prefix)"

section "approver-registry: workflow-reviewer-* registers"
rm -f "$REG"
P=$(payload tool_name=Agent description='workflow-reviewer-phase1' cwd="$TMPREG")
P=$(echo "$P" | "$JQ" -c '. + {tool_use_id: "toolu_wr_001"}')
assert_allow "$H" "$P" "workflow-reviewer- → silent allow"
TESTS_RUN=$((TESTS_RUN+1))
if [ -f "$REG" ] && "$JQ" -e '.toolu_wr_001.role == "workflow-reviewer"' "$REG" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED+1)); echo "${CLR_PASS}  ✓${CLR_RST} registry has workflow-reviewer entry"
else
  TESTS_FAILED=$((TESTS_FAILED+1)); echo "${CLR_FAIL}  ✗${CLR_RST} registry missing workflow-reviewer entry"
fi

section "approver-registry: phase-validator-* registers"
P=$(payload tool_name=Agent description='phase-validator-3' cwd="$TMPREG")
P=$(echo "$P" | "$JQ" -c '. + {tool_use_id: "toolu_pv_003"}')
assert_allow "$H" "$P" "phase-validator- → silent allow"
TESTS_RUN=$((TESTS_RUN+1))
if "$JQ" -e '.toolu_pv_003.role == "phase-validator"' "$REG" >/dev/null 2>&1; then
  TESTS_PASSED=$((TESTS_PASSED+1)); echo "${CLR_PASS}  ✓${CLR_RST} registry has phase-validator entry"
else
  TESTS_FAILED=$((TESTS_FAILED+1)); echo "${CLR_FAIL}  ✗${CLR_RST} registry missing phase-validator entry"
fi

section "approver-registry: missing tool_use_id silent-allows without writing"
rm -f "$REG"
assert_allow "$H" "$(payload tool_name=Agent description='workflow-reviewer-phase2' cwd="$TMPREG")" "workflow-reviewer- without tool_use_id → silent allow"
TESTS_RUN=$((TESTS_RUN+1))
[ ! -f "$REG" ] && { TESTS_PASSED=$((TESTS_PASSED+1)); echo "${CLR_PASS}  ✓${CLR_RST} no registry entry when tool_use_id absent"; } || { TESTS_FAILED=$((TESTS_FAILED+1)); echo "${CLR_FAIL}  ✗${CLR_RST} registry written despite missing tool_use_id"; }

section "approver-registry: missing tests/e2e/docs dir silent-allows without writing"
NODOCS=$(mktemp -d)
( cd "$NODOCS" && git init -q && git config user.email t@t && git config user.name t && git commit -q --allow-empty -m init ) >/dev/null 2>&1
P=$(payload tool_name=Agent description='workflow-reviewer-phase1' cwd="$NODOCS")
P=$(echo "$P" | "$JQ" -c '. + {tool_use_id: "toolu_xxx"}')
assert_allow "$H" "$P" "no docs dir → silent allow"
TESTS_RUN=$((TESTS_RUN+1))
[ ! -f "$NODOCS/tests/e2e/docs/.workflow-approvers.json" ] && { TESTS_PASSED=$((TESTS_PASSED+1)); echo "${CLR_PASS}  ✓${CLR_RST} no registry created without docs dir"; } || { TESTS_FAILED=$((TESTS_FAILED+1)); echo "${CLR_FAIL}  ✗${CLR_RST} registry created without docs dir"; }
rm -rf "$NODOCS"
