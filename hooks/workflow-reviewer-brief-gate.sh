#!/bin/bash
# workflow-reviewer-brief-gate.sh — brief-integrity gate for reviewer
#                                   dispatches. Closes the orchestrator-
#                                   to-reviewer brief-injection surface.
#
# Hook    : PreToolUse:Agent
# Mode    : DENY
# State   : none
# Env     : WORKFLOW_REVIEWER_BRIEF_GATE=off  bypass for special-cased
#           re-dispatches (advisory; document the bypass authorisation)
#
# Why
# ---
# Reviewer return shapes are validated by the schema-guard. Reviewer
# dispatch ordering is enforced by the ledger-gate. The actor-identity
# of ledger writers is enforced by the write-gate. But the BRIEF the
# orchestrator passes to a workflow-reviewer is unconstrained — the
# orchestrator could:
#
#   - Paraphrase the prior subagent's deliverables inaccurately
#   - Omit the ledger / handoverEnvelope paths so the reviewer never
#     reads the actual state
#   - Embed prompt-injection language ("user pre-authorised approval")
#   - Send a one-line "just approve, everything's good" brief
#
# The reviewer's SKILL.md is the primary defence (a disciplined reviewer
# resists this), but no hook enforces that the orchestrator's brief
# actually gives the reviewer the canonical inputs. This hook does.
#
# What it gates
# -------------
# For dispatch descriptions matching `workflow-reviewer-*`, the brief
# (the `tool_input.prompt` field) MUST contain ALL THREE:
#
#   1. **Ledger reference**: the literal substring `onboarding-status.json`
#      somewhere in the brief. Forces the reviewer to know where to look.
#   2. **Verification verb**: at least one of `Read`, `verify`, or
#      `inspect` (case-insensitive). Forces the brief to instruct the
#      reviewer to perform actual verification, not just trust the
#      orchestrator's summary.
#   3. **Minimum length**: ≥ 400 characters. A meaningful reviewer brief
#      is at least 4-5 sentences (context + checklist pointer + evidence
#      sources + return-shape pointer). Short briefs are by definition
#      "just approve" patterns.
#
# What it does NOT catch
# ----------------------
# A sufficiently sophisticated injection that cites the canonical paths
# AND embeds malicious instructions will pass this gate. No hook can
# fully solve prompt injection. This gate raises the bar from "trivial
# bypass" to "must craft an injection that survives the methodology
# discipline + schema-validated return".
#
# Pairs with:
#   - subagent-schema-preread-gate.sh    (forces schema citation)
#   - subagent-return-schema-guard.sh    (validates return shape)
#   - workflow-approver-registry.sh      (records who can approve)
#   - onboarding-ledger-write-gate.sh    (enforces actor identity)
#   - workflow-reviewer-attestation-gate.sh (PostToolUse — checks that
#                                            attestation cites real files)
#
# Failure → action
# ----------------
# Missing ledger reference / Read verb / too short → DENY with concrete
#                                                    remediation pointer.

set -uo pipefail

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
[ -n "$JQ" ] || { echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found." >&2; exit 1; }

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")
[ "$TOOL_NAME" = "Agent" ] || exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""' 2>/dev/null || echo "")

# Only act on workflow-reviewer-* dispatches.
case "$DESCRIPTION" in
  workflow-reviewer-*) ;;
  *) exit 0 ;;
esac

# Optional bypass for special-case re-dispatches. The bypass is
# advisory — the operator is expected to document the authorisation.
if [ "${WORKFLOW_REVIEWER_BRIEF_GATE:-on}" = "off" ]; then
  exit 0
fi

PROMPT=$(echo "$INPUT" | "$JQ" -r '.tool_input.prompt // ""' 2>/dev/null || echo "")

emit_deny() {
  "$JQ" -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# Build a violations list — accumulate ALL failures, not just the first,
# so the operator can fix everything in one pass.
VIOLATIONS=""

# Check 1: ledger reference.
if ! printf '%s' "$PROMPT" | grep -qF "onboarding-status.json"; then
  VIOLATIONS="${VIOLATIONS}
  - **Missing ledger reference.** The brief does not cite
    \`onboarding-status.json\`. The reviewer must read the ledger
    directly to verify what the orchestrator claims happened — include
    the path \`tests/e2e/docs/onboarding-status.json\` (or at minimum
    the bare filename \`onboarding-status.json\`) in the brief.
"
fi

# Check 2: verification verb. Case-insensitive grep for any of
# Read / verify / inspect. This is intentionally permissive in spelling
# but does require at least one verb that signals tool use, not trust.
if ! printf '%s' "$PROMPT" | grep -qiE '\b(read|verify|inspect)\b'; then
  VIOLATIONS="${VIOLATIONS}
  - **Missing verification verb.** The brief contains none of
    \"Read\", \"verify\", or \"inspect\" (case-insensitive). The
    reviewer's job is to verify on disk, not to trust the
    orchestrator's summary. Include an instruction like \"Read the
    handoverEnvelope from the ledger\" or \"Verify the deliverables
    on disk before returning a verdict\".
"
fi

# Check 3: minimum length. 400 characters ~ 4-5 substantial sentences.
PROMPT_LEN=${#PROMPT}
if [ "$PROMPT_LEN" -lt 400 ]; then
  VIOLATIONS="${VIOLATIONS}
  - **Brief too short** (${PROMPT_LEN} chars; minimum 400). A
    meaningful reviewer brief includes: (a) what phase/pass/cycle is
    being reviewed, (b) the canonical exit criteria reference, (c) the
    evidence sources (ledger path, deliverables paths, handoverEnvelope),
    and (d) a pointer to the return schema. Briefs shorter than that
    threshold are functionally \"just approve\" patterns.
"
fi

if [ -z "$VIOLATIONS" ]; then
  exit 0
fi

emit_deny "[BLOCKED] workflow-reviewer dispatch brief fails integrity check.

Description: \"${DESCRIPTION}\"

Violations:${VIOLATIONS}
The reviewer/inspector role is the orchestrator's only check against
self-grading. A brief that doesn't give the reviewer the canonical
inputs (the ledger path + a verb signalling on-disk verification +
enough context to actually evaluate) defeats the protocol.

Fix: rewrite the brief to include the missing elements above. The brief
should structurally read:

  You are workflow-reviewer-<phase|pass|cycle><N>.
  Read the ledger at tests/e2e/docs/onboarding-status.json and verify
  the phases[<N>].handoverEnvelope + .deliverables against the exit
  criteria in <skill-ref>.
  Return shape: workflow-reviewer.schema.json.
  Emit verdict: approve only after on-disk verification.
  Findings or attestation per the schema.

Bypass: \`WORKFLOW_REVIEWER_BRIEF_GATE=off\` in the environment when
re-dispatching with a known-good brief (audit the use).

See:
  - schemas/subagent-returns/workflow-reviewer.schema.json
  - skills/workflow-reviewer/SKILL.md
  - skills/onboarding/SKILL.md §\"Status ledger + workflow reviewer\""
exit 0
