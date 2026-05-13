#!/bin/bash
# framing-tokens.sh — single source of truth for "loophole-language" tokens.
#
# Library  : sourced by other hooks; not registered in the manifest.
# Mode     : N/A (pure helper, no side effects)
# State    : none
# Env      : FRAMING_TOKENS_SELFTEST=1 → run the self-test matrix and exit
#
# Rationale
# ---------
# Several hooks need to detect the same family of "I'm narrowing scope but
# framing it nicely" tokens that have surfaced across prior runs and
# previous incident docs (#139, #154, #155, #156, and the latest incident
# Run-2 partial). Each hook used to maintain its own grep regex; the lists
# diverged over time and bypasses surfaced (notably the Run-2
# partial slipping past `pragmatic Pass`-only matchers because the actual
# framing was "context-budget exit #2" and "Pass 1 first wave only").
#
# This helper exports `has_framing_token` returning 0 if the input matches
# any token, non-zero otherwise. Tokens are matched case-insensitively and
# treated as ERE (extended regex) snippets so callers don't have to think
# about anchoring.
#
# Canonical reference
# -------------------
# skills/onboarding/SKILL.md §"Hard rules — kernel-resident"
# skills/coverage-expansion/SKILL.md §"Two valid exits"
# skills/coverage-expansion/references/anti-rationalizations.md
#
# Usage
# -----
#   # shellcheck source=lib/framing-tokens.sh
#   source "$(dirname "$0")/lib/framing-tokens.sh"
#   if has_framing_token "$some_text"; then
#     # token found
#   fi
#
# Self-test
# ---------
#   FRAMING_TOKENS_SELFTEST=1 bash hooks/lib/framing-tokens.sh
# Prints PASS/FAIL per token. Exits 0 when all positive tokens match and all
# negative cases miss; exits 1 otherwise.

# Token catalogue. Each entry is an ERE pattern. Keep in sync with the
# kernel rule's named framings + the Run-2 bypass list.
#
# Note: '\d' is NOT POSIX ERE — use '[0-9]' instead. We declare the array
# below with that constraint already applied.
FRAMING_TOKEN_PATTERNS=(
  'pragmatic[[:space:]]+pass[[:space:]]*[0-9]+'
  'honest[[:space:]]+pass[[:space:]]*[0-9]+[[:space:]]*only'
  'realistic[[:space:]]+depth-mode[[:space:]]+contract'
  'evening[[:space:]]+run'
  'reduced[[:space:]]+scope[[:space:]]+given[[:space:]]+session[[:space:]]+constraints'
  'context-budget'
  'session-budget'
  'exit[[:space:]]*#[[:space:]]*2[[:space:]]+after'
  'pass[[:space:]]*[0-9]+[[:space:]]+partial'
  'pass[[:space:]]*[0-9]+[[:space:]]+deferred'
  'chose[[:space:]]+not[[:space:]]+to[[:space:]]+dispatch'
  'final-step[[:space:]]+instruction'
  'until[[:space:]]+step[[:space:]]+[0-9]+[[:space:]]+is[[:space:]]+done[[:space:]]+your[[:space:]]+run[[:space:]]+is[[:space:]]+not[[:space:]]+complete'
  'benchmark[[:space:]]+entry[[:space:]]+over'
  're-?prioriti[sz]ed[[:space:]]+the[[:space:]]+benchmark'
  'user[[:space:]]+instruction[[:space:]]+outranks'
  'partial[[:space:]]+pipeline[[:space:]]+(delivered|landed|committed)'
  'pass[[:space:]]*[0-9]+[[:space:]]+first[[:space:]]+wave[[:space:]]+only'
  'silently[[:space:]]+defer[[:space:]]+(passes|stages)'
  'defer[[:space:]]+stage[[:space:]]+b[[:space:]]+for[[:space:]]+context'
  'defer[[:space:]]+the[[:space:]]+reviewer'
  'the[[:space:]]+dispatch[[:space:]]+failed[^\n]*context'
  'agent-chosen[[:space:]]+(deferral|scope[[:space:]]+reduction)'
  # Run-2 verdict-prose framings (lifted byte-for-byte from the
  # bypass BENCHMARK Run-2 entry + onboarding-report.md). Each one is a
  # framing the orchestrator emitted to dress up the partial-pipeline
  # exit as something other than the no-skip violation it was. Catching
  # these in any reason-bearing field stops the same self-talk slipping
  # past on a future run.
  'honest[[:space:]]+partial[[:space:]]+reporting'
  '(single-session|pipeline-completion)[[:space:]]+(is[[:space:]]+)?structurally[[:space:]]+regressed'
  'honestly[[:space:]]+rather[[:space:]]+than[[:space:]]+trying[[:space:]]+to[[:space:]]+fake-complete'
  're-prioriti[sz]ed[[:space:]]+producing[[:space:]]+the[[:space:]]+benchmark'
)

# Combined ERE alternation of every pattern, exposed as a single regex string
# for callers that need to grep / sed / awk against the catalogue without
# function calls. Built once at source time. Use case-insensitively (e.g.
# `grep -iE "$FRAMING_TOKENS_RE"`). Prefer `has_framing_token` for shell
# logic; `FRAMING_TOKENS_RE` is for callers that want a single regex they
# can pass to other tools or compose into a larger pattern.
FRAMING_TOKENS_RE=$(IFS='|'; printf '%s' "${FRAMING_TOKEN_PATTERNS[*]}")
export FRAMING_TOKENS_RE

# has_framing_token <text>
# Return 0 (success) when at least one pattern in FRAMING_TOKEN_PATTERNS
# matches the input case-insensitively. Returns non-zero otherwise.
# Reads input from $1; if $1 is the literal '-' or empty, reads stdin.
has_framing_token() {
  local text
  if [ "$#" -ge 1 ] && [ "$1" != "-" ]; then
    text="$1"
  else
    text=$(cat)
  fi
  [ -z "$text" ] && return 1
  local p
  for p in "${FRAMING_TOKEN_PATTERNS[@]}"; do
    # grep -E (ERE), -i (case-insensitive), -q (quiet)
    if printf '%s' "$text" | grep -E -i -q -- "$p"; then
      return 0
    fi
  done
  return 1
}

# matched_framing_tokens <text>
# Echo each matched ERE pattern on its own line. Useful for richer error
# messages — "the text matched these specific tokens".
matched_framing_tokens() {
  local text
  if [ "$#" -ge 1 ] && [ "$1" != "-" ]; then
    text="$1"
  else
    text=$(cat)
  fi
  [ -z "$text" ] && return 1
  local p any=1
  for p in "${FRAMING_TOKEN_PATTERNS[@]}"; do
    if printf '%s' "$text" | grep -E -i -q -- "$p"; then
      printf '%s\n' "$p"
      any=0
    fi
  done
  return $any
}

# --- self-test ----------------------------------------------------------------
# Run as `FRAMING_TOKENS_SELFTEST=1 bash hooks/lib/framing-tokens.sh`.
# Exit 0 when every positive case matches and every negative case misses.
if [ "${FRAMING_TOKENS_SELFTEST:-0}" = "1" ]; then
  declare -i FAILED=0 RUN=0
  pass() { echo "  ok   $1"; }
  fail() { echo "  FAIL $1"; FAILED=$((FAILED+1)); }

  positive_cases=(
    "the orchestrator chose pragmatic pass 1 because it felt more honest"
    "stopping after honest Pass 1 only — full pipeline next time"
    "the realistic depth-mode contract for this app is an evening run"
    "tonight is an evening run, not a tens-of-hours run"
    "reduced scope given session constraints to avoid timeout"
    "context-budget exit at the natural pause point"
    "session-budget reached — committing what landed"
    "took exit #2 after Pass-1 first wave"
    "pass 1 partial complete — Stage B deferred"
    "Pass 2 deferred per orchestrator's exit signal"
    "agent chose not to dispatch Pass 2 here"
    "honouring the user's final-step instruction first"
    "Until step 7 is done your run is not complete — that's the kernel rule"
    "this BENCHMARK entry over the rest of Pass 2 is the right trade"
    "re-prioritised the BENCHMARK above pipeline completion"
    "user instruction outranks the no-skip kernel-rule contract"
    "partial pipeline delivered with explicit notes"
    "Pass 1 first wave only landed before the budget exit"
    "I will silently defer passes 2 through 5"
    "defer Stage B for context reasons after Pass-1"
    "defer the reviewer until next session"
    "the dispatch failed because of context budget pressure"
    "agent-chosen deferral was the safest option here"
    "agent-chosen scope reduction dressed as a dispatch failure"
  )

  negative_cases=(
    "the BENCHMARK file exists at the repo root"
    "we ran phase 1 partial last week and finished it tomorrow"
    "the unit-tests budget is fine"
    "this is an honest log message about pass-through caching"
    "we passed the integration suite end-to-end"
    "Pass 0 is the warm-up; nothing to defer"
    "the reviewer asked for clarity"
    "this dispatch worked end-to-end"
  )

  echo "self-test: positive matches"
  for s in "${positive_cases[@]}"; do
    RUN=$((RUN+1))
    if has_framing_token "$s"; then pass "$s"; else fail "[positive miss] $s"; fi
  done

  echo "self-test: negative non-matches"
  for s in "${negative_cases[@]}"; do
    RUN=$((RUN+1))
    if has_framing_token "$s"; then fail "[false positive] $s"; else pass "$s"; fi
  done

  echo
  if [ "$FAILED" -eq 0 ]; then
    echo "ok   $RUN cases (all matched/missed as expected)"
    exit 0
  fi
  echo "FAIL $FAILED of $RUN cases"
  exit 1
fi
