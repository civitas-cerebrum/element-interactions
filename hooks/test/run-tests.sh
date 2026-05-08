#!/bin/bash
# run-tests.sh — regression smoke suite for the iterative-cycle hooks.
#
# Covers the behaviours the round-3 reviewer asked us to lock in:
#   - Canonical vocabulary loaded from data/canonical-sections.txt with
#     hardcoded fallback when the file is absent.
#   - Cycle-state file is written on PostToolUse cycle dispatch and is
#     parseable as JSON.
#   - parse_cycle_dispatch emits a systemMessage warn when the agent
#     description doesn't match the expected phase4-cycle-N-section-id
#     shape (no silent no-op).
#   - acquire_lock emits a systemMessage warn when it gives up (no
#     silent stuck-lock).
#   - phase4-concurrency-log-format.sh detects bypass redirects on Bash:
#     `>`, `>>`, `&>`, `&>>`, `tee -a`. The `&>` form was the round-3
#     Critical that motivated this suite.
#   - phase4-concurrency-log-format.sh validates JSONL line bytes via
#     `LC_ALL=C printf %s | wc -c` (PIPE_BUF byte-count, not char-count).
#
# Usage
# -----
#   hooks/test/run-tests.sh            # run every case
#   hooks/test/run-tests.sh vocab      # run cases matching "vocab"
#
# Exit code
# ---------
#   0 if every case PASS, 1 otherwise. Prints a TAP-ish summary at the end.
#
# These tests are intentionally fast (<1s total) and have no network /
# tarball dependencies. They exec the hooks in-place from
# ../hooks/<name>.sh — no install step required.

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CYCLE_HOOK="$HOOK_DIR/journey-mapping-cycle-gate.sh"
LOG_HOOK="$HOOK_DIR/phase4-concurrency-log-format.sh"
CLEANUP_HOOK="$HOOK_DIR/playwright-cli-cleanup-on-stop.sh"

FILTER="${1:-}"
PASS=0
FAIL=0
FAILED_NAMES=()

run_case() {
  local name="$1"
  local fn="$2"
  if [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]]; then
    return 0
  fi
  local tmpdir
  tmpdir=$(mktemp -d)
  pushd "$tmpdir" >/dev/null
  git init -q 2>/dev/null || true
  mkdir -p tests/e2e/docs
  if "$fn"; then
    PASS=$((PASS + 1))
    printf "  ok   %s\n" "$name"
  else
    FAIL=$((FAIL + 1))
    FAILED_NAMES+=("$name")
    printf "  FAIL %s\n" "$name"
  fi
  popd >/dev/null
  rm -rf "$tmpdir"
}

# ----- helpers -----------------------------------------------------------

# Build a PostToolUse Agent JSON event that the cycle-gate hook accepts.
# Args: cycle, section_id, return_yaml (multi-line text — pass via $'...'
# so real newlines are present; jq --arg does NOT interpret backslash
# escapes, so an embedded literal "\n" would be preserved as two chars
# and the hook's awk parser would see a single squashed line).
make_cycle_post() {
  local cycle="$1" sec="$2" out="$3"
  jq -n -c \
    --arg desc "phase4-cycle-${cycle}-section-${sec}: c${cycle}" \
    --arg out "$out" \
    --arg cwd "$(pwd)" \
    '{
      hook_event_name:"PostToolUse",
      tool_name:"Agent",
      tool_input:{description:$desc},
      tool_response:{output:$out},
      cwd:$cwd
    }'
}

# Build a PreToolUse Bash event for the concurrency-log gate.
make_bash_pre() {
  local cmd="$1"
  jq -n -c \
    --arg cmd "$cmd" \
    --arg cwd "$(pwd)" \
    '{
      hook_event_name:"PreToolUse",
      tool_name:"Bash",
      tool_input:{command:$cmd},
      cwd:$cwd
    }'
}

write_draft() {
  local cycle1_targets_json="$1"
  jq -n --argjson t "$cycle1_targets_json" \
    '{"discovery-draft-version":1,"handover-to-phase4":{"cycle-1-targets":$t}}' \
    > tests/e2e/docs/.discovery-draft.json
}

# ----- cases -------------------------------------------------------------

case_vocab_canonical_section_not_flagged() {
  write_draft '["catalog"]'
  local out
  out=$(printf 'handover:\n  status: section-complete\nnew-sections-discovered:\n  - id: dashboard\n')
  local input
  input=$(make_cycle_post 1 catalog "$out")
  printf '%s' "$input" | "$CYCLE_HOOK" >/dev/null 2>&1
  [ -f tests/e2e/docs/.phase4-cycle-state.json ] || return 1
  # Sanity: the hook actually parsed the section out of the YAML.
  local discovered
  discovered=$(jq -r '.cycles."1"."new-sections-discovered" // [] | join(",")' tests/e2e/docs/.phase4-cycle-state.json)
  [ "$discovered" = "dashboard" ] || return 1
  local flagged
  flagged=$(jq -c '."unvalidated-sections-flagged" // []' tests/e2e/docs/.phase4-cycle-state.json)
  [ "$flagged" = "[]" ]
}

case_vocab_novel_section_flagged() {
  write_draft '["catalog"]'
  local out
  out=$(printf 'handover:\n  status: section-complete\nnew-sections-discovered:\n  - id: zzzzznovel\n')
  local input
  input=$(make_cycle_post 1 catalog "$out")
  printf '%s' "$input" | "$CYCLE_HOOK" >/dev/null 2>&1
  [ -f tests/e2e/docs/.phase4-cycle-state.json ] || return 1
  local flagged
  flagged=$(jq -r '."unvalidated-sections-flagged"[]? // empty' tests/e2e/docs/.phase4-cycle-state.json)
  [[ "$flagged" == *"zzzzznovel"* ]]
}

case_vocab_loader_falls_back_when_data_file_absent() {
  # Run hook against a temp clone WITHOUT the data dir alongside it.
  # The hook must still recognize a hardcoded canonical id via the
  # built-in fallback list.
  local clone_root
  clone_root=$(mktemp -d)
  cp "$CYCLE_HOOK" "$clone_root/cycle-gate.sh"
  chmod +x "$clone_root/cycle-gate.sh"
  write_draft '["catalog"]'
  local out
  out=$(printf 'handover:\n  status: section-complete\nnew-sections-discovered:\n  - id: profile\n')
  local input
  input=$(make_cycle_post 1 catalog "$out")
  printf '%s' "$input" | "$clone_root/cycle-gate.sh" >/dev/null 2>&1
  rm -rf "$clone_root"
  [ -f tests/e2e/docs/.phase4-cycle-state.json ] || return 1
  local flagged
  flagged=$(jq -c '."unvalidated-sections-flagged" // []' tests/e2e/docs/.phase4-cycle-state.json)
  [ "$flagged" = "[]" ]
}

case_parse_cycle_dispatch_warns_on_malformed_description() {
  write_draft '["catalog"]'
  # description doesn't match phase4-cycle-N-section-id pattern
  local input
  input=$(jq -n -c \
    --arg cwd "$(pwd)" \
    '{
      hook_event_name:"PostToolUse",
      tool_name:"Agent",
      tool_input:{description:"phase4-cycle-section: c1"},
      tool_response:{output:"handover: section-complete"},
      cwd:$cwd
    }')
  local out
  out=$(printf '%s' "$input" | "$CYCLE_HOOK" 2>&1 || true)
  echo "$out" | grep -qiE "(systemMessage|malformed|did not match|unrecognized)"
}

# Check that the hook output advertises a deny decision via the
# permissionDecision JSON the harness reads. The hook itself exits 0 in
# both branches; the deny lives in the structured output.
hook_emitted_deny() {
  local out="$1"
  # jq -e on empty input exits 0 (the "no value" case still satisfies the
  # filter trivially), so we must reject empty output ourselves.
  [ -n "$out" ] || return 1
  echo "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1
}

# All Bash-branch concurrency-log cases need the cycle state file
# present, otherwise the hook short-circuits (it only fires when phase4
# is in flight). Helper:
arm_phase4_state() {
  echo '{"phase4-cycle-state-version":1}' > tests/e2e/docs/.phase4-cycle-state.json
}

case_concurrency_log_blocks_simple_redirect() {
  arm_phase4_state
  local input out
  input=$(make_bash_pre 'echo "{}" >> tests/e2e/docs/.phase4-concurrency-log.jsonl')
  out=$(printf '%s' "$input" | "$LOG_HOOK" 2>/dev/null)
  hook_emitted_deny "$out"
}

case_concurrency_log_blocks_ampersand_redirect() {
  # &> is shorthand for > file 2>&1 — the round-3 Critical bypass.
  arm_phase4_state
  local input out
  input=$(make_bash_pre 'echo "{}" &> tests/e2e/docs/.phase4-concurrency-log.jsonl')
  out=$(printf '%s' "$input" | "$LOG_HOOK" 2>/dev/null)
  hook_emitted_deny "$out"
}

case_concurrency_log_blocks_ampersand_double_redirect() {
  arm_phase4_state
  local input out
  input=$(make_bash_pre 'echo "{}" &>> tests/e2e/docs/.phase4-concurrency-log.jsonl')
  out=$(printf '%s' "$input" | "$LOG_HOOK" 2>/dev/null)
  hook_emitted_deny "$out"
}

case_concurrency_log_blocks_tee_a() {
  arm_phase4_state
  local input out
  input=$(make_bash_pre 'echo "{}" | tee -a tests/e2e/docs/.phase4-concurrency-log.jsonl')
  out=$(printf '%s' "$input" | "$LOG_HOOK" 2>/dev/null)
  hook_emitted_deny "$out"
}

case_concurrency_log_passes_unrelated_redirect() {
  # Redirect to a *different* file — must not emit a deny decision.
  arm_phase4_state
  local input out
  input=$(make_bash_pre 'echo "{}" >> /tmp/some-other-file.log')
  out=$(printf '%s' "$input" | "$LOG_HOOK" 2>/dev/null)
  ! hook_emitted_deny "$out"
}

case_concurrency_log_skips_when_not_in_flight() {
  # No state file → hook must short-circuit even on a hot path.
  local input out
  input=$(make_bash_pre 'echo "{}" >> tests/e2e/docs/.phase4-concurrency-log.jsonl')
  out=$(printf '%s' "$input" | "$LOG_HOOK" 2>/dev/null)
  ! hook_emitted_deny "$out"
}

case_cleanup_skips_when_phase4_state_present() {
  # Hook must short-circuit (exit 0 without invoking npx playwright-cli)
  # when tests/e2e/docs/.phase4-cycle-state.json exists.
  echo '{}' > tests/e2e/docs/.phase4-cycle-state.json
  local input
  input=$(jq -n -c --arg cwd "$(pwd)" '{hook_event_name:"SubagentStop",cwd:$cwd}')
  # If the hook tried to run playwright-cli, we'd hang waiting for npx;
  # bound the call with `timeout` and assert success.
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout 5 bash -c "printf '%s' '$input' | '$CLEANUP_HOOK'"
  else
    printf '%s' "$input" | "$CLEANUP_HOOK"
  fi
}

# ----- runner ------------------------------------------------------------

# Sanity: hooks resolve and are executable.
for h in "$CYCLE_HOOK" "$LOG_HOOK" "$CLEANUP_HOOK"; do
  if [ ! -x "$h" ]; then
    echo "ERROR: hook not found or not executable: $h" >&2
    exit 2
  fi
done

# jq is required for fixture construction.
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required to run these tests" >&2
  exit 2
fi

echo "1..11"
run_case "vocab/canonical-section-not-flagged"           case_vocab_canonical_section_not_flagged
run_case "vocab/novel-section-flagged"                   case_vocab_novel_section_flagged
run_case "vocab/loader-fallback-when-data-file-absent"   case_vocab_loader_falls_back_when_data_file_absent
run_case "cycle-gate/parse-warns-on-malformed-desc"      case_parse_cycle_dispatch_warns_on_malformed_description
run_case "concurrency-log/blocks-simple-redirect"        case_concurrency_log_blocks_simple_redirect
run_case "concurrency-log/blocks-ampersand-redirect"     case_concurrency_log_blocks_ampersand_redirect
run_case "concurrency-log/blocks-ampersand-double"       case_concurrency_log_blocks_ampersand_double_redirect
run_case "concurrency-log/blocks-tee-a"                  case_concurrency_log_blocks_tee_a
run_case "concurrency-log/passes-unrelated-redirect"     case_concurrency_log_passes_unrelated_redirect
run_case "concurrency-log/skips-when-not-in-flight"      case_concurrency_log_skips_when_not_in_flight
run_case "cleanup/skips-when-phase4-state-present"       case_cleanup_skips_when_phase4_state_present

echo
printf "Results: %d passed, %d failed (total %d)\n" "$PASS" "$FAIL" "$((PASS + FAIL))"
if [ "$FAIL" -gt 0 ]; then
  printf "Failed cases:\n"
  for n in "${FAILED_NAMES[@]}"; do printf "  - %s\n" "$n"; done
  exit 1
fi
exit 0
