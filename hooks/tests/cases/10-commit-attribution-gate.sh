#!/bin/bash
H="$HOOK_DIR/commit-attribution-gate.sh"

section "commit-attribution-gate: tool / command filtering"

assert_allow "$H" "$(payload tool_name=Read file_path='/x/foo')" "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='ls -la')" "non-git command → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='git status')" "git status → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='git log --oneline -5')" "git log → silent allow"

section "commit-attribution-gate: no issue reference → silent allow"

assert_allow "$H" "$(payload tool_name=Bash "command=git commit -m 'chore: scaffold'")" "no issue ref → silent allow"
assert_allow "$H" "$(payload tool_name=Bash "command=git commit -m 'feat: add new method'")" "feat without issue ref → silent allow"

section "commit-attribution-gate: issue reference WITH attribution → ALLOW"

CMD1="git commit -m 'feat: add Stage 0 (closes #156)

Reported-by: @umutayb'"
assert_allow "$H" "$(payload tool_name=Bash "command=$CMD1")" "closes #N + Reported-by → silent allow"

CMD2="git commit -m 'fix: edge case (Fixes #142)

Issue-reported-by: @Emmdb'"
assert_allow "$H" "$(payload tool_name=Bash "command=$CMD2")" "Fixes #N + Issue-reported-by → silent allow"

CMD3="git commit -m 'feat: complex fix

Resolves #200

Reported-by: @user-with-dash, @another_user'"
assert_allow "$H" "$(payload tool_name=Bash "command=$CMD3")" "Resolves #N + multi-reporter → silent allow"

section "commit-attribution-gate: issue reference WITHOUT attribution → WARN"

CMD4="git commit -m 'feat: add Stage 0 (closes #156)'"
assert_warn "$H" "$(payload tool_name=Bash "command=$CMD4")" "closes #N without attribution → WARN" "Reported-by"

CMD5="git commit -m 'fix: bug (Fixes #142)'"
assert_warn "$H" "$(payload tool_name=Bash "command=$CMD5")" "Fixes #N without attribution → WARN" "Reported-by"

CMD6="git commit -m 'docs: update (Resolves #99)'"
assert_warn "$H" "$(payload tool_name=Bash "command=$CMD6")" "Resolves #N without attribution → WARN" "Reported-by"

section "commit-attribution-gate: case insensitivity"

CMD7="git commit -m 'fix: foo (closes #11)'"
assert_warn "$H" "$(payload tool_name=Bash "command=$CMD7")" "lowercase closes → WARN" "Reported-by"

CMD8="git commit -m 'fix: foo (CLOSES #11)

REPORTED-BY: @upper'"
assert_allow "$H" "$(payload tool_name=Bash "command=$CMD8")" "uppercase closes + UPPER REPORTED-BY → silent allow"

section "commit-attribution-gate: HEREDOC commit form"

# CLAUDE.md style: git commit -m "$(cat <<'EOF' ... EOF)"
HEREDOC="git commit -m \"\$(cat <<'EOF'
feat(skills): closes #156

Reported-by: @umutayb
EOF
)\""
assert_allow "$H" "$(payload tool_name=Bash "command=$HEREDOC")" "HEREDOC + Reported-by inline → silent allow"

HEREDOC2="git commit -m \"\$(cat <<'EOF'
feat(skills): closes #156

Body without attribution.
EOF
)\""
assert_warn "$H" "$(payload tool_name=Bash "command=$HEREDOC2")" "HEREDOC without Reported-by → WARN" "Reported-by"

section "commit-attribution-gate: cross-repo issue refs"

CMD9="git commit -m 'fix: thing (Closes civitas-cerebrum/element-repository#33)'"
assert_warn "$H" "$(payload tool_name=Bash "command=$CMD9")" "cross-repo issue ref → WARN" "Reported-by"

section "commit-attribution-gate: escape hatch"

HOOK_OUT=$(COMMIT_ATTRIBUTION_GATE=off bash "$H" <<<"$(payload tool_name=Bash "command=git commit -m 'fix: closes #1'")" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} COMMIT_ATTRIBUTION_GATE=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("COMMIT_ATTRIBUTION_GATE=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} COMMIT_ATTRIBUTION_GATE=off (expected silent allow)"
fi
