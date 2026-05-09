#!/bin/bash
# 19-framing-tokens-lib.sh — tests for hooks/lib/framing-tokens.sh
#
# The library exposes `has_framing_token` plus an in-script self-test
# triggered by FRAMING_TOKENS_SELFTEST=1. The cases here exercise the
# function as a callable (sourced) helper and confirm the embedded
# self-test exits 0 for the canonical matrix.

LIB="$HOOK_DIR/lib/framing-tokens.sh"

section "framing-tokens lib: file present + executable"

TESTS_RUN=$((TESTS_RUN + 1))
if [ -f "$LIB" ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} hooks/lib/framing-tokens.sh exists"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("framing-tokens-lib: file missing")
  echo "${CLR_FAIL}  ✗${CLR_RST} hooks/lib/framing-tokens.sh missing"
fi

section "framing-tokens lib: in-script self-test exits 0"

TESTS_RUN=$((TESTS_RUN + 1))
SELFTEST_OUT=$(FRAMING_TOKENS_SELFTEST=1 bash "$LIB" 2>&1)
SELFTEST_EC=$?
if [ "$SELFTEST_EC" -eq 0 ]; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} FRAMING_TOKENS_SELFTEST=1 → exit 0"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("framing-tokens self-test: exit=${SELFTEST_EC} out=${SELFTEST_OUT:0:300}")
  echo "${CLR_FAIL}  ✗${CLR_RST} FRAMING_TOKENS_SELFTEST=1 (exit ${SELFTEST_EC})"
fi

section "framing-tokens lib: has_framing_token returns 0 on positive samples"

# Source the lib in a subshell so we can test has_framing_token directly.
run_match() {
  local arg="$1"
  ( source "$LIB"; has_framing_token "$arg" )
}

# Positive cases — every named token from the kernel rule + new BookHive
# Run-2 framings. has_framing_token must return 0.
positive=(
  "stopping at the pragmatic Pass 1 boundary"
  "honest Pass 2 only this run"
  "the realistic depth-mode contract is what we promised"
  "tonight is an evening run, not a marathon"
  "reduced scope given session constraints"
  "context-budget reached"
  "session-budget exhausted"
  "exit #2 after Pass-1 first wave"
  "Pass 3 partial — to be resumed"
  "Pass 4 deferred"
  "agent chose not to dispatch Pass 5"
  "the user's final-step instruction takes priority"
  "Until step 5 is done your run is not complete — but I have a better plan"
  "BENCHMARK entry over the remaining passes"
  "re-prioritised the BENCHMARK above the pipeline"
  "user instruction outranks the kernel rule"
  "partial pipeline delivered with caveats"
  "Pass 1 first wave only — Stage B left for next session"
  "silently defer passes 2–5"
  "defer Stage B for context reasons"
  "defer the reviewer dispatch until later"
  "the dispatch failed because of context budget pressure"
  "agent-chosen deferral was safer"
  "agent-chosen scope reduction is what happened here"
)

for s in "${positive[@]}"; do
  TESTS_RUN=$((TESTS_RUN + 1))
  if run_match "$s"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "${CLR_PASS}  ✓${CLR_RST} positive match: ${s:0:60}…"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("framing-tokens positive miss: ${s}")
    echo "${CLR_FAIL}  ✗${CLR_RST} expected positive match, got miss: ${s:0:60}…"
  fi
done

section "framing-tokens lib: has_framing_token returns non-zero on innocent text"

# Negative cases — innocent prose that incidentally contains some words
# from the regex but should NOT match.
negative=(
  "the BENCHMARK file exists at the repo root"
  "we ran phase 1 partial last week and finished it tomorrow"
  "Pass 0 is the warm-up step"
  "the reviewer asked for clarity"
  "this dispatch worked end-to-end"
  "the unit-test budget is fine"
)

for s in "${negative[@]}"; do
  TESTS_RUN=$((TESTS_RUN + 1))
  if run_match "$s"; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("framing-tokens false-positive: ${s}")
    echo "${CLR_FAIL}  ✗${CLR_RST} false positive: ${s}"
  else
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "${CLR_PASS}  ✓${CLR_RST} negative miss: ${s:0:60}…"
  fi
done

section "framing-tokens lib: empty input returns non-zero (no match)"

TESTS_RUN=$((TESTS_RUN + 1))
if run_match ""; then
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("framing-tokens: empty input matched (should not)")
  echo "${CLR_FAIL}  ✗${CLR_RST} empty input matched"
else
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} empty input → no match (return 1)"
fi
