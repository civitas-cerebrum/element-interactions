#!/bin/bash
# subagent-spillover-rewrite-gate.sh — §2.6 spillover hard enforcer
#
# Hook    : SubagentStop
# Mode    : BLOCK (exit 2 with stderr feedback) on non-compliance, until
#           the per-agent_id rewrite counter reaches 3, then ALLOW with a
#           loud WARN visible to the parent orchestrator.
# State   : per-agent rewrite counter at /tmp/sst-rewrite-counter-<agent_id>
# Env     : none
#
# Rule
# ----
# When a subagent stops with a status that triggers spillover (per the
# §2.6 table below), its return body MUST conform: the structured detail
# moves to a canonical spill file on disk, the body inlines only
# index-level fields.
#
#   Role                 Status that triggers spillover
#   -------------------  -------------------------------
#   composer-            covered-exhaustively
#   reviewer-            improvements-needed
#   probe-               findings-emitted
#   process-validator-   block
#   phase-validator-     improvements-needed
#
# All other status / role combinations are silent-allowed.
#
# Non-compliance triggers exit 2 with stderr feedback. Claude Code blocks
# the subagent's stop and injects the feedback as the next-turn input;
# the subagent rewrites in-session. The orchestrator's tool result is
# the FINAL compliant return; the original verbose body is suppressed.
#
# Why hard enforcement (not WARN)
# -------------------------------
# The §2.6 schema is binary: spill file exists at the canonical path or
# it doesn't; body has the role's inline forbidden shape or it doesn't.
# Calibration of fuzzy non-compliance is not needed — there is no fuzzy
# zone. WARN-only enforcement is a porous fence: every non-compliant
# first return leaks the body into the orchestrator's transcript before
# the WARN fires post-hoc. Hard enforcement at SubagentStop closes the
# gap by intercepting BEFORE the parent sees anything.
#
# Empirical verification of the SubagentStop exit-2-stderr in-session
# rewrite mechanism: see the implementation thread on issue #145.
#
# Why the cap (3 rewrites) is non-zero
# ------------------------------------
# Without a cap, a subagent that genuinely cannot produce a compliant
# return (broken understanding, contradictory feedback, environment
# issue) would loop indefinitely. The cap converts that failure mode
# from "infinite spinning" to "visible loud WARN after 3 attempts" —
# the orchestrator sees the failure, surfaces it, and the operator can
# intervene.
#
# Canonical reference
# -------------------
# skills/element-interactions/references/subagent-return-schema.md §2.6
#   (spillover contract — per-role path conventions, body shapes,
#    schema-guard audit-trail role, this hook's enforcement role)

set -euo pipefail

# --- input ---
INPUT=$(cat)

RESPONSE=$(echo "$INPUT" | jq -r '.last_assistant_message // ""' 2>/dev/null || echo "")
[ -z "$RESPONSE" ] && exit 0

AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")

# --- handover envelope parse (§2.0) ---------------------------------------
HANDOVER_BLOCK=""
if echo "$RESPONSE" | grep -qE '(^|\n)handover:[[:space:]]*$'; then
  HANDOVER_BLOCK=$(echo "$RESPONSE" | awk '
    /^handover:[[:space:]]*$/ { in_block = 1; next }
    in_block {
      if (/^[[:space:]]+/ || /^$/) { print; next }
      exit
    }
  ' || true)
fi

HANDOVER_ROLE=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+role:' | head -1 | sed -E 's/^[[:space:]]+role:[[:space:]]*//' | tr -d '[:space:]' || true)
HANDOVER_STATUS=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+status:' | head -1 | sed -E 's/^[[:space:]]+status:[[:space:]]*//' | tr -d '[:space:]' || true)

# --- dispatch on role + status to determine spillover applicability -------
# ROLE_KIND becomes one of: composer | reviewer | probe | process-validator
# | phase-validator. Empty (silent-allow) for unmatched roles or non-
# triggering statuses. Each ROLE_KIND has its own spill-path computation
# and body-shape inline-violation detector below.

ROLE_KIND=""
case "$HANDOVER_ROLE" in
  composer-j-*|composer-sj-*)
    [ "$HANDOVER_STATUS" = "covered-exhaustively" ] && ROLE_KIND="composer"
    ;;
  reviewer-j-*|reviewer-sj-*)
    [ "$HANDOVER_STATUS" = "improvements-needed" ] && ROLE_KIND="reviewer"
    ;;
  probe-j-*|probe-sj-*)
    [ "$HANDOVER_STATUS" = "findings-emitted" ] && ROLE_KIND="probe"
    ;;
  process-validator-*)
    [ "$HANDOVER_STATUS" = "block" ] && ROLE_KIND="process-validator"
    ;;
  phase-validator-*)
    [ "$HANDOVER_STATUS" = "improvements-needed" ] && ROLE_KIND="phase-validator"
    ;;
esac

# Not in scope (other role / non-triggering status) → silent allow.
[ -z "$ROLE_KIND" ] && exit 0

# --- extract body fields needed for spill path computation ----------------
# Strip envelope from RESPONSE so body fields don't collide with envelope
# fields of the same name.
BODY=$(echo "$RESPONSE" | awk '
  /^handover:[[:space:]]*$/ { in_block = 1; next }
  in_block {
    if (/^[[:space:]]+/ || /^$/) { next }
    in_block = 0
  }
  { print }
' || true)

extract_field() {
  # extract_field <field-name>
  echo "$BODY" | grep -E "^[[:space:]]*${1}:[[:space:]]*" | head -1 | sed -E "s/^[[:space:]]*${1}:[[:space:]]*//" | tr -d '[:space:]' || true
}

# --- per-role spill path computation --------------------------------------
SPILL_REL=""
SPILL_SENTINEL=""
case "$ROLE_KIND" in
  composer|reviewer|probe)
    JOURNEY=$(extract_field journey)
    PASS=$(extract_field pass)
    CYCLE=$(extract_field cycle)
    if [ -z "$JOURNEY" ] || [ -z "$PASS" ] || [ -z "$CYCLE" ]; then
      # Missing identifying fields. Defer to PostToolUse:Agent schema-guard
      # to WARN about the malformed return.
      exit 0
    fi
    SPILL_REL="tests/e2e/docs/.subagent-returns/${ROLE_KIND}-${JOURNEY}-${PASS}-c${CYCLE}.md"
    SPILL_SENTINEL="<!-- subagent-returns:${ROLE_KIND}:${JOURNEY}:pass-${PASS}:cycle-${CYCLE} -->"
    ;;
  phase-validator)
    PHASE=$(extract_field phase)
    CYCLE=$(extract_field cycle)
    if [ -z "$PHASE" ] || [ -z "$CYCLE" ]; then
      exit 0
    fi
    SPILL_REL="tests/e2e/docs/.subagent-returns/phase-validator-${PHASE}-c${CYCLE}.md"
    SPILL_SENTINEL="<!-- subagent-returns:phase-validator:${PHASE}:cycle-${CYCLE} -->"
    ;;
  process-validator)
    # Scope is in the role suffix: process-validator-stage-a-wave → stage-a-wave
    SCOPE=$(echo "$HANDOVER_ROLE" | sed -E 's/^process-validator-//' || true)
    CYCLE=$(extract_field cycle)
    if [ -z "$SCOPE" ] || [ -z "$CYCLE" ]; then
      exit 0
    fi
    SPILL_REL="tests/e2e/docs/.subagent-returns/process-validator-${SCOPE}-c${CYCLE}.md"
    SPILL_SENTINEL="<!-- subagent-returns:process-validator:${SCOPE}:cycle-${CYCLE} -->"
    ;;
esac

SPILL_PATH="$REPO_ROOT/$SPILL_REL"

# --- compliance checks ----------------------------------------------------
VIOLATIONS=()

if [ ! -f "$SPILL_PATH" ]; then
  VIOLATIONS+=("spill file absent at $SPILL_REL")
fi

# Per-role inline-violation detection. The forbidden shape is the
# structured detail block that should have moved to disk. If both the
# header marker and a sub-bullet shape are present, the body is
# inlining detail that belongs in the spill file.
case "$ROLE_KIND" in
  composer)
    # Forbidden inline: per-expectation mapping table header.
    if echo "$BODY" | grep -qE '^\|[[:space:]]*Expectation[[:space:]]*\|[[:space:]]*Covering spec[[:space:]]*\|[[:space:]]*Test name[[:space:]]*\|'; then
      VIOLATIONS+=("body inlines per-expectation mapping table — that detail belongs in the spill file, return body should carry only expectations-mapped: <count>")
    fi
    ;;
  reviewer)
    # Forbidden inline: missing-scenarios / craft-issues / verification-misses
    # header followed by a sub-bullet (`  - **<id>**` row).
    if echo "$BODY" | grep -qE '^[[:space:]]*(missing-scenarios|craft-issues|verification-misses):[[:space:]]*$' && \
       echo "$BODY" | grep -qE '^[[:space:]]+-[[:space:]]+\*\*[a-z0-9-]+'; then
      VIOLATIONS+=("body inlines missing-scenarios/craft-issues/verification-misses sub-list — that detail belongs in the spill file, return body should carry only the finding-ID list")
    fi
    ;;
  probe)
    # Forbidden inline: findings: header followed by a finding sub-block
    # (`  - **<id>** [severity]`). The index-only `findings:` line carries
    # bare IDs, not full blocks.
    if echo "$BODY" | grep -qE '^[[:space:]]*findings:[[:space:]]*$' && \
       echo "$BODY" | grep -qE '^[[:space:]]+-[[:space:]]+\*\*[a-z0-9-]+\*\*[[:space:]]+\[(critical|high|medium|low|info)\]'; then
      VIOLATIONS+=("body inlines findings: sub-list with full finding-blocks — that detail belongs in the spill file, return body should carry only the finding-ID list (one bullet per finding, IDs only)")
    fi
    ;;
  process-validator)
    # Forbidden inline: violations: header followed by a violation sub-block
    # (`  - **<id>** [must-fix]` row).
    if echo "$BODY" | grep -qE '^[[:space:]]*violations:[[:space:]]*$' && \
       echo "$BODY" | grep -qE '^[[:space:]]+-[[:space:]]+\*\*[a-z0-9-]+\*\*[[:space:]]+\[must-fix\]'; then
      VIOLATIONS+=("body inlines violations: sub-list with full blocks — that detail belongs in the spill file, return body should carry only the violation-ID list")
    fi
    ;;
  phase-validator)
    # Forbidden inline: exit-criteria-checked array OR pv-<phase>-<nn>
    # finding blocks.
    if echo "$BODY" | grep -qE '^[[:space:]]*exit-criteria-checked:[[:space:]]*$' && \
       echo "$BODY" | grep -qE '^[[:space:]]+-[[:space:]]+criterion:'; then
      VIOLATIONS+=("body inlines exit-criteria-checked: array — that detail belongs in the spill file, return body should carry only summary + finding-ID list")
    fi
    if echo "$BODY" | grep -qE '^[[:space:]]+-[[:space:]]+\*\*pv-[1-7]-[0-9]{2,}\*\*[[:space:]]+\[must-fix\]'; then
      # Sub-bullet evidence — pv-finding blocks shouldn't be inlined.
      VIOLATIONS+=("body inlines pv-<phase>-<nn> finding blocks with sub-bullets — that detail belongs in the spill file, return body should carry only the finding-ID list (just the pv-<phase>-<nn> IDs)")
    fi
    ;;
esac

# --- compliant: clear counter, allow stop ---------------------------------
if [ ${#VIOLATIONS[@]} -eq 0 ]; then
  if [ -n "$AGENT_ID" ]; then
    rm -f "/tmp/sst-rewrite-counter-${AGENT_ID}" 2>/dev/null || true
  fi
  exit 0
fi

# --- non-compliant: cap check, then exit 2 with feedback ------------------
COUNTER_FILE=""
COUNT=0
if [ -n "$AGENT_ID" ]; then
  COUNTER_FILE="/tmp/sst-rewrite-counter-${AGENT_ID}"
  COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
  case "$COUNT" in ''|*[!0-9]*) COUNT=0 ;; esac
fi

CAP=3

if [ "$COUNT" -ge "$CAP" ]; then
  echo "[CAP-REACHED] ${ROLE_KIND} ${HANDOVER_ROLE}: §2.6 spillover non-compliance after ${CAP} rewrite attempts. Final return left non-compliant; orchestrator will see the verbose body. Manual review required — check why the subagent could not produce: spill file at ${SPILL_REL}, body without inline forbidden shape." >&2
  if [ -n "$COUNTER_FILE" ]; then
    rm -f "$COUNTER_FILE" 2>/dev/null || true
  fi
  exit 0
fi

NEXT=$((COUNT + 1))
if [ -n "$COUNTER_FILE" ]; then
  echo "$NEXT" > "$COUNTER_FILE" 2>/dev/null || true
fi

# Per-role stderr feedback. Each role gets a tailored "rewrite as follows"
# block naming the canonical spill path + the index-only body shape it
# should emit. Format follows the action-first template so the subagent's
# rewrite is mechanical.

emit_feedback_header() {
  echo "[SPILLOVER-REWRITE-NEEDED — attempt ${NEXT}/${CAP}]"
  echo ""
  echo "Your ${ROLE_KIND} return is non-compliant with §2.6 of subagent-return-schema.md:"
  for v in "${VIOLATIONS[@]}"; do
    echo "  - $v"
  done
  echo ""
  echo "Rewrite as follows:"
  echo ""
  echo "1. Write the structured detail to:"
  echo "     ${SPILL_REL}"
  echo "   Start the file with this sentinel as line 1:"
  echo "     ${SPILL_SENTINEL}"
}

emit_feedback_footer_common() {
  echo "3. Keep the §2.0 handover envelope at the top, unchanged."
  echo ""
  echo "Why: the verbose detail carries hundreds-to-thousands of tokens each cycle. Inlining it absorbs that detail into the orchestrator's transcript every retry. The spillover contract keeps the orchestrator's context at index-level state; the next subagent (or the orchestrator's state-file update) reads the spill file when it needs the detail."
}

{
  emit_feedback_header
  echo ""
  echo "2. Replace your return body with index-only fields:"
  echo ""
  case "$ROLE_KIND" in
    composer)
      echo "     status: covered-exhaustively"
      echo "     journey: ${JOURNEY}"
      echo "     pass: ${PASS}"
      echo "     cycle: ${CYCLE}"
      echo "     spill: ${SPILL_REL}"
      echo "     expectations-mapped: <count>"
      echo ""
      echo "   The mapping table itself goes in the spill file (rows under the"
      echo "   | Expectation | Covering spec | Test name | header)."
      ;;
    reviewer)
      echo "     status: improvements-needed"
      echo "     journey: ${JOURNEY}"
      echo "     pass: ${PASS}"
      echo "     cycle: ${CYCLE}"
      echo "     spill: ${SPILL_REL}"
      echo "     findings:"
      echo "       - <FINDING-ID-1>"
      echo "       - <FINDING-ID-2>"
      echo "       (one bullet per finding, IDs only — no inline blocks)"
      echo ""
      echo "   The missing-scenarios / craft-issues / verification-misses sub-lists"
      echo "   with full sub-bullets go in the spill file."
      ;;
    probe)
      echo "     status: findings-emitted"
      echo "     journey: ${JOURNEY}"
      echo "     pass: ${PASS}"
      echo "     cycle: ${CYCLE}"
      echo "     spill: ${SPILL_REL}"
      echo "     probes: <count>"
      echo "     boundaries: <count>"
      echo "     findings:"
      echo "       - <FINDING-ID-1>"
      echo "       - <FINDING-ID-2>"
      echo "       (one bullet per finding, IDs only — no inline blocks)"
      echo ""
      echo "   The findings sub-list with full scope/expected/observed/coverage"
      echo "   sub-bullets goes in the spill file."
      ;;
    process-validator)
      echo "     status: block"
      echo "     scope: ${SCOPE}"
      echo "     cycle: ${CYCLE}"
      echo "     spill: ${SPILL_REL}"
      echo "     summary: <one sentence>"
      echo "     findings:"
      echo "       - <VIOLATION-ID-1>"
      echo "       - <VIOLATION-ID-2>"
      echo ""
      echo "   The per-violation blocks (under a violations: header) go in the"
      echo "   spill file."
      ;;
    phase-validator)
      echo "     status: improvements-needed"
      echo "     phase: ${PHASE}"
      echo "     sub-skill: <name>"
      echo "     cycle: ${CYCLE}"
      echo "     spill: ${SPILL_REL}"
      echo "     summary: <one sentence>"
      echo "     findings:"
      echo "       - pv-${PHASE}-<nn-1>"
      echo "       - pv-${PHASE}-<nn-2>"
      echo "       (one bullet per finding, just the pv-<phase>-<nn> IDs)"
      echo ""
      echo "   The exit-criteria-checked: array AND the pv-<phase>-<nn> finding"
      echo "   blocks (criterion / issue / fix sub-bullets) go in the spill file."
      ;;
  esac
  echo ""
  emit_feedback_footer_common
} >&2

exit 2
