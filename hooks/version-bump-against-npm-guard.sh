#!/bin/bash
# version-bump-against-npm-guard.sh — keep `npm version <X>` aligned with the
# published latest, so parallel PRs collapse to a single monotonic ceiling.
#
# Hook    : PreToolUse:Bash  (filters to `npm version <X>` invocations only)
# Mode    : WARN-only — never blocks. The canonical compliance check is
#           reviewer judgement plus the contribution-handover-gate's
#           version-delta spot-check; this hook gives early visibility so
#           the contributor can self-correct before pushing.
# State   : none
# Env     : VERSION_BUMP_GUARD=off  → escape hatch (silent allow)
#
# Rule
# ----
# Rule 15 ("Patch-version one-PR-one-bump rule") in the contributing skill
# requires bumping the branch to `(npm-latest + 1 patch)`, not to
# `(current package.json + 1 patch)`. When multiple PRs are open in
# parallel, every branch bumping current+1 from its own diverged base
# produces version collisions on merge — bumping against npm-latest
# collapses all open branches to a known monotonic ceiling.
#
# This hook intercepts `npm version <X>` invocations (where X is an explicit
# semver, not the `patch` / `minor` / `major` keyword) and warns when the
# requested target either:
#   - is at-or-below the published latest (the bump is wasted / collides), or
#   - skips past `(latest + 1 patch)` by more than one patch (the bump
#     accidentally jumps minor/major when the contributor probably meant
#     patch).
#
# When `npm view` fails (no network, package never published), the hook
# silently allows with a one-line offline note — better to let the bump
# proceed than to block the contributor on a network failure.
#
# Why
# ---
# Markdown-only rules drift. The previous (collision-prone) recipe said
# `npm version patch` flat — and parallel PRs both bumped `0.3.6` → `0.3.7`,
# producing merge-time conflicts on the version field. A WARN hook here
# gives the contributor immediate feedback at the moment of the bump,
# instead of catching the collision at PR-review time.
#
# Canonical reference
# -------------------
# skills/contributing-to-element-interactions/SKILL.md §"Patch-version
# one-PR-one-bump rule" (Rule 15)
#
# Failure → action
# ----------------
# - `npm version patch` / `minor` / `major` keyword form        → silent allow
#   (the keyword form bumps from package.json — Rule 15 accepts this only as
#   the offline fallback, but the hook can't tell from the keyword alone
#   whether the contributor is online; warning here would be noisy)
# - `npm version <X>` where X <= npm-latest                     → WARN (bump
#   is at-or-below published latest — collision risk)
# - `npm version <X>` where X > npm-latest + 1 patch (skip)     → WARN (bump
#   skips versions — probably meant patch)
# - `npm version <X>` where X == npm-latest + 1 patch (canon)   → silent allow
# - `npm view` fails (offline / unpublished)                    → silent allow
# - Anything else                                               → silent allow

set -euo pipefail

# --- helpers ---
emit_warn() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}

# build_message <headline> <do-this-instead> <what-was-wrong> <if-this-then> <references>
# Renders the project-standard hook error layout (see contributing skill
# §"Hook error message format").
build_message() {
  local headline="$1" do_this="$2" wrong="$3" if_this="$4" refs="$5"
  cat <<EOF
[WARN] $headline

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

REFS=$(cat <<'EOF'
  skills/contributing-to-element-interactions/SKILL.md §"Patch-version one-PR-one-bump rule" (Rule 15)
  hooks/version-bump-against-npm-guard.sh (this hook header)
EOF
)

# --- escape hatch ---
if [ "${VERSION_BUMP_GUARD:-}" = "off" ]; then
  exit 0
fi

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Filter: fire only on `npm version <X>` where X is an explicit semver.
# Match `npm version` followed by a token that starts with a digit — that's
# the semver form. The keyword forms (patch / minor / major / prepatch / …)
# all start with a letter and are passed through silently.
#
# We also want to intercept the common one-liner shape:
#   npm version "$(npm view @pkg version | awk ...)" --no-git-tag-version
# In that case the literal command text contains `$(…)` rather than a
# resolved digit — let it through (the hook can't statically resolve a
# subshell, and the recipe in Rule 15 *is* the canonical good case).
TARGET=""
if echo "$CMD" | grep -qE '(^|[;&|][[:space:]]*)npm[[:space:]]+version[[:space:]]+'; then
  # Extract the first token after `npm version`. Strip surrounding quotes.
  TARGET=$(echo "$CMD" | sed -E 's/.*npm[[:space:]]+version[[:space:]]+//' | awk '{print $1}' | sed -E 's/^["'\'']//; s/["'\'']$//')
else
  exit 0
fi

# Subshell / variable expansion / keyword form → silent allow.
# Match: `$(...)` , `${...}` , bare keyword like `patch` / `minor` / `major`.
case "$TARGET" in
  ''|'$('*|'${'*) exit 0 ;;
esac
if ! echo "$TARGET" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+([+-].*)?$'; then
  # Not a plain X.Y.Z — could be `patch`, `from-git`, `prerelease`, etc.
  # Silent allow; outside this hook's scope.
  exit 0
fi

# --- look up npm-latest ---
# 2-second timeout so a hung registry call doesn't stall the bash hook.
# `timeout` is GNU coreutils on Linux; macOS ships `gtimeout` via brew, but
# we don't want to require it. Fall back to plain npm view; if it hangs the
# Claude Code harness will kill the hook on its own timeout.
LATEST=""
if command -v timeout >/dev/null 2>&1; then
  LATEST=$(timeout 2s npm view @civitas-cerebrum/element-interactions version 2>/dev/null || true)
else
  LATEST=$(npm view @civitas-cerebrum/element-interactions version 2>/dev/null || true)
fi

# Trim whitespace.
LATEST=$(echo "$LATEST" | tr -d '[:space:]')

# Test override: if VERSION_BUMP_GUARD_TEST_LATEST is exported (even as an
# empty string), use it instead of calling npm. The empty-string case is
# the "offline / unpublished" branch that the test harness needs to drive
# deterministically. Use `[ "${VAR+set}" = "set" ]` to distinguish "set
# but empty" from "unset".
if [ "${VERSION_BUMP_GUARD_TEST_LATEST+set}" = "set" ]; then
  LATEST="$VERSION_BUMP_GUARD_TEST_LATEST"
fi

# Offline / unpublished — silent allow with a one-line note. Better to let
# the bump through than to block on a network failure.
if [ -z "$LATEST" ] || ! echo "$LATEST" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
  emit_warn "[WARN] version-bump-against-npm-guard: \`npm view\` returned no version (offline or unpublished). Allowing bump without verification — confirm \`$TARGET\` is correct against any other open PRs before pushing."
  exit 0
fi

# --- compare ---
# Parse latest into MAJOR.MINOR.PATCH (drop any prerelease/build suffix).
LATEST_CORE=$(echo "$LATEST" | sed -E 's/[+-].*$//')
IFS=. read -r L_MAJ L_MIN L_PAT <<< "$LATEST_CORE"

TARGET_CORE=$(echo "$TARGET" | sed -E 's/[+-].*$//')
IFS=. read -r T_MAJ T_MIN T_PAT <<< "$TARGET_CORE"

# Default-zero any missing field so arithmetic never trips.
L_MAJ=${L_MAJ:-0}; L_MIN=${L_MIN:-0}; L_PAT=${L_PAT:-0}
T_MAJ=${T_MAJ:-0}; T_MIN=${T_MIN:-0}; T_PAT=${T_PAT:-0}

# Helper: encode major/minor/patch as a single sortable integer. Each field
# is bounded at 4 digits (10000) — adequate for any realistic semver, and
# avoids any locale-dependent string comparison. If a field overflows
# (>9999) the comparison degrades but still WARN-only, never blocks.
encode() {
  local a="$1" b="$2" c="$3"
  echo $(( a * 100000000 + b * 10000 + c ))
}

LATEST_NUM=$(encode "$L_MAJ" "$L_MIN" "$L_PAT")
TARGET_NUM=$(encode "$T_MAJ" "$T_MIN" "$T_PAT")
CANON_NUM=$(encode "$L_MAJ" "$L_MIN" "$((L_PAT + 1))")

# Canonical case → silent allow.
if [ "$TARGET_NUM" = "$CANON_NUM" ]; then
  exit 0
fi

# At-or-below latest → WARN (collision risk).
if [ "$TARGET_NUM" -le "$LATEST_NUM" ]; then
  CANON="${L_MAJ}.${L_MIN}.$((L_PAT + 1))"
  msg=$(build_message \
"\`npm version $TARGET\` is at-or-below the published latest ($LATEST) — collision risk." \
"  Option A — bump against npm-latest (canonical, Rule 15)
    npm version $CANON --no-git-tag-version
  Option B — one-liner (recipe from contributing skill)
    npm version \"\$(npm view @civitas-cerebrum/element-interactions version | awk -F. '{print \$1\".\\\".\$2\".\\\".\$3+1}')\" --no-git-tag-version" \
"Requested:  $TARGET
npm-latest: $LATEST
When multiple PRs are open in parallel, every branch bumping at-or-below
the published ceiling produces version collisions on merge. Rule 15
collapses all open branches to npm-latest + 1 patch — a known monotonic
ceiling — so the first PR to merge sets the version and subsequent PRs
rebase + re-bump." \
"you bumped from package.json instead of from the published latest" \
"$REFS")
  emit_warn "$msg"
  exit 0
fi

# Above (latest + 1 patch) → WARN (skip / accidental minor or major).
if [ "$TARGET_NUM" -gt "$CANON_NUM" ]; then
  CANON="${L_MAJ}.${L_MIN}.$((L_PAT + 1))"
  msg=$(build_message \
"\`npm version $TARGET\` skips past npm-latest + 1 patch ($CANON)." \
"  Option A — patch bump (the common case, Rule 15)
    npm version $CANON --no-git-tag-version
  Option B — confirm minor/major
    If you actually intend a minor or major bump (breaking change /
    documented migration), proceed and call it out in the PR description
    + .contribution-handover.json so the reviewer doesn't think the skip
    is a typo." \
"Requested:  $TARGET
npm-latest: $LATEST
Canonical:  $CANON  (npm-latest + 1 patch)
Rule 15 expects exactly one patch above the published latest. A larger
gap usually means the contributor typed the wrong field — minor when they
meant patch, or two patch bumps stacked on the same branch — both of
which inflate the version number unnecessarily." \
"you bumped minor or major when you meant patch" \
"$REFS")
  emit_warn "$msg"
  exit 0
fi

# Defensive fallthrough — silent allow.
exit 0
