#!/bin/bash
# test-composer-dispatch-gate.sh — Phase-3 / Phase-5 / Phase-6 spec-creation gate.
#                                  Denies orchestrator-context Writes that create
#                                  new `tests/e2e/<journey>.spec.ts` files, and
#                                  denies subagent writes whose transcript shows
#                                  no test-composer skill preread.
#
# Hook    : PreToolUse:Write (Edit is silent-allowed — existing specs may be
#           legitimately edited by Phase 7 secrets-sweep in orchestrator context)
# Mode    : DENY
# State   : reads `parent_tool_use_id` from the hook input (subagent context)
#           + the session transcript at `transcript_path`
# Env     : TEST_COMPOSER_PREREAD_GATE=off  bypass for special-cased re-writes
#           (advisory; document the bypass authorisation)
#
# Why
# ---
# The 8-phase onboarding methodology requires the orchestrator to dispatch
# `test-composer` subagents to author specs at Phase 3 (happy-path) and Phase 5
# (coverage expansion). The composer skill carries an in-loop reviewer pass that
# catches craft issues, missing variants, and tautological assertions BEFORE the
# spec lands. Orchestrator-context spec authoring bypasses that review and
# encodes whatever the orchestrator's in-session inference looked like.
#
# Empirical observation from a benchmark onboarding run: orchestrator wrote
# `browse.spec.ts`, `auth.spec.ts`, `purchase.spec.ts`, `listing.spec.ts`
# directly with no test-composer dispatch and no harness friction. The specs
# were green and stable, but the reviewer pass that would have caught craft
# issues never ran. This gate makes that path structurally impossible.
#
# What it gates
# -------------
# Write tool calls whose `file_path` matches `tests/e2e/**/*.spec.ts` AND
# whose target file does NOT yet exist on disk (i.e. this is a CREATE, not
# an overwrite/edit). Two layered checks:
#
# 1. **parent_tool_use_id must be non-empty.** The write must originate
#    inside a subagent dispatch, not from the orchestrator's own session.
#    Orchestrator-context spec creation is denied unconditionally — there is
#    no methodology path that authorises it.
#
# 2. **Subagent transcript must show test-composer skill preread.** When the
#    write IS from a subagent, the subagent's transcript must include either
#    a `Skill('test-composer')` invocation OR a `Read` of
#    `skills/test-composer/SKILL.md` (any location). A subagent dispatched
#    with a freeform prose brief and no skill load is the same exploit shape
#    in subagent costume.
#
# Silent-allow cases:
# - TEST_COMPOSER_PREREAD_GATE=off
# - Tool isn't Write (Edit on existing files passes through — secrets-sweep
#   path)
# - File path doesn't match the spec pattern
# - Target file already exists on disk (this is an overwrite, treated as edit)
# - transcript_path is missing or empty (fail-open for older harness shapes)
#
# Failure → action
# ----------------
# Orchestrator-context new spec write              → DENY with composer dispatch hint
# Subagent-context new spec write without preread  → DENY with skill-load hint

set -uo pipefail

# Bypass switch.
if [ "${TEST_COMPOSER_PREREAD_GATE:-on}" = "off" ]; then
  exit 0
fi

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH." >&2
  exit 1
fi

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")

# Only act on Write — Edit on existing specs is legitimate (Phase 7
# secrets-sweep extracts literals; bug-discovery may patch a known
# regression). Phase 3 / 5 / 6 create new specs; that's what this hook
# gates.
[ "$TOOL_NAME" = "Write" ] || exit 0

FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
[ -n "$FILE_PATH" ] || exit 0

# Path filter: anything under tests/e2e/ ending in .spec.ts at any depth.
case "$FILE_PATH" in
  */tests/e2e/*.spec.ts) ;;
  *) exit 0 ;;
esac

# If the file already exists on disk, this Write is an overwrite — treat
# the same as an edit and silent-allow. Methodology gates only the
# initial spec creation; subsequent rewrites are an orchestrator
# decision that other gates own (e.g. commit-message-gate enforces the
# journey-scoped commit form).
[ -f "$FILE_PATH" ] && exit 0

# Helper: emit DENY payload with the supplied reason.
emit_deny() {
  local reason="$1"
  "$JQ" -n --arg r "$reason" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# Check 1: orchestrator-context write → DENY.
PARENT_ID=$(echo "$INPUT" | "$JQ" -r '.parent_tool_use_id // empty' 2>/dev/null || echo "")
if [ -z "$PARENT_ID" ]; then
  emit_deny "[BLOCKED] Direct Write to ${FILE_PATH} from orchestrator context.

New e2e spec files must be authored by a \`test-composer\` subagent dispatch — the methodology's reviewer-inloop pass catches craft issues (missing assertions, tautological checks, missing variants) BEFORE the spec lands. Orchestrator-context spec authoring bypasses that reviewer and encodes whatever the in-session inference looked like.

Fix: dispatch a \`test-composer\` subagent with a brief naming the journey, its prerequisites, and the critical assertion. The composer writes the spec at this path, runs its own reviewer-inloop pass, and only declares the cycle done after self-verification with \`npx playwright test\`.

For Phase 3 (happy-path): dispatch \`composer-happy-path:<journey-name>\`.
For Phase 5 (coverage expansion): dispatch \`composer-j-<slug>-<pass>:\`.
For Phase 6 (regression specs): typically the bug-discovery probe authors these — dispatch a \`probe-j-<slug>:\` instead.

Bypass (advisory only — document the authorisation): set \`TEST_COMPOSER_PREREAD_GATE=off\` in the harness environment for a single recovery write.

See:
  - skills/test-composer/SKILL.md
  - skills/onboarding/SKILL.md §\"Phase 3 — Happy path\"
  - schemas/subagent-returns/composer.schema.json
  - schemas/subagent-returns/reviewer-inloop.schema.json"
  exit 0
fi

# Check 2: subagent-context write — require test-composer preread in the
# subagent's own session transcript. The transcript_path the harness
# passes points at the active session's JSONL (the subagent's, in this
# case).
TRANSCRIPT_PATH=$(echo "$INPUT" | "$JQ" -r '.transcript_path // empty' 2>/dev/null || echo "")
if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  # No transcript to read — fail open. The orchestrator-context check
  # above already caught the primary exploit shape.
  exit 0
fi

# Scan the transcript for evidence the subagent has loaded the
# test-composer skill. Two acceptable signals (mirrors the journey-
# mapping preread gate):
#   1. A Skill tool use with input.skill == "test-composer" (any plugin
#      prefix accepted — the harness stores skill names verbatim).
#   2. A Read tool use whose file_path resolves to
#      `skills/test-composer/SKILL.md` (any prefix — bundled package
#      under node_modules/, project-local copy, or user-wide install
#      under ~/.claude/skills/).
PREREAD_FOUND=$(
  "$JQ" -r '
    if (.message? | type) == "object" and (.message.content? | type) == "array" then
      .message.content[] |
        select(.type? == "tool_use") |
        (
          (select(.name? == "Skill") | (.input.skill // "") ),
          (select(.name? == "Read")  | (.input.file_path // "") )
        )
    else empty end
  ' "$TRANSCRIPT_PATH" 2>/dev/null \
    | grep -E '(^|/)test-composer(:|$)|skills/test-composer/SKILL\.md' \
    | head -1 || true
)

if [ -n "$PREREAD_FOUND" ]; then
  exit 0
fi

emit_deny "[BLOCKED] Subagent Write to ${FILE_PATH} requires this subagent to have loaded the test-composer skill before writing.

The subagent dispatch is from a parent (parent_tool_use_id=${PARENT_ID}), so the orchestrator-context check passes — but the subagent's own transcript shows no \`Skill('test-composer')\` invocation and no \`Read\` of \`skills/test-composer/SKILL.md\`. That means the subagent is doing test-composer work without having loaded the test-composer methodology — a freeform-prose-brief subagent in test-composer costume.

The composer skill defines the dispatch contract: brief shape, reviewer-inloop pass, return schema, and the journey-scoped commit form. A subagent that hasn't loaded it is reconstructing the protocol from in-context inference, and the reviewer-inloop check (which catches missing variants, tautological assertions, untested edge cases) does not run.

Fix (in the subagent's first turn): invoke the test-composer skill via the Skill tool, OR Read \`skills/test-composer/SKILL.md\`, BEFORE issuing the Write that creates this spec.

Fix (in the orchestrator's dispatch brief, going forward): cite \`skills/test-composer/SKILL.md\` so the subagent knows to load it. Even better: dispatch with a description prefix the harness recognises (\`composer-happy-path:\`, \`composer-j-<slug>-<pass>:\`) so future subagent-side gates have a typed handle.

Bypass (advisory only — document the authorisation): set \`TEST_COMPOSER_PREREAD_GATE=off\` in the subagent's environment.

See:
  - skills/test-composer/SKILL.md
  - schemas/subagent-returns/composer.schema.json
  - schemas/subagent-returns/reviewer-inloop.schema.json"
exit 0
