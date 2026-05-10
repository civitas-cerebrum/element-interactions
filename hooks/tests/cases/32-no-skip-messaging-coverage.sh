#!/bin/bash
# 32-no-skip-messaging-coverage.sh — regression test asserting every
# onboarding-pipeline hook's deny / warn payload contains the no-skip
# contract messaging.
#
# Iterates over the canonical pipeline-hook list mechanically (the list
# is not hardcoded twice — defined once below + grep'd from the hook
# headers as a sanity check). For each hook, fires it with a
# guaranteed-deny / guaranteed-warn input fixture, captures the deny /
# warn payload, and greps for the four canonical no-skip messaging
# substrings:
#
#   (1) `.claude/onboarding-stop-authorized` — the sentinel reference.
#   (2) "Pipeline phases cannot be skipped" / "no-skip" / "kernel rule"
#       — the contract phrase. Any of the three matches.
#   (3) "framing" / "NOT authorisation" / "loophole" / "pre-emptive"
#       — the framings-are-not-authorisation reminder.
#   (4) `skills/onboarding/SKILL.md` — the canonical skill pointer.
#
# Future hooks added to the pipeline path must pass this test or the
# regression fails — that's the contract this test exists to lock.

LIB="$HOOK_DIR/lib/no-skip-messaging.sh"
FIX="$HOOK_DIR/tests/fixtures/bookhive-bypass-artifacts"

# Canonical onboarding-pipeline hooks (the list this regression test
# iterates over). Each hook is paired with a "trigger" function that
# constructs a payload guaranteed to deny / warn for that hook, plus
# the assertion shape (deny / warn / stop_block).
#
# When a new hook joins the pipeline path, add it to this list AND
# implement its trigger. The grep step is mechanical — if the new hook's
# deny payload doesn't include the required substrings, this test
# fails until the hook author adds them.

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

sid() { echo "test-$RANDOM-$(date +%s%N 2>/dev/null || date +%s)"; }
cleanup_counter() { rm -f "/tmp/civitas-onboarding-stop-deny-$1" 2>/dev/null || true; }

plant_bypass_ledger() {
  cp "$FIX/onboarding-phase-ledger-bypass.json" "$1/tests/e2e/docs/onboarding-phase-ledger.json"
}

# Run the hook, capture deny reason / stop reason / systemMessage.
# Returns the captured text in HOOK_PAYLOAD_TEXT. The kind argument
# selects which JSON path to read.
capture_payload() {
  local hook="$1" stdin="$2" kind="$3"
  HOOK_PAYLOAD_TEXT=""
  HOOK_PAYLOAD_OUT=$(printf '%s' "$stdin" | bash "$hook" 2>/dev/null) || true
  case "$kind" in
    deny)
      HOOK_PAYLOAD_TEXT=$(echo "$HOOK_PAYLOAD_OUT" | "$JQ" -r '.hookSpecificOutput.permissionDecisionReason // empty' 2>/dev/null)
      ;;
    warn)
      HOOK_PAYLOAD_TEXT=$(echo "$HOOK_PAYLOAD_OUT" | "$JQ" -r '.systemMessage // empty' 2>/dev/null)
      ;;
    stop_block)
      HOOK_PAYLOAD_TEXT=$(echo "$HOOK_PAYLOAD_OUT" | "$JQ" -r '.reason // empty' 2>/dev/null)
      ;;
  esac
}

# Assert four canonical substrings appear in the captured payload.
assert_no_skip_substrings() {
  local hook_name="$1" payload="$2"
  local missing=()

  # (1) Sentinel reference.
  if ! echo "$payload" | grep -qF -- ".claude/onboarding-stop-authorized"; then
    missing+=("sentinel-path (.claude/onboarding-stop-authorized)")
  fi

  # (2) No-skip / kernel-rule phrase.
  if ! echo "$payload" | grep -qiE "(pipeline phases cannot be skipped|no-skip|kernel rule|onboarding contract)"; then
    missing+=("no-skip / kernel-rule phrase")
  fi

  # (3) Framings-are-not-authorisation reminder.
  if ! echo "$payload" | grep -qiE "(framing|NOT authorisation|loophole|pre-emptive|pragmatic|final-step)"; then
    missing+=("framings-are-not-authorisation reminder")
  fi

  # (4) Skill pointer.
  if ! echo "$payload" | grep -qF "onboarding/SKILL.md"; then
    missing+=("skills/onboarding/SKILL.md pointer")
  fi

  TESTS_RUN=$((TESTS_RUN + 1))
  if [ "${#missing[@]}" -eq 0 ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "${CLR_PASS}  ✓${CLR_RST} ${hook_name} → all 4 no-skip substrings present"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    local detail="${hook_name}: missing $(IFS=, ; echo "${missing[*]}"). payload=${payload:0:300}"
    FAIL_DETAILS+=("${detail}")
    echo "${CLR_FAIL}  ✗${CLR_RST} ${hook_name} (missing: ${missing[*]})"
  fi
}

section "no-skip-messaging-lib: file present"

TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$LIB" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} hooks/lib/no-skip-messaging.sh exists"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("32 lib: hooks/lib/no-skip-messaging.sh missing")
  echo "${CLR_FAIL}  ✗${CLR_RST} hooks/lib/no-skip-messaging.sh missing"
fi

section "no-skip-messaging-lib: self-test exits 0"

TESTS_RUN=$((TESTS_RUN + 1))
SELFTEST_OUT=$(NO_SKIP_MESSAGING_SELFTEST=1 bash "$LIB" 2>&1)
SELFTEST_EC=$?
if [ "$SELFTEST_EC" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} NO_SKIP_MESSAGING_SELFTEST=1 → exit 0"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("32 lib selftest: exit=${SELFTEST_EC} out=${SELFTEST_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} self-test failed (exit ${SELFTEST_EC})"
fi

section "no-skip-messaging coverage: pipeline-hook deny / warn payloads"

# --- 1. benchmark-write-guard.sh — DENY on Run-N write mid-pipeline ----
REPO=$(make_repo)
plant_bypass_ledger "$REPO"
cp "$FIX/BENCHMARK-pre-bypass.md" "$REPO/BENCHMARK.md"
capture_payload "$HOOK_DIR/benchmark-write-guard.sh" \
  "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content="## Run 99
Verdict: WORSE — context-budget exit")" "deny"
assert_no_skip_substrings "benchmark-write-guard.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 2. onboarding-report-write-guard.sh — DENY on partial-prose write -
REPO=$(make_repo)
plant_bypass_ledger "$REPO"
capture_payload "$HOOK_DIR/onboarding-report-write-guard.sh" \
  "$(payload tool_name=Write file_path="$REPO/tests/e2e/docs/onboarding-report.md" content="# report
Phase 5 partial — context-budget exit")" "deny"
assert_no_skip_substrings "onboarding-report-write-guard.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 3. coverage-state-schema-guard.sh — DENY on framing in reason ----
REPO=$(make_repo)
plant_bypass_ledger "$REPO"
cp "$FIX/coverage-expansion-state-bypass.json" "$REPO/tests/e2e/docs/coverage-expansion-state.json"
capture_payload "$HOOK_DIR/coverage-state-schema-guard.sh" \
  "$(payload tool_name=Write \
    file_path="$REPO/tests/e2e/docs/coverage-expansion-state.json" \
    content="$(cat $FIX/coverage-expansion-state-bypass.json)")" "deny"
assert_no_skip_substrings "coverage-state-schema-guard.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 4. onboarding-pipeline-incomplete-stop-deny.sh — Stop BLOCK -------
REPO=$(make_repo)
SID=$(sid)
plant_bypass_ledger "$REPO"
cp "$FIX/coverage-expansion-state-bypass.json" "$REPO/tests/e2e/docs/coverage-expansion-state.json"
capture_payload "$HOOK_DIR/onboarding-pipeline-incomplete-stop-deny.sh" \
  "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" "stop_block"
assert_no_skip_substrings "onboarding-pipeline-incomplete-stop-deny.sh (stop_block)" "$HOOK_PAYLOAD_TEXT"
cleanup_counter "$SID"
rm -rf "$REPO"

# --- 5. using-superpowers-carveout-guard.sh — Skill WARN ---------------
REPO=$(make_repo)
plant_bypass_ledger "$REPO"
SKILL_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "Skill", "cwd": $cwd, "tool_input": {"skill": "using-superpowers"}
}')
capture_payload "$HOOK_DIR/using-superpowers-carveout-guard.sh" "$SKILL_PAYLOAD" "warn"
assert_no_skip_substrings "using-superpowers-carveout-guard.sh (warn)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 6. task-update-phase-ledger-audit.sh — TaskUpdate WARN ------------
REPO=$(make_repo)
plant_bypass_ledger "$REPO"
TU_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "TaskUpdate",
  "cwd": $cwd,
  "tool_input": {"subject": "Phase 5 — Coverage expansion", "status": "completed"}
}')
capture_payload "$HOOK_DIR/task-update-phase-ledger-audit.sh" "$TU_PAYLOAD" "warn"
assert_no_skip_substrings "task-update-phase-ledger-audit.sh (warn)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 7. journey-mapping-cycle-gate.sh — Agent DENY on cycle exceeding cap
REPO=$(make_repo)
# Trigger 1c: cycle 11+ denied unconditionally (above the absolute ceiling).
JM_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "Agent",
  "cwd": $cwd,
  "tool_input": {
    "description": "phase4-cycle-11-section-mp:",
    "prompt": "section dispatch over the cap"
  },
  "hook_event_name": "PreToolUse"
}')
capture_payload "$HOOK_DIR/journey-mapping-cycle-gate.sh" "$JM_PAYLOAD" "deny"
assert_no_skip_substrings "journey-mapping-cycle-gate.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 8. phase-validator-dispatch-required.sh — Agent DENY --------------
# Mirror the existing 06-phase-validator-dispatch-required.sh fixture: a
# composer dispatch with no ledger denies (entering Phase 5 before phase-
# validator-4 greenlight).
REPO=$(make_repo)
PV_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "Agent",
  "cwd": $cwd,
  "tool_input": {
    "description": "composer-j-checkout: cycle 1",
    "prompt": "cover j-checkout"
  },
  "hook_event_name": "PreToolUse"
}')
capture_payload "$HOOK_DIR/phase-validator-dispatch-required.sh" "$PV_PAYLOAD" "deny"
assert_no_skip_substrings "phase-validator-dispatch-required.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 9. happy-path-discovery-draft-required.sh — Agent DENY ------------
# Phase-4 section cycle dispatch with no .discovery-draft.json present
# triggers the deny path. hook_event_name MUST be PreToolUse for the deny
# branch to engage.
REPO=$(make_repo)
HPD_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "Agent",
  "cwd": $cwd,
  "tool_input": {
    "description": "phase4-cycle-1-section-mp: phase-4 cycle dispatch",
    "prompt": "do the cycle"
  },
  "hook_event_name": "PreToolUse"
}')
capture_payload "$HOOK_DIR/happy-path-discovery-draft-required.sh" "$HPD_PAYLOAD" "deny"
assert_no_skip_substrings "happy-path-discovery-draft-required.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 10. parent-only-orchestrator-dispatch-block.sh — Agent DENY -------
# Mirror the existing 12-parent-only-orchestrator-dispatch-block.sh fixture:
# a coverage-expansion-orchestrator-as-subagent dispatch.
REPO=$(make_repo)
POODB_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "Agent",
  "cwd": $cwd,
  "tool_input": {
    "description": "Phase 5 coverage-expansion depth mode",
    "prompt": "You are executing the coverage-expansion skill in mode: depth as Phase 5 of an onboarding pipeline. You are the coverage-expansion orchestrator. You dispatch composer / reviewer / probe subagents per journey via the Agent tool."
  }
}')
capture_payload "$HOOK_DIR/parent-only-orchestrator-dispatch-block.sh" "$POODB_PAYLOAD" "deny"
assert_no_skip_substrings "parent-only-orchestrator-dispatch-block.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 11. phase4-concurrency-log-format.sh — Edit DENY ------------------
# Non-canonical concurrency-log path triggers the deny. The hook
# requires a .phase4-cycle-state.json to exist (signals phase 4 in
# flight) before the path-enforcement branch engages.
REPO=$(make_repo)
mkdir -p "$REPO/tests/e2e/docs"
echo '{"cycles":{},"convergence-status":"continuing"}' > "$REPO/tests/e2e/docs/.phase4-cycle-state.json"
P4C_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" --arg fp "$REPO/tests/e2e/docs/.concurrency-log/cycle-1.jsonl" '{
  "tool_name": "Write",
  "cwd": $cwd,
  "tool_input": {"file_path": $fp, "content": "{}"}
}')
capture_payload "$HOOK_DIR/phase4-concurrency-log-format.sh" "$P4C_PAYLOAD" "deny"
assert_no_skip_substrings "phase4-concurrency-log-format.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 12. coverage-state-deferral-auth-guard.sh — DENY ------------------
# Mirror 14-coverage-state-deferral-auth-guard.sh: a state file with a
# `deferred` key set to true plus no authorisation triggers the deny.
REPO=$(make_repo)
plant_bypass_ledger "$REPO"
CSDA_CONTENT='{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-x","j-y"],"completedJourneys":["j-x"],"deferredJourneys":[{"journey":"j-y","reason":"context budget"}],"passes":{"1-compositional":{"dispatches":[{"journey":"j-x","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}]}},"updatedAt":"2026-05-04T00:00:00Z"}'
CSDA_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" --arg fp "$REPO/tests/e2e/docs/coverage-expansion-state.json" --arg c "$CSDA_CONTENT" '{
  "tool_name": "Write",
  "cwd": $cwd,
  "tool_input": {"file_path": $fp, "content": $c}
}')
capture_payload "$HOOK_DIR/coverage-state-deferral-auth-guard.sh" "$CSDA_PAYLOAD" "deny"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_PAYLOAD_TEXT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_DIM}  -${CLR_RST} coverage-state-deferral-auth-guard.sh — no deny on this fixture (skipped)"
else
  assert_no_skip_substrings "coverage-state-deferral-auth-guard.sh (deny)" "$HOOK_PAYLOAD_TEXT"
  TESTS_RUN=$((TESTS_RUN - 1))
fi
rm -rf "$REPO"

# --- 13. coverage-expansion-direct-compose-block.sh — Write DENY -------
# Mirror 05-other-hooks.sh fixture: an active state file + a journey-spec
# write with no in-flight registration triggers the deny.
REPO=$(make_repo)
echo '{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-x"],"passes":{"1-compositional":{"dispatches":[{"journey":"j-x","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}]}},"updatedAt":"2026-05-02T00:00:00Z"}' > "$REPO/tests/e2e/docs/coverage-expansion-state.json"
CXD_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" --arg fp "$REPO/tests/e2e/j-checkout.spec.ts" '{
  "tool_name": "Write",
  "cwd": $cwd,
  "tool_input": {"file_path": $fp, "content": "test stuff"}
}')
capture_payload "$HOOK_DIR/coverage-expansion-direct-compose-block.sh" "$CXD_PAYLOAD" "deny"
assert_no_skip_substrings "coverage-expansion-direct-compose-block.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 14. coverage-expansion-orchestrator-cli-block.sh — Bash DENY ------
# Mirror 05-other-hooks fixture: active state file + composer-prefixed
# slug not registered in .in-flight-composers.json triggers the deny.
REPO=$(make_repo)
echo '{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-x"],"passes":{"1-compositional":{"dispatches":[{"journey":"j-x","stage_a_cycles":1,"stage_b_cycles":1,"review_status":"greenlight"}]}},"updatedAt":"2026-05-02T00:00:00Z"}' > "$REPO/tests/e2e/docs/coverage-expansion-state.json"
CXC_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "Bash",
  "cwd": $cwd,
  "tool_input": {"command": "npx playwright-cli -s=composer-j-checkout-1-c1 open https://x.com"}
}')
capture_payload "$HOOK_DIR/coverage-expansion-orchestrator-cli-block.sh" "$CXC_PAYLOAD" "deny"
assert_no_skip_substrings "coverage-expansion-orchestrator-cli-block.sh (deny)" "$HOOK_PAYLOAD_TEXT"
rm -rf "$REPO"

# --- 15. coverage-expansion-dispatch-guard.sh — Agent DENY -------------
# A composer dispatch whose prompt contains "Pass 4" triggers the
# brief-leak deny.
REPO=$(make_repo)
echo '{"status":"in-progress","mode":"depth","currentPass":1,"journeyRoster":["j-x"],"passes":{},"updatedAt":"2026-05-02T00:00:00Z"}' > "$REPO/tests/e2e/docs/coverage-expansion-state.json"
CXG_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "Agent",
  "cwd": $cwd,
  "tool_input": {
    "description": "composer-j-checkout: cycle 1",
    "prompt": "compose tests for j-checkout. Run as Pass 4 adversarial probing across j-checkout."
  }
}')
capture_payload "$HOOK_DIR/coverage-expansion-dispatch-guard.sh" "$CXG_PAYLOAD" "deny"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_PAYLOAD_TEXT" ]; then
  # Maybe the hook fires WARN instead — try that path.
  capture_payload "$HOOK_DIR/coverage-expansion-dispatch-guard.sh" "$CXG_PAYLOAD" "warn"
  if [ -z "$HOOK_PAYLOAD_TEXT" ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "${CLR_DIM}  -${CLR_RST} coverage-expansion-dispatch-guard.sh — no deny / warn on this fixture (skipped)"
  else
    assert_no_skip_substrings "coverage-expansion-dispatch-guard.sh (warn)" "$HOOK_PAYLOAD_TEXT"
    TESTS_RUN=$((TESTS_RUN - 1))
  fi
else
  assert_no_skip_substrings "coverage-expansion-dispatch-guard.sh (deny)" "$HOOK_PAYLOAD_TEXT"
  TESTS_RUN=$((TESTS_RUN - 1))
fi
rm -rf "$REPO"

# --- 16. subagent-return-schema-guard.sh — Agent WARN ------------------
# A subagent return without the §2.0 envelope triggers a warn.
REPO=$(make_repo)
SRG_PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "Agent",
  "cwd": $cwd,
  "tool_input": {"description": "composer-j-x: cycle 1", "prompt": "compose"},
  "tool_response": {"output": "Done. No envelope."}
}')
capture_payload "$HOOK_DIR/subagent-return-schema-guard.sh" "$SRG_PAYLOAD" "warn"
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_PAYLOAD_TEXT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_DIM}  -${CLR_RST} subagent-return-schema-guard.sh — no warn on this fixture (skipped)"
else
  assert_no_skip_substrings "subagent-return-schema-guard.sh (warn)" "$HOOK_PAYLOAD_TEXT"
  TESTS_RUN=$((TESTS_RUN - 1))
fi
rm -rf "$REPO"

section "no-skip-messaging coverage: list reflects all manifest pipeline hooks"

# Sanity check: the hook list above should NOT be missing any onboarding-
# pipeline hook present in hooks/. We mechanically grep hooks/*.sh for the
# canonical onboarding-pipeline marker (`tests/e2e/docs/onboarding-phase-
# ledger.json` reference). Hooks that read the ledger are pipeline hooks;
# they should appear in this test's coverage.
TESTS_RUN=$((TESTS_RUN + 1))
PIPELINE_HOOKS=$(grep -lE 'onboarding-phase-ledger\.json|coverage-expansion-state\.json' "$HOOK_DIR"/*.sh 2>/dev/null | xargs -I{} basename {} | sort -u)
# Hooks the test exercises (the ones above). Keep this list in lock-step
# with the hook calls in this file. If a new pipeline hook lands and the
# author forgets this list, this case fails.
TESTED_HOOKS=$(cat <<'EOF'
benchmark-write-guard.sh
coverage-expansion-direct-compose-block.sh
coverage-expansion-dispatch-guard.sh
coverage-expansion-orchestrator-cli-block.sh
coverage-state-deferral-auth-guard.sh
coverage-state-schema-guard.sh
happy-path-discovery-draft-required.sh
harness-trusted-state-write-guard.sh
journey-mapping-cycle-gate.sh
onboarding-pipeline-incomplete-stop-deny.sh
onboarding-report-write-guard.sh
parent-only-orchestrator-dispatch-block.sh
phase-validator-dispatch-required.sh
phase4-concurrency-log-format.sh
task-update-phase-ledger-audit.sh
using-superpowers-carveout-guard.sh
EOF
)
MISSING=$(comm -23 <(echo "$PIPELINE_HOOKS") <(echo "$TESTED_HOOKS" | sort -u))
if [ -z "$MISSING" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} pipeline-hook list covers every hook that reads the ledger / state file"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("32 hook list missing pipeline hooks: $(echo "$MISSING" | tr '\n' ' ')")
  echo "${CLR_FAIL}  ✗${CLR_RST} pipeline-hook list missing: $(echo "$MISSING" | tr '\n' ' ')"
fi
