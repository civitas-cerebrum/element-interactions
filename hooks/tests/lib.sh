#!/bin/bash
# lib.sh — shared assertion helpers for the hook test harness.
#
# Each hook test file (cases/*.sh) sources this and uses the helpers below
# to register cases. The runner (run.sh) sources every cases/*.sh and
# iterates the resulting array.

set -uo pipefail   # not -e — individual cases are allowed to fail without aborting the runner

# Colour helpers (no-op if NO_COLOR is set or stdout is not a terminal).
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  CLR_PASS=$'\033[32m'
  CLR_FAIL=$'\033[31m'
  CLR_DIM=$'\033[2m'
  CLR_RST=$'\033[0m'
else
  CLR_PASS=''; CLR_FAIL=''; CLR_DIM=''; CLR_RST=''
fi

# Counters (run.sh increments these across cases/*.sh files).
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
FAIL_DETAILS=()

# run_hook <hook-script> <stdin-payload>
# Captures stdout from the hook. Returns the captured output (or empty string
# for a silent allow). The hook's exit code is captured in HOOK_EXIT.
run_hook() {
  local hook="$1"
  local stdin="$2"
  HOOK_EXIT=0
  HOOK_OUT=$(printf '%s' "$stdin" | bash "$hook" 2>/dev/null) || HOOK_EXIT=$?
}

# Assertion modes:
#   assert_allow <hook> <stdin> <case-name>
#     Hook should produce no output (silent allow) and exit 0.
#   assert_deny <hook> <stdin> <case-name> [reason-substring]
#     Hook should output a deny JSON. Optionally checks that
#     permissionDecisionReason contains <reason-substring>.
#   assert_warn <hook> <stdin> <case-name> [message-substring]
#     Hook should output a systemMessage JSON. Optionally checks substring.

assert_allow() {
  local hook="$1" stdin="$2" name="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  run_hook "$hook" "$stdin"
  if [ -z "$HOOK_OUT" ] && [ "$HOOK_EXIT" -eq 0 ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "${CLR_PASS}  ✓${CLR_RST} ${name}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("${name}: expected silent allow, got exit=${HOOK_EXIT} output=${HOOK_OUT:0:200}")
    echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(expected silent allow)${CLR_RST}"
  fi
}

assert_deny() {
  local hook="$1" stdin="$2" name="$3" reason_substr="${4:-}"
  TESTS_RUN=$((TESTS_RUN + 1))
  run_hook "$hook" "$stdin"
  local decision
  decision=$(echo "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)
  if [ "$decision" != "deny" ]; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("${name}: expected deny, got decision='${decision}' output=${HOOK_OUT:0:200}")
    echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(expected deny, got '${decision}')${CLR_RST}"
    return
  fi
  if [ -n "$reason_substr" ]; then
    local reason
    reason=$(echo "$HOOK_OUT" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null)
    if ! echo "$reason" | grep -qF -- "$reason_substr"; then
      TESTS_FAILED=$((TESTS_FAILED + 1))
      FAIL_DETAILS+=("${name}: deny reason missing substring '${reason_substr}'. reason=${reason:0:200}")
      echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(deny reason missing substring)${CLR_RST}"
      return
    fi
  fi
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} ${name}"
}

assert_warn() {
  local hook="$1" stdin="$2" name="$3" message_substr="${4:-}"
  TESTS_RUN=$((TESTS_RUN + 1))
  run_hook "$hook" "$stdin"
  local has_msg
  has_msg=$(echo "$HOOK_OUT" | jq -r 'has("systemMessage") // false' 2>/dev/null)
  if [ "$has_msg" != "true" ]; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("${name}: expected systemMessage, got output=${HOOK_OUT:0:200}")
    echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(expected systemMessage)${CLR_RST}"
    return
  fi
  if [ -n "$message_substr" ]; then
    local msg
    msg=$(echo "$HOOK_OUT" | jq -r '.systemMessage' 2>/dev/null)
    if ! echo "$msg" | grep -qF -- "$message_substr"; then
      TESTS_FAILED=$((TESTS_FAILED + 1))
      FAIL_DETAILS+=("${name}: warning message missing substring '${message_substr}'. msg=${msg:0:200}")
      echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(warn message missing substring)${CLR_RST}"
      return
    fi
  fi
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} ${name}"
}

# assert_block_subagent <hook> <stdin> <case-name> [stderr-substring]
#   For SubagentStop hooks: expect exit 2 (block stop) with feedback on
#   stderr. Optionally check stderr contains <stderr-substring>.
assert_block_subagent() {
  local hook="$1" stdin="$2" name="$3" stderr_substr="${4:-}"
  TESTS_RUN=$((TESTS_RUN + 1))
  local out
  local err
  local ec=0
  err=$(printf '%s' "$stdin" | bash "$hook" 2>&1 >/dev/null) || ec=$?
  if [ "$ec" != "2" ]; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("${name}: expected exit 2, got exit=${ec} stderr=${err:0:200}")
    echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(expected exit 2, got ${ec})${CLR_RST}"
    return
  fi
  if [ -n "$stderr_substr" ]; then
    if ! echo "$err" | grep -qF -- "$stderr_substr"; then
      TESTS_FAILED=$((TESTS_FAILED + 1))
      FAIL_DETAILS+=("${name}: stderr missing substring '${stderr_substr}'. stderr=${err:0:200}")
      echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(stderr missing substring)${CLR_RST}"
      return
    fi
  fi
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} ${name}"
}

# Helper: section header in the test output.
section() {
  echo
  echo "── $* ──"
}

# Helper: build a JSON payload from inline kv args. Each kv is "key=value".
# Recognised keys: tool_name, description, prompt, command, file_path,
# content, new_string, response_text, exit_code, stdout, cwd,
# hook_event_name. response_text becomes tool_response.output.
payload() {
  local out='{}'
  for kv in "$@"; do
    local k="${kv%%=*}"
    local v="${kv#*=}"
    case "$k" in
      tool_name)
        out=$(printf '%s' "$out" | jq -c --arg v "$v" '. + {tool_name: $v}') ;;
      description|prompt|command|file_path|content|new_string)
        out=$(printf '%s' "$out" | jq -c --arg v "$v" --arg k "$k" '.tool_input = ((.tool_input // {}) + {($k): $v})') ;;
      response_text)
        out=$(printf '%s' "$out" | jq -c --arg v "$v" '.tool_response = ((.tool_response // {}) + {output: $v})') ;;
      exit_code|stdout)
        local field="exitCode"; [ "$k" = "stdout" ] && field="stdout"
        out=$(printf '%s' "$out" | jq -c --arg v "$v" --arg f "$field" '.tool_response = ((.tool_response // {}) + {($f): $v})') ;;
      cwd)
        out=$(printf '%s' "$out" | jq -c --arg v "$v" '. + {cwd: $v}') ;;
      hook_event_name)
        out=$(printf '%s' "$out" | jq -c --arg v "$v" '. + {hook_event_name: $v}') ;;
      last_assistant_message|agent_id|agent_type|session_id|transcript_path)
        out=$(printf '%s' "$out" | jq -c --arg v "$v" --arg k "$k" '. + {($k): $v}') ;;
      *) echo "payload: unknown key $k" >&2; return 1 ;;
    esac
  done
  printf '%s' "$out"
}
