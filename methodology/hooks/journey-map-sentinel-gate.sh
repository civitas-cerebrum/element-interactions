#!/bin/bash
# journey-map-sentinel-gate.sh — Phase-4 fidelity gate.
#                                Denies orchestrator-direct writes to
#                                tests/e2e/docs/journey-map.md /
#                                journey-map-coverage.md that bypass
#                                the journey-mapping skill's cycle
#                                protocol.
#
# Hook    : PreToolUse:Write|Edit
# Mode    : DENY
# State   : reads tests/e2e/docs/.phase4-cycle-state.json (when present)
# Env     : none
#
# Why
# ---
# The `journey-mapping` skill drives Phase 4 via an iterative discovery
# cycle protocol: cycle 1 strict per-section parallel + cycle 2 edge-
# probe + a single phase4-prioritise-author subagent at the end. The
# author writes journey-map.md with a line-1 sentinel —
# `<!-- journey-mapping:generated -->` — that downstream consumers
# (`test-composer`, `coverage-expansion`) use as the single source of
# truth for "this map was actually produced by the skill, not hand-
# rolled in orchestrator context."
#
# Markdown-text contract enforcement alone has been observed to permit
# silent scope compression: an orchestrator with the
# .discovery-draft.json already in hand can produce a plausible-looking
# journey map directly via the Write tool, skipping the cycles + the
# fresh-eyes discovery property the protocol was designed to ensure.
# This hook is the harness-level guard at the only mutation point.
#
# What it gates
# -------------
# 1. **Sentinel on journey-map.md.** Any write to
#    `tests/e2e/docs/journey-map.md` whose proposed content does not
#    begin with `<!-- journey-mapping:generated -->` (line 1, exact
#    match) is DENIED. The sentinel can only legitimately be written
#    by the journey-mapping skill's author step.
# 2. **Cycle-state preflight.** A first write to journey-map.md
#    requires `tests/e2e/docs/.phase4-cycle-state.json` to exist AND
#    contain at minimum one cycle-1 section dispatch in
#    `cycles."1".dispatched-sections`. No cycle ever ran ⇒ no map
#    can be authored.
# 3. **Coverage-matrix companion.** Writes to
#    `tests/e2e/docs/journey-map-coverage.md` are allowed only when
#    journey-map.md already exists with the sentinel — the matrix is
#    derivative; without the map it is fabricated state.
# 4. **Silent-allow for non-Phase-4 paths.** Files whose path doesn't
#    end with one of the two Phase-4 deliverables silent-allow.
# 5. **Silent-allow on Edit when the existing file already carries the
#    sentinel.** The journey-mapping skill writes the file via Write
#    once; subsequent Edit calls (e.g. to fix a typo, append a
#    journey, adjust priority) are surface-level edits, not
#    authorship. The sentinel is the authorship signal — its
#    pre-existence implies a legitimate author already ran.
#
# Canonical reference
# -------------------
# methodology/skills/journey-mapping/SKILL.md §"Recognizing a previously-generated
#                                   journey map"
# methodology/skills/onboarding/SKILL.md §"Phase 4 — Journey mapping"
#
# Failure → action
# ----------------
# Missing sentinel on Write       → DENY pointing at journey-mapping skill
# Missing cycle-state             → DENY naming the missing precondition
# Coverage-matrix before map      → DENY pointing at the ordering rule

set -uo pipefail

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH." >&2
  exit 1
fi

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")

case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // empty' 2>/dev/null || echo "")

# Rule 4: silent-allow for non-Phase-4 paths.
IS_MAP=0
IS_COVERAGE=0
case "$FILE_PATH" in
  */tests/e2e/docs/journey-map.md)          IS_MAP=1 ;;
  */tests/e2e/docs/journey-map-coverage.md) IS_COVERAGE=1 ;;
  *) exit 0 ;;
esac

# Resolve the project root (the parent of tests/e2e/docs/).
case "$FILE_PATH" in
  */tests/e2e/docs/journey-map.md)
    PROJECT_ROOT="${FILE_PATH%/tests/e2e/docs/journey-map.md}" ;;
  */tests/e2e/docs/journey-map-coverage.md)
    PROJECT_ROOT="${FILE_PATH%/tests/e2e/docs/journey-map-coverage.md}" ;;
esac

MAP_PATH="$PROJECT_ROOT/tests/e2e/docs/journey-map.md"
CYCLE_STATE_PATH="$PROJECT_ROOT/tests/e2e/docs/.phase4-cycle-state.json"

# Helper: emit a DENY decision. The hook framework reads decisions from
# `hookSpecificOutput.permissionDecision` (PreToolUse contract).
emit_deny() {
  local reason="$1"
  "$JQ" -n --arg r "$reason" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
  exit 0
}

# --- Coverage matrix rule (Rule 3) ---
if [ "$IS_COVERAGE" -eq 1 ]; then
  if [ ! -f "$MAP_PATH" ]; then
    emit_deny "journey-map-coverage.md may only be written after journey-map.md exists. The coverage matrix is derivative — it maps every entry in journey-map.md to a spec (or <missing>) — so authoring it without an existing map is fabricated state.

Fix: invoke the journey-mapping skill first. It runs the cycle protocol and writes both files in order.

See: methodology/skills/onboarding/SKILL.md §\"Phase 4 — Journey mapping\""
  fi
  # Check that the existing map has the sentinel — if not, the map is also forged.
  FIRST_LINE=$(head -n 1 "$MAP_PATH" 2>/dev/null || echo "")
  if [ "$FIRST_LINE" != "<!-- journey-mapping:generated -->" ]; then
    emit_deny "journey-map-coverage.md write blocked: the existing journey-map.md is missing the sentinel \`<!-- journey-mapping:generated -->\` on line 1.

The sentinel is the single source of truth that the journey-mapping skill (rather than an orchestrator) produced the map. Writing a coverage matrix against a sentinel-less map propagates the forgery.

Fix: invoke the journey-mapping skill to regenerate journey-map.md, then re-issue the coverage matrix write.

See: methodology/skills/journey-mapping/SKILL.md §\"Recognizing a previously-generated journey map\""
  fi
  exit 0
fi

# --- journey-map.md path (Rule 1, 2, 5) ---

# Rule 5: silent-allow Edit when the existing map already has the sentinel.
# The sentinel is the authorship signal; once present, downstream edits
# don't claim authorship.
if [ "$TOOL_NAME" = "Edit" ] && [ -f "$MAP_PATH" ]; then
  FIRST_LINE=$(head -n 1 "$MAP_PATH" 2>/dev/null || echo "")
  if [ "$FIRST_LINE" = "<!-- journey-mapping:generated -->" ]; then
    exit 0
  fi
fi

# Extract the proposed content. Write uses .tool_input.content;
# Edit uses .tool_input.new_string (the post-edit content of the
# matched region). For Edit on a file that doesn't yet have the
# sentinel, we treat the proposal as if it were authoring — both
# branches require the sentinel.
CONTENT=$(echo "$INPUT" | "$JQ" -r '.tool_input.content // .tool_input.new_string // empty' 2>/dev/null || echo "")

# Rule 1: sentinel required on the FIRST line.
FIRST_LINE_PROPOSED=$(echo "$CONTENT" | head -n 1)
if [ "$FIRST_LINE_PROPOSED" != "<!-- journey-mapping:generated -->" ]; then
  emit_deny "journey-map.md write blocked: line 1 must be the literal sentinel \`<!-- journey-mapping:generated -->\`. Got: \"${FIRST_LINE_PROPOSED:0:80}\"

The sentinel is the single source of truth for authorship — the journey-mapping skill writes it; orchestrator-direct authoring should not.

Fix: invoke the journey-mapping skill via the Skill tool. It runs the iterative discovery cycle protocol (cycle 1 strict per-section parallel + cycle 2 edge-probe) and authors the map with the sentinel.

See: methodology/skills/journey-mapping/SKILL.md §\"Recognizing a previously-generated journey map\"
See: methodology/skills/onboarding/SKILL.md §\"Phase 4 — Journey mapping\""
fi

# Rule 2: cycle-state must exist and show at least one cycle-1 dispatch.
if [ ! -f "$CYCLE_STATE_PATH" ]; then
  emit_deny "journey-map.md write blocked: tests/e2e/docs/.phase4-cycle-state.json does not exist.

The journey-mapping skill writes the cycle state file as it dispatches per-section subagents in cycle 1. Absence of the state file means no cycle ever ran — the map cannot legitimately exist.

Fix: invoke the journey-mapping skill. It writes the state file in step 1 and the map in the final author step.

See: methodology/skills/journey-mapping/SKILL.md §\"Cycle protocol\""
fi

# Verify cycle-1 has at least one dispatched section. Fewer than 1 means
# the state file is a stub; the author step needs cycle-1 sections to
# even begin.
CYCLE_1_SECTIONS=$(
  "$JQ" -r '.cycles["1"]["dispatched-sections"] // [] | length' \
    "$CYCLE_STATE_PATH" 2>/dev/null || echo "0"
)
if ! [[ "$CYCLE_1_SECTIONS" =~ ^[0-9]+$ ]] || [ "$CYCLE_1_SECTIONS" -lt 1 ]; then
  emit_deny "journey-map.md write blocked: .phase4-cycle-state.json reports 0 cycle-1 section dispatches.

Cycle 1 (discovery) is the strict per-section parallel wave the journey-mapping skill uses to establish the section baseline. Without at least one section dispatched + returned, there is no per-section content for the author step to consume.

Fix: dispatch the cycle-1 section agents via the journey-mapping skill before attempting to author the map.

See: methodology/skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\""
fi

exit 0
