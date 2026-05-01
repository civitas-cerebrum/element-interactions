#!/bin/bash
# suite-gate-ratchet.sh — windowed any-red-blocks-progression suite gate
#
# Hook    : PreToolUse:Bash + PostToolUse:Bash  (one script, two events)
# Mode    : RECORD (PostToolUse — append run result) + DENY (PreToolUse —
#           block phase-progression commits on red / unfilled / stale window)
# State   : <repo>/.claude/last-suite-result.json  (sliding window of N runs)
# Env     : CIVITAS_SUITE_GATE_WINDOW=<int>  (default 3, clamped to ≥1)
#
# Rule
# ----
# PostToolUse:  every `playwright test` invocation appends a run record
#               (status / timestamp / exitCode) to the window array, trimmed
#               to the last N entries.
# PreToolUse:   every `git commit` whose message is a phase-progression
#               (`test(j-...)`, `docs(ledger)`, `docs(coverage-expansion-state)`)
#               is denied if ANY run in the window is failed, OR fewer than
#               N runs are recorded, OR the OLDEST run is more than 1h old.
#
# Why
# ---
# A one-shot suite gate catches "lucky green" runs but misses serial-mode
# flakes, click-PUT race conditions, and auth-state eviction post-refresh —
# real failure classes that pass an isolated single run but fail across 3-5
# reviewer-driven re-runs (BookHive run finding: 4 of 12 cycle-2 specs).
# The windowed shape catches that class at the gate. A flake that passes
# 70% of the time displaces no failed entry from a 3-run window — by design.
#
# Canonical reference
# -------------------
# skills/coverage-expansion/references/depth-mode-pipeline.md §"Whole-suite
#   re-run gate (per-pass exit)" — orchestrator-side counterpart
# skills/coverage-expansion/SKILL.md §"Whole-suite re-run gate" (kernel-resident)
#
# State file shape (auto-migrates from legacy single-object form)
# ---------------------------------------------------------------
#   { "window_size": 3,
#     "runs": [
#       { "status": "passed", "timestamp": "...", "exitCode": "0" },
#       { "status": "failed", "timestamp": "...", "exitCode": "1" },
#       { "status": "passed", "timestamp": "...", "exitCode": "0" } ] }
#
# Failure → action
# ----------------
# - PostToolUse `playwright test`        → RECORD (append + trim)
# - PreToolUse phase-progression commit:
#     - state file missing               → DENY (no window)
#     - window_size > runs.length        → DENY (window not yet filled)
#     - any run.status == "failed"       → DENY (any-red)
#     - oldest run > 1h old              → DENY (stale window)
#     - else                             → silent allow
# - Anything else                         → silent allow

set -euo pipefail

INPUT=$(cat)
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // ""')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Resolve repo root for state-file location.
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
STATE_FILE="$REPO_ROOT/.claude/last-suite-result.json"
mkdir -p "$REPO_ROOT/.claude" 2>/dev/null || true

# Window size — env override or default 3.
WINDOW_SIZE="${CIVITAS_SUITE_GATE_WINDOW:-3}"
case "$WINDOW_SIZE" in
  ''|*[!0-9]*) WINDOW_SIZE=3 ;;  # ignore non-integer overrides
esac
[ "$WINDOW_SIZE" -lt 1 ] && WINDOW_SIZE=1

emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# Read the current state, auto-migrating the legacy single-object shape into
# a 1-element window seed. Emits the runs array as a JSON value on stdout.
load_runs_array() {
  if [ ! -f "$STATE_FILE" ]; then
    echo "[]"
    return
  fi
  jq '
    if type == "object" and has("runs") and (.runs | type) == "array" then
      .runs
    elif type == "object" and has("status") then
      # Legacy single-object format — seed the window with this one run.
      [ { status: .status, timestamp: (.timestamp // ""), exitCode: (.exitCode // "unknown") } ]
    else
      []
    end
  ' "$STATE_FILE" 2>/dev/null || echo "[]"
}

# === PostToolUse branch: append `playwright test` result to the window =====
if [ "$EVENT_NAME" = "PostToolUse" ]; then
  RUNNERS='(npx|bunx|pnpm[[:space:]]+exec|yarn[[:space:]]+exec)[[:space:]]+'
  SEP='(^|[;|][[:space:]]*|&&[[:space:]]*|\|\|[[:space:]]*)'
  if ! echo "$CMD" | grep -qE "${SEP}(${RUNNERS})?playwright[[:space:]]+test"; then
    exit 0
  fi

  TOOL_RESPONSE=$(echo "$INPUT" | jq -r '.tool_response // {}')
  EXIT_CODE=$(echo "$TOOL_RESPONSE" | jq -r '.exitCode // .exit_code // .returncode // "unknown"')
  STDOUT=$(echo "$TOOL_RESPONSE" | jq -r '.stdout // .output // ""' 2>/dev/null || echo "")

  STATUS="passed"
  if [ "$EXIT_CODE" != "0" ] && [ "$EXIT_CODE" != "unknown" ]; then
    STATUS="failed"
  fi
  if echo "$STDOUT" | grep -qE '[0-9]+ failed'; then
    STATUS="failed"
  fi

  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  CURRENT=$(load_runs_array)

  # Append + trim to last WINDOW_SIZE entries, then write the new shape.
  jq -n \
    --argjson runs "$CURRENT" \
    --argjson size "$WINDOW_SIZE" \
    --arg     s    "$STATUS" \
    --arg     t    "$TIMESTAMP" \
    --arg     c    "$EXIT_CODE" \
    '
      ($runs + [{ status: $s, timestamp: $t, exitCode: $c }])
      | (if length > $size then .[length - $size : length] else . end) as $trimmed
      | { window_size: $size, runs: $trimmed }
    ' > "$STATE_FILE.tmp" 2>/dev/null && mv "$STATE_FILE.tmp" "$STATE_FILE" || rm -f "$STATE_FILE.tmp"
  exit 0
fi

# === PreToolUse branch: gate phase-progression commits =====================
if [ "$EVENT_NAME" = "PreToolUse" ]; then
  if ! echo "$CMD" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
    exit 0
  fi

  MSG=$(echo "$CMD" | grep -oE -- "-m[[:space:]]*['\"][^'\"]+['\"]" | head -1 | sed -E "s/^-m[[:space:]]*['\"]//;s/['\"]$//" || true)

  if ! echo "$MSG" | grep -qE '^(test\(j-[a-z0-9-]+|test\(j-[a-z0-9-]+-regression|docs\(ledger|docs\(coverage-expansion-state)'; then
    exit 0
  fi

  if [ ! -f "$STATE_FILE" ]; then
    emit_deny "[BLOCKED] No suite-gate window on file.

Commit: \"${MSG}\"

Fix: run the whole suite ${WINDOW_SIZE}× to establish a stable green window.

  for i in \$(seq 1 ${WINDOW_SIZE}); do npx playwright test --reporter=list; done

Then re-attempt the commit. The suite-gate windowed ratchet (issue #131) tracks the last ${WINDOW_SIZE} runs and blocks phase-progression on any-red.

Why: phase-progression commits without a stable green window produce a broken HEAD that flake-rots over passes. A single passing run can mask serial-mode flakes / race conditions / auth-state eviction that surface across re-runs. See coverage-expansion §\"Whole-suite re-run gate\"."
    exit 0
  fi

  RUNS=$(load_runs_array)
  RUN_COUNT=$(echo "$RUNS" | jq 'length')

  # Window not yet filled.
  if [ "$RUN_COUNT" -lt "$WINDOW_SIZE" ]; then
    MISSING=$((WINDOW_SIZE - RUN_COUNT))
    emit_deny "[BLOCKED] Suite-gate window not yet filled (${RUN_COUNT}/${WINDOW_SIZE}).

Commit: \"${MSG}\"

Fix: run the whole suite ${MISSING} more time(s) to fill the window.

  for i in \$(seq 1 ${MISSING}); do npx playwright test --reporter=list; done

Why: the windowed ratchet needs ${WINDOW_SIZE} consecutive runs to gate. A flake that passes once but fails on re-run gets caught by the window — which is the whole point. Single-shot gates miss this class. (Override: \`CIVITAS_SUITE_GATE_WINDOW=N\` if your project's stability convention differs.)"
    exit 0
  fi

  # Any-red in window — collect failed-run timestamps for the deny message.
  FAILED_TIMESTAMPS=$(echo "$RUNS" | jq -r '[.[] | select(.status == "failed") | .timestamp] | join(", ")')
  if [ -n "$FAILED_TIMESTAMPS" ]; then
    emit_deny "[BLOCKED] Suite-gate window contains failed runs.

Commit: \"${MSG}\"
Window size: ${WINDOW_SIZE}
Failed run timestamps: ${FAILED_TIMESTAMPS}

Fix: stabilise the suite — run it until the last ${WINDOW_SIZE} consecutive runs are all green. Each new green run displaces the oldest run in the window.

  for i in \$(seq 1 ${WINDOW_SIZE}); do npx playwright test --reporter=list; done

Why: a single passing re-run after a flake doesn't clear the window — by design. The windowed ratchet exists to catch flakes that pass 70% of the time but fail intermittently in CI. See coverage-expansion §\"Whole-suite re-run gate\"."
    exit 0
  fi

  # All green in window — check staleness against the OLDEST run. If any run
  # has aged past 1h, the window is no longer reflective of current code.
  OLDEST_TS=$(echo "$RUNS" | jq -r '.[0].timestamp // ""')
  if [ -n "$OLDEST_TS" ]; then
    NOW_EPOCH=$(date -u +%s)
    THEN_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$OLDEST_TS" +%s 2>/dev/null || date -u -d "$OLDEST_TS" +%s 2>/dev/null || echo "0")
    if [ "$THEN_EPOCH" != "0" ]; then
      AGE=$((NOW_EPOCH - THEN_EPOCH))
      if [ "$AGE" -gt 3600 ]; then
        emit_deny "[BLOCKED] Suite-gate window is stale (oldest run >1h old).

Commit: \"${MSG}\"
Oldest run in window: ${OLDEST_TS} ($((AGE / 60)) minutes ago)

Fix: re-run the suite ${WINDOW_SIZE}× to refresh the window.

  for i in \$(seq 1 ${WINDOW_SIZE}); do npx playwright test --reporter=list; done

Why: a stale window doesn't reflect current code state. The whole-window age is checked against the oldest run, so a single fresh run on top of stale entries is not enough — re-fill the window."
        exit 0
      fi
    fi
  fi
fi

exit 0
