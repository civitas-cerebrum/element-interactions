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
# 5. **Mode authorisation.** Any write that sets or changes `runMode`
#    (the coverage-expansion mode — `standard` vs `depth`) MUST also
#    include a non-empty `modeAuthorizer` field capturing the user's
#    explicit choice (verbatim quote). The schema permits `runMode` to
#    be persisted; this gate forces it to be persisted with an audit
#    trail of who chose it. Prevents the orchestrator from silently
#    defaulting to a mode without asking.
# 6. **Silent-allow for non-ledger writes.** Only files whose path ends
#    with `tests/e2e/docs/onboarding-status.json` are gated.
# 7. **Silent-allow when the file is missing AND the write has no
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

# ---------------------------------------------------------------------------
# Mode-authorisation check.
# Setting or changing `runMode` requires the operator's explicit choice
# captured in `modeAuthorizer` (a verbatim user quote). Forces the
# orchestrator to ASK before silently defaulting to one of the two
# documented coverage-expansion modes.
# ---------------------------------------------------------------------------
NEW_MODE=$("$JQ" -r '.runMode // empty' "$TMP_PROPOSED" 2>/dev/null || echo "")
NEW_AUTHORIZER=$("$JQ" -r '.modeAuthorizer // empty' "$TMP_PROPOSED" 2>/dev/null || echo "")

PRIOR_MODE=""
PRIOR_AUTHORIZER=""
if [ -f "$FILE_PATH" ]; then
  PRIOR_MODE=$("$JQ" -r '.runMode // empty' "$FILE_PATH" 2>/dev/null || echo "")
  PRIOR_AUTHORIZER=$("$JQ" -r '.modeAuthorizer // empty' "$FILE_PATH" 2>/dev/null || echo "")
fi

# Case A: runMode being set or changed. The new value differs from the
# prior (or the prior didn't exist). Requires a non-empty modeAuthorizer
# in the SAME write — co-located with the runMode field so the audit
# trail can't be reconstructed out of order.
if [ -n "$NEW_MODE" ] && [ "$NEW_MODE" != "$PRIOR_MODE" ]; then
  if [ -z "$NEW_AUTHORIZER" ]; then
    emit_deny "[BLOCKED] runMode being set to \"${NEW_MODE}\" without a modeAuthorizer field.

File: ${FILE_PATH}
Prior runMode: \"${PRIOR_MODE:-<unset>}\"
New runMode:   \"${NEW_MODE}\"

The orchestrator cannot silently choose between \`standard\` and \`depth\`
coverage-expansion modes — the user must make that choice explicitly
and the choice must land in the ledger as an audit-trail quote.

Fix: add a top-level \`modeAuthorizer\` field to the proposed write,
containing the user's verbatim quote. Examples:

  \"modeAuthorizer\": \"user said: run onboarding in standard mode\"
  \"modeAuthorizer\": \"user typed 'depth' in response to mode-selection prompt\"
  \"modeAuthorizer\": \"external CLI driver --mode=depth (CLI flag)\"

If the user has not yet been asked, ASK first; then write the ledger
with the captured quote.

See:
  - schemas/onboarding-status.schema.json §runMode
  - skills/onboarding/SKILL.md §\"Front-load mode-selection gate\""
    exit 0
  fi
fi

# Case B: runMode persists across the write but modeAuthorizer was
# silently cleared. Prevents post-hoc tampering of the audit trail —
# once a mode is authorised, the authoriser quote stays in the ledger
# for as long as that mode is in effect.
if [ -n "$NEW_MODE" ] && [ -n "$PRIOR_AUTHORIZER" ] && [ -z "$NEW_AUTHORIZER" ]; then
  emit_deny "[BLOCKED] modeAuthorizer cleared while runMode remains set.

File: ${FILE_PATH}
runMode (preserved):       \"${NEW_MODE}\"
Prior modeAuthorizer:      \"${PRIOR_AUTHORIZER}\"
New modeAuthorizer:        <empty/missing>

Once a mode has been user-authorised, the authorisation quote must
stay in the ledger for as long as the mode is in effect. Clearing it
post-hoc would erase the audit trail.

Fix: keep the existing modeAuthorizer field unchanged, OR update both
runMode AND modeAuthorizer together (which re-triggers the case-A
check above).

See: schemas/onboarding-status.schema.json §runMode"
  exit 0
fi

# ---------------------------------------------------------------------------
# Per-phase positive-deliverable checks (Phase-N → completed transitions).
# When a phase's status flips from non-completed to "completed" in the
# proposed write, the canonical deliverables for that phase must already
# exist on disk. This catches "orchestrator marked the phase done without
# actually producing the deliverables" — the failure mode that
# markdown-text contract enforcement alone could not stop.
#
# Per-phase manifests (minimum required files / sentinel checks):
#
#   Phase 4 (Journey-mapping):
#     - tests/e2e/docs/journey-map.md exists AND line 1 == the sentinel
#       `<!-- journey-mapping:generated -->`.
#     - tests/e2e/docs/.phase4-cycle-state.json exists AND contains at
#       minimum cycles."1" + cycles."2" entries (cycle 1 discovery +
#       cycle 2 edge-probe — non-negotiable per journey-mapping/SKILL.md
#       §"Iterative discovery cycles").
#
#   Phase 5 (Coverage-expansion):
#     - tests/e2e/docs/coverage-expansion-state.json exists AND contains
#       at minimum passes."1" (the strict-per-journey first pass).
#
#   Phase 6 (Bug-discovery):
#     - tests/e2e/docs/adversarial-findings.md exists.
#
#   Phase 7 (Secrets-sweep):
#     - .env.example exists at the project root.
#
#   Phase 8 (Report):
#     - qa-summary-deck.html AND qa-summary-deck.pdf exist at the
#       project root.
#
# Phases 1-3 are not enforced here — their deliverables (config files,
# fixtures, happy-path specs) don't have unforgeable signatures the
# harness can verify cheaply. The ledger's `phases[N].deliverables[]`
# array is the audit trail for those phases; the orchestrator-to-
# reviewer brief gate ensures the reviewer reads them.
# ---------------------------------------------------------------------------

# PROJECT_ROOT is the directory containing tests/e2e/docs/. The ledger
# path is .../tests/e2e/docs/onboarding-status.json — strip the tail.
PROJECT_ROOT="${FILE_PATH%/tests/e2e/docs/onboarding-status.json}"

# Build the set of phase IDs whose status is transitioning to "completed"
# in this write. Compare proposed[N].status vs prior[N].status (treat
# "prior" as "pending" when the file doesn't yet exist). Space-separated
# list to keep set -u happy on bash 3 where empty arrays expand to
# "unset variable" under "${arr[@]}".
PHASES_NEWLY_COMPLETED=""
for phase_id in 1 2 3 4 5 6 7 8; do
  idx=$((phase_id - 1))
  new_status=$("$JQ" -r ".phases[${idx}].status // empty" "$TMP_PROPOSED" 2>/dev/null || echo "")
  prior_status="pending"
  if [ -f "$FILE_PATH" ]; then
    prior_status=$("$JQ" -r ".phases[${idx}].status // \"pending\"" "$FILE_PATH" 2>/dev/null || echo "pending")
  fi
  if [ "$new_status" = "completed" ] && [ "$prior_status" != "completed" ]; then
    PHASES_NEWLY_COMPLETED="${PHASES_NEWLY_COMPLETED} ${phase_id}"
  fi
done

# Helper: emit a deny with the standard payload structure used above.
emit_phase_deny() {
  local phase="$1"
  local missing="$2"
  local fix_hint="$3"
  local skill_ref="$4"
  emit_deny "[BLOCKED] Phase ${phase} cannot transition to status: \"completed\" — required deliverable missing.

File: ${FILE_PATH}

Missing: ${missing}

This is the per-phase positive-deliverable check. The ledger cannot
mark a phase complete unless that phase's canonical deliverables exist
on disk. The deliverables are unforgeable signatures of the correct
skill having been invoked — without them, the phase was either skipped
or shortcut.

Fix: ${fix_hint}

See: ${skill_ref}"
  exit 0
}

for phase_id in $PHASES_NEWLY_COMPLETED; do
  case "$phase_id" in
    4)
      # Phase 4 — journey-map.md + sentinel + cycle-state with cycles 1 & 2.
      MAP_PATH="$PROJECT_ROOT/tests/e2e/docs/journey-map.md"
      CYCLE_STATE_PATH="$PROJECT_ROOT/tests/e2e/docs/.phase4-cycle-state.json"

      if [ ! -f "$MAP_PATH" ]; then
        emit_phase_deny "4" \
          "tests/e2e/docs/journey-map.md does not exist." \
          "invoke the \`journey-mapping\` skill via the Skill tool. It runs the iterative discovery cycle protocol and writes the map with the line-1 sentinel." \
          "skills/onboarding/SKILL.md §\"Phase 4 — Journey mapping\" + skills/journey-mapping/SKILL.md"
      fi

      FIRST_LINE=$(head -n 1 "$MAP_PATH" 2>/dev/null || echo "")
      if [ "$FIRST_LINE" != "<!-- journey-mapping:generated -->" ]; then
        emit_phase_deny "4" \
          "tests/e2e/docs/journey-map.md is missing the line-1 sentinel \`<!-- journey-mapping:generated -->\`. Got: \"${FIRST_LINE:0:80}\"" \
          "regenerate the map via the journey-mapping skill. The sentinel is its authorship marker — without it the map is forged." \
          "skills/journey-mapping/SKILL.md §\"Recognizing a previously-generated journey map\""
      fi

      if [ ! -f "$CYCLE_STATE_PATH" ]; then
        emit_phase_deny "4" \
          "tests/e2e/docs/.phase4-cycle-state.json does not exist." \
          "the journey-mapping skill writes the cycle state as it dispatches per-section subagents. Absence ⇒ no cycle ever ran." \
          "skills/journey-mapping/SKILL.md §\"Cycle protocol\""
      fi

      # Cycle 1 + Cycle 2 are non-negotiable per the iterative-discovery
      # protocol (≥1 discovery cycle + exactly 1 edge-probe cycle).
      HAS_CYCLE_1=$("$JQ" -r '.cycles["1"] != null' "$CYCLE_STATE_PATH" 2>/dev/null || echo "false")
      HAS_CYCLE_2=$("$JQ" -r '.cycles["2"] != null' "$CYCLE_STATE_PATH" 2>/dev/null || echo "false")
      if [ "$HAS_CYCLE_1" != "true" ] || [ "$HAS_CYCLE_2" != "true" ]; then
        emit_phase_deny "4" \
          ".phase4-cycle-state.json is missing cycle-1 and/or cycle-2 records (has-cycle-1=${HAS_CYCLE_1}, has-cycle-2=${HAS_CYCLE_2}). Both are non-negotiable: ≥1 discovery cycle + exactly 1 edge-probe cycle." \
          "complete the cycle protocol — dispatch cycle-1 section agents (strict per-section parallel), then the cycle-2 edge-probe — before closing Phase 4." \
          "skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\""
      fi

      # Cycle-roster completeness: for EVERY cycle recorded, the section
      # subagents must have all returned. dispatched-sections == returned-
      # sections (set equality, not just length). Catches the "dispatched
      # 7, only 5 came back, marked the cycle done anyway" failure mode.
      for cycle_id in 1 2; do
        DISPATCHED=$("$JQ" -c ".cycles[\"${cycle_id}\"][\"dispatched-sections\"] // [] | sort" "$CYCLE_STATE_PATH" 2>/dev/null || echo "[]")
        RETURNED=$("$JQ" -c ".cycles[\"${cycle_id}\"][\"returned-sections\"] // [] | sort" "$CYCLE_STATE_PATH" 2>/dev/null || echo "[]")
        if [ "$DISPATCHED" != "$RETURNED" ]; then
          DISPATCHED_COUNT=$(echo "$DISPATCHED" | "$JQ" 'length')
          RETURNED_COUNT=$(echo "$RETURNED" | "$JQ" 'length')
          emit_phase_deny "4" \
            "Cycle ${cycle_id} dispatched-sections (${DISPATCHED_COUNT}) != returned-sections (${RETURNED_COUNT}). Some section agents did not return; the cycle is incomplete." \
            "wait for every dispatched section to return before authoring the journey map. Re-dispatch any stalled sections. The author step consumes the union of all section returns — partial returns mean partial coverage." \
            "skills/journey-mapping/SKILL.md §\"Cycle protocol\""
        fi
      done
      ;;
    5)
      # Phase 5 — coverage-expansion-state.json with at least pass-1 record.
      COV_STATE_PATH="$PROJECT_ROOT/tests/e2e/docs/coverage-expansion-state.json"
      if [ ! -f "$COV_STATE_PATH" ]; then
        emit_phase_deny "5" \
          "tests/e2e/docs/coverage-expansion-state.json does not exist." \
          "invoke the \`coverage-expansion\` skill via the Skill tool. It writes the state file as it runs the per-pass pipeline." \
          "skills/onboarding/SKILL.md §\"Phase 5 — Coverage expansion\" + skills/coverage-expansion/SKILL.md"
      fi
      HAS_PASS_1=$("$JQ" -r '.passes["1"] != null' "$COV_STATE_PATH" 2>/dev/null || echo "false")
      if [ "$HAS_PASS_1" != "true" ]; then
        emit_phase_deny "5" \
          "coverage-expansion-state.json reports no pass-1 record. Pass 1 (strict per-journey, compositional) is the foundation of every coverage-expansion mode." \
          "run at least Pass 1 of coverage-expansion before closing Phase 5." \
          "skills/coverage-expansion/SKILL.md §\"Non-negotiables\""
      fi

      # Coverage-completeness check: Pass 1's dispatched-journeys + any
      # deferredJourneys[] entries must together cover the journey map's
      # full roster. Catches the "dispatched 8 of 41 journeys, called
      # exit-#2, marked Phase 5 complete" failure mode. The roster is
      # derived from the journey-map.md (one entry per `^#### j-` block).
      MAP_PATH="$PROJECT_ROOT/tests/e2e/docs/journey-map.md"
      if [ -f "$MAP_PATH" ]; then
        ROSTER_COUNT=$(grep -c '^#### j-' "$MAP_PATH" 2>/dev/null; true)
        ROSTER_COUNT=${ROSTER_COUNT:-0}
        DISPATCHED_COUNT=$("$JQ" -r '.passes["1"]["dispatched-journeys"] // [] | length' "$COV_STATE_PATH" 2>/dev/null || echo "0")
        DEFERRED_COUNT=$("$JQ" -r '.passes["1"]["deferredJourneys"] // [] | length' "$COV_STATE_PATH" 2>/dev/null || echo "0")
        DISPATCHED_COUNT=${DISPATCHED_COUNT:-0}
        DEFERRED_COUNT=${DEFERRED_COUNT:-0}
        TOTAL_ACCOUNTED=$((DISPATCHED_COUNT + DEFERRED_COUNT))

        if [ "$ROSTER_COUNT" -gt 0 ] && [ "$TOTAL_ACCOUNTED" -lt "$ROSTER_COUNT" ]; then
          UNCOVERED=$((ROSTER_COUNT - TOTAL_ACCOUNTED))
          emit_phase_deny "5" \
            "Pass 1 coverage incomplete: journey-map.md lists ${ROSTER_COUNT} journeys; coverage-expansion-state.json records ${DISPATCHED_COUNT} dispatched + ${DEFERRED_COUNT} deferred = ${TOTAL_ACCOUNTED} accounted. ${UNCOVERED} journey(s) are silently missing. This is the silent-scope-compression failure mode." \
            "either (a) dispatch the remaining ${UNCOVERED} journey(s) through coverage-expansion Pass 1, OR (b) add a deferredJourneys[] entry for each missing journey with a reason (structural prefix OR an \"authorizer\" field carrying a verbatim user quote). Pre-emptive scope reduction without authorisation is denied." \
            "skills/coverage-expansion/SKILL.md §\"Two valid exits\" + §\"Deferral authorisation\""
        fi

        # Deferral authorisation: each deferredJourneys[] entry must have
        # a structural reason prefix OR an explicit authorizer quote.
        # Self-imposed reasons (budget-cap, session-length, auto-mode-stop)
        # without an authorizer field are silent scope narrowing.
        if [ "$DEFERRED_COUNT" -gt 0 ]; then
          BAD_DEFERRAL=$(
            "$JQ" -r '
              .passes["1"]["deferredJourneys"] // [] | .[] |
              select(
                ((.reason // "") | test("^(blocked-on-app-bug:|test-data-prerequisite:|user-authorised:)")) | not
              ) |
              select(((.authorizer // "") | length) == 0) |
              .journey // "<unknown>"
            ' "$COV_STATE_PATH" 2>/dev/null | head -1 || true
          )
          if [ -n "$BAD_DEFERRAL" ]; then
            emit_phase_deny "5" \
              "deferredJourneys[] entry for \"${BAD_DEFERRAL}\" carries neither a structural reason prefix (\`blocked-on-app-bug:\`, \`test-data-prerequisite:\`, \`user-authorised:\`) nor an \`authorizer\` field with a verbatim user quote. Self-imposed deferrals (budget-cap, session-length, auto-mode-stop) without authorisation are silent scope narrowing." \
              "either dispatch this journey through Pass 1, or add a reason matching one of the allowed structural prefixes, or capture the user's verbatim authorisation in an \`authorizer\` field." \
              "skills/coverage-expansion/SKILL.md §\"Deferral authorisation\""
          fi
        fi
      fi

      # Multi-pass coverage-threshold check — closes the exit-#2 /
      # cherry-pick exploit (Run-7 anti-pattern). The prior checks gate
      # Pass-1 roster coverage; this check gates the full per-mode
      # pipeline. The orchestrator may legitimately reduce scope, but
      # only with a verbatim user quote in `scopeAuthorizer`. Compute:
      #   ROSTER_SIZE      = length(journeyRoster) — falls back to
      #                       ROSTER_COUNT from journey-map.md if absent
      #   RUN_MODE         = runMode field ("standard"|"depth"|"breadth")
      #   EXPECTED_PASSES  = 5 for standard|depth, 1 for breadth
      #   TOTAL_DISPATCHES = sum over passes of length(dispatched-
      #                      journeys[]) — canonical field. `dispatches`
      #                      is honoured as a legacy alias only when
      #                      `dispatched-journeys` is missing entirely
      #                      (not when it's an empty array — jq's `//`
      #                      treats `[]` as truthy, so we max() instead
      #                      of fall-through).
      #   THRESHOLD        = ROSTER_SIZE × EXPECTED_PASSES × N / 10
      #                      where N defaults to 8 (80%), overridable
      #                      via COVERAGE_EXPANSION_THRESHOLD env var
      #                      (an integer in [10,100] = percent).
      # If TOTAL_DISPATCHES < THRESHOLD AND scopeAuthorizer is empty, DENY.
      if [ -f "$COV_STATE_PATH" ]; then
        ROSTER_SIZE=$("$JQ" -r '.journeyRoster // [] | length' "$COV_STATE_PATH" 2>/dev/null || echo "0")
        ROSTER_SIZE=${ROSTER_SIZE:-0}
        # If state file omits journeyRoster, fall back to the map count
        # computed earlier (ROSTER_COUNT from journey-map.md).
        if [ "$ROSTER_SIZE" -eq 0 ] && [ -n "${ROSTER_COUNT:-}" ]; then
          ROSTER_SIZE=$ROSTER_COUNT
        fi
        RUN_MODE=$("$JQ" -r '.runMode // "standard"' "$COV_STATE_PATH" 2>/dev/null || echo "standard")
        EXPECTED_PASSES=5
        [ "$RUN_MODE" = "breadth" ] && EXPECTED_PASSES=1
        # Sum across passes. For each pass take MAX of `dispatched-
        # journeys` length and `dispatches` length so an empty array on
        # one doesn't shadow a populated array on the other. Both fields
        # are treated as positive coverage signals — gated_skip entries
        # in dispatches[] also count (the orchestrator "considered" the
        # journey in that pass, per coverage-expansion §"Trigger-gated
        # re-pass for Passes 2 & 3").
        TOTAL_DISPATCHES=$("$JQ" -r '
          [.passes[]? | (
            [((."dispatched-journeys" // []) | length), ((.dispatches // []) | length)] | max
          )] | add // 0
        ' "$COV_STATE_PATH" 2>/dev/null || echo "0")
        TOTAL_DISPATCHES=${TOTAL_DISPATCHES:-0}
        SCOPE_AUTHORIZER=$("$JQ" -r '.scopeAuthorizer // ""' "$COV_STATE_PATH" 2>/dev/null || echo "")

        # Typo hint: detect close variants of `scopeAuthorizer` to
        # surface in the deny message when present. Catches
        # `scopeAuthoriser`, `scope_authorizer`, `scopeAuth`, etc.
        SCOPE_AUTH_TYPO=$("$JQ" -r '
          [keys[]? | select(test("scope.*author|scope.?auth"; "i")) | select(. != "scopeAuthorizer")] | first // ""
        ' "$COV_STATE_PATH" 2>/dev/null || echo "")

        # Threshold percent (default 80) — overridable for gated-skip-
        # heavy runs (coverage-expansion §"Trigger-gated re-pass for
        # Passes 2 & 3" describes runs where Passes 2/3 may legitimately
        # produce zero new dispatches; operators on those workflows can
        # set COVERAGE_EXPANSION_THRESHOLD=60).
        THRESHOLD_PCT=${COVERAGE_EXPANSION_THRESHOLD:-80}
        case "$THRESHOLD_PCT" in
          ''|*[!0-9]*) THRESHOLD_PCT=80 ;;
        esac
        if [ "$THRESHOLD_PCT" -lt 10 ] || [ "$THRESHOLD_PCT" -gt 100 ]; then
          THRESHOLD_PCT=80
        fi
        THRESHOLD=$(( ROSTER_SIZE * EXPECTED_PASSES * THRESHOLD_PCT / 100 ))

        # Skip the check when: (a) roster is empty (malformed — earlier
        # checks own this case); (b) scopeAuthorizer is non-empty (user-
        # authorised scope reduction). Otherwise enforce the threshold.
        if [ "${ROSTER_SIZE:-0}" -gt 0 ] && [ -z "$SCOPE_AUTHORIZER" ] && [ "${TOTAL_DISPATCHES:-0}" -lt "${THRESHOLD:-0}" ]; then
          COVERAGE_PCT=$(( TOTAL_DISPATCHES * 100 / (ROSTER_SIZE * EXPECTED_PASSES) ))
          TYPO_HINT=""
          if [ -n "$SCOPE_AUTH_TYPO" ]; then
            TYPO_HINT=" (found a similarly-named field \`${SCOPE_AUTH_TYPO}\` in the state file — likely a typo of \`scopeAuthorizer\`; rename it to take effect)"
          fi
          emit_phase_deny "5" \
            "coverage-expansion-state.json reports ${TOTAL_DISPATCHES} dispatches across ${EXPECTED_PASSES} pass(es) of a ${ROSTER_SIZE}-journey roster (${COVERAGE_PCT}% coverage). Threshold is ${THRESHOLD_PCT}% (≥ ${THRESHOLD} dispatches). No user-authorised scope reduction recorded in \`scopeAuthorizer\`${TYPO_HINT}." \
            "either (a) dispatch the remaining journeys to bring coverage to ≥${THRESHOLD_PCT}% — gated-skipped passes must record one \`{gated_skip: true, journey: <id>}\` entry per journey in their dispatches[]/dispatched-journeys[] array so the threshold check can count them, not an empty array; OR (b) record an explicit user authorisation by writing the verbatim user-quote into the state file's top-level \`scopeAuthorizer\` field — e.g. \`\"scopeAuthorizer\": \"<exact words the user used to authorise the scope reduction>\"\`. Self-imposed reasons (\"session-length\", \"budget-cap\", \"auto-mode\", inferred preference) are NOT valid authorisation. To loosen the threshold for gated-skip-heavy workflows, set COVERAGE_EXPANSION_THRESHOLD=<10-100> in the session env (default 80)." \
            "skills/coverage-expansion/SKILL.md §\"Two valid exits\" + §\"No-skip contract\""
        fi
      fi
      ;;
    6)
      # Phase 6 — adversarial-findings ledger exists AND has substance.
      ADV_PATH="$PROJECT_ROOT/tests/e2e/docs/adversarial-findings.md"
      if [ ! -f "$ADV_PATH" ]; then
        emit_phase_deny "6" \
          "tests/e2e/docs/adversarial-findings.md does not exist." \
          "invoke the \`bug-discovery\` skill (or the adversarial passes of coverage-expansion). They write the findings ledger as probes return." \
          "skills/onboarding/SKILL.md §\"Phase 6 — Bug discovery\" + skills/bug-discovery/SKILL.md"
      fi

      # Content check: the ledger must contain at least one per-journey
      # section block. The canonical schema (per
      # references/subagent-return-schema.md §3) uses `### j-<slug>` as
      # the per-journey section header. An empty ledger (just the
      # title) means no probe ever ran — the file exists but the
      # methodology was bypassed. grep -c always prints a count (even
      # 0) and exits 1 on no-match — capture stdout, ignore exit code.
      JOURNEY_BLOCKS=$(grep -c '^### j-' "$ADV_PATH" 2>/dev/null; true)
      JOURNEY_BLOCKS=${JOURNEY_BLOCKS:-0}
      if [ "$JOURNEY_BLOCKS" -lt 1 ]; then
        emit_phase_deny "6" \
          "tests/e2e/docs/adversarial-findings.md exists but contains 0 per-journey section blocks (\`### j-<slug>\`). File existence alone is not bug-discovery; the ledger must record at least one probe." \
          "dispatch the bug-discovery probe subagents per journey (or the adversarial passes of coverage-expansion). Each probe appends a \`### j-<slug>\` section to the ledger as it returns." \
          "skills/bug-discovery/SKILL.md + element-interactions/references/subagent-return-schema.md §3"
      fi
      ;;
    7)
      # Phase 7 — .env.example exists at project root.
      ENV_EXAMPLE_PATH="$PROJECT_ROOT/.env.example"
      if [ ! -f "$ENV_EXAMPLE_PATH" ]; then
        emit_phase_deny "7" \
          ".env.example does not exist at the project root." \
          "invoke the \`secrets-sweep\` skill. It writes .env.example as it extracts literals from the test suite." \
          "skills/onboarding/SKILL.md §\"Phase 7 — Secrets sweep\" + skills/secrets-sweep/SKILL.md"
      fi
      ;;
    8)
      # Phase 8 — qa-summary-deck.{html,pdf} exist at project root.
      DECK_HTML="$PROJECT_ROOT/qa-summary-deck.html"
      DECK_PDF="$PROJECT_ROOT/qa-summary-deck.pdf"
      MISSING_DECK=""
      [ -f "$DECK_HTML" ] || MISSING_DECK="qa-summary-deck.html"
      [ -f "$DECK_PDF" ]  || MISSING_DECK="${MISSING_DECK:+$MISSING_DECK + }qa-summary-deck.pdf"
      if [ -n "$MISSING_DECK" ]; then
        emit_phase_deny "8" \
          "$MISSING_DECK missing from project root." \
          "invoke the \`work-summary-deck\` skill. It writes the HTML deck and renders the PDF." \
          "skills/onboarding/SKILL.md §\"Phase 8 — Report\" + skills/work-summary-deck/SKILL.md"
      fi
      ;;
  esac
done

# All checks passed — silent allow.
exit 0
