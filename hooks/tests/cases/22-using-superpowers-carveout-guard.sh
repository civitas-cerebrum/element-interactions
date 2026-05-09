#!/bin/bash
# 22-using-superpowers-carveout-guard.sh — tests for using-superpowers carveout

H="$HOOK_DIR/using-superpowers-carveout-guard.sh"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

write_ledger_partial() {
  cat > "$1/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"in-progress"}}}
EOF
}

write_ledger_complete() {
  cat > "$1/tests/e2e/docs/onboarding-phase-ledger.json" <<'EOF'
{"phases":{"1":{"status":"greenlight"},"2":{"status":"greenlight"},"3":{"status":"greenlight"},"4":{"status":"greenlight"},"5":{"status":"greenlight"},"6":{"status":"greenlight"},"7":{"status":"greenlight"}}}
EOF
}

# Force orchestrator context (the production detection is via parent_tool_use_id /
# transcript_path but the hook accepts the test override).
ORCH=USING_SUPERPOWERS_CARVEOUT_TEST_FORCE_CONTEXT=orchestrator
SUB=USING_SUPERPOWERS_CARVEOUT_TEST_FORCE_CONTEXT=subagent

assert_warn_with_env() {
  local hook="$1" stdin="$2" name="$3" message_substr="${4:-}" env_pair="$5"
  TESTS_RUN=$((TESTS_RUN + 1))
  local out
  out=$(env $env_pair bash "$hook" <<<"$stdin" 2>/dev/null) || true
  local has_msg
  has_msg=$(echo "$out" | jq -r 'has("systemMessage") // false' 2>/dev/null)
  if [ "$has_msg" != "true" ]; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("${name}: expected systemMessage, got=${out:0:200}")
    echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(expected systemMessage)${CLR_RST}"
    return
  fi
  if [ -n "$message_substr" ]; then
    local msg
    msg=$(echo "$out" | jq -r '.systemMessage' 2>/dev/null)
    if ! echo "$msg" | grep -qF -- "$message_substr"; then
      TESTS_FAILED=$((TESTS_FAILED + 1))
      FAIL_DETAILS+=("${name}: warn message missing substring '${message_substr}'. msg=${msg:0:300}")
      echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(warn message missing substring)${CLR_RST}"
      return
    fi
  fi
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} ${name}"
}

assert_allow_with_env() {
  local hook="$1" stdin="$2" name="$3" env_pair="$4"
  TESTS_RUN=$((TESTS_RUN + 1))
  local out
  out=$(env $env_pair bash "$hook" <<<"$stdin" 2>/dev/null) || true
  if [ -z "$out" ]; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "${CLR_PASS}  ✓${CLR_RST} ${name}"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("${name}: expected silent allow, got=${out:0:200}")
    echo "${CLR_FAIL}  ✗${CLR_RST} ${name} ${CLR_DIM}(expected silent allow)${CLR_RST}"
  fi
}

section "using-superpowers-carveout-guard: orchestrator + mid-pipeline → WARN"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_warn_with_env "$H" "$(payload tool_name=Skill skill='using-superpowers' cwd="$REPO")" "orchestrator + mid-pipeline → WARN" "Instruction-Priority carve-out" "$ORCH"
rm -rf "$REPO"

section "using-superpowers-carveout-guard: orchestrator + mid-pipeline + plugin-prefixed skill → WARN"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_warn_with_env "$H" "$(payload tool_name=Skill skill='superpowers:using-superpowers' cwd="$REPO")" "plugin-prefixed using-superpowers → WARN" "Instruction-Priority carve-out" "$ORCH"
rm -rf "$REPO"

section "using-superpowers-carveout-guard: subagent context → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_allow_with_env "$H" "$(payload tool_name=Skill skill='using-superpowers' cwd="$REPO")" "subagent + mid-pipeline → silent allow" "$SUB"
rm -rf "$REPO"

section "using-superpowers-carveout-guard: pipeline complete → silent allow"

REPO=$(make_repo)
write_ledger_complete "$REPO"
assert_allow_with_env "$H" "$(payload tool_name=Skill skill='using-superpowers' cwd="$REPO")" "all phases greenlight → silent allow" "$ORCH"
rm -rf "$REPO"

section "using-superpowers-carveout-guard: no ledger → silent allow"

REPO=$(make_repo)
assert_allow_with_env "$H" "$(payload tool_name=Skill skill='using-superpowers' cwd="$REPO")" "no ledger → silent allow" "$ORCH"
rm -rf "$REPO"

section "using-superpowers-carveout-guard: auth sentinel → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
touch "$REPO/.claude/onboarding-stop-authorized"
assert_allow_with_env "$H" "$(payload tool_name=Skill skill='using-superpowers' cwd="$REPO")" "auth sentinel + mid-pipeline → silent allow" "$ORCH"
rm -rf "$REPO"

section "using-superpowers-carveout-guard: docs-dir auth sentinel → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
touch "$REPO/tests/e2e/docs/.onboarding-stop-authorized"
assert_allow_with_env "$H" "$(payload tool_name=Skill skill='using-superpowers' cwd="$REPO")" "docs-dir auth sentinel + mid-pipeline → silent allow" "$ORCH"
rm -rf "$REPO"

section "using-superpowers-carveout-guard: other skills → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_allow_with_env "$H" "$(payload tool_name=Skill skill='element-interactions' cwd="$REPO")" "other skill (element-interactions) → silent allow" "$ORCH"
assert_allow_with_env "$H" "$(payload tool_name=Skill skill='journey-mapping' cwd="$REPO")" "other skill (journey-mapping) → silent allow" "$ORCH"
rm -rf "$REPO"

section "using-superpowers-carveout-guard: env-var off → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_allow_with_env "$H" "$(payload tool_name=Skill skill='using-superpowers' cwd="$REPO")" "USING_SUPERPOWERS_CARVEOUT_GUARD=off → silent allow" "$ORCH USING_SUPERPOWERS_CARVEOUT_GUARD=off"
rm -rf "$REPO"

section "using-superpowers-carveout-guard: non-Skill tool → silent allow"

REPO=$(make_repo)
write_ledger_partial "$REPO"
assert_allow_with_env "$H" "$(payload tool_name=Read file_path='/tmp/x')" "Read tool → silent allow" "$ORCH"
assert_allow_with_env "$H" "$(payload tool_name=Bash command='ls')" "Bash tool → silent allow" "$ORCH"
rm -rf "$REPO"
