#!/bin/bash
# Edge-case tests for hooks/contributing-skill-preread-guard.sh
#
# Default mode is DENY: editing this package's contribution surface
# without first having loaded skills/contributing-to-element-interactions/
# SKILL.md in the current session blocks the edit. The scope guard
# narrows enforcement to the package's own repo (detected via
# package.json name).
#
# Coverage:
#   - tool-name filtering (only Edit | Write | MultiEdit fire)
#   - scope guard: edits in non-package repos → silent allow
#   - contribution surface: which paths fire vs. don't
#   - editing the contributing skill itself is exempt
#   - skill loaded via Read of SKILL.md → ALLOW
#   - skill loaded via Skill tool invocation → ALLOW
#   - skill not loaded → DENY (default)
#   - WARN opt-down → systemMessage with [NUDGE] headline
#   - escape hatch (off → silent allow)

H="$HOOK_DIR/contributing-skill-preread-guard.sh"

# Run with a single env-var assignment for mode flips.
run_with_env() {
  local env_assignment="$1" hook="$2" stdin="$3"
  HOOK_EXIT=0
  HOOK_OUT=$(printf '%s' "$stdin" | env "$env_assignment" bash "$hook" 2>/dev/null) || HOOK_EXIT=$?
}

# Build a minimal element-interactions repo: package.json carrying the
# package name + the contributing SKILL.md at its canonical path.
make_pkg_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  printf '{\n  "name": "@civitas-cerebrum/element-interactions"\n}\n' > "$d/package.json"
  mkdir -p "$d/skills/contributing-to-element-interactions"
  echo "# Contributing skill" > "$d/skills/contributing-to-element-interactions/SKILL.md"
  mkdir -p "$d/src" "$d/hooks" "$d/scripts"
  echo "$d"
}

# Build a transcript JSONL with optional Read entries.
make_transcript() {
  local tf="$1"; shift
  : > "$tf"
  for p in "$@"; do
    printf '{"type":"tool_use","name":"Read","input":{"file_path":"%s"}}\n' "$p" >> "$tf"
  done
}

# Append a Skill tool invocation to a transcript file.
append_skill_use() {
  local tf="$1" skill_name="$2"
  printf '{"type":"tool_use","name":"Skill","input":{"skill":"%s"}}\n' "$skill_name" >> "$tf"
}

# --- tool-name filtering ---

section "contributing-skill-preread-guard: tool-name filtering"

REPO=$(make_pkg_repo)
TF="$REPO/.transcript"; make_transcript "$TF"
assert_allow "$H" "$(payload tool_name=Bash command='ls' cwd="$REPO" transcript_path="$TF")" \
  "Bash → silent allow"
assert_allow "$H" "$(payload tool_name=Read file_path="$REPO/src/x.ts" cwd="$REPO" transcript_path="$TF")" \
  "Read → silent allow"
rm -rf "$REPO"

# --- scope guard: not in package repo ---

section "contributing-skill-preread-guard: scope guard — non-package repo silent-allows"

REPO=$(mktemp -d); ( cd "$REPO" && git init -q )
printf '{\n  "name": "some-consumer-app"\n}\n' > "$REPO/package.json"
mkdir -p "$REPO/src"
TF="$REPO/.transcript"; make_transcript "$TF"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/src/index.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "consumer repo (different package name) → silent allow"
rm -rf "$REPO"

# Repo without package.json at all.
REPO=$(mktemp -d); ( cd "$REPO" && git init -q )
mkdir -p "$REPO/src"
TF="$REPO/.transcript"; make_transcript "$TF"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/src/index.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "no package.json → silent allow"
rm -rf "$REPO"

# --- contribution surface: in-scope vs out-of-scope paths ---

section "contributing-skill-preread-guard: contribution surface — non-surface edits silent-allow"

REPO=$(make_pkg_repo)
TF="$REPO/.transcript"; make_transcript "$TF"

assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/README.md" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "README.md edit (out of surface) → silent allow"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/CHANGELOG.md" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "CHANGELOG.md edit (out of surface) → silent allow"
assert_allow "$H" "$(payload tool_name=Write file_path="$REPO/notes.txt" content='note' cwd="$REPO" transcript_path="$TF")" \
  "arbitrary text file (out of surface) → silent allow"

rm -rf "$REPO"

# --- editing the contributing skill itself is exempt ---

section "contributing-skill-preread-guard: editing the contributing skill itself is exempt"

REPO=$(make_pkg_repo)
TF="$REPO/.transcript"; make_transcript "$TF"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/skills/contributing-to-element-interactions/SKILL.md" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "edit the contributing SKILL.md itself → silent allow (exempt)"
rm -rf "$REPO"

# --- DENY default: in-surface edit without skill loaded ---

section "contributing-skill-preread-guard: in-surface edit without skill loaded → DENY (default)"

REPO=$(make_pkg_repo)
TF="$REPO/.transcript"; make_transcript "$TF"

assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/src/index.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "src/ edit, skill not loaded → DENY" "[BLOCKED]"
assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/hooks/new-guard.sh" content='#!/bin/bash' cwd="$REPO" transcript_path="$TF")" \
  "hooks/ write, skill not loaded → DENY" "[BLOCKED]"
assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/scripts/postinstall.js" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "scripts/ edit, skill not loaded → DENY" "[BLOCKED]"
assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/package.json" new_string='{}' cwd="$REPO" transcript_path="$TF")" \
  "package.json edit, skill not loaded → DENY" "[BLOCKED]"
assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/skills/test-composer/SKILL.md" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "other skills/ edit, skill not loaded → DENY" "[BLOCKED]"

rm -rf "$REPO"

# --- ALLOW when skill was loaded via Read ---

section "contributing-skill-preread-guard: skill loaded via Read → ALLOW"

REPO=$(make_pkg_repo)
TF="$REPO/.transcript"; make_transcript "$TF" \
  "$REPO/skills/contributing-to-element-interactions/SKILL.md"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/src/index.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "skill Read in transcript → silent allow"
rm -rf "$REPO"

# --- ALLOW when skill was loaded via Skill tool ---

section "contributing-skill-preread-guard: skill loaded via Skill tool → ALLOW"

REPO=$(make_pkg_repo)
TF="$REPO/.transcript"; make_transcript "$TF"
append_skill_use "$TF" "contributing-to-element-interactions"
assert_allow "$H" "$(payload tool_name=Edit file_path="$REPO/src/index.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" \
  "Skill(\"contributing-to-element-interactions\") in transcript → silent allow"
rm -rf "$REPO"

# --- WARN opt-down ---

section "contributing-skill-preread-guard: WARN opt-down (env CONTRIBUTING_SKILL_PREREAD_GUARD=warn)"

REPO=$(make_pkg_repo)
TF="$REPO/.transcript"; make_transcript "$TF"

TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "CONTRIBUTING_SKILL_PREREAD_GUARD=warn" "$H" \
  "$(payload tool_name=Edit file_path="$REPO/src/index.ts" new_string='x' cwd="$REPO" transcript_path="$TF")"
msg=$(echo "$HOOK_OUT" | jq -r '.systemMessage // empty')
if [ -n "$msg" ] && echo "$msg" | grep -q '\[NUDGE\]'; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} CONTRIBUTING_SKILL_PREREAD_GUARD=warn → systemMessage ([NUDGE])"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("warn mode: msg=${msg:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} CONTRIBUTING_SKILL_PREREAD_GUARD=warn → systemMessage ([NUDGE])"
fi

rm -rf "$REPO"

# --- escape hatch ---

section "contributing-skill-preread-guard: escape hatch"

REPO=$(make_pkg_repo)
TF="$REPO/.transcript"; make_transcript "$TF"

TESTS_RUN=$((TESTS_RUN + 1))
run_with_env "CONTRIBUTING_SKILL_PREREAD_GUARD=off" "$H" \
  "$(payload tool_name=Edit file_path="$REPO/src/index.ts" new_string='x' cwd="$REPO" transcript_path="$TF")"
if [ -z "$HOOK_OUT" ] && [ "$HOOK_EXIT" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} CONTRIBUTING_SKILL_PREREAD_GUARD=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("escape hatch: expected silent allow, got: exit=$HOOK_EXIT output=${HOOK_OUT:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} CONTRIBUTING_SKILL_PREREAD_GUARD=off → silent allow"
fi

rm -rf "$REPO"

# --- DENY-mode standard layout ---

section "contributing-skill-preread-guard: DENY-mode message layout"

REPO=$(make_pkg_repo)
TF="$REPO/.transcript"; make_transcript "$TF"

TESTS_RUN=$((TESTS_RUN + 1))
out=$(printf '%s' "$(payload tool_name=Edit file_path="$REPO/src/index.ts" new_string='x' cwd="$REPO" transcript_path="$TF")" | bash "$H" 2>/dev/null || true)
reason=$(echo "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
ok=1
for header in "[BLOCKED]" "Do this instead:" "What was wrong:" "References:"; do
  echo "$reason" | grep -qF "$header" || ok=0
done
if [ "$ok" -eq 1 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} DENY message carries [BLOCKED] / Do this instead / What was wrong / References"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("layout: missing one of [BLOCKED]/Do this instead/What was wrong/References — ${reason:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} DENY message carries [BLOCKED] / Do this instead / What was wrong / References"
fi

rm -rf "$REPO"
