#!/bin/bash
# workflow-reviewer-attestation-gate.sh — verifies that a workflow-
#                                         reviewer's approve verdict
#                                         cites real on-disk files.
#
# Hook    : PostToolUse:Agent
# Mode    : WARN  (PostToolUse cannot DENY a return that's already been
#                  produced; we surface a systemMessage so the
#                  orchestrator + auditing operator see the issue.
#                  Subsequent dispatch is still gated by the ledger-
#                  write-gate's actor-identity check, so a WARN here
#                  flags the audit trail but doesn't break the run.)
# State   : reads the proposed deliverables/evidence file paths against
#           the on-disk filesystem (read-only)
# Env     : none
#
# Why
# ---
# The schema requires an `attestation` string when verdict == approve,
# but the schema can't enforce that the string actually describes
# verified on-disk reality. A reviewer (or a manipulated brief) could
# return:
#
#   verdict: approve
#   attestation: "all good"
#
# …and the run advances. This hook checks the reviewer's evidence
# trail. If verdict is approve, the combined attestation + checklist
# evidence text MUST mention at least one file-path-shaped substring,
# AND every path-shaped substring it mentions MUST exist on disk under
# the run's repo root.
#
# What it gates
# -------------
# 1. **No evidence path cited.** verdict == approve but
#    attestation + every checklist[].evidence field together contain
#    zero substrings shaped like a project file path. The reviewer
#    didn't ground the approval in any artifact → WARN.
# 2. **Evidence cites a non-existent path.** The reviewer claims to
#    have verified a file that isn't on disk → WARN with the offending
#    path(s) listed.
#
# Path-shape heuristic
# --------------------
# A "file path" here is a substring matching the regex:
#   (?:tests|src|app|hooks|skills|schemas|scripts|docs)/[A-Za-z0-9_./-]+
# Plus bare filenames with common extensions (.json, .md, .ts, .spec.ts,
# .yaml, .yml). This is intentionally project-typed — random words with
# slashes (URLs, version strings) don't trigger it.
#
# Skips
# -----
#   - non-Agent tools                       → silent allow
#   - description not workflow-reviewer-*   → silent allow
#   - verdict != approve                    → silent allow (reject /
#                                              escalate paths don't
#                                              require positive evidence)
#   - malformed return (jq parse failure)   → silent allow (return-
#                                              schema-guard owns that)
#
# Pairs with workflow-reviewer-brief-gate.sh (PreToolUse:Agent DENY).

set -uo pipefail

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
[ -n "$JQ" ] || { echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found." >&2; exit 1; }

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")
[ "$TOOL_NAME" = "Agent" ] || exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""' 2>/dev/null || echo "")
case "$DESCRIPTION" in
  workflow-reviewer-*) ;;
  *) exit 0 ;;
esac

# Extract the reviewer's return text from the tool response. Same shape
# the existing return-schema-guard parses.
RESPONSE=$(
  echo "$INPUT" | "$JQ" -r '
    [
      (.tool_response.output? | if type == "array" then map(.text? // (. | tostring)) | join("\n") elif type == "string" then . else (. | tostring) end),
      (.tool_response.result? // empty | tostring),
      (if (.tool_response | type) == "string" then .tool_response else empty end)
    ] | map(select(. != null and . != "")) | unique | join("\n")
  ' 2>/dev/null || echo ""
)
case "$RESPONSE" in
  ""|"null"|"{}"|"[]") exit 0 ;;
esac

emit_warn() {
  "$JQ" -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}

# Parse the return. The reviewer's return is YAML in practice; for
# tolerance we try jq's --argfile-style parse first (in case it's JSON),
# then fall back to a yaml→json conversion via node if available.
NODE_BIN="$(command -v node || true)"
TMP_RESP=$(mktemp /tmp/wr-attestation-XXXXXX.txt)
trap 'rm -f "$TMP_RESP" "$TMP_RESP.json"' EXIT
printf '%s' "$RESPONSE" > "$TMP_RESP"

PARSED_JSON=""
if [ -n "$NODE_BIN" ]; then
  PARSED_JSON=$("$NODE_BIN" -e "
    const fs = require('fs');
    let yaml;
    try { yaml = require('yaml'); } catch (e) { process.exit(0); }
    const raw = fs.readFileSync('$TMP_RESP', 'utf8');
    try { console.log(JSON.stringify(yaml.parse(raw))); } catch (e) { process.exit(0); }
  " 2>/dev/null || echo "")
fi

# If parse failed, silent allow — return-schema-guard handles invalid
# return shapes.
[ -n "$PARSED_JSON" ] || exit 0

VERDICT=$(echo "$PARSED_JSON" | "$JQ" -r '.verdict // empty' 2>/dev/null || echo "")
[ "$VERDICT" = "approve" ] || exit 0

# Resolve repo root for existence checks.
GUARD_CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(cd "$GUARD_CWD" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null || echo "$GUARD_CWD")

# Collect evidence text: the attestation field + every checklist[].evidence.
EVIDENCE_TEXT=$(echo "$PARSED_JSON" | "$JQ" -r '
  ([.attestation // ""] +
   ((.checklist // []) | map(.evidence // "")))
  | join("\n")
' 2>/dev/null || echo "")

# Extract file-path-shaped substrings.
# Pattern 1: known project-typed dirs followed by a path segment.
# Pattern 2: a bare filename with common project extensions.
PATHS=$(printf '%s' "$EVIDENCE_TEXT" | grep -oE \
  '(tests|src|app|hooks|skills|schemas|scripts|docs)/[A-Za-z0-9_./-]+[A-Za-z0-9_]|[A-Za-z0-9_-]+\.(spec\.ts|schema\.json|json|md|ts|yaml|yml)' \
  2>/dev/null | sort -u || true)

if [ -z "$PATHS" ]; then
  emit_warn "[WARN] workflow-reviewer approval without on-disk evidence.

Description: \"${DESCRIPTION}\"
Verdict:     approve

The combined attestation + checklist evidence cites no project file
paths. An approval that doesn't ground its verdict in any artifact
defeats the inspector role.

Expected: at least one path under tests/, methodology/hooks/, methodology/skills/, methodology/schemas/,
methodology/scripts/, src/, app/, or docs/ — naming a deliverable the reviewer
actually read before approving.

This is a WARN (not DENY) because PostToolUse cannot reverse a return
that already ran; the orchestrator's next ledger write is still gated
by the actor-identity check, so the run is not advanced silently. But
this WARN belongs in the audit trail.

See:
  - methodology/schemas/subagent-returns/workflow-reviewer.schema.json
  - methodology/skills/workflow-reviewer/SKILL.md"
  exit 0
fi

# Verify each cited path exists. We accept absolute paths or paths
# relative to the repo root.
MISSING=""
while IFS= read -r p; do
  [ -z "$p" ] && continue
  if [ -e "$p" ] || [ -e "$REPO_ROOT/$p" ]; then
    continue
  fi
  MISSING="${MISSING}
  - ${p}"
done <<< "$PATHS"

if [ -n "$MISSING" ]; then
  emit_warn "[WARN] workflow-reviewer attestation cites paths that do not exist on disk.

Description: \"${DESCRIPTION}\"
Verdict:     approve
Repo root:   ${REPO_ROOT}

Cited but missing:${MISSING}

The reviewer claims to have verified these artifacts but they aren't
on disk. This is either a fabricated attestation or a typo in the
evidence trail. Either way the audit trail is unreliable.

This is a WARN (not DENY) because PostToolUse cannot reverse a return
that already ran. Recommend: orchestrator re-dispatches the reviewer
with a clarification, OR the operator audits the evidence chain
manually.

See:
  - methodology/schemas/subagent-returns/workflow-reviewer.schema.json
  - methodology/skills/workflow-reviewer/SKILL.md"
fi

exit 0
