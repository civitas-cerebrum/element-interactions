#!/bin/bash
# journey-mapping-cycle-gate.sh — gate journey-mapping iterative-cycle dispatches
#
# Hook    : PreToolUse:Agent  (gate cycle + author dispatches)
#         + PostToolUse:Agent (record returns to .phase4-cycle-state.json,
#                              auto-derive convergence-status from data)
# Mode    : DENY (PreToolUse — block invalid cycle / author dispatches)
#         + RECORD (PostToolUse — append section returns to state, derive
#                   convergence)
# State   : <repo>/tests/e2e/docs/.phase4-cycle-state.json
# Lock    : <repo>/tests/e2e/docs/.phase4-cycle-state.json.lockdir (mkdir-based)
# Env     : JOURNEY_MAPPING_CYCLE_GATE=off → silent allow (escape hatch)
# Sentinel: .claude/phase4-extended-cycles-authorized → permits cycles 6-10
#
# Rule (PreToolUse)
# -----------------
# 1. Cycle-N dispatches (description: phase4-cycle-<N>-section-<id>:)
#    a. N must be 1..5; cycles 6-10 require the extended-cycles authorisation
#       sentinel naming the user's words; cycle 11+ denied unconditionally.
#    b. <id> must be ≤16 chars (slug-length budget — composer-prefixed
#       session slug `phase4-c<N>-s-<id>` stays ≤28 chars on darwin).
#    c. For N == 1: section <id> must be in
#       .discovery-draft.json's handover-to-phase4.cycle-1-targets.
#    d. For N >= 2:
#       - cycle (N-1) must exist in state file with at least one entry in
#         returned-sections.
#       - section <id> must NOT already be in cycles[1..N-1].dispatched-sections.
# 2. Author dispatches (description: phase4-prioritise-author:)
#    - state file must exist
#    - convergence-status must be one of: converged | hard-cap-reached
#    - author-attempts must be < 3 (retry cap)
#
# Rule (PostToolUse)
# ------------------
# Critical-section: every PostToolUse mutation acquires the state-file
# lockdir via mkdir (atomic across processes) before read-mutate-write.
# Last-writer-wins is unacceptable here — cycle agents return in parallel
# and dropped new-sections-discovered entries silently shrink the next
# cycle's roster.
#
# 1. Cycle-N section returns: append <id> to cycles.<N>.returned-sections,
#    parse new-sections-discovered (YAML + optional JSON sub-block) and
#    append to cycles.<N>.new-sections-discovered, validate vocabulary,
#    flag novel section-IDs in unvalidated-sections-flagged for the
#    author's review.
# 2. After every cycle-section return, recompute convergence-status:
#    - If cycles.<N>.dispatched-sections == returned-sections (all returned)
#      AND cycles.<N>.new-sections-discovered post-vocabulary-merge is
#      empty AND N >= 3 → convergence-status: converged
#    - If N == 5 (or extended-authorised cap) AND new-sections-discovered
#      non-empty → convergence-status: hard-cap-reached
#    - Otherwise → convergence-status: continuing
# 3. Author returns: increment author-attempts; if status: blocked, allow
#    re-dispatch up to 3 attempts; if status: journey-map-authored, set
#    author-dispatched: true.
#
# Why
# ---
# Without this hook, the cycle protocol degenerates to the single-sequential
# walkthrough — the orchestrator dispatches one cycle agent that "covers
# everything", calls Phase 4 done, and the parallel discipline is silently
# lost. This hook makes that impossible.
#
# Auto-derived convergence (vs reading orchestrator-written field) closes
# the trust-the-orchestrator loophole: an orchestrator that prematurely
# sets convergence-status: converged after cycle 1 had its check overruled
# by the hook's own computation from the data already in the state file.
#
# Canonical references
# --------------------
# skills/journey-mapping/SKILL.md §"Iterative discovery cycles"
# skills/journey-mapping/SKILL.md §"Cycle protocol"
# skills/journey-mapping/SKILL.md §"Section vocabulary"
# skills/journey-mapping/SKILL.md §"Harness enforcement"
# skills/element-interactions/references/subagent-return-schema.md §2.7

set -euo pipefail

# Resolve jq.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

# --- helpers ---
emit_deny() {
  "$JQ" -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

emit_warn() {
  "$JQ" -n --arg msg "$1" '{ "systemMessage": $msg }'
}

# Escape hatch.
if [ "${JOURNEY_MAPPING_CYCLE_GATE:-}" = "off" ]; then
  exit 0
fi

# Canonical section vocabulary — kept in sync with
# skills/journey-mapping/SKILL.md §"Section vocabulary".
# Novel IDs aren't denied (cycle agents may legitimately surface new
# categories) — they're flagged for author review.
CANONICAL_SECTIONS=(auth catalog detail cart order marketplace profile admin billing content notifications error)

# --- input ---
INPUT=$(cat)
EVENT_NAME=$(echo "$INPUT" | "$JQ" -r '.hook_event_name // ""')
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""')

# Resolve repo root.
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
DRAFT="$REPO_ROOT/tests/e2e/docs/.discovery-draft.json"
STATE="$REPO_ROOT/tests/e2e/docs/.phase4-cycle-state.json"
LOCKDIR="$STATE.lockdir"
EXT_CYCLES_SENTINEL_A="$REPO_ROOT/.claude/phase4-extended-cycles-authorized"
EXT_CYCLES_SENTINEL_B="$REPO_ROOT/tests/e2e/docs/.phase4-extended-cycles-authorized"

# Ensure docs dir exists for state file writes.
mkdir -p "$REPO_ROOT/tests/e2e/docs" 2>/dev/null || true

# --- mkdir-based file lock with retry/backoff ---
acquire_lock() {
  local attempts=0
  local max_attempts=60       # 60 × 0.1s = 6s ceiling
  while ! mkdir "$LOCKDIR" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge "$max_attempts" ]; then
      # Stale lock probably — force release and grab.
      rmdir "$LOCKDIR" 2>/dev/null || rm -rf "$LOCKDIR" 2>/dev/null || true
      mkdir "$LOCKDIR" 2>/dev/null && return 0
      echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: could not acquire lock at $LOCKDIR after ${max_attempts} attempts" >&2
      return 1
    fi
    sleep 0.1
  done
  return 0
}

release_lock() {
  rmdir "$LOCKDIR" 2>/dev/null || true
}

# Helper: extract <N> and <id> from "phase4-cycle-<N>-section-<id>[:...]".
parse_cycle_dispatch() {
  local desc="$1"
  echo "$desc" | sed -nE 's/^phase4-cycle-([0-9]+)-section-([a-z0-9_-]+).*/\1 \2/p'
}

# --- canonical vocabulary check ---
is_canonical_section() {
  local id="$1"
  local canon
  for canon in "${CANONICAL_SECTIONS[@]}"; do
    [ "$id" = "$canon" ] && return 0
  done
  return 1
}

# --- extended-cycles sentinel check ---
extended_cycles_authorised() {
  [ -f "$EXT_CYCLES_SENTINEL_A" ] || [ -f "$EXT_CYCLES_SENTINEL_B" ]
}

# --- compute convergence-status from cycles array ---
# Inputs (via globals): STATE (path)
# Outputs (echoed): "converged" | "hard-cap-reached" | "continuing"
#
# Convergence rules:
#   - Minimum 2 cycles always: 1 discovery + 1 edge-probe (the edge-probe
#     re-dispatches mapped sections under an edge-finding brief looking for
#     less-obvious flows — permission boundaries, deep links, lifecycle
#     edges — even if cycle 1 surfaced no new sections).
#   - The edge-probe cycle is identified by `cycles.<N>.kind: "edge-probe"`
#     in the state file. The orchestrator sets this when dispatching the
#     first cycle whose target list is the existing section roster (not
#     newly discovered sections).
#   - Cycles must be CONTIGUOUS: keys 1..N with no gaps. A run with cycle
#     keys {1, 3, 5} (gaps) cannot converge — the env-var escape hatch
#     can't re-open this hole because compute_convergence is called from
#     PreToolUse:Agent for the author dispatch regardless of the gate's
#     hatch state.
#   - Converge when:
#       (i) all sections in highest cycle returned
#       (ii) post-dedup new-sections-discovered is empty
#       (iii) at least one cycle of kind "edge-probe" has run
#       (iv) cycles are contiguous 1..N
#   - Hard-cap when N reaches the cap (default 5, extended 10) with new
#     sections still pending.
compute_convergence() {
  local highest_cycle
  local extended_cap=5
  if extended_cycles_authorised; then
    extended_cap=10
  fi

  highest_cycle=$("$JQ" -r '
    (.cycles // {}) | keys | map(tonumber) | max // 0
  ' "$STATE" 2>/dev/null || echo 0)

  if [ "$highest_cycle" -lt 1 ]; then
    echo "continuing"
    return
  fi

  # Cycles must be contiguous 1..highest_cycle (no gaps).
  local contiguous
  contiguous=$("$JQ" -r --argjson hc "$highest_cycle" '
    [.cycles | keys | map(tonumber)] | flatten | sort ==
    [range(1; $hc + 1)]
  ' "$STATE" 2>/dev/null || echo "false")
  if [ "$contiguous" != "true" ]; then
    echo "continuing"
    return
  fi

  local all_returned
  all_returned=$("$JQ" -r --arg n "$highest_cycle" '
    .cycles[$n] as $c |
    (($c."dispatched-sections" // []) | sort) ==
    (($c."returned-sections"   // []) | sort)
  ' "$STATE" 2>/dev/null || echo "false")

  # Not all returned → still continuing.
  if [ "$all_returned" != "true" ]; then
    echo "continuing"
    return
  fi

  # Post-dedup: candidate new sections not already dispatched in ANY cycle.
  local post_dedup_count
  post_dedup_count=$("$JQ" -r --arg n "$highest_cycle" '
    . as $root |
    ($root.cycles[$n]."new-sections-discovered" // []) as $candidates |
    ([
      $root.cycles | to_entries[] |
      select((.key | tonumber) <= ($n | tonumber)) |
      .value."dispatched-sections" // []
    ] | flatten | unique) as $already |
    ($candidates - $already) | length
  ' "$STATE" 2>/dev/null || echo 0)

  # Has at least one cycle been an edge-probe?
  local edge_probe_ran
  edge_probe_ran=$("$JQ" -r '
    [.cycles[]? | select(.kind == "edge-probe")] | length > 0
  ' "$STATE" 2>/dev/null || echo "false")

  # Hard cap takes precedence (run for full budget when sections still pending).
  if [ "$highest_cycle" -ge "$extended_cap" ] && [ "$post_dedup_count" -gt 0 ]; then
    echo "hard-cap-reached"
    return
  fi

  # Convergence requires: no new sections post-dedup AND edge-probe has run.
  if [ "$post_dedup_count" -eq 0 ] && [ "$edge_probe_ran" = "true" ]; then
    echo "converged"
    return
  fi

  # No new sections but edge-probe hasn't run yet → keep continuing
  # (orchestrator must dispatch the edge-probe cycle).
  echo "continuing"
}

# === PreToolUse branch ======================================================
if [ "$EVENT_NAME" = "PreToolUse" ]; then

  # ---- Cycle-N dispatch ---------------------------------------------------
  if [[ "$DESCRIPTION" == phase4-cycle-* ]]; then
    PARSED=$(parse_cycle_dispatch "$DESCRIPTION")
    if [ -z "$PARSED" ]; then
      emit_deny "[BLOCKED] Malformed cycle dispatch description.

Description: \"${DESCRIPTION}\"
Expected:    \"phase4-cycle-<N>-section-<section-id>: <optional suffix>\"
             where N is 1..5 (or 1..10 with extended-cycles authorisation)
             and <section-id> is kebab-case, ≤16 chars.

References:
  skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\""
      exit 0
    fi

    CYCLE_N=$(echo "$PARSED" | awk '{print $1}')
    SECTION_ID=$(echo "$PARSED" | awk '{print $2}')

    # Check: slug-length budget. Section ID ≤ 16 chars keeps the CLI
    # session slug `phase4-c<N>-s-<id>` (12 + id) ≤ 28 chars on darwin.
    SECTION_LEN=${#SECTION_ID}
    if [ "$SECTION_LEN" -gt 16 ]; then
      emit_deny "[BLOCKED] Section ID \"${SECTION_ID}\" exceeds 16-char slug-length budget.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
Shorten the section ID. The CLI session slug for cycle agents is
\`phase4-c<N>-s-<id>\` — with N 1 digit and prefix \`phase4-c<N>-s-\` taking
12 chars, the section ID has only 16 chars before the slug exceeds the
darwin 28-char socket-path budget.

Empirically observed: \`phase1-marketplace\` (18 chars) failed; \`phase1-mkt\`
(10 chars) worked. See playwright-cli-protocol.md §\"Slug-length budget\".

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Section ID:  \"${SECTION_ID}\" (length: ${SECTION_LEN})
Budget:      ≤16 chars

References:
  skills/element-interactions/references/playwright-cli-protocol.md §\"Slug-length budget\"
  skills/journey-mapping/SKILL.md §\"Cycle protocol\""
      exit 0
    fi

    # Check: cycle-N range with optional extended authorisation.
    if [ "$CYCLE_N" -lt 1 ]; then
      emit_deny "[BLOCKED] Cycle ${CYCLE_N} is below 1.

Cycles are numbered from 1. See skills/journey-mapping/SKILL.md §\"Cycle protocol\"."
      exit 0
    fi

    if [ "$CYCLE_N" -gt 5 ]; then
      if ! extended_cycles_authorised; then
        emit_deny "[BLOCKED] Cycle ${CYCLE_N} is above the 5-cycle hard cap.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
The protocol is bounded at 5 cycles by default. If cycle 5 still surfaced
new sections post-dedup AND you genuinely need to map deeper, create the
extended-cycles authorisation sentinel naming the user's words:

  mkdir -p .claude
  echo 'user authorised cycles 6-10 for <reason>' > .claude/phase4-extended-cycles-authorized

The hook honours \`.claude/phase4-extended-cycles-authorized\` OR
\`tests/e2e/docs/.phase4-extended-cycles-authorized\`. Cycle 11 is denied
unconditionally — at that depth, the missed sections belong in
\`## Gated Areas (Not Mapped)\` for coverage-expansion to handle.

The default path: dispatch \`phase4-prioritise-author:\` with
\`convergence-status: hard-cap-reached\`. The author writes the residue
into \`## Gated Areas (Not Mapped)\` so coverage-expansion can pick it
up later when credentials are available.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Cycle:       ${CYCLE_N} (default cap is 5)

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\" → \"Decision\""
        exit 0
      fi
      # Authorised — but absolute hard cap is 10.
      if [ "$CYCLE_N" -gt 10 ]; then
        emit_deny "[BLOCKED] Cycle ${CYCLE_N} exceeds the absolute 10-cycle ceiling.

Even with the extended-cycles authorisation sentinel, the absolute ceiling
is 10. Beyond that, sections genuinely belong in \`## Gated Areas (Not Mapped)\`
for coverage-expansion to handle when credentials become available.

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\" → \"Decision\""
        exit 0
      fi
    fi

    # Check: Cycle 1 — section must be in draft's cycle-1-targets.
    if [ "$CYCLE_N" -eq 1 ]; then
      if [ ! -f "$DRAFT" ]; then
        emit_deny "[BLOCKED] Cycle 1 dispatch with no discovery-draft.json present.

Draft path:  ${DRAFT} (does not exist)
Description: \"${DESCRIPTION}\"

Re-run Phase 3 to produce the draft. See
skills/element-interactions/references/autonomous-mode-callers.md
§\"Mandatory output for \`onboarding\` Phase 3 — discovery draft\"."
        exit 0
      fi

      IN_TARGETS=$("$JQ" -r --arg s "$SECTION_ID" '
        ."handover-to-phase4"."cycle-1-targets" // [] | index($s) // empty
      ' "$DRAFT" 2>/dev/null || echo "")

      if [ -z "$IN_TARGETS" ]; then
        TARGET_LIST=$("$JQ" -r '."handover-to-phase4"."cycle-1-targets" // [] | join(", ")' "$DRAFT" 2>/dev/null || echo "(unparseable)")
        emit_deny "[BLOCKED] Cycle-1 section \"${SECTION_ID}\" not in discovery-draft cycle-1-targets.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
Cycle 1's section roster is fixed by the discovery draft. Pick one of:
  ${TARGET_LIST}

If the section legitimately should be in the cycle-1 roster but isn't,
re-run Phase 3 to refresh the draft.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description:        \"${DESCRIPTION}\"
Section requested:  ${SECTION_ID}
Cycle-1 targets:    [${TARGET_LIST}]

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\" → step 1"
        exit 0
      fi
    fi

    # Check: Cycle N >= 2 — prior cycle has at least one return.
    if [ "$CYCLE_N" -ge 2 ]; then
      if [ ! -f "$STATE" ]; then
        emit_deny "[BLOCKED] Cycle ${CYCLE_N} dispatch with no cycle-state file.

Cycle ${CYCLE_N} requires that cycle $((CYCLE_N - 1)) ran and returned at
least one section. The state file is missing — no prior cycle has recorded
returns.

State path:  ${STATE} (does not exist)
Description: \"${DESCRIPTION}\"

Dispatch cycle 1 first."
        exit 0
      fi

      PRIOR_RETURNS=$("$JQ" -r --arg p "$((CYCLE_N - 1))" '
        .cycles[$p]."returned-sections" // [] | length
      ' "$STATE" 2>/dev/null || echo 0)

      if [ "$PRIOR_RETURNS" -lt 1 ]; then
        emit_deny "[BLOCKED] Cycle ${CYCLE_N} dispatch before cycle $((CYCLE_N - 1)) has any returns.

Wait for at least one cycle-$((CYCLE_N - 1)) section-agent to return before
dispatching cycle ${CYCLE_N}.

Description:                    \"${DESCRIPTION}\"
Cycle $((CYCLE_N - 1)) returned-sections count: ${PRIOR_RETURNS}

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\""
        exit 0
      fi

      # Section <id> not already dispatched in cycles 1..N-1.
      DUPLICATE_CYCLE=$("$JQ" -r --arg s "$SECTION_ID" --arg n "$((CYCLE_N - 1))" '
        [.cycles | to_entries[]
          | select((.key | tonumber) <= ($n | tonumber))
          | select(.value."dispatched-sections" // [] | index($s))
          | .key] | first // empty
      ' "$STATE" 2>/dev/null || echo "")

      if [ -n "$DUPLICATE_CYCLE" ]; then
        emit_deny "[BLOCKED] Section \"${SECTION_ID}\" already dispatched in cycle ${DUPLICATE_CYCLE}.

The cycle-N+1 roster is the SET DIFFERENCE between cycle-N's
new-sections-discovered and the union of cycles 1..N's dispatched-sections.

Description:           \"${DESCRIPTION}\"
Section:               ${SECTION_ID}
Already dispatched in: cycle ${DUPLICATE_CYCLE}

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\" → step 5 (dedup)"
        exit 0
      fi
    fi

    # All checks pass — allow.
    exit 0
  fi

  # ---- Author dispatch ----------------------------------------------------
  if [[ "$DESCRIPTION" == phase4-prioritise-author* ]]; then
    if [ ! -f "$STATE" ]; then
      emit_deny "[BLOCKED] phase4-prioritise-author dispatch with no cycle-state file.

State path: ${STATE} (does not exist)

The author runs only after the iterative cycles complete. No state file
means no cycles have run yet. Dispatch cycle 1 first."
      exit 0
    fi

    # Read both the recorded convergence-status AND compute the
    # data-derived value. Use the data-derived computation as the gate —
    # the orchestrator-written field is informational only.
    DERIVED_CONVERGENCE=$(compute_convergence)
    AUTHOR_DISPATCHED=$("$JQ" -r '."author-dispatched" // false' "$STATE" 2>/dev/null || echo "false")
    AUTHOR_ATTEMPTS=$("$JQ" -r '."author-attempts" // 0' "$STATE" 2>/dev/null || echo 0)

    if [ "$AUTHOR_DISPATCHED" = "true" ]; then
      emit_deny "[BLOCKED] phase4-prioritise-author already completed (single-success contract).

State: author-dispatched: true

The author runs to completion once per Phase-4 invocation. If you need to
re-author after an external change, delete the cycle-state file AND the
authored journey-map.md, then re-run the cycle protocol from scratch."
      exit 0
    fi

    if [ "$AUTHOR_ATTEMPTS" -ge 3 ]; then
      emit_deny "[BLOCKED] phase4-prioritise-author retry cap reached (3 attempts).

The author has been dispatched 3 times without producing a valid journey
map. Surface to the user with the most recent author return — the cycle
data may need manual review before another attempt.

State: author-attempts: ${AUTHOR_ATTEMPTS}"
      exit 0
    fi

    case "$DERIVED_CONVERGENCE" in
      converged|hard-cap-reached)
        # Auto-write the derived value into the state file (under lock) so
        # readers see the canonical convergence status. Trap-protected so
        # the lock releases on any exit path including jq/mv failure.
        if acquire_lock; then
          trap 'release_lock' EXIT
          UPDATED=$("$JQ" --arg cs "$DERIVED_CONVERGENCE" '."convergence-status" = $cs' "$STATE" 2>/dev/null || cat "$STATE")
          echo "$UPDATED" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE" || rm -f "$STATE.tmp"
          release_lock
          trap - EXIT
        fi
        exit 0
        ;;
      continuing|*)
        emit_deny "[BLOCKED] phase4-prioritise-author dispatch before cycles converge.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
Continue the cycle loop until either:
  - convergence-status: converged          (no new sections post-dedup AND
                                            edge-probe cycle has run AND
                                            cycles are contiguous 1..N)
  - convergence-status: hard-cap-reached   (cycle 5 ran with new sections
                                            still in the queue, OR cycle 10
                                            with extended-cycles authorisation)

The minimum cycle count is 2: one discovery cycle, one edge-probe cycle.
The edge-probe re-dispatches mapped sections under an edge-finding brief
to surface less-obvious flows (permission boundaries, deep links, lifecycle
edges). Dispatch the edge-probe by setting \`cycles.<N>.kind: \"edge-probe\"\`
in the state file via PostToolUse; the orchestrator's own dispatch should
include \"edge-probe\" in the brief so the cycle agent knows what to look for.

The hook computes convergence-status from the cycles array directly. If
you believe convergence has been reached but the hook says \"continuing\",
either (a) some cycle has dispatched-sections without matching returned-
sections, or (b) post-dedup new-sections-discovered is non-empty AND
cycle < cap. Inspect the state file:

  cat tests/e2e/docs/.phase4-cycle-state.json | jq

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description:                  \"${DESCRIPTION}\"
Hook-derived convergence:     ${DERIVED_CONVERGENCE}
author-attempts:              ${AUTHOR_ATTEMPTS}

References:
  skills/journey-mapping/SKILL.md §\"Cycle protocol\" → \"Decision\"
  skills/journey-mapping/SKILL.md §\"Author step\""
        exit 0
        ;;
    esac
  fi

  # Other Agent dispatches — silent allow.
  exit 0
fi

# === PostToolUse branch =====================================================
if [ "$EVENT_NAME" = "PostToolUse" ]; then

  # ---- Cycle-N section return --------------------------------------------
  if [[ "$DESCRIPTION" == phase4-cycle-* ]]; then
    PARSED=$(parse_cycle_dispatch "$DESCRIPTION")
    [ -z "$PARSED" ] && exit 0

    CYCLE_N=$(echo "$PARSED" | awk '{print $1}')
    SECTION_ID=$(echo "$PARSED" | awk '{print $2}')

    # Detect edge-probe cycle from the dispatch description suffix or the
    # subagent's return body. Either signal stamps `kind: "edge-probe"` on
    # the cycle's slot.
    CYCLE_KIND="discovery"
    if echo "$DESCRIPTION" | grep -qiE 'edge-probe|edge probe'; then
      CYCLE_KIND="edge-probe"
    fi

    # Acquire lock for the entire read-mutate-write critical section.
    acquire_lock || exit 0
    trap 'release_lock' EXIT

    # Initialise state file if missing.
    if [ ! -f "$STATE" ]; then
      INIT=$("$JQ" -n --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{
        "phase4-cycle-state-version": 1,
        "started-at": $now,
        "draft-path": "tests/e2e/docs/.discovery-draft.json",
        "cycles": {},
        "convergence-status": "continuing",
        "author-dispatched": false,
        "author-attempts": 0,
        "unvalidated-sections-flagged": []
      }')
      echo "$INIT" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE" || rm -f "$STATE.tmp"
    fi

    # Extract response text for new-sections parsing.
    RESPONSE=$(
      echo "$INPUT" | "$JQ" -r '
        [
          (.tool_response.output? | if type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
          (.tool_response.result? // empty | tostring)
        ] | map(select(. != null and . != "")) | unique | join("\n")
      ' 2>/dev/null || echo ""
    )

    # Parse new-sections-discovered. Two extraction strategies, merged:
    #   (a) JSON sub-block — preferred, less brittle:
    #       <!-- new-sections: ["a","b"] --> on its own line
    #   (b) YAML-style fallback:
    #       new-sections-discovered:
    #         - id: <kebab-case>
    NEW_FROM_JSON=$(
      echo "$RESPONSE" | grep -oE '<!-- new-sections:[[:space:]]*\[[^]]*\][[:space:]]*-->' \
        | sed -E 's/^<!-- new-sections:[[:space:]]*//;s/[[:space:]]*-->$//' \
        | head -1 \
        | "$JQ" 'try . catch []' 2>/dev/null || echo "[]"
    )
    [ -z "$NEW_FROM_JSON" ] && NEW_FROM_JSON='[]'

    NEW_FROM_YAML=$(
      echo "$RESPONSE" | awk '
        /^[[:space:]]*new-sections-discovered:[[:space:]]*\[\][[:space:]]*$/ { in_block=0; next }
        /^[[:space:]]*new-sections-discovered:[[:space:]]*$/ { in_block=1; next }
        in_block && /^[[:space:]]*-[[:space:]]+id:[[:space:]]*/ {
          line = $0
          sub(/^[[:space:]]*-[[:space:]]+id:[[:space:]]*/, "", line)
          sub(/[[:space:]]*#.*$/, "", line)
          sub(/^[\"'\'']/, "", line)
          sub(/[\"'\'']$/, "", line)
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
          if (line != "") print line
          next
        }
        in_block && /^[a-zA-Z]/ { in_block=0 }
      ' | "$JQ" -R . | "$JQ" -s 'unique'
    )
    [ -z "$NEW_FROM_YAML" ] && NEW_FROM_YAML='[]'

    NEW_SECTIONS=$("$JQ" -n --argjson a "$NEW_FROM_JSON" --argjson b "$NEW_FROM_YAML" '$a + $b | unique')

    # Validate vocabulary: split into canonical + flagged-novel.
    NOVEL_SECTIONS=$(
      "$JQ" -r '.[]' <<< "$NEW_SECTIONS" 2>/dev/null | while read -r sec; do
        [ -z "$sec" ] && continue
        if ! is_canonical_section "$sec"; then
          echo "$sec"
        fi
      done | "$JQ" -R . | "$JQ" -s 'unique'
    )
    [ -z "$NOVEL_SECTIONS" ] && NOVEL_SECTIONS='[]'

    # Also detect edge-probe from the return body — subagents that explicitly
    # state status: edge-probe-complete or include a `kind: edge-probe` line
    # are recorded as edge-probe cycles even if the dispatch description
    # didn't mention it.
    if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*kind:[[:space:]]*edge-probe' \
       || echo "$RESPONSE" | grep -qE 'edge-probe-complete'; then
      CYCLE_KIND="edge-probe"
    fi

    # Append section ID to dispatched-sections + returned-sections; merge
    # new-sections-discovered; flag novel section IDs; stamp cycle.kind
    # (only the FIRST recorded kind sticks — discovery doesn't overwrite
    # edge-probe and vice versa).
    UPDATED=$("$JQ" --arg n "$CYCLE_N" \
                    --arg s "$SECTION_ID" \
                    --arg kind "$CYCLE_KIND" \
                    --argjson new "$NEW_SECTIONS" \
                    --argjson novel "$NOVEL_SECTIONS" \
                    --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
      .cycles[$n] = (
        (.cycles[$n] // {
          "dispatched-sections": [],
          "returned-sections": [],
          "new-sections-discovered": [],
          "duplicates-merged": [],
          "kind": $kind
        })
        | .["dispatched-sections"]      = (.["dispatched-sections"]      + [$s] | unique)
        | .["returned-sections"]        = (.["returned-sections"]        + [$s] | unique)
        | .["new-sections-discovered"]  = (.["new-sections-discovered"]  + $new | unique)
        | .["completed-at"]             = $now
        | .["kind"]                     = (.["kind"] // $kind)
      )
      | ."unvalidated-sections-flagged" = ((."unvalidated-sections-flagged" // []) + $novel | unique)
    ' "$STATE" 2>/dev/null || cat "$STATE")

    echo "$UPDATED" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE" || rm -f "$STATE.tmp"

    # Recompute convergence and write it back.
    DERIVED_CONVERGENCE=$(compute_convergence)
    UPDATED2=$("$JQ" --arg cs "$DERIVED_CONVERGENCE" '."convergence-status" = $cs' "$STATE" 2>/dev/null || cat "$STATE")
    echo "$UPDATED2" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE" || rm -f "$STATE.tmp"

    release_lock
    trap - EXIT

    # Emit a warning if any novel section IDs were flagged this turn.
    NOVEL_COUNT=$("$JQ" -r 'length' <<< "$NOVEL_SECTIONS" 2>/dev/null || echo 0)
    if [ "$NOVEL_COUNT" -gt 0 ]; then
      NOVEL_LIST=$("$JQ" -r 'join(", ")' <<< "$NOVEL_SECTIONS")
      emit_warn "[WARN][journey-mapping-cycle-gate] Cycle ${CYCLE_N} section ${SECTION_ID} returned non-canonical section IDs: ${NOVEL_LIST}. The author (phase4-prioritise-author) is responsible for either normalising these against the canonical vocabulary OR justifying them with a rationale block. Canonical IDs: ${CANONICAL_SECTIONS}. See journey-mapping/SKILL.md §\"Section vocabulary\"."
    fi

    exit 0
  fi

  # ---- Author return ------------------------------------------------------
  if [[ "$DESCRIPTION" == phase4-prioritise-author* ]]; then
    [ ! -f "$STATE" ] && exit 0

    acquire_lock || exit 0
    trap 'release_lock' EXIT

    RESPONSE=$(
      echo "$INPUT" | "$JQ" -r '
        [
          (.tool_response.output? | if type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
          (.tool_response.result? // empty | tostring)
        ] | map(select(. != null and . != "")) | unique | join("\n")
      ' 2>/dev/null || echo ""
    )

    # Determine status: journey-map-authored | blocked
    AUTHOR_STATUS="unknown"
    if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*journey-map-authored'; then
      AUTHOR_STATUS="journey-map-authored"
    elif echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*blocked'; then
      AUTHOR_STATUS="blocked"
    fi

    # Increment author-attempts always; flip author-dispatched only on success.
    if [ "$AUTHOR_STATUS" = "journey-map-authored" ]; then
      UPDATED=$("$JQ" '
        ."author-attempts"   = ((."author-attempts" // 0) + 1)
        | ."author-dispatched" = true
      ' "$STATE" 2>/dev/null || cat "$STATE")
    else
      UPDATED=$("$JQ" '
        ."author-attempts"   = ((."author-attempts" // 0) + 1)
      ' "$STATE" 2>/dev/null || cat "$STATE")
    fi

    echo "$UPDATED" > "$STATE.tmp" && mv "$STATE.tmp" "$STATE" || rm -f "$STATE.tmp"

    release_lock
    trap - EXIT
    exit 0
  fi

  exit 0
fi

exit 0
