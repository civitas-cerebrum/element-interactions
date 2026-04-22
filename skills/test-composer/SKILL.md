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

Stage 5 of the element-interactions workflow as the atomic unit of coverage. Given one mapped user journey, compose its complete test portfolio, stabilize, API-compliance-review, verify coverage is exhaustive for that journey, and return.

**Scope:** exactly one journey per invocation. The iterative loop over all journeys in an app lives in the `coverage-expansion` skill.

**Coverage ownership:** this skill is responsible for achieving exhaustive test coverage of its assigned journey. Every step, every branch, and every applicable state variation in the journey's map block must have a corresponding test before this skill returns. The orchestrator (typically `coverage-expansion`) trusts this contract and does not re-check per-journey coverage itself.

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

Format:

```
journey: j-<id>
tests added:
  - tests/<file>.spec.ts :: <describe> :: <test name>
  - ...
coverage:
  steps: <covered>/<total>
  branches: <covered>/<total>
  state-variations: <covered>/<total>
  justified gaps:
    - <item> — <reason>
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
