#!/bin/bash
H="$HOOK_DIR/npm-install-foreground-scripts-hint.sh"

# Each test sets up its own temp repo so the per-CWD sentinel is isolated.
make_repo_with_dep() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  cat > "$d/package.json" <<'EOF'
{
  "name": "consumer",
  "version": "1.0.0",
  "devDependencies": {
    "@civitas-cerebrum/element-interactions": "^0.3.0"
  }
}
EOF
  echo "$d"
}

make_repo_without_dep() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  cat > "$d/package.json" <<'EOF'
{
  "name": "unrelated",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.0.0"
  }
}
EOF
  echo "$d"
}

section "npm-install-foreground-scripts-hint: tool / command filtering"

REPO=$(make_repo_with_dep)
assert_allow "$H" "$(payload tool_name=Read file_path='/x' cwd="$REPO")" "Read → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='ls' cwd="$REPO")" "non-npm command → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='git status' cwd="$REPO")" "git command → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm test' cwd="$REPO")" "npm test (not install) → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm run install-something' cwd="$REPO")" "npm run … (not install verb) → silent allow"
rm -rf "$REPO"

section "npm-install-foreground-scripts-hint: project does not depend on package → silent allow"

REPO=$(make_repo_without_dep)
assert_allow "$H" "$(payload tool_name=Bash command='npm install' cwd="$REPO")" "npm install in unrelated project → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm i' cwd="$REPO")" "npm i in unrelated project → silent allow"
rm -rf "$REPO"

section "npm-install-foreground-scripts-hint: --foreground-scripts already present → silent allow"

REPO=$(make_repo_with_dep)
assert_allow "$H" "$(payload tool_name=Bash command='npm install --foreground-scripts' cwd="$REPO")" "npm install --foreground-scripts → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm i --foreground-scripts' cwd="$REPO")" "npm i --foreground-scripts → silent allow"
assert_allow "$H" "$(payload tool_name=Bash command='npm install --foreground-scripts=true' cwd="$REPO")" "npm install --foreground-scripts=true → silent allow"
rm -rf "$REPO"

section "npm-install-foreground-scripts-hint: WARN when flag missing in dep'd project"

REPO=$(make_repo_with_dep)
assert_warn "$H" "$(payload tool_name=Bash command='npm install' cwd="$REPO")" "npm install without flag → WARN" "--foreground-scripts"
rm -rf "$REPO"

REPO=$(make_repo_with_dep)
assert_warn "$H" "$(payload tool_name=Bash command='npm i' cwd="$REPO")" "npm i without flag → WARN" "--foreground-scripts"
rm -rf "$REPO"

REPO=$(make_repo_with_dep)
assert_warn "$H" "$(payload tool_name=Bash command='npm install some-other-package' cwd="$REPO")" "npm install <pkg> without flag → WARN" "--foreground-scripts"
rm -rf "$REPO"

section "npm-install-foreground-scripts-hint: per-CWD sentinel suppresses repeats"

REPO=$(make_repo_with_dep)
# First call: WARN
assert_warn "$H" "$(payload tool_name=Bash command='npm install' cwd="$REPO")" "first install → WARN" "--foreground-scripts"
# Sentinel must now exist.
TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$REPO/.civitas-fg-scripts-hinted" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} sentinel written after first WARN"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("sentinel not written after first WARN")
  echo "${CLR_FAIL}  ✗${CLR_RST} sentinel not written after first WARN"
fi
# Second call: silent allow due to sentinel.
assert_allow "$H" "$(payload tool_name=Bash command='npm install' cwd="$REPO")" "second install with sentinel present → silent allow"
# Removing the sentinel re-enables the hint.
rm -f "$REPO/.civitas-fg-scripts-hinted"
assert_warn "$H" "$(payload tool_name=Bash command='npm install' cwd="$REPO")" "after sentinel removal → WARN again" "--foreground-scripts"
rm -rf "$REPO"

section "npm-install-foreground-scripts-hint: cwd outside a git repo"

# Fall back to CWD itself when not inside a git repo.
PLAIN=$(mktemp -d)
cat > "$PLAIN/package.json" <<'EOF'
{ "name": "x", "version": "1.0.0", "dependencies": { "@civitas-cerebrum/element-interactions": "^0.3.0" } }
EOF
assert_warn "$H" "$(payload tool_name=Bash command='npm install' cwd="$PLAIN")" "non-git CWD with dep → WARN" "--foreground-scripts"
rm -rf "$PLAIN"

section "npm-install-foreground-scripts-hint: escape hatch via env var"

REPO=$(make_repo_with_dep)
HOOK_OUT=$(NPM_FOREGROUND_SCRIPTS_HINT=off bash "$H" <<<"$(payload tool_name=Bash command='npm install' cwd="$REPO")" 2>/dev/null) || true
TESTS_RUN=$((TESTS_RUN + 1))
if [ -z "$HOOK_OUT" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} NPM_FOREGROUND_SCRIPTS_HINT=off → silent allow"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("NPM_FOREGROUND_SCRIPTS_HINT=off: expected silent allow, got=${HOOK_OUT:0:200}")
  echo "${CLR_FAIL}  ✗${CLR_RST} NPM_FOREGROUND_SCRIPTS_HINT=off (expected silent allow)"
fi
rm -rf "$REPO"
