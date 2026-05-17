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
# 4. **Silent-allow for non-ledger writes.** Only files whose path ends
#    with `tests/e2e/docs/onboarding-status.json` are gated.
# 5. **Silent-allow when the file is missing AND the write is the
#    create.** A fresh-run ledger init has no prior state to validate
#    against — only the schema check applies.
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

# All checks passed — silent allow.
exit 0
