#!/bin/bash
# 39-bash-command-allowlist.sh — sandbox verb-allowlist tests.
#
# Verifies the bash-command-allowlist hook accepts the verbs the
# onboarding pipeline needs AND denies the dangerous shapes that
# rounds 3-6 patched as one-off regexes. The allowlist is the
# structural fix for the "bash is Turing-complete" problem.

H="$HOOK_DIR/bash-command-allowlist.sh"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  echo "$d"
}

section "bash-command-allowlist: pipeline-needed verbs → ALLOW"

# Node toolchain.
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='npm install')" "npm install → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='npx playwright test --reporter=list')" "npx playwright test → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='npx playwright install --with-deps chromium')" "npx playwright install → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='pnpm install')" "pnpm install → ALLOW"

# Git / GH CLI.
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git status')" "git status → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git add tests/e2e/baseFixture.ts')" "git add → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git commit -m wip --allow-empty')" "git commit → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='gh pr view 192')" "gh pr view → ALLOW"

# Read POSIX.
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='ls -la tests/e2e/')" "ls -la → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='cat package.json')" "cat → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='grep -r journey tests/e2e/docs/')" "grep -r → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='find tests/e2e -name *.spec.ts')" "find -name → ALLOW"

# Write POSIX (trusted-state-write-guard is the safety net).
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='mkdir -p tests/e2e/docs')" "mkdir -p → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='touch tests/e2e/forged.spec.ts')" "touch → ALLOW (write-guard backstop)"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='rm tests/e2e/old.spec.ts')" "rm → ALLOW (write-guard backstop)"

# JSON + text.
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='jq . tests/e2e/docs/coverage-expansion-state.json')" "jq → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='awk /journey/ tests/e2e/docs/journey-map.md')" "awk → ALLOW"

# Compound (multiple allowed verbs).
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git add . && git commit -m fix')" "git add && git commit → ALLOW (compound, both allowed)"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='npm install && npx playwright install')" "npm install && npx playwright install → ALLOW"

# Env-var prefix is stripped before verb check.
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='CI=true npm test')" "CI=true npm test → ALLOW (env-var prefix stripped)"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='HARNESS_TRUSTED_WRITE_GUARD=off git status')" "env-prefix then git → ALLOW"

# Cd-then-verb.
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='cd /tmp')" "cd → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='cd /tmp && ls')" "cd && ls → ALLOW"

section "bash-command-allowlist: disallowed verbs → DENY"

# Nested shells.
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='bash -c "echo forged"')" "bash -c → DENY" "outside allowlist sandbox"
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='sh -c "echo hello"')" "sh -c → DENY" "outside allowlist sandbox"
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='zsh -i')" "zsh → DENY" "outside allowlist sandbox"

# eval / exec.
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='eval "echo whatever"')" "eval → DENY" "executes arbitrary code"
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='exec ls')" "exec → DENY" "executes arbitrary code"

# Interpreter inline eval (round-3 H7 architectural fix).
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='node -e "console.log(1)"')" "node -e → DENY (interpreter eval)" "interpreter inline eval"
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='python3 -c "print(1)"')" "python3 -c → DENY" "python -c / -m not allowed"
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command="perl -e 'print 1'")" "perl -e → DENY (perl not in allowlist)" "outside allowlist sandbox"

# sed -i (round-3 H3 architectural fix).
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command="sed -i.bak 's/old/new/' file.txt")" "sed -i → DENY" "sed -i (in-place edit) not allowed"

# Pipeline-execution.
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='xargs -I {} rm {}')" "xargs → DENY" "outside allowlist sandbox"
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='parallel echo')" "parallel → DENY" "outside allowlist sandbox"

# Compound with denied verb in second segment.
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='git status && bash -c "exfil"')" "git status && bash -c → DENY (second segment fails)" "outside allowlist sandbox"

# DD, ed.
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='dd if=/dev/zero of=/tmp/x bs=1M count=1')" "dd → DENY" "outside allowlist sandbox"
assert_deny "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='ed file.txt')" "ed → DENY" "outside allowlist sandbox"
