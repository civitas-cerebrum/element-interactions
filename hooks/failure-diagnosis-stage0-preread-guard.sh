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

# Manual escape hatch.
if [ "${FD_STAGE0_GUARD:-on}" = "off" ]; then
  exit 0
fi

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

case "$TOOL_NAME" in
  Edit|Write) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
[ -z "$FILE_PATH" ] && exit 0

CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")

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
    CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
  else
    CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""')
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
  page-repository) TARGET_LABEL="page-repository.json" ;;
  bug-report)     TARGET_LABEL="Application Bug Report ($FILE_PATH)" ;;
esac

MISSING_LIST=$(printf '  - %s\n' "${MISSING[@]}")

emit_deny "[BLOCKED] failure-diagnosis Stage 0 — Context Pre-Read not satisfied.

About to write to: $TARGET_LABEL
Failure-diagnosis context is active (playwright-report/ or test-results/error-context).

Stage 0 (skills/failure-diagnosis/SKILL.md) requires reading the project's documented context BEFORE applying a heal or filing a bug report. The following file(s) exist in the project but have not been Read in this session:

$MISSING_LIST
Why: skipping Stage 0 is how confidently-wrong 'app bug' classifications get published — you compare the screenshot against your recollection of the page instead of against what the project already specifies. See issue #156 for the incident pattern.

Fix: Read the files above (use the Read tool), capture the documented expectations relevant to the failing step, then re-attempt the edit. The diagnostic pipeline should be comparing observed state against documented state, not against recollection.

Escape hatch (only when truly not failure-diagnosis work): set FD_STAGE0_GUARD=off in the environment for this invocation."
exit 0
