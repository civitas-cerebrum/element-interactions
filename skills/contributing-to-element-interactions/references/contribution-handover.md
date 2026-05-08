**Status:** authoritative reference for the contribution handover surface and the canonical hook error message format. Cited from `contributing-to-element-interactions/SKILL.md`.

**Scope:** the `.contribution-handover.json` schema, why it exists, the field families, and the repo-standard hook error message layout that every `hooks/*.sh` deny / warn message must follow.

---

## 📝 Contribution Handover

Every PR against this repo must ship a populated `.contribution-handover.json` at the repo root. The handover captures one boolean per guardrail in this skill, plus a small set of free-form fields (PR title, summary, version delta).

The schema lives at `schemas/contribution-handover.schema.json`. A blank template lives at `.contribution-handover.template.json`. Copy the template, fill it in, and commit the result as `.contribution-handover.json` on your branch.

The companion gate is `hooks/contribution-handover-gate.sh` — a `PreToolUse:Bash` hook that intercepts `git push origin` and `gh pr create` and refuses to let either run while the handover is missing, malformed, or has unset booleans. Install it by adding a `PreToolUse:Bash` entry pointing at the script in your `~/.claude/settings.json` (see the script's header for an exact wiring snippet).

**Why a handover, not just a checklist:**
- Structured booleans are machine-checkable. The gate spot-verifies a subset of claims against the actual repo state (e.g. `readmeUpdated: true` is cross-checked against the README diff vs. `origin/main`).
- The handover travels with the branch, so reviewers see what the contributor signed off on, with reasons attached to any `false` field. A markdown checklist can be ticked without verification; a structured handover with mismatched claims fails CI.
- The shape evolves with the rules. When a new hard rule lands in this skill, it gets a new field in the schema. Old handovers fail validation and contributors can't push until they review the new rule. The schema is the rule index.

**Field families:**
- `preflight` — duplicate-search, branch sync, dependency version checks (Hard Rule "Before filing").
- `design` — argument order, async, no-raw-locator, action-presence-detect, lightweight Steps, naming, error format, logging, TypeScript discipline (Design Rules 1–18).
- `tests` — implementation, real-Vue-app, non-tautological assertions, passing (Hard Rules "no mocked", "must verify causally").
- `build` — TypeScript build clean, full suite green, knownFailures (free-form for legitimate skips).
- `coverage` — 100% API coverage gate (Hard Rule).
- `docs` — README, api-reference, skill files (Rule 19).
- `version` — single patch bump (Rule 15).

For any boolean set to `false` or `"n/a"`, the corresponding `*Reason` field must be populated. Vague reasons ("not applicable", "didn't need it") fail the gate; specific reasons ("change is internal-only on Verifications, no public Steps surface added — Rule 19 doesn't apply") pass.

**Worked example.** This PR ships its own `.contribution-handover.json` — read it for the populated shape.

### Hook error message format — repo standard

Every hook under `hooks/*.sh` that emits a `permissionDecision: "deny"` (or a `systemMessage` warn) must format the reason text using the layout below. The shape is identical across hooks so contributors recognize a hook block instantly and know where to look.

```
[BLOCKED] <one-line headline — what's wrong, in present tense>

──────────────────────────
Do this instead:
──────────────────────────
  Option A — <case>
    <concrete template / command / config diff>
  Option B — <other case>
    <concrete next step>

──────────────────────────
What was wrong:
──────────────────────────
File: <path or N/A>
<observed values — claim, actual, diff, etc.>
<one-paragraph why it matters — the rule, the prior incident, the cost of the failure>

──────────────────────────
If <common motivation> — read this:
──────────────────────────
<pointer to the upstream fix or the rule the contributor is bumping against>

References:
  <canonical docs — file paths or URLs>
```

`[WARN]` replaces `[BLOCKED]` for `systemMessage`-style soft warnings. Box-drawing characters are U+2500 — copy them from this skill, not from any other hook (existing hooks predate this standard and use ad-hoc formatting; they'll be normalized in a separate cleanup PR).

**Why these sections exist:**
- *Headline* — the contributor sees the failure in one line in their terminal. Don't bury the rule in paragraph two.
- *Do this instead* — concrete, copy-pasteable. At least two options when there are two valid resolutions (fix the work vs. update the claim). One option when there's only one path (e.g. file-corruption → repair the file).
- *What was wrong* — observed state, including the file path, the claim, and the actual value. This is the audit-log section; without it, contributors can't tell which check fired.
- *If <motivation>* — the empathy line. Anticipates the most common reason a contributor hit this gate ("you ticked the box without updating the file") and routes them to the right fix path. Skip this section if there's no common motivation worth naming.
- *References* — the canonical docs for the rule. Always include the SKILL.md section that defines the rule, plus the schema / config file the contributor will edit. Two to four lines.

The `contribution-handover-gate.sh` hook is the canonical implementation — copy its `build_message` helper when writing a new hook.

---

**See also:** [`./hard-rules.md`](./hard-rules.md) (the rules the handover machine-checks), [`./design-rules.md`](./design-rules.md) (the design invariants that map to handover fields), [`./hook-authoring.md`](./hook-authoring.md) (the message-format pattern in the broader hook authoring guide).
