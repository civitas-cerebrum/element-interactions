#!/bin/bash
# onboarding-report-write-guard.sh — gate mid-pipeline writes to the
# closing-phase deliverable.
#
# Hook    : PreToolUse:Write|Edit  (filters to tests/e2e/docs/onboarding-
#           report.md only)
# Mode    : DENY (mid-pipeline writes whose diff contains framing tokens
#           or explicit "Phase N partial|deferred" prose)
# State   : reads <repo>/tests/e2e/docs/onboarding-phase-ledger.json and
#           the early-stop authorisation sentinels
# Env     : ONBOARDING_REPORT_WRITE_GUARD=off → silent allow
#
# Rule
# ----
# tests/e2e/docs/onboarding-report.md is the closing-phase deliverable.
# It SHOULD be authored only when every preceding phase has greenlit;
# the report is the formal pipeline-complete artefact. Phase 1-6 work
# happens in *fragment* files under
# tests/e2e/docs/onboarding-report-fragments/<phase-N>.md, which the
# closing phase stitches into onboarding-report.md as the deliverable.
#
# Block conditions (all must hold):
#   1. Target path is tests/e2e/docs/onboarding-report.md
#   2. The phase ledger lacks the closing-phase greenlight (phase 7 !=
#      "greenlight")
#   3. `.claude/onboarding-stop-authorized` is absent
#   4. The diff content contains a kernel-rule framing-token (via
#      has_framing_token) OR explicit "Phase \d+ partial|deferred" prose
#
# When all four hold → DENY with a redirect to the fragment-files path.
#
# Allowed in mid-flight: writes whose diff is purely structural (filling
# in pre-allocated headings, linking to fragments, etc.) and contains no
# framing-tokens — the report skeleton can land before the closing phase,
# but its narrative claims about phase status cannot.
#
# Why
# ---
# The BookHive Run-2 incident wrote a partial onboarding-report.md
# declaring "Phase 5 — partial / Stage B deferred" prose under cover of
# "user explicit final-step instruction". Without this hook, the report
# was unguarded — only the schema-guard saw the underlying state-file
# write, and even that was bypassed via blocked-dispatch-failure stamp.
#
# Canonical reference
# -------------------
# skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
# skills/onboarding/references/phases-walkthrough.md (closing phase)
# hooks/lib/framing-tokens.sh
#
# Failure → action
# ----------------
# - Mid-pipeline + diff has framing-token + no auth sentinel              → DENY
# - Mid-pipeline + diff has "Phase N partial|deferred" prose + no auth    → DENY
# - All phases greenlight                                                 → silent allow
# - .claude/onboarding-stop-authorized present                            → silent allow
# - Diff has no framing-token / partial-prose signal                      → silent allow
# - File path is not tests/e2e/docs/onboarding-report.md                  → silent allow
# - Tool is not Write/Edit                                                → silent allow

set -euo pipefail

# Resolve jq: prefer the binary bundled with the hook install, fall back to
# system jq for in-repo testing before postinstall has run.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

# Shared framing-token detector. Loaded as a library — do NOT register
# the lib script in the manifest. has_framing_token returns 0 when the
# argument matches a kernel-rule loophole-language token.
# shellcheck source=lib/framing-tokens.sh
HOOK_LIB_DIR="$(dirname "${BASH_SOURCE[0]}")/lib"
if [ -f "$HOOK_LIB_DIR/framing-tokens.sh" ]; then
  source "$HOOK_LIB_DIR/framing-tokens.sh"
else
  has_framing_token() { return 1; }
fi

if [ "${ONBOARDING_REPORT_WRITE_GUARD:-on}" = "off" ]; then
  exit 0
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

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')

case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // ""')
case "$FILE_PATH" in
  *tests/e2e/docs/onboarding-report.md) ;;
  *) exit 0 ;;
esac

# Resolve repo root from the file path.
REPO_ROOT=""
DIR=$(dirname "$FILE_PATH")
if [ -d "$DIR" ]; then
  REPO_ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || true)
fi
if [ -z "$REPO_ROOT" ]; then
  # FILE_PATH is .../tests/e2e/docs/onboarding-report.md — strip 4 segments to
  # get repo root.
  REPO_ROOT="${FILE_PATH%/tests/e2e/docs/onboarding-report.md}"
fi
DOCS_DIR="$REPO_ROOT/tests/e2e/docs"

# --- escape hatch: explicit early-stop authorisation -----------------------
if [ -f "$REPO_ROOT/.claude/onboarding-stop-authorized" ] || \
   [ -f "$DOCS_DIR/.onboarding-stop-authorized" ]; then
  exit 0
fi

# --- pipeline phase-ledger evaluation --------------------------------------
LEDGER="$DOCS_DIR/onboarding-phase-ledger.json"
if [ ! -f "$LEDGER" ]; then
  exit 0
fi

PHASE_7_STATUS=$("$JQ" -r '.phases."7".status // "missing"' "$LEDGER" 2>/dev/null || echo "missing")
ANY_NOT_GREEN=$("$JQ" -r '
  [.phases // {} | to_entries[] | .value.status]
  | map(select(. != "greenlight"))
  | length
' "$LEDGER" 2>/dev/null || echo "0")

if [ "$ANY_NOT_GREEN" = "0" ] && [ "$PHASE_7_STATUS" = "greenlight" ]; then
  # Pipeline complete; report is the deliverable.
  exit 0
fi

# --- resolve diff content --------------------------------------------------
if [ "$TOOL_NAME" = "Write" ]; then
  DIFF_CONTENT=$(echo "$INPUT" | "$JQ" -r '.tool_input.content // ""')
elif [ "$TOOL_NAME" = "Edit" ]; then
  DIFF_CONTENT=$(echo "$INPUT" | "$JQ" -r '.tool_input.new_string // ""')
fi

# --- detection: framing tokens OR explicit partial-prose -------------------
HAS_FRAMING=0
HAS_PARTIAL_PROSE=0

if has_framing_token "$DIFF_CONTENT"; then
  HAS_FRAMING=1
fi

if printf '%s\n' "$DIFF_CONTENT" | grep -qE 'Phase[[:space:]]+[0-9]+[[:space:]]+(partial|deferred)'; then
  HAS_PARTIAL_PROSE=1
fi

if [ "$HAS_FRAMING" -eq 0 ] && [ "$HAS_PARTIAL_PROSE" -eq 0 ]; then
  # Structural / link-only edits proceed.
  exit 0
fi

SIGNALS=""
[ "$HAS_FRAMING" -eq 1 ]       && SIGNALS="${SIGNALS}
  - Diff content carries kernel-rule framing tokens"
[ "$HAS_PARTIAL_PROSE" -eq 1 ] && SIGNALS="${SIGNALS}
  - Diff contains explicit 'Phase N partial' or 'Phase N deferred' prose"

NOT_GREEN_SUMMARY=$("$JQ" -r '
  [.phases // {} | to_entries[] | select(.value.status != "greenlight")
   | "    - phase \(.key): \(.value.status // "missing")"
  ] | join("\n")
' "$LEDGER" 2>/dev/null || echo "    - <unable to read ledger>")

emit_deny "[BLOCKED] onboarding-report.md mid-pipeline write carries partial-status framing.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

  Option A — write the per-phase finding to a fragment file instead.
    Each phase's incremental output lives at:
      tests/e2e/docs/onboarding-report-fragments/<phase-N>.md
    The closing phase stitches every fragment into onboarding-report.md
    as the deliverable. Fragments are not gated by this hook — they're
    the legitimate channel for in-flight phase output.

  Option B — finish the pipeline.
    Continue dispatching the next pipeline phase. The front-load gate
    authorised the FULL pipeline ('tens of minutes to several hours').
    Auto-mode, session-length anxiety, and inferred user preference are
    NOT authorisation per skills/onboarding/SKILL.md §\"Hard rules —
    kernel-resident\".

  Option C — explicit early stop (only when truly needed).
    Create the authorisation sentinel and re-emit your write:
      mkdir -p .claude && touch .claude/onboarding-stop-authorized
    The hook honours the sentinel and allows the report to capture the
    partial state. The accompanying state-file partial flag will be
    surfaced in downstream consumers.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
File: $FILE_PATH
Tool: $TOOL_NAME

Phase ledger non-greenlight phases:
${NOT_GREEN_SUMMARY}

Diff signals matched:${SIGNALS}

Mid-pipeline writes to onboarding-report.md whose narrative claims phases
are 'partial' or 'deferred' under kernel-rule loophole framings are the
exact bypass surface from BookHive Run-2 — the report was authored under
cover of 'user's explicit final-step instruction re-prioritised' framing
that the kernel rule names verbatim as forbidden.

──────────────────────────────────────────────────────────────────
If 'I want to capture per-phase findings as I go' — read this:
──────────────────────────────────────────────────────────────────
That is what the fragment-files channel is for. Write each phase's
findings to tests/e2e/docs/onboarding-report-fragments/<phase-N>.md
during the run. The closing phase composes them into the deliverable
onboarding-report.md when the pipeline finishes (every preceding phase
greenlit). This guard does not gate fragment writes.

References:
  skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"
  skills/onboarding/references/phases-walkthrough.md
  hooks/lib/framing-tokens.sh
  hooks/benchmark-write-guard.sh (sibling — same pattern for the run scorecard)

Escape hatch: ONBOARDING_REPORT_WRITE_GUARD=off in the parent process,
or use the sentinel-file path documented above for session-persistent
stops."
exit 0
