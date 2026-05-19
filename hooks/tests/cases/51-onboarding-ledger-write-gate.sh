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
# valid structural reason prefixes — but Pass 1 alone falls under the
# multi-pass 80% threshold (1/15 = 7%). Require scopeAuthorizer for the
# aggregate scope reduction → ALLOW.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"scopeAuthorizer":"user said: only j-alpha is worth dispatching this run; defer the others","passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha"],"returned-journeys":["j-alpha"],"deferredJourneys":[{"journey":"j-beta","reason":"blocked-on-app-bug:BUG-007"},{"journey":"j-gamma","reason":"test-data-prerequisite:premium-seed-user"}]}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with 1 dispatched + 2 structurally-deferred + scopeAuthorizer → ALLOW"

# Phase 5 deferral-authorisation: a deferral without a structural prefix
# AND without an authorizer quote → DENY (per-entry check fires before
# the threshold check is reached).
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"scopeAuthorizer":"user said: defer the others","passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha"],"returned-journeys":["j-alpha"],"deferredJourneys":[{"journey":"j-beta","reason":"blocked-on-app-bug:BUG-007"},{"journey":"j-gamma","reason":"budget-cap"}]}}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with deferral citing 'budget-cap' + no authorizer → DENY" "neither a structural reason prefix"

# Phase 5 deferral-authorisation: a deferral with authorizer quote
# (verbatim user authorisation) + scopeAuthorizer for aggregate → ALLOW.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"scopeAuthorizer":"user said: defer the others","passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha"],"returned-journeys":["j-alpha"],"deferredJourneys":[{"journey":"j-beta","reason":"blocked-on-app-bug:BUG-007"},{"journey":"j-gamma","reason":"session-length","authorizer":"user said: defer the adversarial journeys to a follow-up run"}]}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with per-entry authorizer quote + scopeAuthorizer → ALLOW"

# Phase 5 multi-pass coverage-threshold: closes the exit-#2 / cherry-
# pick exploit. ROSTER * EXPECTED_PASSES * 0.8 dispatches required, OR
# scopeAuthorizer present. For these cases we remove journey-map.md so
# the earlier per-pass-1 check skips (it depends on the map) and the
# threshold check is reached. The threshold check derives ROSTER_SIZE
# from the state file's `journeyRoster` field when the map is absent.
rm -f "$TMP_REPO/tests/e2e/docs/journey-map.md"

# (a) Full coverage across all 5 passes (3 journeys × 5 passes = 15
# dispatches) → ALLOW.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":5,"journeyRoster":["j-alpha","j-beta","j-gamma"],"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"2":{"kind":"compositional","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"3":{"kind":"compositional","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"4":{"kind":"adversarial","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"5":{"kind":"adversarial","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with 5/5 passes × 3/3 journeys = 15 dispatches → ALLOW"

# (b) Pass 1 only with full per-pass-1 coverage but no Pass-2-5 records,
# no scopeAuthorizer → DENY (3/15 = 20% < 80%). This is the Run-7
# exit-#2 anti-pattern.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"journeyRoster":["j-alpha","j-beta","j-gamma"],"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]}}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with Pass-1 only (3/15 dispatches, no scopeAuthorizer) → DENY" "80%"

# (c) Same shape as (b) but with scopeAuthorizer present → ALLOW
# (user-authorised scope reduction).
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"journeyRoster":["j-alpha","j-beta","j-gamma"],"scopeAuthorizer":"user said: pass 1 is enough for this run, defer passes 2-5","passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with Pass-1 only + scopeAuthorizer quote → ALLOW"

# (d) Breadth mode: EXPECTED_PASSES=1, so single sweep at 80%+ → ALLOW.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"breadth","currentPass":1,"journeyRoster":["j-alpha","j-beta","j-gamma","j-delta","j-epsilon"],"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha","j-beta","j-gamma","j-delta"],"returned-journeys":["j-alpha","j-beta","j-gamma","j-delta"]}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed in breadth mode with 4/5 dispatched (80%) → ALLOW"

# (e) Breadth mode below 80% with no scopeAuthorizer → DENY (threshold).
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"breadth","currentPass":1,"journeyRoster":["j-alpha","j-beta","j-gamma","j-delta","j-epsilon"],"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha"],"returned-journeys":["j-alpha"]}}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed in breadth mode with 1/5 (20%) + no scopeAuthorizer → DENY" "80%"

# (f) Run-7 exact shape: roster 5, 1 dispatched, no scopeAuthorizer,
# fake structural-prefix deferrals (everything else 'test-data-prerequisite:..').
# With the map restored, per-pass-1 check passes (roster covered via
# deferrals 1+4=5 ≥ 5) and the new threshold check fires (1/25 = 4%).
# Closes the "fake deferral all" exploit.
cat > "$TMP_REPO/tests/e2e/docs/journey-map.md" <<'EOF'
<!-- journey-mapping:generated -->
# Map
#### j-alpha
#### j-beta
#### j-gamma
#### j-delta
#### j-epsilon
EOF
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"journeyRoster":["j-alpha","j-beta","j-gamma","j-delta","j-epsilon"],"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha"],"returned-journeys":["j-alpha"],"deferredJourneys":[{"journey":"j-beta","reason":"test-data-prerequisite:premium"},{"journey":"j-gamma","reason":"test-data-prerequisite:premium"},{"journey":"j-delta","reason":"test-data-prerequisite:premium"},{"journey":"j-epsilon","reason":"test-data-prerequisite:premium"}]}}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with fake-prefix all-deferrals (1/25 dispatches, no scopeAuthorizer) → DENY" "80%"

# Restore 3-journey map for any downstream tests that depend on it.
cat > "$TMP_REPO/tests/e2e/docs/journey-map.md" <<'EOF'
<!-- journey-mapping:generated -->
# Map
#### j-alpha
#### j-beta
#### j-gamma
EOF

# (g) Typo-hint surfacing — when the state file has a near-name field
# (`scopeAuthoriser`, `scope_authorizer`, etc.), the deny message
# surfaces it so the operator can rename instead of guessing.
rm -f "$TMP_REPO/tests/e2e/docs/journey-map.md"
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":1,"journeyRoster":["j-alpha","j-beta","j-gamma"],"scopeAuthoriser":"user said: pass 1 is enough","passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha"],"returned-journeys":["j-alpha"]}}}
EOF
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → completed with typo \`scopeAuthoriser\` (UK spelling) → DENY with rename hint" "scopeAuthoriser"
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → typo hint mentions rename instruction" "rename it to take effect"

# (h) COVERAGE_EXPANSION_THRESHOLD env var lowers the bar — at 60%, a
# state file with 9/15 dispatches (60%) passes when 80% would have denied.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":3,"journeyRoster":["j-alpha","j-beta","j-gamma"],"passes":{"1":{"kind":"compositional","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"2":{"kind":"compositional","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"3":{"kind":"compositional","dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]}}}
EOF
COVERAGE_EXPANSION_THRESHOLD=60 assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → 9/15 (60%) + COVERAGE_EXPANSION_THRESHOLD=60 → ALLOW"
assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → 9/15 (60%) + default threshold 80% → DENY" "Threshold is 80%"

# Invalid threshold values fall back to 80%.
COVERAGE_EXPANSION_THRESHOLD=not-a-number assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → invalid threshold env var (\"not-a-number\") falls back to 80% → DENY" "Threshold is 80%"
COVERAGE_EXPANSION_THRESHOLD=5 assert_deny "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → out-of-range threshold env var (5) falls back to 80% → DENY" "Threshold is 80%"

# Actor-identity check must fire even when `node` is unavailable to the
# hook. Previously the hook silent-allowed on `command -v node` failure,
# letting an orchestrator on a host with no node-on-PATH bypass the
# entire gate (no schema check, no state-machine check, no actor-
# identity check). Probe by invoking the hook with PATH=/bin:/usr/bin only —
# on macOS that has jq (sufficient) but not node, mirroring the
# real-world exploit shape.
section "ledger-write-gate: node-missing bypass closed (actor-identity still fires)"
rm -f "$LEDGER_PATH"
DIRECT_APPROVAL=$(echo "$VALID_FRESH" | "$JQ" '
  .currentPhase = 2 |
  .phases[0].status = "completed" |
  .phases[0].reviewerVerdict = "approved" |
  .phases[0].handoverEnvelope = {"role":"phase1-scaffold","status":"complete"} |
  . + {modeAuthorizer: "user chose standard mode at front-load gate"}
')
PAYLOAD_DIRECT=$(payload tool_name=Write file_path="$LEDGER_PATH" content="$DIRECT_APPROVAL")
# Precondition: /usr/bin has jq but no node (macOS default).
if [ -x /usr/bin/jq ] && ! /usr/bin/env -i PATH=/bin:/usr/bin command -v node >/dev/null 2>&1; then
  TESTS_RUN=$((TESTS_RUN + 1))
  OUT_NO_NODE=$(printf '%s' "$PAYLOAD_DIRECT" | env PATH=/bin:/usr/bin "$H" 2>&1)
  if echo "$OUT_NO_NODE" | grep -q '"permissionDecision"[[:space:]]*:[[:space:]]*"deny"' \
     && echo "$OUT_NO_NODE" | grep -q 'orchestrator context'; then
    echo "${CLR_PASS}  ✓${CLR_RST} no-node + orchestrator-direct reviewerVerdict:approved write → DENY (actor-identity check fires)"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo "${CLR_FAIL}  ✗${CLR_RST} no-node bypass test ${CLR_DIM}(expected deny with 'orchestrator context'; got: ${OUT_NO_NODE})${CLR_RST}"
  fi
else
  echo "${CLR_DIM}  (skipped — /usr/bin layout doesn't match the macOS shape used for this test)${CLR_RST}"
fi

# (i) `dispatched-journeys` is canonical when both fields are present.
# A pass with empty dispatches[] + populated dispatched-journeys[] used
# to under-count (jq's `//` treated `[]` as truthy). The max() expression
# now picks the non-empty field.
cat > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json" <<'EOF'
{"coverage-expansion-state-version":1,"runMode":"standard","currentPass":5,"journeyRoster":["j-alpha","j-beta","j-gamma"],"passes":{"1":{"kind":"compositional","dispatches":[],"dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"2":{"kind":"compositional","dispatches":[],"dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"3":{"kind":"compositional","dispatches":[],"dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"4":{"kind":"adversarial","dispatches":[],"dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]},"5":{"kind":"adversarial","dispatches":[],"dispatched-journeys":["j-alpha","j-beta","j-gamma"],"returned-journeys":["j-alpha","j-beta","j-gamma"]}}}
EOF
assert_allow "$H" "$(payload tool_name=Write file_path="$LEDGER_PATH" content="$PROPOSED_P5_COMPLETED")" \
  "Phase 5 → empty dispatches[] + populated dispatched-journeys[] counts the latter → ALLOW"

# Restore 3-entry map.
cat > "$TMP_REPO/tests/e2e/docs/journey-map.md" <<'EOF'
<!-- journey-mapping:generated -->
# Map
#### j-alpha
#### j-beta
#### j-gamma
EOF

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
