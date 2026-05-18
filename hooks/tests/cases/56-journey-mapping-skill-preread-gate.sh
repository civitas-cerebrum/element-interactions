#!/bin/bash
# Tests for journey-mapping-skill-preread-gate.sh — denies writes to
# journey-map.md / phase4-* Agent dispatches when the session
# transcript shows the journey-mapping skill was never loaded.
H="$HOOK_DIR/journey-mapping-skill-preread-gate.sh"

TMP_DIR=$(mktemp -d /tmp/jm-preread-gate-XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

EMPTY_TRANSCRIPT="$TMP_DIR/empty.jsonl"
: > "$EMPTY_TRANSCRIPT"

# Transcript with a Skill invocation of journey-mapping.
SKILL_TRANSCRIPT="$TMP_DIR/skill.jsonl"
cat > "$SKILL_TRANSCRIPT" <<'EOF'
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"map the app"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Skill","input":{"skill":"journey-mapping"}}]}}
EOF

# Transcript with a Read of the skill file (bundled package path).
READ_TRANSCRIPT="$TMP_DIR/read.jsonl"
cat > "$READ_TRANSCRIPT" <<'EOF'
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{"file_path":"/Users/x/proj/node_modules/@civitas-cerebrum/element-interactions/skills/journey-mapping/SKILL.md"}}]}}
EOF

# Transcript with neither (orchestrator never loaded the skill).
NEITHER_TRANSCRIPT="$TMP_DIR/neither.jsonl"
cat > "$NEITHER_TRANSCRIPT" <<'EOF'
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"map the app"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll write the map directly."}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Read","input":{"file_path":"/Users/x/proj/tests/e2e/docs/app-context.md"}}]}}
EOF

MAP_PATH="$TMP_DIR/tests/e2e/docs/journey-map.md"
mkdir -p "$(dirname "$MAP_PATH")"

# Helper: payload for Write to journey-map.md with a given transcript.
write_payload() {
  local transcript=$1
  "$JQ" -n --arg fp "$MAP_PATH" --arg tp "$transcript" '{
    tool_name: "Write",
    tool_input: { file_path: $fp, content: "<!-- journey-mapping:generated -->" },
    transcript_path: $tp
  }'
}

# Helper: payload for Agent dispatch with a given description + transcript.
agent_payload() {
  local desc=$1
  local transcript=$2
  "$JQ" -n --arg d "$desc" --arg tp "$transcript" '{
    tool_name: "Agent",
    tool_input: { description: $d, prompt: "do work" },
    transcript_path: $tp
  }'
}

# ---------------------------------------------------------------------------
section "preread: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls' transcript_path="$NEITHER_TRANSCRIPT")" \
  "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/tmp/x' transcript_path="$NEITHER_TRANSCRIPT")" \
  "Read → silent allow"

# ---------------------------------------------------------------------------
section "preread: non-gated paths silent-allow"
assert_allow "$H" "$(write_payload "$NEITHER_TRANSCRIPT" | "$JQ" '.tool_input.file_path = "/tmp/anything.md"')" \
  "Write /tmp/anything.md → silent allow"
assert_allow "$H" "$(agent_payload 'workflow-reviewer-phase4:' "$NEITHER_TRANSCRIPT")" \
  "Agent dispatch with non-phase4 prefix → silent allow"

# ---------------------------------------------------------------------------
section "preread: Write to journey-map.md WITHOUT preread DENIED"
assert_deny "$H" "$(write_payload "$NEITHER_TRANSCRIPT")" \
  "Write journey-map.md, transcript shows no Skill / Read → DENY" "requires the journey-mapping skill"

# ---------------------------------------------------------------------------
section "preread: Write to journey-map.md WITH Skill('journey-mapping') ALLOWED"
assert_allow "$H" "$(write_payload "$SKILL_TRANSCRIPT")" \
  "Write journey-map.md, transcript shows Skill('journey-mapping') → ALLOW"

# ---------------------------------------------------------------------------
section "preread: Write to journey-map.md WITH Read of SKILL.md ALLOWED"
assert_allow "$H" "$(write_payload "$READ_TRANSCRIPT")" \
  "Write journey-map.md, transcript shows Read of skills/journey-mapping/SKILL.md → ALLOW"

# ---------------------------------------------------------------------------
section "preread: Agent dispatch phase4-cycle-* WITHOUT preread DENIED"
assert_deny "$H" "$(agent_payload 'phase4-cycle-1-section-auth:' "$NEITHER_TRANSCRIPT")" \
  "Agent dispatch phase4-cycle-1-section-auth, no preread → DENY" "requires the journey-mapping skill"
assert_deny "$H" "$(agent_payload 'phase4-prioritise-author:' "$NEITHER_TRANSCRIPT")" \
  "Agent dispatch phase4-prioritise-author, no preread → DENY" "requires the journey-mapping skill"

# ---------------------------------------------------------------------------
section "preread: Agent dispatch phase4-cycle-* WITH Skill preread ALLOWED"
assert_allow "$H" "$(agent_payload 'phase4-cycle-1-section-auth:' "$SKILL_TRANSCRIPT")" \
  "Agent dispatch phase4-cycle-1-section-auth, Skill preread → ALLOW"

# ---------------------------------------------------------------------------
section "preread: missing transcript_path silent-allows (fail-open)"
NO_TRANSCRIPT_PAYLOAD=$(write_payload "" | "$JQ" 'del(.transcript_path)')
assert_allow "$H" "$NO_TRANSCRIPT_PAYLOAD" \
  "Write journey-map.md without transcript_path → silent allow"

# ---------------------------------------------------------------------------
section "preread: nonexistent transcript_path silent-allows (fail-open)"
assert_allow "$H" "$(write_payload "/tmp/does-not-exist-xyz.jsonl")" \
  "Write journey-map.md with bogus transcript_path → silent allow"

# ---------------------------------------------------------------------------
section "preread: JOURNEY_MAPPING_PREREAD_GATE=off bypass"
(JOURNEY_MAPPING_PREREAD_GATE=off bash -c 'echo "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"'"$MAP_PATH"'\",\"content\":\"x\"},\"transcript_path\":\"'"$NEITHER_TRANSCRIPT"'\"}" | "'"$H"'"' 2>&1) > "$TMP_DIR/bypass.out" 2>&1
if grep -q "permissionDecision" "$TMP_DIR/bypass.out"; then
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("BYPASS test: expected silent allow under JOURNEY_MAPPING_PREREAD_GATE=off, got deny")
  echo "${CLR_FAIL}  ✗${CLR_RST} JOURNEY_MAPPING_PREREAD_GATE=off bypass"
else
  TESTS_PASSED=$((TESTS_PASSED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} JOURNEY_MAPPING_PREREAD_GATE=off bypass"
fi
