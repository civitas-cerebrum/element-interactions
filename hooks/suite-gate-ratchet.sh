#!/bin/bash
# suite-gate-ratchet.sh
#
# Two-event hook split:
#   - PostToolUse on Bash for `playwright test` runs: records pass/fail to
#     `<repo-root>/.claude/last-suite-result.json` (timestamp + status).
#   - PreToolUse on Bash for `git commit`: if commit message indicates a
#     phase-progression (`test(j-...):`, `docs(ledger):`, `chore: scaffold`,
#     etc.) and the last-suite-result is failed or older than 1 hour, blocks
#     the commit with a redirect to re-run the suite.
#
# Behavior is dispatched by the hookSpecificOutput / event name: the harness
# fires the same script for PreToolUse and PostToolUse, and the script branches.

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

emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# === PostToolUse branch: record `playwright test` result ===
if [ "$EVENT_NAME" = "PostToolUse" ]; then
  # Only fire on `playwright test` invocations.
  RUNNERS='(npx|bunx|pnpm[[:space:]]+exec|yarn[[:space:]]+exec)[[:space:]]+'
  SEP='(^|[;|][[:space:]]*|&&[[:space:]]*|\|\|[[:space:]]*)'
  if ! echo "$CMD" | grep -qE "${SEP}(${RUNNERS})?playwright[[:space:]]+test"; then
    exit 0
  fi

  TOOL_RESPONSE=$(echo "$INPUT" | jq -r '.tool_response // {}')
  EXIT_CODE=$(echo "$TOOL_RESPONSE" | jq -r '.exitCode // .exit_code // .returncode // "unknown"')
  STDOUT=$(echo "$TOOL_RESPONSE" | jq -r '.stdout // .output // ""' 2>/dev/null || echo "")

  # Heuristic: if stdout has "X failed" or exit code != 0, mark fail.
  STATUS="passed"
  if [ "$EXIT_CODE" != "0" ] && [ "$EXIT_CODE" != "unknown" ]; then
    STATUS="failed"
  fi
  if echo "$STDOUT" | grep -qE '[0-9]+ failed'; then
    STATUS="failed"
  fi

  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  jq -n --arg s "$STATUS" --arg t "$TIMESTAMP" --arg c "$EXIT_CODE" \
    '{status: $s, timestamp: $t, exitCode: $c}' > "$STATE_FILE" 2>/dev/null || true
  exit 0
fi

# === PreToolUse branch: gate phase-progression commits ===
if [ "$EVENT_NAME" = "PreToolUse" ]; then
  # Only fire on git commit.
  if ! echo "$CMD" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
    exit 0
  fi

  MSG=$(echo "$CMD" | grep -oE -- "-m[[:space:]]*['\"][^'\"]+['\"]" | head -1 | sed -E "s/^-m[[:space:]]*['\"]//;s/['\"]$//" || true)

  # Only gate phase-progression commits — those that add or update test specs
  # / ledger / state-file. Other commits (docs, deps, chore scaffolding) pass.
  if ! echo "$MSG" | grep -qE '^(test\(j-[a-z0-9-]+|test\(j-[a-z0-9-]+-regression|docs\(ledger|docs\(coverage-expansion-state)'; then
    exit 0
  fi

  if [ ! -f "$STATE_FILE" ]; then
    emit_deny "[BLOCKED] No suite-gate result on file.

Commit: \"${MSG}\"

Fix: run the whole suite first to establish a green baseline.

  npx playwright test --reporter=list

Then re-attempt the commit. The suite gate ratchet records the most recent run; phase-progression commits (test(j-...), docs(ledger): ...) require the most recent run to be green within 1 hour.

Why: phase-progression commits without a recent green suite-gate produce a broken HEAD that flake-rots over passes. See coverage-expansion §\"Whole-suite re-run gate (per-pass exit)\"."
    exit 0
  fi

  STATUS=$(jq -r '.status // "unknown"' "$STATE_FILE" 2>/dev/null || echo "unknown")
  TIMESTAMP=$(jq -r '.timestamp // ""' "$STATE_FILE" 2>/dev/null || echo "")

  if [ "$STATUS" != "passed" ]; then
    emit_deny "[BLOCKED] Suite-gate is currently failed.

Commit: \"${MSG}\"
Last suite-gate: status=${STATUS} at ${TIMESTAMP}

Fix: re-run the whole suite, fix any failures, then re-commit.

  npx playwright test --reporter=list

Why: phase-progression commits build on a green baseline. Committing on top of a red suite makes the regression untraceable when bisecting and rots the next pass's gate. See coverage-expansion §\"Whole-suite re-run gate\"."
    exit 0
  fi

  # Staleness check: result older than 1 hour.
  if [ -n "$TIMESTAMP" ]; then
    NOW_EPOCH=$(date -u +%s)
    THEN_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$TIMESTAMP" +%s 2>/dev/null || date -u -d "$TIMESTAMP" +%s 2>/dev/null || echo "0")
    if [ "$THEN_EPOCH" != "0" ]; then
      AGE=$((NOW_EPOCH - THEN_EPOCH))
      if [ "$AGE" -gt 3600 ]; then
        emit_deny "[BLOCKED] Suite-gate result is stale (>1 hour old).

Commit: \"${MSG}\"
Last suite-gate: passed at ${TIMESTAMP} ($((AGE / 60)) minutes ago)

Fix: re-run the whole suite to refresh the gate.

  npx playwright test --reporter=list

Why: a stale gate doesn't reflect current code state. Re-run before progressing."
        exit 0
      fi
    fi
  fi
fi

exit 0
