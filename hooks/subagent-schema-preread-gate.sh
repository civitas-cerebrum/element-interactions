#!/bin/bash
# subagent-schema-preread-gate.sh — pre-dispatch schema-citation gate
#
# Hook    : PreToolUse:Agent
# Mode    : DENY (blocks the dispatch before the subagent starts)
# State   : none
# Env     : none
#
# Rule
# ----
# For schema-validated role prefixes, the brief MUST cite the schema file
# the subagent is expected to conform to. The role→schema mapping mirrors
# subagent-return-schema-guard.sh exactly:
#
#   composer-<slug>      → composer.schema.json
#   reviewer-<slug>      → reviewer-inloop.schema.json
#   probe-<slug>         → probe.schema.json
#   phase-validator-<N>  → phase-validator.schema.json
#
# Free-form prefixes (phase1-*, stage2-*, cleanup-*, process-validator-*,
# anything else) are silent-allow — they carry no structural contract.
#
# The brief satisfies the gate by containing the literal substring
#   "<role>.schema.json"
# anywhere in the prompt. The bare filename is the canonical match; the
# full path "schemas/subagent-returns/<role>.schema.json" also satisfies
# (it contains the bare filename as a suffix).
#
# Syntactic vs semantic — known tradeoff
# --------------------------------------
# Substring match is intentionally syntactic, not semantic. A brief that
# says "DO NOT use <role>.schema.json; use the other one" satisfies the
# gate; so does a stale "in the old contract we used <role>.schema.json"
# reference that no longer reflects what the subagent should follow. The
# gate is a "forgot to cite the schema at all" check, not a semantic
# enforcement — semantic checks would require NLP-grade negation
# detection, which is well outside scope for a public-package hook. If
# the brief is wrong, the PostToolUse return-schema-guard catches the
# resulting return-shape drift downstream.
#
# Why
# ---
# PostToolUse:Agent validation (subagent-return-schema-guard.sh) catches
# schema drift after the subagent has already produced a malformed return.
# That's reactive and only useful if the parent's retry logic knows to
# re-dispatch on WARN. In interactive Claude Code sessions (no orchestrator
# harness), the parent IS a human reading WARNs — easy to miss, expensive
# to retry by hand. This gate moves the discipline earlier: a brief that
# doesn't tell the subagent which schema to conform to is rejected before
# it spends any tokens, with a remediation pointer.
#
# Pairing
# -------
# This is the pre-dispatch half of a two-step contract:
#   PreToolUse:Agent  →  this gate (require schema citation in brief)
#   PostToolUse:Agent →  subagent-return-schema-guard.sh (validate return)
#
# The two together ensure: (a) the subagent is told what shape to produce,
# (b) the produced shape is validated. Each half is useful alone; both
# together close the schema-discipline loop without requiring an
# orchestrator harness.
#
# Canonical reference
# -------------------
# schemas/subagent-returns/*.schema.json
# skills/element-interactions/references/subagent-return-schema.md
#
# Failure → action
# ----------------
# Missing citation → DENY with remediation hint naming the schema path.

# Intentional: `set -uo pipefail` without `-e`. The hook is input-tolerant
# by design — malformed stdin, missing tool_input, or jq extraction
# failures should silent-allow the dispatch rather than crash the
# PreToolUse pipeline. Sibling hooks use `-euo pipefail` because they
# operate on commands where any extraction failure indicates a violation;
# this gate is checking *whether* a violation exists, so absence of
# extractable data is itself an "allow" signal.
set -uo pipefail

# Resolve jq (matches the resolution pattern used by sibling hooks).
JQ="$(dirname "${BASH_SOURCE[0]}")/bin/jq"
[ -x "$JQ" ] || JQ="$(command -v jq || true)"
if [ -z "$JQ" ]; then
  echo "[$(basename "${BASH_SOURCE[0]}")] FATAL: jq not found at \$HOOK_DIR/bin/jq nor on PATH." >&2
  exit 1
fi

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | "$JQ" -r '.tool_name // empty' 2>/dev/null || echo "")

# Only act on Agent dispatches. Anything else is silent allow.
[ "$TOOL_NAME" = "Agent" ] || exit 0

DESCRIPTION=$(echo "$INPUT" | "$JQ" -r '.tool_input.description // ""' 2>/dev/null || echo "")
PROMPT=$(echo "$INPUT" | "$JQ" -r '.tool_input.prompt // ""' 2>/dev/null || echo "")

# Map description prefix → schema role. MUST match subagent-return-schema-guard.sh
# exactly so the pre-dispatch gate and the post-dispatch validator agree on
# which dispatches are schema-validated.
SCHEMA_ROLE=""
case "$DESCRIPTION" in
  composer-*)         SCHEMA_ROLE="composer" ;;
  reviewer-*)         SCHEMA_ROLE="reviewer-inloop" ;;
  probe-*)            SCHEMA_ROLE="probe" ;;
  phase-validator-*)  SCHEMA_ROLE="phase-validator" ;;
  *)                  exit 0 ;;  # silent allow — free-form / no-schema role
esac

SCHEMA_FILENAME="${SCHEMA_ROLE}.schema.json"
SCHEMA_PATH="schemas/subagent-returns/${SCHEMA_FILENAME}"

# Citation check: the brief must contain the schema's bare filename
# somewhere. Substring match — covers both the bare filename and the full
# relative path. Case-sensitive (schema filenames are stable kebab-case).
if printf '%s' "$PROMPT" | grep -qF "$SCHEMA_FILENAME"; then
  exit 0
fi

# Build the DENY payload. The reason text explicitly states the schema
# path so a human reading the deny can paste it directly into the brief.
"$JQ" -n \
  --arg role "$SCHEMA_ROLE" \
  --arg desc "$DESCRIPTION" \
  --arg path "$SCHEMA_PATH" \
  --arg fname "$SCHEMA_FILENAME" \
  '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": (
        "[BLOCKED] Subagent dispatch \"" + $desc + "\" maps to schema role \"" + $role + "\" " +
        "but the brief does not reference its return-shape schema.\n" +
        "\n" +
        "A subagent has no way to know what JSON shape to return unless the brief points " +
        "at the schema. Add a reference to the brief: the bare filename " +
        "\"" + $fname + "\" or the relative path \"" + $path + "\" anywhere in the prompt.\n" +
        "\n" +
        "Pairs with the PostToolUse subagent-return-schema-guard, which validates the " +
        "actual return against this same schema."
      )
    }
  }'
exit 0
