#!/bin/bash
H="$HOOK_DIR/playwright-config-defaults-guard.sh"
NL=$'\n'

section "playwright-config-defaults-guard: tool / path filtering"

assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/x/playwright.config.ts')" "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/some-other.ts' content='export default {};')" "non-config file → silent allow"

section "playwright-config-defaults-guard: Write — full default config → ALLOW"

GOOD="import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  reporter: 'html',
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    video: 'on-first-retry',
    trace: 'on-first-retry',
  },
});"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/playwright.config.ts' content="$GOOD")" "all defaults present → silent allow"

section "playwright-config-defaults-guard: Write — strict-than-default also OK"

STRICT="import { defineConfig } from '@playwright/test';
export default defineConfig({
  retries: 3,
  use: { video: 'retain-on-failure', trace: 'on' },
});"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/playwright.config.ts' content="$STRICT")" "stricter values (retain-on-failure / on) → silent allow"

section "playwright-config-defaults-guard: Write — missing fields → WARN"

NO_VIDEO="import { defineConfig } from '@playwright/test';
export default defineConfig({
  retries: 1,
  use: { trace: 'on-first-retry' },
});"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/playwright.config.ts' content="$NO_VIDEO")" "missing video → WARN" "video setting absent"

NO_TRACE="import { defineConfig } from '@playwright/test';
export default defineConfig({
  retries: 1,
  use: { video: 'on-first-retry' },
});"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/playwright.config.ts' content="$NO_TRACE")" "missing trace → WARN" "trace setting absent"

NO_RETRIES="import { defineConfig } from '@playwright/test';
export default defineConfig({
  use: { video: 'on-first-retry', trace: 'on-first-retry' },
});"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/playwright.config.ts' content="$NO_RETRIES")" "missing retries → WARN" "retries setting absent"

section "playwright-config-defaults-guard: Write — explicit-off values → WARN"

VIDEO_OFF="import { defineConfig } from '@playwright/test';
export default defineConfig({
  retries: 1,
  use: { video: 'off', trace: 'on-first-retry' },
});"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/playwright.config.ts' content="$VIDEO_OFF")" "video: 'off' → WARN" "rerun-documents-failure guarantee"

TRACE_OFF="import { defineConfig } from '@playwright/test';
export default defineConfig({
  retries: 1,
  use: { video: 'on-first-retry', trace: 'off' },
});"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/playwright.config.ts' content="$TRACE_OFF")" "trace: 'off' → WARN" "trace artefact"

RETRIES_ZERO="import { defineConfig } from '@playwright/test';
export default defineConfig({
  retries: 0,
  use: { video: 'on-first-retry', trace: 'on-first-retry' },
});"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/playwright.config.ts' content="$RETRIES_ZERO")" "retries: 0 → WARN" "rerun boundary"

section "playwright-config-defaults-guard: Edit — only explicit-off slices flagged"

# Edit only sees new_string. Adding a benign retries line shouldn't fire.
assert_allow "$H" "$(payload tool_name=Edit file_path='/x/playwright.config.ts' "new_string=retries: 2,")" "Edit adds retries: 2 → silent allow"

# Editing to set video off should warn.
assert_warn "$H" "$(payload tool_name=Edit file_path='/x/playwright.config.ts' "new_string=video: 'off',")" "Edit sets video: 'off' → WARN" "rerun-documents-failure"

# Editing to set retries 0 should warn.
assert_warn "$H" "$(payload tool_name=Edit file_path='/x/playwright.config.ts' "new_string=retries: 0,")" "Edit sets retries: 0 → WARN" "rerun boundary"

section "playwright-config-defaults-guard: extension variants"

assert_warn "$H" "$(payload tool_name=Write file_path='/x/playwright.config.js' content="$NO_VIDEO")" ".js extension still inspected → WARN" "video setting absent"
assert_warn "$H" "$(payload tool_name=Write file_path='/x/playwright.config.mjs' content="$NO_TRACE")" ".mjs extension still inspected → WARN" "trace setting absent"

section "playwright-config-defaults-guard: escape hatch via env var"

HOOK_OUT=$(PWCONFIG_DEFAULTS_GUARD=off bash "$H" <<<"$(payload tool_name=Write file_path='/x/playwright.config.ts' content="$VIDEO_OFF")" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} PWCONFIG_DEFAULTS_GUARD=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("PWCONFIG_DEFAULTS_GUARD=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} PWCONFIG_DEFAULTS_GUARD=off (expected silent allow)"
fi
