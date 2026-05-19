#!/bin/bash
# journey-mapping-skill-preread-gate.sh — Phase-4 skill-preread gate.
#                                         Denies writes to journey-map.md /
#                                         Agent dispatches for phase4-* /
#                                         phase4-prioritise-author: when
#                                         the orchestrator hasn't loaded
#                                         the journey-mapping skill in
#                                         this session.
#
# Hook    : PreToolUse:Write|Edit + PreToolUse:Agent (same script,
#           registered against both events in HOOK_MANIFEST)
# Mode    : DENY
# State   : reads the session transcript at `transcript_path` from the
#           hook input — checks for any Skill('journey-mapping') tool
#           use OR Read of `skills/journey-mapping/SKILL.md` (in any
#           location: bundled package, project-local copy, ~/.claude/).
# Env     : JOURNEY_MAPPING_PREREAD_GATE=off  bypass for special-cased
#           re-dispatches (advisory; document the bypass authorisation)
#
# Why
# ---
# A separate gate from journey-map-sentinel-gate. The sentinel gate
# verifies the artifacts exist (sentinel + cycle-state). This gate
# verifies the orchestrator has actually loaded the methodology — a
# session that has never Skill-invoked journey-mapping cannot have
# faithfully followed its iterative-cycle protocol, regardless of what
# artifacts happen to be on disk.
#
# The skill is heavy (~4k words). Loading it into context is the
# strongest signal that the orchestrator has read the rules. Without
# this gate, a capable orchestrator with the discovery-draft in hand
# can dispatch phase4-cycle-*: subagents and write the journey map
# entirely from in-context inference — passing the sentinel gate by
# emitting the right line-1 marker without ever consulting the
# methodology document.
#
# What it gates
# -------------
# Two trigger surfaces — same skill-preread check applied to both:
#
# 1. **Writes to journey-map.md / journey-map-coverage.md**
#    (PreToolUse:Write|Edit). The orchestrator must have invoked the
#    Skill tool with `skill=journey-mapping` OR Read the skill file
#    (`skills/journey-mapping/SKILL.md`) in this session.
#
# 2. **Agent dispatches with phase-4 role prefixes**
#    (PreToolUse:Agent). Same check — orchestrator must have loaded
#    the skill before dispatching cycle-1 / cycle-2 section agents or
#    the prioritise-author subagent. Forbidden prefixes:
#      - phase4-cycle-<N>-section-<id>:
#      - phase4-cycle-<N>-edge-probe:
#      - phase4-prioritise-author:
#
# Silent-allow when:
# - transcript_path is missing (harness didn't supply it — fail open)
# - JOURNEY_MAPPING_PREREAD_GATE=off
# - Tool isn't one of the gated surfaces above
# - File path / dispatch description doesn't match the trigger pattern
#
# Failure → action
# ----------------
# Write/Edit on journey-map.md without preread        → DENY
# Agent dispatch with phase4-* prefix without preread → DENY

set -uo pipefail

# Bypass switch.
if [ "${JOURNEY_MAPPING_PREREAD_GATE:-on}" = "off" ]; then
  exit 0
fi

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH." >&2
  exit 1
fi

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")

# Branch by event. Only act on the gated surfaces. Three Write/Edit
# patterns, distinguished by TRIGGER_KIND so the deny message matches
# the caller:
#   write          — orchestrator-side journey-map.md / coverage matrix
#   subagent-spill — section subagent's spill file under
#                    tests/e2e/docs/.subagent-returns/phase4-*
#   dispatch       — Agent dispatch with phase4-* prefix
case "$TOOL_NAME" in
  Write|Edit)
    FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
    case "$FILE_PATH" in
      */tests/e2e/docs/journey-map.md|*/tests/e2e/docs/journey-map-coverage.md)
        TRIGGER_KIND="write"
        ;;
      */tests/e2e/docs/.subagent-returns/phase4-cycle-*-section-*.md|\
      */tests/e2e/docs/.subagent-returns/phase4-cycle-*-edge-probe.md|\
      */tests/e2e/docs/.subagent-returns/phase4-prioritise-author.md)
        TRIGGER_KIND="subagent-spill"
        ;;
      *) exit 0 ;;
    esac
    TRIGGER_TARGET="$FILE_PATH"
    ;;
  Agent)
    DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""' 2>/dev/null || echo "")
    case "$DESCRIPTION" in
      phase4-cycle-*|phase4-prioritise-author*) ;;
      *) exit 0 ;;
    esac
    TRIGGER_KIND="dispatch"
    TRIGGER_TARGET="$DESCRIPTION"
    ;;
  *) exit 0 ;;
esac

# Locate the transcript. Hook input is supposed to carry this; if it
# isn't there (older harness, test fixtures), fail open — the sentinel
# gate is still in front of us.
TRANSCRIPT_PATH=$(echo "$INPUT" | "$JQ" -r '.transcript_path // empty' 2>/dev/null || echo "")
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  exit 0
fi

# Scan the transcript for evidence the orchestrator has loaded the
# journey-mapping skill. Two acceptable signals:
#   1. A Skill tool use with input.skill == "journey-mapping" (any
#      plugin prefix accepted — the harness stores skill names verbatim).
#   2. A Read tool use whose file_path resolves to
#      `skills/journey-mapping/SKILL.md` (any prefix — bundled package
#      under node_modules/, project-local copy, or user-wide install
#      under ~/.claude/skills/).
#
# Walks every assistant/tool-use message in the JSONL. If any line
# matches either signal, the preread is satisfied.
PREREAD_FOUND=$(
  "$JQ" -r '
    if (.message? | type) == "object" and (.message.content? | type) == "array" then
      .message.content[] |
        select(.type? == "tool_use") |
        (
          (select(.name? == "Skill") | (.input.skill // "") ),
          (select(.name? == "Read")  | (.input.file_path // "") )
        )
    else empty end
  ' "$TRANSCRIPT_PATH" 2>/dev/null \
    | grep -E '(^|/)journey-mapping(:|$)|skills/journey-mapping/SKILL\.md' \
    | head -1 || true
)

if [ -n "$PREREAD_FOUND" ]; then
  exit 0
fi

# Construct the deny reason. The wording differs by trigger so the
# remediation pointer matches.
case "$TRIGGER_KIND" in
  write)
    REASON="[BLOCKED] Write to ${TRIGGER_TARGET} requires the journey-mapping skill to have been loaded in this session.

The journey-mapping skill defines the iterative discovery cycle protocol (cycle 1 strict per-section parallel + cycle 2 edge-probe + author step) that this file is the output of. A session that has never invoked the skill cannot have faithfully followed the protocol, regardless of what the proposed content looks like.

Fix: invoke the journey-mapping skill via the Skill tool BEFORE writing this file. The skill body lays out the cycle protocol the orchestrator must dispatch.

Alternative: if the orchestrator just needs to reference the rules (e.g. fix a typo in an already-generated map), Read \`skills/journey-mapping/SKILL.md\` first — that's also accepted as preread evidence.

Bypass (advisory only — document the authorisation): set \`JOURNEY_MAPPING_PREREAD_GATE=off\` in the harness environment.

See: skills/onboarding/SKILL.md §\"Phase 4 — Journey mapping\""
    ;;
  subagent-spill)
    REASON="[BLOCKED] Subagent spill write to ${TRIGGER_TARGET} requires this subagent to have loaded the journey-mapping skill before writing.

Section / edge-probe / author subagents implement the journey-mapping skill's cycle protocol. The orchestrator's dispatch brief should have instructed this subagent to invoke \`Skill('journey-mapping')\` (or Read \`skills/journey-mapping/SKILL.md\`) before doing any work — the protocol's per-section discovery contract, the spill schema, and the return-shape expectations all live in the skill body.

Fix (in the subagent): invoke the journey-mapping skill via the Skill tool, OR Read the skill file, BEFORE writing this spill.

Fix (in the orchestrator's next dispatch): cite \`skills/journey-mapping/SKILL.md\` in the subagent brief so the subagent knows to load it.

Bypass (advisory only — document the authorisation): set \`JOURNEY_MAPPING_PREREAD_GATE=off\` in the subagent's environment.

See: skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\""
    ;;
  *)
    REASON="[BLOCKED] Agent dispatch \`${TRIGGER_TARGET}\` requires the journey-mapping skill to have been loaded in this session.

Phase-4 dispatches (cycle-N section agents, edge-probe, prioritise-author) implement the journey-mapping skill's cycle protocol. The dispatching orchestrator must have read the skill body before delegating — without it, the briefs are constructed from in-context inference and the cycle-strictness contract is silently weakened.

Fix: invoke the journey-mapping skill via the Skill tool BEFORE dispatching the cycle subagents.

Bypass (advisory only — document the authorisation): set \`JOURNEY_MAPPING_PREREAD_GATE=off\` in the harness environment.

See: skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\"
See: skills/onboarding/SKILL.md §\"Phase 4 — Journey mapping\""
    ;;
esac

"$JQ" -n --arg r "$REASON" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": $r
  }
}'
exit 0
