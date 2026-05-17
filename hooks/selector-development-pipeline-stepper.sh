#!/bin/bash
# selector-development-pipeline-stepper.sh — 8-step pipeline state machine
#
# Hook    : PreToolUse:Bash|Edit|Write  — deny if predecessor step not in journal as pass
#           PostToolUse:Bash|Edit|Write — append step entry to journal on success or fail
# Mode    : DENY (Pre) + RECORD (Post)
# State   : <ws>/tests/e2e/.selector-development/<scope>.receipt.json
# Env     : WORKSPACE_ROOT (required) — filesystem root of the target project
#           FAKE_STAGED_HASH — override for staged diff hash (test mode)
#
# Pipeline steps (ordered):
#   1. before_snapshot  — playwright-cli screenshot .../before/...
#   2. patch_applied    — Edit|Write to frontend source path
#   3. typecheck        — npm run typecheck / tsc --noEmit / npx tsc
#   4. unit_tests       — npm test / npm run test / vitest / jest (not playwright)
#   5. e2e              — playwright test
#   6. after_snapshot   — playwright-cli screenshot .../after/...
#   7. visual_diff      — node .../visual-diff.js
#   8. commit           — git commit (extra: git_diff_hash must match staged diff)
#
# Behaviour:
#   PreToolUse
#     - Silent allow if tool isn't Bash|Edit|Write
#     - Silent allow if no .current-scope or no receipt (scope not in flight)
#     - Silent allow if step is unrecognised
#     - Deny if any step in journal has status=fail (must revert and restart)
#     - Deny if this step's predecessor isn't in journal with status=pass
#     - Step 1 (before_snapshot) has no predecessor — allow if receipt exists
#     - Step 8 (commit) additionally requires git_diff_hash match
#   PostToolUse
#     - Silent allow regardless (records; never blocks)
#     - Appends {name, status: pass|fail, ts} to journal
#     - commit on pass: archives receipt + clears .current-scope
#
# Canonical reference
# -------------------
# skills/selector-development/SKILL.md §"Pipeline steps"

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

# Detect if a file path is a frontend source path.
# Mirrors the activation-gate convention: must have a frontend extension AND
# live under a recognized source directory (src/ app/ pages/ components/ lib/
# features/ views/ utils/). Test spec files (.spec.ts) and files under tests/
# are explicitly excluded even if they have a matching extension.
is_frontend_src_path() {
  local path="$1"
  # Must have a frontend extension
  case "$path" in
    *.tsx|*.jsx|*.ts|*.js|*.vue|*.svelte) ;;
    *) return 1 ;;
  esac
  # Exclude spec files and test directories
  case "$path" in
    *.spec.ts|*.spec.js|*.spec.tsx|*.test.ts|*.test.js|*.test.tsx) return 1 ;;
    */tests/*|*/__tests__/*|*/__mocks__/*) return 1 ;;
  esac
  # Must be under a recognized source directory
  case "$path" in
    */src/*|*/app/*|*/pages/*|*/components/*|*/lib/*|*/features/*|*/views/*|*/utils/*)
      return 0 ;;
    *) return 1 ;;
  esac
}

# Detect which pipeline step a tool invocation corresponds to.
# Outputs the step name, or nothing if unrecognised.
detect_step() {
  local tool_name="$1"
  local cmd_or_path="$2"   # command for Bash; file_path for Edit|Write

  case "$tool_name" in
    Bash)
      local cmd="$cmd_or_path"
      # before_snapshot: playwright-cli screenshot with /before/ in path
      if echo "$cmd" | grep -qE 'playwright-cli[[:space:]].*screenshot.*\/before\/'; then
        echo "before_snapshot"; return
      fi
      # after_snapshot: playwright-cli screenshot with /after/ in path
      if echo "$cmd" | grep -qE 'playwright-cli[[:space:]].*screenshot.*\/after\/'; then
        echo "after_snapshot"; return
      fi
      # e2e: playwright test (but NOT playwright-cli)
      # Accepts bare `playwright test` as well as runner-prefixed forms:
      # `npx playwright test`, `bunx playwright test`,
      # `pnpm exec playwright test`, `yarn exec playwright test` —
      # mirroring the canonical runner list from playwright-cli-isolation-guard.sh.
      RUNNERS='(npx|bunx|pnpm[[:space:]]+exec|yarn[[:space:]]+exec)[[:space:]]+'
      SEP='(^|[;|][[:space:]]*|&&[[:space:]]*)'
      if echo "$cmd" | grep -qE "${SEP}(${RUNNERS})?playwright[[:space:]]+test([[:space:]]|$)"; then
        echo "e2e"; return
      fi
      # typecheck: npm run typecheck, tsc --noEmit, npx tsc
      if echo "$cmd" | grep -qE '(npm[[:space:]]+run[[:space:]]+typecheck|tsc[[:space:]]+--noEmit|npx[[:space:]]+tsc([[:space:]]|$))'; then
        echo "typecheck"; return
      fi
      # unit_tests: npm test / npm run test / vitest / jest — but NOT playwright test
      if ! echo "$cmd" | grep -qE 'playwright[[:space:]]+test'; then
        if echo "$cmd" | grep -qE '(npm[[:space:]]+test([[:space:]]|$)|npm[[:space:]]+run[[:space:]]+test([[:space:]]|$)|vitest([[:space:]]|$)|jest([[:space:]]|$))'; then
          echo "unit_tests"; return
        fi
      fi
      # visual_diff: node .../visual-diff.js
      if echo "$cmd" | grep -qE 'node[[:space:]].*\/visual-diff\.js'; then
        echo "visual_diff"; return
      fi
      # commit: git commit
      if echo "$cmd" | grep -qE '(^|[;|&][[:space:]]*)git[[:space:]]+commit([[:space:]]|$)'; then
        echo "commit"; return
      fi
      ;;
    Edit|Write)
      if is_frontend_src_path "$cmd_or_path"; then
        echo "patch_applied"; return
      fi
      ;;
  esac
  # Unrecognised
  echo ""
}

# Step predecessor table
step_predecessor() {
  case "$1" in
    before_snapshot) echo "" ;;           # no predecessor (step 1)
    patch_applied)   echo "before_snapshot" ;;
    typecheck)       echo "patch_applied" ;;
    unit_tests)      echo "typecheck" ;;
    e2e)             echo "unit_tests" ;;
    after_snapshot)  echo "e2e" ;;
    visual_diff)     echo "after_snapshot" ;;
    commit)          echo "visual_diff" ;;
    *)               echo "" ;;
  esac
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

INPUT=$(cat)
EVENT_NAME=$(echo "$INPUT" | jq -r '.hook_event_name // ""')
TOOL_NAME=$(echo "$INPUT"  | jq -r '.tool_name // empty')

# Only handle Bash, Edit, Write
case "$TOOL_NAME" in
  Bash|Edit|Write) ;;
  *) exit 0 ;;
esac

# Resolve workspace root
WS="${WORKSPACE_ROOT:-}"
if [ -z "$WS" ]; then
  CWD=$(echo "$INPUT" | jq -r '.cwd // "."' 2>/dev/null || echo ".")
  WS=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
fi

SELDEV_DIR="$WS/tests/e2e/.selector-development"
SCOPE_FILE="$SELDEV_DIR/.current-scope"

# If no scope is active, exit silently — this hook only enforces during a flight
if [ ! -f "$SCOPE_FILE" ]; then
  exit 0
fi

SCOPE=$(cat "$SCOPE_FILE" 2>/dev/null || true)
if [ -z "$SCOPE" ]; then
  exit 0
fi

RECEIPT="$SELDEV_DIR/${SCOPE}.receipt.json"
if [ ! -f "$RECEIPT" ]; then
  exit 0
fi

# Must be valid JSON
echo "$RECEIPT" | xargs cat 2>/dev/null | jq empty 2>/dev/null || exit 0

# Extract tool input
CMD_OR_PATH=""
case "$TOOL_NAME" in
  Bash)       CMD_OR_PATH=$(echo "$INPUT" | jq -r '.tool_input.command // ""') ;;
  Edit|Write) CMD_OR_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""') ;;
esac

STEP=$(detect_step "$TOOL_NAME" "$CMD_OR_PATH")
if [ -z "$STEP" ]; then
  exit 0
fi

# Load current steps from receipt
STEPS_JSON=$(jq '.steps // []' "$RECEIPT" 2>/dev/null || echo "[]")

# ---------------------------------------------------------------------------
# === PostToolUse branch: record result =====================================
# ---------------------------------------------------------------------------
if [ "$EVENT_NAME" = "PostToolUse" ]; then
  TOOL_RESPONSE=$(echo "$INPUT" | jq -c '.tool_response // {}')
  EXIT_CODE=$(echo "$TOOL_RESPONSE" | jq -r '.exitCode // .exit_code // .returncode // "unknown"')

  STATUS="pass"
  if [ "$EXIT_CODE" != "0" ] && [ "$EXIT_CODE" != "unknown" ]; then
    STATUS="fail"
  fi

  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Build the step entry and update receipt fields based on step type
  case "$STEP" in
    patch_applied)
      # Append step entry with files field
      FILE_PATH="$CMD_OR_PATH"
      NEW_STEPS=$(jq -n \
        --argjson steps "$STEPS_JSON" \
        --arg name "$STEP" \
        --arg status "$STATUS" \
        --arg ts "$TS" \
        --arg file "$FILE_PATH" \
        '$steps + [{name: $name, status: $status, ts: $ts, files: [$file]}]')

      # Compute git_diff_hash for the staged changes to this file
      if [ -n "${FAKE_STAGED_HASH:-}" ]; then
        DIFF_HASH="$FAKE_STAGED_HASH"
      else
        DIFF_HASH=$(git -C "$WS" diff --cached -- "$FILE_PATH" 2>/dev/null | sha256sum | awk '{print $1}' || echo "")
      fi

      # Write updated receipt: steps + git_diff_hash + append to top-level files
      jq \
        --argjson steps "$NEW_STEPS" \
        --arg hash "$DIFF_HASH" \
        --arg file "$FILE_PATH" \
        '.steps = $steps | .git_diff_hash = $hash | .files = ((.files // []) + [$file] | unique)' \
        "$RECEIPT" > "${RECEIPT}.tmp" \
        && mv "${RECEIPT}.tmp" "$RECEIPT" \
        || rm -f "${RECEIPT}.tmp"
      ;;

    visual_diff)
      # Parse diff_pixels from tool_response.stdout JSON
      STDOUT_RAW=$(echo "$TOOL_RESPONSE" | jq -r '.stdout // ""')
      DIFF_PIXELS=$(echo "$STDOUT_RAW" | jq -r '.diffPixels // 0' 2>/dev/null || echo "0")
      # Ensure it's a number (default 0 if not parseable)
      if ! echo "$DIFF_PIXELS" | grep -qE '^[0-9]+$'; then
        DIFF_PIXELS=0
      fi

      NEW_STEPS=$(jq -n \
        --argjson steps "$STEPS_JSON" \
        --arg name "$STEP" \
        --arg status "$STATUS" \
        --arg ts "$TS" \
        --argjson diff_pixels "$DIFF_PIXELS" \
        '$steps + [{name: $name, status: $status, ts: $ts, diff_pixels: $diff_pixels}]')

      jq --argjson steps "$NEW_STEPS" '.steps = $steps' "$RECEIPT" > "${RECEIPT}.tmp" \
        && mv "${RECEIPT}.tmp" "$RECEIPT" \
        || rm -f "${RECEIPT}.tmp"
      ;;

    commit)
      # Idempotency: if .current-scope is already gone, don't double-archive
      if [ ! -f "$SCOPE_FILE" ]; then
        exit 0
      fi

      # Append the step entry to the journal
      NEW_STEPS=$(jq -n \
        --argjson steps "$STEPS_JSON" \
        --arg name "$STEP" \
        --arg status "$STATUS" \
        --arg ts "$TS" \
        '$steps + [{name: $name, status: $status, ts: $ts}]')

      jq --argjson steps "$NEW_STEPS" '.steps = $steps' "$RECEIPT" > "${RECEIPT}.tmp" \
        && mv "${RECEIPT}.tmp" "$RECEIPT" \
        || rm -f "${RECEIPT}.tmp"

      # On success: archive receipt and clear .current-scope
      if [ "$STATUS" = "pass" ]; then
        ARCHIVE_DIR="$SELDEV_DIR/archive"
        mkdir -p "$ARCHIVE_DIR"
        TS_SAFE=$(echo "$TS" | tr ':' '-')
        cp "$RECEIPT" "${ARCHIVE_DIR}/${SCOPE}.${TS_SAFE}.receipt.json" 2>/dev/null || true
        rm -f "$SCOPE_FILE"
      fi
      ;;

    *)
      # Default: before_snapshot, typecheck, unit_tests, e2e, after_snapshot
      # Shape: {name, status, ts} — no extras needed
      NEW_STEPS=$(jq -n \
        --argjson steps "$STEPS_JSON" \
        --arg name "$STEP" \
        --arg status "$STATUS" \
        --arg ts "$TS" \
        '$steps + [{name: $name, status: $status, ts: $ts}]')

      jq --argjson steps "$NEW_STEPS" '.steps = $steps' "$RECEIPT" > "${RECEIPT}.tmp" \
        && mv "${RECEIPT}.tmp" "$RECEIPT" \
        || rm -f "${RECEIPT}.tmp"
      ;;
  esac

  exit 0
fi

# ---------------------------------------------------------------------------
# === PreToolUse branch: predecessor enforcement ============================
# ---------------------------------------------------------------------------
if [ "$EVENT_NAME" = "PreToolUse" ]; then

  # Check for any failed steps — a fail requires revert + restart
  FAILED_STEP=$(echo "$STEPS_JSON" | jq -r '[.[] | select(.status == "fail")] | .[0].name // ""' 2>/dev/null || echo "")
  if [ -n "$FAILED_STEP" ]; then
    emit_deny "[BLOCKED] selector-development pipeline: ${FAILED_STEP} fail — must revert and restart.

Step '${FAILED_STEP}' recorded a failure in the journal for scope '${SCOPE}'.

The pipeline is broken at step '${FAILED_STEP}'. You must:
  1. Revert any changes made during this pipeline run
  2. Re-run the activation gate to start a fresh pipeline
  3. Restart from step 1 (before_snapshot)

Receipt: ${RECEIPT}"
    exit 0
  fi

  PREDECESSOR=$(step_predecessor "$STEP")

  # Step 1 (before_snapshot) has no predecessor — allow immediately
  if [ -z "$PREDECESSOR" ]; then
    exit 0
  fi

  # Check that the predecessor has a pass entry in the journal
  PRED_STATUS=$(echo "$STEPS_JSON" | jq -r \
    --arg pred "$PREDECESSOR" \
    '[.[] | select(.name == $pred)] | last | .status // ""' 2>/dev/null || echo "")

  if [ "$PRED_STATUS" != "pass" ]; then
    if [ -z "$PRED_STATUS" ]; then
      emit_deny "[BLOCKED] selector-development pipeline: missing predecessor: ${PREDECESSOR}.

Step '${STEP}' requires '${PREDECESSOR}' to have passed first.
Current journal for scope '${SCOPE}' has no '${PREDECESSOR}' entry.

Complete step '${PREDECESSOR}' before attempting '${STEP}'.
Receipt: ${RECEIPT}"
    else
      emit_deny "[BLOCKED] selector-development pipeline: ${PREDECESSOR} ${PRED_STATUS} — predecessor did not pass.

Step '${STEP}' requires '${PREDECESSOR}' to have passed, but it recorded '${PRED_STATUS}'.
You must revert and restart the pipeline from step 1 (before_snapshot).
Receipt: ${RECEIPT}"
    fi
    exit 0
  fi

  # Step 8 (commit) additional check: git_diff_hash must match staged diff
  if [ "$STEP" = "commit" ]; then
    RECEIPT_HASH=$(jq -r '.git_diff_hash // ""' "$RECEIPT" 2>/dev/null || echo "")

    if [ -n "${FAKE_STAGED_HASH:-}" ]; then
      STAGED_HASH="$FAKE_STAGED_HASH"
    else
      # Portable read-into-array (bash 3.2 lacks `mapfile`; macOS ships
      # bash 3.2 as /bin/bash by default, so consumers running the hook
      # on macOS would hit `command not found` here without this).
      FILES_ARR=()
      while IFS= read -r _line; do
        FILES_ARR+=("$_line")
      done < <(jq -r '.files[]? // empty' "$RECEIPT" 2>/dev/null)
      STAGED_HASH=$(git -C "$WS" diff --cached -- "${FILES_ARR[@]}" 2>/dev/null | sha256sum | awk '{print $1}' || echo "")
    fi

    if [ -z "$RECEIPT_HASH" ] || [ "$RECEIPT_HASH" != "$STAGED_HASH" ]; then
      emit_deny "[BLOCKED] selector-development pipeline: git_diff_hash mismatch.

The receipt for scope '${SCOPE}' records git_diff_hash='${RECEIPT_HASH}'.
The current staged diff hash is '${STAGED_HASH}'.

This means the staged changes don't match the patch that was validated through
the pipeline. Either:
  a) The staged changes have drifted from the patch_applied step, OR
  b) The receipt's git_diff_hash was set incorrectly

Re-run the pipeline from step 2 (patch_applied) to re-establish the diff hash.
Receipt: ${RECEIPT}"
      exit 0
    fi
  fi

  exit 0
fi

# Unknown event — silent allow
exit 0
