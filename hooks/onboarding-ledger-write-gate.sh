#!/bin/bash
# onboarding-ledger-write-gate.sh — schema + state-machine integrity gate
#                                   for writes to the onboarding status
#                                   ledger.
#
# Hook    : PreToolUse:Write|Edit
# Mode    : DENY (blocks the write before it lands on disk)
# State   : reads schemas/onboarding-status.schema.json (from the bundled
#           package) plus the pre-existing tests/e2e/docs/onboarding-status.json
#           (when present) to validate the state-machine transition.
# Env     : none
#
# Why
# ---
# The ledger is the single source of truth for the pipeline state. A
# corrupted ledger silently degrades every downstream gate
# (onboarding-ledger-gate, workflow-reviewer briefings). This hook is the
# guard at the only mutation point.
#
# What it gates
# -------------
# 1. **Shape validation.** The proposed contents must validate against
#    schemas/onboarding-status.schema.json (via hooks/lib/validate-against-schema.mjs).
# 2. **No phase-skip transitions.** A write that bumps `currentPhase` from
#    N to N+2 with N+1 still `pending` is denied — every phase must
#    progress through `pending → in-progress → completed` in order
#    (skip-deviations are recorded by setting status: skipped + populating
#    `approvedDeviations[]`).
# 3. **No reviewerVerdict: approved without a handoverEnvelope.** A phase
#    cannot be approved unless the closing subagent's handover envelope
#    is captured in the same record.
# 4. **Actor-identity on approval transitions.** Any write that
#    transitions a phase's `reviewerVerdict` from non-approved to
#    `approved` MUST come from a registered approver subagent context.
#    Orchestrator-direct writes that approve a phase are denied — only
#    `workflow-reviewer-*` / `phase-validator-*` dispatches (tracked by
#    workflow-approver-registry.sh) can record approvals. This is the
#    separation-of-duties gate: the orchestrator does the work, an
#    approver subagent records the verdict.
# 5. **Silent-allow for non-ledger writes.** Only files whose path ends
#    with `tests/e2e/docs/onboarding-status.json` are gated.
# 6. **Silent-allow when the file is missing AND the write has no
#    approvals.** A fresh-run ledger init with all phases pending has
#    no actor-identity check (nothing is being approved).
#
# Canonical reference
# -------------------
# schemas/onboarding-status.schema.json
# skills/onboarding/SKILL.md §"Status ledger + workflow reviewer"
# hooks/lib/validate-against-schema.mjs
#
# Failure → action
# ----------------
# Shape invalid                    → DENY with schema-path + bad field
# Phase-skip without approval      → DENY naming the missing in-between phase
# reviewerVerdict approved w/o handover → DENY naming the empty field

set -uo pipefail

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH." >&2
  exit 1
fi

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")

# Only act on Write and Edit.
case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // empty' 2>/dev/null || echo "")

# Rule 4: silent-allow when this isn't a ledger write.
case "$FILE_PATH" in
  */tests/e2e/docs/onboarding-status.json) ;;
  *) exit 0 ;;
esac

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

# Extract the proposed contents. For Write the field is `content`; for
# Edit we synthesise by applying the patch to the existing file. For Edit
# without an existing file, the operation will fail downstream — silent
# allow here.
PROPOSED_CONTENT=""
case "$TOOL_NAME" in
  Write)
    PROPOSED_CONTENT=$(echo "$INPUT" | "$JQ" -r '.tool_input.content // empty' 2>/dev/null || echo "")
    ;;
  Edit)
    # For Edit we read the current file + apply old_string → new_string.
    OLD_STRING=$(echo "$INPUT" | "$JQ" -r '.tool_input.old_string // empty' 2>/dev/null || echo "")
    NEW_STRING=$(echo "$INPUT" | "$JQ" -r '.tool_input.new_string // empty' 2>/dev/null || echo "")
    if [ -f "$FILE_PATH" ] && [ -n "$OLD_STRING" ]; then
      # Naive single-replace. The Edit tool semantics match this when the
      # old_string is unique in the file.
      CURRENT=$(cat "$FILE_PATH" 2>/dev/null || echo "")
      # Use awk to do a literal-string replacement (avoids regex metachar
      # surprises in sed).
      PROPOSED_CONTENT=$(awk -v o="$OLD_STRING" -v n="$NEW_STRING" '
        BEGIN { RS="\0" }
        { sub(o, n); print }
      ' "$FILE_PATH" 2>/dev/null || echo "")
    fi
    ;;
esac

# Silent-allow when we couldn't extract content (malformed tool input).
[ -n "$PROPOSED_CONTENT" ] || exit 0

# Locate the schema. Two layout cases:
#   in-repo dev install     →  <repo>/schemas/onboarding-status.schema.json
#   installed dependency    →  <package>/schemas/onboarding-status.schema.json
SCHEMA_PATH="$(dirname "${BASH_SOURCE[0]}")/../schemas/onboarding-status.schema.json"
if [ ! -f "$SCHEMA_PATH" ]; then
  # Some installs land the schema under a different relative path. Fall
  # back to a parent-walk lookup.
  WALK="$(dirname "${BASH_SOURCE[0]}")"
  for _ in 1 2 3 4 5; do
    WALK="$(dirname "$WALK")"
    if [ -f "$WALK/schemas/onboarding-status.schema.json" ]; then
      SCHEMA_PATH="$WALK/schemas/onboarding-status.schema.json"
      break
    fi
  done
fi
# If still missing, silent-allow — the install is incomplete; better to
# permit the write than to jam the pipeline.
[ -f "$SCHEMA_PATH" ] || exit 0

# Write the proposed content to a tempfile and run Ajv via node.
TMP_PROPOSED=$(mktemp /tmp/onboarding-ledger-XXXXXX.json)
trap 'rm -f "$TMP_PROPOSED"' EXIT
printf '%s' "$PROPOSED_CONTENT" > "$TMP_PROPOSED"

# Spawn a one-off node invocation that validates the file against the
# schema. We re-use the same Ajv config the package's existing validators
# rely on (allowUnionTypes + strictSchema:false).
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  # No node — silent allow (we can't validate without it).
  exit 0
fi

VALIDATE_OUT=$("$NODE_BIN" -e "
  const fs = require('fs');
  let Ajv, addFormats;
  try {
    Ajv = require('ajv/dist/2020.js');
    addFormats = require('ajv-formats');
  } catch (e) {
    // ajv unavailable — silent allow.
    process.exit(0);
  }
  let schema, data;
  try { schema = JSON.parse(fs.readFileSync('$SCHEMA_PATH', 'utf8')); }
  catch (e) { console.error('SCHEMA_LOAD_FAIL', e.message); process.exit(0); }
  try { data = JSON.parse(fs.readFileSync('$TMP_PROPOSED', 'utf8')); }
  catch (e) { console.error('CONTENT_PARSE_FAIL: ' + e.message); process.exit(2); }
  const ajv = new (Ajv.default || Ajv)({ strict: true, allErrors: true, allowUnionTypes: true, strictSchema: false });
  (addFormats.default || addFormats)(ajv);
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    for (const err of validate.errors || []) {
      console.error('SCHEMA_FAIL: ' + (err.instancePath || '/') + ' ' + err.message);
    }
    process.exit(3);
  }
  process.exit(0);
" 2>&1)
NODE_EXIT=$?

if [ "$NODE_EXIT" = "2" ]; then
  emit_deny "[BLOCKED] Proposed onboarding-status.json is not parseable JSON.

File: ${FILE_PATH}

The ledger is the single source of truth for the pipeline state. A
malformed write would silently degrade every downstream gate.

Validator output:
${VALIDATE_OUT}

Fix: re-author the JSON, run \`jq . <<< '<contents>'\` locally to confirm
it parses, then re-issue the write.

See: schemas/onboarding-status.schema.json"
  exit 0
fi

if [ "$NODE_EXIT" = "3" ]; then
  emit_deny "[BLOCKED] Proposed onboarding-status.json fails schema validation.

File: ${FILE_PATH}
Schema: ${SCHEMA_PATH}

Validator output:
${VALIDATE_OUT}

Fix: correct the failing field(s) above; the schema is the authoritative
spec. The valid + invalid fixtures under schemas/onboarding-status.fixtures/
are working examples of the shape.

See: schemas/onboarding-status.schema.json
     skills/onboarding/SKILL.md §\"Status ledger + workflow reviewer\""
  exit 0
fi

# ---------------------------------------------------------------------------
# State-machine transition check — only meaningful when there is a prior
# ledger to compare against.
# ---------------------------------------------------------------------------
if [ -f "$FILE_PATH" ]; then
  PRIOR_PHASE=$("$JQ" -r '.currentPhase // empty' "$FILE_PATH" 2>/dev/null || echo "")
  NEW_PHASE=$("$JQ" -r '.currentPhase // empty' "$TMP_PROPOSED" 2>/dev/null || echo "")
  case "$PRIOR_PHASE" in ''|*[!0-9]*) PRIOR_PHASE=0 ;; esac
  case "$NEW_PHASE"   in ''|*[!0-9]*) NEW_PHASE=0 ;; esac

  # Phase-skip detection: new > prior + 1 AND the in-between phase is
  # still `pending` in the new content.
  if [ "$NEW_PHASE" -gt "$((PRIOR_PHASE + 1))" ]; then
    # For every phase id between prior+1 and new-1, check status.
    for MID_ID in $(seq $((PRIOR_PHASE + 1)) $((NEW_PHASE - 1))); do
      MID_STATUS=$("$JQ" -r --argjson id "$MID_ID" '
        [.phases[]? | select(.id == $id)] | .[0].status // "pending"
      ' "$TMP_PROPOSED" 2>/dev/null || echo "pending")
      if [ "$MID_STATUS" = "pending" ] || [ "$MID_STATUS" = "in-progress" ]; then
        emit_deny "[BLOCKED] Out-of-order ledger transition — currentPhase jumped ${PRIOR_PHASE} → ${NEW_PHASE} while phase ${MID_ID} is still \"${MID_STATUS}\".

File: ${FILE_PATH}

Every phase must progress through pending → in-progress → completed in
order. Skips are allowed only when the phase's status is set to
\"skipped\" AND an approvedDeviations[] entry carries a verbatim
authorizer field.

Fix: either (a) complete phase ${MID_ID} first, OR (b) mark phase
${MID_ID} as status: skipped AND add the corresponding
approvedDeviations[] entry with the authorizer quote.

See: schemas/onboarding-status.schema.json
     skills/onboarding/SKILL.md §\"Status ledger + workflow reviewer\""
        exit 0
      fi
    done
  fi

  # reviewerVerdict approved without handoverEnvelope check — scan every
  # phase's new state for the violation.
  BAD_PHASE=$("$JQ" -r '
    [.phases[]? | select(.reviewerVerdict == "approved" and (.handoverEnvelope == null))] |
    if length == 0 then "" else (.[0].id | tostring) end
  ' "$TMP_PROPOSED" 2>/dev/null || echo "")
  if [ -n "$BAD_PHASE" ]; then
    emit_deny "[BLOCKED] Ledger phase ${BAD_PHASE} has reviewerVerdict: \"approved\" but handoverEnvelope is null.

File: ${FILE_PATH}

A phase cannot be approved unless the closing subagent's handover
envelope is captured in the same record — the reviewer reads the
envelope as part of its evidence base, and downstream tooling needs the
envelope to reconstruct what the phase produced.

Fix: populate phases[${BAD_PHASE} - 1].handoverEnvelope with the closing
subagent's envelope (see schemas/subagent-returns/handover.schema.json
for the shape) before re-issuing the write.

See: schemas/onboarding-status.schema.json
     schemas/subagent-returns/handover.schema.json"
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# Actor-identity check on approval transitions (separation of duties).
# Any phase whose reviewerVerdict transitions from non-approved to
# `approved` requires the write to originate from a registered approver
# subagent context. Without this check the orchestrator can self-approve.
# ---------------------------------------------------------------------------
# Compute the set of phase ids that are NEWLY approved in this write.
if [ -f "$FILE_PATH" ]; then
  PRIOR_APPROVED=$("$JQ" -c '[.phases[]? | select(.reviewerVerdict == "approved") | .id]' "$FILE_PATH" 2>/dev/null || echo "[]")
else
  PRIOR_APPROVED="[]"
fi
NEW_APPROVED=$("$JQ" -c '[.phases[]? | select(.reviewerVerdict == "approved") | .id]' "$TMP_PROPOSED" 2>/dev/null || echo "[]")

NEW_APPROVAL_IDS=$("$JQ" -nc \
  --argjson prior "$PRIOR_APPROVED" \
  --argjson new "$NEW_APPROVED" \
  '[$new[] | select(. as $n | $prior | index($n) | not)]' 2>/dev/null || echo "[]")

# Carve-out: user-authorised skips. A phase whose `status == "skipped"`
# AND has a matching `approvedDeviations[]` entry with a non-empty
# `authorizer` field is approved via the user-authorization channel,
# not via a reviewer subagent. The authorizer's verbatim quote is the
# attestation. Remove these phase ids from the approval-set so the
# actor-identity check below doesn't fire on them.
SKIP_AUTHORISED_IDS=$("$JQ" -c '
  [ .phases[]? as $p
    | select($p.status == "skipped" and $p.reviewerVerdict == "approved")
    | $p.id as $pid
    | select(
        (.approvedDeviations // [])
        | any(.phase == $pid and ((.authorizer // "") | length) > 0)
      )
    | $pid
  ]
' "$TMP_PROPOSED" 2>/dev/null || echo "[]")

NEW_APPROVAL_IDS=$("$JQ" -nc \
  --argjson all "$NEW_APPROVAL_IDS" \
  --argjson skip "$SKIP_AUTHORISED_IDS" \
  '[$all[] | select(. as $n | $skip | index($n) | not)]' 2>/dev/null || echo "[]")

# Same check at sub-stage level (Phase-4 cycles, Phase-5 passes). We
# expose the substage approvals as `<phase-id>.<substage-id>` strings.
if [ -f "$FILE_PATH" ]; then
  PRIOR_SUBSTAGE_APPROVED=$("$JQ" -c '
    [ .phases[]? as $p | $p.subStages[]? | select(.reviewerVerdict == "approved")
      | "\($p.id).\(.id)" ]
  ' "$FILE_PATH" 2>/dev/null || echo "[]")
else
  PRIOR_SUBSTAGE_APPROVED="[]"
fi
NEW_SUBSTAGE_APPROVED=$("$JQ" -c '
  [ .phases[]? as $p | $p.subStages[]? | select(.reviewerVerdict == "approved")
    | "\($p.id).\(.id)" ]
' "$TMP_PROPOSED" 2>/dev/null || echo "[]")
NEW_SUBSTAGE_APPROVAL_IDS=$("$JQ" -nc \
  --argjson prior "$PRIOR_SUBSTAGE_APPROVED" \
  --argjson new "$NEW_SUBSTAGE_APPROVED" \
  '[$new[] | select(. as $n | $prior | index($n) | not)]' 2>/dev/null || echo "[]")

# Are there any new approvals at all?
HAS_NEW_PHASE_APPROVAL=$([ "$NEW_APPROVAL_IDS" = "[]" ] && echo "no" || echo "yes")
HAS_NEW_SUBSTAGE_APPROVAL=$([ "$NEW_SUBSTAGE_APPROVAL_IDS" = "[]" ] && echo "no" || echo "yes")

if [ "$HAS_NEW_PHASE_APPROVAL" = "yes" ] || [ "$HAS_NEW_SUBSTAGE_APPROVAL" = "yes" ]; then
  PARENT_ID=$(echo "$INPUT" | "$JQ" -r '.parent_tool_use_id // empty' 2>/dev/null || echo "")
  APPROVAL_SUMMARY="phase ids: $NEW_APPROVAL_IDS, substage ids: $NEW_SUBSTAGE_APPROVAL_IDS"

  if [ -z "$PARENT_ID" ]; then
    emit_deny "[BLOCKED] Ledger write transitions ${APPROVAL_SUMMARY} to reviewerVerdict: \"approved\" but the write is coming directly from the orchestrator context (no parent_tool_use_id).

File: ${FILE_PATH}

This is the separation-of-duties gate: the orchestrator does the work, an
approver subagent records the verdict. Only writes originating inside a
\`workflow-reviewer-*\` or \`phase-validator-*\` subagent are permitted to
transition a reviewerVerdict to approved.

Fix: dispatch the matching approver subagent (e.g. \`workflow-reviewer-phase1:\`
or \`phase-validator-1:\`) and let it author this write. The orchestrator's
job ends at dispatch; the approver owns the verdict record.

See:
  - hooks/workflow-approver-registry.sh (PreToolUse:Agent — records approvers)
  - skills/onboarding/SKILL.md §\"Status ledger + workflow reviewer\"
  - schemas/subagent-returns/workflow-reviewer.schema.json"
    exit 0
  fi

  # Subagent context — verify the parent is in the approver registry.
  REGISTRY_FILE="$(dirname "$FILE_PATH")/.workflow-approvers.json"
  if [ ! -f "$REGISTRY_FILE" ]; then
    emit_deny "[BLOCKED] Ledger write transitions ${APPROVAL_SUMMARY} to approved from a subagent context, but no approver registry exists at:

  ${REGISTRY_FILE}

The registry is written by hooks/workflow-approver-registry.sh when a
\`workflow-reviewer-*\` or \`phase-validator-*\` Agent dispatch fires.
Its absence means the dispatching Agent did NOT have an approver-role
description prefix.

Fix: ensure the approving subagent is dispatched with description
prefix \`workflow-reviewer-<scope>:\` or \`phase-validator-<N>:\`. Other
prefixes (composer-, probe-, cleanup-) do the work but cannot record
verdicts."
    exit 0
  fi

  ENTRY=$("$JQ" -c --arg id "$PARENT_ID" '.[$id] // empty' "$REGISTRY_FILE" 2>/dev/null || echo "")
  if [ -z "$ENTRY" ]; then
    emit_deny "[BLOCKED] Ledger write transitions ${APPROVAL_SUMMARY} to approved but the dispatching subagent (parent_tool_use_id=${PARENT_ID}) is NOT in the approver registry.

File: ${FILE_PATH}
Registry: ${REGISTRY_FILE}

Only subagents dispatched with one of these description prefixes can
record approvals:

  workflow-reviewer-<scope>:   the workflow reviewer / inspector skill
  phase-validator-<N>:         per-phase greenlight emitter

The current parent dispatch likely used a different prefix (composer-,
probe-, cleanup-, etc.). Those roles do the work but do not record
verdicts.

Fix: dispatch a \`workflow-reviewer-*\` or \`phase-validator-*\` with this
write in its scope."
    exit 0
  fi

  # TTL check — 30 minutes from registration.
  NOW=$(date +%s)
  TTL=1800
  ENTRY_TS=$(echo "$ENTRY" | "$JQ" -r '.ts // 0' 2>/dev/null || echo "0")
  ENTRY_AGE=$((NOW - ENTRY_TS))
  if [ "$ENTRY_AGE" -gt "$TTL" ]; then
    emit_deny "[BLOCKED] Ledger write transitions ${APPROVAL_SUMMARY} to approved from an approver whose registry entry has expired (age ${ENTRY_AGE}s, TTL ${TTL}s).

Registry entries live for 30 minutes from dispatch. If the approver
subagent has been running longer than that, re-dispatch a fresh
\`workflow-reviewer-*\` to land the verdict.

Fix: re-dispatch the approver."
    exit 0
  fi
fi

# All checks passed — silent allow.
exit 0
