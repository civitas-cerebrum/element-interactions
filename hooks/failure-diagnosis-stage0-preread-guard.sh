#!/bin/bash
# failure-diagnosis-stage0-preread-guard.sh — enforce Stage 0 context pre-read
#
# Hook    : PreToolUse:Edit|Write
# Mode    : DENY when failure-diagnosis is active and the agent attempts to
#           edit a test file or write a bug-report file without first
#           reading the documented context (app-context.md, test-scenarios.md,
#           journey-map.md).
# State   : none (decision is derived from transcript_path on each call)
# Env     : FD_STAGE0_GUARD=off → silent allow (manual escape hatch for
#           non-failure-diagnosis edits in projects that happen to have
#           a playwright-report/ directory present)
#
# Rule
# ----
# When `failure-diagnosis` is the active diagnostic context — signalled by
# the presence of `playwright-report/` or `test-results/error-context*.md`
# in the project — any modification of test source, page-repository, or any
# new "Application Bug Report" markdown MUST be preceded by Read calls on
# the project's documented context files (when those files exist):
#
#   - tests/e2e/docs/app-context.md
#   - tests/e2e/docs/test-scenarios.md
#   - tests/e2e/docs/journey-map.md
#
# Why
# ---
# Stage 0 of `skills/failure-diagnosis/SKILL.md` is the load-bearing step
# that turns the diagnostic pipeline from "compare screenshot to my mental
# model" into "compare screenshot to documented expectations." Without it,
# confidently-wrong "app bug" classifications get published — exactly the
# failure mode that motivated issue #156.
#
# Markdown alone has been shown insufficient (see #155 / #156). A
# programmatic guard at the heal/report write boundary forces the read to
# happen before any irreversible classification or fix is committed.
#
# Canonical reference
# -------------------
# skills/failure-diagnosis/SKILL.md §"Stage 0 — Context Pre-Read (mandatory)"
#
# Failure → action
# ----------------
# - Edit/Write to test source, page-repository, or new bug-report file
#   AND failure-diagnosis context is active
#   AND any documented context file that exists in the project has NOT
#       been Read in the current session                 → DENY
# - Anything else                                        → silent allow

set -euo pipefail

# Resolve jq: prefer the binary bundled with the hook install, fall back to
# system jq for in-repo testing before postinstall has run.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

# Manual escape hatch.
if [ "${FD_STAGE0_GUARD:-on}" = "off" ]; then
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

# build_message <headline> <do-this-instead> <what-was-wrong> <if-this-then> <references>
# Renders the project-standard hook error layout (see contributing skill
# §"Hook error message format — repo standard"). Mirrors the canonical
# `build_message` in hooks/contribution-handover-gate.sh.
build_message() {
  local headline="$1" do_this="$2" wrong="$3" if_this="$4" refs="$5"
  cat <<EOF
[BLOCKED] $headline

──────────────────────────
Do this instead:
──────────────────────────
$do_this

──────────────────────────
What was wrong:
──────────────────────────
$wrong

──────────────────────────
If $if_this — read this:
──────────────────────────
References:
$refs
EOF
}

REFS=$(cat <<'EOF'
  skills/failure-diagnosis/SKILL.md §"Stage 0 — Context Pre-Read (mandatory)"
  skills/contributing-to-element-interactions/SKILL.md §"Hook error message format — repo standard"
  hooks/failure-diagnosis-stage0-preread-guard.sh (this hook header)
  Issue #156 — the incident that motivated mechanical enforcement
EOF
)

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')

case "$TOOL_NAME" in
  Edit|Write) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // ""')
[ -z "$FILE_PATH" ] && exit 0

CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
TRANSCRIPT_PATH=$(echo "$INPUT" | "$JQ" -r '.transcript_path // ""' 2>/dev/null || echo "")

# --- target classification --------------------------------------------------
# Decide whether this edit belongs to the failure-diagnosis surface.
# Single regex covers .spec.{ts,js,mjs,cjs} at any nesting depth under tests/.
TARGET_KIND=""
case "$FILE_PATH" in
  */tests/data/page-repository.json) TARGET_KIND="page-repository" ;;
esac
if [ -z "$TARGET_KIND" ] && echo "$FILE_PATH" | grep -qE '/tests/.+\.spec\.(ts|js|mjs|cjs)$'; then
  TARGET_KIND="test-source"
fi

# Bug-report .md files: detected by content containing "Application Bug Report".
if [ -z "$TARGET_KIND" ] && echo "$FILE_PATH" | grep -qE '\.md$'; then
  if [ "$TOOL_NAME" = "Write" ]; then
    CONTENT=$(echo "$INPUT" | "$JQ" -r '.tool_input.content // ""')
  else
    CONTENT=$(echo "$INPUT" | "$JQ" -r '.tool_input.new_string // ""')
  fi
  if echo "$CONTENT" | grep -qF "Application Bug Report"; then
    TARGET_KIND="bug-report"
  fi
fi

# Not a failure-diagnosis-surface edit → silent allow.
[ -z "$TARGET_KIND" ] && exit 0

# --- failure-diagnosis context detection ------------------------------------
# Active iff Playwright produced report/result artefacts OR the transcript
# contains a recent failure-diagnosis activation. This keeps the hook silent
# for normal authoring edits in projects that happen to ship a tests/ tree.

FD_ACTIVE=0

# Signal A — Playwright report or error-context artefacts.
# Use `find` instead of bash `**` (which is treated as `*` without globstar)
# so the typical test-results/<test-name>/error-context.md layout is caught.
if [ -d "$REPO_ROOT/playwright-report" ] || \
   find "$REPO_ROOT/test-results" -name 'error-context*.md' -print -quit 2>/dev/null | grep -q .; then
  FD_ACTIVE=1
fi

# Signal B — recent failure-diagnosis mention in the transcript.
if [ "$FD_ACTIVE" -eq 0 ] && [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  if tail -n 500 "$TRANSCRIPT_PATH" 2>/dev/null | grep -qiE 'failure-diagnosis|debug this|why is this failing|test is failing'; then
    FD_ACTIVE=1
  fi
fi

# Not in failure-diagnosis context → silent allow.
[ "$FD_ACTIVE" -eq 0 ] && exit 0

# --- check required reads ---------------------------------------------------
REQUIRED_PATHS=(
  "tests/e2e/docs/app-context.md"
  "tests/e2e/docs/test-scenarios.md"
  "tests/e2e/docs/journey-map.md"
)

# Only require files that actually exist in the project. A fresh project
# without journey-mapping output yet shouldn't be blocked from healing.
EXISTING=()
for rel in "${REQUIRED_PATHS[@]}"; do
  if [ -f "$REPO_ROOT/$rel" ]; then
    EXISTING+=("$rel")
  fi
done

# No documented context exists yet → silent allow (nothing to enforce).
[ ${#EXISTING[@]} -eq 0 ] && exit 0

# Need a transcript to verify Reads. If the harness didn't supply one, allow
# (better than fail-closed on a harness limitation).
[ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ] && exit 0

MISSING=()
for rel in "${EXISTING[@]}"; do
  # Match either the bare relative path or an absolute path ending in it.
  if ! grep -qF "\"$rel\"" "$TRANSCRIPT_PATH" 2>/dev/null && \
     ! grep -qF "/$rel\"" "$TRANSCRIPT_PATH" 2>/dev/null; then
    MISSING+=("$rel")
  fi
done

# All required reads present → silent allow.
[ ${#MISSING[@]} -eq 0 ] && exit 0

# --- emit deny --------------------------------------------------------------
TARGET_LABEL="$TARGET_KIND"
case "$TARGET_KIND" in
  test-source)    TARGET_LABEL="test source ($FILE_PATH)" ;;
  page-repository) TARGET_LABEL="page-repository.json ($FILE_PATH)" ;;
  bug-report)     TARGET_LABEL="Application Bug Report ($FILE_PATH)" ;;
esac

MISSING_LIST=$(printf '    - %s\n' "${MISSING[@]}")
# Strip the trailing newline so the built message stays tight.
MISSING_LIST="${MISSING_LIST%$'\n'}"

# Build sections via printf into variables. We avoid `$(cat <<EOF ... EOF)`
# nested heredoc-in-command-substitution because bash 3.2 (default macOS)
# mis-parses apostrophes inside that construct.
DO_THIS=""
DO_THIS+="  Option A — do the Stage 0 pre-read, then re-attempt the edit"$'\n'
DO_THIS+="    Read each file below using the Read tool, capture the documented"$'\n'
DO_THIS+="    expectations relevant to the failing step, then re-issue the edit:"$'\n'
DO_THIS+="${MISSING_LIST}"$'\n'
DO_THIS+="    The diagnostic pipeline should compare observed state (screenshot,"$'\n'
DO_THIS+="    DOM) against documented state — not against recollection of the page."$'\n'
DO_THIS+=""$'\n'
DO_THIS+="  Option B — this is genuinely not failure-diagnosis work"$'\n'
DO_THIS+="    Failure-diagnosis context activated because either playwright-report/"$'\n'
DO_THIS+="    or test-results/error-context*.md is present in the repo. If you are"$'\n'
DO_THIS+="    in this repo for an unrelated reason (cleanup, refactor, doc edit),"$'\n'
DO_THIS+="    set the escape hatch for this invocation:"$'\n'
DO_THIS+="        FD_STAGE0_GUARD=off"$'\n'
DO_THIS+="    The hook will silent-allow. Do not use this to skip the pre-read on"$'\n'
DO_THIS+="    an actual heal or bug-report write."

WRONG=""
WRONG+="File: $TARGET_LABEL"$'\n'
WRONG+="Failure-diagnosis context: ACTIVE"$'\n'
WRONG+="  signal: playwright-report/ present, or test-results/error-context*.md present"$'\n'
WRONG+="Stage 0 documented context not satisfied — files exist but were not Read"$'\n'
WRONG+="in this session:"$'\n'
WRONG+="${MISSING_LIST}"$'\n'
WRONG+=""$'\n'
WRONG+="Stage 0 of the failure-diagnosis pipeline (skills/failure-diagnosis/SKILL.md)"$'\n'
WRONG+="is the load-bearing step that turns triage from comparing the screenshot"$'\n'
WRONG+="against the agent's recollection of the page into comparing the screenshot"$'\n'
WRONG+="against what the project's documented context actually specifies. Skipping"$'\n'
WRONG+="it is how confidently-wrong app-bug classifications get published (issue"$'\n'
WRONG+="#156 — the incident pattern that motivated this hook). Markdown alone has"$'\n'
WRONG+="been shown insufficient under context pressure (see also #139, #154, #155);"$'\n'
WRONG+="a programmatic guard at the heal/report write boundary is the backstop."

HEADLINE="failure-diagnosis Stage 0 — Context Pre-Read not satisfied (target: $TARGET_KIND)."
IF_THIS="you started healing / filing a bug from a fresh context without re-reading the project's documented expectations"

msg=$(build_message "$HEADLINE" "$DO_THIS" "$WRONG" "$IF_THIS" "$REFS")
emit_deny "$msg"
exit 0
