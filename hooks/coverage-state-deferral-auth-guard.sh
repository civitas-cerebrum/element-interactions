#!/bin/bash
# coverage-state-deferral-auth-guard.sh — deny self-imposed deferrals
# without verbatim user-authorisation.
#
# Hook    : PreToolUse:Write|Edit  (filters to coverage-expansion-state.json)
# Mode    : DENY
# State   : none
# Env     : DEFERRAL_AUTH_GUARD=off → silent allow (manual escape hatch)
#
# Rule
# ----
# Writes to `tests/e2e/docs/coverage-expansion-state.json` that mark
# `status: in-progress` AND populate `deferredJourneys[]` MUST justify
# every deferral in one of two ways:
#
#   (A) The `reason` field starts with one of the allowed structural
#       prefixes — these are subagent-returned or environment-attested
#       reasons that need no further authorisation:
#         - `blocked-on-app-bug:<id>`     (subagent returned `blocked`)
#         - `test-data-prerequisite:<thing>` (env / credential gap)
#         - `user-authorised:<verbatim quote>` (the verbatim quote IS
#                                               in the reason itself)
#
#   (B) The entry carries an `authorizer:` field whose value is a
#       non-empty string — interpreted as a verbatim quote of in-
#       conversation authorisation by the user. The hook checks
#       presence + non-emptiness; quote authenticity is a reviewer
#       concern.
#
# Any deferral that satisfies neither is the orchestrator silently
# narrowing scope. Common offending reasons named in the kernel rule:
# `budget-cap`, `session-length`, `mode-deviation`, `inferred-pref`,
# `auto-mode-stop`. The hook denies these unconditionally when no
# authorizer: field is present.
#
# Why
# ---
# The kernel rule in onboarding/SKILL.md explicitly names the patterns
# this hook catches: "Auto-mode does not satisfy 'explicit scope
# reduction'. Inferred user preference does not satisfy it. Session-
# length anxiety does not satisfy it." Markdown alone has been
# observed to fail under context pressure (issue #155 — the
# orchestrator wrote 25 deferred entries with `reason: budget-cap` in
# the documented run). The schema-guard already exists for shape; this
# guard covers semantics.
#
# Canonical reference
# -------------------
# skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
# skills/coverage-expansion/SKILL.md §"Two valid exits"
# Issue: civitas-cerebrum/element-interactions#155 (Gap 2)
#
# Failure → action
# ----------------
# - status:in-progress + deferredJourneys[] entry with disallowed
#   reason AND no authorizer: field                                 → DENY
# - status:in-progress + deferredJourneys[] entry with allowed
#   prefix OR non-empty authorizer:                                 → silent allow
# - status:complete                                                  → silent allow
# - deferredJourneys[] empty / absent                                → silent allow
# - File path is not coverage-expansion-state.json                   → silent allow
# - Edit shape (only new_string visible)                             → silent allow
#                                                                       (the next Write firing this hook validates the
#                                                                        whole shape)
# - Anything else                                                    → silent allow

set -euo pipefail

if [ "${DEFERRAL_AUTH_GUARD:-on}" = "off" ]; then
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

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL_NAME" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
case "$FILE_PATH" in
  *tests/e2e/docs/coverage-expansion-state.json) ;;
  *) exit 0 ;;
esac

# Edit's new_string is a partial slice — can't validate the full
# deferredJourneys[] without the surrounding context. Defer to the
# subsequent Write (which writes the full file).
[ "$TOOL_NAME" = "Edit" ] && exit 0

CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // ""')
[ -z "$CONTENT" ] && exit 0

# Must parse as JSON; if not, defer to the schema-guard which will
# emit a shape error.
echo "$CONTENT" | jq empty >/dev/null 2>&1 || exit 0

STATUS=$(echo "$CONTENT" | jq -r '.status // ""')
[ "$STATUS" = "complete" ] && exit 0

# Identify deferred entries. The deferredJourneys[] array can live at
# the top level OR nested somewhere — walk every object that has both
# `journey` and `reason` keys to be safe; that's the deferral shape.
# Output one line per entry: journey<TAB>reason<TAB>has_authorizer.
ENTRIES=$(echo "$CONTENT" | jq -r '
  [.deferredJourneys // []] | flatten
  + [.. | objects | select(has("journey") and has("reason") and (has("stage_a_cycles") | not))]
  | unique_by(.journey)
  | .[]
  | "\(.journey // "<unknown>")\t\(.reason // "")\t\((.authorizer // "") | tostring)"
' 2>/dev/null || echo "")

[ -z "$ENTRIES" ] && exit 0

ALLOWED_PREFIXES='^(blocked-on-app-bug:|test-data-prerequisite:|user-authorised:)'

VIOLATIONS=()
while IFS=$'\t' read -r JOURNEY REASON AUTHORIZER; do
  # Skip blank lines defensively.
  [ -z "$JOURNEY" ] && continue
  if echo "$REASON" | grep -qE "$ALLOWED_PREFIXES"; then
    continue
  fi
  if [ -n "$AUTHORIZER" ] && [ "$AUTHORIZER" != "null" ]; then
    # Trim whitespace + check it's actually non-empty content.
    TRIMMED=$(echo "$AUTHORIZER" | tr -d '[:space:]')
    [ -n "$TRIMMED" ] && continue
  fi
  VIOLATIONS+=("${JOURNEY} (reason: ${REASON:-<empty>})")
done <<< "$ENTRIES"

[ ${#VIOLATIONS[@]} -eq 0 ] && exit 0

VLIST=$(printf -- '  - %s\n' "${VIOLATIONS[@]}")

emit_deny "[BLOCKED] coverage-expansion-state.json contains deferred journeys without authorisation.

──────────────────────────────────────────────────────────────────
Do this instead — pick one per offending entry:
──────────────────────────────────────────────────────────────────

  Option A — change the reason to a structural prefix that does not
  require user authorisation:

    \"reason\": \"blocked-on-app-bug:<id>\"     — subagent returned blocked
    \"reason\": \"test-data-prerequisite:<thing>\" — env / credential gap
    \"reason\": \"user-authorised:<verbatim quote>\" — quote inline

  Option B — keep the reason but add an \`authorizer\` field carrying the
  verbatim user quote that authorised this specific deferral:

    {
      \"journey\": \"j-<slug>\",
      \"reason\": \"<your reason>\",
      \"authorizer\": \"<verbatim quote of the user's in-conversation\"
                     \"authorisation for THIS deferral>\"
    }

  Option C — undo the deferral. If you cannot quote a user authorisation
  AND the reason isn't structural, the deferral is silent scope
  narrowing. Re-dispatch the journey as a normal pass-N entry instead.

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
File: ${FILE_PATH}
status: ${STATUS}

Offending entries:
${VLIST}
The kernel rule explicitly names the patterns caught here:

  > 'Auto-mode does not satisfy explicit scope reduction. Inferred user
  > preference does not satisfy it. Session-length anxiety does not
  > satisfy it.'

Reasons like \`budget-cap\`, \`session-length\`, \`mode-deviation\`,
\`inferred-pref\`, \`auto-mode-stop\` — and any reason that doesn't start
with one of the allowed structural prefixes — must be paired with a
verbatim user-quote authorizer field. This is not negotiable; it's the
contract issue #155 documented in the wild.

──────────────────────────────────────────────────────────────────
If 'I want to be transparent about why I deferred' — read this:
──────────────────────────────────────────────────────────────────
Transparency lives in the authorizer field, not in the reason. A
self-imposed reason without an authorizer is silent scope narrowing
dressed in candid language. The hook is checking for the user's voice
in the file — your candor about your own constraints isn't a
substitute for the user's authorisation.

References:
  skills/onboarding/SKILL.md §\"Hard rules — kernel-resident\"
  skills/coverage-expansion/SKILL.md §\"Two valid exits\"
  Issue #155 (Gap 2)

Escape hatch (not recommended; defeats the contract): set
DEFERRAL_AUTH_GUARD=off in the environment for this invocation."
exit 0
