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
ALLOWED_VERBS_RE='^(npm|npx|bunx|pnpm|yarn|bun|playwright|git|gh|ls|cat|head|tail|wc|grep|egrep|fgrep|find|file|stat|du|df|tree|which|whereis|command|type|pwd|basename|dirname|realpath|readlink|echo|printf|sort|uniq|date|whoami|id|hostname|uname|env|true|false|test|\[|ps|jq|awk|sed|curl|wget|mkdir|touch|rm|cp|mv|ln|chmod|cd|pushd|popd|node|python|python3)$'

# Flag-level denylist by verb (regex against the full command segment).
# These shapes were closed in rounds 3-6 but are easier to ban entirely.
flag_denied() {
  local seg="$1"
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
  # These are allowed (e.g., `CI=true npm test`). The verb is what follows.
  while [[ "$seg" =~ ^[A-Za-z_][A-Za-z0-9_]*=([^[:space:]]*)?[[:space:]] ]]; do
    seg="${seg#${BASH_REMATCH[0]}}"
    seg="${seg#"${seg%%[![:space:]]*}"}"
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
