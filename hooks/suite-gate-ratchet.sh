#!/bin/bash
# suite-gate-ratchet.sh
#
# Two-event hook split:
#   - PostToolUse on Bash for `playwright test` runs: appends pass/fail to a
#     sliding window of the last N runs in
#     `<repo-root>/.claude/last-suite-result.json` (array shape).
#   - PreToolUse on Bash for `git commit`: if the commit message indicates a
#     phase-progression (`test(j-...):`, `docs(ledger):`, etc.) and ANY run
#     in the window is failed (or oldest run >1h old, or window not yet
#     filled), blocks with a redirect to re-run the suite.
#
# Behaviour is dispatched by the hook_event_name: the harness fires the same
# script for PreToolUse and PostToolUse, and the script branches.
#
# Window size — defaults to 3 (matches the "stabilize 3x" convention in
# element-interactions Stage 3). Override via env var:
#
#     CIVITAS_SUITE_GATE_WINDOW=5
#
# Issue #131 promoted the gate from a one-shot to a windowed ratchet because
# real-world flakes (serial-mode, click-PUT race, auth-state eviction) pass
# an isolated single run but fail across 3-5 reviewer-driven re-runs. The
# windowed gate catches that class at the gate, not in the next pass.

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
