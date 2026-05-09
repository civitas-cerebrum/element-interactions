#!/bin/bash
# 23-task-update-phase-ledger-audit.sh — tests for task-update-phase-ledger-audit.sh
H="$HOOK_DIR/task-update-phase-ledger-audit.sh"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs"
  echo "$d"
}

ledger_partial() {
  cat > "$1/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"in-progress"}}}
EOF
}

ledger_complete() {
  cat > "$1/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"greenlight"},"7":{"status":"greenlight"}}}
EOF
}

# Helper to build a JSON-shaped TodoWrite payload via raw jq because the
# generic `payload` helper doesn't support array subfields.
build_todowrite() {
  local cwd="$1"
  shift
  # Each remaining arg is `<phase-content>|<status>` separated by |
  local todos='[]'
  for spec in "$@"; do
    local content="${spec%|*}"
    local status="${spec##*|}"
    todos=$(echo "$todos" | jq --arg c "$content" --arg s "$status" '. + [{content:$c, status:$s, activeForm:$c}]')
  done
  jq -n --arg cwd "$cwd" --argjson todos "$todos" \
    '{tool_name:"TodoWrite", cwd:$cwd, tool_input:{todos:$todos}}'
}

build_taskupdate() {
  local cwd="$1" subject="$2" status="$3"
  jq -n --arg cwd "$cwd" --arg subject "$subject" --arg status "$status" \
    '{tool_name:"TaskUpdate", cwd:$cwd, tool_input:{subject:$subject, status:$status}}'
}

section "task-update-phase-ledger-audit: TodoWrite — Phase-5 completed but ledger in-progress → WARN"

REPO=$(make_repo)
ledger_partial "$REPO"
PAYLOAD=$(build_todowrite "$REPO" "Phase 5 — coverage expansion|completed")
assert_warn "$H" "$PAYLOAD" "Phase 5 done while ledger says in-progress → WARN" "drift"
rm -rf "$REPO"

section "task-update-phase-ledger-audit: TodoWrite — Phase-5 completed and ledger greenlight → silent allow"

REPO=$(make_repo)
ledger_complete "$REPO"
PAYLOAD=$(build_todowrite "$REPO" "Phase 5 — coverage expansion|completed")
assert_allow "$H" "$PAYLOAD" "Phase 5 done + ledger greenlight → silent allow"
rm -rf "$REPO"

section "task-update-phase-ledger-audit: TodoWrite — multiple Phase tasks, mixed status → WARN naming offending phases"

REPO=$(make_repo)
ledger_partial "$REPO"
# Phase 4 greenlight, Phase 5 in-progress.
PAYLOAD=$(build_todowrite "$REPO" \
  "Phase 4 — happy-path automation|completed" \
  "Phase 5 — coverage expansion|completed" \
  "Phase 6 — adversarial passes|completed")
assert_warn "$H" "$PAYLOAD" "phases 5 and 6 closed while ledger != green → WARN" "Phase 5"
rm -rf "$REPO"

section "task-update-phase-ledger-audit: TodoWrite — non-Phase tasks → silent allow"

REPO=$(make_repo)
ledger_partial "$REPO"
PAYLOAD=$(build_todowrite "$REPO" \
  "Run smoke tests|completed" \
  "Update README|completed")
assert_allow "$H" "$PAYLOAD" "non-Phase task closes → silent allow"
rm -rf "$REPO"

section "task-update-phase-ledger-audit: TodoWrite — Phase task in-progress → silent allow"

REPO=$(make_repo)
ledger_partial "$REPO"
PAYLOAD=$(build_todowrite "$REPO" "Phase 5 — coverage expansion|in_progress")
assert_allow "$H" "$PAYLOAD" "Phase 5 marked in_progress → silent allow"
rm -rf "$REPO"

section "task-update-phase-ledger-audit: TaskUpdate alternate shape → WARN"

REPO=$(make_repo)
ledger_partial "$REPO"
PAYLOAD=$(build_taskupdate "$REPO" "Phase 5 done" "completed")
assert_warn "$H" "$PAYLOAD" "TaskUpdate Phase 5 completed + ledger in-progress → WARN" "drift"
rm -rf "$REPO"

section "task-update-phase-ledger-audit: case-insensitive phase match"

REPO=$(make_repo)
ledger_partial "$REPO"
PAYLOAD=$(build_todowrite "$REPO" "phase 5 — coverage expansion|completed")
assert_warn "$H" "$PAYLOAD" "lower-case 'phase 5' still detected → WARN" "drift"
rm -rf "$REPO"

section "task-update-phase-ledger-audit: 'done' status alias → WARN"

REPO=$(make_repo)
ledger_partial "$REPO"
PAYLOAD=$(build_todowrite "$REPO" "Phase 5 — coverage expansion|done")
assert_warn "$H" "$PAYLOAD" "status='done' treated as completed → WARN" "drift"
rm -rf "$REPO"

section "task-update-phase-ledger-audit: no ledger → silent allow"

REPO=$(make_repo)
PAYLOAD=$(build_todowrite "$REPO" "Phase 5 — done|completed")
assert_allow "$H" "$PAYLOAD" "no ledger → silent allow"
rm -rf "$REPO"

section "task-update-phase-ledger-audit: env off → silent allow"

REPO=$(make_repo)
ledger_partial "$REPO"
PAYLOAD=$(build_todowrite "$REPO" "Phase 5 — coverage expansion|completed")
HOOK_OUT=$(TASK_UPDATE_PHASE_LEDGER_AUDIT=off bash "$H" <<<"$PAYLOAD" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} TASK_UPDATE_PHASE_LEDGER_AUDIT=off → silent"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("audit env=off: expected silent, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} TASK_UPDATE_PHASE_LEDGER_AUDIT=off (expected silent)"
fi
rm -rf "$REPO"

section "task-update-phase-ledger-audit: non-Task tool → silent allow"

REPO=$(make_repo)
ledger_partial "$REPO"
assert_allow "$H" "$(payload tool_name=Read file_path='/tmp/x' cwd="$REPO")" "Read tool → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='ls' cwd="$REPO")" "Bash tool → silent allow"
rm -rf "$REPO"
