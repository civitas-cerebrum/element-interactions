#!/bin/bash
# playwright-cli-cleanup-on-stop.sh
#
# SubagentStop hook (and Stop hook fallback). Runs `playwright-cli close-all`
# to reap any orphaned per-subagent sessions. Belt-and-suspenders cleanup
# for subagents that finished without explicitly closing their own session.
#
# Per skills/element-interactions/references/playwright-cli-protocol.md §3.2,
# subagents own opening AND closing their session. The parent runs close-all
# at end-of-phase as belt-and-suspenders. This hook automates the latter.

set -euo pipefail

# Run cleanup quietly — don't block parent flow on failure.
if command -v npx >/dev/null 2>&1; then
  npx playwright-cli close-all >/dev/null 2>&1 || true
fi

exit 0
