#!/bin/bash
# bash-command-allowlist.sh — sandbox the agent's Bash tool to a verb allowlist.
#
# Hook    : PreToolUse:Bash
# Mode    : DENY when any statement segment's first verb is not in ALLOWED_VERBS
# Env     : CIVITAS_BASH_ALLOWLIST=off  (escape; out-of-band only)
#
# Why this exists
# ---------------
# BookHive Run-5 rounds 3-6 closed 22 specific bash write-shape exploits
# (quoted redirects, FD-numbered redirects, process substitution, script-
# source bodies, hardlinks, `$()` inside commit messages, etc.). Each
# round followed the same loop: a red-team agent found a new bash shape,
# we added a regex to detect it, and the next round found another shape.
# The structural cause is that BASH IS TURING-COMPLETE — no finite regex
# set can enumerate every possible exfil shape.
#
# The sandbox approach inverts the model: instead of denylisting
# dangerous shapes, we ALLOWLIST a small set of verbs the onboarding
# pipeline actually needs. Anything outside the allowlist is denied by
# default. Trade-off: the agent can't get creative; it must use
# well-formed npm/npx/git/playwright invocations.
#
# Defense-in-depth — this hook runs BEFORE the harness-trusted-state-
# write-guard. Even if a new exploit shape is found inside an allowlisted
# verb, the write-guard remains as backstop.
#
# Allowlist contents
# ------------------
# Verbs the onboarding pipeline (and contributor workflows) need:
#   npm npx bunx pnpm yarn bun           — node toolchain
#   playwright                            — direct invocation form
#   git gh                                — version control + GitHub CLI
#   ls cat head tail wc grep egrep fgrep
#   find file stat du df tree which
#   whereis command type pwd basename
#   dirname realpath readlink             — POSIX read-only
#   echo printf sort uniq                 — POSIX text
#   date whoami id hostname uname env
#   true false test [ ps                  — POSIX trivia
#   jq awk sed                            — text processing (sed -i denied at flag level)
#   curl wget                             — network probes
#   mkdir touch rm cp mv ln chmod         — filesystem write (write-guard is backstop)
#   cd pushd popd                         — navigation
#
# Denied verbs (selected examples):
#   bash sh zsh dash ksh                  — nested shells (round-3 H7)
#   eval exec source .                    — script sourcing
#   xargs parallel                        — pipeline-execution (round-3 H8)
#   dd                                    — block-level write
#   ed ex vi vim emacs                    — line editors (round-3 H3)
#
# Denied flag patterns (within allowed verbs):
#   node -e | -p | -r | --eval | --print | --require   — interpreter eval
#   python(3?) -c | -m | --command                     — interpreter eval
#   ruby -e | perl -e                                  — interpreter eval
#   sed -i                                             — in-place edit (round-3 H3)
#
# Escape
# ------
# CIVITAS_BASH_ALLOWLIST=off — out-of-band only. Use during contributor
# debugging or when the user explicitly authorises a non-allowlisted
# command.

set -uo pipefail

[ "${CIVITAS_BASH_ALLOWLIST:-on}" = "off" ] && exit 0

JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found." >&2
  exit 0
fi

INPUT=$(cat)
EVENT=$(echo "$INPUT" | "$JQ" -r '.hook_event_name // ""')
TOOL=$(echo "$INPUT" | "$JQ" -r '.tool_name // ""')
[ "$EVENT" != "PreToolUse" ] && exit 0
[ "$TOOL" != "Bash" ] && exit 0

CMD=$(echo "$INPUT" | "$JQ" -r '.tool_input.command // ""')
[ -z "$CMD" ] && exit 0

# Allowlist of verbs.
# Round-7 L2: `command` removed from allowlist (it's a builtin-runner — `command bash -c evil` bypasses).
# Use `which` or `type` for command introspection.
ALLOWED_VERBS_RE='^(npm|npx|bunx|pnpm|yarn|bun|playwright|git|gh|ls|cat|head|tail|wc|grep|egrep|fgrep|find|file|stat|du|df|tree|which|whereis|type|pwd|basename|dirname|realpath|readlink|echo|printf|sort|uniq|date|whoami|id|hostname|uname|env|true|false|test|\[|ps|jq|awk|sed|curl|wget|mkdir|touch|rm|cp|mv|ln|chmod|cd|pushd|popd|node|python|python3)$'

# Round-7 L4 — whole-command-level denylist: $() and backticks ARE
# arbitrary code execution. The awk splitter doesn't track them; rather
# than trying to, ban them outright. Legitimate use-cases (capturing
# output) can use temp files or pipes through allowlisted commands.
whole_cmd_denied() {
  local cmd="$1"
  # Command substitution `$(...)` — runs arbitrary code, output captured.
  if echo "$cmd" | grep -qE '\$\('; then
    echo "command substitution \$(...) not allowed (arbitrary code execution); use temp files + pipes via allowlisted verbs"
    return 0
  fi
  # Backtick command substitution — same as `$()` but older syntax.
  if echo "$cmd" | grep -q '`'; then
    echo "backtick command substitution not allowed (arbitrary code execution); use temp files + pipes"
    return 0
  fi
  # Process substitution `<(...)` and `>(...)` — also runs arbitrary
  # code, though limited to one-shot read/write. Trusted-state-write-guard
  # closed `>(...)` for protected paths (round-4 I3); ban the construct
  # entirely here for the sandbox.
  if echo "$cmd" | grep -qE '[<>]\('; then
    echo "process substitution <(...) / >(...) not allowed; use named pipes or temp files"
    return 0
  fi
  return 1
}

# Flag-level denylist by verb (regex against the full command segment).
# These shapes were closed in rounds 3-6 but are easier to ban entirely.
flag_denied() {
  local seg="$1"
  # Round-7 L1 — `git config alias.X '!...'` runs the alias body through
  # $SHELL, giving an unrestricted shell. Also reject `git -c alias.X=!...`
  # one-shot variants and the trio of `core.sshCommand`/`core.editor`/
  # `core.pager` which all execute shell.
  if echo "$seg" | grep -qE 'git[[:space:]]+(-c[[:space:]]+[^[:space:]]+[[:space:]]+)*config[[:space:]]+([^|;&]+[[:space:]]+)*alias\.[^[:space:]]+[[:space:]]+["'"'"']?!'; then
    echo "git alias with '!' prefix (shell-alias) not allowed; aliases must not invoke shell"
    return 0
  fi
  if echo "$seg" | grep -qE 'git[[:space:]]+-c[[:space:]]+(alias\.[^=]+=!|core\.(sshCommand|editor|pager|hooksPath)=)'; then
    echo "git -c with alias/core.sshCommand/core.editor/core.pager (shell-execution config) not allowed"
    return 0
  fi
  # Round-7 L3 — `env <prog>` runs <prog> as a program. Restrict env to
  # introspection-only (no positional command). Allowed: `env`, `env | grep
  # X`, `env VAR=value` (no command after), `env -i`. Denied: `env <verb>`
  # where <verb> is anything not VAR=value or a flag.
  # Regex: env, optionally followed by flag-OR-assignment groups, then a
  # required positional that looks like a program name (starts alpha/./_,
  # contains no `=`). Positional starting with `-` is excluded so flags
  # don't false-positive.
  if echo "$seg" | grep -qE '(^|[[:space:];&|])env([[:space:]]+(-[a-zA-Z0-9]+|[A-Z_][A-Z0-9_]*=[^[:space:]]*))*[[:space:]]+[a-zA-Z./_][^=[:space:]]*([[:space:]]|$)'; then
    echo "env invoking a program (env <prog>) not allowed; use the program directly via an allowlisted verb"
    return 0
  fi
  # Round-7 L5 — `npx <url>` and `npm install <url|file>` download and
  # execute arbitrary code. Restrict to registry package specs (bare
  # names + optional version). Same for pnpm/yarn/bun.
  if echo "$seg" | grep -qE '(^|[[:space:];&|])(npx|pnpm[[:space:]]+dlx|yarn[[:space:]]+dlx|bunx)[[:space:]]+(-[a-zA-Z][[:space:]]+|--[a-zA-Z-]+([[:space:]]+|=)[^[:space:]]+[[:space:]]+)*((https?:|file:|git\+|/|\./|\.\.\/))'; then
    echo "npx/pnpm dlx with URL/path arg not allowed (downloads + executes arbitrary code); use registry package specs only"
    return 0
  fi
  if echo "$seg" | grep -qE '(^|[[:space:];&|])(npm|pnpm|yarn|bun)[[:space:]]+(install|i|add)[[:space:]]+(-[a-zA-Z][[:space:]]+|--[a-zA-Z-]+([[:space:]]+|=)[^[:space:]]+[[:space:]]+)*((https?:|file:|git\+|/|\./|\.\.\/))'; then
    echo "npm/pnpm/yarn install with URL/path arg not allowed; use registry package specs only"
    return 0
  fi
  # Round-7 L6 — find -exec / -delete / -execdir / -fprint{,f} / -fls
  # are arbitrary-action find primitives. The find verb itself is in the
  # allowlist (legitimate read-only use is essential) but these flags
  # must be denied.
  if echo "$seg" | grep -qE '(^|[[:space:];&|])find[[:space:]]+[^|;&]*(-exec(dir)?|-delete|-fprint(f)?|-fls)([[:space:]]|$)'; then
    echo "find -exec / -delete / -execdir / -fprint(f) / -fls not allowed; use allowlisted verbs instead"
    return 0
  fi
  # Interpreter -e/-c/-p eval shapes — closed in round-3 H7 but the
  # script-source scanner had to introspect script bodies. Easier to
  # deny inline eval entirely.
  if echo "$seg" | grep -qE '(^|[[:space:];&|])(node|deno|bun|pwsh|powershell)[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*(-e|--eval|-p|--print|-r|--require)([[:space:]]|=)'; then
    echo "interpreter inline eval (-e/--eval/-p/-r) not allowed; place code in a file and invoke directly"
    return 0
  fi
  if echo "$seg" | grep -qE '(^|[[:space:];&|])python3?[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*(-c|-m|--command)([[:space:]]|=)'; then
    echo "python -c / -m not allowed; place script in a file and run with python <file>"
    return 0
  fi
  if echo "$seg" | grep -qE '(^|[[:space:];&|])(perl|ruby)[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*(-e|--eval)([[:space:]]|=)'; then
    echo "perl/ruby inline eval (-e) not allowed; place script in a file"
    return 0
  fi
  # sed -i (in-place edit) — closed in round-3 H3 but worth banning to
  # force agent to use Edit tool instead.
  if echo "$seg" | grep -qE '(^|[[:space:];&|])g?sed[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*-i'; then
    echo "sed -i (in-place edit) not allowed; use the Edit tool instead"
    return 0
  fi
  return 1
}

emit_deny() {
  "$JQ" -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# Whole-command checks first — $() and backticks are arbitrary code
# execution that the per-segment splitter would miss (the splitter only
# tracks quotes; substitution is invisible to it). Reject these forms
# outright before per-segment analysis.
if reason=$(whole_cmd_denied "$CMD"); then
  emit_deny "[BLOCKED] Bash command outside allowlist sandbox.

The command contains a construct that bypasses sandbox analysis:

  ${reason}

These constructs evaluate arbitrary code in a way the per-segment
allowlist cannot see. The fix is to restructure the command:
  - For output capture: write to a temp file with an allowlisted verb,
    then read it back.
  - For conditional logic: use multiple Bash invocations, not one
    chained command.

(Round-7 L4 — \$() and backticks were the worst sandbox bypass class.)"
  exit 0
fi

# Per-segment awk splitter (mirrors harness-trusted-state-write-guard's I1
# splitter — respects single/double quotes, splits on &&/||/;/|/&).
segments_lines=$(printf '%s' "$CMD" | awk '
  BEGIN { RS = "" }
  {
    n = length($0)
    buf = ""
    in_single = 0; in_double = 0
    for (i = 1; i <= n; i++) {
      c = substr($0, i, 1); c2 = substr($0, i, 2)
      if (c == "\047" && !in_double) { in_single = !in_single; buf = buf c; continue }
      if (c == "\"" && !in_single)   { in_double = !in_double; buf = buf c; continue }
      if (in_single || in_double)    { buf = buf c; continue }
      if (c2 == "&&" || c2 == "||")  { print buf; buf = ""; i++; continue }
      if (c == ";" || c == "|" || c == "&") { print buf; buf = ""; continue }
      buf = buf c
    }
    if (buf != "") print buf
  }')

# Walk each segment; extract first verb token; check allowlist.
declare -a denied_segments=()
while IFS= read -r seg; do
  # Trim whitespace.
  seg="${seg#"${seg%%[![:space:]]*}"}"
  seg="${seg%"${seg##*[![:space:]]}"}"
  [ -z "$seg" ] && continue
  # Strip leading subshell / brace-group openers that aren't verbs.
  while [[ "$seg" == \(* ]] || [[ "$seg" == \{* ]]; do
    seg="${seg#?}"
    seg="${seg#"${seg%%[![:space:]]*}"}"
  done
  # Strip leading env-var assignments (VAR=value pattern at the start).
  # Round-7 L7: cap at THREE assignments. Unbounded chaining served no
  # legit purpose and risked interaction with the (denied) `env <prog>`
  # case. Three covers the common `KEY=val FLAG=1 OTHER=2 verb …` shape.
  assigns=0
  while [[ "$seg" =~ ^[A-Za-z_][A-Za-z0-9_]*=([^[:space:]]*)?[[:space:]] ]] && [ "$assigns" -lt 3 ]; do
    seg="${seg#${BASH_REMATCH[0]}}"
    seg="${seg#"${seg%%[![:space:]]*}"}"
    assigns=$((assigns + 1))
  done
  # Extract first token (the verb).
  verb=$(echo "$seg" | awk '{print $1}')
  # Strip leading `\` (escaped command — same verb, just disables aliases).
  verb="${verb#\\}"
  # Empty segment after stripping → skip.
  [ -z "$verb" ] && continue
  # Control-flow keywords — pass through; their internal bodies will be
  # re-processed if invoked as their own statement.
  case "$verb" in
    if|then|else|elif|fi|for|do|done|while|until|case|esac|function|return|exit|break|continue|local|export|readonly|declare|typeset|set|unset|shift|trap|wait|eval|exec)
      # `eval`/`exec` are technically allowed but they execute arbitrary
      # strings — that's the whole point of the sandbox to block. Deny.
      case "$verb" in
        eval|exec)
          denied_segments+=("${seg:0:80} — '${verb}' not allowed (executes arbitrary code)") ;;
      esac
      continue ;;
  esac
  # Match against allowlist.
  if ! echo "$verb" | grep -qE "$ALLOWED_VERBS_RE"; then
    denied_segments+=("${seg:0:80} — verb '${verb}' not in allowlist")
    continue
  fi
  # Flag-level check (interpreter eval, sed -i, etc.).
  if reason=$(flag_denied "$seg"); then
    denied_segments+=("${seg:0:80} — ${reason}")
  fi
done <<EOF
$segments_lines
EOF

if [ "${#denied_segments[@]}" -gt 0 ]; then
  reasons=$(printf '  - %s\n' "${denied_segments[@]}")
  emit_deny "[BLOCKED] Bash command outside allowlist sandbox.

The agent's Bash tool is sandboxed to a verb allowlist (BookHive Run-5 architectural fix; rounds 3-6 patched 22 specific bash exploit shapes — this hook closes the structural cause by inverting denylist to allowlist). Denied statements:

${reasons}

──────────────────────────────────────────────────────────────────
What to do instead:
──────────────────────────────────────────────────────────────────
Use one of these allowed verbs at the start of your command:

  npm | npx | bunx | pnpm | yarn | bun | playwright       (node toolchain)
  git | gh                                                 (version control)
  ls | cat | head | tail | wc | grep | find | file | stat (read)
  echo | printf | sort | uniq | date | env                 (text + env)
  mkdir | touch | rm | cp | mv | ln | chmod                (file mgmt)
  jq | awk | sed                                            (text processing)
  curl | wget                                               (network)
  cd | pushd | popd                                         (navigation)
  node | python | python3                                   (interpreters — but NOT inline -e/-c/-p)

Disallowed shapes (use a different tool instead):
  • bash -c / sh -c / zsh -c    → write a script file, invoke directly
  • eval / exec                  → never; the sandbox exists to block these
  • node -e / python -c / etc.   → place code in a file
  • sed -i                       → use the Edit tool
  • xargs / parallel             → loop with explicit statements instead

──────────────────────────────────────────────────────────────────
Escape (out-of-band only):
──────────────────────────────────────────────────────────────────
CIVITAS_BASH_ALLOWLIST=off in the parent process. Env vars don't
persist across hook invocations, so the agent CANNOT toggle this
from in-session. If you genuinely need to run a non-allowlisted
command, ask the user to set the env var out-of-band, or have them
run the command themselves and paste the output."
  exit 0
fi

exit 0
