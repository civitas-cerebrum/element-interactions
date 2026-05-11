#!/bin/bash
# Edge-case tests for hooks/commit-author-signature-guard.sh
#
# Default mode is DENY: any AI-attribution Co-Authored-By: trailer in a
# `git commit` body blocks the commit. Real humans never trigger the
# hook (it only fires on AI sentinel patterns), so blocking by default
# does not interfere with legitimate human commits.
#
# Coverage:
#   - tool / command filter (silent allow paths)
#   - clean commits (no trailer / human-only trailer / no AI sentinel)
#   - DENY default → permissionDecision=deny with [BLOCKED] headline
#   - WARN opt-down → systemMessage with [NUDGE] headline
#   - false-positive avoidance (backticked literal, HTML comment,
#     quote-prefixed line)
#   - mixed human + AI co-authors (human preserved, AI flagged)
#   - escape hatch (off → silent allow)

H="$HOOK_DIR/commit-author-signature-guard.sh"

# Helper for env-var-driven mode tests: run the hook with a single env
# assignment scoped to the invocation. The standard assert_* helpers
# don't pass env vars, so we run the hook by hand for these cases.
run_with_env() {
  local env_assignment="$1" hook="$2" stdin="$3"
  HOOK_EXIT=0
  HOOK_OUT=$(printf '%s' "$stdin" | env "$env_assignment" bash "$hook" 2>/dev/null) || HOOK_EXIT=$?
}

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

# --- DENY default mode ---

section "commit-author-signature-guard: AI co-author trailers — DENY (default)"

# Canonical borealis.local trailer (the exact string the harness inserts).
BOREALIS='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

Co-Authored-By: borealis.local <198563339+borealis-local@users.noreply.github.com>
EOF
)"'
assert_deny "$H" "$(payload tool_name=Bash command="$BOREALIS")" \
  "borealis.local trailer → DENY (default mode)" "[BLOCKED]"

# Generic Claude attribution.
CLAUDE_GENERIC='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"'
assert_deny "$H" "$(payload tool_name=Bash command="$CLAUDE_GENERIC")" \
  "Claude trailer → DENY (default mode)" "[BLOCKED]"

# Lowercase / mixed case — must still be detected.
CLAUDE_LOWER='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

co-authored-by: claude <noreply@anthropic.com>
EOF
)"'
assert_deny "$H" "$(payload tool_name=Bash command="$CLAUDE_LOWER")" \
  "lowercase co-authored-by: claude → DENY (case-insensitive)" "[BLOCKED]"

# --- WARN opt-down mode ---

section "commit-author-signature-guard: WARN opt-down (env COMMIT_AUTHOR_SIGNATURE_GUARD=warn)"

# WARN opt-down — borealis.local trailer.
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=warn" "$H" \
  "$(payload tool_name=Bash command="$BOREALIS")"
msg=$(echo "$HOOK_OUT" | jq -r '.systemMessage // empty')
if [ -n "$msg" ] && echo "$msg" | grep -q '\[NUDGE\]'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=warn + borealis trailer → systemMessage ([NUDGE])"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("warn mode borealis: msg=${msg:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=warn + borealis trailer → systemMessage ([NUDGE])"
fi

# WARN opt-down — clean commit must still pass through.
CLEAN_WARN='git commit -m "feat: nothing to flag"'
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=warn" "$H" \
  "$(payload tool_name=Bash command="$CLEAN_WARN")"
if [ -z "$HOOK_OUT" ] && [ "$HOOK_EXIT" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=warn + clean commit → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("warn mode clean: exit=$HOOK_EXIT out=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=warn + clean commit → silent allow"
fi

# --- false-positive avoidance ---

section "commit-author-signature-guard: false-positive avoidance — silent allow"

# Backticked literal — meta-commit documenting the rule.
BACKTICKED='git commit -m "$(cat <<'"'"'EOF'"'"'
docs: explain the rule

The `Co-Authored-By: Claude` trailer is forbidden. This commit body
contains the literal string above as documentation, not as a real
co-author trailer — the hook MUST NOT flag it.
EOF
)"'
assert_allow "$H" "$(payload tool_name=Bash command="$BACKTICKED")" \
  "backticked Co-Authored-By: literal → silent allow (false-positive avoidance)"

# Backticked literal in WARN mode — must still allow.
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=warn" "$H" \
  "$(payload tool_name=Bash command="$BACKTICKED")"
if [ -z "$HOOK_OUT" ] && [ "$HOOK_EXIT" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} backticked literal in WARN mode → still silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("backticked warn mode: exit=$HOOK_EXIT out=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} backticked literal in WARN mode → still silent allow"
fi

# HTML comment — same idea, comment-style documentation.
HTMLCOMMENT='git commit -m "$(cat <<'"'"'EOF'"'"'
docs: explain the rule

<!-- Co-Authored-By: Claude <noreply@anthropic.com> -->
Above is a meta-example of the forbidden trailer; commented out as
documentation, not a real trailer.
EOF
)"'
assert_allow "$H" "$(payload tool_name=Bash command="$HTMLCOMMENT")" \
  "<!-- Co-Authored-By: --> HTML comment → silent allow (false-positive avoidance)"

# Quote-prefixed line — explainer / quoted prior-commit body.
QUOTED='git commit -m "$(cat <<'"'"'EOF'"'"'
docs: quote prior commit

The earlier commit included this line:

> Co-Authored-By: Claude <noreply@anthropic.com>

We removed it because of the rule.
EOF
)"'
assert_allow "$H" "$(payload tool_name=Bash command="$QUOTED")" \
  "> Co-Authored-By: quoted line → silent allow (false-positive avoidance)"

# --- mixed human + AI co-authors ---

section "commit-author-signature-guard: mixed human + AI co-authors"

MIXED='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: pair-programmed

Co-Authored-By: Jane Doe <jane@example.com>
Co-Authored-By: borealis.local <198563339+borealis-local@users.noreply.github.com>
EOF
)"'

# Default DENY mode: reason names the AI line, leaves human line.
TESTS_RUN=$((TESTS_RUN + 1))
out=$(printf '%s' "$(payload tool_name=Bash command="$MIXED")" | bash "$H" 2>/dev/null || true)
decision=$(echo "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty')
reason=$(echo "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
if [ "$decision" = "deny" ] \
   && echo "$reason" | grep -q 'borealis.local' \
   && ! echo "$reason" | grep -qE 'What was wrong:.*Jane Doe'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} mixed human + AI → DENY (only AI line flagged, human preserved)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("mixed deny: decision=$decision reason=${reason:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} mixed human + AI → DENY (only AI line flagged, human preserved)"
fi

# Same input, WARN opt-down mode.
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=warn" "$H" \
  "$(payload tool_name=Bash command="$MIXED")"
msg=$(echo "$HOOK_OUT" | jq -r '.systemMessage // empty')
if [ -n "$msg" ] \
   && echo "$msg" | grep -q 'borealis.local' \
   && ! echo "$msg" | grep -qE 'What was wrong:.*Jane Doe'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} mixed human + AI in WARN mode → systemMessage (AI flagged, human preserved)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("mixed warn: msg=${msg:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} mixed human + AI in WARN mode → systemMessage (AI flagged, human preserved)"
fi

# --- DENY-mode standard layout ---

section "commit-author-signature-guard: DENY-mode message layout"
TESTS_RUN=$((TESTS_RUN + 1))
out=$(printf '%s' "$(payload tool_name=Bash command="$BOREALIS")" | bash "$H" 2>/dev/null || true)
reason=$(echo "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
ok=1
for header in "[BLOCKED]" "Do this instead:" "What was wrong:" "Mode controls"; do
  echo "$reason" | grep -qF "$header" || ok=0
done
if [ "$ok" -eq 1 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} DENY message carries [BLOCKED] / Do this instead / What was wrong / Mode controls"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("deny layout: missing one of [BLOCKED]/Do this instead/What was wrong/Mode controls — ${reason:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} DENY message carries [BLOCKED] / Do this instead / What was wrong / Mode controls"
fi

# --- escape hatch ---

section "commit-author-signature-guard: escape hatch"
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=off" "$H" \
  "$(payload tool_name=Bash command="$BOREALIS")"
if [ -z "$HOOK_OUT" ] && [ "$HOOK_EXIT" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=off → silent allow even with AI trailer"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("escape hatch: expected silent allow, got: exit=$HOOK_EXIT output=${HOOK_OUT:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=off → silent allow even with AI trailer"
fi
