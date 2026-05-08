#!/bin/bash
# phase4-concurrency-log-format.sh — enforce concurrency log canonical path + format
#
# Hook    : PreToolUse:Write|Edit  (filters to phase4 concurrency-log writes)
# Mode    : DENY (wrong path, malformed line, missing required fields)
# State   : reads <repo>/tests/e2e/docs/.phase4-cycle-state.json (only fires
#           when phase4 is in flight)
# Env     : CONCURRENCY_LOG_FORMAT_GUARD=off
#
# Rule
# ----
# Cycle agents in phase4 emit concurrency-log entries when an actual race
# affects sibling agents' work. The canonical channel is a single append-
# only JSONL file at:
#
#   tests/e2e/docs/.phase4-concurrency-log.jsonl
#
# Every line MUST be a single-line JSON object with the strict schema
# documented in `journey-mapping/SKILL.md` §"Concurrency coordination":
#
#   {"timestamp":"<ISO-8601>", "from":"<role-prefix>", "conflict-type":"<enum>",
#    "resource":"<short-string>", "value":"<short-string|null>",
#    "details":"<one-sentence>", "action-taken":"<enum>",
#    "recommendation":"<one-sentence|null>"}
#
# `conflict-type` enum: resource-collision | destructive-side-effect |
#                       auth-rate-limit | state-corruption | unexpected-data
# `action-taken` enum:  retry-with-namespace | abort-and-flag |
#                       wait-and-retry | coordinate-with-peer
#
# Required fields: timestamp, from, conflict-type, resource, action-taken
# Optional/nullable: value, details, recommendation
#
# Why
# ---
# Cycle agents have, in practice, drifted to non-canonical paths
# (`tests/e2e/docs/.concurrency-log/<file>.md` etc.). Markdown-only
# enforcement of the JSONL format + canonical filename re-opens that
# loophole. The author and phase-validator-4 read the canonical path; if
# agents write elsewhere, the data is silently ignored downstream.
#
# Failure → action
# ----------------
# - Write|Edit on a path matching common non-canonical concurrency log
#   shapes (e.g. .concurrency-log/, concurrency.md, etc.) AND
#   .phase4-cycle-state.json exists                              → DENY (redirect)
# - Write|Edit on the canonical path with content where any line is not
#   valid JSON                                                    → DENY
# - Canonical-path write where any line lacks required fields    → DENY
# - Canonical-path write where conflict-type or action-taken is
#   outside the allowed enum                                      → DENY
# - Anything else                                                 → silent allow

set -euo pipefail

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found" >&2
  exit 1
fi

emit_deny() {
  "$JQ" -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# Escape hatch.
if [ "${CONCURRENCY_LOG_FORMAT_GUARD:-}" = "off" ]; then
  exit 0
fi

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')

# === Bash branch — close the >> / > redirect bypass ========================
if [ "$TOOL_NAME" = "Bash" ]; then
  CMD=$(echo "$INPUT" | "$JQ" -r '.tool_input.command // ""')
  CWD_BASH=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
  REPO_ROOT_BASH=$(git -C "$CWD_BASH" rev-parse --show-toplevel 2>/dev/null || echo "$CWD_BASH")
  STATE_BASH="$REPO_ROOT_BASH/tests/e2e/docs/.phase4-cycle-state.json"

  # Only enforce when phase4 is in flight.
  [ ! -f "$STATE_BASH" ] && exit 0

  # Detect redirects to the canonical OR known non-canonical concurrency-log
  # paths. Patterns covered:
  #   ... > tests/e2e/docs/.phase4-concurrency-log.jsonl
  #   ... >> tests/e2e/docs/.phase4-concurrency-log.jsonl
  #   ... > tests/e2e/docs/.concurrency-log/<file>
  #   ... > absolute/path/.phase4-concurrency-log.jsonl
  # AND tee / cat-redirect equivalents.
  #
  # Exclusion: stderr-only redirects (`2>` / `2>&1`) don't count.
  # Match every form that writes content to the canonical (or known
  # non-canonical) concurrency-log path. We need to deny:
  #   stdout redirects:    `>`,  `>>`,  `1>`,  `1>>`
  #   stdout+stderr merge: `&>`, `&>>`  (POSIX shorthand for `> file 2>&1`)
  #   tee with -a / |tee:  `tee`, `tee -a`
  # While ALLOWING stderr-only redirects:  `2>`, `2>>` (stderr never carries
  # the JSONL payload; redirecting an error log to a side file is fine).
  #
  # Pattern strategy: three matchers with explicit anchors so each form is
  # an obvious test case for future regression coverage.
  if   echo "$CMD" | grep -qE '(^|[^0-9&])>>?[[:space:]]*[^[:space:]&]*\.phase4-concurrency-log\.jsonl' \
    || echo "$CMD" | grep -qE '(^|[^0-9&])>>?[[:space:]]*[^[:space:]&]*\.concurrency-log/' \
    || echo "$CMD" | grep -qE '\&>>?[[:space:]]*[^[:space:]&]*\.phase4-concurrency-log\.jsonl' \
    || echo "$CMD" | grep -qE '\&>>?[[:space:]]*[^[:space:]&]*\.concurrency-log/' \
    || echo "$CMD" | grep -qE 'tee[[:space:]]+(-a[[:space:]]+)?[^[:space:]]*\.(phase4-)?concurrency-log'; then
    "$JQ" -n --arg cmd "$CMD" --arg canonical "tests/e2e/docs/.phase4-concurrency-log.jsonl" '{
      "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": ("[BLOCKED] Bash redirect to the concurrency log bypasses the format guard.\n\n──────────────────────────────────────────────────────────────────\nDo this instead:\n──────────────────────────────────────────────────────────────────\nUse the Write tool to append to " + $canonical + ". The Write|Edit guard validates each line against the strict JSONL schema (timestamp, from, conflict-type ∈ enum, resource, action-taken ∈ enum). Bash >> appends slip past the validator.\n\nIf you genuinely need to script the append, the cleanest path is:\n\n  1. Read the current file content\n  2. Append your validated entry as a new line\n  3. Write the full content back via Write\n\n──────────────────────────────────────────────────────────────────\nWhat was wrong:\n──────────────────────────────────────────────────────────────────\nCommand: " + $cmd + "\n\nReferences:\n  skills/journey-mapping/SKILL.md §\"Concurrency coordination\"\n  skills/element-interactions/references/subagent-return-schema.md §\"Concurrency-log emission rules\"\n\nEscape hatch: CONCURRENCY_LOG_FORMAT_GUARD=off (defeats the contract).")
      }
    }'
    exit 0
  fi

  exit 0
fi

# === Write/Edit branch (original) ==========================================
case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // ""')
[ -z "$FILE_PATH" ] && exit 0

CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
STATE="$REPO_ROOT/tests/e2e/docs/.phase4-cycle-state.json"
CANONICAL="$REPO_ROOT/tests/e2e/docs/.phase4-concurrency-log.jsonl"
CANONICAL_REL="tests/e2e/docs/.phase4-concurrency-log.jsonl"

# Only enforce when phase4 is actually in flight (state file exists).
[ ! -f "$STATE" ] && exit 0

# === Path enforcement: detect non-canonical concurrency log writes =========
# Matches paths that LOOK like a phase4 concurrency log but aren't canonical.
# The patterns target the failure modes observed in the dogfood run plus
# common variants.
NORMALISED_PATH=$(echo "$FILE_PATH" | sed 's|//*|/|g')

case "$NORMALISED_PATH" in
  *"/tests/e2e/docs/.phase4-concurrency-log.jsonl")
    # Canonical — fall through to format validation below.
    ;;
  *"/tests/e2e/docs/.concurrency-log/"*|*"/tests/e2e/docs/.concurrency-log."*)
    emit_deny "[BLOCKED] Non-canonical concurrency-log path.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

Append your concurrency-log entry as a single-line JSON object to:

  ${CANONICAL_REL}

(POSIX append on PIPE_BUF-fitting lines is atomic — single \`>>\` works
without locking, as long as each entry is one line ≤4096 bytes.)

Example entry (one line, no trailing newlines inside fields):

  {\"timestamp\":\"2026-05-08T22:13:00Z\",\"from\":\"phase4-cycle-2-section-cart\",\"conflict-type\":\"resource-collision\",\"resource\":\"listing-69fe428a\",\"value\":null,\"details\":\"two parallel buys; both succeeded; seller credited 2x\",\"action-taken\":\"abort-and-flag\",\"recommendation\":\"marketplace-buy is race-prone\"}

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: Write|Edit to \"${FILE_PATH}\"
This is NOT the canonical concurrency-log path.
Canonical path: ${CANONICAL_REL}

The phase4 protocol uses ONE append-only JSONL file. The author and
phase-validator-4 read ONLY this file. Markdown directories or per-agent
files are silently ignored downstream — a real race goes unrecorded.

References:
  skills/journey-mapping/SKILL.md §\"Concurrency coordination\"
  skills/element-interactions/references/subagent-return-schema.md §\"Concurrency-log emission rules\"

Escape hatch: CONCURRENCY_LOG_FORMAT_GUARD=off (defeats the contract)."
    exit 0
    ;;
  *"phase4-concurrency-log."*|*"phase4-concurrency."*|*"concurrency-log.md"|*"concurrency-log.txt"|*"concurrency-log.csv")
    emit_deny "[BLOCKED] Concurrency-log filename does not match the canonical pattern.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

Use the canonical path:
  ${CANONICAL_REL}

(JSONL — one JSON object per line — append only.)

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
File: ${FILE_PATH}
Canonical: ${CANONICAL_REL}

References:
  skills/journey-mapping/SKILL.md §\"Concurrency coordination\""
    exit 0
    ;;
  *)
    # Other paths — not a concurrency log; silent allow.
    exit 0
    ;;
esac

# === Format validation: writes to the canonical path =======================
# Every line of the new content must:
#   1. Be a non-empty single-line JSON object
#   2. Include required fields: timestamp, from, conflict-type, resource, action-taken
#   3. Have conflict-type ∈ canonical enum
#   4. Have action-taken ∈ canonical enum
#   5. Have `from` matching a role-prefix (phase4-cycle-N-section-X, ...)

extract_new_content() {
  if [ "$TOOL_NAME" = "Write" ]; then
    echo "$INPUT" | "$JQ" -r '.tool_input.content // ""'
  else
    # Edit: validate the new_string.
    echo "$INPUT" | "$JQ" -r '.tool_input.new_string // ""'
  fi
}

NEW_CONTENT=$(extract_new_content)
[ -z "$NEW_CONTENT" ] && exit 0

VALID_CONFLICT_TYPES="resource-collision destructive-side-effect auth-rate-limit state-corruption unexpected-data"
VALID_ACTIONS="retry-with-namespace abort-and-flag wait-and-retry coordinate-with-peer"

LINE_NUM=0
ERRORS=""

while IFS= read -r line; do
  LINE_NUM=$((LINE_NUM + 1))
  # Skip blank lines (shouldn't be in JSONL but tolerate trailing newline).
  [ -z "$line" ] && continue

  # 1. Valid JSON?
  if ! echo "$line" | "$JQ" -e . >/dev/null 2>&1; then
    ERRORS="${ERRORS}\n  Line ${LINE_NUM}: not valid JSON: $(echo "$line" | head -c 80)..."
    continue
  fi

  # 2. Required fields present?
  for field in timestamp from "conflict-type" resource "action-taken"; do
    val=$(echo "$line" | "$JQ" -r --arg f "$field" '.[$f] // empty')
    if [ -z "$val" ]; then
      ERRORS="${ERRORS}\n  Line ${LINE_NUM}: missing required field \"${field}\""
    fi
  done

  # 3. conflict-type enum?
  conflict=$(echo "$line" | "$JQ" -r '."conflict-type" // empty')
  if [ -n "$conflict" ]; then
    valid=false
    for ct in $VALID_CONFLICT_TYPES; do
      [ "$conflict" = "$ct" ] && valid=true && break
    done
    if [ "$valid" = "false" ]; then
      ERRORS="${ERRORS}\n  Line ${LINE_NUM}: conflict-type \"${conflict}\" not in enum (${VALID_CONFLICT_TYPES// /, })"
    fi
  fi

  # 4. action-taken enum?
  action=$(echo "$line" | "$JQ" -r '."action-taken" // empty')
  if [ -n "$action" ]; then
    valid=false
    for at in $VALID_ACTIONS; do
      [ "$action" = "$at" ] && valid=true && break
    done
    if [ "$valid" = "false" ]; then
      ERRORS="${ERRORS}\n  Line ${LINE_NUM}: action-taken \"${action}\" not in enum (${VALID_ACTIONS// /, })"
    fi
  fi

  # 5. from looks role-prefixed?
  from=$(echo "$line" | "$JQ" -r '.from // empty')
  if [ -n "$from" ]; then
    case "$from" in
      phase4-cycle-*-section-*|phase4-prioritise-author*|composer-*|reviewer-*|probe-*) ;;
      *)
        ERRORS="${ERRORS}\n  Line ${LINE_NUM}: from \"${from}\" doesn't match a recognised role prefix"
        ;;
    esac
  fi

  # 6. PIPE_BUF check — atomic-append guarantee requires line ≤ 4096 bytes.
  byte_len=${#line}
  if [ "$byte_len" -gt 4096 ]; then
    ERRORS="${ERRORS}\n  Line ${LINE_NUM}: ${byte_len} bytes exceeds PIPE_BUF (4096) — atomic append no longer guaranteed; emit a stub entry and write long-form details to a spill file"
  fi

done <<< "$NEW_CONTENT"

if [ -n "$ERRORS" ]; then
  emit_deny "[BLOCKED] Concurrency-log entries violate the canonical schema.
$(printf "$ERRORS")

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

Each line must be a single-line JSON object with required fields:

  {\"timestamp\":\"<ISO-8601>\",\"from\":\"<role-prefix>\",\"conflict-type\":\"<enum>\",\"resource\":\"<short-string>\",\"value\":<short|null>,\"details\":\"<one-sentence>\",\"action-taken\":\"<enum>\",\"recommendation\":<one-sentence|null>}

Required:        timestamp, from, conflict-type, resource, action-taken
Optional/null:   value, details, recommendation

conflict-type enum: resource-collision | destructive-side-effect | auth-rate-limit | state-corruption | unexpected-data
action-taken enum:  retry-with-namespace | abort-and-flag | wait-and-retry | coordinate-with-peer

References:
  skills/journey-mapping/SKILL.md §\"Concurrency coordination\"
  skills/element-interactions/references/subagent-return-schema.md §\"Concurrency-log emission rules\""
  exit 0
fi

# All checks pass.
exit 0
