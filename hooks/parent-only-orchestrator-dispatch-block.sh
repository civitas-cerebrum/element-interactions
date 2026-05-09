#!/bin/bash
# parent-only-orchestrator-dispatch-block.sh — deny dispatching parent-only
# orchestrator skills as a subagent.
#
# Hook    : PreToolUse:Agent
# Mode    : DENY
# State   : none
# Env     : POO_DISPATCH_BLOCK=off → silent allow (manual escape hatch)
#
# Rule
# ----
# Some skills in this suite are documented as **parent-only orchestrators**:
# they fan out test-composer / reviewer / probe / process-validator
# subagents per journey via the Agent tool. The Agent / Task tool is
# parent-only in this environment — a subagent that tries to fan out hits
# a hard wall (`'no Agent / Task tool available in my toolset'`). This
# hook denies any Agent dispatch that asks the subagent to *be* an
# orchestrator instead of *being* a leaf.
#
# Allowlisted parent-only orchestrators (DENY when subagent is asked to
# act as one of these):
#
#   - coverage-expansion (mode: depth or breadth)
#   - onboarding         (Phase 5 / 6 inline orchestration claims)
#   - bug-discovery      (app-wide scope: Phase 1a / 1b / flow-probing /
#                         element-probing — multi-journey fan-out)
#
# Leaf-shape dispatches (ALWAYS ALLOW): descriptions starting with one of
# the recognized role prefixes are leaf work and pass through:
#
#   composer-, reviewer-, probe-, process-validator-, phase-validator-,
#   phase1-, phase2-, stage2-, cleanup-, [P3-batch]
#
# Why
# ---
# An orchestrator-shape dispatch wastes a full subagent budget for no
# useful output: the subagent runs, attempts its first per-journey
# dispatch, hits the recursive-dispatch wall, returns
# `blocked-dispatch-failure: structural`. The orchestrator (parent) then
# has to drop down a level and dispatch leaves directly — burning one
# subagent's worth of tokens + wall-clock time for nothing. Catching at
# the dispatch boundary is mechanical and free.
#
# The cost asymmetry favours false positives: a denied legitimate
# dispatch is "rephrase and retry"; a false allow is the wasted-subagent
# failure mode this hook documents (issue #154).
#
# Canonical reference
# -------------------
# skills/coverage-expansion/SKILL.md §"Recursive dispatch is impossible"
# skills/onboarding/references/phases-walkthrough.md §"Phase 5"
# skills/bug-discovery/SKILL.md §"Invocation scope — standalone vs journey-scoped"
# Issue: civitas-cerebrum/element-interactions#154
#
# Failure → action
# ----------------
# - Subagent asked to act as coverage-expansion orchestrator     → DENY
# - Subagent asked to act as onboarding orchestrator              → DENY
# - Subagent asked to run bug-discovery at app-wide / multi-
#   journey scope                                                  → DENY
# - Description has a recognized leaf role prefix                  → silent allow
# - Description / prompt is leaf-shaped (single-journey scope)     → silent allow
# - Anything else                                                  → silent allow

set -euo pipefail

# Resolve jq: prefer the binary bundled with the hook install, fall back to
# system jq for in-repo testing before postinstall has run.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

if [ "${POO_DISPATCH_BLOCK:-on}" = "off" ]; then
  exit 0
fi

# Shared no-skip messaging library.
# shellcheck source=lib/no-skip-messaging.sh
HOOK_LIB_DIR="$(dirname "${BASH_SOURCE[0]}")/lib"
if [ -f "$HOOK_LIB_DIR/no-skip-messaging.sh" ]; then
  source "$HOOK_LIB_DIR/no-skip-messaging.sh"
else
  no_skip_messaging_block() { echo ""; }
fi

emit_deny() {
  local reason="$1
$(no_skip_messaging_block)"
  "$JQ" -n --arg r "$reason" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')
[ "$TOOL_NAME" = "Agent" ] || exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""')
PROMPT=$(echo "$INPUT" | "$JQ" -r '.tool_input.prompt // ""')
[ -z "$PROMPT" ] && [ -z "$DESCRIPTION" ] && exit 0

# --- leaf-prefix bypass -----------------------------------------------------
# A leaf role prefix is the canonical signal that this dispatch is a leaf.
# Recognized prefixes mirror the dispatch-guard's allowlist — keep these
# lists in sync if either changes. Currently allowed leaves:
#   composer-* | reviewer-* | probe-* | process-validator-* | phase-validator-*
#   phase1-* | phase2-* | stage2-* | cleanup-*
#   phase4-cycle-<N>-section-<id> | phase4-prioritise-author*  (iterative
#     discovery cycles — added when the iterative-cycle protocol landed;
#     these are leaf-shape per-section / per-author-step dispatches, not
#     orchestrator-shape)
#   [P3-batch] composer-j-...,...   (P3 batch — the only batched-dispatch form)
#   [group] composer-j-...,... | [group] probe-j-...,...   (relevance group;
#     compositional or bug-discovery, capped per dispatch-guard)
case "$DESCRIPTION" in
  composer-*|reviewer-*|probe-*|process-validator-*|phase-validator-*) exit 0 ;;
  phase1-*|phase2-*|stage2-*|cleanup-*) exit 0 ;;
  phase4-cycle-*-section-*|phase4-prioritise-author*) exit 0 ;;
  \[P3-batch\]*) exit 0 ;;
  \[group\]*) exit 0 ;;
esac

# --- detection: which orchestrator? -----------------------------------------
# Walk the allowlist. For each, check whether the prompt asks the subagent
# to act as that orchestrator. The first match wins (one DENY message
# names the specific orchestrator + redirect path).

ORCHESTRATOR=""
TRIGGER=""

# coverage-expansion ---------------------------------------------------------
# Detection: orchestrator-role language alone (per PR #162 review #2). The
# prior AND-gate that required a literal "skill"/"SKILL.md" word produced a
# false negative on the canonical wasted-subagent shape (`description: "Phase 5"`,
# `prompt: "You are the coverage-expansion orchestrator. Run mode: depth..."`)
# — no "skill" token, no DENY, wasted dispatch fires. The orchestrator-role
# regex below is specific enough; legitimate leaf briefs are caught by the
# leaf-prefix bypass above (cost asymmetry favours false positives over the
# wasted-subagent failure mode the hook exists to prevent).
if echo "$PROMPT" | grep -qiE '\bcoverage-expansion\b.{0,80}(orchestrator|owner)|you are .{0,50}coverage-expansion|fan out .{0,40}(test-composer|composer|reviewer|probe).{0,40}per[ -]?journey|dispatch .{0,40}(per journey|per-journey).{0,80}\bcoverage-expansion\b|\bcoverage-expansion\b.{0,40}mode:[[:space:]]*(depth|breadth)|mode:[[:space:]]*(depth|breadth).{0,40}\bcoverage-expansion\b|five[[:space:]]*passes.{0,80}\bcoverage-expansion\b|\bcoverage-expansion\b.{0,80}five[[:space:]]*passes|3 compositional .{0,40}2 adversarial'; then
  ORCHESTRATOR="coverage-expansion"
  TRIGGER="prompt mentions \`coverage-expansion\` + orchestrator-role language (mode: depth/breadth, 'fan out per journey', 'you are the orchestrator', 'five passes', etc.) — the literal word 'skill'/'SKILL.md' is no longer required"
fi

# onboarding (Phase 5/6 inline orchestration) --------------------------------
# Same shape as cov-exp — drop the literal "skill"/"SKILL.md" requirement
# and rely on orchestrator-role language (PR #162 review #2). Onboarding's
# docs are explicit that a sub-dispatch claiming to "execute the onboarding
# skill" hits the same recursive wall.
if [ -z "$ORCHESTRATOR" ] && echo "$PROMPT" | grep -qiE '\bonboarding\b.{0,80}orchestrator|you are .{0,50}onboarding.{0,40}(orchestrator|pipeline)|run the .{0,40}onboarding pipeline|onboarding .{0,40}(seven|7)[[:space:]-]?phase|\bonboarding\b.{0,80}Phase 5 .{0,40}coverage-expansion|\bonboarding\b.{0,80}Phase 6 .{0,40}bug-discovery'; then
  ORCHESTRATOR="onboarding"
  TRIGGER="prompt mentions \`onboarding\` + pipeline-orchestration language ('seven-phase pipeline', 'you are the onboarding orchestrator', 'Phase 5 coverage-expansion', 'Phase 6 bug-discovery')"
fi

# bug-discovery (app-wide scope) --------------------------------------------
# Per-journey bug-discovery dispatches use probe- prefix and are caught by
# the leaf-prefix bypass above. This branch only fires for app-wide /
# multi-journey scope language. If the prompt is explicitly scoped to a
# single journey (e.g. "for journey j-X", "you are probing j-X"), we treat
# the dispatch as leaf-shape and allow it through — protects against
# accidental denial when a single-journey probe was dispatched without the
# probe- prefix by mistake.
if [ -z "$ORCHESTRATOR" ] && echo "$PROMPT" | grep -qE '\bbug-discovery\b'; then
  if echo "$PROMPT" | grep -qiE 'Phase 1a|Phase 1b|flow-probing|element-probing|app-wide|standalone bug-discovery|you are .{0,50}bug-discovery|bug-discovery orchestrator|fan out .{0,40}probe'; then
    if echo "$PROMPT" | grep -qiE 'for journey j-|you are probing j-|covering j-|single journey'; then
      :  # leaf-shape — allow
    else
      ORCHESTRATOR="bug-discovery"
      TRIGGER="prompt mentions \`bug-discovery\` skill at app-wide / multi-journey scope (Phase 1a/1b, flow-probing, element-probing, standalone). Per-journey adversarial probes should dispatch under a \`probe-j-<slug>:\` description prefix instead."
    fi
  fi
fi

# Not an orchestrator-shape dispatch → silent allow.
[ -z "$ORCHESTRATOR" ] && exit 0

# --- emit deny --------------------------------------------------------------
# Produce a redirect that's mechanical: read the SKILL.md INTO the parent's
# context, then dispatch the appropriate leaf-shape subagents directly.

case "$ORCHESTRATOR" in
  coverage-expansion)
    REDIRECT="Read \`skills/coverage-expansion/SKILL.md\` INTO your own (parent) context. Then dispatch \`test-composer\` / \`bug-discovery\` (leaf, per-journey) / \`reviewer\` / \`probe\` subagents per journey directly under the canonical role prefixes (composer-j-<slug>:, reviewer-j-<slug>:, probe-j-<slug>:). One Agent call per journey, parallel where the independence graph permits."
    REFS="  skills/coverage-expansion/SKILL.md §\"Recursive dispatch is impossible\"
  skills/coverage-expansion/SKILL.md §\"Stage A per-journey dispatch is non-negotiable\"
  hooks/coverage-expansion-dispatch-guard.sh (the per-leaf gate)"
    ;;
  onboarding)
    REDIRECT="Read \`skills/onboarding/SKILL.md\` and \`skills/onboarding/references/phases-walkthrough.md\` INTO your own (parent) context. Then run the seven phases yourself, dispatching only leaf-shape subagents per phase: phase1-/phase2- for early scaffold/discovery, composer-/reviewer-/probe- per journey for Phase 5, etc."
    REFS="  skills/onboarding/SKILL.md §\"Front-load gate\"
  skills/onboarding/references/phases-walkthrough.md
  skills/coverage-expansion/SKILL.md §\"Recursive dispatch is impossible\""
    ;;
  bug-discovery)
    REDIRECT="Read \`skills/bug-discovery/SKILL.md\` INTO your own (parent) context. For app-wide / multi-journey adversarial work, iterate journeys yourself and dispatch one \`probe-j-<slug>:\` Agent call per journey. For single-journey adversarial probes within a coverage-expansion pass, the dispatch is already leaf-shaped under the probe- prefix and bypasses this hook."
    REFS="  skills/bug-discovery/SKILL.md §\"Invocation scope — standalone vs journey-scoped\"
  skills/coverage-expansion/SKILL.md §\"Recursive dispatch is impossible\""
    ;;
esac

emit_deny "[BLOCKED] Dispatching the parent-only \`${ORCHESTRATOR}\` orchestrator as a subagent.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

${REDIRECT}

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
description: ${DESCRIPTION:-<empty>}
trigger:     ${TRIGGER}

The Agent / Task tool is parent-only in this environment. A subagent that tries to fan out hits a hard wall (\`'no Agent / Task tool available in my toolset'\`). The dispatch you tried would have run for ~minutes, consumed ~tens-of-thousands of tokens, and returned \`blocked-dispatch-failure: structural\` — for nothing. The recursive-dispatch wall is an environment constraint, not a contract any skill can amend.

──────────────────────────────────────────────────────────────────
If 'I want to keep my context clean by delegating' — read this:
──────────────────────────────────────────────────────────────────
The orchestrator's context is the *only* context that can fan out. Reading SKILL.md into the parent isn't pollution — it's the orchestrator's job. The leaf subagents (composer-/reviewer-/probe-) are where context-isolation buys you something; the orchestrator layer above them stays at index-level state and dispatches per journey.

References:
${REFS}

Escape hatch (rare, only when the dispatch is mislabelled and is actually leaf-shaped): set POO_DISPATCH_BLOCK=off in the environment for this invocation."
exit 0
