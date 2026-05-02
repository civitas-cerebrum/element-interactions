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
# When a reviewer subagent stops with `status: improvements-needed`, its
# return body MUST conform to §2.6 of subagent-return-schema.md:
#
#   1. The full `missing-scenarios:` / `craft-issues:` /
#      `verification-misses:` sub-lists are written to a canonical spill
#      file at:
#          tests/e2e/docs/.subagent-returns/reviewer-<journey>-<pass>-c<cycle>.md
#      The file's first line carries the sentinel comment
#          <!-- subagent-returns:reviewer:<journey>:pass-<N>:cycle-<C> -->
#   2. The return body inlines only index-level fields:
#          status / journey / pass / cycle / spill: <path> / findings: <ID-list>
#      No inline `missing-scenarios:` / `craft-issues:` /
#      `verification-misses:` sub-list headers.
#
# Non-compliance triggers exit 2 with stderr feedback. Claude Code blocks
# the subagent's stop and injects the feedback as the next-turn input;
# the subagent rewrites in-session. The orchestrator's tool result is
# the FINAL compliant return; the original verbose body is suppressed.
#
# Why hard enforcement (not WARN) at Stage 1
# -------------------------------------------
# The §2.6 schema is binary: spill file exists at the canonical path or
# it doesn't; body has inline sub-list headers or it doesn't. Calibration
# of fuzzy non-compliance is not needed — there is no fuzzy zone. WARN-
# only enforcement is a porous fence: every non-compliant first return
# leaks the body into the orchestrator's transcript before the WARN
# fires post-hoc. Hard enforcement at SubagentStop closes the gap by
# intercepting BEFORE the parent sees anything.
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
# intervene. The cap is generous (3 rewrites cover the most likely
# single-misunderstanding cases) but not unbounded.
#
# Canonical reference
# -------------------
# skills/element-interactions/references/subagent-return-schema.md §2.6
#   (spillover contract — path convention, body shape, schema-guard
#    audit-trail role, this hook's enforcement role)
#
# Failure → action
# ----------------
# - Non-reviewer role                                           → silent allow
# - Reviewer + status != improvements-needed (e.g. greenlight)  → silent allow
# - Reviewer + improvements-needed + spill file present + body
#   has no inline sub-list headers                              → silent allow,
#                                                                 counter cleared
# - Reviewer + improvements-needed + spill file absent OR body
#   inlines sub-list headers                                    → exit 2 with
#                                                                 stderr feedback,
#                                                                 counter
#                                                                 incremented
# - Counter ≥ 3                                                 → exit 0 with
#                                                                 [CAP-REACHED]
#                                                                 stderr WARN,
#                                                                 counter cleared
# - Empty / unparseable last_assistant_message                  → silent allow
# - Cannot extract handover envelope                            → silent allow
#                                                                 (defer to
#                                                                 PostToolUse
#                                                                 schema-guard)

set -euo pipefail

# --- input ---
INPUT=$(cat)

# Claude Code SubagentStop input shape (verified empirically — see
# implementation thread on #145):
#   {
#     "session_id": "...",
#     "transcript_path": "...",
#     "cwd": "...",
#     "permission_mode": "auto",
#     "agent_id": "...",
#     "agent_type": "general-purpose",
#     "hook_event_name": "SubagentStop",
#     "stop_hook_active": false,
#     "agent_transcript_path": "...",
#     "last_assistant_message": "<the subagent's final return text>"
#   }
#
# `last_assistant_message` is the subagent's final return as a single
# string — exactly what we need to validate. No JSONL parsing required.

RESPONSE=$(echo "$INPUT" | jq -r '.last_assistant_message // ""' 2>/dev/null || echo "")
[ -z "$RESPONSE" ] && exit 0

AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // empty' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")

# --- handover envelope parse (§2.0) ---------------------------------------
# Extract the indented block under a top-level `handover:` line. Same
# pattern as subagent-return-schema-guard.sh. `|| true` guards against
# set -e + pipefail when input doesn't contain an envelope.
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

# --- scope: reviewer + improvements-needed only ---------------------------
case "$HANDOVER_ROLE" in
  reviewer-j-*|reviewer-sj-*) ;;
  *) exit 0 ;;  # not in scope
esac
[ "$HANDOVER_STATUS" != "improvements-needed" ] && exit 0

# --- extract body fields needed for spill path ----------------------------
# Strip envelope from RESPONSE so body fields don't collide with envelope
# fields of the same name. Same pattern as subagent-return-schema-guard.sh.
BODY=$(echo "$RESPONSE" | awk '
  /^handover:[[:space:]]*$/ { in_block = 1; next }
  in_block {
    if (/^[[:space:]]+/ || /^$/) { next }
    in_block = 0
  }
  { print }
' || true)

JOURNEY=$(echo "$BODY" | grep -E '^[[:space:]]*journey:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*journey:[[:space:]]*//' | tr -d '[:space:]' || true)
PASS=$(echo "$BODY" | grep -E '^[[:space:]]*pass:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*pass:[[:space:]]*//' | tr -d '[:space:]' || true)
CYCLE=$(echo "$BODY" | grep -E '^[[:space:]]*cycle:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*cycle:[[:space:]]*//' | tr -d '[:space:]' || true)

# Without journey/pass/cycle, we can't construct a spill path. Defer to
# PostToolUse:Agent schema-guard which will WARN about missing fields.
if [ -z "$JOURNEY" ] || [ -z "$PASS" ] || [ -z "$CYCLE" ]; then
  exit 0
fi

SPILL_REL="tests/e2e/docs/.subagent-returns/reviewer-${JOURNEY}-${PASS}-c${CYCLE}.md"
SPILL_PATH="$REPO_ROOT/$SPILL_REL"
SPILL_DIR=$(dirname "$SPILL_PATH")

# --- compliance checks ----------------------------------------------------
VIOLATIONS=()

if [ ! -f "$SPILL_PATH" ]; then
  VIOLATIONS+=("spill file absent at $SPILL_REL")
fi

# Inline sub-list check: detail belongs in the spill file, not in the body.
# Match a header line followed (within the body) by a `  - **<...>**` row
# (the canonical finding-block bullet shape from §1).
if echo "$BODY" | grep -qE '^[[:space:]]*(missing-scenarios|craft-issues|verification-misses):[[:space:]]*$'; then
  # Header present. Check if any sub-bullets follow.
  if echo "$BODY" | grep -qE '^[[:space:]]+-[[:space:]]+\*\*[a-z0-9-]+'; then
    VIOLATIONS+=("body inlines missing-scenarios/craft-issues/verification-misses sub-list — that detail belongs in the spill file, return body should carry only the finding-ID list")
  fi
fi

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
  # Cap reached. Allow stop with a loud WARN visible to the orchestrator.
  # The non-compliant return lands in the orchestrator's context as a last
  # resort — better visible failure than silent loop.
  echo "[CAP-REACHED] reviewer ${HANDOVER_ROLE} cycle ${CYCLE}: §2.6 spillover non-compliance after ${CAP} rewrite attempts. Final return left non-compliant; orchestrator will see the verbose body. Manual review required — check why the subagent could not produce: spill file at ${SPILL_REL}, body without inline sub-lists." >&2
  if [ -n "$COUNTER_FILE" ]; then
    rm -f "$COUNTER_FILE" 2>/dev/null || true
  fi
  exit 0
fi

# Increment counter, emit feedback, exit 2 to block the stop.
NEXT=$((COUNT + 1))
if [ -n "$COUNTER_FILE" ]; then
  echo "$NEXT" > "$COUNTER_FILE" 2>/dev/null || true
fi

# Stderr feedback. Action-first format. Includes the exact compliant
# shape so the subagent can rewrite without ambiguity.
{
  echo "[SPILLOVER-REWRITE-NEEDED — attempt ${NEXT}/${CAP}]"
  echo ""
  echo "Your reviewer return is non-compliant with §2.6 of subagent-return-schema.md:"
  for v in "${VIOLATIONS[@]}"; do
    echo "  - $v"
  done
  echo ""
  echo "Rewrite as follows:"
  echo ""
  echo "1. Write the full missing-scenarios / craft-issues / verification-misses"
  echo "   sub-lists (with their existing sub-bullets) to:"
  echo ""
  echo "     ${SPILL_REL}"
  echo ""
  echo "   Start the file with this sentinel as line 1:"
  echo "     <!-- subagent-returns:reviewer:${JOURNEY}:pass-${PASS}:cycle-${CYCLE} -->"
  echo ""
  echo "   (Create the directory ${SPILL_DIR#${REPO_ROOT}/} if it does not exist.)"
  echo ""
  echo "2. Replace your return body with index-only fields:"
  echo ""
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
  echo "3. Keep the §2.0 handover envelope at the top, unchanged."
  echo ""
  echo "Why: the verbose finding sub-lists carry 1-3k tokens each cycle. Inlining"
  echo "them in the return body absorbs that detail into the orchestrator's"
  echo "transcript every retry. The spillover contract keeps the orchestrator's"
  echo "context at index-level state; the next composer-cycle subagent reads"
  echo "the spill file when it needs the must-fix detail."
} >&2

exit 2
