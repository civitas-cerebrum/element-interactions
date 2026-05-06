#!/bin/bash
# playwright-config-defaults-guard.sh — surface deviation from the documented
# package defaults for `playwright.config.ts`.
#
# Hook    : PreToolUse:Edit|Write  (filters to playwright.config.{ts,js,mjs,cjs})
# Mode    : WARN (systemMessage) — never DENY. Consumer autonomy matters; the
#           hook makes the deviation visible, doesn't block it.
# State   : none
# Env     : PWCONFIG_DEFAULTS_GUARD=off → silent allow (manual escape hatch
#           for projects with a documented reason to ship a slim config)
#
# Rule
# ----
# Writes / edits to `playwright.config.{ts,js,mjs,cjs}` SHOULD preserve the
# package's documented defaults:
#
#   - retries: <integer> (preferably non-zero; CI/local split is fine)
#   - use.video: 'on-first-retry' (or stricter: 'on', 'retain-on-failure')
#   - use.trace: 'on-first-retry' (or stricter)
#
# When any of those is missing or set to an off-shape value (`'off'`, `0`),
# emit a systemMessage so the deviation is surfaced to the orchestrator and
# to PR reviewers, instead of disappearing into a silent default-strip.
#
# Why
# ---
# `failure-diagnosis/SKILL.md` Stage 1 relies on the HTML report + trace +
# video artefacts produced by these defaults. A scaffold that strips them
# breaks the documented diagnostic substrate without any signal at write
# time — six-months-later debugging is the failure mode this hook prevents.
#
# Canonical reference
# -------------------
# skills/element-interactions/references/playwright-config-defaults.md
# skills/onboarding/references/phases-walkthrough.md §"Phase 1 — Scaffold"
# skills/element-interactions/SKILL.md §"Rule 8"
#
# Failure → action
# ----------------
# - Edit/Write to playwright.config.* AND any documented default missing
#   or off-shape AND no reviewer-visible reason in the file               → WARN
# - retries explicitly 0 / video 'off' / trace 'off'                      → WARN
# - All defaults preserved or explicitly stricter                         → silent allow
# - Anything else                                                         → silent allow

set -euo pipefail

if [ "${PWCONFIG_DEFAULTS_GUARD:-on}" = "off" ]; then
  exit 0
fi

emit_warn() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
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
case "$FILE_PATH" in
  *playwright.config.ts|*playwright.config.js|*playwright.config.mjs|*playwright.config.cjs) ;;
  *) exit 0 ;;
esac

# Resolve the post-write content. For Edit, only the new_string slice is
# available; that's a partial view but still surfaces strip-defaults edits
# (the line being replaced is in old_string, the line being added is in
# new_string).
if [ "$TOOL_NAME" = "Write" ]; then
  CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
else
  CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // ""')
fi

[ -z "$CONTENT" ] && exit 0

DEVIATIONS=()

# Field-presence helper: locate `<field>:` anywhere in the content (any
# line), tolerant of inline-object styles (`use: { video: 'x', trace: 'y' }`)
# and the more typical multi-line form.
field_present() {
  echo "$CONTENT" | grep -qE "\b${1}:\s*['\"]?[^,}]+"
}

field_value() {
  # Print everything after `<field>:` up to the first `,`, `}`, or end of line.
  # Use [[:space:]] for portability (macOS sed doesn't honour \s).
  echo "$CONTENT" | grep -oE "\b${1}:\s*[^,}]+" | head -1 | sed -E "s/^${1}:[[:space:]]*//"
}

# --- video check ------------------------------------------------------------
if field_present video; then
  V=$(field_value video)
  if echo "$V" | grep -qE "['\"]off['\"]"; then
    DEVIATIONS+=("video: 'off' — strips the rerun-documents-failure guarantee that failure-diagnosis Stage 1 reads from the HTML report")
  elif ! echo "$V" | grep -qE "['\"](on-first-retry|retain-on-failure|on)['\"]"; then
    DEVIATIONS+=("video setting non-standard ($V) — recommended: 'on-first-retry'")
  fi
elif [ "$TOOL_NAME" = "Write" ]; then
  DEVIATIONS+=("video setting absent — recommended default: video: 'on-first-retry'")
fi

# --- trace check ------------------------------------------------------------
if field_present trace; then
  T=$(field_value trace)
  if echo "$T" | grep -qE "['\"]off['\"]"; then
    DEVIATIONS+=("trace: 'off' — strips the trace artefact failure-diagnosis Stage 1 relies on")
  fi
elif [ "$TOOL_NAME" = "Write" ]; then
  DEVIATIONS+=("trace setting absent — recommended default: trace: 'on-first-retry'")
fi

# --- retries check ----------------------------------------------------------
# Absence on Write is a deviation. On Edit, absence is OK (we may not see the
# whole file). An explicit `retries: 0` is a deviation either way.
if field_present retries; then
  R=$(field_value retries)
  if echo "$R" | grep -qE "^0(\s|$)"; then
    DEVIATIONS+=("retries: 0 — kills the rerun boundary; video / trace 'on-first-retry' will never fire. Acceptable only for deterministic-only suites (see contract-testing/SKILL.md)")
  fi
elif [ "$TOOL_NAME" = "Write" ]; then
  DEVIATIONS+=("retries setting absent — recommended default: retries: process.env.CI ? 2 : 1 (non-zero so the rerun boundary the video / trace defaults rely on is reachable)")
fi

[ ${#DEVIATIONS[@]} -eq 0 ] && exit 0

DEV_LIST=$(printf -- '  - %s\n' "${DEVIATIONS[@]}")

emit_warn "[WARN] playwright.config deviates from the package's documented defaults.

File: $FILE_PATH
Tool: $TOOL_NAME

$DEV_LIST
Why this matters: failure-diagnosis Stage 1 reads the HTML report + trace + video artefacts to classify failures. Stripping these defaults regresses the documented diagnostic substrate. Document the reason in the PR description if intentional.

Reference: skills/element-interactions/references/playwright-config-defaults.md
Recommended config:

  retries: process.env.CI ? 2 : 1,
  use: {
    video: 'on-first-retry',
    trace: 'on-first-retry',
    ...
  }

Escape hatch: set PWCONFIG_DEFAULTS_GUARD=off in the environment for this invocation."
exit 0
