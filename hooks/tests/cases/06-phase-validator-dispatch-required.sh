#!/bin/bash
H="$HOOK_DIR/phase-validator-dispatch-required.sh"

# Each test sets up its own temp repo so ledger mutations are isolated.
make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs"
  echo "$d"
}

section "phase-validator-dispatch-required: PreToolUse — gate Phase 5 advance"

# T1: no ledger, composer dispatch → DENY
REPO=$(make_repo)
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$REPO")" "no ledger + composer dispatch → DENY" "before phase-validator-4 greenlight"
rm -rf "$REPO"

# T2: ledger with Phase 4 greenlight → composer ALLOW
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"greenlight","validator":"phase-validator-4","cycle":1,"at":"2026-05-02T00:00:00Z","evidence":["tests/e2e/docs/journey-map.md"]}}}
EOF
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$REPO")" "Phase 4 greenlight + composer dispatch → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='reviewer-j-checkout: cycle 1' prompt='review j-checkout' cwd="$REPO")" "Phase 4 greenlight + reviewer dispatch → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='probe-j-checkout: pass 4' prompt='probe j-checkout' cwd="$REPO")" "Phase 4 greenlight + probe dispatch → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='process-validator-stage-a-wave: validate' prompt='validate' cwd="$REPO")" "Phase 4 greenlight + process-validator dispatch → ALLOW"
rm -rf "$REPO"

# T3: ledger with Phase 4 in-progress (improvements-needed cycle 1) → composer DENY
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"in-progress","validator":"phase-validator-4","cycle":1,"at":"2026-05-02T00:00:00Z"}}}
EOF
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$REPO")" "Phase 4 in-progress + composer dispatch → DENY" "before phase-validator-4 greenlight"
rm -rf "$REPO"

# T4: ledger with Phase 4 stalled (cycle 10 cap) → composer DENY with stalled message
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"blocked-phase-validator-stalled","validator":"phase-validator-4","cycle":10,"at":"2026-05-02T00:00:00Z","unresolved-findings":["pv-4-01","pv-4-02"]}}}
EOF
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='composer-j-checkout: cycle 1' prompt='cover j-checkout' cwd="$REPO")" "Phase 4 stalled + composer dispatch → DENY (stalled)" "Phase 4 is stalled"
rm -rf "$REPO"

section "phase-validator-dispatch-required: PreToolUse — phase-validator-1 unconditional, chain rule for N>=2"

# T5: phase-validator-1 with no ledger → ALLOW (chain rule's special case;
# Phase 1 has no prior to gate against, so the validator can always run).
REPO=$(make_repo)
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase-validator-1: cycle 1' prompt='verify Phase 1' cwd="$REPO")" "phase-validator-1 with no ledger → ALLOW (no prior phase)"
rm -rf "$REPO"

# T6: phase-validator-5 with Phase 4 stalled → DENY. Under the new
# validator-chain rule (I-1), phase-validator-N for N>=2 requires
# phase-validator-(N-1) greenlit. blocked-phase-validator-stalled is
# explicitly NOT greenlight, so dispatching the next-phase validator is
# blocked. This was previously a permissive "gate doesn't gate itself"
# test; the chain rule supersedes it because rubber-stamping past a
# stalled prior phase was the bypass we are closing.
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"blocked-phase-validator-stalled","validator":"phase-validator-4","cycle":10,"at":"2026-05-02T00:00:00Z","unresolved-findings":["pv-4-01"]}}}
EOF
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase-validator-5: cycle 1' prompt='verify Phase 5' cwd="$REPO")" "phase-validator-5 with stalled Phase 4 → DENY (chain rule)" "before phase-validator-4 greenlight"
rm -rf "$REPO"

section "phase-validator-dispatch-required: PreToolUse — non-phase-mapped prefixes silent allow"

REPO=$(make_repo)
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase1-root: discovery' prompt='discover root' cwd="$REPO")" "phase1- → silent allow (Phase 4 internal, not yet phase-mapped)"
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='stage2-cart-form: inspect' prompt='inspect cart' cwd="$REPO")" "stage2- → silent allow (Phase 3 internal, not yet phase-mapped)"
rm -rf "$REPO"

# cleanup-* IS in the entering-Phase-5 list (coverage-expansion's post-pass-5 dedup role).
REPO=$(make_repo)
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='cleanup-ledger: dedup' prompt='cleanup' cwd="$REPO")" "cleanup-ledger with no ledger → DENY (coverage-expansion role = entering Phase 5)" "before phase-validator-4 greenlight"
rm -rf "$REPO"

section "phase-validator-dispatch-required: PreToolUse — tool-name filtering"

REPO=$(make_repo)
assert_allow "$H" "$(payload tool_name=Bash hook_event_name=PreToolUse command='echo composer-j-x' cwd="$REPO")" "Bash invocation → silent allow"
assert_allow "$H" "$(payload tool_name=Write hook_event_name=PreToolUse file_path='/x' cwd="$REPO")" "Write invocation → silent allow"
rm -rf "$REPO"

section "phase-validator-dispatch-required: PostToolUse — record ledger on greenlight"

# T9: phase-validator-4 returns greenlight → ledger written
REPO=$(make_repo)
GREEN_RETURN='status: greenlight
phase: 4
sub-skill: journey-mapping
exit-criteria-checked:
  - criterion: journey-map.md sentinel on line 1
    satisfied: true
    evidence: tests/e2e/docs/journey-map.md
  - criterion: coverage-checkpoint signature present
    satisfied: true
    evidence: tests/e2e/docs/journey-map.md (line 245)
findings: []
summary: Phase 4 verified.'
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='phase-validator-4: cycle 1' response_text="$GREEN_RETURN" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
LEDGER_STATUS=$(jq -r '.phases."4".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
if [ "$LEDGER_STATUS" = "greenlight" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} phase-validator-4 greenlight → ledger.phases.4.status = greenlight"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("greenlight ledger write: expected status=greenlight, got '$LEDGER_STATUS'")
  echo "${CLR_FAIL}  ✗${CLR_RST} phase-validator-4 greenlight ledger write"
fi
rm -rf "$REPO"

section "phase-validator-dispatch-required: PostToolUse — increment cycle on improvements-needed"

# T10: phase-validator-4 cycle 1 returns improvements-needed → ledger.cycle = 1, status = in-progress
REPO=$(make_repo)
IN_RETURN='status: improvements-needed
phase: 4
sub-skill: journey-mapping
exit-criteria-checked:
  - criterion: journey-map.md sentinel on line 1
    satisfied: false
    evidence: absent
findings:
  - **pv-4-01** [must-fix] — sentinel missing
    - criterion: journey-map.md sentinel on line 1
    - issue: line 1 is "# Map" not the sentinel
    - fix: prepend the sentinel
summary: 1 finding.'
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='phase-validator-4: cycle 1' response_text="$IN_RETURN" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
LEDGER_STATUS=$(jq -r '.phases."4".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
LEDGER_CYCLE=$(jq -r '.phases."4".cycle // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
if [ "$LEDGER_STATUS" = "in-progress" ] && [ "$LEDGER_CYCLE" = "1" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} phase-validator-4 cycle 1 improvements-needed → ledger.status=in-progress, cycle=1"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("improvements-needed ledger write: status=$LEDGER_STATUS, cycle=$LEDGER_CYCLE")
  echo "${CLR_FAIL}  ✗${CLR_RST} phase-validator-4 cycle 1 improvements-needed ledger write"
fi
rm -rf "$REPO"

section "phase-validator-dispatch-required: PostToolUse — cycle 10 cap → blocked-phase-validator-stalled"

# T11: prior ledger shows cycle 9; this cycle 10 returns improvements-needed → stalled
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"in-progress","validator":"phase-validator-4","cycle":9,"at":"2026-05-02T00:00:00Z"}}}
EOF
IN_RETURN='status: improvements-needed
phase: 4
exit-criteria-checked:
  - criterion: x
    satisfied: false
findings:
  - **pv-4-01** [must-fix] — still missing
    - criterion: x
    - issue: y
    - fix: z
  - **pv-4-02** [must-fix] — also still missing
    - criterion: a
    - issue: b
    - fix: c
summary: 2 findings, cycle 10.'
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='phase-validator-4: cycle 10' response_text="$IN_RETURN" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
LEDGER_STATUS=$(jq -r '.phases."4".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
LEDGER_CYCLE=$(jq -r '.phases."4".cycle // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
LEDGER_FINDINGS=$(jq -r '.phases."4"."unresolved-findings" | length' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo 0)
if [ "$LEDGER_STATUS" = "blocked-phase-validator-stalled" ] && [ "$LEDGER_CYCLE" = "10" ] && [ "$LEDGER_FINDINGS" = "2" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} cycle 10 improvements-needed → blocked-phase-validator-stalled with 2 unresolved findings"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("cycle 10 stalled: status=$LEDGER_STATUS, cycle=$LEDGER_CYCLE, findings=$LEDGER_FINDINGS")
  echo "${CLR_FAIL}  ✗${CLR_RST} cycle 10 stalled ledger write"
fi
rm -rf "$REPO"

section "phase-validator-dispatch-required: PostToolUse — non-phase-validator returns silent"

REPO=$(make_repo)
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='composer-j-checkout: cycle 1' response_text='status: new-tests-landed' cwd="$REPO")"
TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} composer-* PostToolUse → no ledger written"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("composer-* should not write ledger")
  echo "${CLR_FAIL}  ✗${CLR_RST} composer-* should not write ledger"
fi
rm -rf "$REPO"

section "phase-validator-dispatch-required: validator-chain rule (I-1)"

# C1: phase-validator-1 with no ledger → ALLOW (no prior phase to gate against)
REPO=$(make_repo)
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase-validator-1: cycle 1' prompt='validate phase 1' cwd="$REPO")" "phase-validator-1 with no ledger → ALLOW"
rm -rf "$REPO"

# C2: phase-validator-2 with no ledger → DENY (Phase 1 not greenlit)
REPO=$(make_repo)
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase-validator-2: cycle 1' prompt='validate phase 2' cwd="$REPO")" "phase-validator-2 with no Phase 1 greenlight → DENY" "before phase-validator-1 greenlight"
rm -rf "$REPO"

# C3: phase-validator-7 with phases 1-5 greenlit but phase 6 in-progress → DENY (skip-to-7 path)
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"1":{"status":"greenlight","cycle":1},"2":{"status":"greenlight","cycle":1},"3":{"status":"greenlight","cycle":1},"4":{"status":"greenlight","cycle":1},"5":{"status":"greenlight","cycle":1},"6":{"status":"in-progress","cycle":1}}}
EOF
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase-validator-7: cycle 1' prompt='validate phase 7' cwd="$REPO")" "phase-validator-7 dispatched while Phase 6 in-progress → DENY (chain rule)" "before phase-validator-6 greenlight"
rm -rf "$REPO"

# C4: phase-validator-6 with phases 1-5 greenlit → ALLOW (chain satisfied)
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"1":{"status":"greenlight","cycle":1},"2":{"status":"greenlight","cycle":1},"3":{"status":"greenlight","cycle":1},"4":{"status":"greenlight","cycle":1},"5":{"status":"greenlight","cycle":1}}}
EOF
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='phase-validator-6: cycle 1' prompt='validate phase 6' cwd="$REPO")" "phase-validator-6 with Phase 5 greenlight → ALLOW (chain satisfied)"
rm -rf "$REPO"

section "phase-validator-dispatch-required: probe-* differentiation (I-1)"

# P1: probe-* with coverage-state.status=="in-progress" + Phase 4 greenlight → ALLOW (Phase 5 adversarial)
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"greenlight","cycle":1}}}
EOF
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<EOF
{"status":"in-progress","mode":"depth","currentPass":4,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-09T08:00:00Z"}
EOF
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='probe-j-a: pass 4' prompt='probe j-a' cwd="$REPO")" "probe-* with cov-state in-progress + Phase 4 greenlit → ALLOW (Phase 5 adversarial)"
rm -rf "$REPO"

# P2: probe-* with coverage-state.status=="complete" + Phase 4 greenlit but Phase 5 NOT greenlit → DENY (Phase 6 blocked)
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"greenlight","cycle":1}}}
EOF
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<EOF
{"status":"complete","mode":"depth","currentPass":5,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-09T08:00:00Z"}
EOF
assert_deny "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='probe-j-a: bug-discovery flow' prompt='probe j-a phase 6' cwd="$REPO")" "probe-* with cov-state complete + Phase 5 not greenlit → DENY (Phase 6 blocked)" "before phase-validator-5 greenlight"
rm -rf "$REPO"

# P3: probe-* with coverage-state.status=="complete" + Phase 5 greenlit → ALLOW (Phase 6 entry)
REPO=$(make_repo)
cat > "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" <<EOF
{"phases":{"4":{"status":"greenlight","cycle":1},"5":{"status":"greenlight","cycle":1}}}
EOF
cat > "$REPO/tests/e2e/docs/coverage-expansion-state.json" <<EOF
{"status":"complete","mode":"depth","currentPass":5,"journeyRoster":["j-a"],"passes":{},"updatedAt":"2026-05-09T08:00:00Z"}
EOF
assert_allow "$H" "$(payload tool_name=Agent hook_event_name=PreToolUse description='probe-j-a: bug-discovery flow' prompt='probe j-a phase 6' cwd="$REPO")" "probe-* with cov-state complete + Phase 5 greenlit → ALLOW (Phase 6 entry)"
rm -rf "$REPO"

section "phase-validator-dispatch-required: PostToolUse — payload-shape polyglot (BookHive Run-5 finding)"

# S1: live-harness shape — tool_response.content as [{type,text}] array.
# This is the shape the live claude-code harness emits for Agent returns.
# Run 5 caught the regression where the hook only knew about
# tool_response.output and silently exited on the .content shape, never
# writing the ledger and stranding the entire onboarding pipeline at the
# Phase-1 → Phase-2 validator-chain check.
REPO=$(make_repo)
GREEN_RETURN_S1='status: greenlight
phase: 1
sub-skill: inline
exit-criteria-checked:
  - criterion: package.json deps installed
    satisfied: true
    evidence: package.json
  - criterion: scaffolded files present
    satisfied: true
    evidence: tests/fixtures/base.ts
  - criterion: chromium installed
    satisfied: true
    evidence: ~/Library/Caches/ms-playwright/chromium-1222
findings: []
summary: Phase 1 verified via live-harness payload (.content shape).'
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='phase-validator-1: cycle 1' response_content="$GREEN_RETURN_S1" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
LEDGER_STATUS_S1=$(jq -r '.phases."1".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
LEDGER_EVIDENCE_S1=$(jq -r '.phases."1".evidence | length' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo 0)
if [ "$LEDGER_STATUS_S1" = "greenlight" ] && [ "$LEDGER_EVIDENCE_S1" -ge 3 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} live-harness .content shape → ledger written (greenlight + 3 evidence pointers)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=(".content-shape ledger write: status=$LEDGER_STATUS_S1, evidence_count=$LEDGER_EVIDENCE_S1 (expected greenlight + ≥3)")
  echo "${CLR_FAIL}  ✗${CLR_RST} live-harness .content shape ledger write"
fi
rm -rf "$REPO"

# S2: improvements-needed under .content shape — must increment cycle to 1
# with status=in-progress (same path as the .output-shape T10 test).
REPO=$(make_repo)
IN_RETURN_S2='status: improvements-needed
phase: 1
sub-skill: inline
exit-criteria-checked:
  - criterion: scaffolded files present
    satisfied: false
    evidence: absent — playwright.config.ts missing
findings:
  - **pv-1-01** [must-fix] — playwright.config.ts missing
    - criterion: scaffolded files present
    - issue: playwright.config.ts not present at repo root
    - fix: write playwright.config.ts per Phase 1 scaffold spec
summary: 1 finding, Phase 1 not yet ready.'
run_hook "$H" "$(payload tool_name=Agent hook_event_name=PostToolUse description='phase-validator-1: cycle 1' response_content="$IN_RETURN_S2" cwd="$REPO")"

TESTS_RUN=$((TESTS_RUN + 1))
LEDGER_STATUS_S2=$(jq -r '.phases."1".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
LEDGER_CYCLE_S2=$(jq -r '.phases."1".cycle // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
if [ "$LEDGER_STATUS_S2" = "in-progress" ] && [ "$LEDGER_CYCLE_S2" = "1" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} live-harness .content shape (improvements-needed) → status=in-progress, cycle=1"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=(".content-shape improvements-needed: status=$LEDGER_STATUS_S2, cycle=$LEDGER_CYCLE_S2 (expected in-progress + 1)")
  echo "${CLR_FAIL}  ✗${CLR_RST} live-harness .content shape improvements-needed ledger write"
fi
rm -rf "$REPO"

# S3: degenerate fallback — neither .content nor .output, only top-level
# string. The fallback (tool_response | tostring) should still surface the
# greenlight marker. This locks down the schema-guard-mirror fallback so a
# future payload-shape change still writes the ledger via the catch-all.
REPO=$(make_repo)
GREEN_RETURN_S3='status: greenlight
phase: 1
sub-skill: inline
exit-criteria-checked:
  - criterion: c1
    satisfied: true
    evidence: e1
findings: []
summary: top-level string shape.'
# Use jq directly to build a payload where tool_response IS the string (no
# .content / .output / .result keys) — exercises the fallback path.
TOPLEVEL_PAYLOAD=$(jq -nc \
  --arg cwd "$REPO" \
  --arg desc 'phase-validator-1: cycle 1' \
  --arg resp "$GREEN_RETURN_S3" \
  '{tool_name:"Agent", hook_event_name:"PostToolUse", cwd:$cwd, tool_input:{description:$desc}, tool_response:$resp}')
run_hook "$H" "$TOPLEVEL_PAYLOAD"

TESTS_RUN=$((TESTS_RUN + 1))
LEDGER_STATUS_S3=$(jq -r '.phases."1".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
if [ "$LEDGER_STATUS_S3" = "greenlight" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} top-level string shape → ledger written via top-level-string branch"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("top-level-string ledger write: status=$LEDGER_STATUS_S3 (expected greenlight)")
  echo "${CLR_FAIL}  ✗${CLR_RST} top-level string shape ledger write"
fi
rm -rf "$REPO"

# S4: payload under unrecognised nested key (e.g., .tool_response.message)
# — the whole-object stringify fallback CAN see the text but the JSON
# encoding folds real newlines into literal `\n`, so the line-anchored
# `status:` regex won't match. The hook must NOT crash and MUST NOT write
# a malformed ledger entry; it simply silently exits (no ledger write).
# This locks down the "do no harm" property: future harness shapes that
# put text under unfamiliar keys degrade to silent allow rather than
# corrupting the ledger.
REPO=$(make_repo)
GREEN_RETURN_S4='status: greenlight
phase: 1
sub-skill: inline
exit-criteria-checked:
  - criterion: c1
    satisfied: true
    evidence: e1
findings: []
summary: under-unrecognised-key payload.'
NESTED_PAYLOAD=$(jq -nc \
  --arg cwd "$REPO" \
  --arg desc 'phase-validator-1: cycle 1' \
  --arg resp "$GREEN_RETURN_S4" \
  '{tool_name:"Agent", hook_event_name:"PostToolUse", cwd:$cwd, tool_input:{description:$desc}, tool_response:{message:$resp, status:"ok"}}')
run_hook "$H" "$NESTED_PAYLOAD"

TESTS_RUN=$((TESTS_RUN + 1))
if [ ! -f "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} unrecognised nested key → silent allow (no malformed ledger write)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  ACTUAL=$(jq -r '.phases."1".status // empty' "$REPO/tests/e2e/docs/onboarding-phase-ledger.json" 2>/dev/null || echo "")
  FAIL_DETAILS+=("nested-key payload should NOT write ledger (got status=$ACTUAL)")
  echo "${CLR_FAIL}  ✗${CLR_RST} nested-key payload should silently exit"
fi
rm -rf "$REPO"
