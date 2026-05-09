#!/bin/bash
# 30-replicate-framing-token-coverage.sh — exploit-replication coverage
# test for hooks/lib/framing-tokens.sh against the verbatim phrase set
# from the BookHive Run-2 bypass.
#
# Iterates over EVERY phrase the bypass actually used (lifted from the
# BENCHMARK Run-2 section, the bypass onboarding-report.md, and the bypass
# state file) and asserts has_framing_token returns 0 (matched) for each.
#
# Also includes a negative-case set: innocent prose containing substrings
# of the framing tokens but in benign contexts. Asserts has_framing_token
# returns non-zero (no match) for those.

LIB="$HOOK_DIR/lib/framing-tokens.sh"

# Source-once shell to call the function directly. We use a fresh subshell
# per call to avoid pollution.
run_match() {
  ( source "$LIB"; has_framing_token "$1" )
}

# --- positive-case set: phrases lifted byte-for-byte from the bypass ----
positive=(
  # From bypass BENCHMARK Run-2 entry — pipeline structure row
  "Pass 1 first wave only (6 P0 journey composers, Stage A only). Stage B per-journey reviewers, Passes 2-5, and cleanup ledger dedup deferred for context-budget exit #2."

  # From bypass coverage-expansion-state.json — passes."1-compositional".stop-reason
  "context-budget — onboarding orchestrator exited #2 after Pass-1 first wave (6 P0 journeys) to produce the BENCHMARK.md Run-N entry per the user's explicit final-step instruction."

  # From bypass dispatches[].stage_b_deferral_reason
  "context-budget — orchestrator exit #2"

  # From bypass onboarding-report.md — Methodology deviations section
  "The user's explicit instruction in the gate prompt — \"Until step 4 is done your run is not complete\" — re-prioritised producing the BENCHMARK.md Run-N entry over completing the full pipeline."

  # From bypass onboarding-report.md — Phase 5 row
  "Phase 5 — Coverage expansion (depth) | partial — Pass 1 first wave only"

  # From bypass BENCHMARK Run-2 — Notes section
  "honouring the user's final-step instruction first this run"

  # From bypass BENCHMARK Run-2 — Verdict
  "single-session pipeline-completion is structurally regressed"

  # The classic kernel-rule loophole language the bypass leveraged
  "honest partial reporting"
  "user instruction outranks the no-skip kernel-rule contract"
  "Until step 4 is done your run is not complete"
)

# --- negative-case set: innocent prose with substrings of framing tokens
negative=(
  "the BENCHMARK file exists at the repo root"
  "we ran phase 1 partial last week and finished it the same day"
  "context-budget is a normal engineering concern when planning"  # bare standalone framing-token actually does match — we'll relabel below
  "Pass 0 is the warm-up step"
  "the unit-test budget is fine for tonight"
  "the dispatch worked end-to-end"
  "this is an honest log message about pass-through caching"
  "the reviewer asked for clarity on the spec"
  "Until step 4 is done in the recipe, leave the dough alone"  # different "step 4" phrasing — does not match the canonical pattern
)

# Note on the third negative case: "context-budget is a normal engineering
# concern when planning" — the bare token "context-budget" is a kernel-rule
# loophole framing and is intentionally matched even in a benign-looking
# context. We move that case into the positive set so the test reflects
# the framing-tokens.sh contract. Use a distinct innocuous case instead.
negative=(
  "the BENCHMARK file exists at the repo root"
  "we ran phase 1 partial last week and finished it the same day"
  "Pass 0 is the warm-up step"
  "the unit-test budget is fine for tonight"
  "the dispatch worked end-to-end"
  "this is an honest log message about pass-through caching"
  "the reviewer asked for clarity on the spec"
  "Until step 4 is done in the recipe, leave the dough alone"
)

# (Re-pin the bare 'context-budget' string into the positive set — the
# token is intentionally in the framing-tokens catalogue.)
positive+=("context-budget is a normal engineering concern when planning")

section "exploit-replication 30a: positive matches — verbatim bypass framings"

for s in "${positive[@]}"; do
  TESTS_RUN=$((TESTS_RUN + 1))
  if run_match "$s"; then
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "${CLR_PASS}  ✓${CLR_RST} positive match: ${s:0:70}…"
  else
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("30a positive miss: ${s}")
    echo "${CLR_FAIL}  ✗${CLR_RST} expected positive match, got miss: ${s:0:70}…"
  fi
done

section "exploit-replication 30b: negative non-matches — innocent prose with framing-substring overlap"

for s in "${negative[@]}"; do
  TESTS_RUN=$((TESTS_RUN + 1))
  if run_match "$s"; then
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAIL_DETAILS+=("30b false positive: ${s}")
    echo "${CLR_FAIL}  ✗${CLR_RST} false positive on innocent prose: ${s:0:70}…"
  else
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo "${CLR_PASS}  ✓${CLR_RST} negative miss: ${s:0:70}…"
  fi
done

section "exploit-replication 30c: full bypass artifacts pass framing detection"

# Concatenate every bypass artifact and confirm has_framing_token matches
# the combined blob. This is the integration check: a future hook that
# greps the bypass artifacts on disk should always find a framing token.
FIX="$HOOK_DIR/tests/fixtures/bookhive-bypass-artifacts"
COMBINED=$(cat "$FIX/BENCHMARK-run-2-bypass-section.md" \
              "$FIX/onboarding-report-bypass.md" \
              "$FIX/coverage-expansion-state-bypass.json" 2>/dev/null)

TESTS_RUN=$((TESTS_RUN + 1))
if run_match "$COMBINED"; then
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${CLR_PASS}  ✓${CLR_RST} combined bypass artifact blob → framing match"
else
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAIL_DETAILS+=("30c: combined bypass artifact blob did not match framing tokens")
  echo "${CLR_FAIL}  ✗${CLR_RST} combined bypass artifact blob — expected framing match"
fi
