#!/bin/bash
# Edge-case tests for hooks/test-data-discipline-guard.sh
#
# Default mode is DENY for hardcoded credentials in spec files;
# WARN for top-level magic constants outside a centralised data module.
#
# Coverage:
#   - tool-name filtering (only Edit | Write | MultiEdit fire)
#   - file-path filtering (non-spec files → silent allow)
#   - hardcoded credential patterns → DENY
#   - process.env.X reference → ALLOW (env-loaded value)
#   - top-level magic constants → WARN
#   - import from a centralised test-data module → no warn
#   - WARN opt-down (mode=warn) downgrades secret-deny to systemMessage
#   - escape hatch (off → silent allow)

H="$HOOK_DIR/test-data-discipline-guard.sh"

run_with_env() {
  local env_assignment="$1" hook="$2" stdin="$3"
  HOOK_EXIT=0
  HOOK_OUT=$(printf '%s' "$stdin" | env "$env_assignment" bash "$hook" 2>/dev/null) || HOOK_EXIT=$?
}

# --- tool-name + file-path filtering ---

section "test-data-discipline-guard: tool / file filtering"

assert_allow "$H" "$(payload tool_name=Read file_path='/x/login.spec.ts')" \
  "Read tool → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" \
  "Bash tool → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/src/login.ts' content='const password = "secret123"')" \
  "non-spec file → silent allow (not in scope)"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/notes.md' content='password = "secret123"')" \
  "non-spec markdown → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/login.spec.ts' content='// empty test')" \
  "spec file with no offending content → silent allow"

# --- Rule 1: hardcoded credentials → DENY ---

section "test-data-discipline-guard: hardcoded secrets → DENY"

assert_deny "$H" "$(payload tool_name=Write file_path='/x/login.spec.ts' content='const password = "secret123"')" \
  "Write spec with hardcoded password → DENY" "Hardcoded credential"
assert_deny "$H" "$(payload tool_name=Edit file_path='/x/login.spec.ts' new_string='const password = "hunter2"')" \
  "Edit spec adding hardcoded password → DENY" "Hardcoded credential"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/api.spec.ts' content='const apiKey = "AKIA1234567890"')" \
  "Write spec with hardcoded apiKey → DENY"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/auth.spec.ts' content='token: "Bearer abcdef"')" \
  "Write spec with hardcoded token → DENY"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/auth.spec.ts' content='const secret = "topsecret"')" \
  "Write spec with hardcoded secret → DENY"
assert_deny "$H" "$(payload tool_name=Write file_path='/x/auth.spec.ts' content='const access_key = "abc123"')" \
  "Write spec with hardcoded access_key → DENY"

# MultiEdit aggregates across edits[].new_string.
MULTIEDIT_PAYLOAD=$("$JQ" -nc --arg ns 'const password = "hunter2"' \
  '{tool_name: "MultiEdit", tool_input: {file_path: "/x/login.spec.ts", edits: [{old_string: "x", new_string: $ns}]}}')
assert_deny "$H" "$MULTIEDIT_PAYLOAD" \
  "MultiEdit spec with hardcoded password in edits[] → DENY"

# --- Rule 1 escape: process.env.X reference → ALLOW ---

section "test-data-discipline-guard: process.env reference → ALLOW"

assert_allow "$H" "$(payload tool_name=Write file_path='/x/login.spec.ts' content='const password = process.env.LOGIN_PASSWORD;')" \
  "spec reading password from process.env → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/login.spec.ts' content='const password = process.env.LOGIN_PASSWORD || "";')" \
  "spec with process.env + empty fallback → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/api.spec.ts' content='const apiKey = process.env.API_KEY;')" \
  "spec reading apiKey from process.env → silent allow"

# --- Rule 2: top-level magic constants → WARN ---

section "test-data-discipline-guard: top-level magic constants → WARN"

assert_warn "$H" "$(payload tool_name=Write file_path='/x/login.spec.ts' content='const BASE_URL = "https://example.com";')" \
  "spec with top-level BASE_URL constant → WARN" "Centralise"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/login.spec.ts' content='export const ADMIN_EMAIL = "a@b.c";')" \
  "spec with top-level exported ADMIN_EMAIL constant → WARN"

# --- Rule 2 allowlist: imports from a centralised test-data module → no warn ---

section "test-data-discipline-guard: centralised import → no WARN"

assert_allow "$H" "$(payload tool_name=Write file_path='/x/login.spec.ts' content='import { TestData } from "./fixtures/test-data";\nconst BASE_URL = "https://example.com";')" \
  "spec importing from test-data + having a const → silent allow (centralisation in progress)"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/login.spec.ts' content='import * as Constants from "./constants";\nconst FOO = "bar";')" \
  "spec importing from constants module → silent allow"

# --- Mode: warn ---

section "test-data-discipline-guard: TEST_DATA_DISCIPLINE_GUARD=warn → systemMessage instead of deny"

run_with_env "TEST_DATA_DISCIPLINE_GUARD=warn" "$H" \
  "$(payload tool_name=Write file_path='/x/login.spec.ts' content='const password = "hunter2"')"
TESTS_RUN=$((TESTS_RUN + 1))
if echo "$HOOK_OUT" | "$JQ" -e '.systemMessage // empty | length > 0' >/dev/null 2>&1 && [ "$HOOK_EXIT" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} mode=warn downgrades secrets-deny to systemMessage"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("mode=warn did not produce systemMessage; got: $HOOK_OUT (exit $HOOK_EXIT)")
  echo "${CLR_FAIL}  ✗${CLR_RST} mode=warn downgrades secrets-deny to systemMessage"
fi

# --- Escape hatch: off → silent allow ---

section "test-data-discipline-guard: TEST_DATA_DISCIPLINE_GUARD=off → silent allow"

run_with_env "TEST_DATA_DISCIPLINE_GUARD=off" "$H" \
  "$(payload tool_name=Write file_path='/x/login.spec.ts' content='const password = "hunter2"')"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ] && [ "$HOOK_EXIT" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} mode=off → silent allow even with offending content"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("mode=off did not silent-allow; got: $HOOK_OUT (exit $HOOK_EXIT)")
  echo "${CLR_FAIL}  ✗${CLR_RST} mode=off → silent allow"
fi
