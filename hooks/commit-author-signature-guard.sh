#!/bin/bash
# commit-author-signature-guard.sh — block AI-assistant Co-Authored-By: trailers
#
# Hook    : PreToolUse:Bash  (filters to `git commit` invocations only)
# Mode    : DENY (no WARN path — AI co-author trailers are unambiguous and
#           high-confidence; soft-warning would invite "ignore once" cycles)
# State   : none
# Env     : COMMIT_AUTHOR_SIGNATURE_GUARD=off → silent allow (escape hatch
#           for the rare case where a Claude/AI line legitimately belongs
#           in a commit body — e.g. a copy-paste of a prior commit's
#           message into a `git log` test fixture).
#
# Rule
# ----
# A `git commit` invocation must NOT contain a `Co-Authored-By:` trailer
# crediting Claude / Anthropic / borealis.local / borealis-local / any
# other AI-assistant sentinel (see AI_SENTINEL_PATTERNS below — the regex
# is deliberately extensible). Real-human Co-Authored-By: trailers
# (e.g. `Co-Authored-By: Jane Doe <jane@example.com>`) are fine.
#
# Why
# ---
# Every commit's authorship belongs to the human contributor. AI-assistant
# co-author lines:
#   - pollute `git log --format=%aN | sort -u | uniq -c` (the contributor
#     census), making it impossible to read at a glance who shipped what;
#   - confuse merge conflicts on the trailer block — two Claude lines from
#     two branches three-way-merge into nonsense;
#   - create the false impression of joint ownership when the human is the
#     one accountable for the change.
#
# The harness's default CLAUDE.md template inserts these trailers; this
# gate strips them at the commit boundary so they never land in `git log`.
#
# Canonical reference
# -------------------
# skills/contributing-to-element-interactions/SKILL.md §"Commit messages
# don't carry AI co-author trailers"
#
# Failure → action
# ----------------
# - `Co-Authored-By:` trailer naming Claude / Anthropic / borealis*       → DENY
# - HEREDOC commit (-m "$(cat <<'EOF' ... EOF)") with same trailer        → DENY
# - Real-human Co-Authored-By: only                                       → silent allow
# - No Co-Authored-By: at all                                             → silent allow
# - Tool != Bash, command != git commit, escape hatch on                  → silent allow
#
# Wiring (~/.claude/settings.json)
# --------------------------------
#   "PreToolUse": [
#     { "matcher": "Bash", "hooks": [
#         { "type": "command",
#           "command": "/path/to/repo/hooks/commit-author-signature-guard.sh",
#           "timeout": 10 } ] }
#   ]

set -euo pipefail

# --- escape hatch ---
if [ "${COMMIT_AUTHOR_SIGNATURE_GUARD:-on}" = "off" ]; then
  exit 0
fi

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

# AI-sentinel patterns. Extend this list as new AI assistants enter the
# tooling stack. Every entry is matched case-insensitively against the
# right-hand side of a `Co-Authored-By:` trailer (the "Name <email>" part).
# Word-boundaries are used so "Claude" doesn't accidentally match a
# real-human "Claudette".
AI_SENTINEL_PATTERNS='(\bclaude\b|\banthropic\b|borealis\.local|borealis-local|198563339\+borealis-local@users\.noreply\.github\.com)'

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
[ -z "$CMD" ] && exit 0

# Only fire on `git commit` invocations.
if ! echo "$CMD" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

# Extract every Co-Authored-By: line from the command. We scan the raw
# command string — both `-m "..."` and `-m "$(cat <<'EOF' ... EOF)"` forms
# embed the message inline, so a single grep over $CMD catches both. We
# look for the literal trailer prefix (case-insensitive) followed by
# anything up to a newline or closing quote.
CO_AUTHOR_LINES=$(echo "$CMD" | grep -oiE 'co-authored-by:[[:space:]]*[^"'"'"'\\]*' || true)

# No co-author trailers at all → silent allow.
[ -z "$CO_AUTHOR_LINES" ] && exit 0

# Filter to AI-sentinel lines only. Real-human Co-Authored-By: trailers
# pass through.
AI_LINES=$(echo "$CO_AUTHOR_LINES" | grep -iE "$AI_SENTINEL_PATTERNS" || true)

# All co-author lines are real humans → silent allow.
[ -z "$AI_LINES" ] && exit 0

# Build the corrective command — the exact same `git commit` invocation
# minus the AI Co-Authored-By: lines. We remove each detected AI line
# from the command body so the contributor can copy-paste the result.
CORRECTIVE=$(python3 -c "
import sys, re
cmd = sys.argv[1]
# Remove every line whose lstrip starts with 'Co-Authored-By:' (case-insensitive)
# AND mentions any AI sentinel. Operate line-by-line so we keep human co-authors.
ai_re = re.compile(r'(?i)co-authored-by:.*(\\bclaude\\b|\\banthropic\\b|borealis\\.local|borealis-local|198563339\\+borealis-local@users\\.noreply\\.github\\.com)')
lines = cmd.split('\n')
kept = [l for l in lines if not ai_re.search(l)]
# Also collapse runs of blank lines that the removal may have introduced.
out = []
prev_blank = False
for l in kept:
    is_blank = (l.strip() == '')
    if is_blank and prev_blank:
        continue
    out.append(l)
    prev_blank = is_blank
sys.stdout.write('\n'.join(out))
" "$CMD" 2>/dev/null || echo "$CMD")

# Build the "what was wrong" section listing every offending line.
WRONG_LIST=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  WRONG_LIST+="  - $line"$'\n'
done <<<"$AI_LINES"

CORRECTIVE_INDENTED=$(printf '%s\n' "$CORRECTIVE" | sed 's/^/    /')

# Build the deny message. We assemble it from three literal blocks plus
# two dynamic chunks (corrective command, wrong-list). Each literal
# block is read from a single-quoted heredoc into a variable via `read`
# rather than `$(cat <<'EOF')` — bash 3.2 (macOS default) has a known
# heredoc-in-command-substitution quoting bug that mishandles
# apostrophes in single-quoted heredoc bodies.
IFS= read -r -d '' REASON_HEAD <<'HEAD' || true
[BLOCKED] commit message contains Claude/AI co-author signature.

──────────────────────────
Do this instead:
──────────────────────────
  Re-run the commit with the AI Co-Authored-By: trailer(s) stripped:

HEAD

IFS= read -r -d '' REASON_BODY <<'BODY' || true

  The commit's authorship is yours alone. AI assistants do not get
  Co-Authored-By: trailers; the human contributor owns the change.

──────────────────────────
What was wrong:
──────────────────────────
Detected AI-attribution co-author line(s) in the commit body:
BODY

IFS= read -r -d '' REASON_TAIL <<'TAIL' || true
Why this matters:
  - Pollutes "git log --format=%aN | sort -u | uniq -c" (the contributor
    census) — the contributor count gets inflated by a non-human entity.
  - Confuses three-way merges on the trailer block when two branches
    each carry their own AI co-author line.
  - Creates the false impression of joint ownership when the human is
    the one accountable for the change.

──────────────────────────
If your CLAUDE.md template auto-inserted the trailer — read this:
──────────────────────────
The harness default appends "Co-Authored-By: borealis.local …" to every
commit. This gate strips it at the commit boundary; the upstream fix is
to remove the trailer instruction from your project CLAUDE.md or
~/.claude/CLAUDE.md so it stops being suggested in the first place.

Escape hatch (genuine edge cases — copying a prior commit body into a
test fixture, etc.): set COMMIT_AUTHOR_SIGNATURE_GUARD=off for that
single commit.

References:
  skills/contributing-to-element-interactions/SKILL.md "Commit messages do not carry AI co-author trailers"
  hooks/commit-author-signature-guard.sh
TAIL

REASON="${REASON_HEAD}
${CORRECTIVE_INDENTED}
${REASON_BODY}
${WRONG_LIST}
${REASON_TAIL}"

emit_deny "$REASON"
exit 0
