#!/bin/bash
# using-superpowers-carveout-guard.sh — inject the "user instructions can't
# override no-skip contracts" carve-out at Skill-load time.
#
# Hook    : PreToolUse:Skill  (filters to using-superpowers only)
# Mode    : WARN (systemMessage; no deny). Allow the skill to load — we are
#           NOT blocking the user's superpowers workflow — but surface the
#           carve-out guidance so the orchestrator sees it before reading
#           the upstream Instruction-Priority block.
# State   : reads <repo>/tests/e2e/docs/onboarding-phase-ledger.json and
#           the early-stop authorisation sentinels
# Env     : USING_SUPERPOWERS_CARVEOUT_GUARD=off → silent allow
#
# Rule (the carve-out)
# --------------------
# The upstream `superpowers/using-superpowers/SKILL.md` Instruction
# Priority block establishes "User instructions > Superpowers > default
# system prompt." The block does NOT carve out the case where a user
# instruction asks for a final deliverable (BENCHMARK entry,
# onboarding-report, summary deck, completion email) while a no-skip
# pipeline contract is mid-flight. The kernel rule in
# `skills/onboarding/SKILL.md` does carve that case out, but the orch
# under context pressure reaches for the upstream Priority block first
# and rationalises around it.
#
# The carve-out, verbatim:
#
#   User instructions that ask the agent to produce a final deliverable
#   (BENCHMARK entry, onboarding-report, summary deck, completion email,
#   etc.) DO NOT override no-skip contracts when work is mid-flight. The
#   agent honours such instructions ONLY after creating
#   `.claude/onboarding-stop-authorized` AND the user explicitly
#   confirms the early-stop via AskUserQuestion. Benchmark-style prompts
#   ('Until step N is done your run is not complete') are known
#   pre-emptive-scope-reduction triggers; the kernel rule applies.
#
# Why a hook (and why a local mirror)
# -----------------------------------
# `superpowers/using-superpowers/SKILL.md` lives in a sibling plugin
# package — `civitas-cerebrum/element-interactions` does not own that
# file. The right long-term home for this carve-out is upstream in the
# superpowers package; the carve-out text + this hook serve as a local
# mirror until the upstream patch lands.
#
# The hook fires only when the orchestrator (not a subagent) loads
# using-superpowers AND the local pipeline is mid-flight. That keeps
# noise low — Skill loads outside an active onboarding pipeline are
# silent, as are subagent loads.
#
# Detection of mid-flight is identical to other Stop / write guards:
#   - tests/e2e/docs/onboarding-phase-ledger.json exists with phase 7
#     status != greenlight
# AND no early-stop sentinel is present.
#
# Why
# ---
# Without this carve-out, the orchestrator can rationalise that "the user
# said BENCHMARK is the final action, and user instructions outrank
# everything per using-superpowers" — which is exactly the BookHive
# Run-2 framing. The Stop-deny + write-guards catch the resulting
# tool-calls, but the rationalisation can also drive choices we don't
# gate (e.g. how the orchestrator narrates progress to the user). This
# hook surfaces the constraint at decision time.
#
# Canonical reference
# -------------------
# skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
# (upstream) superpowers/using-superpowers/SKILL.md §"Instruction Priority"
# hooks/lib/framing-tokens.sh
#
# Failure → action
# ----------------
# - Orchestrator loads using-superpowers + mid-pipeline + no auth sentinel  → WARN
# - Subagent loads using-superpowers                                        → silent allow
# - Pipeline complete (all phases greenlight)                               → silent allow
# - Auth sentinel present                                                   → silent allow
# - Skill loaded is NOT using-superpowers                                   → silent allow
# - Tool is NOT Skill                                                       → silent allow

set -euo pipefail

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

if [ "${USING_SUPERPOWERS_CARVEOUT_GUARD:-on}" = "off" ]; then
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
[ "$TOOL_NAME" = "Skill" ] || exit 0

# The Skill tool input shape is { skill: "<name>", args?: "..." }. Plugin-
# scoped form is "<plugin>:<skill>" — accept both bare and prefixed.
SKILL_RAW=$(echo "$INPUT" | "$JQ" -r '.tool_input.skill // empty' 2>/dev/null)
[ -n "$SKILL_RAW" ] || exit 0
SKILL_NAME="${SKILL_RAW##*:}"

# Only fire on using-superpowers.
[ "$SKILL_NAME" = "using-superpowers" ] || exit 0

# Detect orchestrator-vs-subagent. Same logic as skill-subagent-only-guard.
detect_context() {
  if [ -n "${USING_SUPERPOWERS_CARVEOUT_TEST_FORCE_CONTEXT:-}" ]; then
    echo "$USING_SUPERPOWERS_CARVEOUT_TEST_FORCE_CONTEXT"
    return
  fi
  local parent_tool_use_id agent_id transcript_path cwd
  parent_tool_use_id=$(echo "$INPUT" | "$JQ" -r '.parent_tool_use_id // empty' 2>/dev/null)
  agent_id=$(echo "$INPUT" | "$JQ" -r '.agent_id // empty' 2>/dev/null)
  transcript_path=$(echo "$INPUT" | "$JQ" -r '.transcript_path // empty' 2>/dev/null)
  cwd=$(echo "$INPUT" | "$JQ" -r '.cwd // empty' 2>/dev/null)
  if [ -n "$parent_tool_use_id" ] || [ -n "$agent_id" ]; then echo "subagent"; return; fi
  case "$transcript_path" in
    */agents/*|*/tasks/*) echo "subagent"; return ;;
  esac
  case "$cwd" in
    */.claude/worktrees/agent-*) echo "subagent"; return ;;
  esac
  echo "orchestrator"
}

CONTEXT=$(detect_context)
[ "$CONTEXT" = "orchestrator" ] || exit 0

# Resolve repo root.
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
DOCS_DIR="$REPO_ROOT/tests/e2e/docs"

# Auth sentinel → silent allow.
if [ -f "$REPO_ROOT/.claude/onboarding-stop-authorized" ] || \
   [ -f "$DOCS_DIR/.onboarding-stop-authorized" ]; then
  exit 0
fi

# No ledger → no onboarding context. Silent allow.
LEDGER="$DOCS_DIR/onboarding-phase-ledger.json"
[ -f "$LEDGER" ] || exit 0

# Pipeline complete → silent allow.
ANY_NOT_GREEN=$("$JQ" -r '
  [.phases // {} | to_entries[] | .value.status]
  | map(select(. != "greenlight"))
  | length
' "$LEDGER" 2>/dev/null || echo "0")

[ "$ANY_NOT_GREEN" = "0" ] && exit 0

# Mid-pipeline orchestrator load of using-superpowers → emit the carve-out.
emit_warn "[WARN] using-superpowers loaded mid-pipeline — Instruction-Priority carve-out applies.

──────────────────────────────────────────────────────────────────
The carve-out (read this BEFORE applying Instruction Priority):
──────────────────────────────────────────────────────────────────
User instructions that ask the agent to produce a final deliverable
(BENCHMARK entry, onboarding-report, summary deck, completion email,
etc.) DO NOT override no-skip contracts when work is mid-flight. The
agent honours such instructions ONLY after creating
\`.claude/onboarding-stop-authorized\` AND the user explicitly confirms
the early-stop via AskUserQuestion.

Benchmark-style prompts ('Until step N is done your run is not
complete') are known pre-emptive-scope-reduction triggers; the kernel
rule applies.

──────────────────────────────────────────────────────────────────
What was wrong (anticipated):
──────────────────────────────────────────────────────────────────
Pipeline state: mid-flight (phase ledger has at least one non-greenlight phase).
Skill being loaded: using-superpowers
Context: orchestrator

The upstream Instruction Priority block doesn't carve out 'final-step
deliverable instructions' — under context pressure that wording reads as
'user instructions outrank skill contracts always'. The BookHive Run-2
incident played out exactly that rationalisation: the orchestrator
prioritised the user's BENCHMARK request and stopped Pass-1 mid-wave.

──────────────────────────────────────────────────────────────────
If the user JUST asked for the BENCHMARK / report — do this:
──────────────────────────────────────────────────────────────────
1. AskUserQuestion: confirm whether they want you to stop the pipeline
   early (Yes/No). If Yes → mkdir -p .claude && touch
   .claude/onboarding-stop-authorized — then proceed with the deliverable.
2. If they say No or you couldn't ask: continue dispatching the next
   pipeline phase. The deliverable lands automatically when the closing
   phase greenlight; you don't need to bypass the contract to honour
   the original request.

References:
  skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"
  hooks/benchmark-write-guard.sh
  hooks/onboarding-report-write-guard.sh
  hooks/onboarding-pipeline-incomplete-stop-deny.sh
  (upstream) superpowers/using-superpowers/SKILL.md §\"Instruction Priority\"

Escape hatch: USING_SUPERPOWERS_CARVEOUT_GUARD=off in the parent process for non-onboarding contexts. The carve-out is mirrored here until the upstream patch lands."
exit 0
