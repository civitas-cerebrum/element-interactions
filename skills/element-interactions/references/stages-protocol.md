# Stages Protocol — Element-Interactions Pipeline (Stages 1–4)

**Status:** authoritative spec for the four-stage element-interactions test-authoring pipeline. Cited from `element-interactions/SKILL.md`.
**Scope:** Stage 1 (Scenario Discovery), Stage 2 (Element Inspection), Stage 3 (Write Automation), Stage 4a (Test Optimization), Stage 4b (API Compliance Review). For each stage: process, hard gates, output format, and skip-to-Stage-3 (fix/edit) mode.

For the canonical browser-automation primitive used in Stage 2 / 3, see `playwright-cli-protocol.md`.
For the API surface Stage 3 writes against, see `api-reference.md`.

---

## Stage 1: Scenario Discovery

**Goal:** Understand the application and produce a clear, conventional scenario that the user approves.

### Fast Path

If the user provides a complete scenario or detailed acceptance criteria upfront, do NOT ask unnecessary discovery questions. Instead:

1. Reformat their scenario into the Given/When/Then structure below, favouring clear, discrete steps.
2. Ask only about anything that is genuinely unclear or ambiguous.
3. Present the formatted scenario for approval.

### Full Discovery Process

When the user provides a URL, a vague idea, or needs help figuring out what to test:

1. **Get the app URL or acceptance criteria.** The user may provide a URL, a description of the scenario, or both. If they provide a URL, use `playwright-cli` (see [`references/playwright-cli-protocol.md`](references/playwright-cli-protocol.md)) to navigate and explore.
2. **Discover the app.** Use `playwright-cli` to navigate to the app, take snapshots (`playwright-cli snapshot`), and understand what the application does. Explore the pages relevant to the scenario.
3. **Ask clarifying questions — one at a time.** Focus on understanding:
   - What is the user flow being tested?
   - What are the preconditions (logged in? specific data state?)
   - What constitutes success vs failure?
   - Are there edge cases to cover?
4. **Present the scenario** in conventional Given/When/Then format:

```
Scenario: [Descriptive name]
  Given [precondition]
  And [additional precondition if needed]
  When [action the user takes]
  And [additional action if needed]
  Then [expected outcome]
  And [additional verification if needed]
```

For complex flows, break into multiple scenarios.

### Hard Gate

> "Here's the scenario I've drafted. Does this accurately capture what you want to automate? Any changes before I move on to inspecting the page elements?"

**Wait for explicit approval.** If the user wants changes, revise and re-present. Do NOT proceed to Stage 2 until the scenario is approved.

---

## Stage 2: Element Inspection

**Goal:** Identify all elements needed for the approved scenario and propose page-repository entries.

### With `playwright-cli`

1. **Open a session and navigate** to each page involved in the scenario:
   - `npx playwright-cli -s=stage2-<scenario-slug> open --browser=chromium <URL>`
   - subsequent `goto` / `click` / `fill` calls reuse the same `-s=` session.
2. **Take snapshots** (`npx playwright-cli -s=stage2-<scenario-slug> snapshot`) and inspect the DOM to find reliable selectors for each element referenced in the scenario.
3. **Prefer selectors in this order:** `data-test` / `data-testid` attributes > `id` > stable CSS selectors > text > XPath.
4. **Build the page-repository entries.** For each element, determine the best selector strategy.
5. **Check existing `page-repository.json`** — if some elements already exist, note which ones are new vs already covered.
6. **Close the session** when done: `npx playwright-cli -s=stage2-<scenario-slug> close`.

### When `playwright-cli` cannot reach the live app

The CLI is always installed (hard dep), but the browser binary may be missing or the live app may be unreachable from this environment. In either case, fall back to user-supplied selectors:

> "I can't reach the live app to inspect selectors (browser binary missing — run `npx playwright-cli install-browser chromium` — or app URL unreachable from this environment). Could you provide the selectors for the elements in the scenario? I need entries for: [list elements from the approved scenario]. You can give me CSS selectors, IDs, text values, or full page-repository JSON entries."

Use whatever the user provides to build the page-repository entries. Do NOT guess or infer selectors.

### Present Proposed Selectors

Show the user the exact JSON entries you want to add:

```json
{
  "pages": [
    {
      "name": "LoginPage",
      "elements": [
        { "elementName": "usernameInput", "selector": { "css": "input[data-test='username']" } },
        { "elementName": "passwordInput", "selector": { "css": "input[data-test='password']" } },
        { "elementName": "submitButton", "selector": { "css": "button[type='submit']", "text": "Log In" } }
      ]
    }
  ]
}
```

### Hard Gate

> "These are the selectors I've identified for the scenario. Should I add them to `page-repository.json`? Let me know if any need adjusting."

**Wait for explicit approval.** Do NOT edit `page-repository.json` until the user says yes. If changes are requested, re-inspect and re-present.

---

## Stage 3: Write Automation

**Goal:** Write the Playwright test using the Steps API and approved page-repository entries.

### Writing Process

1. **Check project setup.** Read `tests/fixtures/base.ts` and `playwright.config.ts` — create or update only if missing or broken. Also verify that `.gitignore` includes `.claude/` and `CLAUDE.md` to prevent Claude Code configuration from being pushed to the repository — add them if missing.
2. **Add approved selectors** to `page-repository.json` (if not already done).
3. **Read `references/api-reference.md`** — load the full API reference before writing any test code. Do not write from memory.
4. **Write the test file** using the Steps API. Every interaction goes through `steps.*` methods — no raw `page.locator()` calls.
5. **Every test MUST end with a verification that proves the ACTION's EFFECT.** A test that performs actions (click, fill, drag, hover, check, upload, setSliderValue, etc.) and never asserts a resulting state is not a test — it's a smoke call that only catches thrown exceptions. Before declaring a test done, confirm the final meaningful statement is a `verify*`, a matcher-tree assertion (`.text.toBe`, `.visible.toBeTrue`, `.satisfy`, …), or a typed `expect(extractedValue)` that reflects what the action was supposed to change.

   **The verification must be causally tied to the action, not a tautology.** An assertion that would pass whether the action ran or not is not a verification — it's noise. Common anti-patterns to catch:
   - **Clicking a list item and asserting the list is still present.** `clickListedElement('rows', {text:'Alice'})` followed by `verifyPresence('rows')` proves nothing — the rows were present before the click too. Instead: verify the specific effect (navigation, selected-state change, status update, row-specific `data-selected` attribute, `stateSummary` text, etc.).
   - **Hovering an element and asserting it's still visible.** The element was visible to be hovered. Verify hover feedback (tooltip text, popover visibility, CSS color change, aria-expanded toggle).
   - **Filling an input and asserting the input exists.** Inputs don't disappear when filled. Verify `verifyInputValue(expected)` or a dependent element that reflects the filled value (error/success message, submit-button enabled state).
   - **Clicking a button and asserting the button is enabled/visible.** Verify the button's ACTION — a result element updating, a modal opening, a URL change, a disabled state after submission.
   - **Filter by text `{regex: 'A|B|C'}` then assert the parent collection is present.** Verify the FILTERED RESULT reflects the regex: extract text via `getListedElementData` and match the same pattern, or navigate to one of N alternatives and assert URL/state matches one of N expected outcomes.

   When picking a verification, ask: **"If the action had silently done nothing, would this assertion still pass?"** If yes, the assertion is tautological — find one that would fail under a no-op.

   Only in rare, explicitly documented cases where the action genuinely has no observable effect at any layer (e.g. a framework-level smoke exercise of an API's call shape) may you fall back to `verifyState('visible')` on the target element — and the reason must be stated in a one-line comment. Never leave a test trailing on an action.
6. **Run the test** with `npx playwright test <test-file>`.
7. **If the test fails:** invoke the `failure-diagnosis` protocol — collect evidence (screenshot, DOM, error context), group failures by root cause, classify (test issue vs app bug vs ambiguous), check edge cases, then fix test issues autonomously with stability validation (3-5 passing runs) or report app bugs with full evidence. If the fix requires new selectors, use `playwright-cli` to inspect the DOM, propose the new entry, and get approval before editing.
8. **If the test passes:** commit immediately.

### Skip-to-Stage-3 (Fix/Edit Mode)

When the user asks to fix or edit an existing test, skip Stages 1 and 2. Read `references/api-reference.md`, then read the existing test, understand the issue, and proceed directly to fixing and running. If fixing requires new selectors, use the mini-inspection flow described above — do NOT silently add selectors.

---

## Stage 4: Post-Stabilization Review (split into 4a + 4b)

**Stage 4a runs first, Stage 4b runs second.** Both run automatically after a test reaches passing state in Stage 3, before commit.

### Stage 4a: Test Optimization

**Goal:** enforce test-isolation, speed, and DRY best practices on freshly-written tests.

**Process:**

1. Read `references/test-optimization.md` — load the full protocol (8 sections).
2. Read every test file written or modified in this session, plus `tests/fixtures/base.ts` and `tests/e2e/docs/app-context.md`'s `## Test Infrastructure` section.
3. Run the 6 checks against each spec.
4. Apply auto-fixes (per-test patterns, §1–§5 with auto-fix). Write proactive helpers into `base.ts` (cross-test patterns) only when both gates apply (UI-covered + API discovered, see §4). Re-run the affected tests; confirm they still pass.
5. Emit the structured return per `references/test-optimization.md` §8.
6. Proceed to Stage 4b.

If Stage 4a's auto-fixes cause a previously-passing test to fail, follow Rule 7 (failure-diagnosis protocol) — inspect the screenshot, classify, fix or revert. Do not advance to Stage 4b until Stage 4a's tests are green again.

### Stage 4b: API Compliance Review

**Goal:** Review test code against the API Reference to ensure correct usage of the `@civitas-cerebrum/element-interactions` package.

**This stage triggers automatically every time Stage 4a returns clean.** Do NOT batch — review each test case immediately after Stage 4a clears, before moving on to the next scenario. Even if the tests pass, they may be using the API incorrectly (wrong argument order, deprecated methods, missing options, incorrect types). Catching issues early prevents the same mistake from propagating into subsequent test cases.

### Review Checklist

For each test file, verify:

1. **Method signatures** — every `steps.*` call matches the exact signature in the API Reference (correct argument count, correct argument order, correct types).
2. **Imports** — all types used (`DropdownSelectType`, `EmailFilterType`, `FillFormValue`, etc.) are imported from `@civitas-cerebrum/element-interactions` (or `@civitas-cerebrum/email-client` for email types). No invented imports.
3. **Page/element naming** — `pageName` uses PascalCase, `elementName` uses camelCase, and both match entries in `page-repository.json`.
4. **Listed element options** — `child` uses `{ pageName, elementName }` repo references where possible instead of inline selectors (per Rule 5).
5. **Dropdown select usage** — `DropdownSelectType.RANDOM`, `.VALUE`, or `.INDEX` with the correct companion field (`value` or `index`).
6. **Email API usage** — `steps.sendEmail` / `steps.receiveEmail` / `steps.receiveAllEmails` / `steps.cleanEmails` match the documented signatures. Filter types use `EmailFilterType` enum.
7. **No raw Playwright calls** — no `page.locator()`, `page.click()`, `page.fill()`, or other raw Playwright methods where a `steps.*` equivalent exists.
8. **Fixture usage** — the test destructures only fixtures provided by `baseFixture` (`steps`, `repo`, `interactions`, `contextStore`, `page`) plus any custom fixtures defined in the project's `base.ts`.
9. **Waiting methods** — correct state strings (`'visible'`, `'hidden'`, `'attached'`, `'detached'`) and correct usage of `waitForResponse` callback pattern.
10. **Verification methods** — correct option shapes (`{ exactly }`, `{ greaterThan }`, `{ lessThan }` for `verifyCount`; `verifyText()` with no args asserts not empty). The 4-arg form `verifyText(el, page, undefined, { notEmpty: true })` and the `TextVerifyOptions.notEmpty` flag are deprecated — use `verifyText(el, page)` (or `.on(el, page).verifyText()` fluent) instead.
11. **Every test ends with a verification — and that verification proves the action's effect, not a tautology.** Two sub-checks:
   - **Presence.** No test may finish on an action with no trailing assertion. If the last meaningful statement is `click`, `fill`, `drag`, `hover`, `check`, `upload`, `setSliderValue`, etc., flag it.
   - **Causal meaning.** Even with a trailing assertion, flag it if it would pass whether the action ran or not. Examples to catch: `verifyPresence('rows')` after `clickListedElement('rows', {text:'X'})` (the list was there before the click); `verifyState('visible')` on the hovered element (it was visible to be hovered); `verifyInputValue('anything')` where no causal link to the fill exists.

   When reviewing, ask: *"If the action had silently done nothing, would this assertion still pass?"* If yes, the verification is tautological — replace it with one that reflects the action's specific observable effect (navigation, text update, state-summary change, attribute flip, modal open, URL change, dependent-element reaction). Pure framework-smoke cases may fall back to a weak check but require a one-line comment justifying it. "The action didn't throw" is not a verification.

### Process

1. **Read `references/api-reference.md`** — load the full API reference. Do not review from memory.
2. **Read each test file** written or modified in this session.
3. **Cross-reference every API call** against the API Reference.
4. **Report findings** to the user — list any issues found with the specific line, what's wrong, and the correct usage.
5. **If issues are found:** investigate *why* the non-compliant code was written — was the API misunderstood? Was a method signature wrong in the scenario? Did a previous stage produce incorrect assumptions? Understanding the root cause prevents the same mistake from recurring in the next scenario. Then fix, re-run the tests, and confirm they still pass.
6. **If fixes cause a test failure:** follow Rule 6 — inspect the failure screenshot first before attempting any further fix. Do NOT guess from the error message alone.
7. **If no issues are found:** confirm compliance and proceed to commit.

### Output Format

Present the review as:

> **API Compliance Review**
>
> Reviewed: `tests/example.spec.ts`, `tests/login.spec.ts`
>
> - **`example.spec.ts:15`** — `steps.backOrForward('back')` should be `steps.backOrForward('BACKWARDS')` (uses uppercase enum-style strings)
> - **`login.spec.ts:8`** — missing import for `DropdownSelectType`
>
> [number] issue(s) found. Fixing now.

Or if clean:

> **API Compliance Review**
>
> Reviewed: `tests/example.spec.ts`
>
> All API calls match the documented signatures. No issues found.

---

## Onboarding Completion Gate

**Goal:** When the user signals they have no more individual scenarios to add (the "onboarding cycle" — Stages 1-4 — is complete), explicitly offer Stage 5 (Coverage Expansion) instead of silently ending the session.

### When this gate triggers

After any Stage 4 commit, when the user indicates they are done adding individual scenarios — for example by saying "that's all", "we're done", "no more for now", or by simply not requesting another scenario after a reasonable pause.

### What to do

1. **Summarize what was built in the onboarding cycle.** Briefly list the scenarios committed, the pages covered, and the page-repository entries added. Keep it to 3-5 lines.
2. **Run a readiness check** before offering Stage 5:
   - All committed tests pass on a clean re-run
   - `page-repository.json` is valid JSON and matches the tests
   - `tests/e2e/docs/app-context.md` exists and reflects the pages discovered so far
   - No open API compliance issues from Stage 4
   - If any check fails, fix it first — do NOT offer Stage 5 with a broken baseline
3. **Present the offer to the user verbatim:**

> **Onboarding cycle complete.**
>
> You now have an initial test suite that covers the scenarios you described. The next stage is **Coverage Expansion** — I would systematically probe the rest of the application, identify uncovered pages and flows, and build out the suite until every page and interactive element has test coverage. This typically takes multiple iteration cycles and runs more autonomously than the staged onboarding flow.
>
> Would you like me to proceed to **Stage 5: Coverage Expansion**? I can also:
> - **Pause here** — I'll stop and you can resume any time by asking
> - **Jump straight to Bug Discovery (Stage 6)** — only recommended if you already have comprehensive coverage from a previous session
> - **Generate a work summary deck** — produce a stakeholder-facing report of what was built so far

4. **Wait for explicit user choice.** Do NOT auto-proceed. Do NOT assume yes.
5. **On user approval of Stage 5:** invoke the `test-composer` skill via the Skill tool. Pass along the readiness check results and the list of pages already covered so test-composer's Step 1 (Inventory) starts from a known baseline.
6. **On user pause:** confirm the session is at a clean stopping point and end gracefully. Remind the user how to resume ("just say 'expand coverage' or 'add more tests' next time").

### Hard rule

Do NOT silently end the session after Stage 4. The onboarding cycle was an entry point — the user may not realize Stage 5 exists. Always surface it.

---

