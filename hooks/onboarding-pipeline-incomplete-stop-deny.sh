#!/bin/bash
# onboarding-pipeline-incomplete-stop-deny.sh — Stop-event guard for
# onboarding pipelines that haven't reached a valid exit.
#
# Hook    : Stop
# Mode    : BLOCK (decision: block) when the onboarding pipeline is mid-
#           flight without explicit user-authorised stop sentinel
# State   : per-session consecutive-block counter at
#           /tmp/civitas-onboarding-stop-deny-<session_id> to cap
#           runaway-deny loops. Counter resets on cap-reached or on a
#           single allowed stop.
# Env     : ONBOARDING_STOP_DENY=off → silent allow (manual escape hatch
#           for non-onboarding contexts that happen to share the project
#           layout, e.g. a project that already onboarded long ago and
#           still has the docs around)
#
# Rule
# ----
# When the harness fires `Stop` on the orchestrator, the hook checks
# whether the onboarding pipeline is mid-flight and refuses the stop
# unless one of:
#
#   (a) The pipeline is genuinely complete (phase ledger all greenlit OR
#       no onboarding signals present at all).
#   (b) The user has authorised an early stop by writing
#       `.claude/onboarding-stop-authorized` at the repo root (or
#       `tests/e2e/docs/.onboarding-stop-authorized`).
#   (c) The hook has already denied this session ${CAP} times — at which
#       point it silently allows the stop so the user can always escape
#       a runaway deny loop.
#
# Mid-pipeline signals (any one is enough to engage):
#
#   - `tests/e2e/docs/journey-map.md` exists with the sentinel
#     `<!-- journey-mapping:generated -->`
#   - `tests/e2e/docs/coverage-expansion-state.json` exists
#   - `tests/e2e/docs/onboarding-report.md` exists without a "Phase 7
#     complete" marker
#   - `tests/e2e/docs/onboarding-phase-ledger.json` exists with phase 7
#     status != "greenlight"
#
# When mid-Phase-5 specifically, the deny message tailors the redirect:
#
#   - currentPass >= 1 AND zero dispatches recorded → "dispatch the
#     first wave; exit #2 requires at least one dispatch in flight"
#   - dispatches present AND no auto-compact attempted (no scratch
#     files under tests/e2e/docs/.coverage-expansion-cycle-*.json) →
#     "budget exhaustion is not a reason to stop, auto-compact instead"
#
# Why
# ---
# Issues #139 and #155 documented the exact failure mode: the
# orchestrator emits a long "final summary" message (long, structured,
# includes a state file, includes commits) and the harness accepts that
# as Stop. The kernel rule in `onboarding/SKILL.md` (autonomous-mode
# pipelines run to one of two valid exits) is markdown-only without a
# Stop-event hook reading the ledger. This hook is the second-reader the
# kernel rule lacks.
#
# Canonical reference
# -------------------
# skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
# skills/coverage-expansion/SKILL.md §"Two valid exits"
# skills/coverage-expansion/SKILL.md §"Auto-compaction between passes"
# Issues: civitas-cerebrum/element-interactions#139, #155 (Gap 1)
#
# Failure → action
# ----------------
# - Mid-pipeline + no authorisation sentinel + cap not reached  → BLOCK
# - All phases greenlit / Phase 7 complete marker present       → silent allow
# - Authorisation sentinel present                              → silent allow
# - Cap reached                                                 → silent allow (counter cleared)
# - No mid-pipeline signals                                     → silent allow
# - Anything else                                               → silent allow

set -euo pipefail

if [ "${ONBOARDING_STOP_DENY:-on}" = "off" ]; then
  exit 0
fi

emit_block() {
  jq -n --arg r "$1" '{
    "decision": "block",
    "reason": $r
  }'
}

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")

DOCS_DIR="$REPO_ROOT/tests/e2e/docs"

# --- escape hatch: user-authorised stop sentinel (always wins) --------------
if [ -f "$REPO_ROOT/.claude/onboarding-stop-authorized" ] || \
   [ -f "$DOCS_DIR/.onboarding-stop-authorized" ]; then
  # Clear the consecutive-block counter so the next session starts fresh.
  [ -n "$SESSION_ID" ] && rm -f "/tmp/civitas-onboarding-stop-deny-${SESSION_ID}" 2>/dev/null || true
  exit 0
fi

# --- detect onboarding-pipeline-active context -----------------------------
MID_PIPELINE=0
SIGNALS=""

if [ -f "$DOCS_DIR/journey-map.md" ] && \
   head -10 "$DOCS_DIR/journey-map.md" 2>/dev/null | grep -q '<!-- journey-mapping:generated -->'; then
  MID_PIPELINE=1
  SIGNALS="${SIGNALS}
  - tests/e2e/docs/journey-map.md (sentinel present)"
fi

if [ -f "$DOCS_DIR/coverage-expansion-state.json" ]; then
  MID_PIPELINE=1
  SIGNALS="${SIGNALS}
  - tests/e2e/docs/coverage-expansion-state.json"
fi

REPORT_INCOMPLETE=0
if [ -f "$DOCS_DIR/onboarding-report.md" ] && \
   ! grep -q 'Phase 7 complete' "$DOCS_DIR/onboarding-report.md" 2>/dev/null; then
  MID_PIPELINE=1
  REPORT_INCOMPLETE=1
  SIGNALS="${SIGNALS}
  - tests/e2e/docs/onboarding-report.md (no 'Phase 7 complete' marker)"
fi

LEDGER_INCOMPLETE=0
if [ -f "$DOCS_DIR/onboarding-phase-ledger.json" ]; then
  PHASE_7_STATUS=$(jq -r '.phases."7".status // "missing"' "$DOCS_DIR/onboarding-phase-ledger.json" 2>/dev/null || echo "missing")
  if [ "$PHASE_7_STATUS" != "greenlight" ]; then
    MID_PIPELINE=1
    LEDGER_INCOMPLETE=1
    SIGNALS="${SIGNALS}
  - tests/e2e/docs/onboarding-phase-ledger.json (phase 7 status: ${PHASE_7_STATUS})"
  fi
fi

[ "$MID_PIPELINE" -eq 0 ] && exit 0

# --- pipeline genuinely complete? -------------------------------------------
# If a ledger exists and ALL phase statuses are "greenlight", the pipeline is
# done — silent allow regardless of other signals.
if [ -f "$DOCS_DIR/onboarding-phase-ledger.json" ] && [ "$LEDGER_INCOMPLETE" -eq 0 ]; then
  # Phase 7 is greenlight — additional safety: confirm no other phase is in-progress.
  ANY_NOT_GREEN=$(jq -r '
    [.phases // {} | to_entries[] | .value.status]
    | map(select(. != "greenlight"))
    | length
  ' "$DOCS_DIR/onboarding-phase-ledger.json" 2>/dev/null || echo "1")
  if [ "$ANY_NOT_GREEN" = "0" ]; then
    [ -n "$SESSION_ID" ] && rm -f "/tmp/civitas-onboarding-stop-deny-${SESSION_ID}" 2>/dev/null || true
    exit 0
  fi
fi

# --- consecutive-block cap --------------------------------------------------
CAP=3
COUNTER=""
COUNT=0
if [ -n "$SESSION_ID" ]; then
  COUNTER="/tmp/civitas-onboarding-stop-deny-${SESSION_ID}"
  COUNT=$(cat "$COUNTER" 2>/dev/null || echo 0)
  case "$COUNT" in ''|*[!0-9]*) COUNT=0 ;; esac
fi

if [ "$COUNT" -ge "$CAP" ]; then
  # Cap reached — allow stop, clear counter so the user isn't stuck.
  [ -n "$COUNTER" ] && rm -f "$COUNTER" 2>/dev/null || true
  exit 0
fi

NEXT=$((COUNT + 1))
[ -n "$COUNTER" ] && echo "$NEXT" > "$COUNTER" 2>/dev/null || true

# --- tailor redirect for the specific Phase-5 sub-cases ---------------------
PHASE5_REDIRECT=""
if [ -f "$DOCS_DIR/coverage-expansion-state.json" ]; then
  CURRENT_PASS=$(jq -r '.currentPass // 0' "$DOCS_DIR/coverage-expansion-state.json" 2>/dev/null || echo 0)
  case "$CURRENT_PASS" in ''|*[!0-9]*) CURRENT_PASS=0 ;; esac
  DISPATCH_COUNT=$(jq -r '[.. | objects | select(has("journey"))] | length' "$DOCS_DIR/coverage-expansion-state.json" 2>/dev/null || echo 0)
  case "$DISPATCH_COUNT" in ''|*[!0-9]*) DISPATCH_COUNT=0 ;; esac

  COMPACT_FILES=0
  if ls "$DOCS_DIR"/.coverage-expansion-cycle-*.json >/dev/null 2>&1; then
    COMPACT_FILES=1
  fi

  if [ "$CURRENT_PASS" -ge 1 ] && [ "$DISPATCH_COUNT" -eq 0 ]; then
    PHASE5_REDIRECT="Phase 5 is in-progress (currentPass=${CURRENT_PASS}) but ZERO dispatches recorded.

  Dispatch the first wave: one Agent call per journey under \`composer-j-<slug>:\` / \`probe-j-<slug>:\` description prefixes (parallel where the independence graph permits). Exit #2 (write state + stop) requires AT LEAST ONE dispatch in flight before it is invocable — the schema-guard hook also denies state-file writes that claim mid-pass with empty dispatches[]."
  elif [ "$DISPATCH_COUNT" -gt 0 ] && [ "$COMPACT_FILES" -eq 0 ]; then
    PHASE5_REDIRECT="Phase 5 has ${DISPATCH_COUNT} dispatch(es) recorded but NO auto-compact attempted.

  Budget exhaustion is not a reason to stop — it's a reason to auto-compact (per coverage-expansion §\"Auto-compaction between passes\"). Persist in-flight Stage A returns to \`tests/e2e/docs/.coverage-expansion-cycle-<slug>-cycle-<N>.json\` scratch files, write the state file with all current dispatches[] populated, emit the line \`[coverage-expansion] context approaching budget — auto-compacting and resuming from state file\`, then invoke \`/compact\`. The post-compact turn resumes by reading the state file."
  fi
fi

# --- compose and emit ------------------------------------------------------
DEFAULT_REDIRECT="Continue dispatching the next pipeline phase. The front-load gate authorised the full pipeline (\"tens of minutes to several hours\"); auto-mode, session-length anxiety, and inferred user preference are explicitly NOT authorisation per skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"."

emit_block "[BLOCKED] Onboarding pipeline mid-flight — refusing to stop without explicit authorisation.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
${PHASE5_REDIRECT:-${DEFAULT_REDIRECT}}

  If you genuinely need to stop early:
    Create the authorisation sentinel and re-emit your stop.
      mkdir -p .claude && touch .claude/onboarding-stop-authorized
    Add a one-line note describing why if it helps the next session
    pick up:
      echo 'paused mid-Phase-5: <reason>' > .claude/onboarding-stop-authorized
    The hook honours either path and allows the stop. Without that
    sentinel, the kernel rule applies.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Mid-pipeline signals detected:${SIGNALS}

Block attempt: ${NEXT}/${CAP}. After ${CAP} consecutive blocks the hook silently allows the stop so a user can always escape a deny loop.

──────────────────────────────────────────────────────────────────
If 'I want to be transparent about session constraints' — read this:
──────────────────────────────────────────────────────────────────
Tone does not change the contract. A 'transparent' scope reduction is still a scope reduction; silent scope reduction dressed in candid language is still silent scope reduction. The framings the kernel rule names verbatim — 'pragmatic Pass 1', 'honest Pass 1 only', 'reduced scope given session constraints', 'the realistic depth-mode contract for this app is an evening run' — are exactly the patterns this hook is here to catch.

References:
  skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"
  skills/coverage-expansion/SKILL.md §\"Two valid exits\"
  skills/coverage-expansion/SKILL.md §\"Auto-compaction between passes\"
  Issues #139, #155

Escape hatch (silent for the rest of this session, e.g. when the project's old onboarding docs are present but the current session isn't running onboarding): set ONBOARDING_STOP_DENY=off in the environment."
exit 0
