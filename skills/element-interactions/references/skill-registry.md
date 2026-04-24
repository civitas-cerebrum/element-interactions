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
| `element-interactions` | `element-interactions` | — (top-level orchestrator) | General testing intent ("test the app", "write tests", "e2e tests", "QA"); framework keywords (Playwright, `@civitas-cerebrum/element-interactions`, `@civitas-cerebrum/element-repository`, Steps API, `baseFixture`, `ContextStore`, `page-repository.json`); any request to write, fix, or add a Playwright test in this project. |
| `onboarding` | `onboarding` | `element-interactions` (cascade-detector routes here when project is not onboarded) | "onboard this project", "set up element-interactions", "start from scratch", "automate this app from zero"; auto-invoked when the cascade detector finds a missing framework dep / missing scaffold / missing sentinel-bearing `journey-map.md`. |
| `journey-mapping` | `journey-mapping` | `onboarding` (Phase 4), `coverage-expansion` (prerequisite) | "map the app", "discover user journeys", "map user flows", "understand the app"; auto-invoked before coverage expansion or any large-scale test composing activity when a sentinel-bearing `journey-map.md` is missing or stale. |
| `coverage-expansion` | `coverage-expansion` | `onboarding` (Phase 5) | "increase coverage", "expand tests", "iterative coverage", "deep coverage pass"; auto-invoked by `onboarding` Phase 5. Runs `mode: depth` (default) or `mode: breadth`. |
| `test-composer` | `test-composer` | `coverage-expansion` (per journey, compositional passes 1–3) | "write all tests for the login journey", "compose tests for journey X", "think like a QA for this journey"; auto-invoked once per journey per compositional pass by `coverage-expansion`. |
| `bug-discovery` | `bug-discovery` | `onboarding` (Phase 6), `coverage-expansion` (adversarial passes 4–5, scoped per journey) | "find bugs", "break the app", "bug hunt", "quality audit", "edge case testing", "stress test the app", "exploratory testing", "find issues"; auto-invoked per journey inside `coverage-expansion` adversarial probe subagents, or cross-app by `onboarding` Phase 6. |
| `failure-diagnosis` | `failure-diagnosis` | Any skill that runs tests | A test fails during any mode (authoring, maintenance, `test-composer`, `bug-discovery`); "test is failing", "debug this", "why is this failing", "fix this test". |
| `test-repair` | `test-repair` | `element-interactions` (on user request); auto-escalated from `failure-diagnosis` / `test-composer` / `bug-discovery` when a single run produces many failures | "repair the suite", "fix my tests", "restore green", "heal the suite", "the tests are broken", "the suite rotted", "triage the failures", "my suite is flaky". |
| `agents-vs-agents` | `agents-vs-agents` | `element-interactions` (when app has AI features) | "test AI guardrails", "adversarial testing", "red team the AI", "test for bias", "prompt injection testing", "AI safety testing", "agents vs agents", "AI compliance testing", "guardrail verification". |
| `contract-testing` | `contract-testing` | `element-interactions` (when writing API-only tests that lock response shape) | "contract test", "API contract", "schema test", "consumer-driven contract", "provider verification", "pact test", "breaking change detection", "OpenAPI conformance", "lock API contract"; auto-invoked before writing any API-only test with `steps.apiGet/Post/Put/Delete/Patch` that asserts response shape or status. |
| `work-summary-deck` | `work-summary-deck` | `onboarding` (Phase 7) | "generate a report", "export a deck", "summarize work", "create a presentation", "QA report", "achievement report", "progress deck"; auto-invoked by `onboarding` Phase 7. On-demand only — never activates during test writing or debugging workflows. |

---

## Non-skill sentinel strings

Some markers in the workflow are not skill names but are case-sensitive and must also be copied verbatim:

| String | Purpose | Where it appears |
|---|---|---|
| `<!-- journey-mapping:generated -->` | Sentinel on line 1 of `tests/e2e/docs/journey-map.md`; confirms the map was produced by `journey-mapping` and is in the precise-embedding format. | First line of `tests/e2e/docs/journey-map.md`. |
| `autonomousMode: true` | Invocation flag passed to `element-interactions` by companion skills to disable hard gates. | `args` when `onboarding` / `coverage-expansion` / `test-composer` invoke `element-interactions`. |
| `mode: depth` / `mode: breadth` | `coverage-expansion` run-mode selector. | `args` when invoking `coverage-expansion`. |

---

## Maintenance

- **Adding a skill:** add a row to the registry, then add a "Skill names: see registry" note near the top of the new skill's `SKILL.md` pointing here.
- **Renaming a skill:** do NOT. Renaming breaks every caller that copied the old name. If rename is unavoidable, land it as a single PR that updates the registry plus every caller in one commit.
- **Deprecating a skill:** mark the row with a strikethrough and add a "Deprecated — use `<replacement>` instead" note in the skill's `SKILL.md`. Keep the registry row until the skill is removed.
