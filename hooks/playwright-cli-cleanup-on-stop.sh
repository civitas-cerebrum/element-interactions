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

# Skip close-all when a parallel-dispatch protocol is in flight. The phase4
# iterative-cycle protocol dispatches up to 7+ cycle agents in parallel;
# each owns its own playwright-cli session. close-all on any one agent's
# SubagentStop would wipe ALL siblings' sessions, mid-flow.
#
# Detection: presence of tests/e2e/docs/.phase4-cycle-state.json (the cycle
# state file is created on first cycle agent return and persists until the
# author commits and the run completes). When present, skip close-all and
# rely on agents closing their own sessions.
#
# This deferral creates a small risk of orphaned sessions surviving past
# phase4 completion; the parent or the next phase's invocation can call
# close-all itself if it needs a clean slate.

# Resolve jq the same way every other hook in this directory does:
# bundled binary first, system jq second. Consistency matters because the
# bundled jq has a known version + behaviour; relying on system jq when the
# bundled one is available risks behaviour drift across operator machines.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"

INPUT=$(cat 2>/dev/null || echo "{}")
CWD=""
if [ -n "$JQ" ]; then
  CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // ""' 2>/dev/null || echo "")
fi
[ -z "$CWD" ] && CWD="$PWD"
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")

if [ -f "$REPO_ROOT/tests/e2e/docs/.phase4-cycle-state.json" ]; then
  # Phase4 cycle protocol in flight — skip close-all to preserve sibling
  # CLI sessions.
  exit 0
fi

if command -v npx >/dev/null 2>&1; then
  npx playwright-cli close-all >/dev/null 2>&1 || true
fi

exit 0
