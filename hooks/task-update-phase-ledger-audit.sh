#!/bin/bash
# task-update-phase-ledger-audit.sh — soft warn when a TaskUpdate marks a
# Phase-N task complete that the harness ledger doesn't agree with.
#
# Hook    : PostToolUse:TaskUpdate (and the equivalent TodoWrite shape that
#           Claude Code's todo-tracker uses; the matcher accepts both)
# Mode    : WARN (systemMessage; never blocks). Soft signal only —
#           in-session task UI is cosmetic; this hook surfaces drift
#           between it and the harness's authoritative ledger.
# State   : reads <repo>/tests/e2e/docs/onboarding-phase-ledger.json
# Env     : TASK_UPDATE_PHASE_LEDGER_AUDIT=off → silent (no warn)
#
# Rule
# ----
# When a TaskUpdate / TodoWrite call marks a task whose subject / content
# matches `Phase \d+` (or `phase \d+`, case-insensitive) with status:
# completed (or `done`), check the phase ledger. If the matching phase is
# not at status "greenlight", emit a systemMessage warning so the operator
# sees the drift.
#
# The hook does NOT block — TaskCreate / TodoWrite has no harness
# integration in the BookHive Run-2 incident path; the in-session task
# UI was cosmetic dishonesty (gap 4 of the bypass punch list). A WARN is
# the right granularity: the orchestrator sees the message, the operator
# sees the message, but the workflow doesn't halt for a UI annotation.
#
# Why
# ---
# The BookHive Run-2 partial closed every TaskUpdate for phases 1-5 as
# `completed` while the phase ledger had no greenlight for several of
# those phases. From the user's perspective it looked like the
# orchestrator had checked everything off; the harness state told a
# different story. Surface the drift so future runs can't disguise
# unfinished work as done in the in-session UI.
#
# Detection of "Phase N task"
# ---------------------------
# A task is "Phase N" if its subject / content / activeForm contains
# `Phase \d+` (case-insensitive). The hook scans every common Task* /
# Todo* tool-input field shape:
#   - tool_input.todos[]: { content, status, activeForm }   ← TodoWrite
#   - tool_input.subject + tool_input.status                 ← TaskUpdate
#   - tool_input.task + tool_input.status                    ← alternate
#
# Canonical reference
# -------------------
# skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
# (no upstream — this is harness integration the orchestrator wired but
#  the BookHive Run-2 incident exposed as unbacked)
#
# Failure → action
# ----------------
# - Phase-N task marked completed AND ledger has phase-N != greenlight  → WARN
# - Phase-N task marked completed AND ledger phase-N == greenlight       → silent allow
# - No Phase-N task in the update                                        → silent allow
# - No phase ledger present                                              → silent allow
# - Tool is not TaskUpdate / TodoWrite / similar                         → silent allow

set -euo pipefail

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

if [ "${TASK_UPDATE_PHASE_LEDGER_AUDIT:-on}" = "off" ]; then
  exit 0
fi

emit_warn() {
  "$JQ" -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null)

# Accept several plausible tool-name shapes — the in-session task UI varies
# by client (Claude Code uses TodoWrite; some host harnesses expose
# TaskUpdate / TaskCreate).
case "$TOOL_NAME" in
  TodoWrite|TaskUpdate|TaskCreate|Task) ;;
  *) exit 0 ;;
esac

# Resolve repo root.
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
DOCS_DIR="$REPO_ROOT/tests/e2e/docs"
LEDGER="$DOCS_DIR/onboarding-phase-ledger.json"

[ -f "$LEDGER" ] || exit 0

# Extract every (phase_number, status) pair the update is marking. We
# normalise across the three input shapes and emit JSONL lines like:
#   {"phase":5,"status":"completed","label":"Phase 5 — coverage expansion"}
# Then we filter to status ∈ {completed, done}.
EXTRACTED=$(echo "$INPUT" | "$JQ" -c '
  def normalize_status:
    if . == null then ""
    elif (. | type) == "string" then (. | ascii_downcase)
    else "" end;

  def extract_phase($text):
    if ($text == null or ($text | type) != "string") then null
    else
      ($text | match("phase\\s+([0-9]+)"; "i") // empty)
      | if (.captures? // []) == [] then null
        else (.captures[0].string | tonumber) end
    end;

  # TodoWrite-style: tool_input.todos[]
  ([(.tool_input.todos // []) | .[]
    | { phase: (extract_phase(.content // .subject // .activeForm // "")),
        status: (.status | normalize_status),
        label: (.content // .subject // .activeForm // "") }]
   +
   # TaskUpdate / Task: tool_input.subject + tool_input.status
   [(if .tool_input.subject != null then
       { phase: (extract_phase(.tool_input.subject)),
         status: (.tool_input.status | normalize_status),
         label: .tool_input.subject }
     else empty end)]
   +
   [(if .tool_input.task != null then
       { phase: (extract_phase(.tool_input.task)),
         status: (.tool_input.status | normalize_status),
         label: .tool_input.task }
     else empty end)])
  | map(select(.phase != null and (.status == "completed" or .status == "done")))
' 2>/dev/null || echo "[]")

# If nothing extracted (no Phase-N task being marked completed), bail.
COUNT=$(echo "$EXTRACTED" | "$JQ" -r 'length' 2>/dev/null || echo 0)
[ "$COUNT" -gt 0 ] || exit 0

# For each phase mention, look up the ledger status. Collect mismatches.
DRIFTS=$(echo "$EXTRACTED" | "$JQ" -c --slurpfile ledger "$LEDGER" '
  . as $tasks
  | $ledger[0].phases as $phases
  | [ $tasks[]
      | . as $t
      | ($phases[($t.phase | tostring)].status // "missing") as $ls
      | select($ls != "greenlight")
      | { phase: $t.phase, taskStatus: $t.status, label: $t.label, ledgerStatus: $ls }
    ]
' 2>/dev/null || echo "[]")

DRIFT_COUNT=$(echo "$DRIFTS" | "$JQ" -r 'length' 2>/dev/null || echo 0)
[ "$DRIFT_COUNT" -gt 0 ] || exit 0

DRIFT_LIST=$(echo "$DRIFTS" | "$JQ" -r '
  .[] | "    - Phase \(.phase): task says \"\(.taskStatus)\" but ledger says \"\(.ledgerStatus)\" — \(.label)"
' 2>/dev/null)

emit_warn "[WARN] TaskUpdate / TodoWrite marked Phase-N complete but the phase ledger doesn't agree.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
The phase ledger at tests/e2e/docs/onboarding-phase-ledger.json is the
authoritative source of truth for phase completion. The in-session
task UI is cosmetic — closing a Phase-N task without the matching
ledger greenlight produces drift between what the operator sees in
their task list and what the harness will accept as 'done'.

Drift detected:
${DRIFT_LIST}

──────────────────────────────────────────────────────────────────
Action:
──────────────────────────────────────────────────────────────────
Verify state before stopping. Either:
  - Run the phase-validator dispatch for the phase-in-question (the
    canonical 'flip the ledger to greenlight' path), then re-emit the
    task close. The validator is what writes the ledger entry; the
    task UI is downstream.
  - Reopen the task to its actual state if the ledger is correct and
    the close was premature.

──────────────────────────────────────────────────────────────────
If 'I closed the task as a progress marker, not a completion claim'
— read this:
──────────────────────────────────────────────────────────────────
Use status 'in-progress' or content 'Phase N (partial — Stage A only)'
instead of 'completed' for progress markers. The semantic distinction
matters because every downstream tool that scans task state for
'phase N done' will read the same surface and apply the same logic.

References:
  skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"
  hooks/onboarding-pipeline-incomplete-stop-deny.sh
  hooks/phase-validator-dispatch-required.sh

Escape hatch: TASK_UPDATE_PHASE_LEDGER_AUDIT=off in the parent process if
your project uses a different phase-ledger path or the in-session task UI
is unrelated to onboarding."
exit 0
