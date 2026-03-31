---
name: test-composer
description: >
  Use this skill when asked to "increase coverage", "add more tests", "cover the whole app",
  "think like a QA", "expand the test suite", "add more scenarios", or any request for iterative,
  comprehensive E2E test development. Triggers on requests to systematically expand an existing
  Playwright test suite across an entire application. Do NOT use for writing a single test scenario.
---

# Test Composer — Stage 5: Iterative Test Suite Expansion

The fifth stage of the element-interactions workflow. After writing initial automation (Stages 1-4), this stage systematically expands coverage through iterative cycles of scenario generation, implementation, stabilization, review, and gap analysis.

This stage is designed for building comprehensive E2E test suites that cover an entire web application, not just individual scenarios.

---

## When to Use

Activate this stage when:
- The user asks to "increase coverage", "add more tests", "cover the whole app", "think like a QA"
- An initial test suite exists (from Stages 1-4) and needs expansion
- The user wants autonomous test development across an application

Do NOT use this for writing a single test scenario — that's Stages 1-4.

---

## The Cycle

Each iteration follows this exact sequence. Do not skip steps.

```
┌─────────────────────────────────────────────┐
│  1. INVENTORY — what exists, what's missing │
│  2. DISCOVER — inspect live pages via MCP   │
│  3. IMPLEMENT — write tests in batches      │
│  4. STABILIZE — run, fix, run until green   │
│  5. DOCUMENT — write plain English scenarios│
│  6. REVIEW — senior QA gap analysis         │
│  7. DECIDE — satisfied? commit : next cycle │
└─────────────────────────────────────────────┘
```

Repeat until coverage reaches the target (typically 80%+) or the remaining gaps require external setup (test data, third-party services) that cannot be created within tests.

---

## Step 1: Inventory

List every test that currently exists. Count by area. Calculate coverage against the app's known pages and features.

**How to inventory:**
```bash
npx playwright test --list
```

Map tests against the app's route structure:
```bash
find app -name "page.tsx" | sort
```

Produce a coverage table:

| Area | Tests | Pages Covered | Missing |
|------|-------|---------------|---------|
| Auth | 5 | /login, /verify | /account-blocked |
| Dashboard | 7 | /dashboard | — |
| ... | ... | ... | ... |

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

### Implementation Approach: User Journey Layers (Required)

Build tests in order of user flow depth, so each layer adds selectors that the next layer inherits. Do NOT implement areas in isolation — follow the natural user journey through the application.

**How it works:**

1. **Identify the user journey flows** through the application (e.g., Browse → Product Detail → Cart → Checkout, or Login → Dashboard → Settings).
2. **Order flows by depth** — start with the shallowest entry point (e.g., homepage/landing) and progress deeper into the app.
3. **Implement one flow at a time, in order.** Each flow:
   - Discovers and adds selectors for the pages it touches
   - Writes tests for those pages
   - Stabilizes before moving to the next flow
4. **Later flows inherit earlier selectors.** By the time you reach a deeper page, all selectors from pages visited in earlier flows already exist in `page-repository.json`.

**Example — E-commerce app:**

| Order | Flow | Pages Touched | New Selectors Added |
|-------|------|---------------|---------------------|
| 1 | Browse Products | HomePage, CategoryPage, ProductListPage | All homepage + listing selectors |
| 2 | Product Detail | ProductListPage → ProductDetailPage | PDP selectors (listing selectors already exist) |
| 3 | Add to Cart | ProductDetailPage → CartPage | Cart selectors (PDP selectors already exist) |
| 4 | Checkout | CartPage → CheckoutPage → ConfirmationPage | Checkout selectors (cart selectors already exist) |
| 5 | User Account | LoginPage → AccountPage → OrderHistoryPage | Account selectors |

**Why this works:** Each step builds on the previous `page-repository.json` entries. By the time you reach Cart, you already have PDP selectors. By Checkout, you already have Cart selectors. This means minimal re-inspection of pages, fewer selector conflicts, and a natural progression that mirrors how real users interact with the app.

**Parallelization within layers:** Flows that share no pages can be implemented in parallel (e.g., "User Account" and "Admin Panel" if they don't overlap). But flows that share pages MUST be implemented in order so selectors are built up correctly.

**Batch strategy for subagents:** When dispatching subagents, assign each subagent a complete flow (not a random area). Include the current `page-repository.json` so the subagent knows which selectors already exist. Do NOT dispatch multiple subagents that would need to add selectors for the same page.

---

## Step 4: Stabilize

Run the new tests. Fix every failure. Run again. Repeat until 0 failures.

**Debugging protocol:**
1. Run the tests: `npx playwright test <spec-name> --project=chromium --no-deps`
2. For each failure, check the screenshot FIRST (read the PNG from test-results/)
3. Common failure patterns:
   - **Strict mode violation** — selector matches multiple elements → add `.first()` or scope to `main`/`aside`
   - **Element not visible** — page still loading → add `waitForState` or increase timeout
   - **Test ordering dependency** — data changed by previous test → use `.or()` for multiple states
   - **Stale selector** — DOM changed since discovery → re-inspect via MCP
4. After fixing, re-run the full suite (not just the fixed test) to catch regressions

**Flake detection:** If a test fails in the full suite but passes alone, it's a test isolation issue. Common causes:
- Shared browser state (cookies, localStorage)
- Data mutated by earlier tests
- Timing issues under parallel load

Fix by: adding explicit waits, using `test.skip()` for data-dependent tests, increasing timeouts for slow-loading pages.

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

## Step 6: Review as Senior QA

Read the plain English scenarios document. Think like a senior QA engineer. Ask:

**Coverage questions:**
- Is every page in the app visited by at least one test?
- Is every interactive element (button, input, link, tab, dropdown) exercised?
- Is every form validated with both valid and invalid input?
- Is every navigation path tested (sidebar, breadcrumbs, CTAs, back button)?
- Are error states tested (404, empty states, expired sessions)?

**Depth questions:**
- Do tests verify actual data values, or just element presence?
- Are form submissions tested end-to-end (fill → submit → verify result)?
- Are CRUD operations tested (create → read → update → delete)?
- Is the happy path tested as a complete user journey (not just isolated pages)?
- Are edge cases covered (special characters, empty inputs, boundary values)?

**Quality questions:**
- Are tests independent (no ordering dependencies)?
- Are tests resilient to data state changes?
- Do tests use proper waits (not arbitrary timeouts)?
- Are selectors stable (not dependent on implementation details)?

**Produce a gap table:**

| Priority | Gap | Area | Effort |
|----------|-----|------|--------|
| P0 | No logout test | Auth | Low |
| P1 | Form validation untested | API Keys | Medium |
| P2 | Mobile viewport missing | Job Detail | Low |

---

## Step 7: Decide

At the end of each cycle, assess:

**Commit if:**
- All tests pass (0 failures)
- Coverage increased meaningfully since last cycle
- The gap table has no P0 items remaining

**Continue if:**
- P0 or P1 gaps remain that can be implemented without external setup
- Coverage is below the target threshold
- The user explicitly asked for more depth

**Stop if:**
- Remaining gaps require external setup (test data, third-party APIs, specific user roles)
- Coverage has plateaued (each cycle adds <5 new tests)
- The user is satisfied

**Commit message format:**
```
feat(e2e): [cycle description] — [key additions]

- [bullet point per area changed]
- [total test count], all passing
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

When implementing multiple independent areas, dispatch subagent per area. Each subagent needs:

1. Full page snapshot from MCP discovery
2. Current page-repository.json content
3. Existing test patterns to follow
4. Clear file path for the new spec

Do NOT dispatch multiple subagents that modify the same file (especially page-repository.json). Instead, have one subagent do all page-repository updates, or batch them sequentially.

---

## Anti-Patterns

**Presence-only coverage:** Writing 100 tests that all just verify elements exist gives a false sense of security. Prioritize functional tests that click, type, submit, and verify outcomes.

**Hardcoded test data:** Tests that depend on specific database IDs or job titles break when the environment changes. Use selectors and patterns that work regardless of data state.

**Ignoring flakes:** A test that fails 1 in 10 runs is a bug, not a "flake to ignore." Fix the root cause (timing, state, selector specificity) before moving on.

**Over-mocking:** E2E tests should exercise the real application. Don't mock APIs, don't intercept network requests, don't stub components. If a feature needs external data, use `test.skip()` instead of faking it.

**Giant spec files:** Keep spec files under 200 lines. Split by area, not by "I kept adding tests to the same file."
