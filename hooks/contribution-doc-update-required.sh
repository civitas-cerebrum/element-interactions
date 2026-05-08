#!/bin/bash
# contribution-doc-update-required.sh — warn when a `git commit` adds new
# public API on Steps / ElementAction / matcher tree without also updating
# the canonical docs (README.md + skills/element-interactions/references/
# api-reference.md).
#
# Hook    : PreToolUse:Bash  (filters to `git commit` invocations only)
# Mode    : WARN-only — never blocks. Heuristic detection of "new public
#           method" produces enough false positives (private helper renames
#           that match the line shape, internal-only refactors that surface
#           a method-looking line, etc.) that surfacing the recommendation
#           is more valuable than denying the commit. Reviewer judgement
#           plus the contribution-handover-gate's `docs.*Updated` boolean
#           remain the canonical compliance check.
# State   : none
# Env     : CONTRIB_DOC_UPDATE_GUARD=off  → escape hatch (silent allow)
#
# Rule
# ----
# Rule 19 ("Doc updates are mandatory for new public API") in the
# contributing skill requires every PR that adds a new public method to
# `Steps`, `ElementAction`, the matcher tree, or a new public matcher
# class to update BOTH:
#   1. README.md — under the relevant `🛠️ API Reference: Steps` subsection.
#   2. skills/element-interactions/references/api-reference.md — under the
#      matching section. The api-reference is the canonical documentation
#      consumed by other skills (test-composer, coverage-expansion, bug-
#      discovery), so missing entries cause downstream agents to write
#      tests that drop out of the framework.
#
# The hook detects public API additions by parsing the staged diff
# (`git diff --cached`) for additions to `src/steps/CommonSteps.ts`,
# `src/steps/ElementAction.ts`, and `src/steps/ExpectMatchers.ts` that
# introduce a new public method (heuristic: a new line matching
# `^\s*(public\s+)?(async\s+)?[a-zA-Z_]\w*\s*[<(]` inside a class body).
# When public API additions are detected, the hook checks whether the same
# staged diff also touches BOTH `README.md` and the api-reference. If
# either is missing, it emits a `systemMessage` warning naming Rule 19,
# listing the detected new methods, and pointing at both required files.
#
# Why
# ---
# Markdown-only doc-update rules drift. The previous "headline-worthy"
# version of Rule 19 produced silent doc drift — the HTML extraction
# surface (commit `d2f200e`) shipped without a README entry, and
# downstream skills that consume `api-reference.md` had no record of the
# new surface. A WARN hook here gives the contributor immediate feedback
# at commit-time, instead of catching the gap at PR-review time when the
# branch has already collected three follow-up commits.
#
# Canonical reference
# -------------------
# skills/contributing-to-element-interactions/SKILL.md →
#   references/design-rules.md §"19. Doc updates are mandatory for new
#   public API"
#
# Failure → action
# ----------------
# - Tool != Bash                                                   → silent allow
# - Bash command not a `git commit`                                → silent allow
# - `git commit` with no public-API additions in the staged diff   → silent allow
# - `git commit` with public-API additions AND both docs touched   → silent allow
# - `git commit` with public-API additions AND README missing      → WARN
# - `git commit` with public-API additions AND api-reference miss  → WARN
# - `git commit` with public-API additions AND both docs missing   → WARN
# - CONTRIB_DOC_UPDATE_GUARD=off                                   → silent allow

set -uo pipefail

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
  skills/contributing-to-element-interactions/SKILL.md → references/design-rules.md §"19. Doc updates are mandatory for new public API"
  README.md (the user-facing reference under "🛠️ API Reference: Steps")
  skills/element-interactions/references/api-reference.md (the canonical doc consumed by downstream skills)
  hooks/contribution-doc-update-required.sh (this hook header)
EOF
)

# --- escape hatch ---
if [ "${CONTRIB_DOC_UPDATE_GUARD:-}" = "off" ]; then
  exit 0
fi

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Filter: only fire on `git commit` invocations.
if ! echo "$CMD" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

# Resolve cwd from the input payload; fall back to the process's own cwd.
CWD=$(echo "$INPUT" | jq -r '.cwd // ""')
[ -z "$CWD" ] && CWD="$(pwd)"

# --- gather staged diff ---
# Run all git commands with -C "$CWD" so we operate against the contributor's
# repo, not whatever directory the hook process happens to inherit.

# Public API source files we monitor for additions.
SRC_FILES=(
  "src/steps/CommonSteps.ts"
  "src/steps/ElementAction.ts"
  "src/steps/ExpectMatchers.ts"
)

# Doc files Rule 19 requires touching.
README_FILE="README.md"
API_REF_FILE="skills/element-interactions/references/api-reference.md"

# Names of staged files (one per line). Silent allow if the git call fails
# (not a git repo, no .git directory, etc.) — better than blocking the commit.
STAGED_FILES=$(git -C "$CWD" diff --cached --name-only 2>/dev/null || true)
if [ -z "$STAGED_FILES" ]; then
  # Empty staged diff (`git commit` with nothing staged, or git failed) — silent allow.
  exit 0
fi

# Filter to the monitored src files.
TOUCHED_SRC=()
for f in "${SRC_FILES[@]}"; do
  if echo "$STAGED_FILES" | grep -qxF "$f"; then
    TOUCHED_SRC+=("$f")
  fi
done

# If no monitored src files are staged, no public API can be added — silent allow.
if [ "${#TOUCHED_SRC[@]}" -eq 0 ]; then
  exit 0
fi

# --- detect new public method additions ---
# `git diff --cached -U0` gives us added lines (prefixed with `+`) without
# context. We scan each touched src file's diff for an added line matching
# the heuristic for a method declaration in a class body:
#
#   ^\+\s*(public\s+)?(async\s+)?[a-zA-Z_]\w*\s*[<(]
#
# Filter false positives: skip lines that look like control-flow keywords
# (`if (`, `for (`, `while (`, `return (`, `switch (`, `catch (`) or arrow-
# function method bodies (those don't introduce a new public method on the
# class). Diff hunk headers (`@@`) and metadata lines (`+++`) are filtered
# by the leading-whitespace requirement after the `+`.

NEW_METHODS=()
for f in "${TOUCHED_SRC[@]}"; do
  # Per-file added-line scan. -U0 = no surrounding context.
  ADDED=$(git -C "$CWD" diff --cached -U0 -- "$f" 2>/dev/null \
            | grep -E '^\+[[:space:]]+' \
            | grep -vE '^\+\+\+' \
            | sed -E 's/^\+//')
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    # Heuristic: line looks like a method declaration.
    # Match  `[whitespace](public )?(async )?<name>(` or `<name><` (generic).
    # Reject control-flow keywords up front.
    if echo "$line" | grep -qE '^[[:space:]]+(public[[:space:]]+)?(async[[:space:]]+)?[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*[<(]'; then
      # Strip leading whitespace + optional `public `/`async ` to get the candidate name.
      candidate=$(echo "$line" \
                    | sed -E 's/^[[:space:]]+//' \
                    | sed -E 's/^public[[:space:]]+//' \
                    | sed -E 's/^async[[:space:]]+//' \
                    | sed -E 's/^([a-zA-Z_][a-zA-Z0-9_]*).*/\1/')
      # Reject control-flow keywords.
      case "$candidate" in
        if|for|while|return|switch|catch|throw|do|else|case|new|typeof|void|yield|await|delete|in|of|instanceof|function|class|interface|type|enum|export|import|const|let|var|private|protected|readonly|static|get|set|constructor) continue ;;
      esac
      # Reject lines that are obviously not a method declaration (no
      # opening `{` later in the function head is fine — the line just has
      # to look like `name(...)` or `name<...>(...)`).
      NEW_METHODS+=("$f::$candidate")
    fi
  done <<< "$ADDED"
done

# Deduplicate (a method declaration spread across multiple lines could
# match the heuristic more than once; we only want one entry per name).
if [ "${#NEW_METHODS[@]}" -gt 0 ]; then
  # Use awk to dedupe while preserving order.
  DEDUPED=$(printf '%s\n' "${NEW_METHODS[@]}" | awk '!seen[$0]++')
  # Convert back to a sorted-ish unique list.
  NEW_METHODS=()
  while IFS= read -r line; do
    [ -n "$line" ] && NEW_METHODS+=("$line")
  done <<< "$DEDUPED"
fi

# If no public API additions detected, silent allow.
if [ "${#NEW_METHODS[@]}" -eq 0 ]; then
  exit 0
fi

# --- check doc updates ---
README_TOUCHED=false
API_REF_TOUCHED=false
if echo "$STAGED_FILES" | grep -qxF "$README_FILE"; then
  README_TOUCHED=true
fi
if echo "$STAGED_FILES" | grep -qxF "$API_REF_FILE"; then
  API_REF_TOUCHED=true
fi

# Both docs touched → silent allow.
if [ "$README_TOUCHED" = "true" ] && [ "$API_REF_TOUCHED" = "true" ]; then
  exit 0
fi

# --- emit warning ---
# Build the methods list for the diagnostic block.
METHODS_LIST=$(printf '  - %s\n' "${NEW_METHODS[@]}")

# Build the missing-files list.
MISSING=()
[ "$README_TOUCHED" = "false" ] && MISSING+=("$README_FILE")
[ "$API_REF_TOUCHED" = "false" ] && MISSING+=("$API_REF_FILE")
MISSING_LIST=$(printf '  - %s\n' "${MISSING[@]}")

DO_THIS="  Option A — add doc entries to this commit (canonical, Rule 19)
    Stage README.md and/or skills/element-interactions/references/api-reference.md
    with the new entries, then re-run \`git commit\`. One bullet per new
    method in each file; an inline code example block when the option
    shape is non-obvious (discriminated unions, multi-form matchers).
  Option B — confirm internal-only and proceed
    If the heuristic flagged a private helper / rename / non-public
    surface (false positive), proceed with the commit. Note the
    rationale in .contribution-handover.json under \`docs.readmeUpdated\`
    / \`docs.apiReferenceUpdated\` (set to \"n/a\" with the reason).
  Option C — bypass the warn (use sparingly)
    CONTRIB_DOC_UPDATE_GUARD=off git commit -m \"...\""

WRONG="Detected public API additions on the monitored src files:
${METHODS_LIST}
Missing doc updates in this commit:
${MISSING_LIST}
Rule 19 requires both README.md AND skills/element-interactions/references/
api-reference.md to be updated whenever a new public method lands on
\`Steps\` / \`ElementAction\` / the matcher tree. Missing entries in the
api-reference cause downstream skills (test-composer, coverage-expansion,
bug-discovery) to write tests that drop out of the framework, because
the api-reference is their canonical surface inventory."

IF_THIS="you intended an internal-only change (e.g. a rename, a private
helper, a refactor that touched a public file but didn't add public surface)"

msg=$(build_message \
"\`git commit\` adds new public API on Steps/ElementAction/matcher tree without updating both required docs (Rule 19)." \
"$DO_THIS" \
"$WRONG" \
"$IF_THIS" \
"$REFS")

emit_warn "$msg"
exit 0
