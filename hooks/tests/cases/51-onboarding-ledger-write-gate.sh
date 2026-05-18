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
# A fresh ledger init must include both runMode AND modeAuthorizer (the
# mode-authorisation gate further down enforces this in isolation, but
# the fresh-init allow-path also has to satisfy the same contract).
VALID_FRESH_INIT=$(echo "$VALID_FRESH" | "$JQ" '. + {modeAuthorizer: "user chose standard mode at front-load gate"}')
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$VALID_FRESH_INIT")" \
  "Write fresh valid ledger (with modeAuthorizer) → ALLOW"

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
# Start from a prior state where phase 1 is ALREADY approved (so this
# write only newly-approves the skipped phase 2 — exercising the
# skip-with-authorizer carve-out in isolation).
PRIOR_PHASE1_APPROVED=$(echo "$VALID_FRESH" | "$JQ" '
  .currentPhase = 2 |
  .phases[0].status = "completed" | .phases[0].reviewerVerdict = "approved" | .phases[0].handoverEnvelope = {"role":"phase1","status":"complete"} |
  .phases[1].status = "in-progress"
')
printf '%s' "$PRIOR_PHASE1_APPROVED" > "$LEDGER_PATH"
SKIP_AUTHORISED=$(echo "$PRIOR_PHASE1_APPROVED" | "$JQ" '
  .currentPhase = 3 |
  .phases[1].status = "skipped" | .phases[1].reviewerVerdict = "approved" | .phases[1].handoverEnvelope = {"role":"workflow-reviewer-phase2","status":"approved"} |
  .approvedDeviations = [{"phase":2,"deviation":"groundwork-pre-existing","authorizer":"user said: groundwork already documented in /docs"}]
')
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$SKIP_AUTHORISED")" \
  "Write that skips phase 2 with authorizer + status=skipped → ALLOW (user-authorised carve-out)"

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
section "ledger-write-gate: actor-identity on approval transitions"
# The state-machine + shape checks above don't enforce WHO writes the
# ledger. This section verifies the separation-of-duties layer: a write
# that transitions reviewerVerdict to approved must come from a
# registered approver subagent.

printf '%s' "$VALID_FRESH" > "$LEDGER_PATH"
IN_ORDER=$(echo "$VALID_FRESH" | "$JQ" '
  .currentPhase = 2 |
  .phases[0].status = "completed" |
  .phases[0].reviewerVerdict = "approved" |
  .phases[0].reviewerCycles = 1 |
  .phases[0].handoverEnvelope = {"role":"phase1-scaffold","status":"complete"} |
  .phases[1].status = "in-progress"
')

# Test: orchestrator-direct write (no parent_tool_use_id) approving phase 1 → DENY
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$IN_ORDER")" \
  "Orchestrator direct write approving phase → DENY" "separation-of-duties"

# Test: subagent context but no approver registry → DENY
P_NOREG=$(payload tool_name=Write file_path="$LEDGER_PATH" content="$IN_ORDER")
P_NOREG=$(echo "$P_NOREG" | "$JQ" -c '. + {parent_tool_use_id: "toolu_some_subagent"}')
assert_deny "$H" "$P_NOREG" "Subagent context but no registry → DENY" "no approver registry exists"

# Seed the approver registry next to the ledger, then re-test.
NOW=$(date +%s)
REGISTRY="$TMP_REPO/tests/e2e/docs/.workflow-approvers.json"
printf '{"toolu_approved":{"role":"workflow-reviewer","description":"workflow-reviewer-phase1","ts":%d}}' "$NOW" > "$REGISTRY"

# Test: registered workflow-reviewer subagent approves → ALLOW
P_OK=$(payload tool_name=Write file_path="$LEDGER_PATH" content="$IN_ORDER")
P_OK=$(echo "$P_OK" | "$JQ" -c '. + {parent_tool_use_id: "toolu_approved"}')
assert_allow "$H" "$P_OK" "Registered workflow-reviewer subagent → ALLOW"

# Test: subagent context but the tool_use_id is not in the registry → DENY
P_UNREG=$(payload tool_name=Write file_path="$LEDGER_PATH" content="$IN_ORDER")
P_UNREG=$(echo "$P_UNREG" | "$JQ" -c '. + {parent_tool_use_id: "toolu_unknown"}')
assert_deny "$H" "$P_UNREG" "Unregistered subagent (e.g., composer) approving → DENY" "NOT in the approver registry"

# Test: registry entry expired (> 30 min) → DENY
EXPIRED_TS=$((NOW - 3600))
printf '{"toolu_expired":{"role":"workflow-reviewer","description":"workflow-reviewer-phase1","ts":%d}}' "$EXPIRED_TS" > "$REGISTRY"
P_EXP=$(payload tool_name=Write file_path="$LEDGER_PATH" content="$IN_ORDER")
P_EXP=$(echo "$P_EXP" | "$JQ" -c '. + {parent_tool_use_id: "toolu_expired"}')
assert_deny "$H" "$P_EXP" "Expired approver entry → DENY" "registry entry has expired"

# Test: write that does NOT transition any reviewerVerdict → ALLOW even from orchestrator
printf '%s' "$VALID_FRESH" > "$LEDGER_PATH"
rm -f "$REGISTRY"
NO_APPROVAL=$(echo "$VALID_FRESH" | "$JQ" '.phases[0].deliverables = ["playwright.config.ts","tests/e2e/playwright.setup.ts"]')
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$NO_APPROVAL")" \
  "Orchestrator non-approval write (deliverables update) → ALLOW"

rm -f "$LEDGER_PATH" "$REGISTRY"

# ---------------------------------------------------------------------------
section "ledger-write-gate: mode-authorisation"
# `runMode` is required by the schema; this gate forces it to be set
# WITH an audit-trail `modeAuthorizer` field naming the user's explicit
# choice. Defaults are not silent.

VALID_FRESH_NO_AUTH="$VALID_FRESH"  # has runMode=standard, no modeAuthorizer
VALID_FRESH_WITH_AUTH=$(echo "$VALID_FRESH" | "$JQ" '. + {modeAuthorizer: "user said: use standard mode"}')

# Case A: fresh ledger init setting runMode without modeAuthorizer
rm -f "$LEDGER_PATH"
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$VALID_FRESH_NO_AUTH")" \
  "Fresh ledger init with runMode but no modeAuthorizer → DENY" "without a modeAuthorizer field"

# Case B: fresh ledger init setting runMode WITH modeAuthorizer
rm -f "$LEDGER_PATH"
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$VALID_FRESH_WITH_AUTH")" \
  "Fresh ledger init with runMode AND modeAuthorizer → ALLOW"

# Case C: subsequent write keeping runMode + modeAuthorizer unchanged
printf '%s' "$VALID_FRESH_WITH_AUTH" > "$LEDGER_PATH"
PERSIST_AUTH=$(echo "$VALID_FRESH_WITH_AUTH" | "$JQ" '.phases[0].deliverables = ["playwright.config.ts"]')
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PERSIST_AUTH")" \
  "Write that keeps runMode + modeAuthorizer unchanged → ALLOW"

# Case D: subsequent write clearing modeAuthorizer while keeping runMode
printf '%s' "$VALID_FRESH_WITH_AUTH" > "$LEDGER_PATH"
CLEARED_AUTH=$(echo "$VALID_FRESH_WITH_AUTH" | "$JQ" 'del(.modeAuthorizer)')
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$CLEARED_AUTH")" \
  "Clearing modeAuthorizer while runMode persists → DENY" "modeAuthorizer cleared while runMode remains set"

# Case E: subsequent write changing runMode without fresh modeAuthorizer
printf '%s' "$VALID_FRESH_WITH_AUTH" > "$LEDGER_PATH"
CHANGED_NO_AUTH=$(echo "$VALID_FRESH_WITH_AUTH" | "$JQ" '.runMode = "depth" | del(.modeAuthorizer)')
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$CHANGED_NO_AUTH")" \
  "Changing runMode without fresh modeAuthorizer → DENY" "without a modeAuthorizer field"

# Case F: subsequent write changing runMode WITH fresh modeAuthorizer
printf '%s' "$VALID_FRESH_WITH_AUTH" > "$LEDGER_PATH"
CHANGED_WITH_AUTH=$(echo "$VALID_FRESH_WITH_AUTH" | "$JQ" '.runMode = "depth" | .modeAuthorizer = "user re-elected depth mode after seeing Pass 1 cost"')
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$CHANGED_WITH_AUTH")" \
  "Changing runMode WITH fresh modeAuthorizer → ALLOW"

rm -f "$LEDGER_PATH"

# ---------------------------------------------------------------------------
# Per-phase positive-deliverable checks. Each phase has unforgeable
# signatures of the correct skill having been invoked; transitioning a
# phase to `completed` without those signatures is denied.
# ---------------------------------------------------------------------------

make_phase_in_progress() {
  local target_phase=$1
  local target_idx=$((target_phase - 1))
  echo "$VALID_FRESH" | "$JQ" --argjson idx "$target_idx" \
    '.phases[$idx].status = "in-progress" |
     .currentPhase = ($idx + 1) |
     .modeAuthorizer = "user chose standard mode"'
}
mark_phase_completed() {
  local target_phase=$1
  local target_idx=$((target_phase - 1))
  echo "$VALID_FRESH" | "$JQ" --argjson idx "$target_idx" \
    '.phases[$idx].status = "completed" |
     .phases[$idx].handoverEnvelope = {"role":"phase-closing","cycle":1,"status":"complete","next-action":"advance"} |
     .currentPhase = ($idx + 1) |
     .modeAuthorizer = "user chose standard mode"'
}

# ---- Phase 4 ----
section "ledger-write-gate: Phase 4 → completed requires journey-map + sentinel + cycles"
rm -f "$LEDGER_PATH"
PRIOR_P4_INPROG=$(make_phase_in_progress 4)
printf '%s' "$PRIOR_P4_INPROG" > "$LEDGER_PATH"
PROPOSED_P4_COMPLETED=$(mark_phase_completed 4)

assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P4_COMPLETED")" \
  "Phase 4 → completed with no journey-map.md → DENY" "journey-map.md does not exist"

mkdir -p "$TMP_REPO/tests/e2e/docs"
echo "# Hand-rolled, no sentinel" > "$TMP_REPO/tests/e2e/docs/journey-map.md"
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P4_COMPLETED")" \
  "Phase 4 → completed with sentinel-less map → DENY" "missing the line-1 sentinel"

echo "<!-- journey-mapping:generated -->
# Map" > "$TMP_REPO/tests/e2e/docs/journey-map.md"
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P4_COMPLETED")" \
  "Phase 4 → completed with no cycle-state → DENY" ".phase4-cycle-state.json does not exist"

cat > "$TMP_REPO/tests/e2e/docs/.phase4-cycle-state.json" <<'EOF'
{"phase4-cycle-state-version":1,"started-at":"2026-05-18T09:00:00Z","cycleStrictness":"standard","cycles":{"1":{"kind":"discovery","dispatched-sections":["a","b"],"returned-sections":["a","b"]}}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P4_COMPLETED")" \
  "Phase 4 → completed without cycle-2 edge-probe → DENY" "missing cycle-1 and/or cycle-2"

cat > "$TMP_REPO/tests/e2e/docs/.phase4-cycle-state.json" <<'EOF'
{"phase4-cycle-state-version":1,"started-at":"2026-05-18T09:00:00Z","cycleStrictness":"standard","cycles":{"1":{"kind":"discovery","dispatched-sections":["a","b"],"returned-sections":["a","b"]},"2":{"kind":"edge-probe","dispatched-sections":["a","b"],"returned-sections":["a","b"]}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P4_COMPLETED")" \
  "Phase 4 → completed with map+sentinel+cycles 1+2 → ALLOW"

# Phase 4: cycle-roster mismatch (dispatched ≠ returned) → DENY.
cat > "$TMP_REPO/tests/e2e/docs/.phase4-cycle-state.json" <<'EOF'
{"phase4-cycle-state-version":1,"started-at":"2026-05-18T09:00:00Z","cycleStrictness":"standard","cycles":{"1":{"kind":"discovery","dispatched-sections":["a","b","c"],"returned-sections":["a","b"]},"2":{"kind":"edge-probe","dispatched-sections":["a","b","c"],"returned-sections":["a","b","c"]}}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P4_COMPLETED")" \
  "Phase 4 → completed with cycle-1 dispatched(3)≠returned(2) → DENY" "Some section agents did not return"

# ---- Phase 5 ----
section "ledger-write-gate: Phase 5 → completed requires coverage-expansion-state"
rm -f "$LEDGER_PATH" "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json"
PRIOR_P5_INPROG=$(make_phase_in_progress 5)
printf '%s' "$PRIOR_P5_INPROG" > "$LEDGER_PATH"
PROPOSED_P5_COMPLETED=$(mark_phase_completed 5)

assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed without coverage-expansion-state → DENY" "coverage-expansion-state.json does not exist"

cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":0,"passes":{}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed without pass-1 record → DENY" "no pass-1 record"

cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-x"],"returned-journeys":["j-x"]}}}
EOF
# At this point a sentinel-bearing journey-map.md from the prior Phase-4
# test is still on disk (line 1 sentinel + `# Map` body). It has zero
# `^#### j-` blocks, so the coverage-completeness check sees roster=0
# and skips the comparison — ALLOW.
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with pass-1 record + empty journey-map → ALLOW (roster=0 skips count check)"

# Phase 5 coverage-completeness: roster has 3 journeys, dispatched 1,
# no deferrals → DENY (silent scope compression).
cat > "$TMP_REPO/tests/e2e/docs/journey-map.md" <<'EOF'
<!-- journey-mapping:generated -->
# Map
#### j-alpha
#### j-beta
#### j-gamma
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with 1/3 journeys dispatched, no deferrals → DENY" "silently missing"

# Phase 5 coverage-completeness: roster 3 dispatched 1, 2 deferred with
# valid structural reason prefixes → ALLOW.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha"],"returned-journeys":["j-alpha"],"deferredJourneys":[{"journey":"j-beta","reason":"blocked-on-app-bug:BUG-007"},{"journey":"j-gamma","reason":"test-data-prerequisite:premium-seed-user"}]}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with 1 dispatched + 2 structurally-deferred → ALLOW"

# Phase 5 deferral-authorisation: a deferral without a structural prefix
# AND without an authorizer quote → DENY.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha"],"returned-journeys":["j-alpha"],"deferredJourneys":[{"journey":"j-beta","reason":"blocked-on-app-bug:BUG-007"},{"journey":"j-gamma","reason":"budget-cap"}]}}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with deferral citing 'budget-cap' + no authorizer → DENY" "neither a structural reason prefix"

# Phase 5 deferral-authorisation: a deferral with authorizer quote
# (verbatim user authorisation) → ALLOW even with a non-structural reason.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha"],"returned-journeys":["j-alpha"],"deferredJourneys":[{"journey":"j-beta","reason":"blocked-on-app-bug:BUG-007"},{"journey":"j-gamma","reason":"session-length","authorizer":"user said: defer the adversarial journeys to a follow-up run"}]}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with deferral carrying authorizer quote → ALLOW"

# ---- Phase 6 ----
section "ledger-write-gate: Phase 6 → completed requires adversarial-findings.md"
rm -f "$LEDGER_PATH" "$TMP_REPO/tests/e2e/docs/adversarial-findings.md"
PRIOR_P6_INPROG=$(make_phase_in_progress 6)
printf '%s' "$PRIOR_P6_INPROG" > "$LEDGER_PATH"
PROPOSED_P6_COMPLETED=$(mark_phase_completed 6)
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P6_COMPLETED")" \
  "Phase 6 → completed without adversarial-findings.md → DENY" "adversarial-findings.md does not exist"

# Empty ledger (title only, no per-journey blocks) → DENY.
echo "# Adversarial Findings" > "$TMP_REPO/tests/e2e/docs/adversarial-findings.md"
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P6_COMPLETED")" \
  "Phase 6 → completed with empty adversarial ledger → DENY" "0 per-journey section blocks"

# At least one per-journey section block → ALLOW.
cat > "$TMP_REPO/tests/e2e/docs/adversarial-findings.md" <<'EOF'
# Adversarial Findings

### j-alpha
Pass 4 — probe: clean.
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P6_COMPLETED")" \
  "Phase 6 → completed with ≥1 per-journey section in ledger → ALLOW"

# ---- Phase 7 ----
section "ledger-write-gate: Phase 7 → completed requires .env.example"
rm -f "$LEDGER_PATH" "$TMP_REPO/.env.example"
PRIOR_P7_INPROG=$(make_phase_in_progress 7)
printf '%s' "$PRIOR_P7_INPROG" > "$LEDGER_PATH"
PROPOSED_P7_COMPLETED=$(mark_phase_completed 7)
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P7_COMPLETED")" \
  "Phase 7 → completed without .env.example → DENY" ".env.example does not exist"
echo "BASE_URL=" > "$TMP_REPO/.env.example"
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P7_COMPLETED")" \
  "Phase 7 → completed with .env.example → ALLOW"

# ---- Phase 8 ----
section "ledger-write-gate: Phase 8 → completed requires qa-summary-deck.{html,pdf}"
rm -f "$LEDGER_PATH" "$TMP_REPO/qa-summary-deck.html" "$TMP_REPO/qa-summary-deck.pdf"
PRIOR_P8_INPROG=$(make_phase_in_progress 8)
printf '%s' "$PRIOR_P8_INPROG" > "$LEDGER_PATH"
PROPOSED_P8_COMPLETED=$(mark_phase_completed 8)
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P8_COMPLETED")" \
  "Phase 8 → completed without deck files → DENY" "qa-summary-deck"
echo "<html></html>" > "$TMP_REPO/qa-summary-deck.html"
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P8_COMPLETED")" \
  "Phase 8 → completed without PDF → DENY" "qa-summary-deck.pdf"
echo "%PDF" > "$TMP_REPO/qa-summary-deck.pdf"
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P8_COMPLETED")" \
  "Phase 8 → completed with HTML+PDF deck → ALLOW"

rm -f "$LEDGER_PATH"
