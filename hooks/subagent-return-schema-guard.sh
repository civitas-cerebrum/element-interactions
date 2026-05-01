#!/bin/bash
# subagent-return-schema-guard.sh
#
# PostToolUse hook for the Agent tool. Validates a dispatched subagent's
# return against the canonical schema in
#   skills/element-interactions/references/subagent-return-schema.md
# and emits a non-blocking `systemMessage` warning that names the missing
# field markers so the parent orchestrator re-dispatches with a stricter
# brief instead of feeding malformed returns into downstream state files.
#
# Routing key — the description prefix on the originating Agent dispatch.
# The dispatch-guard hook (issue #126) tightened these to role-explicit
# forms so this validator can map them mechanically:
#
#   Description prefix       →  Validation target
#   -------------------------    ------------------------------------------
#   composer-<j-slug>:           Stage A — `status:` enum + per-status fields
#   reviewer-<j-slug>:           Stage B — `status:` enum + journey/pass/cycle
#                                + (`summary:` on greenlight ‖ findings list
#                                   on improvements-needed)
#   probe-<j-slug>:              Adversarial — `probes:` + `boundaries:`
#                                + `findings:` (count line OR list)
#   process-validator-<scope>:   Sub-orchestrator — reviewer-shape applied
#                                to a manifest (`status:`, `findings:`,
#                                `summary:`)
#   phase1- / stage2- / cleanup- / bare j- / bare sj- → silent allow
#   (phase1/stage2 returns are free-form site-map / page-repository
#    entries; cleanup is unstructured; bare j-/sj- are blocked at dispatch
#    by coverage-expansion-dispatch-guard so they never reach here, but
#    the hook stays silent on them as defense-in-depth.)
#
# Mode: WARN-ONLY (initial release). After a representative run produces
# a ≤2% false-positive rate, a follow-up flips this to a `decision: block`
# emit so malformed returns force re-dispatch instead of polluting state.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESCRIPTION=$(echo "$INPUT" | jq -r '.tool_input.description // ""')

# Route by role prefix. We only validate the four schemas that have a
# defined return shape — phase1/stage2/cleanup are documented as
# "free-form" or "unstructured" and would generate noise if validated.
ROLE=""
case "$DESCRIPTION" in
  composer-*)         ROLE="composer" ;;
  reviewer-*)         ROLE="reviewer" ;;
  probe-*)            ROLE="probe" ;;
  process-validator-*) ROLE="process-validator" ;;
  *)                  exit 0 ;;  # silent allow — no schema for this role
esac

# Extract the subagent's textual return. PostToolUse:Agent payloads have
# carried this in a few slightly different shapes across versions of the
# harness; concatenate everything we can find so the grep-based shape
# checks below are robust to the response format.
#
# 1) tool_response.output — most common; either a string or an array of
#    {type, text} blocks.
# 2) tool_response — when the response is a top-level string.
# 3) tool_response.result — alternate field name on some payloads.
# Fallback: stringify the whole tool_response object so we still see the
# subagent's content regardless of where the harness placed it.
RESPONSE=$(
  echo "$INPUT" | jq -r '
    [
      (.tool_response.output? | if type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
      (.tool_response.result? // empty | tostring),
      (if (.tool_response | type) == "string" then .tool_response else empty end)
    ] | map(select(. != null and . != "")) | unique | join("\n")
  ' 2>/dev/null || echo ""
)

# Fallback: if the targeted extraction yielded nothing, dump tool_response
# whole. Better to grep across noise than to falsely warn on an empty
# response we couldn't parse.
if [ -z "$RESPONSE" ]; then
  RESPONSE=$(echo "$INPUT" | jq -r '
    if (.tool_response // null) == null then ""
    elif (.tool_response | type) == "string" then .tool_response
    else (.tool_response | tostring)
    end
  ' 2>/dev/null || echo "")
fi

# Truly empty / null / "null" response — likely a tool error or aborted
# subagent. Don't generate noise; the harness already surfaces the error.
case "$RESPONSE" in
  ""|"null"|"{}"|"[]") exit 0 ;;
esac

MISSING=()
BANNED=()

check_marker() {
  # check_marker <regex> <human-readable-name>
  if ! echo "$RESPONSE" | grep -qE "$1"; then
    MISSING+=("$2")
  fi
}

check_banned() {
  # check_banned <regex> <human-readable-name>
  if echo "$RESPONSE" | grep -qE "$1"; then
    BANNED+=("$2")
  fi
}

# === Composer schema (Stage A) ============================================
if [ "$ROLE" = "composer" ]; then
  # Top-level status enum.
  if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*(new-tests-landed|covered-exhaustively|blocked|skipped)'; then
    MISSING+=('status: <new-tests-landed|covered-exhaustively|blocked|skipped>')
  fi

  # Status-specific evidence — only check when the matching status appears.
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*new-tests-landed'; then
    check_marker '(^|\n)[[:space:]]*tests-added:'   'tests-added: <count>  (required when status=new-tests-landed)'
    check_marker '(^|\n)[[:space:]]*run-time:'      'run-time: <duration>  (required when status=new-tests-landed)'
  fi
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*covered-exhaustively'; then
    check_marker '\| *Expectation *\| *Covering spec *\| *Test name *\|' 'per-expectation mapping table header  (required when status=covered-exhaustively)'
  fi
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*blocked'; then
    check_marker '(^|\n)[[:space:]]*reason:'        'reason: <text>  (required when status=blocked)'
  fi
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*skipped'; then
    check_marker '(^|\n)[[:space:]]*reason:'        'reason: <text>  (required when status=skipped)'
    check_marker '(^|\n)[[:space:]]*authorizer:'    'authorizer: <user|null>  (required when status=skipped)'
  fi

  # Banned tokens from §4.1 (legacy / forked status vocabulary).
  check_banned '(^|[^a-z-])no-new-tests-by-rationalisation([^a-z-]|$)'         'no-new-tests-by-rationalisation (banned status — re-dispatch with stricter brief)'
  check_banned '(^|\n)[[:space:]]*status:[[:space:]]*no-new-tests([[:space:]]|$)' 'status: no-new-tests (legacy — use covered-exhaustively + mapping table)'
fi

# === Reviewer schema (Stage B, per §2.4) ==================================
if [ "$ROLE" = "reviewer" ]; then
  # Top-level status enum.
  if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*(greenlight|improvements-needed)'; then
    MISSING+=('status: <greenlight|improvements-needed>')
  fi
  check_marker '(^|\n)[[:space:]]*journey:'  'journey: j-<slug>'
  check_marker '(^|\n)[[:space:]]*pass:'     'pass: <N>'
  check_marker '(^|\n)[[:space:]]*cycle:'    'cycle: <cycle-number>'

  # Greenlight requires summary; improvements-needed requires at least one
  # findings sub-list header.
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*greenlight'; then
    check_marker '(^|\n)[[:space:]]*summary:' 'summary: <one sentence>  (REQUIRED on greenlight per §4.1)'
  fi
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*improvements-needed'; then
    if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*(missing-scenarios|craft-issues|verification-misses):'; then
      MISSING+=('at least one of: missing-scenarios: / craft-issues: / verification-misses:  (required when status=improvements-needed)')
    fi
  fi

  # Banned tokens from §4.1 (prior schema revision).
  check_banned '(^|[^a-z-])nice-to-have([^a-z-]|$)'             'nice-to-have (banned — reviewer findings carry [must-fix] only)'
  check_banned '(^|[^a-z-])greenlight-with-notes([^a-z-]|$)'    'greenlight-with-notes (banned — there is no third return state)'
  check_banned '(^|\n)[[:space:]]*notes:'                       'notes: sub-list (banned — observations are either must-fix or unrecorded)'
fi

# === Probe schema (passes 4/5 + bug-discovery) ============================
if [ "$ROLE" = "probe" ]; then
  check_marker '(^|\n)[[:space:]]*probes:'      'probes: <count>'
  check_marker '(^|\n)[[:space:]]*boundaries:'  'boundaries: <count>'
  check_marker '(^|\n)[[:space:]]*findings:'    'findings: <array or count>'

  # Banned legacy finding-ID prefixes — these were superseded by the
  # `<journey-slug>-<pass>-<nn>` form per §1.
  check_banned '(^|[^a-zA-Z0-9])AF-[0-9]+'       'AF-NN finding-ID (banned — use <journey-slug>-<pass>-<nn>)'
  check_banned '(^|[^a-zA-Z0-9])P4-[A-Z]+-BUG-[0-9]+' 'P4-XX-BUG-NN finding-ID (banned — use <journey-slug>-<pass>-<nn>)'
  check_banned '(^|[^a-zA-Z0-9])REG-[0-9]+'      'REG-NN finding-ID (banned — use <journey-slug>-<pass>-<nn>)'
fi

# === Process-validator schema (mirrors reviewer one level up) =============
if [ "$ROLE" = "process-validator" ]; then
  if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*(greenlight|improvements-needed)'; then
    MISSING+=('status: <greenlight|improvements-needed>')
  fi
  check_marker '(^|\n)[[:space:]]*findings:' 'findings: <array, may be empty>'
  check_marker '(^|\n)[[:space:]]*summary:'  'summary: <one sentence>'
fi

# Nothing missing or banned — silent allow.
if [ ${#MISSING[@]} -eq 0 ] && [ ${#BANNED[@]} -eq 0 ]; then
  exit 0
fi

# Build a single-paragraph systemMessage. We deliberately do NOT block
# (warn-mode initial release). The orchestrator sees the warning and is
# expected to re-dispatch — and the next ratchet ships block-mode.
WARNING="[WARN] Subagent return missing canonical schema fields.

Description: \"${DESCRIPTION}\"
Role:        ${ROLE}
"

if [ ${#MISSING[@]} -gt 0 ]; then
  WARNING="${WARNING}
Missing required fields:"
  for item in "${MISSING[@]}"; do
    WARNING="${WARNING}
  - ${item}"
  done
fi

if [ ${#BANNED[@]} -gt 0 ]; then
  WARNING="${WARNING}

Banned / forked tokens present:"
  for item in "${BANNED[@]}"; do
    WARNING="${WARNING}
  - ${item}"
  done
fi

WARNING="${WARNING}

The canonical return schema is documented in:
  skills/element-interactions/references/subagent-return-schema.md
    §1   — finding-return shape
    §2   — return states (covered-exhaustively / no-new-tests-by-rationalisation)
    §2.4 — reviewer (Stage B) return shape
    §3   — adversarial-findings ledger schema
    §4.1 — minimal grep-based conformance check (this hook's source of truth)

Re-dispatch the subagent with a brief that quotes the missing markers verbatim and re-grep the return on its way back. This warning is non-blocking; a follow-up release will promote it to BLOCK once the false-positive rate is calibrated."

jq -n --arg m "$WARNING" '{
  "systemMessage": $m,
  "suppressOutput": false
}'

exit 0
