#!/bin/bash
# Tests for onboarding-ledger-write-gate.sh — schema + state-machine
# integrity gate for writes to tests/e2e/docs/onboarding-status.json.
# PreToolUse:Write|Edit. DENY mode.
H="$HOOK_DIR/onboarding-ledger-write-gate.sh"

# Skip the suite if `node` or the package's ajv dependency isn't available
# — the hook silent-allows in that situation, so the deny-expectation
# tests below would not be meaningful. We probe both before running.
if ! command -v node >/dev/null 2>&1; then
  echo "  ${CLR_DIM}(node not on PATH — skipping onboarding-ledger-write-gate cases)${CLR_RST}"
  return 0 2>/dev/null || exit 0
fi
NODE_BIN=$(command -v node)
if ! "$NODE_BIN" -e "require('ajv/dist/2020.js'); require('ajv-formats');" >/dev/null 2>&1; then
  echo "  ${CLR_DIM}(ajv/ajv-formats not available — skipping onboarding-ledger-write-gate cases)${CLR_RST}"
  return 0 2>/dev/null || exit 0
fi

TMP_REPO=$(mktemp -d /tmp/onboarding-ledger-write-XXXXXX)
mkdir -p "$TMP_REPO/tests/e2e/docs"
(cd "$TMP_REPO" && git init -q && git config user.email t@t && git config user.name t)
trap 'rm -rf "$TMP_REPO"' EXIT

LEDGER_PATH="$TMP_REPO/tests/e2e/docs/onboarding-status.json"

# Baseline valid ledger.
VALID_FRESH='{
  "schemaVersion": 1,
  "pipelineVersion": "0.4.0",
  "runMode": "standard",
  "startedAt": "2026-05-17T09:00:00Z",
  "currentPhase": 1,
  "currentSubStage": null,
  "status": "in-progress",
  "phases": [
    {"id":1,"name":"Scaffold","status":"in-progress","reviewerVerdict":"pending","reviewerCycles":0,"deliverables":[]},
    {"id":2,"name":"Groundwork","status":"pending","reviewerVerdict":"pending","reviewerCycles":0,"deliverables":[]},
    {"id":3,"name":"Happy-path","status":"pending","reviewerVerdict":"pending","reviewerCycles":0,"deliverables":[]},
    {"id":4,"name":"Journey-mapping","status":"pending","reviewerVerdict":"pending","reviewerCycles":0,"deliverables":[],"subStages":[]},
    {"id":5,"name":"Coverage-expansion","status":"pending","reviewerVerdict":"pending","reviewerCycles":0,"deliverables":[],"subStages":[]},
    {"id":6,"name":"Bug-discovery","status":"pending","reviewerVerdict":"pending","reviewerCycles":0,"deliverables":[]},
    {"id":7,"name":"Secrets-sweep","status":"pending","reviewerVerdict":"pending","reviewerCycles":0,"deliverables":[]},
    {"id":8,"name":"Report","status":"pending","reviewerVerdict":"pending","reviewerCycles":0,"deliverables":[]}
  ],
  "approvedDeviations": []
}'

# ---------------------------------------------------------------------------
section "ledger-write-gate: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/tmp/x')" "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='whatever')" "Agent → silent allow"

# ---------------------------------------------------------------------------
section "ledger-write-gate: non-ledger paths silent-allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/tmp/anything.json' content='{}')" \
  "Write to /tmp/anything.json → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/some/repo/tests/e2e/spec.ts' content='test()')" \
  "Write to a spec.ts under tests/e2e → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/repo/tests/e2e/docs/coverage-expansion-state.json' content='{}')" \
  "Write to coverage-expansion-state.json → silent allow (different file)"

# ---------------------------------------------------------------------------
section "ledger-write-gate: fresh-run init with valid JSON ALLOWED"
rm -f "$LEDGER_PATH"
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$VALID_FRESH")" \
  "Write fresh valid ledger → ALLOW"

# ---------------------------------------------------------------------------
section "ledger-write-gate: malformed JSON DENIED"
rm -f "$LEDGER_PATH"
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content='not-json-at-all')" \
  "Write non-JSON content → DENY" "not parseable JSON"
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content='{"unterminated":')" \
  "Write truncated JSON → DENY" "not parseable JSON"

# ---------------------------------------------------------------------------
section "ledger-write-gate: schema-invalid content DENIED"
rm -f "$LEDGER_PATH"
INVALID_MISSING_PHASES='{"schemaVersion":1,"pipelineVersion":"0.4.0","runMode":"standard","startedAt":"2026-05-17T09:00:00Z","currentPhase":1,"status":"in-progress"}'
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$INVALID_MISSING_PHASES")" \
  "Write ledger missing required 'phases' → DENY" "fails schema validation"

INVALID_BAD_RUNMODE='{"schemaVersion":1,"pipelineVersion":"0.4.0","runMode":"yolo","startedAt":"2026-05-17T09:00:00Z","currentPhase":1,"status":"in-progress","phases":[
  {"id":1,"name":"Scaffold","status":"in-progress","deliverables":[]},
  {"id":2,"name":"Groundwork","status":"pending","deliverables":[]},
  {"id":3,"name":"Happy-path","status":"pending","deliverables":[]},
  {"id":4,"name":"Journey-mapping","status":"pending","deliverables":[]},
  {"id":5,"name":"Coverage-expansion","status":"pending","deliverables":[]},
  {"id":6,"name":"Bug-discovery","status":"pending","deliverables":[]},
  {"id":7,"name":"Secrets-sweep","status":"pending","deliverables":[]},
  {"id":8,"name":"Report","status":"pending","deliverables":[]}
]}'
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$INVALID_BAD_RUNMODE")" \
  "Write ledger with bad runMode enum → DENY" "fails schema validation"

# ---------------------------------------------------------------------------
section "ledger-write-gate: phase-skip transition DENIED"
# Existing ledger at currentPhase=1; proposed bumps to 3 with phase 2 still pending.
printf '%s' "$VALID_FRESH" > "$LEDGER_PATH"
SKIP_TWO=$(echo "$VALID_FRESH" | "$JQ" '
  .currentPhase = 3 |
  .phases[0].status = "completed" |
  .phases[0].reviewerVerdict = "approved" |
  .phases[0].handoverEnvelope = {"role":"phase1-scaffold","status":"complete"}
')
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$SKIP_TWO")" \
  "Write that jumps phase 1 → 3 with phase 2 pending → DENY" "Out-of-order ledger transition"

# ---------------------------------------------------------------------------
section "ledger-write-gate: phase-skip with status: skipped + authorizer ALLOWED"
printf '%s' "$VALID_FRESH" > "$LEDGER_PATH"
SKIP_AUTHORISED=$(echo "$VALID_FRESH" | "$JQ" '
  .currentPhase = 3 |
  .phases[0].status = "completed" | .phases[0].reviewerVerdict = "approved" | .phases[0].handoverEnvelope = {"role":"phase1","status":"complete"} |
  .phases[1].status = "skipped" | .phases[1].reviewerVerdict = "approved" | .phases[1].handoverEnvelope = {"role":"workflow-reviewer-phase2","status":"approved"} |
  .approvedDeviations = [{"phase":2,"deviation":"groundwork-pre-existing","authorizer":"user said: groundwork already documented in /docs"}]
')
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$SKIP_AUTHORISED")" \
  "Write that skips phase 2 with authorizer + status=skipped → ALLOW"

# ---------------------------------------------------------------------------
section "ledger-write-gate: reviewerVerdict approved without handoverEnvelope DENIED"
printf '%s' "$VALID_FRESH" > "$LEDGER_PATH"
APPROVED_NO_HANDOVER=$(echo "$VALID_FRESH" | "$JQ" '
  .phases[0].status = "completed" |
  .phases[0].reviewerVerdict = "approved" |
  .phases[0].handoverEnvelope = null
')
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$APPROVED_NO_HANDOVER")" \
  "Write with approved verdict but null handoverEnvelope → DENY" "handoverEnvelope is null"

# ---------------------------------------------------------------------------
section "ledger-write-gate: in-order transition ALLOWED"
printf '%s' "$VALID_FRESH" > "$LEDGER_PATH"
IN_ORDER=$(echo "$VALID_FRESH" | "$JQ" '
  .currentPhase = 2 |
  .phases[0].status = "completed" |
  .phases[0].reviewerVerdict = "approved" |
  .phases[0].reviewerCycles = 1 |
  .phases[0].handoverEnvelope = {"role":"phase1-scaffold","status":"complete"} |
  .phases[1].status = "in-progress"
')
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$IN_ORDER")" \
  "Write phase 1 → 2 with approval + handover → ALLOW"

rm -f "$LEDGER_PATH"
