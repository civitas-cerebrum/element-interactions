#!/bin/bash
# harness-trusted-state-write-guard.sh
#
# Hook    : PreToolUse:Write|Edit|MultiEdit|Bash
# Mode    : DENY when the tool would write/touch any harness-trusted state path
# Env     : HARNESS_TRUSTED_WRITE_GUARD=off (escape; out-of-band only — env vars
#           don't persist across hook invocations from inside the agent session,
#           so the agent CANNOT toggle this from in-session)
#
# What it closes
# --------------
# Surfaced in BookHive Run-4 follow-up review. Two-step exploit chain:
#
#   Exploit 1 — self-authored stop-authorization sentinel:
#     `onboarding-pipeline-incomplete-stop-deny.sh` honors
#     `.claude/onboarding-stop-authorized` (or its alt at
#     `tests/e2e/docs/.onboarding-stop-authorized`) as "explicit user
#     authorisation". The hook checked file-exists, no provenance check.
#     The agent was able to create it itself via:
#         mkdir -p .claude && echo '...' > .claude/onboarding-stop-authorized
#     and the next Stop was allowed — bypassing the kernel rule that
#     self-authorisation, auto-mode, inferred preference, and session-budget
#     framings are NOT valid authorisation for partial pipeline runs.
#
#   Exploit 2 — self-written phase-validator ledger:
#     `phase-validator-dispatch-required.sh` had a documented contract
#     ("Onboarding MUST NOT hand-write entries; they only become valid via
#     the harness layer") but no actual write-guard. When the PostToolUse:Agent
#     payload-extractor failed (Run-4 finding F1), the agent wrote
#     `tests/e2e/docs/onboarding-phase-ledger.json` directly with manufactured
#     `_audit:` notes and the harness accepted it.
#
# Same vulnerability class. Same fix: a single PreToolUse guard that denies
# the agent at the Write/Edit/MultiEdit/Bash boundary for any path the harness
# trusts as authoritative.
#
# Protected paths (relative to repo root, also matched as absolute):
#   .claude/onboarding-stop-authorized
#   tests/e2e/docs/.onboarding-stop-authorized
#   tests/e2e/docs/onboarding-phase-ledger.json
#
# What stays UNguarded (deliberately):
#   - .claude/coverage-expansion-state.json — agent owns this; deferral-auth
#     guard already covers the silent-narrowing exploit class for it.
#   - tests/e2e/docs/.discovery-draft.json — Phase-3 happy-path subagent
#     produces this as part of its mandatory output; agent-writable by design.
#   - .phase4-cycle-state.json — orchestrator-readable, harness-derived; the
#     cycle-gate hook validates convergence math from the dispatch trail.
#
# When to extend the protected-paths list:
# Any time a NEW state file becomes "harness reads this as authoritative
# proof of out-of-band authorisation" — the same trust shape as the three
# above — add its repo-relative path to PROTECTED_PATHS below AND update the
# Why-block in the deny message.

set -uo pipefail

# Escape hatch — out-of-band only.
[ "${HARNESS_TRUSTED_WRITE_GUARD:-on}" = "off" ] && exit 0

# Resolve jq: prefer the binary bundled with the hook install, fall back to
# system jq for in-repo testing before postinstall has run.
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH. Reinstall the package or install jq manually." >&2
  exit 0
fi

INPUT=$(cat)
EVENT=$(echo "$INPUT" | "$JQ" -r '.hook_event_name // ""')
TOOL=$(echo "$INPUT" | "$JQ" -r '.tool_name // ""')
[ "$EVENT" != "PreToolUse" ] && exit 0

# --- protected paths ---
PROTECTED_PATHS=(
  ".claude/onboarding-stop-authorized"
  "tests/e2e/docs/.onboarding-stop-authorized"
  "tests/e2e/docs/onboarding-phase-ledger.json"
  # BookHive Run-5 round-2 finding G5 — Stop-deny reads journey-map.md
  # sentinel and coverage-expansion-state.json status as authoritative
  # mid-pipeline signals. Without protection, the agent could clear
  # both via direct Write/Edit and pass the Stop-deny gate.
  "tests/e2e/docs/journey-map.md"
  "tests/e2e/docs/coverage-expansion-state.json"
)
# Note (round-4 I5/I8): we deliberately do NOT add app-context.md /
# adversarial-findings.md / onboarding-report.md to PROTECTED_PATHS
# because Phases 2, 6, 7 legitimately need to write them. The forge
# path (zero-byte artifact + schema-perfect greenlight) is closed by
# tightening the H9 substantive-content check in phase-validator-
# dispatch-required.sh — that hook now requires non-trivial size AND
# a phase-specific sentinel pattern in each artifact.

# Glob-shape protected paths (matched separately because the literal
# array's case-pattern matching gets brittle with embedded `*`). Each
# entry is a literal-prefix; `<prefix>*` is the implicit glob.
# F2 — Stop-deny consecutive-block counter at /tmp/civitas-onboarding-stop-deny-${SESSION_ID}.
# Pre-populating the counter to CAP value silences the next suspect
# Stop. The counter is harness-only state and must not be agent-writable.
PROTECTED_PATH_PREFIXES=(
  "/tmp/civitas-onboarding-stop-deny-"
  "/private/tmp/civitas-onboarding-stop-deny-"
)

# Bare basenames of the glob-prefix family (H11). When a command does
# `cd /tmp; touch civitas-onboarding-stop-deny-FAKE` the absolute prefix
# never appears literally — only the basename does. We probe the
# basename family in bash command scans separately.
PROTECTED_PATH_PREFIX_BASENAMES=(
  "civitas-onboarding-stop-deny-"
)

# --- helpers ---
emit_deny() {
  local r="$1"
  "$JQ" -n --arg r "$r" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

deny_body() {
  local detected_path="$1"
  cat <<EOF
[BLOCKED] Harness-trusted state file — agent/orchestrator MUST NOT write directly.

Detected target: ${detected_path}

──────────────────────────────────────────────────────────────────
Why this is blocked:
──────────────────────────────────────────────────────────────────
This path is one of three the harness reads as authoritative proof of
out-of-band authorisation:

  - .claude/onboarding-stop-authorized                          (user authorisation to stop early)
  - tests/e2e/docs/.onboarding-stop-authorized                  (alternate path for the same authorisation)
  - tests/e2e/docs/onboarding-phase-ledger.json                 (phase-validator greenlight ledger)

Each was designed to be written EITHER by:
  (a) the harness layer itself (e.g., the PostToolUse:Agent ledger-write
      branch in phase-validator-dispatch-required.sh), or
  (b) the user, out-of-band (e.g., typing \`touch
      .claude/onboarding-stop-authorized\` themselves to authorise an
      early stop).

The agent is NOT either of those. An agent-written sentinel or ledger
entry is forgery — the agent masquerades as out-of-band authorisation
it does not have. BookHive Run-4 surfaced this exact chain: the agent
self-authored the stop sentinel after the legitimate stop-deny hook
fired, and self-wrote the phase-validator ledger when the PostToolUse
extractor failed (Run-4 F1). Both unauthorised; both contract violations.

──────────────────────────────────────────────────────────────────
What to do instead:
──────────────────────────────────────────────────────────────────
For the stop-authorisation sentinel (Exploit 1):
  Continue dispatching the next pipeline phase. If you genuinely need
  the user to authorise an early stop, ASK THEM in conversation and
  quote their reply verbatim in your next progress line — do not create
  the sentinel yourself. Only the user creates it (out-of-band touch
  from their own shell, or via a dedicated user-invoked slash command
  that runs out-of-band).

For the phase-validator ledger (Exploit 2):
  The PostToolUse:Agent branch of phase-validator-dispatch-required.sh
  writes ledger entries automatically when a phase-validator subagent
  returns. If the harness write isn't firing (e.g., the payload-shape
  mismatch surfaced by Run-4 finding F1 against this Claude Code CLI
  version), report the regression to the user with concrete
  reproduction evidence and let THEM decide whether to:
    - patch the hook's response extractor,
    - touch the ledger themselves out-of-band, or
    - set ONBOARDING_STOP_DENY=off (also out-of-band) and accept the
      partial run.
  Do NOT hand-write the ledger to "recover" — that defeats the
  authoritative-state contract the rest of the harness depends on.

──────────────────────────────────────────────────────────────────
Escape hatch (out-of-band only):
──────────────────────────────────────────────────────────────────
HARNESS_TRUSTED_WRITE_GUARD=off in the parent process that launched
Claude Code. Env vars do NOT persist across hook invocations from inside
the agent session — each hook call fires a fresh process. The agent
cannot set this in-session to bypass.

──────────────────────────────────────────────────────────────────
References:
  skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
  skills/coverage-expansion/SKILL.md §"Two valid exits"
  skills/onboarding/references/phase-validator-workflow.md §"6 Mechanical enforcement"
  hooks/onboarding-pipeline-incomplete-stop-deny.sh
  hooks/phase-validator-dispatch-required.sh
  hooks/coverage-state-deferral-auth-guard.sh   (sibling — covers the silent-narrowing class)
EOF
}

# Pull target path (Write/Edit/MultiEdit/NotebookEdit) or command (Bash) from input
TARGET_PATH=""
BASH_CMD=""
case "$TOOL" in
  Write|Edit|MultiEdit|NotebookEdit)
    TARGET_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // .tool_input.notebook_path // ""')
    ;;
  Bash)
    BASH_CMD=$(echo "$INPUT" | "$JQ" -r '.tool_input.command // ""')
    ;;
  *)
    exit 0   # Other tools — no scope here.
    ;;
esac

# Resolve repo root for absolute-path matching.
CWD=$(echo "$INPUT" | "$JQ" -r '.cwd // "."' 2>/dev/null || echo ".")
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")

# Collapse `<segment>/../` traversals in a path. Pure-string sed-based
# normalization — no realpath dependency, no file-existence requirement.
# Loops until no further reductions are possible (with a hard cap to
# prevent runaway iteration on pathological input).
#
# BookHive Run-5 round-3 finding H4: `tests/e2e/docs/../docs/onboarding-
# phase-ledger.json` resolves to the protected path but does not match
# byte-for-byte against the literal entries in PROTECTED_PATHS.
canonicalize_path() {
  local s="$1"
  local i=0
  while [[ "$s" == *"/../"* ]] && [ "$i" -lt 32 ]; do
    local prev="$s"
    s=$(printf '%s' "$s" | sed -E 's![^/[:space:]"'"'"']+/\.\./!!g')
    [ "$s" = "$prev" ] && break
    i=$((i + 1))
  done
  # Strip surrounding quotes if present (e.g., from Write payloads
  # captured with quote characters in the path).
  s="${s%\"}"; s="${s#\"}"
  s="${s%\'}"; s="${s#\'}"
  printf '%s' "$s"
}

# Match a Write/Edit target against the protected list, considering both
# repo-relative and absolute forms. Use suffix-match to handle symlink-
# resolved paths (macOS /tmp → /private/tmp, /var → /private/var, etc.) —
# the agent may pass an unresolved absolute path while git/realpath returns
# the resolved form, so byte-for-byte equality misses.
is_protected_target() {
  local raw_target="$1"
  # H4 — canonicalize `..`-traversal before suffix-match.
  local target
  target=$(canonicalize_path "$raw_target")
  for p in "${PROTECTED_PATHS[@]}"; do
    case "$target" in
      "$p"|"./$p")        return 0 ;;     # repo-relative form
      *"/$p")             return 0 ;;     # any absolute path ending in /<protected>
    esac
  done
  # Glob-prefix matches (F2 — /tmp counter family).
  for prefix in "${PROTECTED_PATH_PREFIXES[@]}"; do
    case "$target" in
      "${prefix}"*)        return 0 ;;
    esac
  done
  return 1
}

# Match a Bash command against the protected list. We deny when:
#   (a) the command mentions any protected path AS A SUBSTRING, AND
#   (b) the command performs a write-shape operation against that path.
# (a) without (b) — e.g., `cat <path>` or `ls <path>` — is allowed; the agent
# can read these files (Read tool is the preferred channel, but Bash read is
# not the exploit surface here).
#
# Whitelist: commands that legitimately mention paths inside message-body
# arguments (commit messages, PR bodies, issue text). These do NOT write to
# the protected paths themselves; they include the path string as prose. We
# detect these by literal-prefix match — keep the list short and specific to
# avoid widening the bypass surface.
is_commit_or_message_command() {
  local cmd="$1"
  # `git commit` with -m / -F / --message / --file — message body or file ref
  # `gh pr create` and `gh issue create` — body text
  # `git tag -m` — tag message
  # `git notes add -m` — note message
  #
  # Use regex (not literal-substring globs) so `git -c <key>=<val> commit`,
  # `git -c gpg.sign=false commit`, and similar flag-stuffing forms still
  # match. The original literal-glob version `*"git commit"*` failed on
  # `git -c commit.gpgsign=false commit` because the substring `git commit`
  # is broken up by the -c arg. (BookHive Run-5 round-2 follow-up.)
  if echo "$cmd" | grep -qE '(^|[[:space:];&|])git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'; then
    return 0
  fi
  if echo "$cmd" | grep -qE '(^|[[:space:];&|])git([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(tag|notes)[[:space:]]+[^|;&]*-m[[:space:]]'; then
    return 0
  fi
  case "$cmd" in
    *"gh pr create"*)      return 0 ;;
    *"gh issue create"*)   return 0 ;;
    *"gh pr comment"*)     return 0 ;;
    *"gh issue comment"*)  return 0 ;;
  esac
  return 1
}

# Read a script file's content if readable, with a size cap to avoid
# pathological inputs. Used by H7 (bash <script>) to inspect the script
# body for write-shape ops against protected paths.
read_script_body() {
  local f="$1"
  [ -r "$f" ] || return 1
  # Cap at 256KB to avoid loading enormous files.
  head -c 262144 "$f" 2>/dev/null
}

# Single-string write-shape detector. Returns 0 if `text` contains a
# write-shape op against any protected path (literal substring match
# plus per-shape regex). Shared between bash_touches_protected and the
# script-source scanner (H7), so a `bash /tmp/forge.sh` where the
# script body redirects to the ledger gets the same treatment as the
# direct redirect.
#
# `text` should already be canonicalized (`..` traversal collapsed) and
# quote-normalized before this is called.
text_touches_protected() {
  local text="$1"

  # Build the per-call probes list.
  local probes=()
  local p
  for p in "${PROTECTED_PATHS[@]}"; do
    probes+=("$p")
    local basename
    basename=$(printf '%s' "$p" | awk -F/ '{print $NF}')
    if [ -n "$basename" ] && [ "$basename" != "$p" ]; then
      probes+=("$basename")
    fi
  done
  local prefix
  for prefix in "${PROTECTED_PATH_PREFIXES[@]}"; do
    if echo "$text" | grep -qF "$prefix"; then
      probes+=("$prefix")
    fi
  done
  # H11 — also probe the bare basename of each prefix family. `cd /tmp;
  # touch civitas-onboarding-stop-deny-FAKE` mentions only the basename.
  local prefix_basename
  for prefix_basename in "${PROTECTED_PATH_PREFIX_BASENAMES[@]}"; do
    if echo "$text" | grep -qF "$prefix_basename"; then
      probes+=("$prefix_basename")
    fi
  done

  for p in "${probes[@]}"; do
    if echo "$text" | grep -qF "$p"; then
      local p_re
      p_re=$(printf '%s' "$p" | sed 's/[.[\*^$()+?{|/]/\\&/g')
      # Trailing delimiter — for prefix probes (entries that end in `-`
      # or are bare basenames of a prefix family) accept any non-space
      # tail; for full paths require a delimiter so partial-path
      # mentions don't match.
      local trailing_re='([[:space:]"'"'"']|$|;|&|\|)'
      case "$p" in
        *-)
          trailing_re='[^[:space:]|;&"'"'"']*([[:space:]"'"'"']|$|;|&|\|)' ;;
      esac
      # H11 — bare-basename prefixes also accept any tail.
      local pbn
      for pbn in "${PROTECTED_PATH_PREFIX_BASENAMES[@]}"; do
        if [ "$p" = "$pbn" ]; then
          trailing_re='[^[:space:]|;&"'"'"']*([[:space:]"'"'"']|$|;|&|\|)'
          break
        fi
      done
      # Leading delimiter — accept whitespace, line-start, quote, or
      # path-separator boundaries. H2 quoted-redirect (`> "<path>"`)
      # uses optional quote at the boundary.
      local leading_re='([[:space:]"'"'"'/]|^)'

      # H3 — extend redirect operator class to `>`, `>>`, `>|`, `>>|`
      # (`>|` overrides noclobber, equally lethal as `>`).
      # H2 — accept optional quote between operator and path.
      # H4/H7 — accept absolute-path prefix between operator and the
      # repo-relative probe by allowing any non-separator chars to
      # chew through (`/tmp/abs-repo/` before `tests/e2e/...`).
      # I2 (round-4) — extend operator group to FD-numbered + ampersand
      # forms: `1>`, `2>`, `3>>`, `&>`, `&>>`. Bash treats these as
      # identical write semantics to a bare `>`. The optional digit/&
      # prefix gets matched and discarded.
      if echo "$text" | grep -qE '([0-9&]?>>?\|?|&>>?)[[:space:]]*["'"'"']?[^|;&<>"'"'"']*'"$p_re$trailing_re"; then
        return 0
      fi
      # I3 (round-4) — process substitution: `>(cmd ... <path> ...)`.
      # The outer `>` opens the subshell; the path lives inside. The
      # main redirect regex skips this because `>(` violates the
      # `[^|;&<>"']` chew-class. Match explicitly.
      if echo "$text" | grep -qE '>\([^)]*'"$p_re"'[^)]*\)'; then
        return 0
      fi
      # `touch` / `tee` followed by the path (allow shell flags in between).
      if echo "$text" | grep -qE '(^|[[:space:];&|])(touch|tee)([[:space:]]+-[a-zA-Z]+)*[[:space:]]+["'"'"']?[^|;&<>"'"'"']*'"$p_re$trailing_re"; then
        return 0
      fi
      # `mv` / `cp` / `ln` (H5: bare ln, not just `ln -s`) with path as last
      # arg before terminator. ln without -s creates a hardlink which the
      # attacker can then write through.
      # I7 (round-4) — add `install`, `rsync`, `truncate`, `cpio` to
      # the write-verb list. Each writes/overwrites the destination
      # path. `install -m 644 src dst`, `rsync src dst`, `truncate -s 0
      # dst`, `cpio -o -F dst` are all functionally equivalent to `cp`.
      if echo "$text" | grep -qE '(^|[[:space:];&|])(mv|cp|ln|install|rsync|truncate|cpio)([[:space:]]+-[a-zA-Z][a-zA-Z0-9_=]*)*[[:space:]]+[^|;&]*["'"'"']?'"$p_re$trailing_re"; then
        return 0
      fi
      # `dd of=PATH`
      if echo "$text" | grep -qE 'dd[[:space:]]+[^|;&]*of=["'"'"']?[^|;&<>"'"'"']*'"$p_re$trailing_re"; then
        return 0
      fi
      # `rm` / `unlink` / `shred` against the protected path. Allow
      # shell flags between the verb and the path (`-rf`, `-i`, etc.).
      if echo "$text" | grep -qE '(^|[[:space:];&|])(rm|unlink|shred)([[:space:]]+-[a-zA-Z]+)*[[:space:]]+[^|;&]*["'"'"']?'"$p_re$trailing_re"; then
        return 0
      fi
      # `find <root> ... -delete` where the protected path is anywhere on
      # the line.
      if echo "$text" | grep -qE '(^|[[:space:];&|])find[[:space:]]+[^|;&]*-delete[[:space:]]*([[:space:];&|]|$)'; then
        return 0
      fi
      # H3 — `sed -i` in-place edit / `gsed -i` (GNU sed on macOS via
      # homebrew). Both rewrite the target file. The flag attaches
      # directly to -i (e.g., `-i.bak` or `-iEXT`) on BSD sed.
      if echo "$text" | grep -qE '(^|[[:space:];&|])(g?sed)[[:space:]]+(-[a-zA-Z]+[[:space:]]+)*-i[a-zA-Z._-]*([[:space:]]+|.)[^|;&]*["'"'"']?'"$p_re"; then
        return 0
      fi
      # H3 — `ed <file>` line-editor. The file IS the argument; any ed
      # invocation that mentions a protected path is a write attempt.
      if echo "$text" | grep -qE '(^|[[:space:];&|])ed[[:space:]]+[^|;&]*["'"'"']?'"$p_re"; then
        return 0
      fi
      # `ex` / `vi`/`vim` in batch mode (`-c "w" -c "q"`) is also a write
      # path; bundle them with ed.
      if echo "$text" | grep -qE '(^|[[:space:];&|])(ex|vim?)[[:space:]]+(-[a-zA-Z]+[[:space:]]+[^|;&]*)*-c[[:space:]]+[^|;&]*["'"'"']?'"$p_re"; then
        return 0
      fi
      # Interpreter `-c` / `-e` / `eval` that mentions the protected path
      # with an open-for-write or unlink shape inside the script string.
      if echo "$text" | grep -qE '(^|[[:space:];&|])(python3?|perl|ruby|node|deno|bun|pwsh|powershell)[[:space:]]+(-[ec]|eval)[[:space:]]'; then
        if echo "$text" | grep -qE "open\\([^)]*,[[:space:]]*['\"][wa+][bx+]?['\"]|write\\(|writeFileSync|writeFile|writeAllText|unlink|unlinkSync|truncate|fs\\.create|>>?[[:space:]]*['\"]"; then
          return 0
        fi
        if echo "$text" | grep -qE '(^|[[:space:];&|])(python3?|perl|ruby|node|deno|bun)[[:space:]]+-[ec][[:space:]]+[^|;&]*'"$p_re"; then
          return 0
        fi
      fi
      # `git apply` — patches against protected paths slip past the
      # write-shape detectors above; blanket deny when the path is
      # referenced.
      if echo "$text" | grep -qE '(^|[[:space:];&|])git[[:space:]]+apply([[:space:]]|$)'; then
        return 0
      fi
      # `patch` utility — same logic as git apply.
      if echo "$text" | grep -qE '(^|[[:space:];&|])patch[[:space:]]+(-[a-zA-Z][^|;&]*[[:space:]])?[^|;&]*'"$p_re"; then
        return 0
      fi
      # H8 — `xargs` / `parallel` that mentions a protected path is a
      # pipeline write attempt. The actual write shape lives inside the
      # subshell that xargs spawns; we can't introspect it from here,
      # but the combination of (xargs|parallel) + protected-path mention
      # is suspicious enough to deny by itself.
      # I6 (round-4) — same logic for `find ... -exec`. The -exec spawns
      # a subshell whose command runs against each matched path. When a
      # protected path is mentioned in the same command, the -exec is
      # almost certainly the carrier.
      if echo "$text" | grep -qE '(^|[[:space:];&|])(xargs|parallel)([[:space:]]|$)'; then
        return 0
      fi
      if echo "$text" | grep -qE '(^|[[:space:];&|])find[[:space:]]+[^|;&]*-exec[[:space:]]'; then
        return 0
      fi
      # H6 — env-var-indirected redirect. The cmd contains a redirect
      # operator AND mentions the protected path elsewhere (e.g.,
      # `P=tests/e2e/docs/ledger.json; echo x > $P`). We can't track
      # variable bindings, but the combination of a redirect + path
      # mention is sufficient evidence to deny.
      if echo "$text" | grep -qE '(>>?\|?)[[:space:]]*[\$"]'; then
        return 0
      fi
    fi
  done
  return 1
}

bash_touches_protected() {
  local cmd="$1"

  # H4 — collapse `<segment>/../` traversals so a path like
  # `tests/e2e/docs/../docs/onboarding-phase-ledger.json` is detected
  # as the protected ledger.
  local cmd_canon
  cmd_canon=$(canonicalize_path "$cmd")

  # I1 (round-4) — split the command into statement segments separated
  # by `&&`, `||`, `;`, or `|`. Apply the commit-message whitelist
  # per-segment, not whole-cmd. The old whole-cmd whitelist let
  # `git commit -m "msg" && echo forged > <protected>` pass because the
  # `git commit` substring exempted the full command, including the
  # chained write. With per-segment splitting, only the literal commit
  # segment is exempted; any other segment that performs a write-shape
  # against a protected path is independently evaluated.
  #
  # Note: this still leaves the entire cmd's text_touches_protected
  # scan running once below as a safety net; the per-segment loop is
  # the precise check. The redundancy is intentional — text_touches_
  # protected is line-oriented and per-statement is more accurate.
  local segments=()
  local seg
  while IFS= read -r seg; do
    [ -n "$seg" ] && segments+=("$seg")
  done < <(printf '%s' "$cmd_canon" | awk '
    BEGIN { RS = ""; FS = "\n" }
    {
      # Split on &&, ||, ;, | — preserve any embedded quoted text by
      # NOT splitting inside single or double quotes (best effort).
      n = length($0)
      buf = ""
      in_single = 0
      in_double = 0
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        c2 = substr($0, i, 2)
        if (c == "\047" && !in_double) { in_single = !in_single; buf = buf c; continue }
        if (c == "\"" && !in_single) { in_double = !in_double; buf = buf c; continue }
        if (in_single || in_double) { buf = buf c; continue }
        if (c2 == "&&" || c2 == "||") { print buf; buf = ""; i++; continue }
        if (c == ";" || c == "|" || c == "&") { print buf; buf = ""; continue }
        buf = buf c
      }
      if (buf != "") print buf
    }')

  local found_write=0
  for seg in "${segments[@]}"; do
    # Trim leading/trailing whitespace.
    seg="${seg#"${seg%%[![:space:]]*}"}"
    seg="${seg%"${seg##*[![:space:]]}"}"
    [ -z "$seg" ] && continue
    # Per-segment commit-message exemption.
    if is_commit_or_message_command "$seg"; then
      continue
    fi
    if text_touches_protected "$seg"; then
      found_write=1
      break
    fi
  done
  if [ "$found_write" = "1" ]; then
    return 0
  fi

  # Whole-cmd commit-message exemption ONLY when the whole cmd has no
  # write outside the commit segment (the per-segment loop already
  # confirmed this). Skip the rest if the WHOLE cmd is a single
  # commit-message command — preserves the old behavior for the simple
  # case (commit message containing a protected path string).
  if is_commit_or_message_command "$cmd_canon"; then
    return 1
  fi

  # H7 — script-source detection. If the command invokes a script
  # (`bash <file>`, `sh <file>`, `source <file>`, `. <file>`), read the
  # script body and apply the same write-shape detection.
  #
  # I4 (round-4) — robust path extraction. The round-3 implementation
  # only looked at $NF of each `verb <token>` match, which got tripped
  # by `bash -- script`, `bash -x -e script`, and quote-bracketed paths.
  # Use a python-style tokenizer (awk-driven) that, for each invocation
  # site, walks tokens after the verb until it finds a non-option
  # arg — honouring `--` as end-of-options and stripping surrounding
  # quotes.
  local invoke_paths
  invoke_paths=$(printf '%s' "$cmd_canon" | awk '
    BEGIN {
      # Tokenize on whitespace, respecting single and double quotes.
      RS = ""
    }
    {
      n = length($0)
      tok = ""
      in_single = 0
      in_double = 0
      tokens_count = 0
      delete tokens
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        if (c == "\047" && !in_double) { in_single = !in_single; tok = tok c; continue }
        if (c == "\"" && !in_single) { in_double = !in_double; tok = tok c; continue }
        if ((c == " " || c == "\t" || c == ";" || c == "&" || c == "|" || c == "\n") && !in_single && !in_double) {
          if (tok != "") { tokens_count++; tokens[tokens_count] = tok; tok = "" }
          # Boundary char itself separates statements; treat as token-boundary.
          continue
        }
        tok = tok c
      }
      if (tok != "") { tokens_count++; tokens[tokens_count] = tok }
      for (i = 1; i <= tokens_count; i++) {
        t = tokens[i]
        if (t == "bash" || t == "sh" || t == "zsh" || t == "source" || t == ".") {
          # Walk forward looking for the script path arg.
          end_opts = 0
          for (j = i + 1; j <= tokens_count; j++) {
            a = tokens[j]
            if (a == "--") { end_opts = 1; continue }
            if (!end_opts && substr(a, 1, 1) == "-") {
              # -c inline body: handled by main text_touches_protected; skip
              if (a == "-c" || a == "-e" && t != "sh") continue
              continue
            }
            # Strip surrounding quotes.
            if (length(a) >= 2) {
              first = substr(a, 1, 1)
              last = substr(a, length(a), 1)
              if ((first == "\047" && last == "\047") || (first == "\"" && last == "\"")) {
                a = substr(a, 2, length(a) - 2)
              }
            }
            print a
            break
          }
        }
      }
    }')
  if [ -n "$invoke_paths" ]; then
    local script_path
    while IFS= read -r script_path; do
      [ -z "$script_path" ] && continue
      case "$script_path" in -*) continue ;; esac
      case "$script_path" in /usr/*|/bin/*|/opt/*|/sbin/*) continue ;; esac
      local body
      body=$(read_script_body "$script_path") || continue
      [ -z "$body" ] && continue
      local body_canon
      body_canon=$(canonicalize_path "$body")
      if text_touches_protected "$body_canon"; then
        return 0
      fi
    done <<EOF
$invoke_paths
EOF
  fi

  # Standard detection on the canonicalized command line.
  if text_touches_protected "$cmd_canon"; then
    return 0
  fi

  return 1
}

# Decision
if [ -n "$TARGET_PATH" ]; then
  if is_protected_target "$TARGET_PATH"; then
    emit_deny "$(deny_body "$TARGET_PATH")"
    exit 0
  fi
fi

if [ -n "$BASH_CMD" ]; then
  if bash_touches_protected "$BASH_CMD"; then
    # Identify which protected path was touched, for the message.
    matched=""
    for p in "${PROTECTED_PATHS[@]}"; do
      if echo "$BASH_CMD" | grep -qF "$p"; then matched="$p"; break; fi
    done
    if [ -z "$matched" ]; then
      for prefix in "${PROTECTED_PATH_PREFIXES[@]}"; do
        if echo "$BASH_CMD" | grep -qF "$prefix"; then matched="${prefix}<session-id>"; break; fi
      done
    fi
    [ -z "$matched" ] && matched="(protected path family)"
    emit_deny "$(deny_body "$matched (via Bash command)")"
    exit 0
  fi
fi

exit 0
