#!/bin/bash
# coverage-expansion-dispatch-guard.sh — per-subagent dispatch contract gate
#
# Hook    : PreToolUse:Agent
# Mode    : DENY (anti-patterns A/C/D) + WARN (anti-pattern B for non-strict prefixes) + DENY (anti-pattern B for strict prefixes per issue #132)
# State   : none
# Env     : none
#
# Rule
# ----
# Every Agent dispatch under coverage-expansion / journey-mapping work must:
#   1. Have a description starting with a role-explicit prefix (composer-,
#      reviewer-, probe-, process-validator-, phase1-, phase2-, stage2-,
#      cleanup-, or [P3-batch] composer-...). Bare j- and sj- prefixes are
#      role-ambiguous and denied (issue #126).
#   2. Not ask the subagent to recursively dispatch sub-subagents (anti-
#      pattern A — the Agent tool is parent-only in this environment).
#   3. Not contain orchestrator meta-content ("depth mode", "5-pass
#      pipeline", "Pass 4/5", etc.) in the brief — DENY for strict role
#      prefixes (composer/reviewer/probe), WARN for transitional prefixes
#      (issue #132).
#   4. Not be a batched dispatch disguised as a single-journey call —
#      prompts referencing 2+ distinct j-<slug> IDs without a [P3-batch]
#      description prefix are denied.
#
# Why
# ---
# The role prefix is the routing key for the downstream return-schema
# validator (hooks/subagent-return-schema-guard.sh). Without an unambiguous
# role, the validator can't map description → expected return shape. The
# anti-batching rules prevent the failure mode where one composer rations
# attention across N siblings and skips Test-expectations bullets, surfacing
# as Stage B improvements-needed across the batch.
#
# Canonical reference
# -------------------
# skills/coverage-expansion/SKILL.md §"Stage A per-journey dispatch is
#   non-negotiable" + §"Role prefixes" + §"Recursive dispatch is impossible"
# skills/coverage-expansion/references/process-validator-workflow.md
#
# Recognized role prefixes (subagent ID ↔ CLI slug — see playwright-cli-isolation-guard.sh)
# -----------------------------------------------------------------------------------------
#   composer-j-<slug>: / composer-sj-<slug>: → composer-j-<slug>-<pass>-c<N>
#   reviewer-j-<slug>: / reviewer-sj-<slug>: → reviewer-j-<slug>-<pass>-c<N>
#   probe-j-<slug>:                          → probe-j-<slug>-<pass>
#   process-validator-<scope>:               → (no CLI session)
#   phase1-<entry>:                          → phase1-<entry>
#   phase2-<scope>:                          → phase2-<scope>
#   stage2-<scenario>:                       → stage2-<scenario>
#   cleanup-<scope>:                         → cleanup-<scope>
#   [P3-batch] composer-<slug>,...:          → per-item slug (cap 7, P3 only)
#
# Failure → action
# ----------------
# - Subagent fan-out anti-pattern (A)               → DENY
# - Orchestrator meta-content + strict prefix (B)   → DENY (issue #132)
# - Orchestrator meta-content + transitional prefix → WARN (systemMessage)
# - Bare j- / sj- description prefix (C)            → DENY (issue #126)
# - 2+ distinct j-<slug> IDs in prompt + non-role-prefixed description (D) → DENY
# - All other Agent dispatches                      → silent allow

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

emit_warn() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // ""')
PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // ""')

# Allowed description prefixes (single-journey scope, plus process-validator).
# process-validator-<scope>: dispatched by the parent orchestrator BEFORE a
# wave of composer/reviewer/probe subagents to validate the planned dispatch
# manifest against the skill's contract. The validator returns greenlight or
# improvements-needed; only on greenlight does the parent fan out the wave.
#
# Bare `j-<slug>:` / `sj-<slug>:` were dropped per issue #126 — every
# journey-scoped dispatch must declare its role (composer / reviewer / probe).
# The role-prefix is the routing key for the downstream return-schema
# validator (hooks/subagent-return-schema-guard.sh).
ALLOWED_PREFIX_REGEX='^(phase1-[a-z0-9-]+|phase2-[a-z0-9-]+|stage2-[a-z0-9-]+|composer-[a-z0-9-]+|reviewer-[a-z0-9-]+|probe-[a-z0-9-]+|cleanup-[a-z0-9-]+|process-validator-[a-z0-9-]+|phase-validator-[a-z0-9-]+)(:|[[:space:]]|$)'

# P3 batch form: `[P3-batch] composer-j-a, composer-j-b, composer-j-c:`
# (cap 7 enforced via comma count). Allows optional whitespace after each
# comma for human-friendly listings. Items must be role-explicit composer-
# slugs — P3 batches are composer dispatches by definition.
P3_BATCH_REGEX='^\[P3-batch\][[:space:]]+composer-[a-z0-9-]+([[:space:]]*,[[:space:]]*composer-[a-z0-9-]+){0,6}([[:space:]]*:|[[:space:]]|$)'

DESCRIPTION_HAS_ROLE_PREFIX=false
if echo "$DESCRIPTION" | grep -qE "$ALLOWED_PREFIX_REGEX"; then
  DESCRIPTION_HAS_ROLE_PREFIX=true
elif echo "$DESCRIPTION" | grep -qE "$P3_BATCH_REGEX"; then
  DESCRIPTION_HAS_ROLE_PREFIX=true
fi

# === Anti-pattern A: subagent asking another subagent to fan-out =======
# Subagents CANNOT dispatch their own sub-subagents in this environment
# (the Agent / Task tool is parent-only). A prompt instructing a subagent
# to "dispatch N parallel subagents", "fan out", or to "use the Agent tool
# to spawn workers" is a methodology bug — the work either belongs to the
# parent (recursive dispatch impossible) or the prompt should ask the
# subagent to RETURN A MANIFEST the parent will dispatch from.
if echo "$PROMPT" | grep -qiE '(dispatch|spawn|fan[ -]?out|fire) [0-9]+ (parallel|sub|sub-?agents?|agents)|use (the )?Agent tool to (dispatch|spawn|fan)|you are .{0,20} dispatch (subagents|N parallel)'; then
  REASON_FANOUT="[BLOCKED] Subagent brief asks the subagent to dispatch sub-subagents.

Description: \"${DESCRIPTION}\"

Subagents in this environment CANNOT recursively dispatch other subagents — the Agent / Task tool is parent-only. A subagent that tries to fan out hits a hard wall (\"no Agent / Task tool available in my toolset\"). This is an environment limitation, not a contract.

Fix the methodology, not the prompt. Two valid patterns:
  (a) Parent dispatches the wave directly. The subagent does ONE focused job.
  (b) Sub-orchestrator pattern: this subagent PLANS the wave and RETURNS A
      MANIFEST (a structured list of N briefs). The parent reads the
      manifest and dispatches the wave. The sub-orchestrator never tries
      to fire its own children.

If you intended (b), reword the brief: ask the subagent to *return* a
dispatch plan, not to *execute* it. See coverage-expansion §\"Orchestrator
context discipline\" + §\"Recursive dispatch is impossible — plan, don't
fan out\"."
  emit_deny "$REASON_FANOUT"
  exit 0
fi

# === Anti-pattern B: orchestrator meta-content leak ===========================
# Composer / reviewer / probe / cleanup subagents should NOT receive pipeline
# meta-content (depth mode, 5-pass, Pass 4/5, etc.) — that belongs to the
# parent orchestrator's context only.
if [ "$DESCRIPTION_HAS_ROLE_PREFIX" = true ] && echo "$DESCRIPTION" | grep -qE '^(composer-|reviewer-|probe-|cleanup-|phase1-|phase2-|stage2-)'; then
  # `|| true` guards against set -e + pipefail: when no leak phrase matches,
  # grep -o returns 1 and the substitution would otherwise abort the script.
  LEAK=$(echo "$PROMPT" | grep -oiE 'depth mode|breadth mode|5-pass pipeline|5-pass|3 compositional|2 adversarial|pass(es)? [2-5]([[:space:]]|$|/|,|\.)|pipeline (orchestrator|stage|coordinator)|adversarial pass(es)?' | sort -u | head -5 | tr '\n' '|' | sed 's/|$//' || true)
  if [ -n "$LEAK" ]; then
    # === Strict role prefixes BLOCK on leak (issue #132) ================
    # composer / reviewer / probe briefs are the high-leverage dispatches —
    # a leaked "5-pass pipeline" reference here causes the subagent to
    # consult parts of the skill outside its scope and ration attention
    # across siblings. Hard-block; the parent revises the brief and
    # re-emits.
    if echo "$DESCRIPTION" | grep -qE '^(composer-|reviewer-|probe-)'; then
      REASON_LEAK="[BLOCKED] Subagent brief contains orchestrator meta-content: ${LEAK//|/, }

Description: \"${DESCRIPTION}\"

A composer / reviewer / probe brief only needs:
  - the journey block (verbatim from journey-map.md)
  - the must-fix list (Stage B feedback or empty for cycle 1)
  - the CLI session slug
  - a pointer to the canonical return schema

References to the broader pipeline (depth/breadth mode, Pass 4/5, 5-pass structure, adversarial passes) belong to the parent orchestrator's context only. They bloat the subagent and cause it to ration attention across siblings — the diagnostic is Stage B reviewers returning improvements-needed for Test-expectations bullets the composer skipped.

Fix: rewrite the brief to drop the leaked phrases and re-dispatch. Tight-brief template:

  ## Journey block
  <paste from journey-map.md, this journey only>

  ## Must-fix list
  <Stage B feedback IDs verbatim, or \"(none — cycle 1)\">

  ## Session slug
  <composer|reviewer|probe>-j-<slug>-<pass>-c<N>

  ## Return shape
  See skills/element-interactions/references/subagent-return-schema.md.

See coverage-expansion §\"Orchestrator context discipline\" for the full briefing convention."
      emit_deny "$REASON_LEAK"
      exit 0
    fi

    # Soft WARN preserved for transitional / non-strict prefixes:
    # cleanup- (single dispatch, narrow scope) and the discovery prefixes
    # phase1- / phase2- / stage2- (different brief shape from the
    # composer/reviewer/probe pipeline).
    emit_warn "[WARN] Subagent brief contains orchestrator meta-content: ${LEAK//|/, }

This subagent only needs: scope + return shape. References to the broader pipeline (depth/breadth mode, Pass 4/5, 5-pass structure, adversarial passes) belong to the parent orchestrator's context — they bloat the subagent's context and risk it consulting parts of the skill outside its scope.

Suggested cleanup: remove pipeline meta-talk from the brief. Subagent role + scope + return contract is enough. See coverage-expansion §\"Orchestrator context discipline\"."
  fi
fi

# === In-flight composer/probe registration =================================
# Recorded for `composer-j-<slug>:` / `composer-sj-<slug>:` / `probe-j-<slug>:`
# / `probe-sj-<slug>:` dispatches in `tests/e2e/docs/.in-flight-composers.json`
# so the PostToolUse:Write|Edit gate (coverage-expansion-direct-compose-block.sh)
# can mechanically distinguish a legitimate composer-subagent spec write
# from an orchestrator-direct-composition violation.
#
# Done HERE (before the legit-dispatch early-exit) so it fires for the
# actual dispatch we want to authorise — not for reviewer-/cleanup-/etc.
# dispatches that don't write spec files.
#
# Each registration carries the cycle number so the downstream PostToolUse
# return-schema guard (subagent-return-schema-guard.sh) can validate the
# handover envelope's `cycle:` against the registered value and refuse to
# deregister on mismatch — preventing a stale cycle-1 handover from clearing
# a cycle-2 redispatch's slot. Cycle is extracted from the description
# (`composer-j-checkout: cycle 2`), falling back to the prompt body, then
# defaulting to 1.
#
# Dispatched slugs expire after a 30-minute TTL (rolling) as a failsafe for
# crashed/abandoned dispatches. Explicit deregistration on terminal handover
# status is the primary cleanup path; TTL only catches subagents that never
# return. Subagents that take >30 min would need a longer cycle than the
# 7-cycle A↔B retry budget allows; that's a different failure mode
# (blocked-cycle-stalled) caught upstream.
if [ "$DESCRIPTION_HAS_ROLE_PREFIX" = true ]; then
  REG_SLUG=""
  case "$DESCRIPTION" in
    composer-j-*|composer-sj-*|probe-j-*|probe-sj-*)
      REG_SLUG=$(echo "$DESCRIPTION" | sed -E 's/^(composer|probe)-((j|sj)-[a-z0-9-]+).*/\2/')
      ;;
  esac

  if [ -n "$REG_SLUG" ] && echo "$REG_SLUG" | grep -qE '^(j|sj)-[a-z0-9-]+$'; then
    REG_CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
    REG_REPO_ROOT=$(git -C "$REG_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$REG_CWD")
    REG_IN_FLIGHT="$REG_REPO_ROOT/tests/e2e/docs/.in-flight-composers.json"
    mkdir -p "$REG_REPO_ROOT/tests/e2e/docs" 2>/dev/null || true

    REG_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    REG_NOW_EPOCH=$(date -u +%s)
    REG_TTL_CUTOFF=$((REG_NOW_EPOCH - 1800))   # 30 min ago

    # Cycle extraction: description (`...: cycle N`) → prompt body → default 1.
    # `|| true` guards against set -e + pipefail when no match is found.
    REG_CYCLE=$(echo "$DESCRIPTION" | grep -oiE 'cycle[[:space:]]+[0-9]+' | grep -oE '[0-9]+' | head -1 || true)
    if [ -z "$REG_CYCLE" ]; then
      REG_CYCLE=$(echo "$PROMPT" | grep -oiE 'cycle[[:space:]]*[:=]?[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | head -1 || true)
    fi
    [ -z "$REG_CYCLE" ] && REG_CYCLE=1

    if [ -f "$REG_IN_FLIGHT" ]; then
      REG_EXISTING=$(jq '.' "$REG_IN_FLIGHT" 2>/dev/null || echo '{"composers":{}}')
    else
      REG_EXISTING='{"composers":{}}'
    fi

    REG_UPDATED=$(echo "$REG_EXISTING" | jq \
      --arg slug "$REG_SLUG" \
      --arg desc "$DESCRIPTION" \
      --arg ts "$REG_TIMESTAMP" \
      --argjson cycle "$REG_CYCLE" \
      --argjson cutoff "$REG_TTL_CUTOFF" \
      '
        # Drop entries older than TTL (best-effort).
        .composers |= with_entries(
          select((.value.started_at | fromdateiso8601 // 0) >= $cutoff)
        )
        # Register or refresh this slug. Redispatch under the same slug
        # overwrites the prior cycle/timestamp — that is the documented
        # refresh semantics for non-terminal handovers (reviewer
        # improvements-needed, phase-validator improvements-needed) where
        # the orchestrator MUST redispatch under the same slug.
        | .composers[$slug] = {
            description_prefix: $desc,
            cycle: $cycle,
            started_at: $ts
          }
      ' 2>/dev/null || echo "$REG_EXISTING")

    echo "$REG_UPDATED" > "$REG_IN_FLIGHT.tmp" 2>/dev/null && mv "$REG_IN_FLIGHT.tmp" "$REG_IN_FLIGHT" || rm -f "$REG_IN_FLIGHT.tmp"
  fi

  exit 0
fi

# === Anti-pattern C: bare j-/sj- prefix (deprecated, role-ambiguous) ====
# Pre-issue-#126 form `j-<slug>:` / `sj-<slug>:` was role-ambiguous — the
# hook layer + downstream return-schema validator can't tell whether the
# dispatch is composer / reviewer / probe. Block with redirect.
if echo "$DESCRIPTION" | grep -qE '^(j-|sj-)[a-z0-9-]+(:|[[:space:]]|$)'; then
  REASON_BARE="[BLOCKED] Subagent dispatch uses deprecated role-ambiguous prefix.

Description: \"${DESCRIPTION}\"

Bare \`j-<slug>:\` and \`sj-<slug>:\` prefixes were dropped per issue #126 — the hook layer + downstream return-schema validator (hooks/subagent-return-schema-guard.sh) can't map the prefix to a role schema (composer / reviewer / probe). Use a role-explicit form instead:

  composer-j-<slug>:    test-composer Stage A
  reviewer-j-<slug>:    Stage B reviewer
  probe-j-<slug>:       adversarial probe (passes 4-5)
  composer-sj-<slug>:   sub-journey composer
  reviewer-sj-<slug>:   sub-journey reviewer

The role prefix appears unchanged on the playwright-cli session slug (see playwright-cli-isolation-guard.sh), so .playwright-cli/<slug>* trace files map 1:1 to the dispatching subagent's role + journey.

See coverage-expansion/SKILL.md §\"Role prefixes\" for the full mapping table."
  emit_deny "$REASON_BARE"
  exit 0
fi

# === Anti-pattern D: prompt body looks coverage-expansion-related but ===
# description has no role prefix → batched-dispatch attempt.
# Only inspect for batched-dispatch when the prompt looks coverage-related.
if ! echo "$PROMPT" | grep -qE 'coverage-expansion|test-composer|JOURNEYS YOU OWN|cycle-[0-9]+ Stage [AB]|journey-map\.md|element-interactions[ /]|playwright-cli[[:space:]]+-s='; then
  exit 0
fi

# Count distinct j-<slug> references in the prompt body. If 2+ appear, this
# is almost certainly a batched composer/reviewer dispatch against the rules.
# Word-boundary anchors the match so substrings like `obj-foo`, `subj-x`,
# `proj-bar` are NOT counted as journey IDs.
DISTINCT=$(echo "$PROMPT" | grep -oE '(^|[^a-zA-Z0-9_])(j-[a-z0-9-]+)' | grep -oE 'j-[a-z0-9-]+' | sort -u | wc -l | tr -d '[:space:]')

if [ "$DISTINCT" -ge 2 ]; then
  REASON="[BLOCKED] Subagent dispatch missing role-prefixed description.

Description: \"${DESCRIPTION}\"
Found: ${DISTINCT} distinct j-<slug> IDs in prompt → looks like batched dispatch.

Fix: re-issue as N parallel single-journey Agent calls in one message. Each call's description must START with a role-explicit prefix:

  composer-j-<slug>:        test-composer Stage A
  reviewer-j-<slug>:        Stage B reviewer
  probe-j-<slug>:           adversarial probe (passes 4-5)
  composer-sj-<slug>:       sub-journey composer
  reviewer-sj-<slug>:       sub-journey reviewer
  process-validator-<scope>: sub-orchestrator validating a planned wave
  phase1-<entry>:           Phase-1 discovery
  stage2-<scenario>:        element inspection
  cleanup-<scope>:          ledger / cleanup
  [P3-batch] composer-j-a,composer-j-b,...:  P3 batch (≤7, P3 priority only)

The role-prefix appears unchanged on the subagent's CLI session slug (see playwright-cli-isolation-guard) so .playwright-cli/<slug>* trace files map 1:1 to the subagent's role + journey.

Why: P0/P1/P2 journeys never batch — see coverage-expansion SKILL.md §\"Stage A per-journey dispatch is non-negotiable\". A batched composer rations attention across siblings and skips Test-expectations bullets, surfacing as Stage B improvements-needed."

  emit_deny "$REASON"
fi

exit 0
