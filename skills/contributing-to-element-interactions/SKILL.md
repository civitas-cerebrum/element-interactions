---
name: contributing-to-element-interactions
description: >
  Use this skill when contributing to the @civitas-cerebrum/element-interactions
  package or its skill suite — and, just as importantly, when a consumer hits
  the package's edges from the outside. Two trigger families:

  (A) **API gap.** A user, test, or skill needs a method, option, matcher, or
  assertion shape that does not exist on Steps / ElementAction / ExpectMatchers
  / the matcher tree, and the temptation is to drop down to raw Playwright
  `Locator.*` calls. Triggers: "extend the Steps API", "add a new method to
  ElementAction", "no equivalent in the framework", "the package doesn't have",
  "missing API in element-interactions", "missing matcher", "drop down to raw
  Playwright", "fall back to page.locator", "the framework doesn't expose X",
  "how do I add to this framework".

  (B) **Structural / framework / protocol gap.** A skill, workflow, or
  documented invariant declares a rule that the package's current architecture
  cannot satisfy without changing the package itself, switching its underlying
  tooling, or relaxing the rule. The MCP→playwright-cli migration (#121, #122)
  is the canonical example: the parallel-isolation rule was structurally
  unsatisfiable on top of the Playwright MCP plugin and required a tooling
  change at the package layer, not a skill-level workaround. Triggers: "the
  framework can't satisfy", "framework limitation", "this rule cannot be
  satisfied", "the package's architecture prevents", "structural gap",
  "protocol gap", "isolation can't be guaranteed", "this prereq isn't
  satisfiable", "the underlying tooling doesn't support", "should I file an
  issue against the package", "is this a skill issue or a package issue", "do
  we need to change the package to fix this", any case where a skill is about
  to silently weaken or skip a documented invariant because the package can't
  back it.

  Also use when contributing to the skill suite under `skills/` (adding,
  modifying, or registering a skill, debugging the package's own tests, or
  opening a PR against this repo). This skill explains the separation of
  concerns between element-repository and element-interactions, the test
  coverage rules, the design principles that must be respected when scaling
  the package, the exact workflow for adding new APIs cleanly, and how to
  distinguish an API gap from a structural gap.

  (C) **Issue-queue / roadmap work on this repo.** Any request to triage,
  plan, or implement open issues filed against `civitas-cerebrum/element-
  interactions`. Triggers: "check the github issues", "look at the open
  issues", "implementation roadmap", "implement issue #N", "ship issue #N",
  "work on the open issues", "let's get started on the issues", "address
  the issue queue", "pick up an issue", "what's left to ship", "go through
  the issues", "what should we work on next" (when CWD is the package's
  own repo).

  Triggers also on: "contribute to element-interactions", any request to
  modify files under the package's `src/`, `skills/`, or `hooks/`, "open an
  issue on element-interactions", "open a PR on element-interactions", any
  of the structural / protocol-gap phrases above, or any framing that
  implies work *on the package itself* rather than *with it*.

  (D) **Generic improvement / catalogue / hook / reference contributions.**
  Use this skill whenever a consumer wants to *help improve the package* —
  not just when they hit a gap. Triggers for generic improvement intent:
  "improve element-interactions", "contribute to the package", "help
  improve the framework", "the package could be better at X", "I have an
  idea for the package", "this rule could be improved", "I noticed a doc
  inconsistency", "let's enrich the docs", "polish the package", "make
  the framework better at X". Triggers for catalogue contributions: "add
  a niche-edge-cases entry", "I hit a failure shape that's not
  catalogued", "document this failure pattern", "this trap should be in
  the catalogue". Triggers for hook contributions: "add a harness hook",
  "we need a hook for X", "the rule is markdown-only — let's enforce it",
  "back this rule with a hook", "the hook should warn when X". Triggers
  for reference improvements to this skill itself: "the contributing
  skill is missing X", "this part of the skill could be clearer", "let's
  add a reference for Y in contributing-to-element-interactions", "the
  contributing skill needs an entry for X".
---

# Contributing to @civitas-cerebrum/element-interactions

This package is a Playwright-on-top facade. Every API decision should preserve the framework's two non-negotiable promises:

1. **No raw selectors in user test files.** Tests refer to elements by name (`'submitButton'`, `'CheckoutPage'`), never by CSS/XPath/locator strings.
2. **No raw Playwright `Locator.*` calls in user test files.** Every interaction, verification, and extraction goes through `Steps`, `ElementAction`, or the matcher tree — never `await page.locator('x').click()` directly.

Everything else in this skill is in service of those two promises. The detail lives in `references/` so this parent stays scannable.

---

## Reference index

Each reference below is the **canonical home** for its topic. This index is a routing layer — read the relevant file before authoring code, hooks, or PR descriptions, and do not paraphrase from this parent alone.

### [`references/architecture.md`](references/architecture.md)
The two-package split (element-repository ↔ element-interactions), per-layer responsibilities, the end-to-end anatomy of a single `await steps.expect(...).text.toBe(...)` call, why the split exists, and module / file conventions for new code. Read first if you don't already know which layer your change belongs in.

### [`references/decision-tree.md`](references/decision-tree.md)
Five-step decision tree for placing a new API in the right layer — raw element capability vs. matcher vs. composite Steps method vs. strategy vs. fixture concern, plus the "stop and discuss" escape when nothing fits.

### [`references/hard-rules.md`](references/hard-rules.md)
The named hard rules a contribution must satisfy: methodology-as-hooks, before-filing duplicate-prevention, no raw locator in src/, action-presence-detect, web-only cast, 100% API coverage, in-package smoke tests must verify causally (no Level-1 missing assertion or Level-2 tautology), no mocked unit tests.

### [`references/design-rules.md`](references/design-rules.md)
Numbered Design Rules 1-19 — argument order, async-everywhere, chain-style assertions vs. flat actions, dispatch-only facades over `Interactions`/`Verifications`/`Extractions`, one-shot `.not`, one-timeout-uniform-mutation, snapshot-based predicates, naming conventions, public API stability, action presence-detect, no raw locator in src/, web-only cast, error-message format, logging categories, TypeScript discipline, npm-latest patch bump, real Vue test app, 100% API coverage, lightweight Steps (one method per resource via discriminated options), and Rule 19 doc-update mandatory (now backed by `hooks/contribution-doc-update-required.sh`).

### [`references/contribution-handover.md`](references/contribution-handover.md)
The `.contribution-handover.json` schema and why structured booleans (not a markdown checklist) are required, the boolean field families (preflight / design / tests / build / coverage / docs / version), the gate that machine-checks them, and the repo-standard hook error-message format every new `hooks/*.sh` must follow.

### [`references/api-workflow.md`](references/api-workflow.md)
Command-by-command shipping recipes for the three workflows: A — adding to element-repository (the underlying capability), B — adding to element-interactions (the user-facing API), C — cross-package change (paired PRs).

### [`references/hook-authoring.md`](references/hook-authoring.md)
Three required hook patterns — uniform documentation header, `emit_deny`/`emit_warn` helper shape, action-first error message template — plus the hook PR checklist and the in-flight-registry pattern for approximating `is_subagent` when the harness payload doesn't expose it.

### [`references/niche-edge-cases-contribution.md`](references/niche-edge-cases-contribution.md)
When a failure shape qualifies for `failure-diagnosis/references/niche-edge-cases.md` (misclassifies in practice, non-obvious disambiguating probe, reproducible across consumers), the five-field entry shape, three shipping pathways (mid-PR / standalone / via-subagent-return), cross-link discipline, and what does NOT belong (project-specific shapes, war stories, already-covered shapes).

### [`references/api-gap-flow.md`](references/api-gap-flow.md)
Consumer flow when a missing method tempts a drop down to raw Playwright — read the api-reference end-to-end, run duplicate-prevention checks, file an issue, use the documented `interactions.interact.*` / `interactions.verify.*` / `interactions.extract.*` escape hatch if you must ship now.

### [`references/structural-gap-flow.md`](references/structural-gap-flow.md)
Consumer flow when a documented invariant is structurally unsatisfiable on the current package architecture (the MCP→playwright-cli migration shape) — write down the invariant precisely, do not relax it in the consuming skill, file against the package, fix at the package layer, then delete the workaround from the consuming skill.

### [`references/pr-checklist.md`](references/pr-checklist.md)
Final preflight every PR must pass — duplicate-prevention, branch sync, dependency version, tests + 100% coverage, no raw Playwright leak, version bump, README + api-reference + handover + (if a SKILL.md rule changed) a paired hook. Element-repository side has its own sub-list.

---

## Quick decision tree

Pick the closest framing and read the referenced file. The references are the canonical home; do not try to satisfy a rule from this parent alone.

- "I want to add a new method / matcher / option to the package" → [`references/decision-tree.md`](references/decision-tree.md), then [`references/api-workflow.md`](references/api-workflow.md).
- "Where do my changes have to live in the codebase?" → [`references/architecture.md`](references/architecture.md).
- "What invariants does my change have to respect?" → [`references/design-rules.md`](references/design-rules.md) (numbered Rules 1-19) and [`references/hard-rules.md`](references/hard-rules.md) (the named hard rules).
- "I hit a missing API as a consumer of the package" → [`references/api-gap-flow.md`](references/api-gap-flow.md).
- "A skill / workflow rule cannot be satisfied without changing the package" → [`references/structural-gap-flow.md`](references/structural-gap-flow.md).
- "I'm adding or editing a SKILL.md rule" → first [`references/hard-rules.md`](references/hard-rules.md) §"Methodology improvements ship as programmatic hooks", then [`references/hook-authoring.md`](references/hook-authoring.md).
- "I'm adding a hook to back an existing markdown rule" → [`references/hook-authoring.md`](references/hook-authoring.md); copy the message format from [`references/contribution-handover.md`](references/contribution-handover.md) §"Hook error message format".
- "I hit a failure shape that traps the diagnoser" → [`references/niche-edge-cases-contribution.md`](references/niche-edge-cases-contribution.md).
- "I want to improve the package generally / polish docs / open a follow-up" → start at [`references/pr-checklist.md`](references/pr-checklist.md) and walk back into whichever reference governs the area you're touching.
- "I'm about to push / open a PR" → [`references/pr-checklist.md`](references/pr-checklist.md) and [`references/contribution-handover.md`](references/contribution-handover.md).

---

If a contribution undermines either promise, it doesn't ship.
