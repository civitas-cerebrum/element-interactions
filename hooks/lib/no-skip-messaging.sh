#!/bin/bash
# no-skip-messaging.sh — single source of truth for the canonical no-skip
# contract block that every onboarding-pipeline hook must include in its
# deny / warn payload.
#
# Library  : sourced by other hooks; not registered in the manifest.
# Mode     : N/A (pure helper, no side effects)
# State    : none
# Env      : NO_SKIP_MESSAGING_SELFTEST=1 → echo the canonical block once
#            and exit
#
# Rationale
# ---------
# The Run-2 bypass post-mortem identified that several
# onboarding-pipeline hooks DENY/WARN payloads named the technical
# violation (schema gap, missing field, unauthorised dispatch shape) but
# didn't reference the no-skip contract that wraps the entire pipeline.
# Without that anchor, an orchestrator under context pressure can read
# the technical text, re-emit the same call with a slightly tweaked
# payload, and slip past — the contract surface was never made visible
# in the deny path.
#
# This library exposes `no_skip_messaging_block` which echos a four-line
# canonical block:
#   1. The "Pipeline phases cannot be skipped" headline.
#   2. The legitimate early-stop sentinel path.
#   3. The framings-not-authorisation reminder.
#   4. The pointer to skills/onboarding/SKILL.md §"Hard rules — kernel-
#      resident".
#
# Hooks consume it by interpolating the function output into their
# existing deny/warn payload (typically just before the References
# section). The block is ADDITIVE: hooks keep their existing technical
# detail (block reason, fix template, action redirect) and append the
# no-skip block.
#
# Canonical reference
# -------------------
# skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
#
# Usage
# -----
#   # shellcheck source=lib/no-skip-messaging.sh
#   source "$(dirname "$0")/lib/no-skip-messaging.sh"
#   ...
#   emit_deny "[BLOCKED] <existing technical headline>
#
#   ──────────────────────────────────────────────────────────────────
#   <existing technical detail / Do this instead / What was wrong>
#   ──────────────────────────────────────────────────────────────────
#
#   $(no_skip_messaging_block)
#
#   References:
#     ..."

# no_skip_messaging_block
# Print the canonical no-skip contract block. No arguments. Always
# emits the same text — this is the contract surface, not a template.
no_skip_messaging_block() {
  cat <<'NO_SKIP_BLOCK_EOF'
──────────────────────────────────────────────────────────────────
No-skip onboarding contract — Pipeline phases cannot be skipped:
──────────────────────────────────────────────────────────────────
The onboarding pipeline runs to one of two valid exits — full
greenlight (all phases 1–7), or an explicit user-authorised early
stop (touch `.claude/onboarding-stop-authorized`). Pipeline phases
cannot be skipped under any other framing.

  "honest partial reporting"           — NOT authorisation.
  "pragmatic Pass N"                   — NOT authorisation.
  "context-budget exit #2 after ..."   — NOT authorisation.
  "user's final-step instruction"      — NOT authorisation.
  "BENCHMARK is the deliverable so I should write it now"
                                       — NOT authorisation.

The legitimate early-stop path:
  mkdir -p .claude && touch .claude/onboarding-stop-authorized

Reference: skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
NO_SKIP_BLOCK_EOF
}

# --- self-test ----------------------------------------------------------------
# Run as `NO_SKIP_MESSAGING_SELFTEST=1 bash hooks/lib/no-skip-messaging.sh`.
# Echoes the block once and exits 0 if the four required substrings are
# present, exits 1 otherwise. Used by 32-no-skip-messaging-coverage.sh.
if [ "${NO_SKIP_MESSAGING_SELFTEST:-0}" = "1" ]; then
  out=$(no_skip_messaging_block)
  ok=1
  for substr in \
      "Pipeline phases cannot be skipped" \
      ".claude/onboarding-stop-authorized" \
      "NOT authorisation" \
      "skills/onboarding/SKILL.md"; do
    if ! printf '%s' "$out" | grep -qF -- "$substr"; then
      echo "FAIL missing required substring: '$substr'"
      ok=0
    fi
  done
  if [ "$ok" = "1" ]; then
    echo "ok no_skip_messaging_block contains all 4 required substrings"
    exit 0
  fi
  exit 1
fi
