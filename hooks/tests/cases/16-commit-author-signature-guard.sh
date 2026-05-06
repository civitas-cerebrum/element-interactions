#!/bin/bash
# Edge-case tests for hooks/commit-author-signature-guard.sh
H="$HOOK_DIR/commit-author-signature-guard.sh"

# --- tool / command filter (silent allow paths) ---

section "commit-author-signature-guard: tool / command filter — silent allow"

assert_allow "$H" "$(payload tool_name=Read file_path=/tmp/x)" \
  "Read invocation → silent allow"

assert_allow "$H" "$(payload tool_name=Write file_path=/tmp/x content=hi)" \
  "Write invocation → silent allow"

assert_allow "$H" "$(payload tool_name=Bash command='ls -la')" \
  "Bash non-git-commit (ls) → silent allow"

assert_allow "$H" "$(payload tool_name=Bash command='git status')" \
  "git status → silent allow"

assert_allow "$H" "$(payload tool_name=Bash command='git log --oneline -5')" \
  "git log → silent allow"

# --- happy path: commits without (AI) co-author trailers ---

section "commit-author-signature-guard: clean commits — silent allow"

assert_allow "$H" "$(payload tool_name=Bash command='git commit -m "feat: add storage api"')" \
  "plain -m commit, no co-author → silent allow"

# HEREDOC commit body with no co-author at all.
HEREDOC_CLEAN='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: add storage api

Adds steps.localStorage / steps.sessionStorage helpers.
EOF
)"'
assert_allow "$H" "$(payload tool_name=Bash command="$HEREDOC_CLEAN")" \
  "HEREDOC commit, no co-author → silent allow"

# Real-human Co-Authored-By: only.
HUMAN_COAUTHOR='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: add storage api

Co-Authored-By: Jane Doe <jane@example.com>
EOF
)"'
assert_allow "$H" "$(payload tool_name=Bash command="$HUMAN_COAUTHOR")" \
  "real-human Co-Authored-By: only → silent allow"

# --- DENY paths: AI attributions ---

section "commit-author-signature-guard: AI co-author trailers — DENY"

# Canonical borealis.local trailer (the exact string the harness inserts).
BOREALIS='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

Co-Authored-By: borealis.local <198563339+borealis-local@users.noreply.github.com>
EOF
)"'
assert_deny "$H" "$(payload tool_name=Bash command="$BOREALIS")" \
  "borealis.local trailer → DENY" "[BLOCKED] commit message contains Claude/AI co-author signature."

# Generic Claude attribution.
CLAUDE_GENERIC='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"'
assert_deny "$H" "$(payload tool_name=Bash command="$CLAUDE_GENERIC")" \
  "Claude <noreply@anthropic.com> trailer → DENY" "[BLOCKED]"

# Lowercase / mixed case — must still be detected.
CLAUDE_LOWER='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

co-authored-by: claude <noreply@anthropic.com>
EOF
)"'
assert_deny "$H" "$(payload tool_name=Bash command="$CLAUDE_LOWER")" \
  "lowercase co-authored-by: claude → DENY (case-insensitive)" "[BLOCKED]"

# Anthropic attribution (e.g. an Anthropic-team handle).
ANTHROPIC='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

Co-authored-by: Anthropic <ops@anthropic.com>
EOF
)"'
assert_deny "$H" "$(payload tool_name=Bash command="$ANTHROPIC")" \
  "Anthropic attribution → DENY" "[BLOCKED]"

# HEREDOC form with a borealis trailer (already covered above by BOREALIS,
# but assert again that the deny carries the standard layout).
section "commit-author-signature-guard: DENY layout"
out=$(printf '%s' "$(payload tool_name=Bash command="$BOREALIS")" | bash "$H" 2>/dev/null || true)
reason=$(echo "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
TESTS_RUN=$((TESTS_RUN + 1))
ok=1
for header in "[BLOCKED]" "Do this instead:" "What was wrong:" "References:"; do
  echo "$reason" | grep -qF "$header" || ok=0
done
if [ "$ok" -eq 1 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} DENY message carries standard four-section layout"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("standard layout: missing one of [BLOCKED]/Do this instead/What was wrong/References — ${reason:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} DENY message carries standard four-section layout"
fi

# Mixed: one human + one Claude trailer. DENY, with the Claude line
# called out in the wrong-list and the human line preserved in the
# corrective command.
section "commit-author-signature-guard: mixed human + AI co-authors"
MIXED='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: pair-programmed

Co-Authored-By: Jane Doe <jane@example.com>
Co-Authored-By: borealis.local <198563339+borealis-local@users.noreply.github.com>
EOF
)"'
out=$(printf '%s' "$(payload tool_name=Bash command="$MIXED")" | bash "$H" 2>/dev/null || true)
TESTS_RUN=$((TESTS_RUN + 1))
decision=$(echo "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty')
reason=$(echo "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
if [ "$decision" = "deny" ] \
   && echo "$reason" | grep -q 'borealis.local' \
   && ! echo "$reason" | grep -qE 'What was wrong:.*Jane Doe' ; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} mixed human + AI → DENY (only AI line flagged)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("mixed: decision=$decision reason=${reason:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} mixed human + AI → DENY (only AI line flagged)"
fi

# --- escape hatch ---

section "commit-author-signature-guard: escape hatch"
TESTS_RUN=$((TESTS_RUN + 1))
out=$(COMMIT_AUTHOR_SIGNATURE_GUARD=off bash "$H" \
  <<<"$(payload tool_name=Bash command="$BOREALIS")" 2>/dev/null || true)
if [ -z "$out" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=off → silent allow even with AI trailer"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("escape hatch: expected silent allow, got: ${out:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=off → silent allow even with AI trailer"
fi
