#!/bin/bash
# happy-path-discovery-draft-required.sh — gate Phase-4 cycle dispatches on
# the presence of a valid Phase-3 discovery draft.
#
# Hook    : PreToolUse:Agent  (gate Phase-4 dispatches)
#         + PostToolUse:Agent (warn when a Phase-3 return left no draft)
# Mode    : DENY (PreToolUse — block phase4-cycle-* / phase4-prioritise-author
#                 dispatches when the draft is absent or malformed)
#         + WARN (PostToolUse — surface absent draft after a phase3-* return,
#                 defense-in-depth so the gap is visible before Phase 4)
# State   : reads <repo>/tests/e2e/docs/.discovery-draft.json
# Env     : DISCOVERY_DRAFT_GUARD=off → silent allow (escape hatch; not recommended)
#
# Rule
# ----
# Phase-4 cycle agents and the prioritise-author dispatch consume a structured
# discovery draft produced by element-interactions Stage 3 in `onboarding`
# Phase 3. Without the draft, journey-mapping's iterative-cycle protocol
# cannot determine the cycle-1 section roster — it would either guess from
# scratch (the silent-sequential anti-pattern) or stall.
#
# This hook denies any phase4-cycle-* / phase4-prioritise-author dispatch
# when:
#   - tests/e2e/docs/.discovery-draft.json is missing
#   - the file lacks "discovery-draft-version": 1
#   - handover-to-phase4.cycle-1-targets is missing or empty
#
# Why
# ---
# Markdown-only enforcement re-opens the silent-narrowing loophole:
# orchestrators with context pressure skip the draft, fan out a single
# "do everything" cycle agent, and call Phase 4 done. The hook makes that
# impossible — no draft, no Phase-4 work.
#
# Canonical references
# --------------------
# skills/element-interactions/references/autonomous-mode-callers.md
#   §"Mandatory output for `onboarding` Phase 3 — discovery draft"
# skills/journey-mapping/SKILL.md §"Iterative discovery cycles"
# skills/journey-mapping/SKILL.md §"Inputs"
#
# Failure → action
# ----------------
# - PreToolUse:Agent on description matching phase4-cycle-*-section-* OR
#   phase4-prioritise-author:
#     - draft file missing                 → DENY with redirect to Phase 3
#     - draft file present but no sentinel → DENY (malformed)
#     - draft sentinel ok but cycle-1-targets empty → DENY (empty draft)
#     - all checks pass                    → silent allow
# - PostToolUse:Agent on description matching phase3-*:
#     - draft file missing on tool_response success → systemMessage WARN
#       (does NOT block — the dispatch already returned; this is defense-in-
#       depth so the operator notices before the next Phase-4 dispatch)
# - Anything else                                                 → silent allow

set -euo pipefail

# Resolve jq: prefer the binary bundled with the hook install, fall back to
# system jq for in-repo testing before postinstall has run.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

# Shared no-skip messaging library.
# shellcheck source=lib/no-skip-messaging.sh
HOOK_LIB_DIR="$(dirname "${BASH_SOURCE[0]}")/lib"
if [ -f "$HOOK_LIB_DIR/no-skip-messaging.sh" ]; then
  source "$HOOK_LIB_DIR/no-skip-messaging.sh"
else
  no_skip_messaging_block() { echo ""; }
fi

# --- helpers ---
emit_deny() {
  local reason="$1
$(no_skip_messaging_block)"
  "$JQ" -n --arg r "$reason" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

emit_warn() {
  local msg="$1
$(no_skip_messaging_block)"
  "$JQ" -n --arg msg "$msg" '{
    "systemMessage": $msg
  }'
}

# Escape hatch.
if [ "${DISCOVERY_DRAFT_GUARD:-}" = "off" ]; then
  exit 0
fi

# --- input ---
INPUT=$(cat)
EVENT_NAME=$(echo "$INPUT" | "$JQ" -r '.hook_event_name // ""')
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')
[ "$TOOL_NAME" != "Agent" ] && exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""')

# Resolve repo root for state-file location.
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
DRAFT="$REPO_ROOT/tests/e2e/docs/.discovery-draft.json"

# === PreToolUse branch: gate phase4-cycle / phase4-prioritise-author ========
if [ "$EVENT_NAME" = "PreToolUse" ]; then
  # Match the role-prefixes that consume the draft.
  case "$DESCRIPTION" in
    phase4-cycle-*-section-*|phase4-prioritise-author*) ;;
    *) exit 0 ;;
  esac

  # Check 1 — file exists.
  if [ ! -f "$DRAFT" ]; then
    emit_deny "[BLOCKED] Phase-4 dispatch attempted before Phase-3 produced a discovery draft.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

Re-run Phase 3 (the happy-path autonomous-mode dispatch) with the
discovery-draft requirement enabled. The draft is mandatory output
of \`onboarding\` Phase 3 per \`element-interactions/references/autonomous-mode-callers.md\`
§\"Mandatory output for \`onboarding\` Phase 3 — discovery draft\".

The expected file is:
  ${DRAFT}

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Draft file:  ${DRAFT} (does not exist)

Phase 4's iterative-cycle protocol consumes the draft to seed the cycle-1
section roster. Without it, the orchestrator cannot determine which sections
to dispatch agents for — the alternative (a single \"do everything\" cycle
agent) is the silent-sequential anti-pattern this hook exists to prevent.

References:
  skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\" → \"Inputs\"
  skills/element-interactions/references/autonomous-mode-callers.md
    §\"Mandatory output for \`onboarding\` Phase 3 — discovery draft\"

Escape hatch: DISCOVERY_DRAFT_GUARD=off (not recommended; defeats the contract)."
    exit 0
  fi

  # Check 2 — file parses as JSON and carries the version sentinel.
  VERSION=$("$JQ" -r '."discovery-draft-version" // empty' "$DRAFT" 2>/dev/null || echo "")
  if [ "$VERSION" != "1" ]; then
    emit_deny "[BLOCKED] discovery-draft.json missing version-1 sentinel.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

Re-author the draft with the canonical schema. The first key MUST be:
  \"discovery-draft-version\": 1

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Draft file:  ${DRAFT}
Found version field: \"${VERSION}\" (expected \"1\")

A draft without the version sentinel was authored by something other than
the canonical Stage-3 emitter — Phase-4 hooks refuse it to avoid consuming
schema-mismatched input.

References:
  skills/element-interactions/references/autonomous-mode-callers.md
    §\"Mandatory output for \`onboarding\` Phase 3 — discovery draft\""
    exit 0
  fi

  # Check 3 — handover-to-phase4.cycle-1-targets is non-empty.
  TARGET_COUNT=$("$JQ" -r '."handover-to-phase4"."cycle-1-targets" // [] | length' "$DRAFT" 2>/dev/null || echo 0)
  if [ "$TARGET_COUNT" -lt 1 ]; then
    emit_deny "[BLOCKED] discovery-draft.json has empty cycle-1-targets.

──────────────────────────────────────────────────────────────────
Do this instead:
──────────────────────────────────────────────────────────────────

The draft must list at least one section in
\`handover-to-phase4.cycle-1-targets\`. The list is the union of
\`sections-inferred[].id\` and \`unvisited-but-linked[].section-guess\` from
Stage 3's discovery. An empty draft means Phase 3 saw no pages or no
links — verify the happy-path spec actually drove the app.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
Description: \"${DESCRIPTION}\"
Draft file:  ${DRAFT}
cycle-1-targets length: ${TARGET_COUNT}

References:
  skills/journey-mapping/SKILL.md §\"Iterative discovery cycles\" → \"Inputs\""
    exit 0
  fi

  # All checks pass — allow.
  exit 0
fi

# === PostToolUse branch: warn when a phase3-* return left no draft =========
if [ "$EVENT_NAME" = "PostToolUse" ]; then
  case "$DESCRIPTION" in
    phase3-*) ;;
    *) exit 0 ;;
  esac

  # Only warn when the dispatch reported something resembling success — if
  # the dispatch itself failed, the absent draft isn't the bug.
  RESPONSE=$(
    echo "$INPUT" | "$JQ" -r '
      [
        (.tool_response.output? | if type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
        (.tool_response.result? // empty | tostring)
      ] | map(select(. != null and . != "")) | unique | join("\n")
    ' 2>/dev/null || echo ""
  )

  # Heuristic: success-shaped returns mention "new-tests-landed", "passed", or
  # "Stage 4b: clean" — the patterns Stage 3 emits in autonomous mode. We
  # don't try to be exhaustive; this is a warning, not a deny.
  if echo "$RESPONSE" | grep -qE 'new-tests-landed|status:[[:space:]]*passed|Stage 4b.*clean'; then
    if [ ! -f "$DRAFT" ]; then
      emit_warn "[WARN][happy-path-discovery-draft-required] Phase-3 subagent (${DESCRIPTION}) returned successfully but did not write tests/e2e/docs/.discovery-draft.json. Phase-4 cycle dispatches will be denied until a draft is produced. Re-dispatch Phase 3 with the discovery-draft requirement explicit in the brief."
    fi
  fi

  exit 0
fi

exit 0
