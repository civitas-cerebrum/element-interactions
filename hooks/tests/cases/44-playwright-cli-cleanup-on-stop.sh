#!/bin/bash
# Tests for playwright-cli-cleanup-on-stop.sh — orphaned-session reaper.
#
# The hook always exits 0 with no JSON output (RECORD mode). It side-effects
# only: invokes `npx playwright-cli close-all` unless the phase4 cycle
# protocol is in flight (signalled by the cycle-state file). assert_allow
# fits — it checks for silent allow (empty output + exit 0), which is the
# hook's contract on every input.
H="$HOOK_DIR/playwright-cli-cleanup-on-stop.sh"

section "playwright-cli-cleanup-on-stop: SubagentStop event silent allow"
assert_allow "$H" "$(payload hook_event_name=SubagentStop cwd=/tmp)" "SubagentStop in /tmp → silent allow"
assert_allow "$H" "$(payload hook_event_name=SubagentStop)" "SubagentStop no cwd → silent allow"

section "playwright-cli-cleanup-on-stop: malformed / empty stdin still exits 0"
# The hook handles `cat 2>/dev/null || echo "{}"` so should be robust.
assert_allow "$H" "" "empty stdin → silent allow"
assert_allow "$H" "not-json" "invalid JSON → silent allow"
assert_allow "$H" "{}" "empty JSON object → silent allow"

section "playwright-cli-cleanup-on-stop: phase4 cycle protocol defers cleanup"
# When the phase4 cycle-state file is present in the repo root, the hook
# must skip close-all. We can't observe the side-effect directly from the
# test harness, but we can verify the hook still exits 0 with no JSON output
# (the cycle-state-present branch returns early and is silent).
TMPDIR_P4=$(mktemp -d)
mkdir -p "$TMPDIR_P4/tests/e2e/docs"
echo '{"cycle":1}' > "$TMPDIR_P4/tests/e2e/docs/.phase4-cycle-state.json"
assert_allow "$H" "$(payload hook_event_name=SubagentStop cwd="$TMPDIR_P4")" "phase4 cycle-state present → silent allow (deferred)"
rm -rf "$TMPDIR_P4"

section "playwright-cli-cleanup-on-stop: non-SubagentStop events still exit 0"
# The hook does not gate on hook_event_name explicitly (it runs cleanup on
# every invocation); other events should still be silent.
assert_allow "$H" "$(payload hook_event_name=Stop)" "Stop event → silent allow"
