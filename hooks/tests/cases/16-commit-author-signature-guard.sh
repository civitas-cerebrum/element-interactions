#!/bin/bash
# Edge-case tests for hooks/commit-author-signature-guard.sh
#
# The hook ships in WARN-only mode by default (systemMessage, never DENY)
# so it doesn't globally block consumer commits via npm postinstall.
# Strict enforcement is opt-in via COMMIT_AUTHOR_SIGNATURE_GUARD=deny.
#
# Coverage:
#   - tool / command filter (silent allow paths)
#   - clean commits (no trailer / human-only trailer / no AI sentinel)
#   - WARN-only default → systemMessage with [NUDGE] headline
#   - DENY opt-in → permissionDecision=deny with [BLOCKED] headline
#   - false-positive avoidance (backticked literal, HTML comment,
#     quote-prefixed line)
#   - mixed human + AI co-authors (human preserved, AI flagged)
#   - escape hatch (off → silent allow)

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

# --- WARN-only default mode ---

section "commit-author-signature-guard: AI co-author trailers — WARN (default)"

# Canonical borealis.local trailer (the exact string the harness inserts).
BOREALIS='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

Co-Authored-By: borealis.local <198563339+borealis-local@users.noreply.github.com>
EOF
)"'
assert_warn "$H" "$(payload tool_name=Bash command="$BOREALIS")" \
  "borealis.local trailer → WARN (default mode)" "[NUDGE]"

# Generic Claude attribution.
CLAUDE_GENERIC='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"'
assert_warn "$H" "$(payload tool_name=Bash command="$CLAUDE_GENERIC")" \
  "Claude trailer → WARN (default mode)" "[NUDGE]"

# Lowercase / mixed case — must still be detected.
CLAUDE_LOWER='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

co-authored-by: claude <noreply@anthropic.com>
EOF
)"'
assert_warn "$H" "$(payload tool_name=Bash command="$CLAUDE_LOWER")" \
  "lowercase co-authored-by: claude → WARN (case-insensitive)" "[NUDGE]"

# --- DENY opt-in mode ---

section "commit-author-signature-guard: AI co-author trailers — DENY (opt-in via env var)"

# Helper for opt-in DENY: set COMMIT_AUTHOR_SIGNATURE_GUARD=deny on the
# hook invocation. The standard assert_deny helper from lib.sh doesn't
# pass env vars, so we run the hook by hand for these cases.

run_with_env() {
  local env_assignment="$1" hook="$2" stdin="$3"
  HOOK_EXIT=0
  HOOK_OUT=$(printf '%s' "$stdin" | env "$env_assignment" bash "$hook" 2>/dev/null) || HOOK_EXIT=$?
}

# DENY opt-in — borealis.local trailer.
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=deny" "$H" \
  "$(payload tool_name=Bash command="$BOREALIS")"
decision=$(echo "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
reason=$(echo "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
if [ "$decision" = "deny" ] && echo "$reason" | grep -q '\[BLOCKED\]'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=deny + borealis trailer → DENY ([BLOCKED])"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("deny mode borealis: decision=$decision reason=${reason:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=deny + borealis trailer → DENY ([BLOCKED])"
fi

# DENY opt-in — Anthropic attribution.
ANTHROPIC='git commit -m "$(cat <<'"'"'EOF'"'"'
feat: example

Co-authored-by: Anthropic <ops@anthropic.com>
EOF
)"'
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=deny" "$H" \
  "$(payload tool_name=Bash command="$ANTHROPIC")"
decision=$(echo "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
if [ "$decision" = "deny" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=deny + Anthropic trailer → DENY"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("deny mode anthropic: decision=$decision out=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=deny + Anthropic trailer → DENY"
fi

# DENY opt-in — clean commit must still pass through.
CLEAN_DENY='git commit -m "feat: nothing to flag"'
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=deny" "$H" \
  "$(payload tool_name=Bash command="$CLEAN_DENY")"
if [ -z "$HOOK_OUT" ] && [ "$HOOK_EXIT" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=deny + clean commit → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("deny mode clean: exit=$HOOK_EXIT out=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} COMMIT_AUTHOR_SIGNATURE_GUARD=deny + clean commit → silent allow"
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

# Backticked literal — same but in DENY opt-in mode (must still allow).
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=deny" "$H" \
  "$(payload tool_name=Bash command="$BACKTICKED")"
if [ -z "$HOOK_OUT" ] && [ "$HOOK_EXIT" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} backticked literal in DENY mode → still silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("backticked deny mode: exit=$HOOK_EXIT out=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} backticked literal in DENY mode → still silent allow"
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

# Default WARN mode: systemMessage names the AI line, leaves human line.
TESTS_RUN=$((TESTS_RUN + 1))
out=$(printf '%s' "$(payload tool_name=Bash command="$MIXED")" | bash "$H" 2>/dev/null || true)
msg=$(echo "$out" | jq -r '.systemMessage // empty')
if [ -n "$msg" ] \
   && echo "$msg" | grep -q 'borealis.local' \
   && ! echo "$msg" | grep -qE 'What was wrong:.*Jane Doe'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} mixed human + AI → WARN (only AI line flagged, human preserved)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("mixed warn: out=${out:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} mixed human + AI → WARN (only AI line flagged, human preserved)"
fi

# Same input, DENY opt-in mode.
TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "COMMIT_AUTHOR_SIGNATURE_GUARD=deny" "$H" \
  "$(payload tool_name=Bash command="$MIXED")"
decision=$(echo "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty')
reason=$(echo "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
if [ "$decision" = "deny" ] \
   && echo "$reason" | grep -q 'borealis.local' \
   && ! echo "$reason" | grep -qE 'What was wrong:.*Jane Doe'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} mixed human + AI in DENY mode → DENY (AI flagged, human preserved)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("mixed deny: decision=$decision reason=${reason:0:400}")
  echo "${CLR_FAIL}  ✗${CLR_RST} mixed human + AI in DENY mode → DENY (AI flagged, human preserved)"
fi

# --- WARN-mode standard layout ---

section "commit-author-signature-guard: WARN-mode message layout"
TESTS_RUN=$((TESTS_RUN + 1))
out=$(printf '%s' "$(payload tool_name=Bash command="$BOREALIS")" | bash "$H" 2>/dev/null || true)
msg=$(echo "$out" | jq -r '.systemMessage // empty')
ok=1
for header in "[NUDGE]" "Do this instead:" "What was wrong:" "Mode controls"; do
  echo "$msg" | grep -qF "$header" || ok=0
done
if [ "$ok" -eq 1 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} WARN message carries [NUDGE] / Do this instead / What was wrong / Mode controls"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("warn layout: missing one of [NUDGE]/Do this instead/What was wrong/Mode controls — ${msg:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} WARN message carries [NUDGE] / Do this instead / What was wrong / Mode controls"
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
