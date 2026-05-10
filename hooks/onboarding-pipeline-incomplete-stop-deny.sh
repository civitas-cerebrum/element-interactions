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
#   - `tests/e2e/docs/coverage-expansion-state.json` exists with
#     `.status != "complete"` (the file persists with `status: complete`
#     after coverage-expansion finishes successfully — Phase 6/7 stops
#     must not be blocked by stale presence)
#   - `tests/e2e/docs/onboarding-phase-ledger.json` exists with phase 7
#     status != "greenlight"
#
# (Note: there is intentionally no signal that searches `onboarding-
# report.md` for a "Phase 7 complete" string — that marker doesn't
# exist in the report template, and the surrounding doctrine actively
# discourages "Phase N complete" framing. The phase ledger is the
# canonical source of truth for phase completion.)
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
# - All phases greenlit                                         → silent allow
# - Authorisation sentinel present                              → silent allow
# - stop_hook_active payload field == true                      → silent allow
# - Cap reached (suspect-class only)                            → silent allow (counter cleared)
# - Deterministic-class block                                   → BLOCK (cap does not apply)
# - No mid-pipeline signals                                     → silent allow
# - Anything else                                               → silent allow
#
# Real-dispatch arithmetic (post-BookHive-Run-2)
# ----------------------------------------------
# A "real" dispatch in dispatches[] satisfies all three:
#   - stage_a_cycles >= 1
#   - stage_b_cycles >= 1
#   - review_status ∈ {greenlight, blocked-cycle-stalled,
#                       blocked-cycle-exhausted}
# `blocked-dispatch-failure` does NOT count toward real-dispatch totals
# regardless of cycle counts. This forecloses the BookHive Run-2 bypass
# where 6 entries with `review_status: blocked-dispatch-failure` and
# `stage_b_cycles: 0` were stamped as "dispatched" to clear the count
# check. When real-dispatch-count drops below 50% of completedJourneys,
# the deny is escalated to deterministic kind.
#
# Block kinds
# -----------
# - deterministic: ledger / state file are mid-flight in a way the hook
#                  can prove from canonical fields (currentPass>=1 +
#                  ledger phase 7 not greenlight; or
#                  real-dispatch-count < 0.5 * completedJourneys with
#                  pass >= 1; or any phase >=5 in-progress in the
#                  ledger). These bypass the consecutive-block escape.
# - suspect      : looks mid-flight but the hook isn't sure (e.g.
#                  journey-map sentinel + ambiguous ledger). After CAP=3
#                  consecutive suspect blocks the hook silently allows
#                  the stop. This is the unrecoverable-hook-bug escape.

set -euo pipefail

# Resolve jq: prefer the binary bundled with the hook install, fall back to
# system jq for in-repo testing before postinstall has run.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

# Shared framing-token detector. See hooks/lib/framing-tokens.sh — single
# source of truth for kernel-rule loophole-language tokens.
# shellcheck source=lib/framing-tokens.sh
HOOK_LIB_DIR="$(dirname "${BASH_SOURCE[0]}")/lib"
if [ -f "$HOOK_LIB_DIR/framing-tokens.sh" ]; then
  source "$HOOK_LIB_DIR/framing-tokens.sh"
else
  has_framing_token() { return 1; }
fi

if [ "${ONBOARDING_STOP_DENY:-on}" = "off" ]; then
  exit 0
fi

emit_block() {
  "$JQ" -n --arg r "$1" '{
    "decision": "block",
    "reason": $r
  }'
}

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | "$JQ" -r '.session_id // empty' 2>/dev/null || echo "")
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
STOP_HOOK_ACTIVE=$(echo "$INPUT" | "$JQ" -r '.stop_hook_active // false' 2>/dev/null || echo "false")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")

DOCS_DIR="$REPO_ROOT/tests/e2e/docs"

# --- escape hatch: user-authorised stop sentinel (always wins) --------------
# Sentinel is honoured ONLY if its content does NOT match self-rationalisation
# framing tokens. The framing-tokens.sh library lists the exact phrases the
# kernel rule names verbatim ("context-budget exit #2", "pragmatic Pass 1",
# "paused mid-Phase-5", "agent-chosen deferral", etc.). An agent-authored
# sentinel that explains itself in those framings is, by construction, not
# user authorisation — it is the agent rationalising its own scope reduction.
# Defense in depth alongside hooks/harness-trusted-state-write-guard.sh,
# which denies the agent from creating the sentinel in the first place.
SENTINEL_FILE=""
if [ -f "$REPO_ROOT/.claude/onboarding-stop-authorized" ]; then
  SENTINEL_FILE="$REPO_ROOT/.claude/onboarding-stop-authorized"
elif [ -f "$DOCS_DIR/.onboarding-stop-authorized" ]; then
  SENTINEL_FILE="$DOCS_DIR/.onboarding-stop-authorized"
fi

if [ -n "$SENTINEL_FILE" ]; then
  SENTINEL_CONTENT=$(cat "$SENTINEL_FILE" 2>/dev/null || echo "")
  HOOK_LIB_DIR="$(dirname "${BASH_SOURCE[0]}")/lib"
  FRAMING_HIT=""
  if [ -f "$HOOK_LIB_DIR/framing-tokens.sh" ] && [ -n "$SENTINEL_CONTENT" ]; then
    # Source the framing-tokens lib (provides has_framing_token + matched_framing_tokens).
    # If the sentinel content matches any kernel-named framing, treat as agent-authored.
    # shellcheck source=lib/framing-tokens.sh
    source "$HOOK_LIB_DIR/framing-tokens.sh" 2>/dev/null || true
    if declare -F has_framing_token >/dev/null 2>&1; then
      if has_framing_token "$SENTINEL_CONTENT"; then
        FRAMING_HIT=$(matched_framing_tokens "$SENTINEL_CONTENT" 2>/dev/null | head -1)
        [ -z "$FRAMING_HIT" ] && FRAMING_HIT="(see hooks/lib/framing-tokens.sh — token catalogue)"
      fi
    fi
  fi

  if [ -z "$FRAMING_HIT" ]; then
    # Clear the consecutive-block counter so the next session starts fresh.
    [ -n "$SESSION_ID" ] && rm -f "/tmp/civitas-onboarding-stop-deny-${SESSION_ID}" 2>/dev/null || true
    exit 0
  fi

  # Framing hit — sentinel content reads as agent self-rationalisation rather
  # than user authorisation. Deny the stop and direct the agent to ASK the
  # user instead of rephrasing the sentinel.
  REASON="[BLOCKED] Stop sentinel exists at ${SENTINEL_FILE} but its content
contains a self-rationalisation framing token (\"${FRAMING_HIT}\"). The kernel
rule names this token verbatim — its presence indicates the sentinel was
authored by the agent, not by the user, and therefore is not valid
authorisation under skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\".

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────
ASK the user in conversation whether they authorise an early stop and
quote their reply VERBATIM in your next progress line. Do NOT rewrite
the sentinel yourself with different wording — the agent is not the
author of stop authorisations.

If the user does authorise the stop, they will create or update the
sentinel themselves out-of-band (touch / echo from their own shell).
The agent's role is to ask, not to write.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Sentinel file:        ${SENTINEL_FILE}
Framing token hit:    \"${FRAMING_HIT}\"  (from hooks/lib/framing-tokens.sh)
Sentinel content (first 240 chars):
$(echo "$SENTINEL_CONTENT" | head -c 240)

References:
  hooks/lib/framing-tokens.sh
  hooks/harness-trusted-state-write-guard.sh
  skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"
  skills/coverage-expansion/SKILL.md §\"Two valid exits\""
  emit_block "$REASON"
  exit 0
fi

# --- stop_hook_active: agent is already running because of a prior block ----
# Per the Claude Code Stop-hook contract, when the agent is already running
# because a previous Stop-hook returned `decision: block`, the harness sets
# `stop_hook_active: true` on subsequent Stop payloads. Honour that field —
# blocking again would create an unrecoverable loop independent of CAP.
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

# --- detect onboarding-pipeline-active context -----------------------------
MID_PIPELINE=0
SIGNALS=""

if [ -f "$DOCS_DIR/journey-map.md" ] && \
   head -1 "$DOCS_DIR/journey-map.md" 2>/dev/null | grep -q '<!-- journey-mapping:generated -->'; then
  MID_PIPELINE=1
  SIGNALS="${SIGNALS}
  - tests/e2e/docs/journey-map.md (sentinel present)"
fi

if [ -f "$DOCS_DIR/coverage-expansion-state.json" ]; then
  CE_STATUS=$("$JQ" -r '.status // ""' "$DOCS_DIR/coverage-expansion-state.json" 2>/dev/null || echo "")
  if [ "$CE_STATUS" != "complete" ]; then
    MID_PIPELINE=1
    SIGNALS="${SIGNALS}
  - tests/e2e/docs/coverage-expansion-state.json (status: ${CE_STATUS})"
  fi
fi

LEDGER_INCOMPLETE=0
if [ -f "$DOCS_DIR/onboarding-phase-ledger.json" ]; then
  PHASE_7_STATUS=$("$JQ" -r '.phases."7".status // "missing"' "$DOCS_DIR/onboarding-phase-ledger.json" 2>/dev/null || echo "missing")
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
  ANY_NOT_GREEN=$("$JQ" -r '
    [.phases // {} | to_entries[] | .value.status]
    | map(select(. != "greenlight"))
    | length
  ' "$DOCS_DIR/onboarding-phase-ledger.json" 2>/dev/null || echo "1")
  if [ "$ANY_NOT_GREEN" = "0" ]; then
    [ -n "$SESSION_ID" ] && rm -f "/tmp/civitas-onboarding-stop-deny-${SESSION_ID}" 2>/dev/null || true
    exit 0
  fi
fi

# --- block-kind determination -----------------------------------------------
# Two flavours of deny:
#   - deterministic: ledger / state file are mid-flight in a way the hook can
#                    *prove* from canonical fields. The agent that retries the
#                    Stop is asking the same question with the same data — no
#                    point allowing an escape after N retries because nothing
#                    will change without the agent doing actual pipeline work.
#                    Deterministic denies do NOT increment the consecutive-
#                    block counter; they keep blocking until the agent acts
#                    on the pipeline state (or sets the auth sentinel).
#   - suspect      : something looks mid-flight but the hook isn't fully sure
#                    (e.g. a journey-map sentinel + an ambiguous ledger). For
#                    these, the consecutive-block escape kicks in after CAP=3
#                    so a real hook bug can never lock the user out.
#
# The state file alone with currentPass>=1 + dispatches counts is canonical
# evidence the pipeline is mid-flight. The phase ledger with phase 7 not
# greenlit and phase >=5 in-progress is also canonical. Anything else is
# treated as suspect.
BLOCK_KIND="suspect"

# --- "real dispatch" definition --------------------------------------------
# Per the BookHive Run-2 bypass post-mortem, the dispatch-count signal must
# be tightened: a "real" dispatch is one that actually exercised both
# stages of the dual-stage protocol. Specifically:
#   - stage_a_cycles >= 1 AND
#   - stage_b_cycles >= 1 AND
#   - review_status ∈ {greenlight, blocked-cycle-stalled,
#                       blocked-cycle-exhausted}
#
# `blocked-dispatch-failure` does NOT count even when both cycle counts
# are positive (nothing prevents an agent from claiming '1' to clear a
# different gate). The schema-guard catches the framing-token version of
# this dishonesty at write time; this hook treats only true greenlights /
# stalled cycles / exhausted cycles as evidence of work.
#
# Known residual (M-2 of the BookHive Run-2 follow-up review): an
# orchestrator that fabricates `stage_a_cycles: 1`, `stage_b_cycles: 1`,
# `review_status: greenlight` for a journey that never had a Stage B
# reviewer dispatched would inflate this count without leaving any
# observable harness signal — there is no cross-validation against actual
# Agent tool calls visible at the harness layer. The framing-tokens
# detector on the same write provides defense-in-depth for the prose path
# (an orchestrator that fabricates clean fields rarely also writes clean
# prose), and the BENCHMARK / onboarding-report write-guards catch the
# downstream artifact write. Closing the field-fabrication path directly
# would require a per-Agent-dispatch ledger written by a PostToolUse hook;
# tracked as future work, not in scope for the BookHive Run-2 fix.
REAL_DISPATCH_COUNT=0
COMPLETED_JOURNEYS=0
if [ -f "$DOCS_DIR/coverage-expansion-state.json" ]; then
  REAL_DISPATCH_COUNT=$("$JQ" -r '
    [
      .passes // {} | to_entries[] | .value.dispatches // [] | .[]
      | select(
          (.stage_a_cycles // 0) >= 1
          and (.stage_b_cycles // 0) >= 1
          and ((.review_status // "")
                | IN("greenlight",
                     "blocked-cycle-stalled",
                     "blocked-cycle-exhausted"))
        )
    ] | length
  ' "$DOCS_DIR/coverage-expansion-state.json" 2>/dev/null || echo 0)
  case "$REAL_DISPATCH_COUNT" in ''|*[!0-9]*) REAL_DISPATCH_COUNT=0 ;; esac

  COMPLETED_JOURNEYS=$("$JQ" -r '(.completedJourneys // []) | length' "$DOCS_DIR/coverage-expansion-state.json" 2>/dev/null || echo 0)
  case "$COMPLETED_JOURNEYS" in ''|*[!0-9]*) COMPLETED_JOURNEYS=0 ;; esac
fi

# Mid-flight deny logic: if currentPass >= 1 AND real-dispatch-count is below
# 50% of completedJourneys.length, the dispatches[] count is being padded
# with non-real entries (typically `blocked-dispatch-failure` placeholders
# stamped after a single Stage A pass). Force a deterministic deny — the
# state file is asserting work that the cycle/review evidence doesn't
# corroborate.
HALF_COMPLETED=$((COMPLETED_JOURNEYS / 2))
if [ "$COMPLETED_JOURNEYS" -gt 0 ] && [ "$REAL_DISPATCH_COUNT" -lt "$HALF_COMPLETED" ]; then
  BLOCK_KIND="deterministic"
fi

# State-file ledger evidence + currentPass >= 1 → deterministic. The orch is
# explicitly mid-pass; no ambiguity from the hook side.
if [ -f "$DOCS_DIR/coverage-expansion-state.json" ]; then
  CP_VAL=$("$JQ" -r '.currentPass // 0' "$DOCS_DIR/coverage-expansion-state.json" 2>/dev/null || echo 0)
  case "$CP_VAL" in ''|*[!0-9]*) CP_VAL=0 ;; esac
  if [ "$CP_VAL" -ge 1 ] && [ "$LEDGER_INCOMPLETE" -eq 1 ]; then
    BLOCK_KIND="deterministic"
  fi
fi

# Phase ledger phase 7 not greenlight AND any phase >=5 in-progress →
# deterministic.
if [ "$LEDGER_INCOMPLETE" -eq 1 ] && [ -f "$DOCS_DIR/onboarding-phase-ledger.json" ]; then
  IN_PROG_LATE=$("$JQ" -r '
    [.phases // {} | to_entries[]
      | select(((.key | tonumber? // 0) >= 5) and .value.status == "in-progress")
    ] | length
  ' "$DOCS_DIR/onboarding-phase-ledger.json" 2>/dev/null || echo 0)
  case "$IN_PROG_LATE" in ''|*[!0-9]*) IN_PROG_LATE=0 ;; esac
  if [ "$IN_PROG_LATE" -gt 0 ]; then
    BLOCK_KIND="deterministic"
  fi
fi

# --- consecutive-block cap (suspect-only) ----------------------------------
# Deterministic denies bypass the cap entirely. The cap is a backstop for
# unrecoverable hook-bug loops, not for state-file-backed denies.
CAP=3
COUNTER=""
COUNT=0
if [ -n "$SESSION_ID" ]; then
  COUNTER="/tmp/civitas-onboarding-stop-deny-${SESSION_ID}"
  COUNT=$(cat "$COUNTER" 2>/dev/null || echo 0)
  case "$COUNT" in ''|*[!0-9]*) COUNT=0 ;; esac
fi

if [ "$BLOCK_KIND" = "suspect" ]; then
  if [ "$COUNT" -ge "$CAP" ]; then
    # Cap reached on suspect denies — allow stop, clear counter.
    [ -n "$COUNTER" ] && rm -f "$COUNTER" 2>/dev/null || true
    exit 0
  fi
  NEXT=$((COUNT + 1))
  [ -n "$COUNTER" ] && echo "$NEXT" > "$COUNTER" 2>/dev/null || true
else
  # Deterministic deny — counter is irrelevant. Surface the kind in the
  # message so reviewers know why the cap didn't kick in.
  NEXT="${COUNT:-0}/deterministic"
fi

# --- tailor redirect for the specific Phase-5 sub-cases ---------------------
PHASE5_REDIRECT=""
if [ -f "$DOCS_DIR/coverage-expansion-state.json" ]; then
  CURRENT_PASS=$("$JQ" -r '.currentPass // 0' "$DOCS_DIR/coverage-expansion-state.json" 2>/dev/null || echo 0)
  case "$CURRENT_PASS" in ''|*[!0-9]*) CURRENT_PASS=0 ;; esac

  # Count dispatches[] entries specifically under .passes[].dispatches.
  # The previous recursive walk (`.. | objects | select(has("journey"))`)
  # over-counted: `deferredJourneys[]` entries also have a `journey` key
  # (PR #173), and any future schema field with a `journey` member would
  # inflate the count.
  DISPATCH_COUNT=$("$JQ" -r '[.passes // {} | to_entries[] | .value.dispatches // [] | .[]] | length' "$DOCS_DIR/coverage-expansion-state.json" 2>/dev/null || echo 0)
  case "$DISPATCH_COUNT" in ''|*[!0-9]*) DISPATCH_COUNT=0 ;; esac

  # Count dispatches that lack a terminal review_status — i.e. genuinely
  # in-flight. Per `references/depth-mode-pipeline.md`, the per-pass
  # scratch files are deleted after each commit, so "no scratch files"
  # alone can't distinguish "auto-compact never attempted" from "all
  # dispatches landed cleanly". The auto-compact redirect should fire
  # only when at least one dispatch has no terminal-stamp.
  IN_FLIGHT=$("$JQ" -r '[.passes // {} | to_entries[] | .value.dispatches // [] | .[] | select(.review_status == null or .review_status == "")] | length' "$DOCS_DIR/coverage-expansion-state.json" 2>/dev/null || echo 0)
  case "$IN_FLIGHT" in ''|*[!0-9]*) IN_FLIGHT=0 ;; esac

  COMPACT_FILES=0
  if ls "$DOCS_DIR"/.coverage-expansion-cycle-*.json >/dev/null 2>&1; then
    COMPACT_FILES=1
  fi

  if [ "$CURRENT_PASS" -ge 1 ] && [ "$DISPATCH_COUNT" -eq 0 ]; then
    PHASE5_REDIRECT="Phase 5 is in-progress (currentPass=${CURRENT_PASS}) but ZERO dispatches recorded.

  Dispatch the first wave: one Agent call per journey under \`composer-j-<slug>:\` / \`probe-j-<slug>:\` description prefixes (parallel where the independence graph permits). Exit #2 (write state + stop) requires AT LEAST ONE dispatch in flight before it is invocable — the schema-guard hook also denies state-file writes that claim mid-pass with empty dispatches[]."
  elif [ "$DISPATCH_COUNT" -gt 0 ] && [ "$IN_FLIGHT" -gt 0 ] && [ "$COMPACT_FILES" -eq 0 ]; then
    PHASE5_REDIRECT="Phase 5 has ${IN_FLIGHT} in-flight dispatch(es) (review_status not yet stamped) and NO auto-compact attempted.

  Budget exhaustion is not a reason to stop — it's a reason to auto-compact (per coverage-expansion §\"Auto-compaction between passes\"). Persist in-flight Stage A returns to \`tests/e2e/docs/.coverage-expansion-cycle-<slug>-cycle-<N>.json\` scratch files, write the state file with all current dispatches[] populated, emit the line \`[coverage-expansion] context approaching budget — auto-compacting and resuming from state file\`, then invoke \`/compact\`. The post-compact turn resumes by reading the state file."
  fi
fi

# --- compose and emit ------------------------------------------------------
DEFAULT_REDIRECT="Continue dispatching the next pipeline phase. The front-load gate authorised the full pipeline (\"tens of minutes to several hours\"); auto-mode, session-length anxiety, and inferred user preference are explicitly NOT authorisation per skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"."

# Format the block-attempt counter line based on kind.
if [ "$BLOCK_KIND" = "deterministic" ]; then
  COUNTER_LINE="Block kind: deterministic (state file / phase ledger evidence). The 3-strike auto-allow does NOT apply — only suspect-class denies (where the hook isn't sure the pipeline is mid-flight) escalate after 3 attempts."
else
  COUNTER_LINE="Block attempt: ${NEXT}/${CAP} (suspect-class). After ${CAP} consecutive suspect blocks the hook silently allows the stop so a user can always escape a hook-bug-driven deny loop. Deterministic denies bypass this cap."
fi

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
Real dispatches (stage_a>=1 + stage_b>=1 + greenlight/stalled/exhausted): ${REAL_DISPATCH_COUNT}
Completed journeys claimed: ${COMPLETED_JOURNEYS}

${COUNTER_LINE}

──────────────────────────────────────────────────────────────────
If 'I want to be transparent about session constraints' — read this:
──────────────────────────────────────────────────────────────────
Tone does not change the contract. A 'transparent' scope reduction is still a scope reduction; silent scope reduction dressed in candid language is still silent scope reduction. The framings the kernel rule names verbatim — 'pragmatic Pass 1', 'honest Pass 1 only', 'reduced scope given session constraints', 'the realistic depth-mode contract for this app is an evening run' — are exactly the patterns this hook is here to catch. The full token list lives at hooks/lib/framing-tokens.sh and now includes the BookHive Run-2 framings ('context-budget exit #2', 'Pass 1 first wave only', 'final-step instruction', 'partial pipeline delivered', 'agent-chosen deferral', etc.).

References:
  skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"
  skills/coverage-expansion/SKILL.md §\"Two valid exits\"
  skills/coverage-expansion/SKILL.md §\"Auto-compaction between passes\"
  hooks/lib/framing-tokens.sh
  Issues #139, #155

Escape hatch: set ONBOARDING_STOP_DENY=off in the parent process that launched Claude Code (env vars don't persist across hook invocations — each Stop fires a fresh process, so setting it inside the agent session won't take effect on the next Stop). Or use the sentinel-file path documented above for session-persistent stops."
exit 0
