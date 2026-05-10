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

# Match a Write/Edit target against the protected list, considering both
# repo-relative and absolute forms. Use suffix-match to handle symlink-
# resolved paths (macOS /tmp → /private/tmp, /var → /private/var, etc.) —
# the agent may pass an unresolved absolute path while git/realpath returns
# the resolved form, so byte-for-byte equality misses.
is_protected_target() {
  local target="$1"
  for p in "${PROTECTED_PATHS[@]}"; do
    case "$target" in
      "$p"|"./$p")        return 0 ;;     # repo-relative form
      *"/$p")             return 0 ;;     # any absolute path ending in /<protected>
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
  case "$cmd" in
    *"git commit"*)        return 0 ;;
    *"git tag "*"-m "*)    return 0 ;;
    *"git notes "*"-m "*)  return 0 ;;
    *"gh pr create"*)      return 0 ;;
    *"gh issue create"*)   return 0 ;;
    *"gh pr comment"*)     return 0 ;;
    *"gh issue comment"*)  return 0 ;;
  esac
  return 1
}

bash_touches_protected() {
  local cmd="$1"

  # Skip the prose-mention commands first. The agent CAN reference a protected
  # path in a commit message or PR body without writing to it. The exploit
  # surface is direct file creation, not documentation.
  if is_commit_or_message_command "$cmd"; then
    return 1
  fi

  for p in "${PROTECTED_PATHS[@]}"; do
    if echo "$cmd" | grep -qF "$p"; then
      # Write-shape detection: any of the standard file-creation / overwrite
      # operators present in the command, AND the protected path as their
      # immediate argument (path appears within a few non-pipe characters
      # after the operator).
      #
      #   touch <path>                                 — direct create
      #   > <path>  or  >> <path>                      — redirect-write
      #   tee <path>                                   — write via tee
      #   mv X <path>                                  — rename-into-target
      #   cp X <path>                                  — copy-into-target
      #   ln -s X <path>                               — symlink name
      #   dd of=<path>                                 — dd write
      local p_re
      p_re=$(printf '%s' "$p" | sed 's/[.[\*^$()+?{|/]/\\&/g')
      # `>`/`>>` followed by path (with optional whitespace).
      if echo "$cmd" | grep -qE '>>?[[:space:]]*'"$p_re"'([[:space:]]|$|;|&|\|)'; then
        return 0
      fi
      # `touch` / `tee` followed by the path (allow shell flags in between).
      if echo "$cmd" | grep -qE '(^|[[:space:];&|])(touch|tee)([[:space:]]+-[a-zA-Z]+)*[[:space:]]+'"$p_re"'([[:space:]]|$|;|&|\|)'; then
        return 0
      fi
      # `mv` / `cp` / `ln -s` with path as last arg before terminator.
      if echo "$cmd" | grep -qE '(^|[[:space:];&|])(mv|cp|ln -s)[[:space:]]+[^|;&]*[[:space:]]'"$p_re"'([[:space:]]|$|;|&|\|)'; then
        return 0
      fi
      # `dd of=PATH`
      if echo "$cmd" | grep -qE 'dd[[:space:]]+[^|;&]*of='"$p_re"'([[:space:]]|$|;|&|\|)'; then
        return 0
      fi
    fi
  done
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
    emit_deny "$(deny_body "$matched (via Bash command)")"
    exit 0
  fi
fi

exit 0
