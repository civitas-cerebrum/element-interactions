#!/bin/bash
# Tests for commit-message-gate.sh — per-phase / per-journey commit-convention enforcer.
H="$HOOK_DIR/commit-message-gate.sh"

section "commit-message-gate: well-formed messages are silent allow"
assert_allow "$H" "$(payload tool_name=Bash command="git commit -m 'test(j-checkout): cycle-2 — multi-item variant'")" "test(j-...) → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash command="git commit -m 'docs(ledger): j-checkout — 4 probes recorded'")" "docs(ledger): j-... → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash command="git commit -m 'test(j-checkout-regression): lock CSRF fix'")" "test(j-...-regression) → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash command="git commit -m 'docs: journey map — 12 journeys prioritized'")" "docs: journey map → ALLOW"
assert_allow "$H" "$(payload tool_name=Bash command="git commit -m 'chore: scaffold element-interactions framework'")" "chore: scaffold → ALLOW"

section "commit-message-gate: tool-name filtering"
assert_allow "$H" "$(payload tool_name=Read file_path=/tmp/x)" "Read tool → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='ls -la')" "non-commit bash → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='git status')" "git status → silent allow"

section "commit-message-gate: --no-verify / --no-gpg-sign DENY"
assert_deny "$H" "$(payload tool_name=Bash command="git commit --no-verify -m 'test(j-x): fix'")" "--no-verify → DENY" "bypass hooks or signing"
assert_deny "$H" "$(payload tool_name=Bash command="git commit --no-gpg-sign -m 'test(j-x): fix'")" "--no-gpg-sign → DENY" "bypass hooks or signing"
# Note: the hook fires only when the command starts with `git commit` adjacent
# (the regex requires `git[[:space:]]+commit`). `git -c <k>=<v> commit` slips
# past that gate and is therefore not denied here. Documented as a known
# limitation; the bypass-flag check here is intentionally adjacent-only to
# keep false-positive risk low.
assert_allow "$H" "$(payload tool_name=Bash command="git -c commit.gpgsign=false commit -m 'test(j-x): fix'")" "git -c form bypass (known gap, not denied)"

section "commit-message-gate: --no-verify inside message body is allowed"
# Quoted-message false-positive avoidance — the flag appears only as message content.
assert_allow "$H" "$(payload tool_name=Bash command="git commit -m 'docs(hooks): blocks --no-verify and --no-gpg-sign'")" "flag inside message body → ALLOW"

section "commit-message-gate: multi-journey commit DENY"
assert_deny "$H" "$(payload tool_name=Bash command="git commit -m 'test(j-checkout, j-signup): cycle-2 batch'")" "multi-journey scope → DENY" "Multi-journey commit"
assert_deny "$H" "$(payload tool_name=Bash command="git commit -m 'test(j-a,j-b): combined'")" "comma-joined multi-j → DENY" "Multi-journey commit"

section "commit-message-gate: feat(e2e) / feat(test) / feat(coverage) DENY"
assert_deny "$H" "$(payload tool_name=Bash command="git commit -m 'feat(e2e): add checkout coverage'")" "feat(e2e) → DENY" "'test:' not 'feat:'"
assert_deny "$H" "$(payload tool_name=Bash command="git commit -m 'feat(test): new spec'")" "feat(test) → DENY" "'test:' not 'feat:'"
assert_deny "$H" "$(payload tool_name=Bash command="git commit -m 'feat(coverage): expand suite'")" "feat(coverage) → DENY" "'test:' not 'feat:'"
assert_deny "$H" "$(payload tool_name=Bash command="git commit -m 'feat(onboarding): new flow'")" "feat(onboarding) → DENY" "'test:' not 'feat:'"

section "commit-message-gate: review(...) commits DENY"
assert_deny "$H" "$(payload tool_name=Bash command="git commit -m 'review(j-checkout): findings'")" "review(...) → DENY" "Review-tagged commits are forbidden"
