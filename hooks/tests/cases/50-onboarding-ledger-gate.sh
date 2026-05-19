#!/bin/bash
# Tests for onboarding-ledger-gate.sh — pipeline state-machine enforcement
# at every onboarding phase / coverage-expansion pass / journey-mapping
# cycle transition. PreToolUse:Agent. DENY mode.
H="$HOOK_DIR/onboarding-ledger-gate.sh"

# Temp repo + ledger paths.
TMP_REPO=$(mktemp -d /tmp/onboarding-ledger-gate-XXXXXX)
mkdir -p "$TMP_REPO/tests/e2e/docs"
(cd "$TMP_REPO" && git init -q && git config user.email t@t && git config user.name t)
trap 'rm -rf "$TMP_REPO"' EXIT

LEDGER="$TMP_REPO/tests/e2e/docs/onboarding-status.json"

write_ledger() {
  printf '%s' "$1" > "$LEDGER"
}
clear_ledger() {
  rm -f "$LEDGER"
}

# Helper — emit a baseline ledger with phases array; mutate via jq pipes.
fresh_ledger_json='{
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
section "ledger-gate: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/tmp/x')" "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/tmp/x' content='y')" "Write → silent allow (handled by write-gate)"

# ---------------------------------------------------------------------------
section "ledger-gate: malformed / missing input silent-allows"
assert_allow "$H" '{"tool_name":"Agent"}' "Agent with no tool_input → silent allow"
assert_allow "$H" '{"tool_name":"Agent","tool_input":{}}' "Agent with empty tool_input → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='')" "Agent with empty description → silent allow"

# ---------------------------------------------------------------------------
section "ledger-gate: missing ledger silent-allows (fresh run, Phase 1 may start)"
clear_ledger
assert_allow "$H" "$(payload tool_name=Agent description='phase1-scaffold' prompt='Lay down the config.' cwd="$TMP_REPO")" \
  "phase1-scaffold with no ledger → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='composer-happy-path' prompt='Compose. composer.schema.json' cwd="$TMP_REPO")" \
  "composer with no ledger → silent allow"

# ---------------------------------------------------------------------------
section "ledger-gate: malformed ledger silent-allows (write-gate owns integrity)"
write_ledger 'not-json-at-all'
assert_allow "$H" "$(payload tool_name=Agent description='phase2-groundwork' prompt='Author app-context.' cwd="$TMP_REPO")" \
  "phase2 dispatch with malformed ledger → silent allow"
write_ledger '{"no-such-field": true}'
assert_allow "$H" "$(payload tool_name=Agent description='phase2-groundwork' prompt='Author.' cwd="$TMP_REPO")" \
  "phase2 dispatch with shape-less ledger → silent allow"

# ---------------------------------------------------------------------------
section "ledger-gate: workflow-reviewer-* dispatches ALWAYS allowed"
# Even with a pending-verdict transition point.
write_ledger "$(echo "$fresh_ledger_json" | "$JQ" '
  .currentPhase = 2 |
  .phases[0].status = "completed" |
  .phases[0].reviewerVerdict = "pending" |
  .phases[0].handoverEnvelope = {"role":"phase1-scaffold","status":"complete"}
')"
assert_allow "$H" "$(payload tool_name=Agent description='workflow-reviewer-phase1: review Phase 1 exit criteria' prompt='Validate per onboarding/SKILL.md §Phase 1.' cwd="$TMP_REPO")" \
  "workflow-reviewer-phase1 at transition point → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='workflow-reviewer-pass2: pass-2 dedup verification' prompt='Review.' cwd="$TMP_REPO")" \
  "workflow-reviewer-pass2 → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='workflow-reviewer-cycle1: cycle-1 baseline check' prompt='Review.' cwd="$TMP_REPO")" \
  "workflow-reviewer-cycle1 → ALLOW"

# ---------------------------------------------------------------------------
section "ledger-gate: transition-point forces workflow-reviewer-* dispatch"
write_ledger "$(echo "$fresh_ledger_json" | "$JQ" '
  .currentPhase = 2 |
  .phases[0].status = "completed" |
  .phases[0].reviewerVerdict = "pending" |
  .phases[0].handoverEnvelope = {"role":"phase1-scaffold","status":"complete"}
')"
assert_deny "$H" "$(payload tool_name=Agent description='phase2-groundwork' prompt='Author app-context.' cwd="$TMP_REPO")" \
  "phase2 dispatch with phase1 verdict pending → DENY" "workflow-reviewer-phase1"
assert_deny "$H" "$(payload tool_name=Agent description='composer-happy-path: write a spec' prompt='Compose. composer.schema.json' cwd="$TMP_REPO")" \
  "composer dispatch with prior phase pending → DENY" "workflow-reviewer-phase1"

# ---------------------------------------------------------------------------
section "ledger-gate: approved verdict allows next phase to begin"
write_ledger "$(echo "$fresh_ledger_json" | "$JQ" '
  .currentPhase = 2 |
  .phases[0].status = "completed" |
  .phases[0].reviewerVerdict = "approved" |
  .phases[0].reviewerCycles = 1 |
  .phases[0].handoverEnvelope = {"role":"phase1-scaffold","status":"complete"} |
  .phases[1].status = "in-progress"
')"
assert_allow "$H" "$(payload tool_name=Agent description='phase2-groundwork' prompt='Author.' cwd="$TMP_REPO")" \
  "phase2 dispatch after phase1 approved → ALLOW"

# ---------------------------------------------------------------------------
section "ledger-gate: out-of-order phase dispatch DENIED"
# currentPhase=2, but a phase4-* dispatch jumps over phase 2 + 3.
write_ledger "$(echo "$fresh_ledger_json" | "$JQ" '
  .currentPhase = 2 |
  .phases[0].status = "completed" |
  .phases[0].reviewerVerdict = "approved" |
  .phases[0].handoverEnvelope = {"role":"phase1-scaffold","status":"complete"} |
  .phases[1].status = "in-progress"
')"
assert_deny "$H" "$(payload tool_name=Agent description='phase4-cycle-1-section-auth:' prompt='Map auth.' cwd="$TMP_REPO")" \
  "phase4 dispatch with currentPhase=2 → DENY" "Out-of-order phase dispatch"

# secrets-sweep-* before phase 6 approved.
write_ledger "$(echo "$fresh_ledger_json" | "$JQ" '
  .currentPhase = 6 |
  .phases[0].status = "completed" | .phases[0].reviewerVerdict = "approved" | .phases[0].handoverEnvelope = {} |
  .phases[1].status = "completed" | .phases[1].reviewerVerdict = "approved" | .phases[1].handoverEnvelope = {} |
  .phases[2].status = "completed" | .phases[2].reviewerVerdict = "approved" | .phases[2].handoverEnvelope = {} |
  .phases[3].status = "completed" | .phases[3].reviewerVerdict = "approved" | .phases[3].handoverEnvelope = {} |
  .phases[4].status = "completed" | .phases[4].reviewerVerdict = "approved" | .phases[4].handoverEnvelope = {} |
  .phases[5].status = "in-progress" | .phases[5].reviewerVerdict = "pending"
')"
assert_deny "$H" "$(payload tool_name=Agent description='secrets-sweep-scan:' prompt='Sweep.' cwd="$TMP_REPO")" \
  "secrets-sweep dispatch with phase6 not approved → DENY" "Out-of-order phase dispatch"

# ---------------------------------------------------------------------------
section "ledger-gate: pass-N+1 dispatch DENIED while pass-N pending"
# Inside Phase 5, pass-2 composer dispatch with pass-1 verdict pending.
write_ledger "$(echo "$fresh_ledger_json" | "$JQ" '
  .currentPhase = 5 |
  .currentSubStage = "pass-2" |
  .phases[0].status = "completed" | .phases[0].reviewerVerdict = "approved" | .phases[0].handoverEnvelope = {} |
  .phases[1].status = "completed" | .phases[1].reviewerVerdict = "approved" | .phases[1].handoverEnvelope = {} |
  .phases[2].status = "completed" | .phases[2].reviewerVerdict = "approved" | .phases[2].handoverEnvelope = {} |
  .phases[3].status = "completed" | .phases[3].reviewerVerdict = "approved" | .phases[3].handoverEnvelope = {} |
  .phases[4].status = "in-progress" | .phases[4].subStages = [
    {"id":"pass-1","status":"completed","reviewerVerdict":"pending","reviewerCycles":0}
  ]
')"
assert_deny "$H" "$(payload tool_name=Agent description='composer-j-cart-2-c1:' prompt='Compose. composer.schema.json' cwd="$TMP_REPO")" \
  "pass-2 composer dispatch with pass-1 verdict pending → DENY" "pass-1 is not reviewer-approved"

# ---------------------------------------------------------------------------
section "ledger-gate: pass-N+1 dispatch ALLOWED after pass-N approved"
write_ledger "$(echo "$fresh_ledger_json" | "$JQ" '
  .currentPhase = 5 |
  .currentSubStage = "pass-2" |
  .phases[0].status = "completed" | .phases[0].reviewerVerdict = "approved" | .phases[0].handoverEnvelope = {} |
  .phases[1].status = "completed" | .phases[1].reviewerVerdict = "approved" | .phases[1].handoverEnvelope = {} |
  .phases[2].status = "completed" | .phases[2].reviewerVerdict = "approved" | .phases[2].handoverEnvelope = {} |
  .phases[3].status = "completed" | .phases[3].reviewerVerdict = "approved" | .phases[3].handoverEnvelope = {} |
  .phases[4].status = "in-progress" | .phases[4].subStages = [
    {"id":"pass-1","status":"completed","reviewerVerdict":"approved","reviewerCycles":1},
    {"id":"pass-2","status":"in-progress","reviewerVerdict":"pending","reviewerCycles":0}
  ]
')"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-cart-2-c1:' prompt='Compose. composer.schema.json' cwd="$TMP_REPO")" \
  "pass-2 composer dispatch after pass-1 approved → ALLOW"

# ---------------------------------------------------------------------------
section "ledger-gate: cycle-N+1 dispatch DENIED while cycle-N pending"
write_ledger "$(echo "$fresh_ledger_json" | "$JQ" '
  .currentPhase = 4 |
  .currentSubStage = "cycle-2" |
  .phases[0].status = "completed" | .phases[0].reviewerVerdict = "approved" | .phases[0].handoverEnvelope = {} |
  .phases[1].status = "completed" | .phases[1].reviewerVerdict = "approved" | .phases[1].handoverEnvelope = {} |
  .phases[2].status = "completed" | .phases[2].reviewerVerdict = "approved" | .phases[2].handoverEnvelope = {} |
  .phases[3].status = "in-progress" | .phases[3].subStages = [
    {"id":"cycle-1","status":"completed","reviewerVerdict":"pending","reviewerCycles":0}
  ]
')"
assert_deny "$H" "$(payload tool_name=Agent description='phase4-cycle-2-section-auth:' prompt='Edge-probe auth.' cwd="$TMP_REPO")" \
  "cycle-2 dispatch with cycle-1 verdict pending → DENY" "cycle-1 is not reviewer-approved"

# ---------------------------------------------------------------------------
section "ledger-gate: free-form prefixes silent-allow when no transition point pending"
write_ledger "$(echo "$fresh_ledger_json" | "$JQ" '
  .currentPhase = 1 |
  .phases[0].status = "in-progress" |
  .phases[0].reviewerVerdict = "pending"
')"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-pass1-findings' prompt='Dedup.' cwd="$TMP_REPO")" \
  "cleanup-* during phase1 in-progress (no transition point) → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='process-validator-3' prompt='Audit.' cwd="$TMP_REPO")" \
  "process-validator-* without phase-N+1 jump → ALLOW"

clear_ledger
