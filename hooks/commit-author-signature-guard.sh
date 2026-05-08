#!/bin/bash
# commit-author-signature-guard.sh — block AI-assistant Co-Authored-By: trailers
#
# Hook    : PreToolUse:Bash  (filters to `git commit` invocations only)
# Mode    : DENY by default. The hook only fires when the commit body
#           actually contains an AI-attribution `Co-Authored-By:` trailer
#           — a pattern only an AI agent emits, never a real human — so
#           blocking by default does not interfere with human commits.
# State   : none
# Env     : COMMIT_AUTHOR_SIGNATURE_GUARD
#             unset / "deny" / "on"  → DENY (default, strict enforcement)
#             "warn"                 → systemMessage nudge, commit proceeds
#                                       (opt-down for environments where the
#                                       global block is still being rolled out)
#             "off"                  → silent allow (escape hatch for the rare
#                                       case where the trailer legitimately
#                                       belongs in a commit body — e.g. a
#                                       copy-paste of a prior commit's
#                                       message into a `git log` test fixture)
#
# Rule
# ----
# A `git commit` invocation MUST NOT contain a `Co-Authored-By:` trailer
# crediting Claude / Anthropic / borealis.local / borealis-local / any
# other AI-assistant sentinel (see AI_SENTINEL_PATTERNS below — the regex
# is deliberately extensible). Real-human Co-Authored-By: trailers
# (e.g. `Co-Authored-By: Jane Doe <jane@example.com>`) are fine.
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
#
# Failure → action
# ----------------
# - `Co-Authored-By:` trailer naming Claude / Anthropic / borealis*       → DENY
# - HEREDOC commit (-m "$(cat <<'EOF' ... EOF)") with same trailer        → DENY
# - Backticked `Co-Authored-By:` literal                                  → silent allow
# - HTML-commented `<!-- Co-Authored-By: -->`                             → silent allow
# - Quote-prefixed `> Co-Authored-By:` line                               → silent allow
# - Real-human Co-Authored-By: only                                       → silent allow
# - No Co-Authored-By: at all                                             → silent allow
# - Tool != Bash, command != git commit, escape hatch on                  → silent allow

set -euo pipefail

# Resolve jq: prefer the binary bundled with the hook install, fall back to
# system jq for in-repo testing before postinstall has run.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 1
fi

# --- mode resolution ---
MODE=$(printf '%s' "${COMMIT_AUTHOR_SIGNATURE_GUARD:-deny}" | tr '[:upper:]' '[:lower:]')
case "$MODE" in
  off)            exit 0 ;;
  warn)           ;;  # opt-down to systemMessage nudge
  deny|on|"")     MODE="deny" ;;
  *)              MODE="deny" ;;  # any other value falls back to deny (safe default)
esac

# --- helpers ---
emit_deny() {
  "$JQ" -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

emit_warn() {
  "$JQ" -n --arg m "$1" '{
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
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty')
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | "$JQ" -r '.tool_input.command // ""')
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

# Headline differs by mode; the rest of the body is identical.
HEADLINE="[BLOCKED] commit body credits an AI assistant as Co-Authored-By:."
if [ "$MODE" = "warn" ]; then
  HEADLINE="[NUDGE] commit body credits an AI assistant as Co-Authored-By: (warn-only mode)."
fi

IFS= read -r -d '' BODY_HEAD <<'HEAD' || true

──────────────────────────
Do this instead:
──────────────────────────
  Re-run the commit with the AI Co-Authored-By: trailer(s) removed:

HEAD

IFS= read -r -d '' BODY_MID <<'MID' || true

──────────────────────────
What was wrong:
──────────────────────────
The commit body contains a Co-Authored-By: trailer attributing the
change to an AI assistant. AI assistants do not co-author commits;
the human contributor is the sole author of every commit. Detected
trailer line(s):
MID

IFS= read -r -d '' BODY_TAIL <<'TAIL' || true
──────────────────────────
If your CLAUDE.md template inserted the trailer — fix the source:
──────────────────────────
The Anthropic CLAUDE.md template appends "Co-Authored-By: borealis.local …"
to every commit Claude generates. Remove the trailer instruction from
your project CLAUDE.md or ~/.claude/CLAUDE.md so it stops being
suggested in the first place.

Mode controls (env var COMMIT_AUTHOR_SIGNATURE_GUARD):
  deny (default) → block the commit
  warn           → systemMessage nudge, commit proceeds
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
