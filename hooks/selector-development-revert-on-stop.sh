#!/bin/bash
# selector-development-revert-on-stop.sh — Stop-time cleanup.
#
# Hook    : Stop
# Mode    : WARN (initial release; flips to DENY in a follow-up after FP calibration)
# State   : reads tests/e2e/.selector-development/.current-scope + receipt
# Env     : WORKSPACE_ROOT (defaults to git toplevel of cwd)
#
# Rule
# ----
# If a scope is active (.current-scope exists) and the receipt's last passing
# step is not `visual_diff` or `commit`, the skill stopped mid-pipeline —
# surface a WARN with the recovery instruction.

set -uo pipefail

# Stop hooks may receive a payload but we don't need any tool fields. Discard stdin.
cat >/dev/null

ws="${WORKSPACE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")}"
state_dir="$ws/tests/e2e/.selector-development"
scope_file="$state_dir/.current-scope"

[ -f "$scope_file" ] || exit 0
scope=$(cat "$scope_file")
receipt="$state_dir/${scope}.receipt.json"
[ -f "$receipt" ] || exit 0

last=$(jq -r '[.steps[] | select(.status=="pass")] | (last // {}) | .name // ""' "$receipt")
case "$last" in
  visual_diff|commit) exit 0 ;;
esac

files=$(jq -r '.files[]?' "$receipt" | tr '\n' ' ')
message="selector-development: incomplete patch detected for scope '${scope}' (last step: ${last:-<none>}). Run: git checkout -- ${files}&& rm '${receipt}' '${scope_file}'. Otherwise the next selector-development invocation will refuse to start."

jq -n --arg msg "$message" '{systemMessage:$msg}'
exit 0
