#!/bin/bash
# 27-replicate-task-update-phase-completed-bypass.sh — exploit-replication
# test for hooks/task-update-phase-ledger-audit.sh.
#
# Replicates the BookHive Run-2 in-session task UI bypass:
#   - Phase ledger: phases 1-4 greenlit, phases 5-7 absent (verbatim).
#   - The orchestrator's TaskUpdate sequence flipped tasks #5, #6, #7 to
#     status: "completed" while the ledger only had phases 1-4 greenlit.
#     The session's task descriptions matched:
#       - "Phase 5 — Coverage expansion (depth)"
#       - "Phase 6 — Bug discovery"
#       - "Phase 7 — Final summary"
#
# Asserts:
#   - WARN fires for each of the three Phase-N task closes when the ledger
#     doesn't agree.
#   - systemMessage names the no-skip contract (drift between in-session
#     UI and authoritative ledger; pipeline phases cannot be marked
#     complete via the task UI alone).
#
# Inverse case: same TaskUpdate but ledger shows phases 5/6/7 greenlit →
# no warning emitted.

H="$HOOK_DIR/task-update-phase-ledger-audit.sh"
FIX="$HOOK_DIR/tests/fixtures/bookhive-bypass-artifacts"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

plant_bypass_ledger() {
  cp "$FIX/onboarding-phase-ledger-bypass.json" "$1/tests/e2e/docs/onboarding-phase-ledger.json"
}

plant_full_ledger() {
  cat > "$1/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"greenlight"},"7":{"status":"greenlight"}}}
EOF
}

# The TaskUpdate the bypass session emitted. Three separate flips: Phase 5,
# Phase 6, Phase 7. We assert each one independently. Built via raw jq
# because the generic payload() helper doesn't currently support a
# `subject` field on tool_input (TaskUpdate's canonical input shape).
phase_task_payload() {
  local repo="$1" subj="$2" stat="$3"
  "$JQ" -n --arg cwd "$repo" --arg subject "$subj" --arg status "$stat" '{
    "tool_name": "TaskUpdate",
    "cwd": $cwd,
    "tool_input": {"subject": $subject, "status": $status}
  }'
}

section "exploit-replication 27a: Phase 5 task → completed, ledger missing → WARN"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
assert_warn "$H" \
  "$(phase_task_payload "$REPO" "Phase 5 — Coverage expansion (depth)" "completed")" \
  "Phase 5 task completed + ledger phase 5 missing → WARN" \
  "Phase 5"
rm -rf "$REPO"

section "exploit-replication 27b: Phase 6 task → completed, ledger missing → WARN"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
assert_warn "$H" \
  "$(phase_task_payload "$REPO" "Phase 6 — Bug discovery" "completed")" \
  "Phase 6 task completed + ledger phase 6 missing → WARN" \
  "Phase 6"
rm -rf "$REPO"

section "exploit-replication 27c: Phase 7 task → completed, ledger missing → WARN"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
assert_warn "$H" \
  "$(phase_task_payload "$REPO" "Phase 7 — Final summary" "completed")" \
  "Phase 7 task completed + ledger phase 7 missing → WARN" \
  "Phase 7"
rm -rf "$REPO"

section "exploit-replication 27d: warn message names the no-skip contract"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
run_hook "$H" "$(phase_task_payload "$REPO" "Phase 5 — Coverage expansion (depth)" "completed")"

TESTS_RUN=$((TESTS_RUN + 1))
MSG=$(echo "$HOOK_OUT" | "$JQ" -r '.systemMessage // empty' 2>/dev/null)
# The audit hook warns and points to authoritative ledger + phase-validator
# dispatch as the canonical path. Confirm it names the contract surface.
if echo "$MSG" | grep -qF "phase ledger" && \
   echo "$MSG" | grep -qiE "(authoritative|canonical|cosmetic|drift|kernel rule|no-skip|pipeline phases cannot be skipped)" && \
   echo "$MSG" | grep -qE "(phase-validator|onboarding/SKILL.md|phase-validator-dispatch-required|onboarding-stop-authorized)"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} warn message names ledger + canonical-source language + reference"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("27d: warn message missing required messaging. msg=${MSG:0:600}")
  echo "${CLR_FAIL}  ✗${CLR_RST} warn message missing required messaging"
fi
rm -rf "$REPO"

section "exploit-replication 27e: TodoWrite shape with three Phase-N completions → triple WARN"

# The actual session shape was a TodoWrite with multiple todos; the hook
# accepts both TaskUpdate and TodoWrite. Single payload listing all three
# closures must surface drift for each phase-N entry the ledger doesn't
# agree with.
REPO=$(make_repo)
plant_bypass_ledger "$REPO"
PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "TodoWrite",
  "cwd": $cwd,
  "tool_input": {
    "todos": [
      {"content": "Phase 5 — Coverage expansion (depth)", "status": "completed", "activeForm": "completing phase 5"},
      {"content": "Phase 6 — Bug discovery", "status": "completed", "activeForm": "completing phase 6"},
      {"content": "Phase 7 — Final summary", "status": "completed", "activeForm": "completing phase 7"}
    ]
  }
}')
run_hook "$H" "$PAYLOAD"

TESTS_RUN=$((TESTS_RUN + 1))
MSG=$(echo "$HOOK_OUT" | "$JQ" -r '.systemMessage // empty' 2>/dev/null)
if echo "$MSG" | grep -q "Phase 5" && \
   echo "$MSG" | grep -q "Phase 6" && \
   echo "$MSG" | grep -q "Phase 7"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} TodoWrite triple-closure → warn names all three phases"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("27e: warn missing one of the three phases. msg=${MSG:0:500}")
  echo "${CLR_FAIL}  ✗${CLR_RST} TodoWrite triple-closure (warn missing one of three phases)"
fi
rm -rf "$REPO"

section "exploit-replication 27f: same TaskUpdate but ledger phase 5 greenlit → silent allow"

REPO=$(make_repo)
plant_full_ledger "$REPO"
assert_allow "$H" \
  "$(phase_task_payload "$REPO" "Phase 5 — Coverage expansion (depth)" "completed")" \
  "Phase 5 task completed + ledger phase 5 greenlit → silent allow"
rm -rf "$REPO"

section "exploit-replication 27g: TodoWrite triple-closure, ledger 5/6/7 greenlit → silent allow"

REPO=$(make_repo)
plant_full_ledger "$REPO"
PAYLOAD=$("$JQ" -n --arg cwd "$REPO" '{
  "tool_name": "TodoWrite",
  "cwd": $cwd,
  "tool_input": {
    "todos": [
      {"content": "Phase 5 — Coverage expansion (depth)", "status": "completed"},
      {"content": "Phase 6 — Bug discovery", "status": "completed"},
      {"content": "Phase 7 — Final summary", "status": "completed"}
    ]
  }
}')
assert_allow "$H" "$PAYLOAD" "TodoWrite triple-completion + full ledger → silent allow"
rm -rf "$REPO"
