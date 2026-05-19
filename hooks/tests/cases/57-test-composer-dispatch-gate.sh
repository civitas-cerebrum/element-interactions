#!/bin/bash
# Tests for test-composer-dispatch-gate.sh — denies orchestrator-direct
# new-spec Writes and subagent-context new-spec Writes whose transcript
# shows no test-composer skill preread.
H="$HOOK_DIR/test-composer-dispatch-gate.sh"

TMP_DIR=$(mktemp -d /tmp/tc-dispatch-gate-XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

# Active spec path used throughout. Lives inside tests/e2e/.
NEW_SPEC_PATH="$TMP_DIR/tests/e2e/j-bad-login.spec.ts"
NESTED_SPEC_PATH="$TMP_DIR/tests/e2e/journeys/auth/login.spec.ts"
mkdir -p "$(dirname "$NEW_SPEC_PATH")" "$(dirname "$NESTED_SPEC_PATH")"

# Transcript with a Skill invocation of test-composer.
SKILL_TRANSCRIPT="$TMP_DIR/skill.jsonl"
cat > "$SKILL_TRANSCRIPT" <<'EOF'
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"compose the spec"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Skill","input":{"skill":"test-composer"}}]}}
EOF

# Transcript with a Read of the skill file (bundled package path).
READ_TRANSCRIPT="$TMP_DIR/read.jsonl"
cat > "$READ_TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{"file_path":"/Users/x/proj/node_modules/@civitas-cerebrum/element-interactions/skills/test-composer/SKILL.md"}}]}}
EOF

# Transcript with neither (subagent dispatched with a freeform prose
# brief, never loaded the skill).
NEITHER_TRANSCRIPT="$TMP_DIR/neither.jsonl"
cat > "$NEITHER_TRANSCRIPT" <<'EOF'
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"write the spec"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll write it directly."}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{"file_path":"/Users/x/proj/tests/e2e/docs/app-context.md"}}]}}
EOF

# Helper: payload for Write to a spec with given parent_tool_use_id +
# transcript. Empty parent_id = orchestrator context.
spec_payload() {
  local fp=$1
  local parent_id=$2
  local transcript=$3
  "$JQ" -n --arg fp "$fp" --arg pid "$parent_id" --arg tp "$transcript" '{
    tool_name: "Write",
    tool_input: { file_path: $fp, content: "import {test} from \"@playwright/test\";\ntest(\"x\", async ({page}) => {});\n" },
    parent_tool_use_id: $pid,
    transcript_path: $tp
  }'
}

# ---------------------------------------------------------------------------
section "test-composer-gate: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls' transcript_path="$NEITHER_TRANSCRIPT")" \
  "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/tmp/x' transcript_path="$NEITHER_TRANSCRIPT")" \
  "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='composer-happy-path:auth' prompt='compose' transcript_path="$NEITHER_TRANSCRIPT")" \
  "Agent → silent allow (this gate is Write-only)"

# ---------------------------------------------------------------------------
section "test-composer-gate: non-spec paths silent-allow"
assert_allow "$H" "$(spec_payload "$TMP_DIR/notes.md" "" "$NEITHER_TRANSCRIPT")" \
  "Write to non-spec path /tmp/notes.md → silent allow"
assert_allow "$H" "$(spec_payload "$TMP_DIR/tests/unit/foo.test.ts" "" "$NEITHER_TRANSCRIPT")" \
  "Write to non-e2e test path → silent allow"

# ---------------------------------------------------------------------------
section "test-composer-gate: Edit on existing spec is silent-allowed"
# Create the file so the Write path becomes an overwrite (treated as
# edit for this gate's purposes — Phase 7 secrets-sweep edits specs in
# orchestrator context).
echo '// existing' > "$NEW_SPEC_PATH"
assert_allow "$H" "$(spec_payload "$NEW_SPEC_PATH" "" "$NEITHER_TRANSCRIPT")" \
  "Write to EXISTING spec (overwrite) from orchestrator → silent allow"
rm -f "$NEW_SPEC_PATH"

# ---------------------------------------------------------------------------
section "test-composer-gate: orchestrator-direct new-spec write DENIED"
# parent_tool_use_id empty = orchestrator context. The Run-8 exploit
# shape — author specs directly with no test-composer dispatch.
assert_deny "$H" "$(spec_payload "$NEW_SPEC_PATH" "" "$SKILL_TRANSCRIPT")" \
  "orchestrator-direct write to new spec + Skill preread → still DENY (must dispatch composer)" "from orchestrator context"
assert_deny "$H" "$(spec_payload "$NEW_SPEC_PATH" "" "$NEITHER_TRANSCRIPT")" \
  "orchestrator-direct write to new spec + no preread → DENY" "from orchestrator context"
# Nested layout too (tests/e2e/journeys/auth/login.spec.ts).
assert_deny "$H" "$(spec_payload "$NESTED_SPEC_PATH" "" "$NEITHER_TRANSCRIPT")" \
  "orchestrator-direct write to nested spec → DENY (covers nested layouts)" "from orchestrator context"

# Deny message must point at the composer dispatch path, not at writing
# the spec via a different mechanism.
assert_deny "$H" "$(spec_payload "$NEW_SPEC_PATH" "" "$NEITHER_TRANSCRIPT")" \
  "deny message names composer-happy-path / composer-j- dispatch prefixes" "composer-happy-path"

# ---------------------------------------------------------------------------
section "test-composer-gate: subagent-context new-spec write WITHOUT preread DENIED"
assert_deny "$H" "$(spec_payload "$NEW_SPEC_PATH" "parent-abc123" "$NEITHER_TRANSCRIPT")" \
  "subagent write (parent_id set) + no test-composer preread → DENY" "loaded the test-composer skill"

# ---------------------------------------------------------------------------
section "test-composer-gate: subagent-context new-spec write WITH Skill('test-composer') ALLOWED"
assert_allow "$H" "$(spec_payload "$NEW_SPEC_PATH" "parent-abc123" "$SKILL_TRANSCRIPT")" \
  "subagent write + Skill('test-composer') in transcript → ALLOW"

# ---------------------------------------------------------------------------
section "test-composer-gate: subagent-context new-spec write WITH Read of SKILL.md ALLOWED"
assert_allow "$H" "$(spec_payload "$NEW_SPEC_PATH" "parent-abc123" "$READ_TRANSCRIPT")" \
  "subagent write + Read of skills/test-composer/SKILL.md → ALLOW"

# ---------------------------------------------------------------------------
section "test-composer-gate: missing / nonexistent transcript_path silent-allows (fail-open)"
# When parent_id is set but transcript_path is missing, fall through.
# The orchestrator-direct check already caught the primary exploit
# shape; without a transcript we can't verify the subagent's preread.
PAYLOAD_NO_TRANSCRIPT=$("$JQ" -n --arg fp "$NEW_SPEC_PATH" --arg pid "parent-abc123" '{
  tool_name: "Write",
  tool_input: { file_path: $fp, content: "x" },
  parent_tool_use_id: $pid
}')
assert_allow "$H" "$PAYLOAD_NO_TRANSCRIPT" \
  "subagent write with no transcript_path → silent allow (fail-open)"

PAYLOAD_BOGUS_TRANSCRIPT=$("$JQ" -n --arg fp "$NEW_SPEC_PATH" --arg pid "parent-abc123" '{
  tool_name: "Write",
  tool_input: { file_path: $fp, content: "x" },
  parent_tool_use_id: $pid,
  transcript_path: "/tmp/does-not-exist.jsonl"
}')
assert_allow "$H" "$PAYLOAD_BOGUS_TRANSCRIPT" \
  "subagent write with bogus transcript_path → silent allow (fail-open)"

# ---------------------------------------------------------------------------
section "test-composer-gate: TEST_COMPOSER_PREREAD_GATE=off bypass"
# Bypass should silent-allow even the most egregious case (orchestrator-
# direct new-spec write with no preread).
TESTS_RUN=$((TESTS_RUN + 1))
BYPASS_OUT=$(printf '%s' "$(spec_payload "$NEW_SPEC_PATH" "" "$NEITHER_TRANSCRIPT")" \
  | TEST_COMPOSER_PREREAD_GATE=off "$H" 2>&1)
if [ -z "$BYPASS_OUT" ]; then
  echo "${CLR_PASS}  ✓${CLR_RST} TEST_COMPOSER_PREREAD_GATE=off → bypass (no output)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "${CLR_FAIL}  ✗${CLR_RST} bypass test ${CLR_DIM}(expected empty stdout, got: ${BYPASS_OUT})${CLR_RST}"
fi
