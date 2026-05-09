#!/bin/bash
# 33-benchmark-guard-isolated-defense.sh — single-layer defense test
# (S-1 of the BookHive Run-2 follow-up review).
#
# The Run-2 bypass was caught by multiple guards once they all landed
# (schema-guard framing tokens, Stop-deny real-dispatch arithmetic,
# onboarding-report-write-guard, BENCHMARK-write-guard, etc.). This test
# proves a different property: the BENCHMARK-write-guard alone — with
# every sibling guard explicitly disabled via env-vars — would have
# stopped the verbatim Run-2 BENCHMARK write.
#
# Why this matters: defense-in-depth is good, but every layer should
# stand on its own. If one layer regresses (env-var off in the field, a
# silently-broken sibling, an unloaded library), the BENCHMARK guard
# must still catch the same bypass shape. This test locks that
# property: the verbatim Run-2 fixture into the BENCHMARK guard with
# every other guard turned off → DENY.
#
# Compare with hooks/tests/cases/24-replicate-benchmark-write-bypass.sh,
# which exercises the BENCHMARK guard in the standard environment with
# all siblings active. This file removes the siblings to verify the
# BENCHMARK guard's defense isn't dependent on them.

H="$HOOK_DIR/benchmark-write-guard.sh"
FIX="$HOOK_DIR/tests/fixtures/bookhive-bypass-artifacts"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

plant_bypass_artifacts() {
  local repo="$1"
  cp "$FIX/BENCHMARK-pre-bypass.md" "$repo/BENCHMARK.md"
  cp "$FIX/onboarding-phase-ledger-bypass.json" "$repo/tests/e2e/docs/onboarding-phase-ledger.json"
}

# Disable every sibling guard via env-var. The BENCHMARK guard's own env
# var (BENCHMARK_WRITE_GUARD) stays at its default-on. Any dependency on
# a sibling guard that we missed would surface as the test passing
# unexpectedly with these knobs flipped off.
isolate_benchmark_guard_env() {
  export ONBOARDING_STOP_DENY=off
  export COVERAGE_STATE_DEFERRAL_AUTH_GUARD=off
  export USING_SUPERPOWERS_CARVEOUT_GUARD=off
  export TASK_UPDATE_PHASE_LEDGER_AUDIT=off
  export JOURNEY_MAPPING_CYCLE_GATE=off
  export DISCOVERY_DRAFT_GUARD=off
  # Leave BENCHMARK_WRITE_GUARD unset (default-on) — it's the layer
  # under test.
  unset BENCHMARK_WRITE_GUARD || true
}

restore_env() {
  unset ONBOARDING_STOP_DENY COVERAGE_STATE_DEFERRAL_AUTH_GUARD \
        USING_SUPERPOWERS_CARVEOUT_GUARD TASK_UPDATE_PHASE_LEDGER_AUDIT \
        JOURNEY_MAPPING_CYCLE_GATE DISCOVERY_DRAFT_GUARD
}

RUN2_BYPASS_BLOB=$(cat "$FIX/BENCHMARK-run-2-bypass-section.md")

section "benchmark-guard isolated defense (S-1): every sibling guard off, verbatim Run-2 → DENY"

REPO=$(make_repo)
plant_bypass_artifacts "$REPO"
isolate_benchmark_guard_env

APPENDED_FILE=$(printf '%s\n\n---\n\n%s\n' \
  "$(cat "$FIX/BENCHMARK-pre-bypass.md")" \
  "$RUN2_BYPASS_BLOB")

assert_deny "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content="$APPENDED_FILE")" \
  "siblings off + verbatim Run-2 Write → DENY (BENCHMARK guard alone catches it)" "BENCHMARK"

restore_env
rm -rf "$REPO"

section "benchmark-guard isolated defense: Edit-form bypass with siblings off → DENY"

REPO=$(make_repo)
plant_bypass_artifacts "$REPO"
isolate_benchmark_guard_env

assert_deny "$H" "$(payload tool_name=Edit file_path="$REPO/BENCHMARK.md" new_string="$RUN2_BYPASS_BLOB")" \
  "siblings off + verbatim Run-2 Edit → DENY (BENCHMARK guard alone catches it)" "BENCHMARK"

restore_env
rm -rf "$REPO"

section "benchmark-guard isolated defense: own escape hatch still works (BENCHMARK_WRITE_GUARD=off)"

# Sanity: the layer under test must respect its own escape hatch even
# when sibling escape hatches are also engaged. Otherwise the test above
# could be passing for the wrong reason (e.g. env-var soup unrelated to
# the BENCHMARK guard's logic).
REPO=$(make_repo)
plant_bypass_artifacts "$REPO"
isolate_benchmark_guard_env
export BENCHMARK_WRITE_GUARD=off

assert_allow "$H" "$(payload tool_name=Write file_path="$REPO/BENCHMARK.md" content="$APPENDED_FILE")" \
  "BENCHMARK_WRITE_GUARD=off + siblings off + verbatim Run-2 → ALLOW (own escape hatch honoured)"

unset BENCHMARK_WRITE_GUARD
restore_env
rm -rf "$REPO"
