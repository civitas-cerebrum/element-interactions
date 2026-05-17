#!/bin/bash
# Tests for standard-mode-first-pass-guard.sh — first-pass / first-cycle
# strict-dispatch enforcement for coverage-expansion + journey-mapping.
# PreToolUse:Agent. DENY mode.
H="$HOOK_DIR/standard-mode-first-pass-guard.sh"

# Set up a temp repo-root so the hook can locate state files relative to cwd.
TMP_REPO=$(mktemp -d /tmp/std-mode-first-pass-XXXXXX)
mkdir -p "$TMP_REPO/tests/e2e/docs"
# Initialise git so `git rev-parse --show-toplevel` returns this dir.
(cd "$TMP_REPO" && git init -q && git config user.email t@t && git config user.name t)
trap 'rm -rf "$TMP_REPO"' EXIT

write_cov_state() {
  echo "$1" > "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json"
}
clear_cov_state() {
  rm -f "$TMP_REPO/tests/e2e/docs/coverage-expansion-state.json"
}
write_cycle_state() {
  echo "$1" > "$TMP_REPO/tests/e2e/docs/.phase4-cycle-state.json"
}
clear_cycle_state() {
  rm -f "$TMP_REPO/tests/e2e/docs/.phase4-cycle-state.json"
}

section "first-pass-guard: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/tmp/x')" "Read → silent allow"

section "first-pass-guard: malformed / missing input silent-allows"
assert_allow "$H" '{"tool_name":"Agent"}' "Agent with no tool_input → silent allow"
assert_allow "$H" '{"tool_name":"Agent","tool_input":{}}' "Agent with empty tool_input → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='')" "Agent with empty description → silent allow"

section "first-pass-guard: Rule 1 — Pass-1 [group] / [P3-batch] DENIED"
clear_cov_state
assert_deny "$H" "$(payload tool_name=Agent description='[group] composer-j-cart,composer-j-checkout:' prompt='Compose.' cwd="$TMP_REPO")" \
  "[group] with no state file → DENY (implicit Pass 1)" "Pass-1 grouping forbidden"
assert_deny "$H" "$(payload tool_name=Agent description='[P3-batch] composer-j-logout,composer-j-role:' prompt='Compose.' cwd="$TMP_REPO")" \
  "[P3-batch] with no state file → DENY (implicit Pass 1)" "Pass-1 grouping forbidden"
write_cov_state '{"currentPass":1,"completedJourneys":[],"journeyRoster":["j-cart"]}'
assert_deny "$H" "$(payload tool_name=Agent description='[group] composer-j-cart,composer-j-checkout:' prompt='Compose.' cwd="$TMP_REPO")" \
  "[group] with currentPass=1 → DENY" "Pass-1 grouping forbidden"

section "first-pass-guard: Rule 1 — Pass-2+ [group] / [P3-batch] ALLOWED"
write_cov_state '{"currentPass":2,"completedJourneys":["j-cart"],"journeyRoster":["j-cart","j-checkout"]}'
assert_allow "$H" "$(payload tool_name=Agent description='[group] composer-j-cart,composer-j-checkout:' prompt='Compose.' cwd="$TMP_REPO")" \
  "[group] with currentPass=2 → ALLOW"
write_cov_state '{"currentPass":3,"completedJourneys":["j-cart","j-checkout"],"journeyRoster":["j-cart","j-checkout"]}'
assert_allow "$H" "$(payload tool_name=Agent description='[P3-batch] composer-j-logout,composer-j-role:' prompt='Compose.' cwd="$TMP_REPO")" \
  "[P3-batch] with currentPass=3 → ALLOW"
write_cov_state '{"currentPass":4,"completedJourneys":[],"journeyRoster":["j-cart"]}'
assert_allow "$H" "$(payload tool_name=Agent description='[group] probe-j-cart,probe-j-checkout:' prompt='Probe.' cwd="$TMP_REPO")" \
  "[group] adversarial probe with currentPass=4 → ALLOW"
clear_cov_state

section "first-pass-guard: Rule 1 — per-journey composer always ALLOWED"
clear_cov_state
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-cart-1-c1:' prompt='Compose. composer.schema.json.' cwd="$TMP_REPO")" \
  "per-journey composer with no state file → ALLOW (not [group])"

section "first-pass-guard: Rule 2 — author without ≥2 cycle-1 sections DENIED"
clear_cycle_state
assert_deny "$H" "$(payload tool_name=Agent description='phase4-prioritise-author:' prompt='Author. phase4-prioritise-author.schema.json.' cwd="$TMP_REPO")" \
  "author with no cycle state file → DENY" "cycle 1 has not yet established"
write_cycle_state '{"cycles":{"1":{"dispatched-sections":["auth"]}}}'
assert_deny "$H" "$(payload tool_name=Agent description='phase4-prioritise-author:' prompt='Author. phase4-prioritise-author.schema.json.' cwd="$TMP_REPO")" \
  "author with 1 cycle-1 section → DENY" "cycle 1 has not yet established"

section "first-pass-guard: Rule 2 — author with ≥2 cycle-1 sections ALLOWED"
write_cycle_state '{"cycles":{"1":{"dispatched-sections":["auth","catalog","cart"]}}}'
assert_allow "$H" "$(payload tool_name=Agent description='phase4-prioritise-author:' prompt='Author. phase4-prioritise-author.schema.json.' cwd="$TMP_REPO")" \
  "author with 3 cycle-1 sections → ALLOW"

section "first-pass-guard: Rule 3 — single-agent walkthrough of cycle 1 DENIED"
clear_cycle_state
assert_deny "$H" "$(payload tool_name=Agent description='walk-app: cover auth, catalog, and cart' prompt='Map them all.' cwd="$TMP_REPO")" \
  "single-agent walking ≥3 sections → DENY" "Single-subagent walkthrough"
assert_deny "$H" "$(payload tool_name=Agent description='map-discovery: explore auth and cart and order' prompt='Map them all.' cwd="$TMP_REPO")" \
  "single-agent walking 3 sections with and → DENY" "Single-subagent walkthrough"

section "first-pass-guard: Rule 3 — ≤2 section references ALLOWED"
clear_cycle_state
assert_allow "$H" "$(payload tool_name=Agent description='single-section: cover auth and cart' prompt='Map.' cwd="$TMP_REPO")" \
  "≤2 section IDs → ALLOW"

section "first-pass-guard: Rule 3 — single-section role per-section subagent ALLOWED"
clear_cycle_state
assert_allow "$H" "$(payload tool_name=Agent description='phase4-cycle-1-section-auth:' prompt='Map auth section.' cwd="$TMP_REPO")" \
  "phase4-cycle-1-section-<id> → ALLOW (single-section per-agent)"

section "first-pass-guard: Rule 3 — legitimate multi-section roles ALLOWED"
clear_cycle_state
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-4: review auth catalog cart' prompt='Validate. phase-validator.schema.json.' cwd="$TMP_REPO")" \
  "phase-validator naming multiple sections → ALLOW (exempted role)"
assert_allow "$H" "$(payload tool_name=Agent description='process-validator-cycle-1: audit auth catalog cart roster' prompt='Audit.' cwd="$TMP_REPO")" \
  "process-validator naming multiple sections → ALLOW (exempted role)"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-cross-pass: dedupe auth catalog cart findings' prompt='Cleanup.' cwd="$TMP_REPO")" \
  "cleanup-<scope> naming multiple sections → ALLOW (exempted role)"

section "first-pass-guard: Rule 3 — cycle 1 already in flight ALLOWS later multi-section dispatches"
write_cycle_state '{"cycles":{"1":{"dispatched-sections":["auth","catalog","cart"]}}}'
assert_allow "$H" "$(payload tool_name=Agent description='cycle-2-walkthrough: revisit auth catalog cart' prompt='Edge-probe.' cwd="$TMP_REPO")" \
  "multi-section after cycle-1 establishes baseline → ALLOW (relaxed)"

clear_cycle_state
clear_cov_state

# ============================================================================
# Depth-mode tests — runMode + cycleStrictness depth keep the strict contract
# on every pass / cycle, not just the first.
# ============================================================================

section "first-pass-guard: Rule 1 — runMode=depth DENIES [group] on ANY pass"
write_cov_state '{"currentPass":2,"runMode":"depth","completedJourneys":["j-cart"],"journeyRoster":["j-cart","j-checkout"]}'
assert_deny "$H" "$(payload tool_name=Agent description='[group] composer-j-cart,composer-j-checkout:' prompt='Compose.' cwd="$TMP_REPO")" \
  "[group] with currentPass=2 + runMode=depth → DENY" "depth"
write_cov_state '{"currentPass":3,"runMode":"depth","completedJourneys":["j-cart","j-checkout"],"journeyRoster":["j-cart","j-checkout"]}'
assert_deny "$H" "$(payload tool_name=Agent description='[P3-batch] composer-j-logout,composer-j-role:' prompt='Compose.' cwd="$TMP_REPO")" \
  "[P3-batch] with currentPass=3 + runMode=depth → DENY" "depth"
write_cov_state '{"currentPass":4,"runMode":"depth","completedJourneys":[],"journeyRoster":["j-cart"]}'
assert_deny "$H" "$(payload tool_name=Agent description='[group] probe-j-cart,probe-j-checkout:' prompt='Probe.' cwd="$TMP_REPO")" \
  "[group] adversarial Pass 4 with runMode=depth → DENY" "depth"
write_cov_state '{"currentPass":5,"runMode":"depth","completedJourneys":[],"journeyRoster":["j-cart"]}'
assert_deny "$H" "$(payload tool_name=Agent description='[group] probe-j-a,probe-j-b,probe-j-c:' prompt='Probe.' cwd="$TMP_REPO")" \
  "[group] adversarial Pass 5 with runMode=depth → DENY" "depth"

section "first-pass-guard: Rule 1 — runMode=standard preserves existing Pass-2+ ALLOW path"
write_cov_state '{"currentPass":2,"runMode":"standard","completedJourneys":["j-cart"],"journeyRoster":["j-cart","j-checkout"]}'
assert_allow "$H" "$(payload tool_name=Agent description='[group] composer-j-cart,composer-j-checkout:' prompt='Compose.' cwd="$TMP_REPO")" \
  "[group] with currentPass=2 + runMode=standard → ALLOW"

section "first-pass-guard: Rule 1 — runMode absent defaults to standard"
write_cov_state '{"currentPass":2,"completedJourneys":["j-cart"],"journeyRoster":["j-cart","j-checkout"]}'
assert_allow "$H" "$(payload tool_name=Agent description='[group] composer-j-cart,composer-j-checkout:' prompt='Compose.' cwd="$TMP_REPO")" \
  "[group] with currentPass=2 + runMode absent → ALLOW (default standard)"

clear_cov_state

section "first-pass-guard: Rule 3 — cycleStrictness=depth DENIES single-agent cycle-2+ walkthroughs"
write_cycle_state '{"cycleStrictness":"depth","cycles":{"1":{"dispatched-sections":["auth","catalog","cart"]}}}'
assert_deny "$H" "$(payload tool_name=Agent description='cycle-2-walkthrough: revisit auth catalog cart' prompt='Edge-probe.' cwd="$TMP_REPO")" \
  "multi-section cycle-2 walkthrough with cycleStrictness=depth → DENY" "depth"
write_cycle_state '{"cycleStrictness":"depth","cycles":{"1":{"dispatched-sections":["auth","catalog","cart","order"]},"2":{"dispatched-sections":["auth","catalog","cart","order"]}}}'
assert_deny "$H" "$(payload tool_name=Agent description='cycle-3: cover auth, catalog, and cart' prompt='Walk.' cwd="$TMP_REPO")" \
  "multi-section cycle-3 walkthrough with cycleStrictness=depth → DENY" "depth"

section "first-pass-guard: Rule 3 — cycleStrictness=standard preserves cycle-2+ ALLOW path"
write_cycle_state '{"cycleStrictness":"standard","cycles":{"1":{"dispatched-sections":["auth","catalog","cart"]}}}'
assert_allow "$H" "$(payload tool_name=Agent description='cycle-2-walkthrough: revisit auth catalog cart' prompt='Edge-probe.' cwd="$TMP_REPO")" \
  "multi-section cycle-2 walkthrough with cycleStrictness=standard → ALLOW"

section "first-pass-guard: Rule 3 — cycleStrictness=depth still exempts legitimate multi-section roles"
write_cycle_state '{"cycleStrictness":"depth","cycles":{"1":{"dispatched-sections":["auth","catalog","cart","order"]}}}'
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-4: review auth catalog cart order' prompt='Validate. phase-validator.schema.json.' cwd="$TMP_REPO")" \
  "phase-validator naming multiple sections under depth → ALLOW (exempted role)"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-cross-cycle: dedupe auth catalog cart findings' prompt='Cleanup.' cwd="$TMP_REPO")" \
  "cleanup-<scope> naming multiple sections under depth → ALLOW (exempted role)"

clear_cycle_state
clear_cov_state
