#!/bin/bash
# subagent-return-schema-guard.sh — canonical-return-shape validator +
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
# Two responsibilities, run independently:
#
# 1. Validate the canonical return schema (§4.1 / §4.2) — composer / reviewer
#    / probe / process-validator / phase-validator returns are grep-checked
#    for required markers and banned tokens.
# 2. Drive the in-flight registry leash via the §2.0 handover envelope —
#    parse `handover.role / cycle / status / next-action` from the return,
#    cycle-match against the registry entry, deregister composer + probe
#    slugs on terminal status. The TTL on registry entries (30 min) is a
#    failsafe for crashed dispatches; explicit deregistration via the
#    handover envelope is the primary cleanup path.
#
# Routing by description prefix:
#
#   Description prefix       →  Validation target
#   -------------------------    ------------------------------------------
#   composer-<j-slug>:           Stage A — `status:` enum (new-tests-landed |
#                                covered-exhaustively | blocked | skipped) +
#                                per-status fields (tests-added / run-time;
#                                mapping table; reason; reason+authorizer)
#   reviewer-<j-slug>:           Stage B (§2.4) — `status:` (greenlight |
#                                improvements-needed) + journey/pass/cycle +
#                                summary on greenlight | findings sub-list
#                                on improvements-needed
#   probe-<j-slug>:              Adversarial — `probes:` + `boundaries:` +
#                                `findings:` count or list
#   process-validator-<scope>:   Sub-orchestrator — reviewer-shape applied
#                                to a manifest (`status:`, `findings:`, `summary:`)
#   phase-validator-<N>:         Phase-exit checkpoint (§2.5) — `status:` +
#                                `phase:` + `exit-criteria-checked:` array +
#                                `summary:` (REQUIRED on both statuses) +
#                                `findings: []` literal on greenlight |
#                                ≥1 `pv-<phase>-<nn>` must-fix on
#                                improvements-needed
#   phase1- / stage2- / cleanup- / bare j- / bare sj- → silent allow
#   (phase1/stage2 returns are free-form site-map / page-repository entries;
#    cleanup is unstructured; bare j-/sj- are blocked upstream by
#    coverage-expansion-dispatch-guard so they never reach here, but the
#    hook stays silent on them as defense-in-depth.)
#
# Why
# ---
# A subagent that returns a beautifully-prosed paragraph + 80% of the schema
# fields lets the orchestrator's grep-based validation pass-through (the
# orchestrator hand-waves missing parts). State-file updates with degraded
# data, three passes later state is corrupt, resume-from-state breaks. The
# validator catches malformed returns at the harness boundary before
# pollution propagates.
#
# Canonical reference
# -------------------
# skills/element-interactions/references/subagent-return-schema.md §1, §2,
#   §2.0 (handover envelope), §2.4, §3, §4.1 (grep-based conformance check),
#   §4.2 (schema-validation half of this hook), §4.3 (handover-envelope
#   leash + deregistration half of this hook)
#
# Failure → action
# ----------------
# Schema validation:
# - Composer return missing required field for its status enum  → WARN
# - Reviewer greenlight without `summary:`                      → WARN
# - Reviewer improvements-needed without findings sub-list      → WARN
# - Probe return missing probes/boundaries/findings             → WARN
# - Process-validator missing status/findings/summary           → WARN
# - Banned tokens (`no-new-tests-by-rationalisation`, `nice-to-have`,
#   `greenlight-with-notes`, top-level `notes:`, legacy AF-/P4-/REG- IDs) → WARN
#
# Handover envelope (§2.0):
# - Envelope missing entirely                                   → WARN
# - Envelope present but missing role/cycle/status/next-action  → WARN
# - Cycle-mismatch against registry (composer/probe slugs only) → WARN +
#                                                                 NO deregister
# - Composer terminal status, cycle matches                     → deregister
# - Probe terminal status, cycle matches                        → deregister
# - Reviewer / process-validator / phase-validator handover     → envelope
#                                                                 validation
#                                                                 only; no
#                                                                 registry
#                                                                 effect (those
#                                                                 roles are
#                                                                 not in the
#                                                                 registry)
# - Slug not registered (already deregistered, or never)        → silent
#                                                                 (registry
#                                                                 can't
#                                                                 deregister
#                                                                 what isn't
#                                                                 there)
#
# Other:
# - phase1- / stage2- / cleanup- / bare j-/sj- prefix           → silent allow
# - Empty / null tool_response                                  → silent allow
# - Anything else                                               → silent allow
#
# Deregistration runs in WARN mode AND in any future BLOCK mode — the registry
# update is mechanical bookkeeping, not validation, so the leash works even
# before BLOCK promotion.

set -euo pipefail

# --- helpers ---
emit_warn() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}

# --- input ---
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
  phase-validator-*)  ROLE="phase-validator" ;;
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

# === Handover envelope parse (§2.0) =======================================
# Extract `handover:` block — the lines indented under a top-level
# `handover:` line. The envelope's `status:` is intentionally distinct from
# the role-specific schema's `status:` (which appears at the top level of
# the body). Block-scoped extraction prevents the role-specific status from
# being read as the envelope's.
HANDOVER_PRESENT="false"
HANDOVER_ROLE=""
HANDOVER_CYCLE=""
HANDOVER_STATUS=""
HANDOVER_NEXT=""
HANDOVER_WARNS=()

if echo "$RESPONSE" | grep -qE '(^|\n)handover:[[:space:]]*$'; then
  HANDOVER_PRESENT="true"
  # awk extracts indented lines (and blank lines) following `handover:` until
  # the next non-indented line. Whitespace-tolerant. `|| true` guards against
  # set -e + pipefail when input is empty / awk produces nothing.
  HANDOVER_BLOCK=$(echo "$RESPONSE" | awk '
    /^handover:[[:space:]]*$/ { in_block = 1; next }
    in_block {
      if (/^[[:space:]]+/ || /^$/) { print; next }
      exit
    }
  ' || true)
  # Each grep below may find nothing (malformed envelope path). With set -e +
  # pipefail, an unmatched grep would abort the script; `|| true` keeps the
  # extraction robust so we can WARN on missing fields instead of crashing.
  HANDOVER_ROLE=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+role:' | head -1 | sed -E 's/^[[:space:]]+role:[[:space:]]*//' | tr -d '[:space:]' || true)
  HANDOVER_CYCLE=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+cycle:' | head -1 | sed -E 's/^[[:space:]]+cycle:[[:space:]]*//' | tr -d '[:space:]' || true)
  HANDOVER_STATUS=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+status:' | head -1 | sed -E 's/^[[:space:]]+status:[[:space:]]*//' | tr -d '[:space:]' || true)
  HANDOVER_NEXT=$(echo "$HANDOVER_BLOCK" | grep -E '^[[:space:]]+next-action:' | head -1 | sed -E 's/^[[:space:]]+next-action:[[:space:]]*//' || true)
fi

# Validate envelope shape. Missing entirely → WARN. Present but missing one
# of the four required fields → WARN listing the missing fields.
if [ "$HANDOVER_PRESENT" != "true" ]; then
  HANDOVER_WARNS+=('handover: envelope missing entirely (§2.0 — every composer/reviewer/probe/process-validator/phase-validator return MUST be prefaced with the envelope: role / cycle / status / next-action)')
else
  ENV_MISSING=()
  [ -z "$HANDOVER_ROLE" ]   && ENV_MISSING+=("role:")
  [ -z "$HANDOVER_CYCLE" ]  && ENV_MISSING+=("cycle:")
  [ -z "$HANDOVER_STATUS" ] && ENV_MISSING+=("status:")
  [ -z "$HANDOVER_NEXT" ]   && ENV_MISSING+=("next-action:")
  if [ ${#ENV_MISSING[@]} -gt 0 ]; then
    HANDOVER_WARNS+=("handover: envelope present but malformed — missing field(s): $(IFS=,; echo "${ENV_MISSING[*]}") (§2.0)")
  fi
  # Numeric cycle sanity check.
  if [ -n "$HANDOVER_CYCLE" ] && ! echo "$HANDOVER_CYCLE" | grep -qE '^[0-9]+$'; then
    HANDOVER_WARNS+=("handover: cycle: '${HANDOVER_CYCLE}' is not a non-negative integer (§2.0)")
    HANDOVER_CYCLE=""   # invalidate so we don't compare a non-integer below
  fi
fi

# === Registry leash: cycle-match + deregister =============================
# Composer + probe roles only — those are the role types the dispatch-guard
# (coverage-expansion-dispatch-guard.sh) registers in
# `tests/e2e/docs/.in-flight-composers.json`. Reviewer / process-validator /
# phase-validator handovers carry the envelope (and may carry a status that
# is "terminal" in the directive's per-role table) but have no registry slot
# to deregister; their envelope is informational at the harness layer and
# drives the orchestrator's next-action only.
if [ "$HANDOVER_PRESENT" = "true" ] && [ -n "$HANDOVER_ROLE" ] && [ -n "$HANDOVER_CYCLE" ] && [ -n "$HANDOVER_STATUS" ]; then
  HANDOVER_SLUG=""
  case "$HANDOVER_ROLE" in
    composer-j-*|composer-sj-*) HANDOVER_SLUG=$(echo "$HANDOVER_ROLE" | sed -E 's/^composer-((j|sj)-[a-z0-9-]+).*/\1/') ;;
    probe-j-*|probe-sj-*)       HANDOVER_SLUG=$(echo "$HANDOVER_ROLE" | sed -E 's/^probe-((j|sj)-[a-z0-9-]+).*/\1/') ;;
  esac

  if [ -n "$HANDOVER_SLUG" ] && echo "$HANDOVER_SLUG" | grep -qE '^(j|sj)-[a-z0-9-]+$'; then
    GUARD_CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
    GUARD_REPO_ROOT=$(git -C "$GUARD_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$GUARD_CWD")
    GUARD_IN_FLIGHT="$GUARD_REPO_ROOT/tests/e2e/docs/.in-flight-composers.json"

    if [ -f "$GUARD_IN_FLIGHT" ]; then
      REG_CYCLE=$(jq -r --arg s "$HANDOVER_SLUG" '.composers[$s].cycle // empty' "$GUARD_IN_FLIGHT" 2>/dev/null || echo "")

      if [ -n "$REG_CYCLE" ]; then
        if [ "$HANDOVER_CYCLE" != "$REG_CYCLE" ]; then
          # Cycle mismatch → refuse to deregister + fix-message.
          HANDOVER_WARNS+=("handover: cycle-mismatch refusal — envelope claims cycle: ${HANDOVER_CYCLE} but registry has cycle: ${REG_CYCLE} for slug ${HANDOVER_SLUG}. Slot NOT deregistered (TTL will eventually GC). Fix: either redispatch under cycle ${REG_CYCLE} or correct the envelope's cycle to match the registered dispatch (§2.0 cycle-mismatch contract).")
        else
          # Cycle matches → check terminal status.
          IS_TERMINAL="false"
          case "$HANDOVER_ROLE" in
            composer-*)
              case "$HANDOVER_STATUS" in
                new-tests-landed|covered-exhaustively|blocked|skipped) IS_TERMINAL="true" ;;
              esac
              ;;
            probe-*)
              case "$HANDOVER_STATUS" in
                clean|findings-emitted|blocked) IS_TERMINAL="true" ;;
              esac
              ;;
          esac

          if [ "$IS_TERMINAL" = "true" ]; then
            # Deregister: remove the slug. Atomic write via .tmp + mv.
            UPDATED=$(jq --arg s "$HANDOVER_SLUG" 'del(.composers[$s])' "$GUARD_IN_FLIGHT" 2>/dev/null || echo "")
            if [ -n "$UPDATED" ]; then
              echo "$UPDATED" > "$GUARD_IN_FLIGHT.tmp" 2>/dev/null && mv "$GUARD_IN_FLIGHT.tmp" "$GUARD_IN_FLIGHT" || rm -f "$GUARD_IN_FLIGHT.tmp"
            fi
          fi
          # Non-terminal status: leave the slot in place. Redispatch under
          # the same slug (cycle ≥ 2) refreshes via the dispatch-guard.
        fi
      fi
      # Slug not in registry: silent fall-through. Already deregistered or
      # never registered (e.g., dispatch-guard didn't run).
    fi
  fi
fi

# === Strip handover block before role-specific schema checks ==============
# The envelope's indented `status:` would otherwise be matched by the body
# schema's `status:` regex (the indentation tolerance was added for legacy
# returns that used minor leading whitespace). Reassign RESPONSE to its body
# without the handover envelope so the existing grep-based checks below
# inspect body fields only.
RESPONSE=$(echo "$RESPONSE" | awk '
  /^handover:[[:space:]]*$/ { in_block = 1; next }
  in_block {
    if (/^[[:space:]]+/ || /^$/) { next }
    in_block = 0
  }
  { print }
' || true)

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
    # Relaxed per §2.6: either inline mapping table (legacy) OR a `spill:`
    # pointer (post-spillover) satisfies the schema. The spillover-specific
    # WARN below fires when the spill file is absent.
    HAS_INLINE_TABLE=false
    HAS_SPILL_PTR=false
    if echo "$RESPONSE" | grep -qE '\| *Expectation *\| *Covering spec *\| *Test name *\|'; then
      HAS_INLINE_TABLE=true
    fi
    if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*spill:[[:space:]]*tests/e2e/docs/.subagent-returns/composer-'; then
      HAS_SPILL_PTR=true
    fi
    if [ "$HAS_INLINE_TABLE" = false ] && [ "$HAS_SPILL_PTR" = false ]; then
      MISSING+=('per-expectation mapping table inline (legacy) OR spill: pointer to tests/e2e/docs/.subagent-returns/composer-<journey>-<pass>-c<cycle>.md (post-spillover, §2.6)  (required when status=covered-exhaustively)')
    fi
  fi

  # === Spillover audit-trail (§2.6) — composer covered-exhaustively =====
  # Defense-in-depth WARN. The SubagentStop rewrite-gate should have
  # prevented absent spill; this WARN catches mis-installed-hook /
  # cap-reached cases.
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*covered-exhaustively'; then
    SPILL_J=$(echo "$RESPONSE" | grep -E '^[[:space:]]*journey:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*journey:[[:space:]]*//' | tr -d '[:space:]' || true)
    SPILL_P=$(echo "$RESPONSE" | grep -E '^[[:space:]]*pass:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*pass:[[:space:]]*//' | tr -d '[:space:]' || true)
    SPILL_C=$(echo "$RESPONSE" | grep -E '^[[:space:]]*cycle:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*cycle:[[:space:]]*//' | tr -d '[:space:]' || true)
    if [ -n "$SPILL_J" ] && [ -n "$SPILL_P" ] && [ -n "$SPILL_C" ]; then
      SPILL_CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
      SPILL_REPO_ROOT=$(git -C "$SPILL_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$SPILL_CWD")
      SPILL_PATH="$SPILL_REPO_ROOT/tests/e2e/docs/.subagent-returns/composer-${SPILL_J}-${SPILL_P}-c${SPILL_C}.md"
      if [ ! -f "$SPILL_PATH" ]; then
        HANDOVER_WARNS+=("spillover (§2.6): expected composer spill file not found at tests/e2e/docs/.subagent-returns/composer-${SPILL_J}-${SPILL_P}-c${SPILL_C}.md. The SubagentStop rewrite-gate should have prevented this; PostToolUse audit fires this WARN as defense-in-depth — check that hooks/subagent-spillover-rewrite-gate.sh is installed and the cap was not reached.")
      fi
    fi
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

  # Greenlight requires summary; improvements-needed requires either an
  # inline findings sub-list (legacy / pre-spillover shape) OR a findings:
  # list with finding-IDs (post-spillover shape per §2.6). Either form
  # satisfies the schema; the spillover-specific check below WARNs about
  # the absent spill file when the shape is post-spillover.
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*greenlight'; then
    check_marker '(^|\n)[[:space:]]*summary:' 'summary: <one sentence>  (REQUIRED on greenlight per §4.1)'
  fi
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*improvements-needed'; then
    HAS_INLINE_SUBLIST=false
    HAS_FINDINGS_LIST=false
    if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*(missing-scenarios|craft-issues|verification-misses):'; then
      HAS_INLINE_SUBLIST=true
    fi
    if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*findings:[[:space:]]*$'; then
      HAS_FINDINGS_LIST=true
    fi
    if [ "$HAS_INLINE_SUBLIST" = false ] && [ "$HAS_FINDINGS_LIST" = false ]; then
      MISSING+=('at least one of: findings: <ID-list> (post-spillover, §2.6) or missing-scenarios: / craft-issues: / verification-misses: (legacy inline form)  (required when status=improvements-needed)')
    fi
  fi

  # === Spillover audit-trail (§2.6) — reviewer improvements-needed =====
  # Defense-in-depth WARN. The SubagentStop rewrite-gate
  # (hooks/subagent-spillover-rewrite-gate.sh) is the primary enforcer
  # and prevents the body from reaching the orchestrator. This WARN
  # catches mis-installed-hook / cap-reached cases.
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*improvements-needed'; then
    SPILL_JOURNEY=$(echo "$RESPONSE" | grep -E '^[[:space:]]*journey:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*journey:[[:space:]]*//' | tr -d '[:space:]' || true)
    SPILL_PASS=$(echo "$RESPONSE" | grep -E '^[[:space:]]*pass:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*pass:[[:space:]]*//' | tr -d '[:space:]' || true)
    SPILL_CYCLE=$(echo "$RESPONSE" | grep -E '^[[:space:]]*cycle:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*cycle:[[:space:]]*//' | tr -d '[:space:]' || true)

    if [ -n "$SPILL_JOURNEY" ] && [ -n "$SPILL_PASS" ] && [ -n "$SPILL_CYCLE" ]; then
      SPILL_CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
      SPILL_REPO_ROOT=$(git -C "$SPILL_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$SPILL_CWD")
      SPILL_PATH="$SPILL_REPO_ROOT/tests/e2e/docs/.subagent-returns/reviewer-${SPILL_JOURNEY}-${SPILL_PASS}-c${SPILL_CYCLE}.md"

      if [ ! -f "$SPILL_PATH" ]; then
        HANDOVER_WARNS+=("spillover (§2.6): expected reviewer spill file not found at tests/e2e/docs/.subagent-returns/reviewer-${SPILL_JOURNEY}-${SPILL_PASS}-c${SPILL_CYCLE}.md. The SubagentStop rewrite-gate should have prevented this; PostToolUse audit fires this WARN as defense-in-depth — check that hooks/subagent-spillover-rewrite-gate.sh is installed and the cap was not reached.")
      fi
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

  # === Spillover audit-trail (§2.6) — probe findings-emitted ============
  if [ "$HANDOVER_STATUS" = "findings-emitted" ]; then
    SPILL_J=$(echo "$RESPONSE" | grep -E '^[[:space:]]*journey:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*journey:[[:space:]]*//' | tr -d '[:space:]' || true)
    SPILL_P=$(echo "$RESPONSE" | grep -E '^[[:space:]]*pass:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*pass:[[:space:]]*//' | tr -d '[:space:]' || true)
    SPILL_C=$(echo "$RESPONSE" | grep -E '^[[:space:]]*cycle:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*cycle:[[:space:]]*//' | tr -d '[:space:]' || true)
    if [ -n "$SPILL_J" ] && [ -n "$SPILL_P" ] && [ -n "$SPILL_C" ]; then
      SPILL_CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
      SPILL_REPO_ROOT=$(git -C "$SPILL_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$SPILL_CWD")
      SPILL_PATH="$SPILL_REPO_ROOT/tests/e2e/docs/.subagent-returns/probe-${SPILL_J}-${SPILL_P}-c${SPILL_C}.md"
      if [ ! -f "$SPILL_PATH" ]; then
        HANDOVER_WARNS+=("spillover (§2.6): expected probe spill file not found at tests/e2e/docs/.subagent-returns/probe-${SPILL_J}-${SPILL_P}-c${SPILL_C}.md. The SubagentStop rewrite-gate should have prevented this; PostToolUse audit fires this WARN as defense-in-depth — check that hooks/subagent-spillover-rewrite-gate.sh is installed and the cap was not reached.")
      fi
    fi
  fi
fi

# === Process-validator schema (mirrors reviewer one level up) =============
if [ "$ROLE" = "process-validator" ]; then
  # The §2.0 envelope's status enum for process-validator is greenlight | block.
  # The body status was historically greenlight | improvements-needed (pre-§2.0).
  # Accept either to remain backwards-compatible with legacy returns.
  if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*(greenlight|improvements-needed|block)'; then
    MISSING+=('status: <greenlight|block> (§2.0) or <greenlight|improvements-needed> (legacy body)')
  fi
  check_marker '(^|\n)[[:space:]]*findings:' 'findings: <array, may be empty>'
  check_marker '(^|\n)[[:space:]]*summary:'  'summary: <one sentence>'

  # === Spillover audit-trail (§2.6) — process-validator block ===========
  if [ "$HANDOVER_STATUS" = "block" ]; then
    SPILL_SCOPE=$(echo "$DESCRIPTION" | sed -E 's/^process-validator-([a-z0-9-]+).*/\1/' || true)
    SPILL_C=$(echo "$RESPONSE" | grep -E '^[[:space:]]*cycle:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*cycle:[[:space:]]*//' | tr -d '[:space:]' || true)
    if [ -n "$SPILL_SCOPE" ] && [ -n "$SPILL_C" ]; then
      SPILL_CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
      SPILL_REPO_ROOT=$(git -C "$SPILL_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$SPILL_CWD")
      SPILL_PATH="$SPILL_REPO_ROOT/tests/e2e/docs/.subagent-returns/process-validator-${SPILL_SCOPE}-c${SPILL_C}.md"
      if [ ! -f "$SPILL_PATH" ]; then
        HANDOVER_WARNS+=("spillover (§2.6): expected process-validator spill file not found at tests/e2e/docs/.subagent-returns/process-validator-${SPILL_SCOPE}-c${SPILL_C}.md. The SubagentStop rewrite-gate should have prevented this; PostToolUse audit fires this WARN as defense-in-depth — check that hooks/subagent-spillover-rewrite-gate.sh is installed and the cap was not reached.")
      fi
    fi
  fi
fi

# === Phase-validator schema (Onboarding phase exit checkpoint, §2.5) =====
if [ "$ROLE" = "phase-validator" ]; then
  if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*(greenlight|improvements-needed)'; then
    MISSING+=('status: <greenlight|improvements-needed>')
  fi
  # phase: <single digit 1-7> — anchored on end-of-line / non-digit so
  # phase: 12, phase: 71, phase: 8a all FAIL (without the anchor [1-7]
  # would match the leading 1 of "12" and accept multi-digit phases that
  # don't exist).
  check_marker '(^|\n)[[:space:]]*phase:[[:space:]]*[1-7][[:space:]]*$'    'phase: <1-7>'
  check_marker '(^|\n)[[:space:]]*exit-criteria-checked:'                  'exit-criteria-checked: <array, ≥1 row>'
  # exit-criteria-checked must have at least one `- criterion:` row.
  # The field-marker check above only verifies the header line; the row
  # check verifies the array isn't empty (§2.5 mandates ≥1 row).
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*exit-criteria-checked:'; then
    check_marker '(^|\n)[[:space:]]*-[[:space:]]+criterion:'                'exit-criteria-checked: ≥1 `- criterion:` row (the array cannot be empty)'
  fi
  check_marker '(^|\n)[[:space:]]*summary:'                                'summary: <one sentence>  (REQUIRED on both statuses)'

  # On greenlight, findings: [] is required (explicit empty array).
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*greenlight'; then
    if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*findings:[[:space:]]*\[\]'; then
      MISSING+=('findings: []  (REQUIRED on greenlight — explicit empty array)')
    fi
  fi
  # On improvements-needed, ≥1 must-fix finding with pv-<phase>-<nn> ID.
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*improvements-needed'; then
    # pv-<phase>-<nn> finding-ID: <nn> is two-digit zero-padded per §2.5
    # (matches §1's <nn> rule across the schema). [0-9]{2,} accepts 2+
    # digits, rejects single-digit forms like pv-5-1.
    if ! echo "$RESPONSE" | grep -qE '\*\*pv-[1-7]-[0-9]{2,}\*\*[[:space:]]*\[must-fix\]'; then
      MISSING+=('at least one must-fix finding with pv-<phase>-<nn> ID — <nn> must be ≥2 digits zero-padded (required when status=improvements-needed)')
    fi
  fi

  # Banned tokens (inherited from reviewer + finding-ID legacy prefixes).
  check_banned '(^|[^a-z-])nice-to-have([^a-z-]|$)'             'nice-to-have (banned — phase-validator findings carry [must-fix] only)'
  check_banned '(^|[^a-z-])greenlight-with-notes([^a-z-]|$)'    'greenlight-with-notes (banned — there is no third return state)'
  check_banned '(^|\n)[[:space:]]*notes:'                       'notes: sub-list (banned — observations are either must-fix or unrecorded)'

  # === Spillover audit-trail (§2.6) — phase-validator improvements-needed
  if [ "$HANDOVER_STATUS" = "improvements-needed" ]; then
    SPILL_PHASE=$(echo "$RESPONSE" | grep -E '^[[:space:]]*phase:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*phase:[[:space:]]*//' | tr -d '[:space:]' || true)
    SPILL_C=$(echo "$RESPONSE" | grep -E '^[[:space:]]*cycle:[[:space:]]*' | head -1 | sed -E 's/^[[:space:]]*cycle:[[:space:]]*//' | tr -d '[:space:]' || true)
    if [ -n "$SPILL_PHASE" ] && [ -n "$SPILL_C" ]; then
      SPILL_CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
      SPILL_REPO_ROOT=$(git -C "$SPILL_CWD" rev-parse --show-toplevel 2>/dev/null || echo "$SPILL_CWD")
      SPILL_PATH="$SPILL_REPO_ROOT/tests/e2e/docs/.subagent-returns/phase-validator-${SPILL_PHASE}-c${SPILL_C}.md"
      if [ ! -f "$SPILL_PATH" ]; then
        HANDOVER_WARNS+=("spillover (§2.6): expected phase-validator spill file not found at tests/e2e/docs/.subagent-returns/phase-validator-${SPILL_PHASE}-c${SPILL_C}.md. The SubagentStop rewrite-gate should have prevented this; PostToolUse audit fires this WARN as defense-in-depth — check that hooks/subagent-spillover-rewrite-gate.sh is installed and the cap was not reached.")
      fi
    fi
  fi
fi

# Nothing missing, banned, or envelope-warned — silent allow.
if [ ${#MISSING[@]} -eq 0 ] && [ ${#BANNED[@]} -eq 0 ] && [ ${#HANDOVER_WARNS[@]} -eq 0 ]; then
  exit 0
fi

# Build a single-paragraph systemMessage. We deliberately do NOT block
# (warn-mode initial release). The orchestrator sees the warning and is
# expected to re-dispatch — and the next ratchet ships block-mode.
WARNING="[WARN] Subagent return validation surfaced issues.

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

if [ ${#HANDOVER_WARNS[@]} -gt 0 ]; then
  WARNING="${WARNING}

Handover envelope (§2.0):"
  for item in "${HANDOVER_WARNS[@]}"; do
    WARNING="${WARNING}
  - ${item}"
  done
fi

WARNING="${WARNING}

The canonical return schema is documented in:
  skills/element-interactions/references/subagent-return-schema.md
    §1   — finding-return shape
    §2   — return states (covered-exhaustively / no-new-tests-by-rationalisation)
    §2.0 — handover envelope (role / cycle / status / next-action)
    §2.4 — reviewer (Stage B) return shape
    §3   — adversarial-findings ledger schema
    §4.1 — minimal grep-based conformance check
    §4.3 — handover-envelope leash + deregistration (this hook)

Re-dispatch the subagent with a brief that quotes the missing markers verbatim and re-grep the return on its way back. This warning is non-blocking; a follow-up release will promote it to BLOCK once the false-positive rate is calibrated."

emit_warn "$WARNING"

exit 0
