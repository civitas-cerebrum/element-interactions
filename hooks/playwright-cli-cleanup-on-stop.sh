#!/bin/bash
# playwright-cli-cleanup-on-stop.sh — orphaned-session reaper
#
# Hook    : SubagentStop  (no matcher — fires on every subagent termination)
# Mode    : RECORD (no JSON output; runs `playwright-cli close-all` and exits)
# State   : none
# Env     : none
#
# Rule
# ----
# Every SubagentStop event triggers `playwright-cli close-all` to reap any
# orphaned per-subagent browser sessions. The hook never blocks; cleanup
# failures fall through silently.
#
# Why
# ---
# Subagents own opening AND closing their own session per the playwright-cli
# protocol. A subagent that exits without explicitly closing leaves its
# session bound to the playwright-cli daemon, which prevents the next
# subagent that requests the same slug from binding. close-all is the
# belt-and-suspenders cleanup that keeps the daemon's session table clean
# even when individual subagents skip their close.
#
# Canonical reference
# -------------------
# skills/element-interactions/references/playwright-cli-protocol.md §3.2
# (Quarantine on start) — same-shape close-all the parent runs at phase boundaries.
#
# Failure → action
# ----------------
# - close-all errors  → silent (|| true). The next subagent's session-name
#                       conflict will surface the issue more directly.
# - npx not on PATH   → silent (consumer is misconfigured; not our gate).

set -euo pipefail

if command -v npx >/dev/null 2>&1; then
  npx playwright-cli close-all >/dev/null 2>&1 || true
fi

exit 0
