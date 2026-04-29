---
name: test-composer
description: >
  Use this skill to compose the full test portfolio for **one** user journey —
  happy path, error states, edge cases, mobile, negative flows, and data-lifecycle
  variants — and to drive that journey to high test coverage. Triggers on requests
  like "write all tests for the login journey", "compose tests for journey X", or
  when invoked by coverage-expansion with a journey reference. Do NOT use for
  iterating across an entire application — that is coverage-expansion. Do NOT use
  for writing a single test scenario — this skill composes the journey's whole
  variant set.
---

# Test Composer — Stage 5 Atom: One Journey's Full Test Portfolio

> **Skill names: see `../element-interactions/references/skill-registry.md`.** Copy skill names from the registry verbatim. Never reconstruct a skill name from memory or recase it.

Stage 5 of the element-interactions workflow as the atomic unit of coverage. Given one mapped user journey, compose its complete test portfolio, stabilize, API-compliance-review, verify coverage is exhaustive for that journey, and return.

**Scope:** exactly one journey per invocation. The iterative loop over all journeys in an app lives in the `coverage-expansion` skill.

**Coverage ownership:** this skill is responsible for achieving exhaustive test coverage of its assigned journey. Every step, every branch, and every applicable state variation in the journey's map block must have a corresponding test before this skill returns. The orchestrator (typically `coverage-expansion`) trusts this contract and does not re-check per-journey coverage itself.

**Role under dual-stage.** When `coverage-expansion` runs in depth mode, this skill is **Stage A** of a per-journey-per-pass dual-stage pipeline. After this skill returns, a fresh staff-level-QA reviewer (Stage B, see `skills/coverage-expansion/references/reviewer-subagent-contract.md`) inspects the output and either greenlights or returns `improvements-needed` with `must-fix` findings. If improvements are needed, `coverage-expansion` re-dispatches this skill in cycle 2 with the findings appended to the brief — up to 7 A↔B cycles per journey per pass. Nothing about this skill's contract changes; you compose, stabilize, API-review, verify coverage, and return as before.

**Pre-empting reviewer must-fix items.** Skim §"Must-fix calibration" in `reviewer-subagent-contract.md` before composing — the reviewer will demand: (a) every `Test expectations:` item has a covering test, (b) tests use the Steps API correctly with page-repo selectors (no inline selectors), (c) file-level serial mode on tenant-mutating specs, (d) mobile variant on P0/P1 journeys, (e) test assertions match what the live DOM exposes. Meeting that bar in cycle 1 is the difference between a 1-cycle journey and a 4-cycle journey. The reviewer is not antagonistic — it is consistent, and you can know in advance what it will check.

---

## When to Use

Activate this skill when:
- A caller (user or `coverage-expansion` skill) asks to compose tests for one specific journey.
- The caller supplies a `journey=<id>` reference to an entry in a sentinel-bearing `journey-map.md`.

Do NOT use this for:
- Iterating across many journeys or expanding coverage across an entire app → `coverage-expansion`.
- A single ad-hoc scenario with no journey context → Stages 1–4 of the main workflow.

---

## Mandatory stages per invocation

Every invocation performs these stages in order, inside this subagent's own context. Do not return to the caller until all four complete cleanly.

1. **Compose** (Steps 2–3 below) — write the full variant set for the journey, adding selectors to `page-repository.json` as needed.
2. **Stabilize** (Step 4) — run, fix, re-run until 100% of new tests pass.
3. **API compliance review** (Step 6) — run the Stage 4 API review protocol on the freshly-written tests. Fix any non-compliance and re-stabilize if needed.
4. **Coverage verification** (Step 7) — check every step, branch, and applicable state variation from the journey's map block against the composed tests. Loop back to Compose for any missing coverage; only exit when coverage is exhaustive or each remaining gap has an explicit justification.

The multi-journey iterative cycle (inventory, cross-app gap analysis, multi-pass decide) is documented in `coverage-expansion`. This skill owns the per-journey work items only.

---

## Step 1: Load journey context

The caller (user or `coverage-expansion`) passes `journey=<id>` referencing an entry in `tests/e2e/docs/journey-map.md`. Before composing anything:

1. Verify `journey-map.md` exists and line 1 is `<!-- journey-mapping:generated -->`. If the sentinel is missing or the file is absent, stop and return an error pointing the caller at the `journey-mapping` skill.
2. Locate the `### j-<id>: <name>` block in the map. Load **only** that block plus any `sj-<slug>` blocks it references under `Sub-journey refs:`.
3. Note the journey's `Priority`, `Pages touched:`, and `Test expectations:`. These determine which variants to compose:
   - **P0** → happy-path + error-states + edge-cases + mobile + negative flows + any data-lifecycle variants in the expectations list.
   - **P1** → happy-path + error-states + edge-cases + mobile (if expectations list it).
   - **P2** → happy-path + one error-state + one data-verification check.
   - **P3** → smoke test (loads, key elements present).
4. List existing tests that already cover any step of this journey (from `npx playwright test --list`). These are the starting point — add variants, do not duplicate.

Do NOT read other journey blocks. Do NOT hold the whole map in context. Do NOT compute cross-app priority or gap analysis — that is the caller's job.

---

## Step 2: Discover

For each uncovered page or feature, use the Playwright MCP to inspect the live DOM.

**Discovery protocol:**
1. Navigate to the page via `browser_navigate`
2. Capture a snapshot via `browser_snapshot`
3. Note all interactive elements: buttons, inputs, links, tabs, dialogs, dropdowns
4. Note the page's text content (headings, labels) for selector creation
5. Click interactive elements to discover hidden UI (dropdowns, modals, menus)

**If MCP is unavailable:** Ask the user to provide screenshots or describe the page structure. Do not guess selectors.

**Record discoveries in a structured format AND save to app-context.md (see Rule 8):**
```
### PageName (/url/path)
- heading "Title" [h1]
- button "Action" → opens dialog with fields X, Y
- tab "Tab1" / "Tab2" / "Tab3"
- empty state: "No items found"
```

**CRITICAL:** Every page you visit and every component you discover MUST be saved to `tests/e2e/docs/app-context.md` per Rule 8. This is not optional — it is the primary way knowledge is preserved between sessions. If you discover a page and don't save it, the next session will re-discover it from scratch.

---

## Step 3: Implement

Write tests in batches of 5-15 per spec file, organized by area.

**Implementation rules:**
- Every test must use the Steps API from `./fixtures/base`
- Every element selector goes in `page-repository.json` — no inline selectors in test code
- Use `test.describe.configure({ timeout: 60_000 })` on every describe block
- **File-level serial mode is mandatory for tenant-mutating specs.** If the spec issues any POST / PUT / PATCH / DELETE to a mutable endpoint, the file **must** open with `test.describe.configure({ mode: 'serial' })` at the top of the file — before any `test.describe(...)` or `test(...)` block. Rationale: parallel Playwright workers sharing a credential against a single tenant produce random CSRF-token invalidations when concurrent mutating requests race against the session-bound token. Serial mode at the file level eliminates the race without capping global parallelism. Follow-up (not landed in this PR): add a lint rule or pre-commit check that rejects any spec with a mutating request that lacks the serial directive.

  **What counts as a mutable endpoint.** Any request whose server response represents a persistence change against tenant or user data — entity create / update / delete, state transitions (publish, archive, submit), role or permission mutations, file uploads that persist, password or MFA changes. Read-only methods (GET / HEAD / OPTIONS) do NOT trigger the rule, even when they tunnel through a POST for query-payload reasons, **provided** the handler is idempotent and server-side writes are limited to audit-log entries. When in doubt, apply the rule: the cost is one line of configuration per file; the cost of missing it is non-deterministic CI failures that surface later as "flaky auth".
- Tests that depend on data from other tests must handle both states (e.g., job status could be "draft" or "published")
- Tests that need specific data should use `test.skip()` when that data isn't found, not fail

**Prioritize by test type:**
1. **Functional tests** — verify things work when clicked/submitted (highest value)
2. **Data verification** — verify displayed values match expected data
3. **Navigation tests** — verify routing between pages
4. **Presence tests** — verify elements exist (lowest value, but fast to write)
5. **Negative tests** — verify error states and validation
6. **Responsive tests** — verify layout at different viewports
7. **Security tests** — XSS, injection, session handling

### Implementation order within this journey

Compose variants in this order so selectors build up cleanly and each variant inherits from the previous one:

1. **Happy path end-to-end.** Walk every step of the journey, introducing selectors for every page the journey touches. Every later variant inherits these selectors.
2. **Error-state variants.** Validation errors, network failures, session expiry, invalid input at each step.
3. **Edge-case variants.** Boundary inputs, unusual timing, empty or overflow data.
4. **Mobile variant** (P0/P1 only). The happy path at mobile viewport (375x812).
5. **Negative flows.** Permission-denied, unauthorized access, out-of-order step execution.
6. **Data-lifecycle variants** (where `Test expectations:` lists them): create → read → update → delete across sessions, draft persistence, bulk operations.

Each variant is its own `test(...)` inside one describe block for the journey — or split into a small cluster of describe blocks if the file grows beyond ~200 lines.

### Tenant cleanup hooks are non-negotiable for add-* journeys

Any journey whose happy path creates a persistent tenant entity (e.g., `j-*-add-caregiver`, `j-*-add-location`, `j-*-add-group`, `j-*-add-administrator`) **must** include an explicit `test.afterAll` teardown attempt in the spec. Accumulated test records across many passes pollute shared tenants and eventually obscure real behaviour.

Two cases, both mandatory:

1. **UI exposes a Delete affordance.** The spec's `test.afterAll` uses the Steps API to delete every entity the suite created. If the teardown step itself fails, the spec must surface that failure in the subagent's structured return rather than swallowing it.
2. **UI lacks a Delete affordance.** The spec calls the framework-level helper `cleanupViaApiBackdoor(<entity-type>, <id>)` — see contract below. If the helper is unavailable in the current project (e.g., per-tenant API credentials not configured), the subagent does **not** silently skip cleanup. It returns `cleanup: blocked` in its structured summary so the orchestrator can log the tenant-pollution risk explicitly instead of having it hide in the spec.

**Rationalizations to reject:**

| Excuse | Reality |
|--------|---------|
| "Cleanup hook errored but the main tests passed, move on" | A swallowed cleanup failure is silent tenant pollution. Surface it in the subagent return; the orchestrator decides. |
| "I don't have API credentials so I'll log in as the shared admin and call the UI delete" | That bypasses the reason the backdoor exists (UI has no Delete). If the UI has no Delete path, an admin-UI Delete doesn't exist either — you are inventing a workflow the app does not expose. Return `cleanup: blocked`. |
| "One record per test doesn't matter, the tenant is big" | Per pass × per journey × per variant × 5 compositional passes × 2 adversarial passes = hundreds of records per run. Pollution compounds across runs. |
| "I'll skip cleanup and add a TODO" | A TODO in a committed spec is a silent commitment to do the work later. It rarely gets done. Return `cleanup: blocked` — the orchestrator's log of blocked cleanups IS the follow-up ledger. |
| "The backdoor helper isn't implemented yet so I'll skip" | Correct response: write the `cleanupViaApiBackdoor` call as documented, let it fail at runtime, and return `cleanup: blocked` with the runtime error. Do NOT inline ad-hoc cleanup that circumvents the contract. |

#### `cleanupViaApiBackdoor` contract (documentation only — helper is a future follow-up)

> **⚠ Not-yet-implemented helper.** The helper below is contracted here but has no implementation yet. Specs written against this contract today will throw at runtime the first time `cleanupViaApiBackdoor(...)` is called — by design, because the spec's `test.afterAll` catches and returns `cleanup: blocked`. This is the expected behaviour until the framework-level follow-up lands. Do NOT substitute an inline ad-hoc cleanup to make the call succeed; that would mask the pollution risk the return value is meant to surface.

This PR documents the contract. The helper implementation itself is a separate framework-level follow-up; per-tenant API credentials live in env.

```
cleanupViaApiBackdoor(entityType: string, id: string): Promise<void>
```

- **Intent.** Delete a tenant entity created during a test when the UI exposes no Delete path. Invoked from `test.afterAll` after the suite's happy-path variant has finished.
- **Signature.** `entityType` is a framework-recognised entity slug (e.g., `'caregiver'`, `'location'`, `'group'`, `'administrator'`). `id` is the server-assigned identifier captured during the create flow.
- **Credentials.** Per-tenant API credentials live in env (`<TENANT>_API_TOKEN` or equivalent). The helper reads them; specs never handle raw credentials.
- **Failure mode.** On non-2xx response, the helper throws; the spec's `test.afterAll` catches and surfaces `cleanup: blocked` in the subagent return.
- **Status.** Contract only in this PR. The helper implementation, the env-credential convention, and any per-entity endpoint mapping are future follow-up work and out of scope here.

Cross-journey ordering (which journey to tackle first among many) is the caller's concern, not this skill's.

---

## Step 4: Stabilize

Run the new tests. Fix every failure. Run again. Repeat until 0 failures.

**If tests fail:** invoke the `failure-diagnosis` protocol to run the full diagnostic pipeline. It will collect evidence (screenshot, DOM, error context), group failures by root cause, classify (test issue vs app bug), and fix test issues autonomously with stability validation (3-5 passing runs). App bugs are reported with full evidence.

After fixing, re-run the full suite (not just the fixed test) to catch regressions.

---

## Step 5: Document

After stabilization, write every scenario in plain English. No code. No selectors. Write what a human tester would do and verify.

**Format:**
```markdown
### Test Name
**Area:** Dashboard
**Steps:**
1. Open the dashboard page
2. Look for the welcome message
3. Check that the company name appears
**Expected Result:** "Welkom terug" heading and "spriteCloud" are visible
```

Save to `docs/e2e-test-scenarios.md` (or a path the user specifies).

**Why this matters:** The plain English document serves as the single source of truth for what's tested. It's reviewable by non-technical stakeholders, it reveals gaps that code-level review misses, and it's the input for the next review step.

---

## Step 6: API compliance review

Run the Stage 4 API review protocol on the freshly-written tests for this journey. The full protocol is documented in `skills/element-interactions/SKILL.md` under the API compliance review stage. Scope the review to the tests composed in this invocation, not the whole suite.

If any non-compliance is found (wrong argument order, deprecated APIs, missing options, incorrect types, direct selector usage instead of the Steps API, inline selectors outside `page-repository.json`, fixture misuse), fix it and re-run Step 4 (Stabilize). Do not proceed to Step 7 until the tests are both green and API-compliant.

A lightweight self-review checklist for this journey only:

- Every test uses the Steps API from `./fixtures/base` (no raw `page.locator(...)` in test files).
- Every element selector lives in `page-repository.json` (no inline selectors in spec files).
- Verification methods use correct option shapes (`{ exactly, greaterThan, lessThan }` for `verifyCount`; bare `verifyText()` for "not empty").
- No use of deprecated methods or option shapes flagged in the API reference.
- Every test ends with a verification that proves the action's effect — not a tautology.
- `test.describe.configure({ timeout: 60_000 })` on every describe block composed for this journey.

---

## Step 7: Coverage verification

Before returning, verify the journey is exhaustively covered. This is the coverage-ownership contract:

1. Re-read the assigned journey block's `Steps:`, `Branches:`, and `State variations:` lists.
2. Build a coverage matrix: each listed item × the tests that exercise it.
3. If any step, branch, or applicable state variation has zero tests, loop back to Step 3 (Implement) to add missing coverage, then re-stabilize (Step 4) and re-review (Step 6).
4. Only exit the loop when every item is covered or each remaining gap has an explicit justification (e.g., "branch X requires a seeded database row that cannot be created in tests — documented as external-setup gap").

This skill owns the coverage outcome for its assigned journey. The orchestrator will not re-check.

---

## Step 8: Return

Emit a structured report to the caller. Do not paste test source, DOM snapshots, or MCP transcripts into the return — the caller will not read them.

### Canonical return schema

Every finding reported in the return block (coverage gaps, app-bug flags, new-discovery anomalies) MUST follow the canonical subagent finding-return schema documented in [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md):

```
- **<FINDING-ID>** [<severity>] — <one-line title>
  - scope: <what was probed>
  - expected: <what should happen>
  - observed: <what happened>
  - coverage: <existing test or none>
```

- `FINDING-ID` uses `<journey-slug>-<pass>-<nn>` (when invoked by `coverage-expansion` with a pass number) or `<journey-slug>-<nn>` (standalone).
- `severity` is one of `critical`, `high`, `medium`, `low`, `info`. No other values.
- Do not invent alternative ID schemes or severities.

### Return states — covered-exhaustively vs rationalisation

If this invocation produced **zero** new tests, pick one of the two states defined in the canonical schema's §2:

- **`status: covered-exhaustively`** — only valid when the subagent inspected the journey. Required evidence: a per-expectation mapping table (one row per item in the journey's `Test expectations:` list, each mapped to a spec file + test name). Every row must name concrete coverage — no `coverage: none` rows are tolerated under this status.
- **`status: no-new-tests-by-rationalisation`** — **not a valid return** from any compositional pass. If the only justification is "tests would be redundant" without an inspection, perform the inspection. Orchestrators will reject this return and re-dispatch with a stricter brief.

When invoked by `coverage-expansion` as a re-pass subagent (Pass 2 or 3), the mapping table MUST also include an explicit check against every re-pass trigger:

```
- trigger 1 (map delta since Pass 1): <none|<delta description>>
- trigger 2 (Pass-1 coverage gaps or deferred stabilization): <none|<gap>>
- trigger 3 (sibling-bug regression required here): <none|<sibling finding ID>>
- trigger 4 (unresolved review findings carried forward from prior pass): <none|<finding-ID list>>
```

The four-trigger format is non-negotiable — the orchestrator's rejection check (§"Re-pass mode for compositional passes 2–3" in `coverage-expansion/SKILL.md`) greps for the literals "trigger 1" through "trigger 4" and re-dispatches any return missing one of them.

### Return block format

```
journey: j-<id>
status: <in-progress|complete|covered-exhaustively>
tests added:
  - tests/<file>.spec.ts :: <describe> :: <test name>
  - ...
coverage:
  steps: <covered>/<total>
  branches: <covered>/<total>
  state-variations: <covered>/<total>
  justified gaps:
    - **<FINDING-ID>** [<severity>] — <title>
      - scope: <what was probed>
      - expected: <what should happen>
      - observed: <what happened>
      - coverage: none
new discoveries:
  branches:
    - <branch description, page, from-step>
  sub-journeys:
    - <potential sub-journey observed>
  pages:
    - <new url, why discovered>
  elements:
    - <new selector added to page-repository.json, page, role>
api compliance: clean | <specific issue resolved>
stabilization: <N runs> green
```

For `status: covered-exhaustively`, append the per-expectation mapping table documented in the canonical schema immediately after the return block. The orchestrator uses the table to audit that the "no new tests" claim is supported by inspection, not rationalised.

---

## AI-Assisted Test Patterns

When the application under test includes an AI chatbot or conversational interface, use a local or remote LLM to simulate user input.

**Architecture:**
```
App's AI asks question → Test reads question from DOM
                       → Test sends question to LLM (Ollama/Gemini)
                       → LLM returns structured answer
                       → Test types answer into chat input
                       → Repeat until conversation completes
```

**LLM utility pattern** (`utils/ollama.ts` or similar):
- Support multiple backends (Ollama for local, Gemini for CI) via env vars
- Use structured output (JSON schema in `format` field for Ollama, `responseSchema` for Gemini)
- Define a response interface with the answer text and completion signal
- Include conversation history in each prompt for coherent multi-turn responses
- Handle backend-specific quirks (e.g., some models put output in `thinking` field instead of `response`)
- Support bearer token auth for remote instances

**System prompt pattern:**
```
You are a [role] at [company] creating a [thing].
Answer concisely in 1-2 sentences.
Reply in the same language as the question.
Do not ask questions back.
```

**Exit conditions:**
- UI state changes (chat input disappears, preview appears, URL changes)
- Maximum turn count reached
- The LLM signals completion via structured output

---

## Parallelization

Cross-journey parallelization (dispatching subagents for multiple journeys at once) is `coverage-expansion`'s responsibility, not this skill's. A single `test-composer` invocation stays focused on one journey.

Within a journey, variants (happy path, error states, edge cases, mobile, negative flows, data lifecycle) are composed sequentially so each variant inherits from the selectors added by the previous one.

---

## Commit-message conventions

Every test this skill commits MUST use the compositional-pass template:

```
test(<j-slug>): <variant>
```

- `<j-slug>` is the journey ID (the `j-<slug>` from `journey-map.md`, without angle brackets).
- `<variant>` names the variant just committed: `happy-path`, `error-states`, `edge-cases`, `mobile`, `negative-flows`, `data-lifecycle`, or a specific sub-variant (e.g. `happy-path-returning-user`).
- One journey per commit, one variant per commit. Do not batch multiple variants into a single commit; do not batch multiple journeys into a single commit.

Examples:
- `test(j-book-demo): happy-path`
- `test(j-reset-password): error-states`
- `test(j-manager-add-caregiver): data-lifecycle`

Do NOT use `test(pass<N>): …`, `feat(e2e): …`, or `test(<j1>, <j2>): …` — see the **Commit-message conventions** table in `coverage-expansion/SKILL.md` for the full list of anti-patterns across all passes.

---

## Anti-Patterns

**Presence-only coverage:** Writing 100 tests that all just verify elements exist gives a false sense of security. Prioritize functional tests that click, type, submit, and verify outcomes.

**Hardcoded test data:** Tests that depend on specific database IDs or job titles break when the environment changes. Use selectors and patterns that work regardless of data state.

**Ignoring flakes:** A test that fails 1 in 10 runs is a bug, not a "flake to ignore." Fix the root cause (timing, state, selector specificity) before moving on.

**Over-mocking:** E2E tests should exercise the real application. Don't mock APIs, don't intercept network requests, don't stub components. If a feature needs external data, use `test.skip()` instead of faking it.

**Giant spec files:** Keep spec files under 200 lines. Split by area, not by "I kept adding tests to the same file."

---

## Invocation options

test-composer accepts a single required parameter:

| Parameter | Meaning |
|---|---|
| `journey=<j-slug>` | The ID of a journey in `tests/e2e/docs/journey-map.md`. This is the only journey composed during this invocation. |

Example: `args: "journey=j-book-demo"`.

### Backward compatibility

The legacy `passScope: priority=<Pn> depth=<tokens>` form is **deprecated**. If a caller still passes it, emit a one-line deprecation warning directing them at `coverage-expansion mode: breadth` (which is the proper home for priority/depth sweeps) and then compose against the highest-priority journey with uncovered steps matching the listed depths. Remove this fallback in a future major release.
