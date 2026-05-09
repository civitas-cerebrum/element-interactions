#!/bin/bash
# benchmark-write-guard.sh — gate Run-N entries / Verdict lines in BENCHMARK.md
#
# Hook    : PreToolUse:Write|Edit  (filters to BENCHMARK.md case-insensitively,
#           any directory)
# Mode    : DENY (when a Run-N section header, Verdict line, BETTER/WORSE/
#           MIXED/SAME verdict-shaped tag, or any kernel-rule framing-token
#           is being added mid-pipeline)
# State   : reads <repo>/tests/e2e/docs/onboarding-phase-ledger.json and the
#           early-stop authorisation sentinels
# Env     : BENCHMARK_WRITE_GUARD=off → silent allow (manual escape hatch)
#
# Rule
# ----
# BENCHMARK.md is the user-facing scorecard for one onboarding run. A
# Run-N entry / Verdict line MUST NOT be written while the pipeline is
# mid-flight (any phase in the onboarding-phase-ledger != "greenlight").
# Mid-pipeline Run-N writes are the exact bypass surface from BookHive
# Run-2: the orchestrator wrote a `Run 2 — partial` section + `Verdict:
# MIXED` after dispatching only Pass-1's first wave, framing it as
# "honest" and citing the user's final-step instruction as
# authorisation.
#
# Block conditions (all must hold):
#   1. Target path matches BENCHMARK.md (case-insensitive)
#   2. The proposed content adds at least one of:
#      - a `## Run \d+` section header
#      - a `### Verdict` heading
#      - a literal verdict tag (BETTER/WORSE/MIXED/SAME) in a verdict-
#        shaped context (`Verdict:` line OR right after `### Verdict`)
#      OR contains a kernel-rule framing-token anywhere
#   3. The phase ledger does NOT show all known phases as `greenlight`
#   4. `.claude/onboarding-stop-authorized` is absent
#
# When all four hold → DENY with a redirect explaining the early-stop
# authorisation path.
#
# Free-form edits (typo fixes in existing entries, prose cleanup) are
# allowed: the diff is structurally inspected — only Run-N / Verdict
# additions trip the gate, not edits that don't add those structures.
#
# Why
# ---
# Without this gate, BENCHMARK.md is unprotected by any harness check.
# The Stop-deny hook caught the BookHive Run-2 stop, but only because
# of the dispatches-count signal — the BENCHMARK.md write itself had no
# guard. Future runs that adjust their state file slightly to avoid
# the count check would still be able to commit a partial Run-N entry
# under cover of "user instruction said BENCHMARK is the final action".
#
# Canonical reference
# -------------------
# skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
# skills/coverage-expansion/SKILL.md §"Two valid exits"
# hooks/lib/framing-tokens.sh
#
# Failure → action
# ----------------
# - Mid-pipeline + Run-N / Verdict structural addition + no auth sentinel  → DENY
# - Mid-pipeline + content carries framing-token + no auth sentinel        → DENY
# - All phases greenlight                                                  → silent allow
# - .claude/onboarding-stop-authorized present                             → silent allow
# - Diff has no Run-N / Verdict / framing-token signal                     → silent allow
# - File path is not BENCHMARK.md                                          → silent allow
# - Not a Write/Edit tool                                                  → silent allow

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

if [ "${BENCHMARK_WRITE_GUARD:-on}" = "off" ]; then
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

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')

case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // ""')

# Match BENCHMARK.md (case-insensitive) at any path depth.
case "$(basename "$FILE_PATH" 2>/dev/null)" in
  BENCHMARK.md|benchmark.md|Benchmark.md|BenchMark.md) ;;
  *) exit 0 ;;
esac

# Resolve repo root from the file path (walk up to a git root, fall back
# to the parent dir if no git context). For tests, we accept whatever
# tests/e2e/docs path is alongside the file's repo.
REPO_ROOT=""
DIR=$(dirname "$FILE_PATH")
if [ -d "$DIR" ]; then
  REPO_ROOT=$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || true)
fi
[ -z "$REPO_ROOT" ] && REPO_ROOT=$(dirname "$FILE_PATH")
DOCS_DIR="$REPO_ROOT/tests/e2e/docs"

# --- escape hatch: explicit early-stop authorisation -----------------------
if [ -f "$REPO_ROOT/.claude/onboarding-stop-authorized" ] || \
   [ -f "$DOCS_DIR/.onboarding-stop-authorized" ]; then
  exit 0
fi

# --- pipeline phase-ledger evaluation --------------------------------------
# All seven canonical onboarding phases (1–7) must be present AND
# "greenlight" for the write to be considered post-pipeline. Any other
# state (in-progress, missing-key, blocked) keeps the gate engaged.
#
# Why explicit phase-7 lookup:
# the BookHive Run-2 bypass ledger had only phases 1–4 written; phases
# 5–7 were absent entirely. A naive "iterate present keys, check none
# != greenlight" lets the bypass slide because absent keys aren't
# inspected. Treating absent phase 7 as not-greenlight closes that hole
# (matches the onboarding-pipeline-incomplete-stop-deny.sh logic).
LEDGER="$DOCS_DIR/onboarding-phase-ledger.json"
if [ ! -f "$LEDGER" ]; then
  # No ledger → no onboarding context detected. Silent allow — this guard
  # only engages when a real pipeline is in flight.
  exit 0
fi

PHASE_7_STATUS=$("$JQ" -r '.phases."7".status // "missing"' "$LEDGER" 2>/dev/null || echo "missing")
ANY_NOT_GREEN=$("$JQ" -r '
  [.phases // {} | to_entries[] | .value.status]
  | map(select(. != "greenlight"))
  | length
' "$LEDGER" 2>/dev/null || echo "0")

if [ "$ANY_NOT_GREEN" = "0" ] && [ "$PHASE_7_STATUS" = "greenlight" ]; then
  # All present phases are greenlight AND phase 7 is explicitly greenlight
  # → pipeline complete; BENCHMARK writes are exactly the deliverable.
  exit 0
fi

# --- resolve target diff content -------------------------------------------
if [ "$TOOL_NAME" = "Write" ]; then
  DIFF_CONTENT=$(echo "$INPUT" | "$JQ" -r '.tool_input.content // ""')
elif [ "$TOOL_NAME" = "Edit" ]; then
  # For Edit, we only see new_string — the diff. That's the right surface:
  # we want to detect whether *added* prose contains the Run-N / Verdict /
  # framing-token signals. Edits to existing prose leave new_string unchanged
  # for the unchanged region.
  DIFF_CONTENT=$(echo "$INPUT" | "$JQ" -r '.tool_input.new_string // ""')
fi

# --- structural detection: Run-N / Verdict / verdict-tag --------------------
ADDS_RUN_HEADER=0
ADDS_VERDICT=0
HAS_VERDICT_TAG=0

if printf '%s\n' "$DIFF_CONTENT" | grep -qE '^##[[:space:]]+Run[[:space:]]+[0-9]+'; then
  ADDS_RUN_HEADER=1
fi
if printf '%s\n' "$DIFF_CONTENT" | grep -qE '^###[[:space:]]+Verdict|^Verdict:'; then
  ADDS_VERDICT=1
fi
if printf '%s\n' "$DIFF_CONTENT" | grep -qE '(Verdict:|^###[[:space:]]+Verdict)' && \
   printf '%s\n' "$DIFF_CONTENT" | grep -qE '\b(BETTER|WORSE|MIXED|SAME)\b'; then
  HAS_VERDICT_TAG=1
fi

HAS_FRAMING=0
if has_framing_token "$DIFF_CONTENT"; then
  HAS_FRAMING=1
fi

# Quick exit: nothing structural and no framing → silent allow (typo
# fixes, link adjustments, etc.).
if [ "$ADDS_RUN_HEADER" -eq 0 ] && \
   [ "$ADDS_VERDICT" -eq 0 ] && \
   [ "$HAS_VERDICT_TAG" -eq 0 ] && \
   [ "$HAS_FRAMING" -eq 0 ]; then
  exit 0
fi

# --- assemble the matched-signals breakdown for the deny payload -----------
SIGNALS=""
[ "$ADDS_RUN_HEADER" -eq 1 ] && SIGNALS="${SIGNALS}
  - Adds '## Run N' section header"
[ "$ADDS_VERDICT" -eq 1 ]     && SIGNALS="${SIGNALS}
  - Adds Verdict heading or 'Verdict:' line"
[ "$HAS_VERDICT_TAG" -eq 1 ]  && SIGNALS="${SIGNALS}
  - Contains BETTER/WORSE/MIXED/SAME verdict tag"
[ "$HAS_FRAMING" -eq 1 ]      && SIGNALS="${SIGNALS}
  - Diff content carries kernel-rule framing tokens"

NOT_GREEN_SUMMARY=$("$JQ" -r '
  [.phases // {} | to_entries[] | select(.value.status != "greenlight")
   | "    - phase \(.key): \(.value.status // "missing")"
  ] | join("\n")
' "$LEDGER" 2>/dev/null || echo "    - <unable to read ledger>")

emit_deny "[BLOCKED] BENCHMARK.md Run-N / Verdict write while pipeline is mid-flight.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

  Option A — finish the pipeline first.
    BENCHMARK Run-N entries are scorecards for COMPLETED runs. Continue
    dispatching the next pipeline phase per the kernel rule (auto-mode is
    NOT authorisation to truncate; inferred user preference is NOT
    authorisation; estimated session length is NOT authorisation).

  Option B — explicitly stop early and capture an honest partial.
    Create the authorisation sentinel and re-emit your write:
      mkdir -p .claude && touch .claude/onboarding-stop-authorized
      echo 'paused mid-Phase-N: <reason>' > .claude/onboarding-stop-authorized
    The hook honours the sentinel and allows the BENCHMARK write. The
    accompanying state-file partial flag will surface the early stop in
    every downstream consumer — that is the intended authorised path.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
File: $FILE_PATH
Tool: $TOOL_NAME

Phase ledger non-greenlight phases:
${NOT_GREEN_SUMMARY}

Diff signals matched:${SIGNALS}

Mid-pipeline BENCHMARK writes are the bypass shape the BookHive Run-2
incident exposed: a 'Run 2 — partial' section + 'Verdict: MIXED' written
mid-Pass-1 under cover of 'user instruction said BENCHMARK is the final
action'. The kernel rule explicitly subordinates 'final-step instructions'
to the no-skip pipeline contract — see the using-superpowers carve-out
hook (skill-call-time guidance).

──────────────────────────────────────────────────────────────────
If 'the user told me to write BENCHMARK first' — read this:
──────────────────────────────────────────────────────────────────
User instructions that ask for a final deliverable do NOT override the
no-skip contract while work is mid-flight. The kernel rule names this
exact pattern as a pre-emptive-scope-reduction trigger
('Until step N is done your run is not complete'). The honest path is
Option B above — touch the authorisation sentinel, then the BENCHMARK
write proceeds with a partial flag.

References:
  skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"
  skills/coverage-expansion/SKILL.md §\"Two valid exits\"
  hooks/lib/framing-tokens.sh
  hooks/onboarding-pipeline-incomplete-stop-deny.sh

Escape hatch: BENCHMARK_WRITE_GUARD=off in the parent process for non-
onboarding contexts that share the BENCHMARK.md filename. Or use the
sentinel-file path documented above for session-persistent stops."
exit 0
