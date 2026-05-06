#!/bin/bash
# commit-author-signature-guard.sh — flag AI-assistant Co-Authored-By: trailers
#
# Hook    : PreToolUse:Bash  (filters to `git commit` invocations only)
# Mode    : WARN-only by default (systemMessage, never DENY) — opt-in DENY
#           via env var. The default ships globally via npm postinstall;
#           a global, mandatory commit block introduced via a transitive
#           dependency would be hostile, so the default surfaces a
#           visibility nudge instead. Consumers who want strict
#           enforcement set COMMIT_AUTHOR_SIGNATURE_GUARD=deny.
# State   : none
# Env     : COMMIT_AUTHOR_SIGNATURE_GUARD
#             unset / "warn" / "on" → WARN (default)
#             "deny"                → DENY (opt-in, strict enforcement)
#             "off"                 → silent allow (escape hatch for the rare
#                                     case where an AI line legitimately
#                                     belongs in a commit body — e.g. a
#                                     copy-paste of a prior commit's
#                                     message into a `git log` test fixture)
#
# Rule
# ----
# A `git commit` invocation should NOT contain a `Co-Authored-By:` trailer
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
# gate surfaces them at the commit boundary so they don't land in
# `git log` unnoticed.
#
# False-positive avoidance
# ------------------------
# The match is performed only on lines that look like a top-level
# `Co-Authored-By:` trailer. Lines whose context indicates they are
# documentation rather than a real trailer are skipped:
#   - lines whose lstrip starts with `>` (quote / explainer prefix)
#   - lines inside an HTML comment <!-- … -->  (single-line; multi-line
#     comments are stripped on a best-effort basis)
#   - the `Co-Authored-By:` token wrapped in backticks (a backticked
#     literal — clearly documentation, not a real trailer)
# These cover the typical meta-commit shapes: a commit message that
# describes the rule itself or quotes a prior commit body.
#
# Canonical reference
# -------------------
# hooks/commit-author-signature-guard.sh (this file)
#
# Failure → action
# ----------------
# - `Co-Authored-By:` trailer naming Claude / Anthropic / borealis*       → WARN (or DENY w/ opt-in)
# - HEREDOC commit (-m "$(cat <<'EOF' ... EOF)") with same trailer        → WARN (or DENY w/ opt-in)
# - Backticked `Co-Authored-By:` literal                                  → silent allow (false-positive avoidance)
# - HTML-commented `<!-- Co-Authored-By: -->`                             → silent allow (false-positive avoidance)
# - Quote-prefixed `> Co-Authored-By:` line                               → silent allow (false-positive avoidance)
# - Real-human Co-Authored-By: only                                       → silent allow
# - No Co-Authored-By: at all                                             → silent allow
# - Tool != Bash, command != git commit, escape hatch on                  → silent allow

set -euo pipefail

# --- mode resolution ---
MODE=$(printf '%s' "${COMMIT_AUTHOR_SIGNATURE_GUARD:-warn}" | tr '[:upper:]' '[:lower:]')
case "$MODE" in
  off)            exit 0 ;;
  deny)           ;;  # strict
  warn|on|"")     MODE="warn" ;;
  *)              MODE="warn" ;;  # any other value falls back to warn (safe default)
esac

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

emit_warn() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
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

# Walk the command line by line. For each line:
#   1. Strip <!-- … --> single-line HTML comments (the comment body is
#      removed before the trailer check, so a fully-commented trailer
#      line goes silent).
#   2. Skip the line entirely if its lstrip starts with `>` — that's a
#      quoted / explainer line, not a real trailer.
#   3. Skip the line if the `Co-Authored-By:` token is wrapped in
#      backticks anywhere on the line.
#   4. Otherwise, if the cleaned line still starts (after optional
#      leading whitespace) with `Co-Authored-By:` and matches an AI
#      sentinel, record it as an offending line.
#
# This logic lives in python3 — bash regex is not powerful enough to
# express "Co-Authored-By: not preceded by backtick anywhere on this
# line, also not in an HTML comment, also not a quote-prefixed line".
AI_LINES=$(python3 -c "
import sys, re

cmd = sys.argv[1]
sentinel_re = re.compile(r'(?i)(\\bclaude\\b|\\banthropic\\b|borealis\\.local|borealis-local|198563339\\+borealis-local@users\\.noreply\\.github\\.com)')
trailer_re  = re.compile(r'(?i)^[\\s]*co-authored-by:[\\s]*(.*)$')
html_comment_re = re.compile(r'<!--.*?-->')

ai = []
for raw in cmd.split('\n'):
    line = raw

    # 1. strip single-line HTML comments
    line_no_comment = html_comment_re.sub('', line)

    # 2. quote-prefix? skip
    if line_no_comment.lstrip().startswith('>'):
        continue

    # 3. backticked literal? skip — but only if the Co-Authored-By: token
    #    itself is wrapped, not just any other backticked string on the
    #    line. We approximate: if there is a backticked span containing
    #    'co-authored-by' (case-insensitive), treat the line as
    #    documentation.
    if re.search(r'(?i)\`[^\`]*co-authored-by[^\`]*\`', line_no_comment):
        continue

    # 4. trailer line?
    m = trailer_re.match(line_no_comment)
    if not m:
        continue

    rhs = m.group(1)
    if sentinel_re.search(rhs):
        # Echo the original line (with whitespace stripped) so the
        # WARN/DENY message shows what the contributor actually wrote.
        ai.append(line.strip())

sys.stdout.write('\n'.join(ai))
" "$CMD" 2>/dev/null || true)

# Filter out empty lines.
AI_LINES=$(printf '%s' "$AI_LINES" | sed '/^$/d' || true)

# No AI lines → silent allow (covers no-trailer, real-human-only, and
# all false-positive shapes).
[ -z "$AI_LINES" ] && exit 0

# Build the corrective command — the exact same `git commit` invocation
# minus the AI Co-Authored-By: lines. We remove each detected AI line
# from the command body so the contributor can copy-paste the result.
CORRECTIVE=$(python3 -c "
import sys, re

cmd = sys.argv[1]
sentinel_re = re.compile(r'(?i)(\\bclaude\\b|\\banthropic\\b|borealis\\.local|borealis-local|198563339\\+borealis-local@users\\.noreply\\.github\\.com)')
trailer_re  = re.compile(r'(?i)^[\\s]*co-authored-by:[\\s]*(.*)$')
html_comment_re = re.compile(r'<!--.*?-->')

def is_ai_trailer(raw):
    line_no_comment = html_comment_re.sub('', raw)
    if line_no_comment.lstrip().startswith('>'):
        return False
    if re.search(r'(?i)\`[^\`]*co-authored-by[^\`]*\`', line_no_comment):
        return False
    m = trailer_re.match(line_no_comment)
    if not m:
        return False
    return bool(sentinel_re.search(m.group(1)))

lines = cmd.split('\n')
kept = [l for l in lines if not is_ai_trailer(l)]

# Collapse runs of blank lines that the removal may have introduced.
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

# Build the message body. Used for both WARN and DENY paths — the only
# difference is the headline and the dispatch helper.
HEADLINE="[BLOCKED] commit message contains Claude/AI co-author signature."
if [ "$MODE" = "warn" ]; then
  HEADLINE="[NUDGE] commit message contains Claude/AI co-author signature (WARN-only by default)."
fi

IFS= read -r -d '' BODY_HEAD <<'HEAD' || true

──────────────────────────
Do this instead:
──────────────────────────
  Re-run the commit with the AI Co-Authored-By: trailer(s) stripped:

HEAD

IFS= read -r -d '' BODY_MID <<'MID' || true

  The commit's authorship is yours alone. AI assistants do not get
  Co-Authored-By: trailers; the human contributor owns the change.

──────────────────────────
What was wrong:
──────────────────────────
Detected AI-attribution co-author line(s) in the commit body:
MID

IFS= read -r -d '' BODY_TAIL <<'TAIL' || true
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
commit. The upstream fix is to remove the trailer instruction from your
project CLAUDE.md or ~/.claude/CLAUDE.md so it stops being suggested in
the first place.

Mode controls (env var COMMIT_AUTHOR_SIGNATURE_GUARD):
  warn (default) → systemMessage nudge, commit proceeds
  deny           → block the commit (opt-in strict enforcement)
  off            → silent allow (escape hatch for genuine edge cases —
                   copying a prior commit body into a test fixture, etc.)

References:
  hooks/commit-author-signature-guard.sh
TAIL

MESSAGE="${HEADLINE}
${BODY_HEAD}
${CORRECTIVE_INDENTED}
${BODY_MID}
${WRONG_LIST}
${BODY_TAIL}"

if [ "$MODE" = "deny" ]; then
  emit_deny "$MESSAGE"
else
  emit_warn "$MESSAGE"
fi
exit 0
