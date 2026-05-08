#!/bin/bash
# skill-subagent-only-guard.sh — block orchestrator from explicitly invoking
#                                subagent-only skills via the Skill tool
#
# Hook    : PreToolUse:Skill
# Mode    : DENY
# State   : none
# Env     : SUBAGENT_ONLY_SKILLS_TEST_FORCE_CONTEXT=orchestrator|subagent
#           (test-only override; ignored in production runs)
#
# Rule
# ----
# A small set of skills are reserved for subagent context only — they carry
# methodology that should NOT contaminate the orchestrator's working memory:
#
#   - failure-diagnosis           (full diagnostic protocol; loaded by
#                                  subagents that observe a test failure)
#   - contributing-to-element-interactions
#                                 (full contribution methodology; loaded by
#                                  the contribution-handover subagent)
#
# Their reference docs (e.g. niche-edge-cases.md under failure-diagnosis)
# inherit the same restriction transitively because reference docs are only
# loaded by their parent skill.
#
# The orchestrator's job is to ROUTE: detect the situation, dispatch a
# subagent, and let the subagent load the relevant skill. If the orchestrator
# itself loads these skills inline, it pulls the entire methodology into the
# top-level transcript every cycle, which is exactly the contamination the
# parent-only-orchestrator doctrine exists to prevent.
#
# Why
# ---
# The orchestrator's transcript is the single most expensive piece of context
# in any run — it persists across every dispatch and every retry. Skills like
# failure-diagnosis carry hundreds of lines of triage methodology, and the
# niche-edge-cases catalogue grows over time. When the orchestrator invokes
# these directly, that body lands in the orchestrator transcript and is
# replayed on every subsequent turn until the conversation compacts. The
# methodology is correct; the location is wrong. Subagents are the right
# location: their context is short-lived, single-purpose, and disposed once
# they return.
#
# Detection
# ---------
# Subagent context is detected via, in order:
#   1. SUBAGENT_ONLY_SKILLS_TEST_FORCE_CONTEXT env var (tests only)
#   2. Hook input field `parent_tool_use_id` non-empty       → subagent
#   3. Hook input field `agent_id` non-empty                 → subagent
#   4. Hook input field `transcript_path` matches `/agents/` → subagent
#   5. Hook input field `transcript_path` matches `/tasks/`  → subagent
#   6. cwd matches `.claude/worktrees/agent-`                → subagent
#   7. Otherwise                                             → orchestrator
#
# Failure → action
# ----------------
# - Skill name in subagent-only list AND context = orchestrator → DENY
# - Skill name in subagent-only list AND context = subagent     → silent allow
# - Skill name not in subagent-only list                        → silent allow
# - Tool is not Skill                                           → silent allow
#
# Canonical reference
# -------------------
# skills/failure-diagnosis/SKILL.md (frontmatter `subagent-only: true`)
# skills/contributing-to-element-interactions/SKILL.md (same)

set -euo pipefail

# Skills reserved for subagent context only. Keep this list in sync with the
# `subagent-only: true` frontmatter field on the corresponding SKILL.md files.
SUBAGENT_ONLY_SKILLS=(
  "failure-diagnosis"
  "contributing-to-element-interactions"
)

emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

[ "$TOOL_NAME" = "Skill" ] || exit 0

# Skill tool input shape: { skill: "<name>", args?: "..." }. The fully
# qualified plugin form is "<plugin>:<skill>" — strip the plugin prefix
# before comparing so consumers can ship the skill under any plugin namespace.
SKILL_RAW=$(echo "$INPUT" | jq -r '.tool_input.skill // empty' 2>/dev/null)
[ -n "$SKILL_RAW" ] || exit 0

SKILL_NAME="${SKILL_RAW##*:}"

# Is this skill in the subagent-only list?
IS_RESTRICTED=0
for s in "${SUBAGENT_ONLY_SKILLS[@]}"; do
  if [ "$s" = "$SKILL_NAME" ]; then
    IS_RESTRICTED=1
    break
  fi
done
[ "$IS_RESTRICTED" = "1" ] || exit 0

# Detect orchestrator-vs-subagent context.
detect_context() {
  if [ -n "${SUBAGENT_ONLY_SKILLS_TEST_FORCE_CONTEXT:-}" ]; then
    echo "$SUBAGENT_ONLY_SKILLS_TEST_FORCE_CONTEXT"
    return
  fi

  local parent_tool_use_id agent_id transcript_path cwd
  parent_tool_use_id=$(echo "$INPUT" | jq -r '.parent_tool_use_id // empty' 2>/dev/null)
  agent_id=$(echo "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null)
  transcript_path=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
  cwd=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

  if [ -n "$parent_tool_use_id" ] || [ -n "$agent_id" ]; then
    echo "subagent"
    return
  fi
  case "$transcript_path" in
    */agents/*|*/tasks/*) echo "subagent"; return ;;
  esac
  case "$cwd" in
    */.claude/worktrees/agent-*) echo "subagent"; return ;;
  esac
  echo "orchestrator"
}

CONTEXT=$(detect_context)

if [ "$CONTEXT" = "subagent" ]; then
  exit 0
fi

REASON_TEMPLATE='[skill-subagent-only-guard] Refused to load subagent-only skill in orchestrator context.

Skill: __SKILL__
Context: orchestrator (no parent_tool_use_id / agent_id signal, transcript_path outside subagent paths)

Why
---
This skill carries methodology that contaminates the orchestrators working memory if loaded inline. The parent-only-orchestrator doctrine reserves it for subagent context: route detect-the-situation work in the orchestrator, but dispatch a subagent for the actual diagnostic / contribution work.

How to apply
------------
- failure-diagnosis: dispatch a subagent (e.g. "composer-<j-slug>: diagnose the failure in tests/e2e/<spec>.spec.ts") and let it invoke this skill.
- contributing-to-element-interactions: dispatch a subagent ("contribution-handover: extend Steps with <method>") and let it invoke this skill.

Reference: hooks/skill-subagent-only-guard.sh ; skills/<skill>/SKILL.md frontmatter subagent-only: true.'

REASON="${REASON_TEMPLATE//__SKILL__/$SKILL_NAME}"

emit_deny "$REASON"
exit 0
