#!/bin/bash
# standard-mode-first-pass-guard.sh — first-pass / first-cycle strict-dispatch
#                                     enforcement for coverage-expansion +
#                                     journey-mapping.
#
# Hook    : PreToolUse:Agent
# Mode    : DENY (blocks the dispatch before the subagent starts)
# State   : reads
#             tests/e2e/docs/coverage-expansion-state.json   (Pass-1 detection,
#                                                             runMode marker)
#             tests/e2e/docs/.phase4-cycle-state.json        (cycle-1 detection,
#                                                             cycleStrictness)
# Env     : none
#
# Mode awareness
# --------------
# Two state-file fields control whether the strict contract relaxes after the
# first pass / cycle (default behaviour under `runMode: standard`) or holds
# across every pass / cycle (`runMode: depth`).
#
#   coverage-expansion-state.json
#     - `runMode: "standard" | "depth"` (optional; default "standard" when
#       absent). Under "standard", `[group]` / `[P3-batch]` are denied on
#       Pass 1 only; under "depth", they are denied on every pass.
#
#   .phase4-cycle-state.json
#     - `cycleStrictness: "standard" | "depth"` (optional; default "standard"
#       when absent). Under "standard", single-agent cycle-2+ dispatches are
#       allowed; under "depth", single-agent cycle-N dispatches are denied
#       for ANY cycle, not just cycle 1.
#
# Rules
# -----
# 1. Grouping forbidden (Pass-1 under standard, every pass under depth).
#    If the Agent description starts with `[group]` or `[P3-batch]` AND
#    EITHER:
#      (a) the coverage-expansion state file doesn't exist (implicit Pass 1
#          → DENY always), OR
#      (b) `currentPass == 1` (DENY always), OR
#      (c) `runMode == "depth"` (DENY regardless of currentPass)
#    DENY. Pass 1 of `mode: standard` (formerly `mode: depth`) is strict
#    per-journey by contract — `[group]` and `[P3-batch]` are only permitted
#    on Passes 2-5. Under `mode: depth` (first-class strict-everywhere) those
#    markers are forbidden on every pass.
#
# 2. Author-without-≥2-cycle-1-sections forbidden.
#    If the description starts with `phase4-prioritise-author:` AND
#    `.phase4-cycle-state.json` either doesn't exist OR cycle 1 contains
#    fewer than 2 distinct dispatched sections, DENY. The author may only
#    run after the strict per-section cycle-1 wave has produced its baseline.
#
# 3. Single-agent-collapse forbidden (cycle-1 under standard, every cycle
#    under depth).
#    If the description appears to be a single subagent attempting to walk
#    multiple sections sequentially (heuristic: description mentions ≥3
#    canonical section IDs joined with commas or "and"), AND EITHER:
#      (a) `.phase4-cycle-state.json` doesn't exist OR cycle 1 has zero
#          dispatched sections (cycle-1 collapse → DENY always), OR
#      (b) `cycleStrictness == "depth"` (DENY for ANY cycle — including
#          cycle 2+, even after cycle 1 has dispatched sections recorded)
#    DENY. This catches the failure mode where a single agent "walks" the
#    whole app and hides the parallelism the protocol was designed for.
#
# Under `runMode: standard` and `cycleStrictness: standard` (the defaults),
# rules 1 and 3 silent-allow once the strict contract relaxes (currentPass ≥ 2
# for coverage-expansion; cycle 1 dispatched-sections recorded for
# journey-mapping). Under `runMode: depth` / `cycleStrictness: depth`, the
# strict contract holds across all passes / cycles.
#
# Empirical origin
# ----------------
# In a benchmark onboarding run on a 21-journey app, Phase 4 collapsed to a
# single subagent under `phases: 'full'` mode and produced shallow per-section
# coverage. Pass 1 grouping on coverage-expansion was observed to dilute
# Test-expectations coverage across grouped journeys. The strict-on-first-X
# rule captures the high-value fidelity moment without forbidding grouping on
# the later passes / cycles where it pays.
#
# Canonical reference
# -------------------
# skills/coverage-expansion/SKILL.md §"Stage A per-journey dispatch is
#   non-negotiable" — first-pass strict rule
# skills/journey-mapping/SKILL.md §"Iterative discovery cycles" — first-cycle
#   strict rule
# schemas/subagent-returns/handover.schema.json — `dispatch-mode` enum
#
# Failure → action
# ----------------
# Pass-1 [group] / [P3-batch]      → DENY with fix-message pointing at the rule
# Cycle-1 author-without-≥2-sect.  → DENY with fix-message
# Cycle-1 single-agent collapse    → DENY with fix-message

# Intentional: `set -uo pipefail` without `-e`. The hook is input-tolerant by
# design — malformed stdin, missing state files, or jq extraction failures
# should silent-allow the dispatch rather than crash the PreToolUse pipeline.
set -uo pipefail

# Resolve jq.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH." >&2
  exit 1
fi

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")

# Only act on Agent dispatches.
[ "$TOOL_NAME" = "Agent" ] || exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""' 2>/dev/null || echo "")
[ -n "$DESCRIPTION" ] || exit 0

# Resolve the cwd (where the state files live) — fall back to "." if absent.
GUARD_CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
GUARD_REPO_ROOT=$(git -C "$GUARD_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$GUARD_CWD")
COV_STATE="$GUARD_REPO_ROOT/tests/e2e/docs/coverage-expansion-state.json"
CYCLE_STATE="$GUARD_REPO_ROOT/tests/e2e/docs/.phase4-cycle-state.json"

# Emit a DENY JSON with the supplied reason.
emit_deny() {
  local reason="$1"
  "$JQ" -n --arg r "$reason" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# ---------------------------------------------------------------------------
# Rule 1: Grouping forbidden (Pass-1 under standard, every pass under depth)
# ---------------------------------------------------------------------------
# Description starts with `[group]` or `[P3-batch]` (allowing whitespace).
if echo "$DESCRIPTION" | grep -qE '^[[:space:]]*\[(group|P3-batch)\]'; then
  # Determine current pass + run mode. If state file is absent, this is
  # implicitly Pass 1 (no Pass 1 dispatch has been recorded yet) AND the
  # mode defaults to "standard". If present, read both fields.
  CURRENT_PASS=""
  RUN_MODE="standard"
  if [ -f "$COV_STATE" ]; then
    CURRENT_PASS=$("$JQ" -r '.currentPass // empty' "$COV_STATE" 2>/dev/null || echo "")
    RUN_MODE_RAW=$("$JQ" -r '.runMode // "standard"' "$COV_STATE" 2>/dev/null || echo "standard")
    # Defensive: only accept the known enum values.
    case "$RUN_MODE_RAW" in
      depth) RUN_MODE="depth" ;;
      *)     RUN_MODE="standard" ;;
    esac
  fi
  # Under depth: DENY on any pass.
  # Under standard: DENY when currentPass empty OR == 1.
  if [ "$RUN_MODE" = "depth" ]; then
    emit_deny "[BLOCKED] Grouping forbidden on every pass under \`mode: depth\`.

Description: \"${DESCRIPTION}\"

\`mode: depth\` is the first-class strict-parallel-everywhere mode —
\`[group]\` and \`[P3-batch]\` markers are FORBIDDEN on every pass
(Passes 1, 2, 3, 4, AND 5), not just Pass 1. Under depth the cost is
explicit (up to ~20× more dispatches than \`mode: standard\`) and the
contract is exhaustive per-unit fidelity.

Fix: split this dispatch into N parallel single-journey dispatches in
one message (one \`composer-j-<slug>:\` or \`probe-j-<slug>:\` Agent
per journey, all sent in the same parallel wave). If grouping is
genuinely needed on this run, the operator must re-enter the onboarding
front-load gate and select \`runMode: standard\` instead.

See: skills/coverage-expansion/SKILL.md §\"Depth mode —
strict-parallel-everywhere\"."
    exit 0
  fi
  if [ -z "$CURRENT_PASS" ] || [ "$CURRENT_PASS" = "1" ]; then
    emit_deny "[BLOCKED] Pass-1 grouping forbidden under \`mode: standard\`.

Description: \"${DESCRIPTION}\"

Pass 1 of \`mode: standard\` (formerly \`mode: depth\`) is strict
per-journey by contract — \`[group]\` and \`[P3-batch]\` markers are
only permitted on Passes 2-5. The first pass establishes the test
foundation at maximum fidelity; that quality propagates through every
later pass.

Fix: split this dispatch into N parallel single-journey dispatches in
one message (one \`composer-j-<slug>:\` Agent per journey, all sent in
the same parallel wave). Re-issue any \`[group]\` / \`[P3-batch]\`
dispatches on Pass 2 or later, once Pass 1 has completed and the state
file shows \`currentPass >= 2\`.

See: skills/coverage-expansion/SKILL.md §\"Stage A per-journey dispatch
is non-negotiable\"."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Rule 2: phase4-prioritise-author without ≥2 cycle-1 sections forbidden
# ---------------------------------------------------------------------------
if echo "$DESCRIPTION" | grep -qE '^[[:space:]]*phase4-prioritise-author:'; then
  CYCLE_1_COUNT=0
  if [ -f "$CYCLE_STATE" ]; then
    # Count distinct dispatched-sections in cycle 1.
    CYCLE_1_COUNT=$("$JQ" -r '
      (.cycles["1"]["dispatched-sections"] // []) | unique | length
    ' "$CYCLE_STATE" 2>/dev/null || echo "0")
    # Defensive: empty/non-numeric → 0.
    case "$CYCLE_1_COUNT" in
      ''|*[!0-9]*) CYCLE_1_COUNT=0 ;;
    esac
  fi
  if [ "$CYCLE_1_COUNT" -lt 2 ]; then
    emit_deny "[BLOCKED] \`phase4-prioritise-author:\` dispatch denied — cycle 1 has not yet established the per-section baseline.

Description: \"${DESCRIPTION}\"

Journey-mapping cycle 1 (discovery) is strict per-section parallel in
EVERY mode (\`full\` and \`phases-2-4\`). The author may only run after
the strict cycle-1 wave has dispatched ≥ 2 distinct section subagents
and their returns have been recorded in
\`tests/e2e/docs/.phase4-cycle-state.json\`. Currently observed
cycle-1 dispatched-sections count: ${CYCLE_1_COUNT}.

Fix: dispatch \`phase4-cycle-1-section-<id>:\` subagents in one
parallel wave (one per target section from the discovery draft's
\`cycle-1-targets\`), wait for their returns to land in the state
file, then re-dispatch the author.

See: skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\"."
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Rule 3: Cycle-1 single-agent collapse forbidden
# ---------------------------------------------------------------------------
# Heuristic: if the description names ≥ 3 canonical section IDs joined with
# commas or "and", AND no cycle-1 dispatches exist yet, this is a single
# subagent attempting to do all of cycle 1 sequentially.
#
# Canonical section IDs come from hooks/data/canonical-sections.txt where
# available; fall back to a curated subset if the file is missing.
SECTIONS_DATA="$(dirname "${BASH_SOURCE[0]}")/data/canonical-sections.txt"
CANONICAL_SECTIONS=""
if [ -f "$SECTIONS_DATA" ]; then
  # Strip blanks + comments.
  CANONICAL_SECTIONS=$(grep -vE '^[[:space:]]*(#|$)' "$SECTIONS_DATA" 2>/dev/null | tr '\n' ' ')
fi
# Fallback list — matches the section vocabulary table in
# skills/journey-mapping/SKILL.md §"Section vocabulary".
if [ -z "$CANONICAL_SECTIONS" ]; then
  CANONICAL_SECTIONS="auth profile admin catalog detail cart order billing marketplace content documentation dashboard settings integrations notifications inbox support reports analytics error"
fi

# Count how many distinct canonical section IDs are mentioned, requiring word
# boundaries so we don't match e.g. "authentication" when looking for "auth".
HIT_COUNT=0
HIT_NAMES=""
for sec in $CANONICAL_SECTIONS; do
  # \b-style word boundaries via grep -w on a tokenised description.
  # Replace commas + "and" with whitespace first so multi-section lists like
  # "auth, cart, and order" tokenise cleanly.
  TOKENS=$(echo "$DESCRIPTION" | sed -E 's/[,]/ /g; s/[[:space:]]+and[[:space:]]+/ /g' | tr -s ' ')
  if echo "$TOKENS" | grep -qiwE "$sec"; then
    HIT_COUNT=$((HIT_COUNT + 1))
    HIT_NAMES="${HIT_NAMES}${sec} "
  fi
done

if [ "$HIT_COUNT" -ge 3 ]; then
  # Read cycle state: dispatched-sections count + cycleStrictness.
  CYCLE_1_DISPATCHED=0
  CYCLE_STRICTNESS="standard"
  if [ -f "$CYCLE_STATE" ]; then
    CYCLE_1_DISPATCHED=$("$JQ" -r '
      (.cycles["1"]["dispatched-sections"] // []) | length
    ' "$CYCLE_STATE" 2>/dev/null || echo "0")
    case "$CYCLE_1_DISPATCHED" in
      ''|*[!0-9]*) CYCLE_1_DISPATCHED=0 ;;
    esac
    CYCLE_STRICTNESS_RAW=$("$JQ" -r '.cycleStrictness // "standard"' "$CYCLE_STATE" 2>/dev/null || echo "standard")
    case "$CYCLE_STRICTNESS_RAW" in
      depth) CYCLE_STRICTNESS="depth" ;;
      *)     CYCLE_STRICTNESS="standard" ;;
    esac
  fi
  # Only fire on actual walkthrough attempts, not legitimate author /
  # validator dispatches that reference multiple sections in their brief.
  # Heuristic: skip the rule when the role prefix is one of the legitimate
  # multi-section consumers.
  case "$DESCRIPTION" in
    phase4-prioritise-author:*|phase-validator-*|process-validator-*|cleanup-*) ;;
    *)
      # Under cycleStrictness: depth, DENY for ANY cycle (including cycle 2+
      # after cycle 1 has dispatched-sections recorded). Under standard,
      # DENY only when no cycle-1 dispatches exist yet.
      if [ "$CYCLE_STRICTNESS" = "depth" ]; then
        emit_deny "[BLOCKED] Single-subagent walkthrough forbidden on every cycle under \`cycleStrictness: depth\`.

Description: \"${DESCRIPTION}\"

Detected canonical section IDs in the brief: ${HIT_NAMES}(${HIT_COUNT})

Under \`cycleStrictness: depth\` (selected via onboarding's
\`runMode: depth\` front-load gate), every cycle — cycle 1 AND every
later cycle (edge-probe and any additional discovery cycles) — is
strict per-section parallel. A single subagent attempting to walk ≥ 3
sections in one dispatch is the failure mode the protocol exists to
prevent, and the strict contract does not relax after cycle 1 under
depth.

Fix: split this dispatch into N parallel
\`phase4-cycle-<N>-section-<id>:\` subagents in one message (one Agent
per target section). If single-agent cycle-2+ dispatches are genuinely
acceptable for this run, the operator must re-enter the onboarding
front-load gate and select \`runMode: standard\` instead.

See: skills/journey-mapping/SKILL.md §\"First-cycle strict /
later-cycle relaxed\" — every-cycle-strict counterpart under depth."
        exit 0
      fi
      if [ "$CYCLE_1_DISPATCHED" -eq 0 ]; then
        emit_deny "[BLOCKED] Single-subagent walkthrough of journey-mapping cycle 1 forbidden.

Description: \"${DESCRIPTION}\"

Detected canonical section IDs in the brief: ${HIT_NAMES}(${HIT_COUNT})

Journey-mapping cycle 1 (discovery) is strict per-section parallel in
EVERY mode. A single subagent attempting to walk ≥ 3 sections in one
dispatch is the failure mode the protocol exists to prevent — it
produces shallow per-section coverage and hides the parallelism the
skill was designed for.

Fix: split this dispatch into N parallel \`phase4-cycle-1-section-<id>:\`
subagents in one message (one Agent per target section). After the
strict cycle-1 wave returns, cycle 2+ (edge-probe / additional
discovery) may use a single subagent if the orchestrator chooses —
the strict contract relaxes from cycle 2 onward (under
\`cycleStrictness: standard\`; depth keeps the strict contract on every
cycle).

See: skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\"."
        exit 0
      fi
      ;;
  esac
fi

# All checks passed — silent allow.
exit 0
