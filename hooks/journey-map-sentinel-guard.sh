#!/bin/bash
# journey-map-sentinel-guard.sh — preserve the journey-map.md line-1 sentinel
#
# Hook    : PreToolUse:Write|Edit  (filters to tests/e2e/docs/journey-map.md only)
# Mode    : DENY (sentinel-stripping writes / edits)
# State   : none
# Env     : none
#
# Rule
# ----
# Writes / edits to `tests/e2e/docs/journey-map.md` must preserve the
# `<!-- journey-mapping:generated -->` sentinel as line 1.
#
# Why
# ---
# The sentinel is the single source of truth for "this file was produced by
# the journey-mapping skill". Every downstream consumer (test-composer,
# coverage-expansion, coverage checkpoint) reads line 1 before parsing the
# rest. Stripping the sentinel silently breaks every downstream skill —
# consumers refuse to read the file, the run halts, and the operator
# debugs upward instead of looking at the line that vanished.
#
# Canonical reference
# -------------------
# skills/journey-mapping/SKILL.md §"Phase 4: Journey Map Document"
#   (signature-marker rules + hard gate)
# skills/journey-mapping/SKILL.md §"Hard rules — kernel-resident"
#
# Failure → action
# ----------------
# - Write that would replace the sentinel on line 1                    → DENY
# - Edit whose old_string matches line 1 and removes the sentinel      → DENY
# - Anything else                                                      → silent allow

set -euo pipefail

# --- helpers ---
emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# --- input ---
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

  # Quick check: old_string contains sentinel but new_string doesn't.
  if echo "$OLD_STRING" | grep -qF "$SENTINEL" && ! echo "$NEW_STRING" | grep -qF "$SENTINEL"; then
    emit_deny "[BLOCKED] Edit would strip the journey-mapping sentinel.

File: $FILE_PATH
old_string contains: \"${SENTINEL}\"
new_string does NOT.

Fix: keep the sentinel in new_string. The sentinel is the single source of truth for \"this file was produced by the journey-mapping skill\" — consumers check line 1 before parsing. See journey-mapping/SKILL.md §\"Recognizing a previously-generated journey map\"."
    exit 0
  fi

  # Stronger check: simulate the replacement against the current file and
  # validate the resulting line 1. This catches edits that strip the sentinel
  # indirectly (e.g. old_string is line 2-N but the replacement shifts line 1).
  if [ -f "$FILE_PATH" ]; then
    POST_EDIT_LINE1=$(python3 -c "
import sys, json
data = json.load(sys.stdin)
file_path = data['tool_input']['file_path']
old_str = data['tool_input'].get('old_string', '')
new_str = data['tool_input'].get('new_string', '')
try:
    with open(file_path, 'r') as f:
        content = f.read()
    if old_str and old_str in content:
        post = content.replace(old_str, new_str, 1)
    else:
        post = content
    line1 = post.split('\n', 1)[0] if post else ''
    print(line1)
except Exception:
    pass
" <<< "$INPUT" 2>/dev/null || echo "")

    if [ -n "$POST_EDIT_LINE1" ] && [ "$POST_EDIT_LINE1" != "$SENTINEL" ]; then
      emit_deny "[BLOCKED] Edit would change line 1, stripping the journey-mapping sentinel.

File: $FILE_PATH
Resulting line 1: \"${POST_EDIT_LINE1}\"
Required line 1:  \"${SENTINEL}\"

Fix: ensure the edit preserves the sentinel as line 1. See journey-mapping/SKILL.md §\"Recognizing a previously-generated journey map\"."
      exit 0
    fi
  fi
fi

exit 0
