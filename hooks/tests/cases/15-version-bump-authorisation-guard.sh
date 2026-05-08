#!/bin/bash
H="$HOOK_DIR/version-bump-authorisation-guard.sh"

section "version-bump-authorisation-guard: tool / command filtering"

assert_allow "$H" "$(payload tool_name=Read file_path='/x')" "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "ls → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm install')" "npm install → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm test')" "npm test → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm publish')" "npm publish → silent allow (out of scope; covered by feedback_never_publish)"
assert_allow "$H" "$(payload tool_name=Bash command='npm run build')" "npm run build → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='echo npm version 0.4.0')" "echo with npm-version inside → silent allow (string literal)"
assert_allow "$H" "$(payload tool_name=Bash command='git status')" "git status → silent allow"

section "version-bump-authorisation-guard: npm version without authorisation → DENY"

assert_deny "$H" "$(payload tool_name=Bash command='npm version patch')" "npm version patch → DENY" "without explicit authorisation"
assert_deny "$H" "$(payload tool_name=Bash command='npm version patch --no-git-tag-version')" "npm version patch --no-git-tag-version → DENY"
assert_deny "$H" "$(payload tool_name=Bash command='npm version minor')" "npm version minor → DENY"
assert_deny "$H" "$(payload tool_name=Bash command='npm version major')" "npm version major → DENY"
assert_deny "$H" "$(payload tool_name=Bash command='npm version 0.4.0')" "npm version 0.4.0 → DENY"
assert_deny "$H" "$(payload tool_name=Bash command='npm version 1.0.0-beta.1 --no-git-tag-version')" "npm version <prerelease> → DENY"

section "version-bump-authorisation-guard: VERSION_BUMP_AUTHORISED prefix → ALLOW"

assert_allow "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED=1 npm version patch')" "VERSION_BUMP_AUTHORISED=1 + npm version patch → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED=1 npm version patch --no-git-tag-version')" "VERSION_BUMP_AUTHORISED=1 + flags → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED=1 npm version 0.4.0')" "VERSION_BUMP_AUTHORISED=1 + explicit version → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED=true npm version patch')" "VERSION_BUMP_AUTHORISED=true → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED=yes npm version patch')" "VERSION_BUMP_AUTHORISED=yes → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED=on npm version patch')" "VERSION_BUMP_AUTHORISED=on → silent allow"

section "version-bump-authorisation-guard: VERSION_BUMP_AUTHORISED with other env vars"

assert_allow "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED=1 NODE_ENV=production npm version patch')" "VERSION_BUMP_AUTHORISED + other env var → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='NODE_ENV=production VERSION_BUMP_AUTHORISED=1 npm version patch')" "other env var first then VERSION_BUMP_AUTHORISED → silent allow"

section "version-bump-authorisation-guard: VERSION_BUMP_AUTHORISED=0/false → DENY"

assert_deny "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED=0 npm version patch')" "VERSION_BUMP_AUTHORISED=0 → DENY (only truthy values authorise)"
assert_deny "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED=false npm version patch')" "VERSION_BUMP_AUTHORISED=false → DENY"
assert_deny "$H" "$(payload tool_name=Bash command='VERSION_BUMP_AUTHORISED= npm version patch')" "empty VERSION_BUMP_AUTHORISED → DENY"

section "version-bump-authorisation-guard: edge cases"

# Substring "version" in unrelated commands shouldn't fire.
assert_allow "$H" "$(payload tool_name=Bash command='npm view @civitas-cerebrum/element-interactions version')" "npm view <pkg> version → silent allow (read, not bump)"
assert_allow "$H" "$(payload tool_name=Bash command='node --version')" "node --version → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm --version')" "npm --version → silent allow"
# Project-defined `npm run version-something` — different verb structure.
assert_allow "$H" "$(payload tool_name=Bash command='npm run version-bump')" "npm run version-bump (script) → silent allow"

section "version-bump-authorisation-guard: escape hatch via env var"

HOOK_OUT=$(BUMP_AUTHORISATION_GUARD=off bash "$H" <<<"$(payload tool_name=Bash command='npm version patch')" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} BUMP_AUTHORISATION_GUARD=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("BUMP_AUTHORISATION_GUARD=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} BUMP_AUTHORISATION_GUARD=off (expected silent allow)"
fi
