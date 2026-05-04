#!/bin/bash
# Edge-case tests for hooks/coverage-expansion-dispatch-guard.sh
H="$HOOK_DIR/coverage-expansion-dispatch-guard.sh"

section "dispatch-guard: basic role-prefix routing"
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-checkout: cycle 1' prompt='cover j-checkout from journey-map.md')" "composer-j- → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='reviewer-j-checkout: cycle 1' prompt='review j-checkout coverage')" "reviewer-j- → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='probe-j-checkout: pass 4' prompt='probe j-checkout for adversarial')" "probe-j- → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='process-validator-stage-a-wave: validate' prompt='validate planned dispatch wave')" "process-validator- → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='phase-validator-5: cycle 1' prompt='verify phase 5 completion contract')" "phase-validator-<N>: → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='phase1-root: discovery' prompt='discover entry root')" "phase1- → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='phase2-marketplace: discovery' prompt='discover marketplace area')" "phase2- → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='stage2-cart-form: inspect' prompt='inspect cart form selectors')" "stage2- → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='cleanup-ledger: dedup' prompt='dedup adversarial ledger')" "cleanup- → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='composer-sj-checkout-pay: cycle 1' prompt='sub-journey composer for sj-checkout-pay')" "composer-sj- → ALLOW"

section "dispatch-guard: bare j- / sj- prefix is denied (issue #126)"
assert_deny "$H" "$(payload tool_name=Agent description='j-checkout: pass 1' prompt='coverage j-checkout')" "bare j- → DENY" "deprecated role-ambiguous prefix"
assert_deny "$H" "$(payload tool_name=Agent description='sj-checkout-pay: pass 1' prompt='coverage sub-journey')" "bare sj- → DENY" "deprecated role-ambiguous prefix"

section "dispatch-guard: P3 batch form"
assert_allow "$H" "$(payload tool_name=Agent description='[P3-batch] composer-j-a, composer-j-b, composer-j-c: P3 batch' prompt='P3 batch composer dispatch')" "[P3-batch] composer-j- → ALLOW"
assert_allow "$H" "$(payload tool_name=Agent description='[P3-batch] composer-j-a,composer-j-b,composer-j-c,composer-j-d,composer-j-e,composer-j-f,composer-j-g: P3 batch' prompt='P3 batch dispatch with 7 items at the cap')" "[P3-batch] 7 items at cap → ALLOW"
assert_deny "$H" "$(payload tool_name=Agent description='[P3-batch] j-a, j-b: legacy bare items' prompt='coverage-expansion P3 batch with j-a and j-b')" "[P3-batch] bare j- items (legacy) → DENY"

section "dispatch-guard: anti-pattern A (subagent fan-out)"
assert_deny "$H" "$(payload tool_name=Agent description='composer-j-x:' prompt='dispatch 4 parallel subagents to handle these journeys')" "composer + dispatch-N-parallel → DENY" "Subagent brief asks the subagent to dispatch sub-subagents"
assert_deny "$H" "$(payload tool_name=Agent description='composer-j-x:' prompt='use the Agent tool to dispatch workers')" "use-Agent-tool-to-dispatch → DENY" "Subagent brief asks the subagent to dispatch sub-subagents"
assert_deny "$H" "$(payload tool_name=Agent description='composer-j-x:' prompt='fan out 5 subagents in parallel for these journeys')" "fan-out-N-parallel → DENY" "Subagent brief asks the subagent to dispatch sub-subagents"

section "dispatch-guard: anti-pattern B (orchestrator meta-content leak)"
assert_deny "$H" "$(payload tool_name=Agent description='composer-j-x: cycle 1' prompt='you are a composer in depth mode 5-pass pipeline pass 4')" "composer + leak → DENY (issue #132)" "orchestrator meta-content"
assert_deny "$H" "$(payload tool_name=Agent description='reviewer-j-x: cycle 1' prompt='review work for pass 2 of the 3 compositional passes')" "reviewer + leak → DENY"
assert_deny "$H" "$(payload tool_name=Agent description='probe-j-x: pass 4' prompt='adversarial pass 4 of the 5-pass pipeline')" "probe + leak → DENY"
assert_warn "$H" "$(payload tool_name=Agent description='cleanup-ledger:' prompt='after depth mode pass 5, dedup the ledger')" "cleanup + leak → soft WARN" "orchestrator meta-content"
assert_warn "$H" "$(payload tool_name=Agent description='phase1-root:' prompt='during depth mode pass 1 discovery')" "phase1 + leak → soft WARN"

section "dispatch-guard: anti-pattern D (batched dispatch via prompt body)"
assert_deny "$H" "$(payload tool_name=Agent description='do everything' prompt='coverage-expansion: cover j-a and j-b and j-c and j-d')" "non-prefixed + 4 distinct j- in coverage-expansion prompt → DENY" "Subagent dispatch missing role-prefixed description"

section "dispatch-guard: tool-name filtering (skip non-Agent)"
assert_allow "$H" "$(payload tool_name=Bash command='echo j-checkout: pass 1')" "Bash invocation → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path=/tmp/x)" "Read invocation → silent allow"
assert_allow "$H" "$(payload tool_name=Edit file_path=/tmp/x)" "Edit invocation → silent allow"

section "dispatch-guard: edge cases"
# Empty description, prompt that doesn't look coverage-related → silent allow
assert_allow "$H" "$(payload tool_name=Agent description='' prompt='just a generic sub-task')" "empty description + non-coverage prompt → silent allow"
# Long description with role prefix at start
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-bookhive-marketplace-buy: cycle 1 of pass 2 retry attempt' prompt='cover j-marketplace-buy')" "long description with role prefix → ALLOW"
# Description with leading whitespace before prefix → not a recognized prefix
assert_deny "$H" "$(payload tool_name=Agent description='   composer-j-x:' prompt='coverage-expansion j-checkout j-cart')" "leading-whitespace prefix → falls to anti-pattern D" "Subagent dispatch missing role-prefixed description"
# Word-boundary safety: prompt mentions obj-foo, subj-x, proj-bar but no actual j- IDs
assert_allow "$H" "$(payload tool_name=Agent description='composer-j-x:' prompt='this is a coverage-expansion task. project subj-x has obj-foo and proj-bar')" "obj-/subj-/proj- substrings + role prefix → ALLOW (no false j- match)"
