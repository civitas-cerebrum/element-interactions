#!/bin/bash
# phase-validator-dispatch-required.sh — gate Phase N+1 advance on Phase N's validator greenlight
#
# Hook    : PreToolUse:Agent  (gate advance) + PostToolUse:Agent  (record ledger)
# Mode    : DENY (PreToolUse — block phase-N+1 dispatches without phase-N greenlight)
#           + RECORD (PostToolUse — append phase-validator return to ledger)
# State   : <repo>/tests/e2e/docs/onboarding-phase-ledger.json
# Env     : none
#
# Rule
# ----
# PreToolUse:  every Agent dispatch that maps to a "Phase N+1" boundary
#              (currently: composer-*, reviewer-*, probe-*, cleanup-*, and
#              process-validator-* with `coverage-expansion-state.json`
#              context = entering Phase 5) is denied unless the ledger
#              shows Phase N greenlight. `phase-validator-<N>:` dispatches
#              are always allowed (don't gate the gate).
# PostToolUse: every `phase-validator-<N>:` Agent return is parsed for
#              `status:` and recorded in the ledger:
#              - status: greenlight   → write phase N entry, cycle reset
#              - status: improvements-needed → increment cycle counter
#              - cycle 10 reached     → write blocked-phase-validator-stalled
#
# Why
# ---
# Onboarding's per-phase completion contract is markdown-only at the dispatch
# level today (PR A — v0.3.6 — landed schema validation but not dispatch
# enforcement). The v0.3.4 onboarding test demonstrated agents will skip
# phase-validator dispatch under context pressure and advance to Phase N+1
# anyway. This hook is the mechanical enforcement that makes phase-validator
# unskippable: Onboarding cannot enter Phase 5 until phase-validator-4 has
# greenlit. The same shape generalises to every phase boundary; this initial
# release covers Phase 4 → 5 (the v0.3.4 failure case). Other transitions
# (Phase 3 → 4, Phase 5 → 6, etc.) are future-work additions to the
# phase-mapping table.
#
# Canonical reference
# -------------------
# skills/onboarding/references/phase-validator-workflow.md §"Onboarding's
#   response handling" + §"Mechanical enforcement"
# skills/element-interactions/references/subagent-return-schema.md §2.5
#
# State-file shape
# ----------------
# tests/e2e/docs/onboarding-phase-ledger.json:
#   {
#     "phases": {
#       "<N>": {
#         "status": "greenlight" | "in-progress" | "blocked-phase-validator-stalled",
#         "validator": "phase-validator-<N>",
#         "cycle": <int 1-10>,
#         "at": "<ISO-8601>",
#         "evidence": [<list of evidence pointers from validator return>],
#         "unresolved-findings": [<finding-IDs>]   # only on blocked-phase-validator-stalled
#       },
#       ...
#     }
#   }
#
# Phase-mapping table (description prefix → Phase boundary it crosses)
# ---------------------------------------------------------------------
# composer-*, reviewer-*, probe-*, cleanup-*  → Phase 5 (entering coverage-expansion work)
# process-validator-*                          → Phase 5 (entering coverage-expansion work)
# phase-validator-*                            → always allowed (gate is not gated)
# phase1-*, phase2-*, stage2-*                 → not yet phase-mapped (silent allow)
# (Phase 3 → 4, Phase 5 → 6, Phase 6 → 7 transitions: future work)
#
# Failure → action
# ----------------
# - Coverage-expansion-role dispatch + ledger missing or no Phase 4 greenlight  → DENY
# - Phase-validator-<N>: dispatch                                                → silent allow (PreToolUse)
# - Phase-validator-<N>: return                                                  → RECORD ledger update (PostToolUse)
# - Cycle 10 reached (10 consecutive improvements-needed for one phase)         → RECORD blocked-phase-validator-stalled
# - Anything else                                                                → silent allow

set -euo pipefail

# Resolve jq: prefer the binary bundled with the hook install, fall back to
# system jq for in-repo testing before postinstall has run.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
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

# --- helpers ---
emit_deny() {
  local reason="$1
$(no_skip_messaging_block)"
  "$JQ" -n --arg r "$reason" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# --- input ---
INPUT=$(cat)
EVENT_NAME=$(echo "$INPUT" | "$JQ" -r '.hook_event_name // ""')
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

# Strip leading/trailing whitespace from the description before any
# pattern-matching. A leading space (`" composer-..."`) would otherwise
# evade the case-pattern globs below and slip past every dispatch guard
# (BookHive Run-5 round-1 finding F3). Mirror this trim in every
# description-driven hook. Pair with `shopt -s nocasematch` (G3) so
# `Composer-...`, `Phase-Validator-...`, and similar capital-prefix
# variants don't slip past either.
shopt -s nocasematch 2>/dev/null || true
# Lowercase via jq's ascii_downcase so the sed-based phase-extraction
# below (which is case-sensitive in BREs/EREs) treats `Phase-Validator-3:`
# the same as `phase-validator-3:`. Pair with nocasematch above for the
# case-pattern globs. Together these close G3 across the whole hook.
DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // "" | gsub("^\\s+|\\s+$"; "") | ascii_downcase')

# Resolve repo root for state-file location.
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
LEDGER="$REPO_ROOT/tests/e2e/docs/onboarding-phase-ledger.json"

# Helper: ensure ledger directory exists; doesn't write the file.
mkdir -p "$REPO_ROOT/tests/e2e/docs" 2>/dev/null || true

# === PreToolUse branch: gate Phase N+1 dispatches ==========================
if [ "$EVENT_NAME" = "PreToolUse" ]; then
  # Phase-validator dispatches are gated by the validator-chain rule:
  # phase-validator-N (for N >= 2) requires phase-validator-(N-1)
  # greenlit. Without the chain, the orchestrator could dispatch
  # phase-validator-7 directly and rubber-stamp a Phase-7 greenlight
  # while Phases 5-6 sat unvalidated — closes I-1 of the BookHive Run-2
  # follow-up review.
  case "$DESCRIPTION" in
    phase-validator-*)
      # Strict regex: exactly one digit 1-7 then a non-alphanumeric
      # boundary. Without the boundary, `phase-validator-12:` would map
      # to phase 1 via greedy `.*` match (BookHive Run-5 red-team bonus
      # finding). Same regex shape as the PostToolUse writer below.
      PV_PHASE=$(echo "$DESCRIPTION" | sed -nE 's/^phase-validator-([1-7])[^a-zA-Z0-9].*/\1/p')
      if [ -n "$PV_PHASE" ] && [ "$PV_PHASE" -ge 2 ]; then
        PV_PRIOR=$((PV_PHASE - 1))
        PV_PRIOR_STATUS=""
        if [ -f "$LEDGER" ]; then
          PV_PRIOR_STATUS=$("$JQ" -r --arg p "$PV_PRIOR" '.phases[$p].status // empty' "$LEDGER" 2>/dev/null || echo "")
        fi
        if [ "$PV_PRIOR_STATUS" != "greenlight" ]; then
          emit_deny "[BLOCKED] phase-validator-${PV_PHASE} dispatched before phase-validator-${PV_PRIOR} greenlight.

──────────────────────────────────────────────────────────────────
Do this instead — dispatch the prior validator first:
──────────────────────────────────────────────────────────────────
The phase-validator chain MUST run sequentially. phase-validator-N requires phase-validator-(N-1) greenlit. The orchestrator cannot skip directly to phase-validator-${PV_PHASE} when Phase ${PV_PRIOR} is unvalidated.

Dispatch phase-validator-${PV_PRIOR} first; resolve any improvements-needed findings; then re-issue this dispatch.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description:                     \"${DESCRIPTION}\"
Phase ${PV_PRIOR} ledger status: \"${PV_PRIOR_STATUS:-absent}\"
Required:                        phase-validator-${PV_PRIOR} greenlight before phase-validator-${PV_PHASE} dispatch

References:
  skills/onboarding/SKILL.md §\"Phase-validator checkpoint\"
  skills/onboarding/references/phase-validator-workflow.md"
          exit 0
        fi
      fi
      exit 0 ;;
  esac

  # Map the dispatch's description prefix to a Phase boundary it crosses.
  # Three transitions are enforced today:
  #   (1) Phase 4 → 5: composer/reviewer/cleanup/process-validator
  #       dispatches mean the orchestrator is entering coverage-expansion
  #       per-journey work.
  #   (2) Phase 5 (adversarial Passes 4-5) vs Phase 6: probe-* dispatches
  #       are shared between Phase 5 adversarial passes and Phase 6
  #       bug-discovery. Distinguished by coverage-expansion-state.json.status:
  #       "complete" → Phase 6 entry (requires phase-validator-5 greenlight);
  #       anything else → still inside Phase 5 (requires phase-validator-4).
  #   (3) Phase 6 → 7 is enforced via the validator-chain rule above
  #       (phase-validator-7 requires phase-validator-6 greenlight) and via
  #       the BENCHMARK / onboarding-report write-guards.
  ENTERING_PHASE=""
  COVERAGE_STATE_FILE="$REPO_ROOT/tests/e2e/docs/coverage-expansion-state.json"
  case "$DESCRIPTION" in
    composer-*|reviewer-*|cleanup-*|process-validator-*)
      ENTERING_PHASE=5 ;;
    probe-*)
      COV_STATUS=""
      if [ -f "$COVERAGE_STATE_FILE" ]; then
        COV_STATUS=$("$JQ" -r '.status // empty' "$COVERAGE_STATE_FILE" 2>/dev/null || echo "")
      fi
      if [ "$COV_STATUS" = "complete" ]; then
        ENTERING_PHASE=6
      else
        ENTERING_PHASE=5
      fi ;;
    *) exit 0 ;;  # not yet phase-mapped — silent allow
  esac

  PRIOR_PHASE=$((ENTERING_PHASE - 1))

  # No ledger → no greenlight has been recorded for any phase. If we're
  # entering Phase 5, the orchestrator hasn't run phase-validator-4 yet.
  if [ ! -f "$LEDGER" ]; then
    emit_deny "[BLOCKED] Phase ${ENTERING_PHASE} dispatch attempted before phase-validator-${PRIOR_PHASE} greenlight.

──────────────────────────────────────────────────────────────────
Do this instead — dispatch the phase-validator first:
──────────────────────────────────────────────────────────────────

  Agent({
    description: \"phase-validator-${PRIOR_PHASE}: cycle 1\",
    prompt: <<EOF
## Phase-validator brief — Phase ${PRIOR_PHASE}
**Phase:** ${PRIOR_PHASE}
**Sub-skill:** <sub-skill name>
**Project root:** <abs path>
## Artifacts to verify
<list of artifacts the validator will check, per the per-phase completion contract>
## Per-phase completion contract (verbatim from onboarding/SKILL.md)
<paste the row for Phase ${PRIOR_PHASE}>
## Cycle context
This is cycle 1 of 10 for Phase ${PRIOR_PHASE}. Previous improvements-needed findings: none — first cycle.
## Return shape
See \`skills/element-interactions/references/subagent-return-schema.md\` §2.5.
EOF,
    subagent_type: \"general-purpose\"
  })

…then dispatch the Phase ${ENTERING_PHASE} work only after the validator returns greenlight.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Ledger:      ${LEDGER} (does not exist)
Required:    phase-validator-${PRIOR_PHASE} greenlight before any Phase ${ENTERING_PHASE} dispatch

Onboarding advances to a new phase only after that phase's predecessor has been greenlit by a phase-validator dispatch. The ledger \`tests/e2e/docs/onboarding-phase-ledger.json\` is the authoritative record. No ledger means no greenlights yet — the orchestrator must dispatch phase-validator-${PRIOR_PHASE} before this Phase ${ENTERING_PHASE} dispatch.

References:
  skills/onboarding/SKILL.md §\"Phase-validator checkpoint\"
  skills/onboarding/references/phase-validator-workflow.md
  skills/element-interactions/references/subagent-return-schema.md §2.5"
    exit 0
  fi

  # Ledger exists — check Phase N-1 entry.
  PRIOR_STATUS=$("$JQ" -r --arg p "$PRIOR_PHASE" '.phases[$p].status // empty' "$LEDGER" 2>/dev/null || echo "")

  case "$PRIOR_STATUS" in
    greenlight) exit 0 ;;  # ALL GOOD — advance allowed
    blocked-phase-validator-stalled)
      emit_deny "[BLOCKED] Phase ${PRIOR_PHASE} is stalled (cycle 10 reached without greenlight).

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

The phase-validator-${PRIOR_PHASE} reached the 10-cycle cap with unresolved findings. Onboarding cannot advance to Phase ${ENTERING_PHASE}; this is a terminal state requiring user intervention.

Surface back to the user with the unresolved findings list:

  cat ${LEDGER} | "$JQ" '.phases[\"${PRIOR_PHASE}\"].\"unresolved-findings\"'

Onboarding must report the stalled state — do NOT continue silently.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Phase ${PRIOR_PHASE} status: blocked-phase-validator-stalled (cycle 10 cap reached)

References:
  skills/onboarding/references/phase-validator-workflow.md §\"Cycle cap\"
  skills/onboarding/SKILL.md §\"Phase-validator checkpoint\""
      exit 0
      ;;
    *)
      # Status is in-progress, missing entirely, or unknown.
      CYCLE=$("$JQ" -r --arg p "$PRIOR_PHASE" '.phases[$p].cycle // 0' "$LEDGER" 2>/dev/null || echo 0)
      emit_deny "[BLOCKED] Phase ${ENTERING_PHASE} dispatch attempted before phase-validator-${PRIOR_PHASE} greenlight.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

Re-dispatch the phase-validator for Phase ${PRIOR_PHASE}:

  Agent({
    description: \"phase-validator-${PRIOR_PHASE}: cycle $((CYCLE + 1))\",
    prompt: <<EOF
## Phase-validator brief — Phase ${PRIOR_PHASE}
**Phase:** ${PRIOR_PHASE}
## Cycle context
This is cycle $((CYCLE + 1)) of 10. Previous improvements-needed findings:
<paste from prior validator return>
EOF,
    subagent_type: \"general-purpose\"
  })

…then dispatch Phase ${ENTERING_PHASE} work only after the validator returns greenlight.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Phase ${PRIOR_PHASE} ledger entry: status=\"${PRIOR_STATUS:-absent}\", cycle=${CYCLE}
Required:    phase-validator-${PRIOR_PHASE} greenlight (status: \"greenlight\") before Phase ${ENTERING_PHASE} dispatch

The ledger shows Phase ${PRIOR_PHASE} is not yet greenlit — either the previous validator returned improvements-needed (and the orchestrator hasn't re-dispatched yet) or no validator has been dispatched at all. The orchestrator must address the validator's findings (if any) and re-dispatch before advancing.

References:
  skills/onboarding/SKILL.md §\"Phase-validator checkpoint\"
  skills/onboarding/references/phase-validator-workflow.md"
      exit 0
      ;;
  esac
fi

# === PostToolUse branch: record phase-validator returns to ledger ==========
if [ "$EVENT_NAME" = "PostToolUse" ]; then
  # Only fire on phase-validator dispatches.
  case "$DESCRIPTION" in
    phase-validator-*) ;;
    *) exit 0 ;;
  esac

  # Extract the phase number from the description: "phase-validator-<N>:".
  PHASE=$(echo "$DESCRIPTION" | sed -E 's/^phase-validator-([1-7])[^a-zA-Z0-9].*/\1/')
  if ! echo "$PHASE" | grep -qE '^[1-7]$'; then
    exit 0   # malformed phase number; let schema-guard surface it
  fi

  # Extract the response text. The harness payload shape varies — Agent
  # returns arrive under .tool_response.content (array of {type,text}) on
  # the live claude-code harness, under .tool_response.output on some test
  # harnesses, and occasionally as a top-level string or under
  # .tool_response.result. Mirror subagent-return-schema-guard.sh: try the
  # known keys first, then fall back to a whole-object stringify so a
  # payload-shape change in the harness never silently strands the ledger
  # writer (BookHive Run-5 finding — `.content` was the only populated key
  # in the live harness, while every prior extractor only knew about
  # `.output`).
  RESPONSE=$(
    echo "$INPUT" | "$JQ" -r '
      [
        (.tool_response.content? | if . == null then empty elif type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
        (.tool_response.output? | if . == null then empty elif type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
        (.tool_response.result? // empty | tostring),
        (if (.tool_response | type) == "string" then .tool_response else empty end)
      ] | map(select(. != null and . != "" and . != "null")) | unique | join("\n")
    ' 2>/dev/null || echo ""
  )

  # Fallback: if the targeted extraction yielded nothing, dump tool_response
  # whole. Better to grep across noise than to silently exit on a payload
  # shape we couldn't anticipate. (Mirrors subagent-return-schema-guard.sh
  # lines 183-192.)
  if [ -z "$RESPONSE" ]; then
    RESPONSE=$(echo "$INPUT" | "$JQ" -r '
      if (.tool_response // null) == null then ""
      elif (.tool_response | type) == "string" then .tool_response
      else (.tool_response | tostring)
      end
    ' 2>/dev/null || echo "")
  fi

  [ -z "$RESPONSE" ] && exit 0   # truly no response to parse

  # Determine status from the response.
  STATUS=""
  if echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*greenlight'; then
    STATUS="greenlight"
  elif echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*status:[[:space:]]*improvements-needed'; then
    STATUS="improvements-needed"
  else
    exit 0   # malformed status; schema-guard handles
  fi

  # Schema-shape gate: require the canonical fields (per
  # subagent-return-schema.md §2.5) BEFORE recording any ledger
  # entry. The schema-guard hook is WARN-mode; without this gate, a
  # one-line `status: greenlight` body with no `exit-criteria-checked:`,
  # no `summary:`, and no `findings:` array would still be recorded as
  # a phase greenlight (BookHive Run-5 red-team finding F1). Reject
  # malformed returns here — silent allow at the harness level so
  # schema-guard's WARN can still surface to the user; just don't
  # corrupt the ledger.
  if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*phase:[[:space:]]*[1-7]'; then
    exit 0   # missing `phase:` field
  fi
  if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*exit-criteria-checked:'; then
    exit 0   # missing `exit-criteria-checked:` array header
  fi
  if ! echo "$RESPONSE" | grep -qE '^[[:space:]]*-[[:space:]]+criterion:'; then
    exit 0   # `exit-criteria-checked:` array has zero entries
  fi
  if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*summary:'; then
    exit 0   # missing `summary:` (REQUIRED on both statuses per §2.5)
  fi

  if [ "$STATUS" = "greenlight" ]; then
    # Greenlight requires the literal `findings: []` (explicit empty
    # array). Without this, a malformed body with no findings field
    # whatsoever could record greenlight; the `[]` literal forces the
    # validator to attest "I checked, there are zero findings".
    if ! echo "$RESPONSE" | grep -qE '(^|\n)[[:space:]]*findings:[[:space:]]*\[\]'; then
      exit 0   # greenlight without explicit `findings: []`
    fi

    # BookHive Run-5 round-3 finding H9 — phase-validator chain forge.
    # A schema-perfect YAML body is not proof the phase was actually
    # done. Verify per-phase deliverables exist on disk before
    # recording greenlight. If a phase claims greenlight without its
    # artifact present, the subagent was either forged (orchestrator
    # told the subagent to return verbatim YAML) or the orchestrator
    # is racing the disk; either way, refuse the ledger write.
    #
    # Artifacts checked are the minimal disk-side trace each phase
    # MUST leave. The protected-state hook (harness-trusted-state-
    # write-guard) already prevents the agent from forging the
    # heavyweight artifacts (journey-map.md sentinel, coverage-
    # expansion-state.json, ledger itself), so artifact-existence
    # against those is meaningful evidence of real subagent work.
    ARTIFACT_OK=0
    # J1 (round-5) — reject symlinks. K1 (round-6) — also reject hardlinks
    # (nlink > 1). Without K1, the attacker can `ln /tmp/forged
    # tests/e2e/docs/onboarding-report.md` (hardlink, not symlink) and
    # share the inode with their forged file; `[ ! -L ]` only catches
    # symlinks. Requiring nlink=1 forces the artifact to be a unique
    # regular file with no external inode-sharing.
    _link_count() {
      # BSD stat (macOS): `stat -f %l`. GNU stat (Linux): `stat -c %h`.
      stat -f %l "$1" 2>/dev/null || stat -c %h "$1" 2>/dev/null || echo 1
    }
    # Helper: regular file (not symlink, nlink=1) AND larger than $2 bytes.
    _f_big() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(_link_count "$1")" -eq 1 ] && [ "$(wc -c < "$1" 2>/dev/null || echo 0)" -gt "$2" ]; }
    # Helper: regular file (not symlink, nlink=1) AND grep-matches pattern AND larger than $3 bytes.
    _f_grep_big() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(_link_count "$1")" -eq 1 ] && grep -q "$2" "$1" 2>/dev/null && [ "$(wc -c < "$1" 2>/dev/null || echo 0)" -gt "$3" ]; }
    # J2 (round-5) — Phase 3 spec content sentinel. Previously `_has_real_spec`
    # only checked `wc -c > 256`. Any 257-byte file (e.g., `printf 'const x = %s' "$(yes 1 | head)"`)
    # passed. Add a content sentinel requiring an actual test() declaration AND
    # a known testing framework import. This rejects garbage files that meet
    # the size bar but aren't real test specs.
    _has_real_spec() {
      local f
      shopt -s nullglob globstar 2>/dev/null || true
      for f in "$REPO_ROOT"/tests/e2e/*.spec.ts "$REPO_ROOT"/tests/e2e/*.spec.js "$REPO_ROOT"/tests/e2e/**/*.spec.ts "$REPO_ROOT"/tests/e2e/**/*.spec.js; do
        [ -f "$f" ] || continue
        [ -L "$f" ] && continue   # J1 — reject symlinks here too
        [ "$(_link_count "$f")" -ne 1 ] && continue   # K1 — reject hardlinks
        if [ "$(wc -c < "$f" 2>/dev/null || echo 0)" -gt 256 ] && \
           grep -qE 'from[[:space:]]+["'"'"'](@playwright/test|@civitas-cerebrum/element-interactions)["'"'"']' "$f" 2>/dev/null && \
           grep -qE '\btest[[:space:]]*\(' "$f" 2>/dev/null; then
          shopt -u nullglob globstar 2>/dev/null || true
          return 0
        fi
      done
      shopt -u nullglob globstar 2>/dev/null || true
      return 1
    }
    case "$PHASE" in
      1)
        # Phase 1 — scaffold + deps. Package.json must declare the
        # element-interactions dep AND a baseFixture file + a Playwright
        # config must exist on disk. I5 hardening: require baseFixture
        # AND playwright.config to be non-empty (the agent could
        # `: > baseFixture.ts` to forge presence otherwise).
        if [ -f "$REPO_ROOT/package.json" ] && \
           grep -q '@civitas-cerebrum/element-interactions' "$REPO_ROOT/package.json" 2>/dev/null && \
           { _f_big "$REPO_ROOT/tests/e2e/baseFixture.ts" 32 || _f_big "$REPO_ROOT/tests/e2e/baseFixture.js" 32; } && \
           { _f_big "$REPO_ROOT/playwright.config.ts" 32 || _f_big "$REPO_ROOT/playwright.config.js" 32; }; then
          ARTIFACT_OK=1
        fi
        ;;
      2)
        # Phase 2 — groundwork: app-context.md with Test Infrastructure
        # section + a sentinel-bearing journey-map.md (Phase-2 lands the
        # initial map even if Phases 3-5 sections are empty).
        # I5: require substantive size on app-context.md (>256B) AND
        # sentinel-bearing journey-map.md.
        if _f_grep_big "$REPO_ROOT/tests/e2e/docs/app-context.md" '## Test Infrastructure' 256 && \
           [ -f "$REPO_ROOT/tests/e2e/docs/journey-map.md" ] && \
           grep -q 'journey-mapping:generated' "$REPO_ROOT/tests/e2e/docs/journey-map.md" 2>/dev/null; then
          ARTIFACT_OK=1
        fi
        ;;
      3)
        # Phase 3 — happy-path automation: at least one spec with
        # substantive content (>256B, rules out `: > happy.spec.ts`).
        if _has_real_spec; then
          ARTIFACT_OK=1
        fi
        ;;
      4)
        # Phase 4 — journey-map complete: file exists, sentinel intact,
        # AND substantive content (>1KB rules out the Phase-2 stub seed).
        if _f_grep_big "$REPO_ROOT/tests/e2e/docs/journey-map.md" 'journey-mapping:generated' 1024; then
          ARTIFACT_OK=1
        fi
        ;;
      5)
        # Phase 5 — coverage-expansion: state file marks complete AND
        # journeys array has at least one entry (rules out a hand-
        # crafted `{"status":"complete","journeys":[]}` forge).
        if [ -f "$REPO_ROOT/tests/e2e/docs/coverage-expansion-state.json" ] && \
           [ "$("$JQ" -r '.status // empty' "$REPO_ROOT/tests/e2e/docs/coverage-expansion-state.json" 2>/dev/null)" = "complete" ] && \
           [ "$("$JQ" -r '(.journeys // []) | length' "$REPO_ROOT/tests/e2e/docs/coverage-expansion-state.json" 2>/dev/null)" -gt 0 ]; then
          ARTIFACT_OK=1
        fi
        ;;
      6)
        # Phase 6 — bug-discovery: adversarial findings landed with
        # substantive content (>256B) AND mention at least one finding
        # ID (avoids `: > adversarial-findings.md` forge). The findings
        # are markdown with `## Finding ` or `### bug-` headers; require
        # at least one to be present.
        if _f_big "$REPO_ROOT/tests/e2e/docs/adversarial-findings.md" 256 && \
           grep -qE '(##|###)[[:space:]]+(Finding|bug-|finding-|F[0-9]|H[0-9])' "$REPO_ROOT/tests/e2e/docs/adversarial-findings.md" 2>/dev/null; then
          ARTIFACT_OK=1
        elif [ -d "$REPO_ROOT/tests/e2e/docs/bug-discovery-findings" ] && \
             [ "$(find "$REPO_ROOT/tests/e2e/docs/bug-discovery-findings" -type f -name '*.md' 2>/dev/null | wc -l)" -gt 0 ]; then
          ARTIFACT_OK=1
        elif _f_big "$REPO_ROOT/tests/e2e/docs/bug-discovery-findings.md" 256; then
          ARTIFACT_OK=1
        fi
        ;;
      7)
        # Phase 7 — onboarding report (substantive) AND BENCHMARK entry.
        # The report MUST include the per-phase summary + the BENCHMARK
        # update marker. Empty / zero-byte reports are rejected.
        if _f_big "$REPO_ROOT/tests/e2e/docs/onboarding-report.md" 512 && \
           grep -qE '## (Phase|Summary|Coverage|Bug)' "$REPO_ROOT/tests/e2e/docs/onboarding-report.md" 2>/dev/null; then
          ARTIFACT_OK=1
        fi
        ;;
    esac
    if [ "$ARTIFACT_OK" != "1" ]; then
      # Don't write the ledger; surface the gap to the user via
      # systemMessage so the orchestrator stops claiming greenlight
      # for work that didn't happen.
      "$JQ" -n --arg p "$PHASE" '{
        "systemMessage": ("[HARNESS] phase-validator-" + $p + " returned greenlight but the Phase " + $p + " deliverable is missing on disk. Ledger write refused (BookHive Run-5 H9 — chain-forge defense). Audit the subagent return and re-run the phase work for real.")
      }'
      exit 0
    fi
  else
    # Improvements-needed requires at least one `pv-<phase>-<nn>` finding
    # block per §2.5. Phase number must match the dispatched phase.
    if ! echo "$RESPONSE" | grep -qE "\\*\\*pv-${PHASE}-[0-9]+\\*\\*[[:space:]]+\\[must-fix\\]"; then
      exit 0   # improvements-needed without any pv-<phase>-NN [must-fix] finding
    fi
  fi

  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Read existing ledger (or initialise empty).
  if [ -f "$LEDGER" ]; then
    EXISTING=$("$JQ" '.' "$LEDGER" 2>/dev/null || echo '{"phases":{}}')
  else
    EXISTING='{"phases":{}}'
  fi

  # Read current cycle count for this phase (default 0).
  CURRENT_CYCLE=$(echo "$EXISTING" | "$JQ" -r --arg p "$PHASE" '.phases[$p].cycle // 0' 2>/dev/null || echo 0)
  NEW_CYCLE=$((CURRENT_CYCLE + 1))

  if [ "$STATUS" = "greenlight" ]; then
    # Extract evidence pointers (lines under exit-criteria-checked with `evidence:`).
    EVIDENCE=$(echo "$RESPONSE" | grep -E '^[[:space:]]*evidence:' | sed -E 's/^[[:space:]]*evidence:[[:space:]]*//' | "$JQ" -R . | "$JQ" -s 'unique')
    [ -z "$EVIDENCE" ] && EVIDENCE='[]'

    # J3 (round-5) — record evidence-sha256 of the per-phase primary
    # artifact at greenlight time. Combined with the artifact-existence
    # check that just fired (ARTIFACT_OK=1), this provides a tamper-
    # detectable record of the on-disk state at the moment greenlight
    # was earned. Future audit hooks can re-hash and compare against the
    # ledger to detect post-greenlight revert/tampering.
    _sha() {
      [ -f "$1" ] && [ ! -L "$1" ] || { echo ""; return; }
      if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
      elif command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" 2>/dev/null | awk '{print $1}'
      else
        echo ""
      fi
    }
    ARTIFACT_SHA=""
    case "$PHASE" in
      1)
        # Concat baseFixture + playwright.config + package.json
        for af in "$REPO_ROOT/package.json" "$REPO_ROOT/tests/e2e/baseFixture.ts" "$REPO_ROOT/tests/e2e/baseFixture.js" "$REPO_ROOT/playwright.config.ts" "$REPO_ROOT/playwright.config.js"; do
          [ -f "$af" ] && ARTIFACT_SHA="${ARTIFACT_SHA}$(_sha "$af"):"
        done
        ;;
      2) ARTIFACT_SHA=$(_sha "$REPO_ROOT/tests/e2e/docs/app-context.md") ;;
      3)
        # Hash the first matching spec.
        shopt -s nullglob globstar 2>/dev/null || true
        for af in "$REPO_ROOT"/tests/e2e/*.spec.ts "$REPO_ROOT"/tests/e2e/*.spec.js "$REPO_ROOT"/tests/e2e/**/*.spec.ts "$REPO_ROOT"/tests/e2e/**/*.spec.js; do
          [ -f "$af" ] && [ ! -L "$af" ] && { ARTIFACT_SHA=$(_sha "$af"); break; }
        done
        shopt -u nullglob globstar 2>/dev/null || true
        ;;
      4) ARTIFACT_SHA=$(_sha "$REPO_ROOT/tests/e2e/docs/journey-map.md") ;;
      5) ARTIFACT_SHA=$(_sha "$REPO_ROOT/tests/e2e/docs/coverage-expansion-state.json") ;;
      6) ARTIFACT_SHA=$(_sha "$REPO_ROOT/tests/e2e/docs/adversarial-findings.md") ;;
      7) ARTIFACT_SHA=$(_sha "$REPO_ROOT/tests/e2e/docs/onboarding-report.md") ;;
    esac

    UPDATED=$(echo "$EXISTING" | "$JQ" --arg p "$PHASE" \
      --arg s "greenlight" \
      --arg t "$TIMESTAMP" \
      --argjson c "$NEW_CYCLE" \
      --argjson ev "$EVIDENCE" \
      --arg sha "${ARTIFACT_SHA:-unknown}" \
      '.phases[$p] = {
         status: $s,
         validator: ("phase-validator-" + $p),
         cycle: $c,
         at: $t,
         evidence: $ev,
         "evidence-sha256": $sha
       }')
    echo "$UPDATED" > "$LEDGER.tmp" && mv "$LEDGER.tmp" "$LEDGER" || rm -f "$LEDGER.tmp"
    exit 0
  fi

  # improvements-needed: increment cycle; if cycle reaches cap, mark stalled.
  CAP=10
  if [ "$NEW_CYCLE" -ge "$CAP" ]; then
    STALLED_STATUS="blocked-phase-validator-stalled"
    UNRESOLVED=$(echo "$RESPONSE" | grep -oE '\*\*pv-[1-7]-[0-9]+\*\*' | sed -E 's/^\*\*//;s/\*\*$//' | sort -u | "$JQ" -R . | "$JQ" -s '.')
    [ -z "$UNRESOLVED" ] && UNRESOLVED='[]'

    UPDATED=$(echo "$EXISTING" | "$JQ" --arg p "$PHASE" \
      --arg s "$STALLED_STATUS" \
      --arg t "$TIMESTAMP" \
      --argjson c "$NEW_CYCLE" \
      --argjson uf "$UNRESOLVED" \
      '.phases[$p] = {
         status: $s,
         validator: ("phase-validator-" + $p),
         cycle: $c,
         at: $t,
         "unresolved-findings": $uf
       }')
    echo "$UPDATED" > "$LEDGER.tmp" && mv "$LEDGER.tmp" "$LEDGER" || rm -f "$LEDGER.tmp"
    exit 0
  fi

  # Normal improvements-needed (cycle < 10): record in-progress with cycle bumped.
  UPDATED=$(echo "$EXISTING" | "$JQ" --arg p "$PHASE" \
    --arg s "in-progress" \
    --arg t "$TIMESTAMP" \
    --argjson c "$NEW_CYCLE" \
    '.phases[$p] = {
       status: $s,
       validator: ("phase-validator-" + $p),
       cycle: $c,
       at: $t
     }')
  echo "$UPDATED" > "$LEDGER.tmp" && mv "$LEDGER.tmp" "$LEDGER" || rm -f "$LEDGER.tmp"
  exit 0
fi

exit 0
