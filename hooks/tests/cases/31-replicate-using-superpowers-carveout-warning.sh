#!/bin/bash
# 31-replicate-using-superpowers-carveout-warning.sh — exploit-replication
# test for hooks/using-superpowers-carveout-guard.sh.
#
# The BookHive Run-2 bypass session leaned on the upstream
# superpowers/using-superpowers Instruction-Priority block to rationalise
# the pipeline cut: "user instructions outrank skill contracts always."
# The local-mirror carve-out hook fires WARN at Skill-load time, surfacing
# the no-skip carve-out before the orchestrator reads the upstream
# Priority block.
#
# Replicates the bypass byte-for-byte:
#   - Phase ledger: phases 1-4 greenlit, phases 5-7 absent (verbatim).
#   - Sentinel: absent.
#   - Tool call: PreToolUse:Skill with skill="using-superpowers".
#
# Asserts:
#   - WARN fires (systemMessage emitted).
#   - systemMessage contains the carve-out language and explicitly
#     references the no-skip contract + sentinel path.
#
# Inverse cases:
#   - Subagent context (parent_tool_use_id present) → silent allow.
#   - Phase ledger fully greenlit → silent allow.
#   - Sentinel present → silent allow.
#   - Tool is not Skill → silent allow.
#   - Skill is not using-superpowers → silent allow.
#
# NOTE: the carve-out hook is a LOCAL MIRROR. The upstream skill lives in
# the superpowers plugin package; we test the local mirror only here.

H="$HOOK_DIR/using-superpowers-carveout-guard.sh"
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

# Build a Skill-tool payload. We need to force the orchestrator-context
# detection because the test runner has no parent_tool_use_id by default.
skill_payload() {
  local repo="$1" skill_name="$2"
  "$JQ" -n --arg cwd "$repo" --arg skill "$skill_name" '{
    "tool_name": "Skill",
    "cwd": $cwd,
    "tool_input": {"skill": $skill}
  }'
}

skill_payload_subagent() {
  local repo="$1" skill_name="$2"
  "$JQ" -n --arg cwd "$repo" --arg skill "$skill_name" '{
    "tool_name": "Skill",
    "cwd": $cwd,
    "tool_input": {"skill": $skill},
    "parent_tool_use_id": "tool-from-orchestrator"
  }'
}

section "exploit-replication 31a: orchestrator + mid-pipeline + using-superpowers → WARN"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
assert_warn "$H" "$(skill_payload "$REPO" "using-superpowers")" \
  "orchestrator + bypass ledger + using-superpowers → WARN" \
  "Instruction-Priority carve-out"
rm -rf "$REPO"

section "exploit-replication 31b: warn message names no-skip + sentinel + carve-out"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
run_hook "$H" "$(skill_payload "$REPO" "using-superpowers")"

TESTS_RUN=$((TESTS_RUN + 1))
MSG=$(echo "$HOOK_OUT" | "$JQ" -r '.systemMessage // empty' 2>/dev/null)
if echo "$MSG" | grep -qF -- ".claude/onboarding-stop-authorized" && \
   echo "$MSG" | grep -qiE "(kernel rule|no-skip|onboarding/SKILL.md|pipeline phases cannot be skipped)" && \
   echo "$MSG" | grep -qF "carve-out" && \
   echo "$MSG" | grep -qiE "(final-step|final deliverable|BENCHMARK|pre-emptive)"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} warn message names no-skip + sentinel + carve-out + framing"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("31b: warn missing required messaging. msg=${MSG:0:600}")
  echo "${CLR_FAIL}  ✗${CLR_RST} warn message missing required messaging"
fi
rm -rf "$REPO"

section "exploit-replication 31c: subagent context (parent_tool_use_id present) → silent allow"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
assert_allow "$H" "$(skill_payload_subagent "$REPO" "using-superpowers")" \
  "subagent context + bypass ledger → silent allow"
rm -rf "$REPO"

section "exploit-replication 31d: full ledger greenlit → silent allow"

REPO=$(make_repo)
plant_full_ledger "$REPO"
assert_allow "$H" "$(skill_payload "$REPO" "using-superpowers")" \
  "all phases greenlit → silent allow (no carve-out needed)"
rm -rf "$REPO"

section "exploit-replication 31e: sentinel present → silent allow"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
touch "$REPO/.claude/onboarding-stop-authorized"
assert_allow "$H" "$(skill_payload "$REPO" "using-superpowers")" \
  "early-stop sentinel present → silent allow"
rm -rf "$REPO"

section "exploit-replication 31f: different skill name → silent allow"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
assert_allow "$H" "$(skill_payload "$REPO" "test-composer")" \
  "non-superpowers skill load → silent allow"
rm -rf "$REPO"

section "exploit-replication 31g: plugin-prefixed skill name still matches → WARN"

# Plugin-scoped form is "<plugin>:<skill>" — accepted by the hook.
REPO=$(make_repo)
plant_bypass_ledger "$REPO"
assert_warn "$H" "$(skill_payload "$REPO" "superpowers:using-superpowers")" \
  "plugin-prefixed superpowers:using-superpowers → WARN" \
  "Instruction-Priority carve-out"
rm -rf "$REPO"

section "exploit-replication 31h: env-var off → silent allow"

REPO=$(make_repo)
plant_bypass_ledger "$REPO"
HOOK_OUT=$(USING_SUPERPOWERS_CARVEOUT_GUARD=off bash "$H" \
  <<<"$(skill_payload "$REPO" "using-superpowers")" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} USING_SUPERPOWERS_CARVEOUT_GUARD=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("USING_SUPERPOWERS_CARVEOUT_GUARD=off: expected silent, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} env-off escape (expected silent allow)"
fi
rm -rf "$REPO"
