#!/bin/bash
# Test cases for hooks/contribution-doc-update-required.sh
#
# The hook intercepts `git commit` invocations, parses the staged diff for
# new public methods on `src/steps/{CommonSteps,ElementAction,ExpectMatchers}.ts`,
# and WARNs when the same staged diff doesn't also touch BOTH `README.md`
# and `skills/element-interactions/references/api-reference.md`.
#
# These tests stand up a temporary git repo per scenario, stage the
# scenario-specific files, then drive the hook with a payload whose `cwd`
# points at that repo.

H="$HOOK_DIR/contribution-doc-update-required.sh"

# --- helper: spin up a fresh git repo with a baseline commit ---
# Sets $CONTRIB_TMP_REPO to the path of the new repo. Caller is responsible
# for cleaning it up with `rm -rf "$CONTRIB_TMP_REPO"` once the case is done.
init_repo() {
  CONTRIB_TMP_REPO=$(mktemp -d)
  (
    cd "$CONTRIB_TMP_REPO" || exit 1
    git init -q
    git config user.email test@test.local
    git config user.name "test"
    git config commit.gpgsign false
    # Baseline commit so HEAD exists for `git diff --cached` to compare against.
    git commit --allow-empty -m init -q
  )
}

cleanup_repo() {
  [ -n "${CONTRIB_TMP_REPO:-}" ] && rm -rf "$CONTRIB_TMP_REPO"
  CONTRIB_TMP_REPO=""
}

# --- helper: write a file under the temp repo, optionally relative ---
# Usage: write_file_in_repo <relative-path> <content>
write_file_in_repo() {
  local rel="$1" content="$2"
  local full="$CONTRIB_TMP_REPO/$rel"
  mkdir -p "$(dirname "$full")"
  printf '%s\n' "$content" > "$full"
}

# --- helper: stage a file in the temp repo ---
stage_file() {
  ( cd "$CONTRIB_TMP_REPO" && git add "$1" )
}

# --- helper: build a payload with cwd pointing at the temp repo ---
# Usage: contrib_payload <command-string>
contrib_payload() {
  payload tool_name=Bash cwd="$CONTRIB_TMP_REPO" command="$1"
}

# --- baseline content writers ---
# Set up a class file with one existing method as the baseline that
# subsequent staged diffs add against. We commit this baseline so
# `git diff --cached` only sees the new additions.
init_repo_with_baseline_src() {
  init_repo
  write_file_in_repo "src/steps/CommonSteps.ts" "class Steps {
  async existing(): Promise<void> {}
}"
  write_file_in_repo "src/steps/ElementAction.ts" "class ElementAction {
  async existing(): Promise<void> {}
}"
  write_file_in_repo "src/steps/ExpectMatchers.ts" "class TextMatcher {
  async existing(): Promise<void> {}
}"
  write_file_in_repo "README.md" "# Project"
  write_file_in_repo "skills/element-interactions/references/api-reference.md" "# API Reference"
  (
    cd "$CONTRIB_TMP_REPO" || exit 1
    git add -A
    git commit -m baseline -q
  )
}

# ────────────────────────────────────────────────────────────────────────
section "contribution-doc-update-required: tool / command filtering"

# 1. Non-Bash tool → silent allow (filter at the very top of the hook).
assert_allow "$H" "$(payload tool_name=Read file_path='/x/file.ts')" "Read tool → silent allow"

# 2. Bash but not a git command → silent allow.
assert_allow "$H" "$(payload tool_name=Bash command='ls -la')" "Bash unrelated (ls) → silent allow"

# 3. Bash git but not `git commit` → silent allow.
assert_allow "$H" "$(payload tool_name=Bash command='git status')" "git status → silent allow"

# ────────────────────────────────────────────────────────────────────────
section "contribution-doc-update-required: plain commits with no public-API changes"

# 4. `git commit` with nothing staged in the monitored src files → silent allow.
init_repo
assert_allow "$H" "$(contrib_payload 'git commit -m "chore: housekeeping"')" "git commit with empty staged diff → silent allow"
cleanup_repo

# 5. `git commit` that stages an unrelated file → silent allow.
init_repo
write_file_in_repo "docs/notes.md" "Just docs."
stage_file "docs/notes.md"
assert_allow "$H" "$(contrib_payload 'git commit -m "docs: update notes"')" "git commit with non-monitored file → silent allow"
cleanup_repo

# ────────────────────────────────────────────────────────────────────────
section "contribution-doc-update-required: src/ public-API additions WITHOUT doc updates"

# 6. New public method on CommonSteps but no doc updates → WARN.
init_repo_with_baseline_src
write_file_in_repo "src/steps/CommonSteps.ts" "class Steps {
  async existing(): Promise<void> {}
  async newPublicMethod(arg: string): Promise<void> {
    return;
  }
}"
stage_file "src/steps/CommonSteps.ts"
assert_warn "$H" "$(contrib_payload 'git commit -m "feat: add newPublicMethod"')" "src/ change without docs → WARN" "without updating both required docs (Rule 19)"
cleanup_repo

# 7. New public method on ElementAction but no doc updates → WARN.
init_repo_with_baseline_src
write_file_in_repo "src/steps/ElementAction.ts" "class ElementAction {
  async existing(): Promise<void> {}
  async hoverAndWait(timeout: number): Promise<void> {
    return;
  }
}"
stage_file "src/steps/ElementAction.ts"
assert_warn "$H" "$(contrib_payload 'git commit -m "feat: add hoverAndWait"')" "ElementAction change without docs → WARN" "Rule 19"
cleanup_repo

# ────────────────────────────────────────────────────────────────────────
section "contribution-doc-update-required: src/ change WITH both doc updates"

# 8. New public method on CommonSteps AND both docs touched → silent allow.
init_repo_with_baseline_src
write_file_in_repo "src/steps/CommonSteps.ts" "class Steps {
  async existing(): Promise<void> {}
  async newPublicMethod(arg: string): Promise<void> {
    return;
  }
}"
write_file_in_repo "README.md" "# Project

## API Reference: Steps

- newPublicMethod(arg) — does the new thing."
write_file_in_repo "skills/element-interactions/references/api-reference.md" "# API Reference

- newPublicMethod(arg)"
stage_file "src/steps/CommonSteps.ts"
stage_file "README.md"
stage_file "skills/element-interactions/references/api-reference.md"
assert_allow "$H" "$(contrib_payload 'git commit -m "feat: add newPublicMethod with docs"')" "src/ change WITH both docs → silent allow"
cleanup_repo

# ────────────────────────────────────────────────────────────────────────
section "contribution-doc-update-required: only one doc updated → still WARN"

# 9. src/ change with only README staged → still WARN (api-reference missing).
init_repo_with_baseline_src
write_file_in_repo "src/steps/CommonSteps.ts" "class Steps {
  async existing(): Promise<void> {}
  async newPublicMethod(arg: string): Promise<void> {
    return;
  }
}"
write_file_in_repo "README.md" "# Project

## API Reference: Steps

- newPublicMethod(arg) — does the new thing."
stage_file "src/steps/CommonSteps.ts"
stage_file "README.md"
assert_warn "$H" "$(contrib_payload 'git commit -m "feat: add newPublicMethod"')" "only README, no api-reference → WARN" "skills/element-interactions/references/api-reference.md"
cleanup_repo

# 10. src/ change with only api-reference staged → still WARN (README missing).
init_repo_with_baseline_src
write_file_in_repo "src/steps/CommonSteps.ts" "class Steps {
  async existing(): Promise<void> {}
  async newPublicMethod(arg: string): Promise<void> {
    return;
  }
}"
write_file_in_repo "skills/element-interactions/references/api-reference.md" "# API Reference

- newPublicMethod(arg)"
stage_file "src/steps/CommonSteps.ts"
stage_file "skills/element-interactions/references/api-reference.md"
assert_warn "$H" "$(contrib_payload 'git commit -m "feat: add newPublicMethod"')" "only api-reference, no README → WARN" "README.md"
cleanup_repo

# ────────────────────────────────────────────────────────────────────────
section "contribution-doc-update-required: docs-only commit (no src/ diff) → silent allow"

# 11. Commit message describing API changes but no actual src/ diff (e.g.
# a docs-only commit cleaning up old wording) → silent allow.
init_repo_with_baseline_src
write_file_in_repo "README.md" "# Project

## API Reference: Steps

- existingMethod(arg) — clarified docstring."
stage_file "README.md"
assert_allow "$H" "$(contrib_payload 'git commit -m "docs: clarify newPublicMethod API surface"')" "docs-only commit (no src/ change) → silent allow despite API-shaped commit message"
cleanup_repo

# ────────────────────────────────────────────────────────────────────────
section "contribution-doc-update-required: env escape hatch"

# 12. CONTRIB_DOC_UPDATE_GUARD=off → silent allow even when a public-API
# addition is present without doc updates.
init_repo_with_baseline_src
write_file_in_repo "src/steps/CommonSteps.ts" "class Steps {
  async existing(): Promise<void> {}
  async newPublicMethod(arg: string): Promise<void> {
    return;
  }
}"
stage_file "src/steps/CommonSteps.ts"
TESTS_RUN=$((TESTS_RUN + 1))
HOOK_OUT=$(CONTRIB_DOC_UPDATE_GUARD=off bash "$H" <<<"$(contrib_payload 'git commit -m "feat: add newPublicMethod"')" 2>/dev/null) || true
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} CONTRIB_DOC_UPDATE_GUARD=off → silent allow (overrides WARN)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("CONTRIB_DOC_UPDATE_GUARD=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} CONTRIB_DOC_UPDATE_GUARD=off (expected silent allow)"
fi
cleanup_repo

# ────────────────────────────────────────────────────────────────────────
section "contribution-doc-update-required: error-message shape"

# Spot-check that the WARN message follows the project-standard hook error
# layout (headline, "Do this instead" block, "What was wrong" block,
# References).
init_repo_with_baseline_src
write_file_in_repo "src/steps/CommonSteps.ts" "class Steps {
  async existing(): Promise<void> {}
  async newPublicMethod(arg: string): Promise<void> {
    return;
  }
}"
stage_file "src/steps/CommonSteps.ts"
HOOK_OUT=$(bash "$H" <<<"$(contrib_payload 'git commit -m "feat: add newPublicMethod"')" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
MSG=$(echo "$HOOK_OUT" | jq -r '.systemMessage // ""' 2>/dev/null)
if echo "$MSG" | grep -q '\[WARN\]' \
  && echo "$MSG" | grep -q 'Do this instead' \
  && echo "$MSG" | grep -q 'What was wrong' \
  && echo "$MSG" | grep -q 'References' \
  && echo "$MSG" | grep -q 'Rule 19'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} WARN message follows project-standard hook error layout (Rule 19 cited)"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("error-message shape: expected [WARN] + 'Do this instead' + 'What was wrong' + 'References' + 'Rule 19'. msg=${MSG:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} error-message shape"
fi
cleanup_repo
