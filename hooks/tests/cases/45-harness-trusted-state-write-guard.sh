#!/bin/bash
# Tests for harness-trusted-state-write-guard.sh — DENY when Write/Edit/Bash
# would touch any harness-trusted state path (stop-authorization sentinels,
# phase-validator ledger, stop-deny counter family).
H="$HOOK_DIR/harness-trusted-state-write-guard.sh"

section "harness-trusted-state-write-guard: only PreToolUse fires"
# Non-PreToolUse events silently allow.
assert_allow "$H" "$(payload hook_event_name=PostToolUse tool_name=Write file_path='.claude/onboarding-stop-authorized' content='x')" "PostToolUse event → silent allow"

section "harness-trusted-state-write-guard: writes to non-protected paths allowed"
assert_allow "$H" "$(payload hook_event_name=PreToolUse tool_name=Write file_path=/tmp/scratch.txt content='x')" "/tmp/scratch.txt → silent allow"
assert_allow "$H" "$(payload hook_event_name=PreToolUse tool_name=Write file_path='tests/e2e/specs/checkout.spec.ts' content='x')" "spec file → silent allow"
assert_allow "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command='ls -la')" "ls → silent allow"

section "harness-trusted-state-write-guard: Write to stop-auth sentinel DENY"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Write file_path='.claude/onboarding-stop-authorized' content='ok')" ".claude/onboarding-stop-authorized Write → DENY" "Harness-trusted state file"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Write file_path='tests/e2e/docs/.onboarding-stop-authorized' content='ok')" "alt stop-auth path Write → DENY" "Harness-trusted state file"

section "harness-trusted-state-write-guard: Edit / absolute-path forms DENY"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Edit file_path='/some/repo/.claude/onboarding-stop-authorized' new_string='x')" "absolute path Edit → DENY" "Harness-trusted state file"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Write file_path='/abs/repo/tests/e2e/docs/onboarding-phase-ledger.json' content='[]')" "absolute ledger Write → DENY" "Harness-trusted state file"

section "harness-trusted-state-write-guard: ../ traversal collapses (H4)"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Write file_path='tests/e2e/docs/../docs/onboarding-phase-ledger.json' content='[]')" "../ traversal → DENY" "Harness-trusted state file"

section "harness-trusted-state-write-guard: Bash redirect to protected path DENY"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command='echo forged > .claude/onboarding-stop-authorized')" "redirect > sentinel → DENY" "Harness-trusted state file"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command='echo x >> tests/e2e/docs/onboarding-phase-ledger.json')" "append >> ledger → DENY" "Harness-trusted state file"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command='touch .claude/onboarding-stop-authorized')" "touch sentinel → DENY" "Harness-trusted state file"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command='tee tests/e2e/docs/onboarding-phase-ledger.json')" "tee ledger → DENY" "Harness-trusted state file"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command='rm -f .claude/onboarding-stop-authorized')" "rm sentinel → DENY" "Harness-trusted state file"

section "harness-trusted-state-write-guard: stop-deny counter family (F2)"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Write file_path='/tmp/civitas-onboarding-stop-deny-abc123' content='99')" "counter file → DENY" "Harness-trusted state file"
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command='echo 99 > /tmp/civitas-onboarding-stop-deny-FAKE')" "redirect to counter → DENY" "Harness-trusted state file"

section "harness-trusted-state-write-guard: reads of protected paths are allowed"
# Read tool itself is not gated (the guard only fires on Write/Edit/MultiEdit/Bash).
assert_allow "$H" "$(payload hook_event_name=PreToolUse tool_name=Read file_path='.claude/onboarding-stop-authorized')" "Read sentinel → silent allow"
# `cat` / `ls` of protected paths is read-shape; the guard allows them.
assert_allow "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command='cat .claude/onboarding-stop-authorized')" "cat sentinel → silent allow"
assert_allow "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command='ls -la tests/e2e/docs/onboarding-phase-ledger.json')" "ls ledger → silent allow"

section "harness-trusted-state-write-guard: commit-message body whitelist (per-segment)"
# A genuine `git commit -m "<msg>"` that mentions a protected path in the
# message body is allowed; the segment-splitter exempts the commit segment.
assert_allow "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command="git commit -m 'docs: explain .claude/onboarding-stop-authorized'")" "commit with path in msg body → silent allow"

section "harness-trusted-state-write-guard: chained write after commit DENY (I1)"
# Per-segment splitting means the commit gets exempted but the chained
# redirect to a protected path is still independently evaluated.
assert_deny "$H" "$(payload hook_event_name=PreToolUse tool_name=Bash command="git commit -m 'x' && echo forged > .claude/onboarding-stop-authorized")" "chained redirect after commit → DENY" "Harness-trusted state file"

section "harness-trusted-state-write-guard: HARNESS_TRUSTED_WRITE_GUARD=off escape"
# The escape hatch should disable the guard. The hook exits at the env-var
# gate (line 59) BEFORE reading stdin, so the producing `printf` may get
# SIGPIPE (exit 141) as the reader has already terminated. Accept exit 0
# OR exit 141 as "silent allow"; output must be empty in both cases.
TESTS_RUN=$((TESTS_RUN + 1))
ESC_PAYLOAD=$(payload hook_event_name=PreToolUse tool_name=Write file_path='.claude/onboarding-stop-authorized' content='x')
ESC_OUT=$(printf '%s' "$ESC_PAYLOAD" 2>/dev/null | HARNESS_TRUSTED_WRITE_GUARD=off bash "$H" 2>/dev/null) || true
if [ -z "$ESC_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} HARNESS_TRUSTED_WRITE_GUARD=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("escape-hatch: expected silent allow, got output=${ESC_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} HARNESS_TRUSTED_WRITE_GUARD=off → expected silent allow"
fi
