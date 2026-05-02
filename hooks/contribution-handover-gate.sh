#!/bin/bash
# contribution-handover-gate.sh — guardrail check before push / PR open
#
# Hook    : PreToolUse:Bash  (filters to `git push origin <branch>` and
#           `gh pr create` invocations only)
# Mode    : DENY (the handover signs off on every guardrail in
#           skills/contributing-to-element-interactions/SKILL.md — pushing or
#           opening a PR without one short-circuits the gate suite)
# State   : reads `.contribution-handover.json` from the repo root
# Env     : none
#
# Rule
# ----
# Every PR against @civitas-cerebrum/element-interactions ships a populated
# `.contribution-handover.json`. The file maps 1:1 to the hard-rule + design-
# rule index in the contributing skill (preflight, design, tests, build,
# coverage, docs, version). Each guardrail is a boolean (or "n/a" when the
# rule does not apply); every `false` / `"n/a"` requires a paired
# `<field>Reason` justification.
#
# This gate intercepts the moment a contributor goes to share their work
# (push to origin / open a PR) and confirms:
#   1. `.contribution-handover.json` exists.
#   2. It parses as JSON.
#   3. Every required field is present.
#   4. No required boolean is left at the template's `null` placeholder.
#   5. Every `false` / `"n/a"` value has a non-empty paired `*Reason`.
#   6. Spot-check: README claim is consistent with the README diff vs. origin/main.
#   7. Spot-check: version.from / version.to match package.json diff vs. origin/main.
#
# Why
# ---
# The contributing skill has 19 design rules + 8 hard rules. A markdown
# checklist can be ticked without verification, and rules drift (commit
# d2f200e shipped HTML extraction without README updates because the README
# rule was soft). A structured handover with mismatched claims fails this
# gate; old handovers fail validation when the schema gains fields.
#
# Canonical reference
# -------------------
# skills/contributing-to-element-interactions/SKILL.md §"Contribution Handover"
# schemas/contribution-handover.schema.json
# .contribution-handover.template.json
#
# Failure → action
# ----------------
# - File missing                     → DENY
# - Invalid JSON                     → DENY
# - Required field missing/null      → DENY (lists every unset field)
# - false/"n/a" without *Reason      → DENY (lists every offender)
# - Vague reason (< 20 chars)        → DENY
# - readmeUpdated mismatches diff    → DENY
# - version.from/to mismatch diff    → DENY
# - All checks pass                  → silent allow
#
# Wiring (~/.claude/settings.json)
# --------------------------------
#   "PreToolUse": [
#     { "matcher": "Bash", "hooks": [
#         { "type": "command",
#           "command": "/path/to/repo/hooks/contribution-handover-gate.sh",
#           "timeout": 10 } ] }
#   ]
#
# Error message format
# --------------------
# Every DENY follows the project-standard hook error layout (see
# skills/contributing-to-element-interactions/SKILL.md §"Hook error
# message format"):
#
#   [BLOCKED] <one-line headline>
#
#   ──────────────────────────
#   Do this instead:
#   ──────────────────────────
#     Option A — <case>
#       <concrete template / command>
#     Option B — <other case>
#       <concrete next step>
#
#   ──────────────────────────
#   What was wrong:
#   ──────────────────────────
#   File: <path>
#   <observed values>
#   <one-paragraph why it matters>
#
#   ──────────────────────────
#   If <common motivation> — read this:
#   ──────────────────────────
#   <pointer to the upstream fix>
#
#   References:
#     <canonical docs>

set -euo pipefail

emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# build_message <headline> <do-this-instead> <what-was-wrong> <if-this-then> <references>
# Renders the project-standard hook error layout. Every section header is the
# same string of box-drawing characters so contributors see a familiar shape
# regardless of which hook fired.
build_message() {
  local headline="$1" do_this="$2" wrong="$3" if_this="$4" refs="$5"
  cat <<EOF
[BLOCKED] $headline

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
  skills/contributing-to-element-interactions/SKILL.md §"Contribution Handover"
  schemas/contribution-handover.schema.json
  .contribution-handover.template.json
EOF
)

# --- input ---
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Filter: only fire on `git push origin <branch>` or `gh pr create`.
# `git push` without `origin` (e.g. `git push fork`, `git push --dry-run`)
# is intentionally not gated — the gate is about *sharing intent*, and
# pushing to a personal fork is noisy iteration, not the share point.
is_share_action=0
if echo "$CMD" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+push[[:space:]]+origin([[:space:]]|$)'; then
  is_share_action=1
fi
if echo "$CMD" | grep -qE '(^|[;&|][[:space:]]*)gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'; then
  is_share_action=1
fi
[ "$is_share_action" -eq 0 ] && exit 0

# --- locate the repo root + handover file ---
# Test override: when CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR is set, we skip
# the git/package detection and read everything from the fixture dir. This
# lets the hook test harness drive every branch without needing a real git
# tree per case. See hooks/tests/cases/06-contribution-handover-gate.sh.
if [ -n "${CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR:-}" ]; then
  REPO_ROOT="$CONTRIBUTION_HANDOVER_TEST_FIXTURE_DIR"
  TEST_MODE=1
else
  TEST_MODE=0
  # We use `git rev-parse --show-toplevel` against the agent's CWD. If we're
  # not in a git repo, silently allow — the gate is scoped to this repo's
  # contributors. The Claude Code harness sets cwd to the project root.
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
  [ -z "$REPO_ROOT" ] && exit 0

  # Only fire inside the element-interactions repo. We detect by checking
  # for the package.json `name` field. Don't accidentally gate other repos
  # a contributor might be working in with the same harness config.
  PKG_NAME=$(jq -r '.name // empty' "$REPO_ROOT/package.json" 2>/dev/null || true)
  [ "$PKG_NAME" != "@civitas-cerebrum/element-interactions" ] && exit 0
fi

HANDOVER="$REPO_ROOT/.contribution-handover.json"

# --- check 1: file exists ---
if [ ! -f "$HANDOVER" ]; then
  msg=$(build_message \
"Contribution handover missing — cannot push or open a PR without it." \
"  Option A — first PR on this branch
    cp .contribution-handover.template.json .contribution-handover.json
    # fill every field with true / false / \"n/a\"; pair every false / \"n/a\"
    # with a >= 20-char <field>Reason in the same section
    git add .contribution-handover.json && git commit -m \"chore: contribution handover\"

  Option B — handover already on another branch
    git checkout <other-branch> -- .contribution-handover.json
    # then re-edit for this PR's claims and recommit" \
"File: $HANDOVER (does not exist)
The handover is the structured sign-off that maps 1:1 to the hard-rule and
design-rule index in the contributing skill. Without it the gate suite has
no anchor to validate against — a markdown checklist can be ticked without
verification, but a missing handover makes the omission visible." \
"this is your first contribution to this package" \
"$REFS")
  emit_deny "$msg"
  exit 0
fi

# --- check 2: valid JSON ---
if ! jq empty "$HANDOVER" >/dev/null 2>&1; then
  parse_err=$(jq empty "$HANDOVER" 2>&1 || true)
  msg=$(build_message \
"Contribution handover is not valid JSON." \
"  Option A — view the parse error
    jq empty .contribution-handover.json
  Option B — start fresh
    cp .contribution-handover.template.json .contribution-handover.json
    # then re-fill" \
"File: $HANDOVER
Parse error:
${parse_err}

The hook treats handover absence and handover corruption as the same
class of failure — the gate has nothing to validate either way." \
"you edited the handover by hand and a quote / comma is mismatched" \
"$REFS")
  emit_deny "$msg"
  exit 0
fi

# --- check 3 + 4 + 5: required fields populated and justified ---
# Every checkOrReason field must be true, false, or "n/a". `null` (the
# template placeholder) is the most common failure — it indicates the file
# was committed unfilled.
#
# Every false / "n/a" requires a paired *Reason field of at least 20 chars
# to defeat "n/a" / "skip" / "later" answers.

REQUIRED_PATHS=$(cat <<'EOF'
preflight.branchSyncedWithMain
preflight.duplicateIssuesSearched
preflight.duplicatePRsSearched
preflight.depVersionsChecked
design.argumentOrderConvention
design.asyncEverywhere
design.stepsKeptLightweight
design.namingConvention
design.noRawLocatorInSrc
design.presenceDetectInActions
design.webOnlyCastAtSite
design.errorMessageFormatFollowed
design.loggingPresent
design.typescriptDiscipline
tests.implemented
tests.exerciseRealVueApp
tests.nonTautologicalAssertions
tests.passing
build.buildPasses
build.fullSuitePassing
coverage.apiCoverageGate100
docs.readmeUpdated
docs.apiReferenceUpdated
docs.skillFilesUpdated
version.patchBumpedOnce
EOF
)

UNSET_FIELDS=()
UNJUSTIFIED_FIELDS=()

while IFS= read -r path; do
  [ -z "$path" ] && continue
  value=$(jq -r --arg p "$path" 'getpath($p | split(".")) | tojson' "$HANDOVER" 2>/dev/null || echo "null")

  if [ "$value" = "null" ]; then
    UNSET_FIELDS+=("$path")
    continue
  fi

  if [ "$value" = "false" ] || [ "$value" = '"n/a"' ]; then
    parent=$(echo "$path" | awk -F. '{print $1}')
    leaf=$(echo "$path" | awk -F. '{print $NF}')
    reason_path="$parent.${leaf}Reason"
    reason=$(jq -r --arg p "$reason_path" 'getpath($p | split(".")) // ""' "$HANDOVER" 2>/dev/null || echo "")
    if [ "${#reason}" -lt 20 ]; then
      UNJUSTIFIED_FIELDS+=("$path = $value (reason: \"${reason}\")")
    fi
  fi
done <<<"$REQUIRED_PATHS"

if [ "${#UNSET_FIELDS[@]}" -gt 0 ]; then
  unset_list=""
  for f in "${UNSET_FIELDS[@]}"; do
    unset_list+="  - $f"$'\n'
  done
  msg=$(build_message \
"Contribution handover has unset fields (still null from the template)." \
"  Option A — sign off as compliant
    Set the field to true (in .contribution-handover.json).
  Option B — sign off as exempt
    Set the field to false or \"n/a\" AND add a paired <field>Reason in
    the same section, with >= 20 chars of justification.
  Example
    \"docs\": { \"readmeUpdated\": \"n/a\",
      \"readmeUpdatedReason\": \"internal-only addition to Verifications, no public Steps surface\" }" \
"File: $HANDOVER
Unset fields:
${unset_list}
Every required field must be a boolean or \"n/a\" before the gate will let
you push. The template uses null as a placeholder so a forgotten field
fails loudly instead of silently passing." \
"you copied the template and forgot to fill some fields" \
"$REFS")
  emit_deny "$msg"
  exit 0
fi

if [ "${#UNJUSTIFIED_FIELDS[@]}" -gt 0 ]; then
  unjust_list=""
  for f in "${UNJUSTIFIED_FIELDS[@]}"; do
    unjust_list+="  - $f"$'\n'
  done
  msg=$(build_message \
"Contribution handover has false / \"n/a\" fields without justification." \
"  Option A — add a specific reason
    For each offender, populate <field>Reason (>= 20 chars). Example:
      \"design.presenceDetectInActions\": \"n/a\",
      \"design.presenceDetectInActionsReason\": \"PR adds a verification only — no new action methods on Element\"
  Option B — flip the claim to true
    If you can verify the rule does apply, sign off as true and remove
    any reason field." \
"File: $HANDOVER
Fields with vague / missing reasons (< 20 chars):
${unjust_list}
The 20-char floor blocks one-word answers (\"n/a\", \"skip\", \"later\")
that turn the handover into a checkbox exercise. Reviewers should be able
to read each reason and understand the exemption without context." \
"you set a field to false / \"n/a\" but didn't write a real reason" \
"$REFS")
  emit_deny "$msg"
  exit 0
fi

# --- check 6: README claim matches diff vs. origin/main ---
# Test mode: read the "README in diff" signal from a sentinel file in the
# fixture dir (presence == "yes, modified"). Production: ask git directly.
README_CLAIM=$(jq -r '.docs.readmeUpdated' "$HANDOVER" 2>/dev/null || echo "null")
README_IN_DIFF=0
if [ "$TEST_MODE" -eq 1 ]; then
  [ -f "$REPO_ROOT/_README_IN_DIFF" ] && README_IN_DIFF=1
else
  # Inclusive of uncommitted edits — the gate runs both before commit (where
  # the contributor is preparing the PR) and at push time (where everything
  # is committed). `git diff origin/main` covers both.
  if git -C "$REPO_ROOT" diff --name-only origin/main 2>/dev/null | grep -qE '^README\.md$'; then
    README_IN_DIFF=1
  fi
fi

if [ "$README_CLAIM" = "true" ] && [ "$README_IN_DIFF" -eq 0 ]; then
  msg=$(build_message \
"Handover claims docs.readmeUpdated: true but README.md is not in the diff vs. origin/main." \
"  Option A — actually update README.md
    Add the new method bullet under \"🛠️ API Reference: Steps\" in README.md
    (matching subsection: Interaction / Verification / Data Extraction / etc.).
    git add README.md && git commit
  Option B — flip the claim
    If this PR is internal-only or a refactor with no new public surface,
    set:
      \"docs.readmeUpdated\": \"n/a\",
      \"docs.readmeUpdatedReason\": \"<specific reason — e.g. internal Verifications change, no Steps surface added>\"" \
"File: $HANDOVER
Claim:    docs.readmeUpdated: true
Diff:     README.md NOT modified vs. origin/main
Rule 19 of the contributing skill makes README updates mandatory for any
new public method on Steps / ElementAction / matcher tree. The previous
soft rule produced silent doc drift (e.g. d2f200e shipped HTML extraction
without README updates), so the gate cross-checks the claim against the
actual diff." \
"you ticked the box without updating the file" \
"$REFS")
  emit_deny "$msg"
  exit 0
fi

if { [ "$README_CLAIM" = "false" ] || [ "$README_CLAIM" = "n/a" ]; } && [ "$README_IN_DIFF" -eq 1 ]; then
  msg=$(build_message \
"Handover claims docs.readmeUpdated: $README_CLAIM but README.md *is* modified in the branch." \
"  Option A — accept the change
    Set:
      \"docs.readmeUpdated\": true
    and remove docs.readmeUpdatedReason if present.
  Option B — revert the README change
    If the README diff is unintentional (e.g. a pre-commit auto-formatter):
      git checkout origin/main -- README.md && git commit -m \"revert: undo accidental README change\"" \
"File: $HANDOVER
Claim:    docs.readmeUpdated: $README_CLAIM
Diff:     README.md IS modified vs. origin/main
The mismatch usually means either an auto-edit slipped in (which should be
reverted) or the contributor forgot to update the claim after editing the
README. Either way, claim and reality must agree." \
"a tool or auto-formatter modified README.md without your noticing" \
"$REFS")
  emit_deny "$msg"
  exit 0
fi

# --- check 7: version.from / to match package.json diff ---
VERSION_BUMPED_CLAIM=$(jq -r '.version.patchBumpedOnce' "$HANDOVER" 2>/dev/null || echo "null")
if [ "$VERSION_BUMPED_CLAIM" = "true" ]; then
  CLAIM_FROM=$(jq -r '.version.from' "$HANDOVER" 2>/dev/null || echo "")
  CLAIM_TO=$(jq -r '.version.to' "$HANDOVER" 2>/dev/null || echo "")
  if [ "$TEST_MODE" -eq 1 ]; then
    ACTUAL_FROM=$(cat "$REPO_ROOT/_PKG_FROM" 2>/dev/null || echo "")
    ACTUAL_TO=$(cat "$REPO_ROOT/_PKG_TO" 2>/dev/null || echo "")
  else
    ACTUAL_FROM=$(git -C "$REPO_ROOT" show "origin/main:package.json" 2>/dev/null | jq -r '.version' 2>/dev/null || echo "")
    ACTUAL_TO=$(jq -r '.version' "$REPO_ROOT/package.json" 2>/dev/null || echo "")
  fi
  if [ -n "$ACTUAL_FROM" ] && [ -n "$ACTUAL_TO" ] && \
     { [ "$CLAIM_FROM" != "$ACTUAL_FROM" ] || [ "$CLAIM_TO" != "$ACTUAL_TO" ]; }; then
    msg=$(build_message \
"Handover version delta does not match package.json diff vs. origin/main." \
"  Option A — fix the handover claim
    \"version\": {
      \"patchBumpedOnce\": true,
      \"from\": \"$ACTUAL_FROM\",
      \"to\":   \"$ACTUAL_TO\"
    }
  Option B — fix the version bump
    npm version patch --no-git-tag-version
    # then re-update version.to in the handover" \
"File: $HANDOVER
Claim:    version $CLAIM_FROM → $CLAIM_TO
Actual:   version $ACTUAL_FROM → $ACTUAL_TO (per package.json diff vs. origin/main)
Rule 15 requires exactly one patch bump per PR. The cheap programmatic
spot-check protects against either (a) bumping multiple times on the same
branch, or (b) forgetting to bump and signing off as if you did." \
"you bumped multiple times or forgot to bump" \
"$REFS")
    emit_deny "$msg"
    exit 0
  fi
fi

# All checks passed — silent allow.
exit 0
