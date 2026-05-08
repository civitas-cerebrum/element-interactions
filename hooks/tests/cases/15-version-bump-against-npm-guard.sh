#!/bin/bash
H="$HOOK_DIR/version-bump-against-npm-guard.sh"

# Helper: run the hook with a deterministic npm-latest substitute via the
# VERSION_BUMP_GUARD_TEST_LATEST env override. Avoids hitting the npm
# registry from the hook test harness.
run_hook_with_latest() {
  local latest="$1" stdin="$2"
  HOOK_EXIT=0
  HOOK_OUT=$(printf '%s' "$stdin" | VERSION_BUMP_GUARD_TEST_LATEST="$latest" bash "$H" 2>/dev/null) || HOOK_EXIT=$?
}

assert_allow_with_latest() {
  local latest="$1" stdin="$2" name="$3"
  TESTS_RUN=$((TESTS_RUN + 1))
  run_hook_with_latest "$latest" "$stdin"
  if [ -z "$HOOK_OUT" ] && [ "$HOOK_EXIT" -eq 0 ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "${CLR_PASS}  ✓${CLR_RST} ${name}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("${name}: expected silent allow, got exit=${HOOK_EXIT} output=${HOOK_OUT:0:200}")
    echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(expected silent allow)${CLR_RST}"
  fi
}

assert_warn_with_latest() {
  local latest="$1" stdin="$2" name="$3" message_substr="${4:-}"
  TESTS_RUN=$((TESTS_RUN + 1))
  run_hook_with_latest "$latest" "$stdin"
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

section "version-bump-against-npm-guard: tool-name + command filtering"

# Non-Bash → silent allow.
assert_allow "$H" "$(payload tool_name=Edit file_path='/x/package.json' new_string='{}')" "Edit → silent allow"
# Bash but not `npm version` → silent allow.
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash unrelated → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm install')" "npm install (not version) → silent allow"

section "version-bump-against-npm-guard: keyword forms (silent allow)"

# Keyword forms (`patch`, `minor`, `major`, `from-git`, …) bump from
# package.json — Rule 15 accepts these as offline fallback. The hook
# can't tell from the keyword whether the user is online, so silent allow.
assert_allow_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version patch --no-git-tag-version')" "npm version patch → silent allow"
assert_allow_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version minor')" "npm version minor → silent allow"
assert_allow_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version major')" "npm version major → silent allow"
assert_allow_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version prepatch --preid=alpha')" "npm version prepatch → silent allow"
assert_allow_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version from-git')" "npm version from-git → silent allow"

section "version-bump-against-npm-guard: subshell / command-substitution form (silent allow)"

# Canonical one-liner uses $(...) — the hook can't statically resolve a
# subshell, and Rule 15's recipe IS this exact form. Silent allow.
ONELINER='npm version "$(npm view @civitas-cerebrum/element-interactions version | awk -F. '"'"'{print $1"."$2"."$3+1}'"'"')" --no-git-tag-version'
assert_allow_with_latest "0.3.6" "$(payload tool_name=Bash command="$ONELINER")" "canonical one-liner → silent allow"

section "version-bump-against-npm-guard: canonical bump (latest + 1 patch) → silent allow"

assert_allow_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version 0.3.7 --no-git-tag-version')" "0.3.6 → 0.3.7 → silent allow"
assert_allow_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version "0.3.7" --no-git-tag-version')" "double-quoted 0.3.7 → silent allow"
assert_allow_with_latest "0.3.6" "$(payload tool_name=Bash command="npm version '0.3.7' --no-git-tag-version")" "single-quoted 0.3.7 → silent allow"
assert_allow_with_latest "1.4.10" "$(payload tool_name=Bash command='npm version 1.4.11 --no-git-tag-version')" "1.4.10 → 1.4.11 (two-digit patch) → silent allow"

section "version-bump-against-npm-guard: at-or-below latest → WARN (collision risk)"

assert_warn_with_latest "0.3.7" "$(payload tool_name=Bash command='npm version 0.3.7 --no-git-tag-version')" "target == latest → WARN" "at-or-below the published latest"
assert_warn_with_latest "0.3.7" "$(payload tool_name=Bash command='npm version 0.3.6 --no-git-tag-version')" "target < latest (single patch behind) → WARN" "collision"
assert_warn_with_latest "0.4.0" "$(payload tool_name=Bash command='npm version 0.3.9 --no-git-tag-version')" "target < latest (minor behind) → WARN" "collision"

section "version-bump-against-npm-guard: above (latest + 1 patch) → WARN (skip)"

assert_warn_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version 0.3.9 --no-git-tag-version')" "patch skip (0.3.6 → 0.3.9) → WARN" "skips past"
assert_warn_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version 0.4.0 --no-git-tag-version')" "minor bump (0.3.6 → 0.4.0) → WARN" "skips past"
assert_warn_with_latest "0.3.6" "$(payload tool_name=Bash command='npm version 1.0.0 --no-git-tag-version')" "major bump (0.3.6 → 1.0.0) → WARN" "skips past"

section "version-bump-against-npm-guard: offline / unpublished → silent-ish allow with note"

# Empty latest (npm view returned nothing) → emit one-line offline note,
# don't block. The note is itself a systemMessage so the contributor sees
# the warning in their terminal.
assert_warn_with_latest "" "$(payload tool_name=Bash command='npm version 0.3.7 --no-git-tag-version')" "empty latest (offline) → WARN with offline note" "offline or unpublished"
assert_warn_with_latest "garbage-not-semver" "$(payload tool_name=Bash command='npm version 0.3.7 --no-git-tag-version')" "non-semver latest → WARN with offline note" "offline or unpublished"

section "version-bump-against-npm-guard: escape hatch via env var"

# VERSION_BUMP_GUARD=off → silent allow even when target is at-or-below.
HOOK_OUT=$(VERSION_BUMP_GUARD=off VERSION_BUMP_GUARD_TEST_LATEST=0.3.7 bash "$H" <<<"$(payload tool_name=Bash command='npm version 0.3.7 --no-git-tag-version')" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} VERSION_BUMP_GUARD=off → silent allow (overrides collision warn)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("VERSION_BUMP_GUARD=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} VERSION_BUMP_GUARD=off (expected silent allow)"
fi

section "version-bump-against-npm-guard: error-message shape"

# Spot-check that the WARN message follows the project-standard hook error
# layout (headline, "Do this instead" block, "What was wrong" block,
# References). The contributing skill mandates the format.
HOOK_OUT=$(VERSION_BUMP_GUARD_TEST_LATEST=0.3.6 bash "$H" <<<"$(payload tool_name=Bash command='npm version 0.4.0 --no-git-tag-version')" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
MSG=$(echo "$HOOK_OUT" | jq -r '.systemMessage // ""' 2>/dev/null)
if echo "$MSG" | grep -q '\[WARN\]' \
  && echo "$MSG" | grep -q 'Do this instead' \
  && echo "$MSG" | grep -q 'What was wrong' \
  && echo "$MSG" | grep -q 'References'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} WARN message follows project-standard hook error layout"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("error-message shape: expected [WARN] + 'Do this instead' + 'What was wrong' + 'References' sections. msg=${MSG:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} error-message shape"
fi
