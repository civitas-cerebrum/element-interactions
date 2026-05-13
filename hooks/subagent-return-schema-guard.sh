#!/bin/bash
# subagent-return-schema-guard.sh — JSON-Schema validator for subagent returns +
#                                    handover-envelope leash driver
#
# Hook    : PostToolUse:Agent
# Mode    : WARN (initial release; will flip to DENY in a follow-up after
#           false-positive rate is calibrated on a representative run)
# State   : reads + writes tests/e2e/docs/.in-flight-composers.json
#           (deregisters composer/probe slugs on terminal handover)
# Env     : none
#
# Rule
# ----
# Validates subagent returns against JSON-Schema definitions in
# schemas/subagent-returns/<role>.schema.json using Ajv 8 (draft 2020-12).
# This replaces the previous grep-based prose-regex checks with a single
# source of truth: the schema file is both the spec and the validator.
#
# Schema coverage:
#   composer-<slug>       → schemas/subagent-returns/composer.schema.json
#   reviewer-<slug>       → schemas/subagent-returns/reviewer-inloop.schema.json
#   probe-<slug>          → schemas/subagent-returns/probe.schema.json
#   phase-validator-<N>   → schemas/subagent-returns/phase-validator.schema.json
#
# No-schema roles (silent allow on schema step):
#   process-validator-*, phase1-*, stage2-*, cleanup-*, bare j-/sj-
#
# The handover envelope is validated as part of the schema (handover is a
# required nested key in every role schema). Registry leash (cycle-match +
# deregister) continues to run independently of schema validation.
#
# Canonical reference
# -------------------
# schemas/subagent-returns/*.schema.json  — single source of truth
# skills/element-interactions/references/subagent-return-schema.md §4.2
#
# Failure → action
# ----------------
# Schema validation failure → WARN (systemMessage with Ajv error details)
# Handover envelope issues  → WARN (same channel)

set -euo pipefail

# Resolve jq.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH." >&2
  exit 1
fi

# Resolve node (must be on PATH for the Ajv helper).
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: node not found on PATH. Install Node.js." >&2
  exit 1
fi

# Shared no-skip messaging library.
# shellcheck source=lib/no-skip-messaging.sh
HOOK_LIB_DIR="$(dirname "${BASH_SOURCE[0]}")/lib"
if [ -f "$HOOK_LIB_DIR/no-skip-messaging.sh" ]; then
  source "$HOOK_LIB_DIR/no-skip-messaging.sh"
else
  no_skip_messaging_block() { echo ""; }
fi

# Path to the Ajv Node helper (co-located in lib/).
VALIDATE_HELPER="$HOOK_LIB_DIR/validate-against-schema.mjs"

# Repo root: used to locate the schemas dir from wherever the hook fires.
HOOK_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && git rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "${BASH_SOURCE[0]}")")"

emit_warn() {
  local msg="$1
$(no_skip_messaging_block)"
  "$JQ" -n --arg m "$msg" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""')

# Map description prefix to schema role name.
# Roles without a schema get silent allow (no schema = no structural contract).
SCHEMA_ROLE=""
case "$DESCRIPTION" in
  composer-*)         SCHEMA_ROLE="composer" ;;
  reviewer-*)         SCHEMA_ROLE="reviewer-inloop" ;;
  probe-*)            SCHEMA_ROLE="probe" ;;
  phase-validator-*)  SCHEMA_ROLE="phase-validator" ;;
  process-validator-*) SCHEMA_ROLE="" ;;  # no schema yet; handled by separate lint below
  *)                  exit 0 ;;  # silent allow — unknown/free-form role
esac

# Extract the subagent's textual return.
# PostToolUse:Agent payloads carry the return in a few shapes.
RESPONSE=$(
  echo "$INPUT" | "$JQ" -r '
    [
      (.tool_response.output? | if type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
      (.tool_response.result? // empty | tostring),
      (if (.tool_response | type) == "string" then .tool_response else empty end)
    ] | map(select(. != null and . != "")) | unique | join("\n")
  ' 2>/dev/null || echo ""
)

if [ -z "$RESPONSE" ]; then
  RESPONSE=$(echo "$INPUT" | "$JQ" -r '
    if (.tool_response // null) == null then ""
    elif (.tool_response | type) == "string" then .tool_response
    else (.tool_response | tostring)
    end
  ' 2>/dev/null || echo "")
fi

case "$RESPONSE" in
  ""|"null"|"{}"|"[]") exit 0 ;;
esac

# === Handover envelope parse (for registry leash) =========================
# Extract handover fields for cycle-match + deregister logic.
# The handover block is YAML-indented under a top-level `handover:` line.
HANDOVER_PRESENT="false"
HANDOVER_ROLE=""
HANDOVER_CYCLE=""
HANDOVER_STATUS=""
HANDOVER_NEXT=""
HANDOVER_WARNS=()

if echo "$RESPONSE" | grep -qE '(^|\n)handover:[[:space:]]*$'; then
  HANDOVER_PRESENT="true"
  HANDOVER_BLOCK=$(echo "$RESPONSE" | awk '
    /^handover:[[:space:]]*$/ { in_block = 1; next }
    in_block {
      if (/^[[:space:]]+/ || /^$/) { print; next }
      exit
    }
  ' || true)
  HANDOVER_ROLE=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+role:' | head -1 | sed -E 's/^[[:space:]]+role:[[:space:]]*//' | tr -d '[:space:]' || true)
  HANDOVER_CYCLE=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+cycle:' | head -1 | sed -E 's/^[[:space:]]+cycle:[[:space:]]*//' | tr -d '[:space:]' || true)
  HANDOVER_STATUS=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+status:' | head -1 | sed -E 's/^[[:space:]]+status:[[:space:]]*//' | tr -d '[:space:]' || true)
  HANDOVER_NEXT=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+next-action:' | head -1 | sed -E 's/^[[:space:]]+next-action:[[:space:]]*//' || true)
fi

# Numeric cycle sanity.
if [ -n "$HANDOVER_CYCLE" ] && ! echo "$HANDOVER_CYCLE" | grep -qE '^[0-9]+$'; then
  HANDOVER_WARNS+=("handover: cycle: '${HANDOVER_CYCLE}' is not a non-negative integer (§2.0)")
  HANDOVER_CYCLE=""
fi

# === Registry leash: cycle-match + deregister =============================
if [ "$HANDOVER_PRESENT" = "true" ] && [ -n "$HANDOVER_ROLE" ] && [ -n "$HANDOVER_CYCLE" ] && [ -n "$HANDOVER_STATUS" ]; then
  HANDOVER_SLUG=""
  case "$HANDOVER_ROLE" in
    composer-j-*|composer-sj-*) HANDOVER_SLUG=$(echo "$HANDOVER_ROLE" | sed -E 's/^composer-((j|sj)-[a-z0-9-]+).*/\1/') ;;
    probe-j-*|probe-sj-*)       HANDOVER_SLUG=$(echo "$HANDOVER_ROLE" | sed -E 's/^probe-((j|sj)-[a-z0-9-]+).*/\1/') ;;
  esac

  if [ -n "$HANDOVER_SLUG" ] && echo "$HANDOVER_SLUG" | grep -qE '^(j|sj)-[a-z0-9-]+$'; then
    GUARD_CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
    GUARD_REPO_ROOT=$(git -C "$GUARD_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$GUARD_CWD")
    GUARD_IN_FLIGHT="$GUARD_REPO_ROOT/tests/e2e/docs/.in-flight-composers.json"

    if [ -f "$GUARD_IN_FLIGHT" ]; then
      REG_CYCLE=$("$JQ" -r --arg s "$HANDOVER_SLUG" '.composers[$s].cycle // empty' "$GUARD_IN_FLIGHT" 2>/dev/null || echo "")

      if [ -n "$REG_CYCLE" ]; then
        if [ "$HANDOVER_CYCLE" != "$REG_CYCLE" ]; then
          HANDOVER_WARNS+=("handover: cycle-mismatch refusal — envelope claims cycle: ${HANDOVER_CYCLE} but registry has cycle: ${REG_CYCLE} for slug ${HANDOVER_SLUG}. Slot NOT deregistered (TTL will eventually GC). Fix: either redispatch under cycle ${REG_CYCLE} or correct the envelope's cycle to match the registered dispatch (§2.0 cycle-mismatch contract).")
        else
          IS_TERMINAL="false"
          case "$HANDOVER_ROLE" in
            composer-*)
              case "$HANDOVER_STATUS" in
                new-tests-landed|covered-exhaustively|blocked|skipped) IS_TERMINAL="true" ;;
              esac ;;
            probe-*)
              case "$HANDOVER_STATUS" in
                clean|findings-emitted|blocked) IS_TERMINAL="true" ;;
              esac ;;
          esac

          if [ "$IS_TERMINAL" = "true" ]; then
            UPDATED=$("$JQ" --arg s "$HANDOVER_SLUG" 'del(.composers[$s])' "$GUARD_IN_FLIGHT" 2>/dev/null || echo "")
            if [ -n "$UPDATED" ]; then
              echo "$UPDATED" > "$GUARD_IN_FLIGHT.tmp" 2>/dev/null && mv "$GUARD_IN_FLIGHT.tmp" "$GUARD_IN_FLIGHT" || rm -f "$GUARD_IN_FLIGHT.tmp"
            fi
          fi
        fi
      fi
    fi
  fi
fi

# === JSON-Schema validation via Ajv =======================================
# Only run for roles that have a schema. process-validator has no schema
# at this version — it falls through to the handover-only warn path below.
SCHEMA_ERRORS=""
if [ -n "$SCHEMA_ROLE" ]; then
  # Write RESPONSE to a temp file for the Node helper.
  TMPFILE=$(mktemp /tmp/subagent-schema-guard-XXXXXX.yaml)
  trap 'rm -f "$TMPFILE"' EXIT
  printf '%s' "$RESPONSE" > "$TMPFILE"

  # Invoke the Ajv helper. Run with the repo root as cwd so relative schema
  # $ref paths resolve correctly.
  SCHEMA_ERRORS=$(cd "$HOOK_REPO_ROOT" && "$NODE" "$VALIDATE_HELPER" "$SCHEMA_ROLE" "$TMPFILE" 2>&1) || true
fi

# === Emit warning if any issues found =====================================
if [ ${#HANDOVER_WARNS[@]} -eq 0 ] && [ -z "$SCHEMA_ERRORS" ]; then
  exit 0
fi

WARNING="[WARN] Subagent return validation surfaced issues.

Description: \"${DESCRIPTION}\"
Role:        ${SCHEMA_ROLE:-${DESCRIPTION%%[-:]*}}"

if [ -n "$SCHEMA_ERRORS" ]; then
  WARNING="${WARNING}

Schema validation errors (schemas/subagent-returns/${SCHEMA_ROLE}.schema.json):
${SCHEMA_ERRORS}"
fi

if [ ${#HANDOVER_WARNS[@]} -gt 0 ]; then
  WARNING="${WARNING}

Handover envelope (§2.0):"
  for item in "${HANDOVER_WARNS[@]}"; do
    WARNING="${WARNING}
  - ${item}"
  done
fi

WARNING="${WARNING}

The canonical return schemas are at:
  schemas/subagent-returns/<role>.schema.json

Re-dispatch the subagent with a brief that quotes the schema constraints
verbatim. This warning is non-blocking; a follow-up release will promote
it to BLOCK once the false-positive rate is calibrated."

emit_warn "$WARNING"

exit 0
