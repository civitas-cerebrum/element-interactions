# Skill Registry — Canonical Names

This file is the single source of truth for every skill in the `@civitas-cerebrum/element-interactions` suite. Agents MUST copy skill names from this registry verbatim — never reconstruct them from memory, never re-case them, never paraphrase.

**How to use:**
- Invoking a skill via the Skill tool → copy the value in **Invocation string** exactly.
- Writing prose that references a skill → copy the value in **Skill name** exactly, backticked.
- Cross-linking between `SKILL.md` files → use the **Skill name** as slug.

Names drift silently. A `coverage-expansion` written as `Coverage Expansion` in one doc and `coverage_expansion` in another doesn't fail any compiler — it just quietly confuses downstream agents. This registry is the fix.

---

## Registry

| Skill name | Invocation string | Owner orchestrator | Activation triggers |
|---|---|---|---|
| `element-interactions` | `element-interactions` | — (top-level orchestrator) | Any request to test, automate tests, or verify application behaviour ("test the app", "test this", "lets test", "write tests", "add tests", "run tests", "automate tests", "test automation", "e2e tests", "browser testing", "UI testing", "functional testing", "smoke test", "regression test", "QA", "quality assurance"); any mention of Playwright (including writing, fixing, adding, or running Playwright tests); framework keywords (`@civitas-cerebrum/element-interactions`, `@civitas-cerebrum/element-repository`, Steps API, `baseFixture`, `ContextStore`, `page-repository.json`). The three clauses are independent — any one of them triggers the skill; Playwright is a keyword trigger alongside the general test/automate intent, not a gate over it. |
| `onboarding` | `onboarding` | `element-interactions` (cascade-detector routes here when project is not onboarded) | "onboard this project", "set up element-interactions", "start from scratch", "automate this app from zero"; auto-invoked when the cascade detector finds a missing framework dep / missing scaffold / missing sentinel-bearing `journey-map.md`. |
| `journey-mapping` | `journey-mapping` | `onboarding` (Phase 4), `coverage-expansion` (prerequisite) | "map the app", "discover user journeys", "map user flows", "understand the app"; auto-invoked before coverage expansion or any large-scale test composing activity when a sentinel-bearing `journey-map.md` is missing or stale. |
| `coverage-expansion` | `coverage-expansion` | `onboarding` (Phase 5) | "increase coverage", "expand tests", "iterative coverage", "deep coverage pass"; auto-invoked by `onboarding` Phase 5. Runs `mode: depth` (default) or `mode: breadth`. |
| `test-composer` | `test-composer` | `coverage-expansion` (per journey, compositional passes 1–3) | "write all tests for the login journey", "compose tests for journey X", "think like a QA for this journey"; auto-invoked once per journey per compositional pass by `coverage-expansion`. |
| `bug-discovery` | `bug-discovery` | `onboarding` (Phase 6), `coverage-expansion` (adversarial passes 4–5, scoped per journey) | "find bugs", "break the app", "bug hunt", "quality audit", "edge case testing", "stress test the app", "exploratory testing", "find issues"; auto-invoked per journey inside `coverage-expansion` adversarial probe subagents, or cross-app by `onboarding` Phase 6. |
| `failure-diagnosis` | `failure-diagnosis` | Any skill that runs tests; explicit Phase-6 handoff target for `companion-mode` on a FAILED-verdict bundle | A test fails during any mode (authoring, maintenance, `test-composer`, `bug-discovery`, `companion-mode` Phase 6); "test is failing", "debug this", "why is this failing", "fix this test". |
| `test-repair` | `test-repair` | `element-interactions` (on user request); auto-escalated from `failure-diagnosis` / `test-composer` / `bug-discovery` when a single run produces many failures | "repair the suite", "fix my tests", "restore green", "heal the suite", "the tests are broken", "the suite rotted", "triage the failures", "my suite is flaky". |
| `agents-vs-agents` | `agents-vs-agents` | `element-interactions` (when app has AI features) | "test AI guardrails", "adversarial testing", "red team the AI", "test for bias", "prompt injection testing", "AI safety testing", "agents vs agents", "AI compliance testing", "guardrail verification". |
| `contract-testing` | `contract-testing` | `element-interactions` (when writing API-only tests that lock response shape) | "contract test", "API contract", "schema test", "consumer-driven contract", "provider verification", "pact test", "breaking change detection", "OpenAPI conformance", "lock API contract"; auto-invoked before writing any API-only test with `steps.apiGet/Post/Put/Delete/Patch` that asserts response shape or status. |
| `work-summary-deck` | `work-summary-deck` | `onboarding` (Phase 7) | "generate a report", "export a deck", "summarize work", "create a presentation", "QA report", "achievement report", "progress deck"; auto-invoked by `onboarding` Phase 7. On-demand only — never activates during test writing or debugging workflows. |
| `companion-mode` | `companion-mode` | `element-interactions` (on user request); never auto-invoked by another companion. May INVOKE `element-interactions` (Phase-6 graduation, `entry: "stage3"`), `onboarding` (Phase-6 full-onboarding handoff), or `failure-diagnosis` (Phase-6 deferred-automation handoff on FAILED verdict) — all on explicit user assent. | "companion mode", "companion entry mode", "QA companion", "verify this flow with evidence", "evidence package for X", "screenshot every step", "record this scenario", "video of this flow", "evidence-backed test", "daily QA task", "manual test assistance". Single-task functional verification with an evidence bundle (per-step screenshots + video + trace + HAR + console + summary), followed in Phase 6 by a proactive automation-graduation offer: on a passed verdict the skill runs the onboarding cascade detector and offers either Stage-3 graduation (fully onboarded) or "(a) just this task / (b) full onboarding" (Level A/B/C). The handoff requires an explicit `yes / (a) / (b)` from the user; vague replies get a clarifying re-prompt. Failed/inconclusive verdicts defer the automation question until `failure-diagnosis` or a retry resolves the verdict. |

---

**SKILL.md path convention.** Every skill's main doc lives at `skills/<skill-name>/SKILL.md` — slug the Invocation string to get the path. Reference docs live under `skills/<skill-name>/references/`. For example, `coverage-expansion` → `skills/coverage-expansion/SKILL.md`.

---

## Non-skill sentinel strings

Some markers in the workflow are not skill names but are case-sensitive and must also be copied verbatim:

| String | Purpose | Where it appears |
|---|---|---|
| `<!-- journey-mapping:generated -->` | Sentinel on line 1 of `tests/e2e/docs/journey-map.md`; confirms the map was produced by `journey-mapping` and is in the precise-embedding format. | First line of `tests/e2e/docs/journey-map.md`. |
| `<!-- coverage-expansion-adversarial:generated -->` | Sentinel on line 1 of `tests/e2e/docs/adversarial-findings.md`; confirms the ledger was produced by a Pass-4 subagent and conforms to the canonical schema. | First line of `tests/e2e/docs/adversarial-findings.md`. |
| `autonomousMode: true` | Invocation flag passed to `element-interactions` by companion skills to disable hard gates. | `args` when `onboarding` / `coverage-expansion` / `test-composer` invoke `element-interactions`. |
| `mode: depth` / `mode: breadth` | `coverage-expansion` run-mode selector. | `args` when invoking `coverage-expansion`. |
| `mode: live` / `mode: static` | `bug-discovery` probing-mode selector. | `args` when invoking `bug-discovery` (static mode is first-class, not a fallback — see that skill's §"Static mode — first-class adversarial probing"). |
| `mode: re-pass` | `test-composer` pass-2/3 discipline selector. | `args` when `coverage-expansion` dispatches `test-composer` for Pass 2 or Pass 3. |

---

## Companion reference docs

The registry is one of two canonical reference documents in this directory. Callers should treat both as authoritative:

| Reference | Scope |
|---|---|
| [`skill-registry.md`](skill-registry.md) (this file) | Canonical skill names, invocation strings, sentinel strings. |
| [`subagent-return-schema.md`](subagent-return-schema.md) | Canonical subagent finding-return format, return states (`covered-exhaustively`, `no-new-tests-by-rationalisation`), and adversarial-ledger schema. |
| [`cascade-detector.md`](cascade-detector.md) | Canonical onboarding-state probe (Levels A/B/C/None) and caller-specific responses. Cited by `onboarding`, `element-interactions` (routing), and `companion-mode` (Phase 6) — drift between callers is the bug it exists to prevent. |

Commit-message conventions for every pass in every skill are governed by `coverage-expansion`'s §"Commit-message conventions" (the per-pass table) and referenced from `test-composer` and `bug-discovery`. If a commit template drift is observed, fix the table in `coverage-expansion/SKILL.md` first; the caller skills cite it rather than re-defining it.

---

## Maintenance

- **Adding a skill:** add a row to the registry, scaffold `skills/<skill-name>/SKILL.md` with YAML frontmatter whose `description` follows the "Use when..." format (per the `superpowers:writing-skills` guidance — triggering conditions only, no workflow summary), and add a "Skill names: see registry" note near the top of the new SKILL.md pointing here.
- **Renaming a skill:** do NOT. Renaming breaks every caller that copied the old name. If rename is unavoidable, land it as a single PR that updates the registry plus every caller in one commit.
- **Deprecating a skill:** mark the row with a strikethrough and add a "Deprecated — use `<replacement>` instead" note in the skill's `SKILL.md`. Keep the registry row until the skill is removed.
- **Changing an invocation string:** same rule as renaming. The invocation string is part of the public contract — do not change it independent of the skill name.
- **Adding a sentinel string:** append to the "Non-skill sentinel strings" table with a purpose and location. Every sentinel in the codebase that callers rely on belongs in that table; drift in the other direction (sentinel used somewhere but not listed here) is a bug.
