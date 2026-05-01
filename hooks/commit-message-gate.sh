#!/bin/bash
# commit-message-gate.sh
#
# PreToolUse hook for Bash. Blocks `git commit` invocations whose messages
# violate the @civitas-cerebrum/element-interactions per-phase / per-journey
# commit conventions.
#
# Conventions (skills/coverage-expansion/SKILL.md §"Commit-message conventions"):
#   chore: scaffold element-interactions framework
#   docs: initial app-context and site map
#   test: happy path — <name>
#   docs: journey map — <N> journeys prioritized
#   test(j-<slug>): <variant>                 [compositional pass 1-3]
#   docs(ledger): j-<slug> — N probes, ...    [adversarial pass 4]
#   test(j-<slug>-regression): lock <desc>    [adversarial pass 5]
#   docs(ledger): dedupe cross-cutting findings
#   docs(coverage-expansion-state): ...
#   chore: ...                                [infrastructure]
#
# Hook does NOT validate every detail — too brittle. It blocks the most-common
# anti-patterns the conventions exist to prevent:
#   - feat(e2e): ...               (coverage expansion is never `feat`)
#   - test(j-a,j-b,...): ...       (multi-journey commit — must be split)
#   - --no-verify / --no-gpg-sign  (skipping hooks)
#   - test: ... (without subject scope) for spec-file commits

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Only fire on git commit invocations.
if ! echo "$CMD" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
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

# Strip quoted substrings from the command before scanning for bypass flags.
# Otherwise a commit *message* that documents these flags (e.g.
# `-m "blocks --no-verify"`) would false-positive — the flags must be detected
# only when they appear as actual git arguments, not as message content.
# Replace single- and double-quoted regions with placeholders.
CMD_NO_QUOTES=$(echo "$CMD" | python3 -c "
import sys, re
s = sys.stdin.read()
# Remove double-quoted strings (with possible escaped quotes inside).
s = re.sub(r'\"(?:[^\"\\\\]|\\\\.)*\"', '\"___MSG___\"', s)
# Remove single-quoted strings.
s = re.sub(r\"'(?:[^'\\\\]|\\\\.)*'\", \"'___MSG___'\", s)
sys.stdout.write(s)
" 2>/dev/null || echo "$CMD")

# Anti-pattern: --no-verify / --no-gpg-sign / -c commit.gpgsign=false as args
if echo "$CMD_NO_QUOTES" | grep -qE '(^|[[:space:]])(--no-verify|--no-gpg-sign|commit\.gpgsign=false)([[:space:]]|$)'; then
  emit_deny "[BLOCKED] git commit cannot bypass hooks or signing.

Command contains one of: --no-verify, --no-gpg-sign, commit.gpgsign=false (as a git argument, not as message content).

Fix: investigate the underlying issue and address it. Hooks exist to catch real problems (failing tests, lint violations, sentinel-stripping); bypassing them creates silent breakage downstream. See skills/coverage-expansion/SKILL.md and the harness's own rule: \"Never skip hooks (--no-verify) or bypass signing unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.\""
  exit 0
fi

# Extract commit message via -m"..." or -m '...'.
MSG=$(echo "$CMD" | grep -oE -- "-m[[:space:]]*['\"][^'\"]+['\"]" | head -1 | sed -E "s/^-m[[:space:]]*['\"]//;s/['\"]$//" || true)

# Anti-pattern: multi-journey commit shape  test(j-a,j-b,...): ...
if echo "$MSG" | grep -qE 'test\([^)]*j-[a-z0-9-]+[[:space:]]*,'; then
  emit_deny "[BLOCKED] Multi-journey commit detected.

Message: \"${MSG}\"

Fix: split into one commit per journey. The convention from coverage-expansion §\"Commit-message conventions\" is one journey per commit, no exceptions:

  test(j-checkout): cycle-2 — multi-item variant
  test(j-signup): cycle-2 — long-input edge

Why: per-journey commits make the git log filterable by j-<slug>. A multi-journey commit hides which journey a regression came from when bisecting."
  exit 0
fi

# Anti-pattern: feat(e2e): ... — coverage expansion / e2e tests are never `feat`.
if echo "$MSG" | grep -qiE '^feat\((e2e|tests|test|coverage|journey|onboarding)\)'; then
  emit_deny "[BLOCKED] Test/coverage commits are 'test:' not 'feat:'.

Message: \"${MSG}\"

Fix: use the convention from coverage-expansion §\"Commit-message conventions\":

  test(<j-slug>): <variant>          for compositional passes
  docs(ledger): <j-slug> — ...       for adversarial pass 4
  test(<j-slug>-regression): ...     for adversarial pass 5
  docs(ledger): dedupe ...           for cleanup

Why: the convention makes commits filterable by type. 'feat(...)' is for product features."
  exit 0
fi

# Anti-pattern: fix(...) for a new test file (commits adding spec files should
# be `test(...)` per the convention; `fix(...)` is reserved for fixing existing
# code/tests).
# This is a soft check — we can't easily tell if files are new vs modified
# without reading the index. Leave as a doc-level rule for now.

exit 0
