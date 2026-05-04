#!/bin/bash
H="$HOOK_DIR/parent-only-orchestrator-dispatch-block.sh"

section "parent-only-orchestrator-dispatch-block: tool filtering"

assert_allow "$H" "$(payload tool_name=Bash command='ls')" "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path='/x')" "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path='/x' content='y')" "Write → silent allow"

section "parent-only-orchestrator-dispatch-block: leaf-prefix bypass (always ALLOW)"

# Leaf descriptions pass through regardless of prompt content (the prompt may
# legitimately reference coverage-expansion as the calling skill).
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' prompt='Run coverage-expansion skill mode: depth as orchestrator')" "composer-j prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='reviewer-j-checkout: cycle 1' prompt='You are the coverage-expansion orchestrator')" "reviewer-j prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='probe-j-checkout: pass 4' prompt='dispatch per journey via coverage-expansion')" "probe-j prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='process-validator-stage-a-wave: validate' prompt='coverage-expansion mode: depth')" "process-validator prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' prompt='Phase 5 coverage-expansion')" "phase-validator prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='phase1-root: discovery' prompt='discover root')" "phase1- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='phase2-cart: inspect' prompt='inspect cart')" "phase2- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='stage2-cart: inspect' prompt='inspect cart')" "stage2- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-ledger: dedup' prompt='cleanup the ledger')" "cleanup- prefix → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='[P3-batch] composer-j-x,j-y: cycle 1' prompt='compose two journeys')" "[P3-batch] prefix → silent allow"

section "parent-only-orchestrator-dispatch-block: coverage-expansion orchestrator → DENY"

# The exact repro from issue #154
assert_deny "$H" "$(payload tool_name=Agent description='Phase 5 coverage-expansion depth mode' prompt='You are executing the coverage-expansion skill in mode: depth as Phase 5 of an onboarding pipeline. You are the coverage-expansion orchestrator. You dispatch composer / reviewer / probe subagents per journey via the Agent tool.')" "issue #154 repro → DENY" "coverage-expansion"

# Just the skill mention + mode flag
assert_deny "$H" "$(payload tool_name=Agent description='cov-exp depth' prompt='Execute the coverage-expansion skill in mode: depth')" "skill mention + mode: depth → DENY" "coverage-expansion"

# SKILL.md reference + orchestrator role
assert_deny "$H" "$(payload tool_name=Agent description='cov-exp run' prompt='Read coverage-expansion/SKILL.md and act as the coverage-expansion orchestrator dispatching per journey')" "SKILL.md path + orchestrator → DENY" "coverage-expansion"

# Five passes language
assert_deny "$H" "$(payload tool_name=Agent description='full pipeline' prompt='Run the coverage-expansion skill: 5 passes per journey, three compositional, two adversarial, fan out test-composer per journey')" "five-passes language → DENY" "coverage-expansion"

section "parent-only-orchestrator-dispatch-block: coverage-expansion non-orchestrator mention → ALLOW"

# Mention without orchestrator role: e.g. an unrelated dispatch where the prompt
# happens to cite coverage-expansion's existence as context. Should not deny.
assert_allow "$H" "$(payload tool_name=Agent description='journey-mapping recap' prompt='See coverage-expansion/SKILL.md for context. You are mapping journeys.')" "skill mention without orchestrator role → silent allow"

section "parent-only-orchestrator-dispatch-block: onboarding orchestrator → DENY"

assert_deny "$H" "$(payload tool_name=Agent description='onboard project' prompt='You are executing the onboarding skill. Run the seven-phase pipeline starting with Phase 1 scaffold.')" "onboarding 7-phase pipeline → DENY" "onboarding"
assert_deny "$H" "$(payload tool_name=Agent description='onboarding-run' prompt='Read onboarding/SKILL.md and act as the onboarding orchestrator. Phase 5 coverage-expansion will be dispatched after Phase 4.')" "onboarding orchestrator role → DENY" "onboarding"

section "parent-only-orchestrator-dispatch-block: bug-discovery app-wide → DENY"

assert_deny "$H" "$(payload tool_name=Agent description='bug hunt' prompt='Run the bug-discovery skill at app-wide scope. Execute Phase 1a flow-probing across all journeys.')" "bug-discovery Phase 1a app-wide → DENY" "bug-discovery"
assert_deny "$H" "$(payload tool_name=Agent description='standalone bug hunt' prompt='Run standalone bug-discovery. Read bug-discovery/SKILL.md. Iterate journey-map and fan out probes.')" "bug-discovery standalone → DENY" "bug-discovery"
assert_deny "$H" "$(payload tool_name=Agent description='probe everything' prompt='You are the bug-discovery orchestrator. Phase 1b element-probing across all journeys.')" "bug-discovery Phase 1b → DENY" "bug-discovery"

section "parent-only-orchestrator-dispatch-block: bug-discovery single-journey leaf → ALLOW"

# A bug-discovery dispatch with single-journey scope (rare, normally uses
# probe- prefix, but if the dispatch is malformed without the prefix the
# hook's leaf-shape detection should still allow it). The leaf-prefix
# bypass at the top would normally catch probe- dispatches; this branch
# protects against accidental denial when the prefix is omitted but the
# scope is genuinely single-journey.
assert_allow "$H" "$(payload tool_name=Agent description='bug hunt j-checkout' prompt='Read bug-discovery/SKILL.md and probe j-checkout for journey j-checkout edge cases. You are probing j-checkout.')" "bug-discovery for single journey (leaf-shape) → silent allow"

section "parent-only-orchestrator-dispatch-block: unrelated dispatches → ALLOW"

assert_allow "$H" "$(payload tool_name=Agent description='research codebase' prompt='Find references to baseFixture in the repo')" "unrelated research dispatch → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='write tests' prompt='Write unit tests for the new helper')" "test-writing dispatch → silent allow"
assert_allow "$H" "$(payload tool_name=Agent description='journey-mapping' prompt='Run journey-mapping skill to map the site')" "different orchestrator skill not in allowlist → silent allow"

section "parent-only-orchestrator-dispatch-block: empty inputs"

assert_allow "$H" "$(payload tool_name=Agent description='' prompt='')" "empty description + prompt → silent allow"

section "parent-only-orchestrator-dispatch-block: escape hatch via env var"

HOOK_OUT=$(POO_DISPATCH_BLOCK=off bash "$H" <<<"$(payload tool_name=Agent description='Phase 5 cov-exp' prompt='Execute coverage-expansion skill in mode: depth as the orchestrator')" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} POO_DISPATCH_BLOCK=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("POO_DISPATCH_BLOCK=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} POO_DISPATCH_BLOCK=off (expected silent allow)"
fi
