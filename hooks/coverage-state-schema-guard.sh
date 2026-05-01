#!/bin/bash
# coverage-state-schema-guard.sh
#
# PreToolUse hook for Write/Edit. Validates the JSON shape of writes/edits to
# `tests/e2e/docs/coverage-expansion-state.json` per the schema documented in
# skills/coverage-expansion/SKILL.md §"Authoritative state file — read first".

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
case "$FILE_PATH" in
  *tests/e2e/docs/coverage-expansion-state.json) ;;
  *) exit 0 ;;
esac

emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# Resolve target content: for Write, the new content. For Edit, simulate.
if [ "$TOOL_NAME" = "Write" ]; then
  TARGET=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
elif [ "$TOOL_NAME" = "Edit" ]; then
  # Edit-resolution is non-trivial; just validate that the new_string portion
  # doesn't introduce malformed JSON.
  TARGET=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""')
fi

# 1. Must be valid JSON (Write only — Edit's new_string may be a partial slice).
if [ "$TOOL_NAME" = "Write" ]; then
  if ! echo "$TARGET" | jq empty 2>/dev/null; then
    emit_deny "[BLOCKED] coverage-expansion-state.json must be valid JSON.

File: $FILE_PATH

Fix: re-emit as well-formed JSON. The state file is read by the orchestrator on every entry — a malformed state file aborts the pipeline.

Schema (skills/coverage-expansion/SKILL.md §\"Authoritative state file\"):

  {
    \"status\": \"in-progress\" | \"complete\",
    \"mode\": \"depth\" | \"breadth\",
    \"currentPass\": <integer>,
    \"journeyRoster\": [\"j-<slug>\", ...],
    \"passes\": { \"<N>-compositional\": { \"dispatches\": [...] }, ... },
    \"updatedAt\": \"<ISO-8601>\"
  }"
    exit 0
  fi

  # 2. Required top-level keys.
  for KEY in status mode currentPass journeyRoster passes updatedAt; do
    if ! echo "$TARGET" | jq -e ".$KEY" >/dev/null 2>&1; then
      emit_deny "[BLOCKED] coverage-expansion-state.json missing required key '$KEY'.

File: $FILE_PATH

Fix: include all required top-level keys: status, mode, currentPass, journeyRoster, passes, updatedAt. See coverage-expansion SKILL.md §\"Authoritative state file\"."
      exit 0
    fi
  done

  # 3. journeyRoster must be a non-empty array.
  ROSTER_LEN=$(echo "$TARGET" | jq -r '.journeyRoster | length' 2>/dev/null || echo 0)
  if [ "$ROSTER_LEN" -eq 0 ]; then
    emit_deny "[BLOCKED] coverage-expansion-state.json has empty journeyRoster.

File: $FILE_PATH

Fix: populate journeyRoster from tests/e2e/docs/journey-map.md. An empty roster is meaningless — the orchestrator can't dispatch."
    exit 0
  fi

  # 4. currentPass must be an integer 0-5.
  CP=$(echo "$TARGET" | jq -r '.currentPass' 2>/dev/null)
  if ! echo "$CP" | grep -qE '^[0-5]$'; then
    emit_deny "[BLOCKED] coverage-expansion-state.json currentPass invalid.

File: $FILE_PATH
currentPass: $CP

Fix: must be an integer 0-5 (0 = before pass 1, 1-3 = compositional, 4-5 = adversarial). See coverage-expansion SKILL.md."
    exit 0
  fi
fi

exit 0
