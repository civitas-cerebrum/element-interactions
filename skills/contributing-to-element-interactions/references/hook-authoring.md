**Status:** authoritative reference for hook authoring. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** the three required patterns every new hook must follow (documentation header, helper functions, action-first error message), the hook checklist for PR authors, and the in-flight-registry pattern for distinguishing subagent vs. orchestrator tool calls.

---

## 🪝 Workflow: adding a harness hook

Hooks live in `hooks/<name>.sh`, are installed into `~/.claude/hooks/` by `scripts/postinstall.js`, and are registered in `~/.claude/settings.json` via the `HOOK_MANIFEST` array. They run at PreToolUse / PostToolUse / SubagentStop / Stop boundaries to enforce skill contracts mechanically — markdown rules can be rationalised away mid-run, hooks cannot.

This section is the **how**. The **when** is fixed by the Hard rule §"Methodology improvements ship as programmatic hooks" in [`./hard-rules.md`](./hard-rules.md): every SKILL.md rule edit comes paired with a hook unless the rule is genuinely unenforceable mechanically. Re-read that hard rule first if you're authoring a SKILL.md change — its decision table maps each rule shape to a concrete hook surface.

When to add a hook (vs declaring the rule `markdown-only`):

- The rule is **mechanically detectable** at a tool-use boundary (specific tool, file path, command pattern, response-shape signal). → Hook.
- Markdown enforcement has been observed to fail under context pressure. → Hook (the failure mode is no longer hypothetical).
- The cost of a violation is high (corrupt state, lost work, contract violation propagating downstream). → Hook.
- The rule is too contextual to detect mechanically (e.g. "use the right level of detail in this brief", "be honest about uncertainty"). → Stays markdown-only **and** the rule gets tagged in `coverage-expansion/references/anti-rationalizations.md` so the un-backed surface stays visible.

The default is "ship a hook." Choosing `markdown-only` is an explicit reviewer-visible exception, not the absence of a decision.

### Hook authoring — three required patterns

#### 1. Documentation header — uniform across all hooks

Every hook starts with a structured comment block. Readers should be able to scan the header alone and answer: what event does it fire on, what does it block / warn on, where's the canonical rule it implements, what's the exact failure → action mapping.

```bash
#!/bin/bash
# <name>.sh — <one-line summary of what this hook does>
#
# Hook    : <event>:<matcher>  (e.g. PreToolUse:Agent, PostToolUse:Bash, SubagentStop)
# Mode    : <DENY | WARN | RECORD | combinations>  (DENY blocks the tool call,
#           WARN emits systemMessage, RECORD updates state without output)
# State   : <none | <repo-or-home>/.claude/<file>.json>
# Env     : <none | CIVITAS_X_Y=<int>  (default <N>, semantics)>
#
# Rule
# ----
# <Single paragraph: what this hook enforces. Names the contract surface
# concretely. No ambiguity about which tool calls are caught.>
#
# Why
# ---
# <Single paragraph: motivation. Why mechanical enforcement here? What
# failure mode does it catch that markdown couldn't?>
#
# Canonical reference
# -------------------
# skills/<skill>/SKILL.md §"<section>"  (and/or)
# skills/<skill>/references/<file>.md §"<section>"
#
# (Optional sections: Conventions / Allowed list / Migration / etc. —
#  use them when the rule has a non-trivial vocabulary the reader needs
#  alongside the comment block.)
#
# Failure → action
# ----------------
# - <violation>                                       → DENY|WARN|RECORD
# - <other violation>                                 → DENY|WARN|RECORD
# - <legitimate-looking case that's exempt>          → silent allow
# - Anything else                                     → silent allow
```

This pattern is followed by every hook in `hooks/`. Adding a new hook with a different shape regresses scannability — match the existing template. Examples to read first: `hooks/coverage-expansion-dispatch-guard.sh` (DENY + WARN), `hooks/raw-playwright-api-warning.sh` (WARN-only), `hooks/suite-gate-ratchet.sh` (RECORD + DENY across two events).

#### 2. Helper functions — consistent shape

Hooks emit two output shapes: a deny JSON (PreToolUse-only, blocks the tool call) and a warn JSON (any event, emits a `systemMessage`). Both are wrapped in helpers defined inline at the top of the script:

```bash
emit_deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
}

emit_warn() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "suppressOutput": false
  }'
}
```

Define only what the hook actually uses (a deny-only hook doesn't need `emit_warn`). Don't inline a fresh `jq -n` in each call site — that's the older pattern PR #136 unified away.

#### 3. Action-first error message template — guide the agent back on track

Hook deny / warn messages are read by an agent under context pressure. The agent's next action is what matters most — not the diagnosis, not the references. Lead with the action.

Template:

```
[BLOCKED|WARN] <one-line headline of what was caught>

──────────────────────────────────────────────────────────────────
Do this instead — <option list or concrete template>:
──────────────────────────────────────────────────────────────────

  Option A — <case>
    <concrete next step: code template, command, or option>
  Option B — <other case, if applicable>
    <concrete next step>

──────────────────────────────────────────────────────────────────
What was wrong:
──────────────────────────────────────────────────────────────────
File: <path>
<observed values that triggered the rule>

<one-paragraph diagnosis: what the violation was, what failure mode it
represents, name the framings/symptoms verbatim where applicable>

──────────────────────────────────────────────────────────────────
If <common motivation for the violation> — read this:
──────────────────────────────────────────────────────────────────
<pointer to the upstream fix that resolves the underlying concern, NOT
the symptom-level workaround>

References:
  <canonical-doc-path-1>
  <canonical-doc-path-2>
```

Why this shape:
- **Action first.** The agent reading the message under context pressure should see the next step in the first ~10 lines. References at the end are for follow-up, not primary action.
- **Show, don't describe.** A concrete `Agent({...})` template, command, or option-list beats prose. Substitute extracted values where possible (slug from file path, count from JSON, etc.) so the agent can copy-paste.
- **Named symptoms.** When the violation has a recognisable internal-monologue framing ("honest stopping point", "I'll be transparent", "given session constraints"), name it verbatim in the diagnosis. Future agents recognise their own self-talk.
- **Underlying concern + upstream fix.** When a violation is driven by a real concern (e.g., parallel dispatch felt unsafe due to shared-DB races), acknowledge the concern and point at the upstream fix (per-test-user pattern in test-optimization §1.A) — NOT the symptom-level workaround. Otherwise the agent re-violates as soon as the same concern recurs.
- **References last.** Two to four canonical doc paths. Don't bury them in prose; list them.

Examples to read: `hooks/coverage-state-schema-guard.sh` (pre-emptive-stop deny — Option A / Option B layout) and `hooks/coverage-expansion-direct-compose-block.sh` (concrete Agent template substituted with the journey slug from the file path; gated on the `.in-flight-composers.json` registry written by `hooks/coverage-expansion-dispatch-guard.sh` to distinguish legitimate composer-subagent writes from orchestrator-direct composition without a harness `is_subagent` field).

### Hook checklist

When opening a PR that adds or modifies a hook:

- [ ] Documentation header follows the unified template (Hook / Mode / State / Env / Rule / Why / Canonical reference / Failure → action).
- [ ] `emit_deny` / `emit_warn` helpers used consistently — no inline `jq -n --arg` calls in the body.
- [ ] Error messages follow the action-first template (headline → Do this instead → What was wrong → upstream fix → References).
- [ ] Test cases added to `hooks/tests/cases/<NN>-<topic>.sh` covering: happy-path allow, each rule's deny/warn path, exempt cases, edge cases (empty inputs, special characters, alternate runner forms, etc.).
- [ ] `bash hooks/tests/run.sh` reports green on the new case file plus all existing cases.
- [ ] If the hook records state, the state-file path and shape are documented in the canonical reference.
- [ ] `scripts/postinstall.js` HOOK_MANIFEST updated with the new entry (file, event, matcher, timeout, optional async).
- [ ] If the hook gates a markdown rule, the kernel-resident invariants in the relevant SKILL.md mention the harness backstop ("Harness-enforced by `hooks/<name>.sh`").
- [ ] If the rule has a category in the anti-rationalization registry, the registry entry's `Hooks that catch this:` list is updated.

### Approximating `is_subagent` — the in-flight-registry pattern

The Claude Code harness payload doesn't include an `is_subagent` field on hook input — `Write` calls from a dispatched subagent and `Write` calls from the orchestrator are indistinguishable at hook-fire time.

When a hook needs to distinguish "was this tool call made by a legitimately-dispatched subagent doing its expected work" from "was this the orchestrator absorbing work that should have been delegated", use the **in-flight-registry pattern**:

1. **PreToolUse:Agent (the dispatch-guard)** writes a registration entry to a state file (e.g. `tests/e2e/docs/.in-flight-composers.json`) when the dispatch matches a known role-prefix that produces specific tool calls (e.g. `composer-j-<slug>:` produces a `Write tests/e2e/j-<slug>.spec.ts`).
2. **PostToolUse / PreToolUse on the produced tool call** reads the registry and gates the call: if the slug is in-flight (within a TTL window), the writer is the legitimate subagent — ALLOW. If not in-flight, it's the orchestrator absorbing — DENY with a redirect to dispatch the right subagent.
3. **TTL / cleanup as a failsafe**: the registry uses a rolling 30-min TTL — entries that aren't deregistered explicitly (see point 4) expire on the next dispatch-guard run, so stale registrations don't accumulate when a subagent crashes or is abandoned mid-flight.
4. **Explicit deregistration on terminal handover (the primary cleanup path).** Each subagent return is prefaced with a `handover:` envelope (`role`, `cycle`, `status`, `next-action` — schema in [`../../element-interactions/references/subagent-return-schema.md`](../../element-interactions/references/subagent-return-schema.md) §2.0). The PostToolUse return-schema guard parses the envelope, cycle-matches against the registry entry, and **deregisters the slot immediately on terminal status** instead of waiting for TTL. Cycle-mismatch (envelope claims a different cycle than the registered dispatch) refuses to deregister and asks the orchestrator to redispatch under the correct cycle. This shorter leash matters because the orchestrator's redispatch under the same slug can race with stale handovers from a slow / auto-compacted prior cycle — the cycle-match contract pins the deregistration to one specific dispatch.

The reference implementation is `hooks/coverage-expansion-dispatch-guard.sh` (registers `composer-j-*` / `composer-sj-*` / `probe-j-*` / `probe-sj-*` dispatches with a `cycle` field) paired with `hooks/coverage-expansion-direct-compose-block.sh` (gates `tests/e2e/{j,sj}-*.spec.ts` writes against the registry) and `hooks/subagent-return-schema-guard.sh` (parses the handover envelope, cycle-matches, deregisters terminal handovers). The pattern avoids false positives that would otherwise force a WARN — the gate runs as a hard DENY because the registry mechanically distinguishes legitimate from violation, and the leash is bounded by the explicit handover instead of the looser 30-min window.

When you ship a new harness pattern that needs the same distinction, register at the dispatch boundary, gate at the produced-tool-call boundary, deregister on the canonical handover envelope, and keep the TTL as a failsafe. Use a hidden state file under `tests/e2e/docs/.<topic>-<scope>.json` to keep the registry alongside other coverage-expansion state.

---

**See also:** [`./hard-rules.md`](./hard-rules.md) (the methodology-as-hooks rule that triggers this workflow), [`./contribution-handover.md`](./contribution-handover.md) (the canonical hook error-message format every new hook must follow), [`./design-rules.md`](./design-rules.md) (rules that may be candidates for a hook backstop).
