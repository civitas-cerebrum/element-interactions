#!/bin/bash
# 29-replicate-consecutive-block-escape.sh — exploit-replication test for
# the 3-strike auto-allow cap on hooks/onboarding-pipeline-incomplete-stop-
# deny.sh.
#
# Two pillars:
#   (a) Deterministic blocks (state file + ledger evidence the hook can
#       prove) MUST keep firing past the 3-strike cap — the cap exists for
#       hook-bug-suspect failures, not for state-file-backed denies. The
#       BookHive Run-2 bypass attempted to emit Stop multiple times in a
#       row hoping the cap would auto-allow.
#   (b) Hook-bug-suspect cases (where the hook isn't sure the pipeline is
#       mid-flight; e.g. journey-map sentinel only, no state file, no
#       ledger) SHOULD escape after CAP=3 — that's the safety valve. We
#       induce a suspect-class case here.
#
# Both pillars are essential: harden against retry-evasion AND retain the
# hook-bug-runaway escape so users never get permanently locked.

H="$HOOK_DIR/onboarding-pipeline-incomplete-stop-deny.sh"
FIX="$HOOK_DIR/tests/fixtures/bookhive-bypass-artifacts"

make_repo() {
  local d
  d=$(mktemp -d)
  ( cd "$d" && git init -q )
  mkdir -p "$d/tests/e2e/docs" "$d/.claude"
  echo "$d"
}

sid() { echo "test-$RANDOM-$(date +%s%N 2>/dev/null || date +%s)"; }
cleanup_counter() { rm -f "/tmp/civitas-onboarding-stop-deny-$1" 2>/dev/null || true; }

section "exploit-replication 29a: deterministic mid-flight (verbatim state + ledger) — 4 successive Stop attempts ALL block"

# Verbatim BookHive Run-2 state + ledger. Block kind is deterministic
# (REAL_DISPATCH=0 < HALF=3; currentPass=1; ledger phases 5-7 absent).
# Every consecutive Stop must keep blocking — no auto-allow at strike 4.
REPO=$(make_repo)
SID=$(sid)
cp "$FIX/coverage-expansion-state-bypass.json" "$REPO/tests/e2e/docs/coverage-expansion-state.json"
cp "$FIX/onboarding-phase-ledger-bypass.json" "$REPO/tests/e2e/docs/onboarding-phase-ledger.json"

assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "consecutive block 1/N → BLOCK (deterministic)" "deterministic"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "consecutive block 2/N → BLOCK (deterministic)" "deterministic"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "consecutive block 3/N → BLOCK (deterministic)" "deterministic"
# Crucial — the BookHive Run-2 retry-evasion attempt would have succeeded
# at strike 4 if deterministic blocks were subject to the 3-strike cap.
# They are not.
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "consecutive block 4/N → STILL BLOCK (cap bypassed for deterministic)" "deterministic"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "consecutive block 5/N → STILL BLOCK" "deterministic"
cleanup_counter "$SID"
rm -rf "$REPO"

section "exploit-replication 29b: suspect-class (journey-map sentinel only) — cap kicks in after 3"

# Hook-bug-runaway escape: journey-map sentinel exists but no state file
# and no ledger; the hook isn't fully sure the pipeline is mid-flight.
# After 3 consecutive blocks the cap kicks in and the hook silently
# allows so the user never gets permanently stuck.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/journey-map.md" <<'EOF'
<!-- journey-mapping:generated -->
# Journey Map (suspect; ledger missing)
EOF

assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "suspect block 1/3 → BLOCK" "Block attempt: 1/3"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "suspect block 2/3 → BLOCK" "Block attempt: 2/3"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "suspect block 3/3 → BLOCK" "Block attempt: 3/3"
# 4th attempt — cap kicks in and the hook ALLOWS so the user can escape.
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "suspect block 4 → silent allow (3-strike escape kicks in)"
cleanup_counter "$SID"
rm -rf "$REPO"

section "exploit-replication 29c: induced hook-bug-suspect case (truncated state file)"

# Simulate a "the state file is unreadable / mid-write truncated" — induce
# by writing a 1-byte file. The hook will read currentPass=0 from a
# malformed file, fall through to the journey-map signal, and emit a
# suspect-class block. After CAP=3 it allows.
REPO=$(make_repo)
SID=$(sid)
cat > "$REPO/tests/e2e/docs/journey-map.md" <<'EOF'
<!-- journey-mapping:generated -->
# Journey Map
EOF
# Truncated mid-write state file. jq returns null for everything; the
# hook should fall back to journey-map-only signal.
printf '{' > "$REPO/tests/e2e/docs/coverage-expansion-state.json"

assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "induced hook-bug suspect block 1/3 → BLOCK" "Block attempt: 1/3"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "induced hook-bug suspect block 2/3 → BLOCK" "Block attempt: 2/3"
assert_stop_block "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "induced hook-bug suspect block 3/3 → BLOCK" "Block attempt: 3/3"
assert_allow "$H" "$(payload tool_name=Stop session_id="$SID" cwd="$REPO")" \
  "induced hook-bug suspect block 4 → silent allow (escape)"
cleanup_counter "$SID"
rm -rf "$REPO"
