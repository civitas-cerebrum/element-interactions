#!/bin/bash
# journey-map-sentinel-guard.sh
#
# PreToolUse hook for Write/Edit. Blocks edits to journey-map.md that would
# strip the `<!-- journey-mapping:generated -->` sentinel from line 1.
#
# Why: the sentinel is the single source of truth for "this file was produced
# by the journey-mapping skill". Consumers (test-composer, coverage-expansion,
# coverage checkpoint) check line 1 before parsing. Stripping it silently
# breaks every downstream skill.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
case "$FILE_PATH" in
  *tests/e2e/docs/journey-map.md) ;;
  *) exit 0 ;;
esac

SENTINEL='<!-- journey-mapping:generated -->'

emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

if [ "$TOOL_NAME" = "Write" ]; then
  CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
  FIRST_LINE=$(printf '%s\n' "$CONTENT" | head -n 1)
  if [ "$FIRST_LINE" != "$SENTINEL" ]; then
    emit_deny "[BLOCKED] journey-map.md must keep its sentinel on line 1.

File: $FILE_PATH
Line 1 of new content: \"${FIRST_LINE}\"
Required line 1: \"${SENTINEL}\"

Fix: prepend the sentinel as the first line. Every consumer of this file (test-composer, coverage-expansion, coverage checkpoint) checks line 1 before parsing. Stripping the sentinel silently breaks downstream skills.

If you genuinely need to author a non-skill journey map, name the file differently (e.g., journey-map-manual.md) — do not overwrite the sentinel-bearing one. See journey-mapping/SKILL.md §\"Recognizing a previously-generated journey map\"."
    exit 0
  fi
fi

if [ "$TOOL_NAME" = "Edit" ]; then
  OLD_STRING=$(echo "$INPUT" | jq -r '.tool_input.old_string // ""')
  NEW_STRING=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""')
  if echo "$OLD_STRING" | grep -qF "$SENTINEL" && ! echo "$NEW_STRING" | grep -qF "$SENTINEL"; then
    emit_deny "[BLOCKED] Edit would strip the journey-mapping sentinel.

File: $FILE_PATH
old_string contains: \"${SENTINEL}\"
new_string does NOT.

Fix: keep the sentinel in new_string. The sentinel is the single source of truth for \"this file was produced by the journey-mapping skill\" — consumers check line 1 before parsing. See journey-mapping/SKILL.md §\"Recognizing a previously-generated journey map\"."
    exit 0
  fi
fi

exit 0
