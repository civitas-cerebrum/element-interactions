#!/bin/bash
# workflow-approver-registry.sh — register authorised approver subagents
#                                  so the ledger-write-gate can verify
#                                  WHO is approving, not just WHAT.
#
# Hook    : PreToolUse:Agent
# Mode    : silent allow (this is a registration hook, never blocks)
# State   : writes tests/e2e/docs/.workflow-approvers.json
# Env     : none
#
# Why
# ---
# `onboarding-ledger-gate.sh` enforces dispatch ORDERING (no Phase N+1
# until Phase N is reviewer-approved), and `onboarding-ledger-write-
# gate.sh` enforces ledger SHAPE + transition validity. Neither checks
# WHO writes the ledger. Without an actor-identity check, the
# orchestrator can simply Write `reviewerVerdict: "approved"` itself —
# a self-grading move that defeats the entire reviewer/inspector
# protocol.
#
# This hook records every approver-prefixed Agent dispatch by tool_use_id.
# The companion write-gate cross-references the proposed write's
# `parent_tool_use_id` against this registry; only registered subagents
# can transition a phase to approved.
#
# Approver-role prefixes:
#   workflow-reviewer-*    — the workflow reviewer / inspector skill
#   phase-validator-*      — per-phase greenlight emitter
#
# Pairs with:
#   hooks/onboarding-ledger-gate.sh           (PreToolUse:Agent DENY — dispatch ordering)
#   hooks/onboarding-ledger-write-gate.sh     (PreToolUse:Write|Edit DENY — shape + actor identity)

set -uo pipefail

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
[ -n "$JQ" ] || { echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found." >&2; exit 1; }

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")
[ "$TOOL_NAME" = "Agent" ] || exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""' 2>/dev/null || echo "")

# Only register approver-prefixed dispatches.
case "$DESCRIPTION" in
  workflow-reviewer-*) APPROVER_ROLE="workflow-reviewer" ;;
  phase-validator-*)   APPROVER_ROLE="phase-validator" ;;
  *)                   exit 0 ;;
esac

AGENT_TOOL_USE_ID=$(echo "$INPUT" | "$JQ" -r '.tool_use_id // empty' 2>/dev/null || echo "")
[ -n "$AGENT_TOOL_USE_ID" ] || exit 0  # no id, can't register — silent allow

GUARD_CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(cd "$GUARD_CWD" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null || echo "$GUARD_CWD")
REGISTRY_DIR="$REPO_ROOT/tests/e2e/docs"
REGISTRY_FILE="$REGISTRY_DIR/.workflow-approvers.json"

# Best-effort: if the docs dir doesn't exist yet (early in Phase 1), the
# write-gate will find no registry and deny any approval write — which is
# the correct behaviour (you can't approve before the test tree exists).
[ -d "$REGISTRY_DIR" ] || exit 0

NOW=$(date +%s)
TTL_SECONDS=1800  # 30 minutes — matches the .in-flight-composers TTL

# Read existing registry (or start empty), expire stale entries, add the
# new one. Atomic via temp + mv.
EXISTING="{}"
if [ -f "$REGISTRY_FILE" ]; then
  EXISTING=$(cat "$REGISTRY_FILE" 2>/dev/null || echo "{}")
  if ! echo "$EXISTING" | "$JQ" -e 'type == "object"' >/dev/null 2>&1; then
    EXISTING="{}"
  fi
fi

UPDATED=$(echo "$EXISTING" | "$JQ" -c \
  --arg id "$AGENT_TOOL_USE_ID" \
  --arg role "$APPROVER_ROLE" \
  --arg desc "$DESCRIPTION" \
  --argjson now "$NOW" \
  --argjson ttl "$TTL_SECONDS" \
  '
    . as $reg
    | reduce keys[] as $k ({};
        if ($reg[$k].ts // 0) >= ($now - $ttl)
          then . + { ($k): $reg[$k] }
          else .
        end
      )
    | . + { ($id): { role: $role, description: $desc, ts: $now } }
  ' 2>/dev/null || echo "")

if [ -n "$UPDATED" ]; then
  TMP="$REGISTRY_FILE.tmp"
  echo "$UPDATED" > "$TMP" 2>/dev/null && mv "$TMP" "$REGISTRY_FILE" 2>/dev/null || rm -f "$TMP" 2>/dev/null || true
fi

exit 0
