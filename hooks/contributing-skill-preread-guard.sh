#!/bin/bash
# contributing-skill-preread-guard.sh — enforce reading the contributing skill
#                                        before editing this package's source
#
# Hook    : PreToolUse:Edit|Write|MultiEdit
# Mode    : DENY when the agent is about to modify a file inside this
#           package's contribution surface (src/, hooks/, skills/, scripts/,
#           package.json, tsconfig*.json) without first having read
#           skills/contributing-to-element-interactions/SKILL.md in the
#           current session.
# State   : none (decision is derived from transcript_path on each call)
# Env     : CONTRIBUTING_SKILL_PREREAD_GUARD
#             unset / "deny" / "on"  → DENY (default)
#             "warn"                 → systemMessage nudge, edit proceeds
#             "off"                  → silent allow
#
# Rule
# ----
# Any modification of files inside `@civitas-cerebrum/element-interactions`'s
# contribution surface MUST be preceded by a Read of
#   skills/contributing-to-element-interactions/SKILL.md
# in the current session — or by an invocation of the
# `contributing-to-element-interactions` skill via the Skill tool. The skill
# encodes the architecture, the API-vs-structural-gap distinction, the hard
# rules, and the design invariants that every contribution must respect; an
# agent that hasn't loaded it is editing blind.
#
# Scope guard
# -----------
# Only fires when the working tree we're editing IS this package itself —
# detected by `package.json` at the repo root containing
#   "name": "@civitas-cerebrum/element-interactions"
# Consumer projects that have the package as a dependency are unaffected.
#
# Failure → action
# ----------------
# - Edit/Write/MultiEdit to file inside contribution surface
#   AND CWD is this package's repo
#   AND the contributing SKILL.md has NOT been Read this session         → DENY
# - Anything else                                                        → silent allow

set -euo pipefail

# --- mode resolution ---
MODE=$(printf '%s' "${CONTRIBUTING_SKILL_PREREAD_GUARD:-deny}" | tr '[:upper:]' '[:lower:]')
case "$MODE" in
  off)            exit 0 ;;
  warn)           ;;
  deny|on|"")     MODE="deny" ;;
  *)              MODE="deny" ;;
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

# build_message <headline> <do-this-instead> <what-was-wrong> <if-this-then> <references>
# Renders the project-standard hook error layout (see contributing skill
# §"Hook error message format — repo standard").
build_message() {
  local headline="$1" do_this="$2" wrong="$3" if_this="$4" refs="$5" tag="${6:-[BLOCKED]}"
  cat <<EOF
$tag $headline

──────────────────────────
Do this instead:
──────────────────────────
$do_this

──────────────────────────
What was wrong:
──────────────────────────
$wrong

──────────────────────────
If $if_this — read this:
──────────────────────────
References:
$refs
EOF
}

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

case "$TOOL_NAME" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
[ -z "$FILE_PATH" ] && exit 0

CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")

# Canonicalize both paths so the contribution-surface check is robust to
# symlinked roots — macOS resolves /var/... → /private/var/... via
# `git rev-parse`, and the harness emits the un-resolved path. Without
# this, prefix matching silently drops legitimate-but-symlinked edits.
canonicalize() {
  python3 -c "import os, sys; print(os.path.realpath(sys.argv[1]))" "$1" 2>/dev/null || printf '%s' "$1"
}
REPO_ROOT_REAL=$(canonicalize "$REPO_ROOT")
FILE_PATH_REAL=$(canonicalize "$FILE_PATH")

# --- scope guard: are we editing THIS package's repo? ---
PKG_JSON="$REPO_ROOT_REAL/package.json"
[ -f "$PKG_JSON" ] || exit 0
if ! grep -qE '"name"[[:space:]]*:[[:space:]]*"@civitas-cerebrum/element-interactions"' "$PKG_JSON" 2>/dev/null; then
  exit 0
fi

# --- contribution surface classification ---
# Resolve the file path relative to REPO_ROOT so the surface check is
# robust to absolute paths emitted by the harness. Files outside REPO_ROOT
# are treated as out-of-scope.
case "$FILE_PATH_REAL" in
  "$REPO_ROOT_REAL"/*) REL="${FILE_PATH_REAL#$REPO_ROOT_REAL/}" ;;
  /*)                  exit 0 ;;
  *)                   REL="$FILE_PATH_REAL" ;;
esac

IN_SURFACE=0
case "$REL" in
  src/*|hooks/*|skills/*|scripts/*) IN_SURFACE=1 ;;
  package.json|tsconfig.json|tsconfig.*.json) IN_SURFACE=1 ;;
  .github/*) IN_SURFACE=1 ;;
esac

# Editing the contributing skill itself is exempt — that IS reading it.
case "$REL" in
  skills/contributing-to-element-interactions/*) exit 0 ;;
esac

[ "$IN_SURFACE" -eq 0 ] && exit 0

# --- evidence-of-load check ---
# Need a transcript to verify. If the harness didn't supply one, allow
# (better than fail-closed on a harness limitation).
[ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ] && exit 0

# Two acceptable signals:
#   1. A Read tool call against the SKILL.md path (any prefix).
#   2. A Skill tool invocation naming the skill.
SKILL_REL="skills/contributing-to-element-interactions/SKILL.md"
LOADED=0
if grep -qF "$SKILL_REL" "$TRANSCRIPT_PATH" 2>/dev/null; then
  LOADED=1
fi
if [ "$LOADED" -eq 0 ] && grep -qE '"contributing-to-element-interactions"' "$TRANSCRIPT_PATH" 2>/dev/null; then
  LOADED=1
fi

[ "$LOADED" -eq 1 ] && exit 0

# --- emit deny / warn ---
DO_THIS=""
DO_THIS+="  Option A — load the contributing skill via the Skill tool"$'\n'
DO_THIS+="    Skill(skill=\"contributing-to-element-interactions\")"$'\n'
DO_THIS+="    Then re-issue your edit. The skill encodes the architecture, the"$'\n'
DO_THIS+="    API-vs-structural-gap distinction, the hard rules, and the design"$'\n'
DO_THIS+="    invariants every contribution must respect."$'\n'
DO_THIS+=""$'\n'
DO_THIS+="  Option B — read the SKILL.md directly"$'\n'
DO_THIS+="    Read(\"$REPO_ROOT_REAL/$SKILL_REL\")"$'\n'
DO_THIS+="    Then re-issue your edit."$'\n'
DO_THIS+=""$'\n'
DO_THIS+="  Option C — this edit is genuinely unrelated to package work"$'\n'
DO_THIS+="    Set CONTRIBUTING_SKILL_PREREAD_GUARD=off for the invocation."$'\n'
DO_THIS+="    Use sparingly — the surface check (src/, hooks/, skills/,"$'\n'
DO_THIS+="    scripts/, package.json, tsconfig.json, .github/) is already"$'\n'
DO_THIS+="    narrow; if you hit this gate, you are almost certainly editing"$'\n'
DO_THIS+="    the package."

WRONG=""
WRONG+="File: $REL"$'\n'
WRONG+="Repo: $REPO_ROOT_REAL (package.json name = @civitas-cerebrum/element-interactions)"$'\n'
WRONG+="Contribution surface: matched"$'\n'
WRONG+="Contributing skill loaded this session: NO"$'\n'
WRONG+="  Looked for: \"$SKILL_REL\" in transcript Read calls,"$'\n'
WRONG+="              or \"contributing-to-element-interactions\" in Skill invocations."$'\n'
WRONG+=""$'\n'
WRONG+="The contributing skill is the canonical brief for editing this"$'\n'
WRONG+="package: it explains where new APIs go, what hard rules apply,"$'\n'
WRONG+="and how to tell an API gap from a structural gap. Editing the"$'\n'
WRONG+="package without it is editing blind, and is the documented"$'\n'
WRONG+="failure pattern behind several past regressions."

REFS=""
REFS+="  $SKILL_REL"$'\n'
REFS+="  hooks/contributing-skill-preread-guard.sh (this hook header)"
REFS="${REFS%$'\n'}"

HEADLINE="contributing skill not loaded — refusing to edit package source ($REL)."
IF_THIS="you started editing the package without first loading the contributing skill"

if [ "$MODE" = "deny" ]; then
  msg=$(build_message "$HEADLINE" "$DO_THIS" "$WRONG" "$IF_THIS" "$REFS" "[BLOCKED]")
  emit_deny "$msg"
else
  msg=$(build_message "$HEADLINE" "$DO_THIS" "$WRONG" "$IF_THIS" "$REFS" "[NUDGE]")
  emit_warn "$msg"
fi
exit 0
