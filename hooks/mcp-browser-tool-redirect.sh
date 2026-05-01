#!/bin/bash
# mcp-browser-tool-redirect.sh — block MCP browser tools, redirect to playwright-cli
#
# Hook    : PreToolUse:mcp__plugin_playwright_playwright__browser_*
# Mode    : DENY (always — no allowed MCP browser-tool invocation)
# State   : none
# Env     : none
#
# Rule
# ----
# Every MCP playwright browser-tool call is denied with a redirect message
# naming the equivalent `playwright-cli` invocation. The CLI is the only
# sanctioned browser-automation channel across the skill suite (per
# playwright-cli-protocol.md §1).
#
# Why
# ---
# MCP browser tools spawn a separate Chrome process with a different
# user-data-dir, write to `.playwright-mcp/` instead of `.playwright-cli/`,
# and break the per-session OS-isolation guarantee that makes parallel
# subagent dispatch safe. The CLI's session-per-process model is what
# enables host-max parallelism without cross-contamination.
#
# Canonical reference
# -------------------
# skills/element-interactions/references/playwright-cli-protocol.md §1, §3
# skills/element-interactions/SKILL.md §"Rule 11 — browser automation goes
#   through @playwright/cli"
#
# Failure → action
# ----------------
# - Any mcp__*_browser_* tool call → DENY with redirect message naming the
#                                    equivalent playwright-cli subcommand.
# - Any other tool                 → silent allow (exit 0).

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

[[ "$TOOL_NAME" != mcp__plugin_playwright_playwright__browser_* ]] && exit 0

# --- map MCP tool → the CLI subcommand it should be re-issued as ---
case "$TOOL_NAME" in
  *_browser_navigate)        EQUIV='-s=<slug> open --browser=chromium <URL>   (or `goto <URL>` if session is already open)' ;;
  *_browser_snapshot)        EQUIV='-s=<slug> snapshot' ;;
  *_browser_click)           EQUIV='-s=<slug> click "<selector>"' ;;
  *_browser_type)            EQUIV='-s=<slug> type "<text>"' ;;
  *_browser_fill_form)       EQUIV='-s=<slug> fill "<selector>" "<text>"' ;;
  *_browser_evaluate)        EQUIV='-s=<slug> eval "<js-expression>"' ;;
  *_browser_take_screenshot) EQUIV='-s=<slug> screenshot --path <out.png>' ;;
  *_browser_close)           EQUIV='-s=<slug> close                           (or `close-all` from the parent only)' ;;
  *_browser_resize)          EQUIV='-s=<slug> resize <width> <height>' ;;
  *_browser_press_key)       EQUIV='-s=<slug> press <key>' ;;
  *_browser_hover)           EQUIV='-s=<slug> hover "<selector>"' ;;
  *_browser_select_option)   EQUIV='-s=<slug> select "<selector>" "<value>"' ;;
  *_browser_navigate_back)   EQUIV='-s=<slug> back' ;;
  *_browser_drag)            EQUIV='-s=<slug> drag <start-selector> <end-selector>' ;;
  *_browser_drop)            EQUIV='-s=<slug> drop <target-selector>' ;;
  *_browser_console_messages) EQUIV='cat .playwright-cli/console-*.log        (CLI auto-writes per-session console logs)' ;;
  *_browser_network_request|*_browser_network_requests)
    EQUIV='-s=<slug> eval "..."  to inspect via fetch/XHR observers; or instrument the test code with page.waitForResponse (framework bridge)' ;;
  *_browser_tabs)            EQUIV='use a separate -s=<another-slug> session per tab — sessions are OS-isolated' ;;
  *_browser_wait_for)        EQUIV='-s=<slug> wait-for "<selector>"           (or steps.waitForState in test code)' ;;
  *_browser_handle_dialog)   EQUIV='instrument the test with page.on("dialog", ...) (framework bridge — no CLI equivalent)' ;;
  *_browser_file_upload)     EQUIV='use steps.uploadFile(...) in test code (no CLI equivalent for ad-hoc upload)' ;;
  *_browser_run_code_unsafe) EQUIV='-s=<slug> eval "<js-expression>"          (the _unsafe variant is forbidden — use the standard CLI eval)' ;;
  *)                         EQUIV='-s=<slug> <subcommand> ...                see skills/element-interactions/references/playwright-cli-protocol.md §3' ;;
esac

emit_deny "[BLOCKED] MCP browser tool — use playwright-cli instead.

Tool: $TOOL_NAME

Re-issue via the Bash tool as:
  npx playwright-cli ${EQUIV}

<slug> must follow the role-prefix convention (matching this subagent's Agent description):
  composer-j-<slug>-<pass>-c<N>    Stage A composer
  reviewer-j-<slug>-<pass>-c<N>    Stage B reviewer
  probe-j-<slug>-<pass>            adversarial probe (passes 4-5)
  phase1-<entry>                    Phase-1 discovery
  stage2-<scenario>                 element inspection

Why: MCP browser tools spawn a separate Chrome (different user-data-dir, writes to .playwright-mcp/ instead of .playwright-cli/) and break per-session OS isolation. See element-interactions Rule 11 + playwright-cli-protocol.md §3.1."

exit 0
