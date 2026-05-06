#!/bin/bash
H="$HOOK_DIR/coverage-state-deferral-auth-guard.sh"

section "coverage-state-deferral-auth-guard: tool / path filtering"

assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/x')" "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/x/some-other.json' content='{}')" "non-state-file → silent allow"

section "coverage-state-deferral-auth-guard: status / shape edge cases"

# status:complete — terminal. Schema-guard validates shape elsewhere.
COMPLETE='{"status":"complete","mode":"depth","currentPass":5,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-x","reason":"budget-cap"}]}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$COMPLETE")" "status:complete → silent allow regardless of deferrals"

# Empty deferredJourneys.
EMPTY='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[]}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$EMPTY")" "empty deferredJourneys → silent allow"

# No deferredJourneys field at all.
NO_DEFER='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z"}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$NO_DEFER")" "no deferredJourneys field → silent allow"

# Edit shape (only new_string visible) — defer to next Write.
assert_allow "$H" "$(payload tool_name=Edit file_path='/x/tests/e2e/docs/coverage-expansion-state.json' new_string='whatever')" "Edit shape → silent allow (deferred to subsequent Write)"

# Malformed JSON — defer to schema-guard.
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content='not json')" "malformed JSON → silent allow (schema-guard's job)"

section "coverage-state-deferral-auth-guard: allowed structural prefixes → ALLOW"

ALLOW_BLOCKED='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"blocked-on-app-bug:CHK-512"}]}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$ALLOW_BLOCKED")" "blocked-on-app-bug: prefix → silent allow"

ALLOW_TDP='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"test-data-prerequisite:admin-seed-user-missing"}]}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$ALLOW_TDP")" "test-data-prerequisite: prefix → silent allow"

ALLOW_USER='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"user-authorised:skip j-a for now, no admin creds"}]}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$ALLOW_USER")" "user-authorised: prefix with quote → silent allow"

# Multiple entries, all with allowed prefixes.
MULTI_OK='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b","j-c"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"blocked-on-app-bug:1"},{"journey":"j-b","reason":"test-data-prerequisite:x"},{"journey":"j-c","reason":"user-authorised:skip"}]}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$MULTI_OK")" "all entries with allowed prefixes → silent allow"

section "coverage-state-deferral-auth-guard: authorizer field present → ALLOW"

WITH_AUTH='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"budget-cap","authorizer":"User said: defer j-a until next session, focus on the rest"}]}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$WITH_AUTH")" "budget-cap reason + authorizer quote → silent allow"

# Authorizer present even with non-standard reason
NONSTD_AUTH='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"some-bespoke-reason","authorizer":"User: yes, defer it"}]}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$NONSTD_AUTH")" "non-standard reason + authorizer → silent allow"

section "coverage-state-deferral-auth-guard: budget-cap without authorizer → DENY"

# This is the issue #155 repro — 25 deferredJourneys with reason: budget-cap.
DENY_BUDGET='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"budget-cap"},{"journey":"j-b","reason":"budget-cap"}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$DENY_BUDGET")" "budget-cap without authorizer → DENY" "without authorisation"

# Mixed — one valid, one invalid.
MIXED='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a","j-b"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"blocked-on-app-bug:1"},{"journey":"j-b","reason":"budget-cap"}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$MIXED")" "mixed: one allowed + one budget-cap → DENY (only the offender)" "j-b"

section "coverage-state-deferral-auth-guard: other self-imposed reasons → DENY"

DENY_SESSION='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"session-length"}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$DENY_SESSION")" "session-length without authorizer → DENY" "without authorisation"

DENY_DEVI='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"mode-deviation"}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$DENY_DEVI")" "mode-deviation without authorizer → DENY" "without authorisation"

DENY_INF='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"inferred-pref"}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$DENY_INF")" "inferred-pref without authorizer → DENY" "without authorisation"

# Empty reason still denies.
DENY_EMPTY='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":""}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$DENY_EMPTY")" "empty reason without authorizer → DENY"

section "coverage-state-deferral-auth-guard: empty authorizer is not authorisation"

EMPTY_AUTH='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"budget-cap","authorizer":""}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$EMPTY_AUTH")" "empty authorizer string → DENY"

WS_AUTH='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"budget-cap","authorizer":"   "}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$WS_AUTH")" "whitespace-only authorizer → DENY"

# JSON null authorizer is the canonical no-authorizer value per the
# existing schema; bash's `// ""` substitution renders it as the literal
# string "null", which `tr -d '[:space:]'` doesn't strip — so this test
# both verifies null-handling AND prevents future regressions where the
# guard accidentally treats "null" as a real quote.
NULL_AUTH='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"budget-cap","authorizer":null}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$NULL_AUTH")" "authorizer: null → DENY"

section "coverage-state-deferral-auth-guard: nested-deferral path (PR #173 #1 fix proof)"

# Deferral-shaped objects nested inside passes.<N>, no top-level
# deferredJourneys field. The parenthesised LHS lets the recursion run
# against the original document; without it (the PR #173 review bug),
# this state file would silent-allow.
NESTED_BAD='{"status":"in-progress","mode":"depth","currentPass":3,"journeyRoster":["j-a"],"passes":{"3-compositional":{"dispatches":[{"journey":"j-a","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}],"deferredJourneys":[{"journey":"j-b","reason":"budget-cap"}]}},"updatedAt":"2026-05-06T00:00:00Z"}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$NESTED_BAD")" "nested deferral (passes.<N>) without authorizer → DENY (proves the parenthesised jq walks nested entries)" "j-b"

# Same nested path but with allowed structural prefix → ALLOW.
NESTED_OK='{"status":"in-progress","mode":"depth","currentPass":3,"journeyRoster":["j-a"],"passes":{"3-compositional":{"dispatches":[{"journey":"j-a","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}],"deferredJourneys":[{"journey":"j-b","reason":"blocked-on-app-bug:CHK-99"}]}},"updatedAt":"2026-05-06T00:00:00Z"}'
assert_allow "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$NESTED_OK")" "nested deferral with allowed-prefix reason → ALLOW"

# Duplicate-journey violations in deferredJourneys must BOTH be reported
# (PR #173 #3 fix — unique_by removed). One entry has structural prefix
# (allowed), other has self-imposed without authorizer (denied). The deny
# message names the offender.
DUP_MIXED='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-04T00:00:00Z","deferredJourneys":[{"journey":"j-a","reason":"blocked-on-app-bug:OK"},{"journey":"j-a","reason":"budget-cap"}]}'
assert_deny "$H" "$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$DUP_MIXED")" "duplicate-journey deferrals (one allowed, one offender) → DENY (offender named)" "j-a"

section "coverage-state-deferral-auth-guard: escape hatch via env var"

HOOK_OUT=$(DEFERRAL_AUTH_GUARD=off bash "$H" <<<"$(payload tool_name=Write file_path='/x/tests/e2e/docs/coverage-expansion-state.json' content="$DENY_BUDGET")" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} DEFERRAL_AUTH_GUARD=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("DEFERRAL_AUTH_GUARD=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} DEFERRAL_AUTH_GUARD=off (expected silent allow)"
fi
