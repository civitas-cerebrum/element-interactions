#!/bin/bash
# Tests for skill-subagent-only-guard.sh
#
# Verifies that subagent-only skills (failure-diagnosis,
# contributing-to-element-interactions) are denied in orchestrator context
# and allowed in subagent context. Other skills always pass.

H="$HOOK_DIR/skill-subagent-only-guard.sh"

section "skill-subagent-only-guard — restricted skills + orchestrator context"
# Force-flag the orchestrator path; the hook should DENY.
assert_deny "$H" \
  "$(payload tool_name=Skill skill=failure-diagnosis transcript_path=/Users/x/.claude/projects/foo/abc.jsonl cwd=/Users/x/proj)" \
  "failure-diagnosis in orchestrator → DENY" \
  "subagent-only"

assert_deny "$H" \
  "$(payload tool_name=Skill skill=contributing-to-element-interactions transcript_path=/Users/x/.claude/projects/foo/abc.jsonl cwd=/Users/x/proj)" \
  "contributing-to-element-interactions in orchestrator → DENY" \
  "subagent-only"

# Plugin-namespaced form should normalise to the bare skill name.
assert_deny "$H" \
  "$(payload tool_name=Skill skill=userSettings:failure-diagnosis transcript_path=/Users/x/.claude/projects/foo/abc.jsonl cwd=/Users/x/proj)" \
  "plugin-namespaced failure-diagnosis in orchestrator → DENY" \
  "subagent-only"

# DENY message should include orchestrator-context explanation + How to apply
DENY_MSG=$(printf '%s' "$(payload tool_name=Skill skill=failure-diagnosis transcript_path=/x/abc.jsonl cwd=/x)" | bash "$H" 2>/dev/null | jq -r '.hookSpecificOutput.permissionDecisionReason')
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$DENY_MSG" | grep -qF "How to apply"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} DENY message includes 'How to apply' guidance"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("DENY message missing 'How to apply' guidance: msg=${DENY_MSG:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} DENY message missing 'How to apply' guidance"
fi

section "skill-subagent-only-guard — restricted skills + subagent context (allow paths)"

# parent_tool_use_id present → subagent → ALLOW
assert_allow "$H" \
  "$(payload tool_name=Skill skill=failure-diagnosis parent_tool_use_id=toolu_abc123 transcript_path=/x/abc.jsonl cwd=/x)" \
  "parent_tool_use_id non-empty → silent allow"

# agent_id present → subagent → ALLOW
assert_allow "$H" \
  "$(payload tool_name=Skill skill=failure-diagnosis agent_id=a1234 transcript_path=/x/abc.jsonl cwd=/x)" \
  "agent_id non-empty → silent allow"

# transcript_path under /agents/ → subagent → ALLOW
assert_allow "$H" \
  "$(payload tool_name=Skill skill=failure-diagnosis transcript_path=/Users/x/.claude/projects/foo/agents/a1234/session.jsonl cwd=/x)" \
  "transcript_path contains /agents/ → silent allow"

# transcript_path under /tasks/ → subagent → ALLOW
assert_allow "$H" \
  "$(payload tool_name=Skill skill=failure-diagnosis transcript_path=/private/tmp/claude-501/proj/sess/tasks/agent-x.jsonl cwd=/x)" \
  "transcript_path contains /tasks/ → silent allow"

# cwd under .claude/worktrees/agent- → subagent → ALLOW
assert_allow "$H" \
  "$(payload tool_name=Skill skill=contributing-to-element-interactions transcript_path=/x/abc.jsonl cwd=/Users/x/proj/.claude/worktrees/agent-a1234)" \
  "cwd under worktree agent dir → silent allow"

section "skill-subagent-only-guard — non-restricted skills (always allow)"

assert_allow "$H" \
  "$(payload tool_name=Skill skill=test-composer transcript_path=/x/abc.jsonl cwd=/x)" \
  "test-composer in orchestrator → silent allow"

assert_allow "$H" \
  "$(payload tool_name=Skill skill=element-interactions transcript_path=/x/abc.jsonl cwd=/x)" \
  "element-interactions in orchestrator → silent allow"

assert_allow "$H" \
  "$(payload tool_name=Skill skill=contract-testing transcript_path=/x/abc.jsonl cwd=/x)" \
  "contract-testing in orchestrator → silent allow"

section "skill-subagent-only-guard — wrong tool / empty input"

assert_allow "$H" \
  "$(payload tool_name=Bash command='echo hi')" \
  "non-Skill tool → silent allow"

assert_allow "$H" \
  "$(payload tool_name=Skill)" \
  "Skill tool with no skill field → silent allow"

assert_allow "$H" \
  "$(payload tool_name=Edit file_path=/x/y.md content=hello)" \
  "Edit tool → silent allow"
