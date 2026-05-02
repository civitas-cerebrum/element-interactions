#!/bin/bash
# coverage-expansion-orchestrator-cli-block.sh — orchestrator-side playwright-cli gate
#
# Hook    : PreToolUse:Bash  (filters to `playwright-cli` invocations)
# Mode    : DENY when active coverage-expansion run + invocation isn't from
#           a registered in-flight subagent
# State   : reads tests/e2e/docs/coverage-expansion-state.json (active-run signal)
#           + tests/e2e/docs/.in-flight-composers.json (in-flight registry)
# Env     : none
#
# Rule
# ----
# During an active coverage-expansion run (state file present), every
# `playwright-cli` invocation that uses `-s=<slug>` MUST carry a slug that
# maps to a currently-registered in-flight composer/probe entry. Bare
# session-agnostic subcommands (close-all, kill-all, list, install-browser,
# --help, --version) ALLOW silently — the orchestrator legitimately runs
# `close-all` at pass exit as belt-and-suspenders cleanup.
#
# Why
# ---
# `coverage-expansion` SKILL.md §"Hard rules — kernel-resident" (line 432)
# already prohibits orchestrator-side `playwright-cli` use during an active
# run, but the rule was prose-only — nothing stopped the orchestrator from
# running `playwright-cli -s=anything open https://...` and pulling DOM
# into context. Raw DOM/CLI output absorbs into the orchestrator's
# transcript and is the exact pollution class the §2.0 handover envelope
# and Q2.2 spillover (#145) are trying to close.
#
# With the in-flight registry from #144 (composer/probe slugs registered
# at dispatch time), we can mechanically distinguish a legitimate subagent
# CLI session (slug in registry) from an orchestrator-direct invocation
# (slug missing or not in registry). This hook makes the prose rule
# enforceable.
#
# Canonical reference
# -------------------
# skills/coverage-expansion/SKILL.md §"Hard rules — kernel-resident"
#   (orchestrator-direct playwright-cli prohibition)
# skills/element-interactions/references/playwright-cli-protocol.md §3.1
# hooks/coverage-expansion-direct-compose-block.sh — sibling hook that
#   uses the same in-flight registry to gate spec writes; this hook
#   mirrors that pattern for CLI invocations.
#
# Failure → action
# ----------------
# - No active coverage-expansion run (state file absent)         → silent allow
#   (Stage 1-4 / companion-mode / failure-diagnosis / journey-mapping
#    standalone all use playwright-cli legitimately)
# - Session-agnostic subcommand (close-all / list / etc.)        → silent allow
# - Slug in registry (legitimate subagent CLI session)           → silent allow
# - Slug missing or not in registry (orchestrator-direct)        → DENY
# - Mention of `playwright-cli` inside echo / JSON string        → silent allow
#   (filter regex anchored to actual invocation, same as
#    playwright-cli-isolation-guard.sh)

set -euo pipefail

# --- helpers ---
emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Filter: only fire when playwright-cli is actually being INVOKED as a command,
# not just mentioned inside a string argument (echo, error message, JSON literal).
# Same anchoring approach as playwright-cli-isolation-guard.sh.
RUNNERS='(npx|bunx|pnpm[[:space:]]+exec|yarn[[:space:]]+exec)[[:space:]]+'
SEP='(^|[;|][[:space:]]*|&&[[:space:]]*|\|\|[[:space:]]*)'
if ! echo "$CMD" | grep -qE "${SEP}(${RUNNERS})?playwright-cli[[:space:]]"; then
  exit 0
fi

# Resolve repo root.
CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
STATE_FILE="$REPO_ROOT/tests/e2e/docs/coverage-expansion-state.json"
IN_FLIGHT="$REPO_ROOT/tests/e2e/docs/.in-flight-composers.json"

# Active-run gate: only fire during coverage-expansion. Without the state
# file, the run is Stage 1-4 / companion-mode / failure-diagnosis /
# journey-mapping standalone — orchestrator-side CLI is legitimate.
[ ! -f "$STATE_FILE" ] && exit 0

# Allow session-agnostic subcommands. These run without `-s=` by design.
# The orchestrator legitimately runs `close-all` at pass exit (skill prose:
# "the parent runs close-all once the pass completes").
if echo "$CMD" | grep -qE 'playwright-cli[[:space:]]+(install-browser|close-all|kill-all|list|list-sessions|sessions|--help|-h|--version|-v)([[:space:]]|$)'; then
  exit 0
fi

# Truncate command for inclusion in error messages.
CMD_PREVIEW="$CMD"
if [ ${#CMD} -gt 160 ]; then
  CMD_PREVIEW="${CMD:0:160}..."
fi

# Extract slug from either form: `-s=<slug>` or `-s <slug>`.
SLUG=$(echo "$CMD" | grep -oE -- '-s=[A-Za-z0-9_.-]+' | head -1 | sed 's/^-s=//' || true)
if [ -z "$SLUG" ]; then
  SLUG=$(echo "$CMD" | grep -oE -- '-s[[:space:]]+[A-Za-z0-9_.-]+' | head -1 | sed -E 's/^-s[[:space:]]+//' || true)
fi

# No -s= flag entirely. The isolation-guard catches this case as a separate
# DENY (missing slug). Defer to it — silent allow here so we don't double-fire.
if [ -z "$SLUG" ]; then
  exit 0
fi

# Strip role prefix to get the journey/scope slug. Matches what the
# dispatch-guard registers under `.composers["<j-slug>"]` /
# `.composers["<sj-slug>"]`. Roles outside composer/probe (reviewer, phase1,
# stage2, cleanup, etc.) don't write to the registry by design — but they
# may run playwright-cli legitimately under their own role-prefixed slug.
# We allow those by checking for any role prefix and skipping the registry
# check when the role isn't composer/probe (those subagents aren't
# orchestrator-direct; the dispatch path itself authorised them).
ROLE=$(echo "$SLUG" | grep -oE '^(composer|reviewer|probe|phase1|phase2|stage2|cleanup|companion|fd)' || echo "")

if [ -z "$ROLE" ]; then
  # Slug has no recognised role prefix — playwright-cli-isolation-guard
  # will DENY it. Silent allow here to avoid double-fire.
  exit 0
fi

# Reviewer / phase1 / phase2 / stage2 / cleanup / companion / fd are not
# tracked in the registry (the registry only carries composer + probe per
# dispatch-guard scope). Those subagents are dispatched through the
# Agent-tool path, which the dispatch-guard already validates. Allow CLI
# use under those role prefixes.
case "$ROLE" in
  reviewer|phase1|phase2|stage2|cleanup|companion|fd) exit 0 ;;
esac

# composer- or probe-: must map to an in-flight slug in the registry.
# Extract the journey/sub-journey slug from the role-prefixed CLI slug.
# CLI slug format: <role>-<j|sj>-<slug>[-<pass>[-c<cycle>]]
#
# Two-pass extraction so we work on macOS BSD sed (no lazy `+?` quantifier):
#   1. Strip role prefix: composer-j-checkout-1-c1 → j-checkout-1-c1
#   2. Strip pass[-cycle] suffix anchored to end:
#        j-checkout-1-c1     → j-checkout   (composer)
#        j-payment-3ds-1-c1  → j-payment-3ds (composer; journey slug with digits)
#        j-foo-4             → j-foo        (probe)
SLUG_KEY=$(echo "$SLUG" | sed -E 's/^(composer|probe)-//' | sed -E 's/-[0-9]+(-c[0-9]+)?$//')

# Defensive: if extraction didn't yield a j-/sj- prefix, treat as no-match.
if ! echo "$SLUG_KEY" | grep -qE '^(j|sj)-[a-z0-9-]+$'; then
  SLUG_KEY=""
fi

IN_FLIGHT_HIT="false"
if [ -n "$SLUG_KEY" ] && [ -f "$IN_FLIGHT" ]; then
  if jq -e --arg s "$SLUG_KEY" '.composers[$s] // empty' "$IN_FLIGHT" >/dev/null 2>&1; then
    # Optional TTL freshness check — entries older than 30 min may be
    # stale (subagent crashed without deregistering). Same logic as
    # coverage-expansion-direct-compose-block.sh.
    STARTED_AT=$(jq -r --arg s "$SLUG_KEY" '.composers[$s].started_at // ""' "$IN_FLIGHT")
    if [ -n "$STARTED_AT" ]; then
      NOW_EPOCH=$(date -u +%s)
      THEN_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$STARTED_AT" +%s 2>/dev/null || date -u -d "$STARTED_AT" +%s 2>/dev/null || echo "0")
      if [ "$THEN_EPOCH" != "0" ]; then
        AGE=$((NOW_EPOCH - THEN_EPOCH))
        if [ "$AGE" -le 1800 ]; then
          IN_FLIGHT_HIT="true"
        fi
      fi
    fi
  fi
fi

if [ "$IN_FLIGHT_HIT" = "true" ]; then
  # Legitimate subagent CLI session — silent allow.
  exit 0
fi

# Slug is composer-/probe-prefixed but doesn't map to any in-flight entry.
# This is orchestrator-direct (or stale) — DENY.
emit_deny "[BLOCKED] Orchestrator-direct \`playwright-cli\` use during active coverage-expansion run.

Command: $CMD_PREVIEW
Slug:    -s=$SLUG  (extracted journey-key: '${SLUG_KEY:-<unrecognised>}')

The slug doesn't map to any registered in-flight composer/probe dispatch in tests/e2e/docs/.in-flight-composers.json. During an active coverage-expansion run, only dispatched subagents may run \`playwright-cli\` — orchestrator-direct CLI absorbs DOM/snapshot output into the orchestrator's context, the exact pollution class the §2.0 handover envelope is trying to close.

Do this instead — dispatch a subagent for whatever you were going to inspect:

  stage2-<scenario>:        element inspection (page-repository entries, selector probes)
  probe-j-<slug>:           adversarial probing on a journey
  composer-j-<slug>:        Stage A spec composition for a journey
  reviewer-j-<slug>:        Stage B reviewer (uses its own CLI session)
  cleanup-<scope>:          ledger / cleanup work

The subagent's CLI session is OS-isolated by construction and its return is shape-validated by hooks/subagent-return-schema-guard.sh.

If you need a one-off page check OUTSIDE coverage-expansion, that's allowed — this hook only fires when tests/e2e/docs/coverage-expansion-state.json is present.

References:
  skills/coverage-expansion/SKILL.md §\"Hard rules — kernel-resident\"
  skills/element-interactions/references/playwright-cli-protocol.md §3.1
  hooks/coverage-expansion-direct-compose-block.sh (sibling gate for spec writes)"

exit 0
