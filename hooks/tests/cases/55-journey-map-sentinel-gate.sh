#!/bin/bash
# Tests for journey-map-sentinel-gate.sh — Phase-4 fidelity gate that
# denies orchestrator-direct writes to journey-map.md /
# journey-map-coverage.md that bypass the journey-mapping skill.
# PreToolUse:Write|Edit. DENY mode.
H="$HOOK_DIR/journey-map-sentinel-gate.sh"

TMP_REPO=$(mktemp -d /tmp/journey-map-sentinel-XXXXXX)
mkdir -p "$TMP_REPO/tests/e2e/docs"
trap 'rm -rf "$TMP_REPO"' EXIT

MAP_PATH="$TMP_REPO/tests/e2e/docs/journey-map.md"
COVERAGE_PATH="$TMP_REPO/tests/e2e/docs/journey-map-coverage.md"
CYCLE_STATE_PATH="$TMP_REPO/tests/e2e/docs/.phase4-cycle-state.json"

SENTINEL='<!-- journey-mapping:generated -->'

# Helper: build a minimal valid cycle-state with N cycle-1 sections.
make_cycle_state() {
  local count=$1
  local sections="["
  for ((i=0; i<count; i++)); do sections+="\"sec-$i\","; done
  sections="${sections%,}]"
  cat > "$CYCLE_STATE_PATH" <<EOF
{
  "phase4-cycle-state-version": 1,
  "started-at": "2026-05-18T09:00:00Z",
  "cycleStrictness": "standard",
  "cycles": {
    "1": {
      "kind": "discovery",
      "dispatched-sections": $sections,
      "returned-sections": $sections
    }
  }
}
EOF
}

# ---------------------------------------------------------------------------
section "journey-map-sentinel: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/tmp/x')" "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='whatever')" "Agent → silent allow"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: non-Phase-4 paths silent-allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/tmp/anything.md' content='hello')" \
  "Write /tmp/anything.md → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/repo/tests/e2e/docs/app-context.md' content='# App')" \
  "Write app-context.md → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/repo/tests/e2e/spec.ts' content='test()')" \
  "Write a spec.ts → silent allow"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: journey-map.md DENIED without sentinel on line 1"
rm -f "$MAP_PATH" "$CYCLE_STATE_PATH"
make_cycle_state 3
assert_deny "$H" "$(payload tool_name=Write file_path="$MAP_PATH" content='# BookHive Journey Map

## Priority 0
- j-signup')" \
  "Write journey-map.md without sentinel → DENY" "line 1 must be the literal sentinel"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: journey-map.md DENIED when cycle-state is absent"
rm -f "$MAP_PATH" "$CYCLE_STATE_PATH"
WELL_FORMED_MAP="${SENTINEL}
# BookHive Journey Map
## P0
- j-signup"
assert_deny "$H" "$(payload tool_name=Write file_path="$MAP_PATH" content="$WELL_FORMED_MAP")" \
  "Write sentinel-bearing map without cycle-state → DENY" "phase4-cycle-state.json does not exist"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: journey-map.md DENIED when cycle-1 has 0 sections"
rm -f "$MAP_PATH" "$CYCLE_STATE_PATH"
cat > "$CYCLE_STATE_PATH" <<'EOF'
{
  "phase4-cycle-state-version": 1,
  "started-at": "2026-05-18T09:00:00Z",
  "cycleStrictness": "standard",
  "cycles": {
    "1": {
      "kind": "discovery",
      "dispatched-sections": [],
      "returned-sections": []
    }
  }
}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$MAP_PATH" content="$WELL_FORMED_MAP")" \
  "Write sentinel-bearing map but 0 cycle-1 sections → DENY" "0 cycle-1 section dispatches"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: journey-map.md ALLOWED with sentinel + ≥1 cycle-1 section"
rm -f "$MAP_PATH" "$CYCLE_STATE_PATH"
make_cycle_state 3
assert_allow "$H" "$(payload tool_name=Write file_path="$MAP_PATH" content="$WELL_FORMED_MAP")" \
  "Write sentinel-bearing map + cycle-state with 3 sections → ALLOW"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: Edit to existing sentinel-bearing map silent-allows"
# Drop a sentinel-bearing map on disk first.
echo "$WELL_FORMED_MAP" > "$MAP_PATH"
make_cycle_state 3
# Edit doesn't need to re-pass the sentinel check — the existing file
# already carries the authorship signal.
assert_allow "$H" "$(payload tool_name=Edit file_path="$MAP_PATH" old_string='j-signup' new_string='j-signup-v2')" \
  "Edit a sentinel-bearing map → silent allow"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: Edit to a sentinel-less map still requires the sentinel"
rm -f "$MAP_PATH"
# Existing map LACKS the sentinel (hand-rolled). An Edit doesn't get a
# free pass: the proposed new_string still has to start with the sentinel.
echo "# Hand-rolled, no sentinel
- j-signup" > "$MAP_PATH"
make_cycle_state 3
assert_deny "$H" "$(payload tool_name=Edit file_path="$MAP_PATH" old_string='j-signup' new_string='# Still no sentinel
- j-signup-edited')" \
  "Edit a sentinel-less map without restoring the sentinel → DENY" "line 1 must be the literal sentinel"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: journey-map-coverage.md DENIED when journey-map.md is missing"
rm -f "$MAP_PATH" "$COVERAGE_PATH"
make_cycle_state 3
assert_deny "$H" "$(payload tool_name=Write file_path="$COVERAGE_PATH" content='| Journey | Spec |')" \
  "Write coverage matrix without map → DENY" "may only be written after journey-map.md exists"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: journey-map-coverage.md DENIED when map lacks sentinel"
echo "# Hand-rolled, no sentinel" > "$MAP_PATH"
make_cycle_state 3
assert_deny "$H" "$(payload tool_name=Write file_path="$COVERAGE_PATH" content='| Journey | Spec |')" \
  "Write coverage matrix when existing map lacks sentinel → DENY" "missing the sentinel"

# ---------------------------------------------------------------------------
section "journey-map-sentinel: journey-map-coverage.md ALLOWED when map has sentinel"
echo "$WELL_FORMED_MAP" > "$MAP_PATH"
make_cycle_state 3
assert_allow "$H" "$(payload tool_name=Write file_path="$COVERAGE_PATH" content='| Journey | Spec |')" \
  "Write coverage matrix when sentinel-bearing map exists → ALLOW"
