---
name: bug-discovery
description: >
  Use when asked to "find bugs", "break the app", "bug hunt", "quality audit", "edge case testing",
  "stress test the app", "exploratory testing", "find issues", or "bug discovery". Triggers on any
  request for systematic adversarial testing of a web application after an existing test suite passes.
  Do NOT use for writing initial tests — that is Stages 1-4. Do NOT use for expanding coverage — that
  is the test-composer skill. Use only when the goal is to actively discover bugs.
---

# Bug Discovery — Adversarial Quality Audit

Systematic, automated bug discovery that runs after all existing test stages are complete. The agent probes the live application for bugs across edge cases, user flows, and cross-feature interactions, then cross-references findings against accumulated context and existing tests to produce a prioritized bug report with reproduction tests.

**Core principle — "First time effect":** Probe the live app BEFORE reading any context. Fresh eyes catch things that familiarity blinds you to. Context is used afterward to filter, classify, and derive additional findings.

---

## Prerequisites

Before starting, verify ALL of these:

- A passing test suite exists (Stages 1-4 complete, optionally Stage 5 / Test Composer)
- `page-repository.json` has selectors for the app's pages
- Playwright MCP is connected — if not, stop and tell the user: *"I need the Playwright MCP to probe the live app. Please add it to your Claude Code MCP settings and restart."*
- `app-context.md` exists (used in cross-reference phases; probing can proceed without it but phases 2 and 4 will be limited)

If the test suite is not passing, stop: *"Bug discovery requires a green test suite as baseline. Please fix failing tests first."*

---

## Phase Structure

```
Phase 1a: Element Probing        ─┐
Phase 1b: Flow Probing            ├─ Live app, no context
                                  ─┘
Phase 2:  Context Cross-Reference ─── filter known issues
Phase 3:  Test Cross-Reference    ─┐
Phase 4:  Context-Derived Analysis ├─ can run in parallel
                                  ─┘
Phase 5:  Classification          ─── merge & prioritize
Phase 6:  Reproduction            ─── write failing tests
Phase 7:  Report & Triage         ─── generate report
```

**Hard gates:**
- 1b requires 1a (needs page map)
- 2 requires 1a + 1b complete
- 3 and 4 require 2 complete (can run in parallel with each other)
- 5 requires 2, 3, and 4 complete
- 6 requires 5 complete
- 7 requires 6 complete

You MUST create a task for each phase and complete them in order.

---

## Phase 1a: Element Probing

Visit every page via MCP with **zero context** — do NOT read `app-context.md`, existing tests, or scenario docs. Pure adversarial exploration.

### Probing Categories

Apply to every interactive element found on every page:

| Category | Actions |
|---|---|
| **Boundary inputs** | Empty submit, special chars (`<script>`, `'"; DROP`), max-length strings, zero/negative numbers, unicode, whitespace-only |
| **State transitions** | Browser back after submit, refresh mid-flow, double-click buttons, re-submit completed forms, navigate away and return |
| **Race conditions** | Rapid repeated clicks, interact during loading spinners, submit while animations play, type during autocomplete debounce |
| **Permission/access** | Direct URL access without auth, manipulate URL params, expired session behavior, access other users' resources |
| **Data edge cases** | Empty lists, single item lists, pagination last page, long text overflow, missing/broken images, zero-result search |
| **Cross-feature** | Edit in one tab and check another, apply filters then navigate back, change language mid-flow, resize viewport during interaction |

### Process per Page

1. Navigate via MCP
2. Take a snapshot
3. Identify all interactive elements
4. **Visibility gate:** For each element, check `getBoundingClientRect()` — if width and height are both 0, or if any ancestor has `display: none`, `visibility: hidden`, or zero height, mark the element as **DOM-only**. Continue probing both visible and DOM-only elements, but tag all findings accordingly.
5. Systematically try each probing category on each element
6. **Screenshot verification:** For every anomaly found, take a screenshot that shows the issue as a user would see it. If the anomaly is not visible in the screenshot (element is hidden, zero-sized, or off-screen), classify it as **DOM-only** — not a user-facing bug.
7. Log every anomaly with: page, action taken, observed result, screenshot, and **visibility classification** (user-visible or DOM-only)

### Output

A raw findings list. Each entry: page, action taken, observed result, screenshot, visibility classification (user-visible / DOM-only).

---

## Phase 1b: Flow Probing

Construct and test **adversarial user journeys** — complete flows designed to break assumptions. Uses the page map built during Phase 1a.

### Flow Categories

| Category | Example Flows |
|---|---|
| **Interrupted flows** | Start checkout, close tab, reopen — is cart still there? Start wizard, back at step 3 — does state corrupt? |
| **Out-of-order operations** | Skip wizard steps via URL, delete item being edited elsewhere, submit form for just-deleted record |
| **Concurrent state** | Same form in two tabs — edit both, submit both. Cart in tab A, checkout in tab B — what happens in A? |
| **Data lifecycle** | Create, edit, delete — can you undo? Create, navigate away, return — is draft saved? Bulk delete, check pagination |
| **Role/session transitions** | Log out mid-flow, log back in — where do you land? Switch roles — do stale permissions persist? |
| **Upstream dependency failures** | List references deleted item? Filter value no longer exists? Linked resource returns 404? |
| **Cumulative state** | Repeat action 20 times — memory leak, stacked toasts, DOM growth? Apply/clear filters repeatedly — clean reset? |

### Process

1. Read the app's route structure to identify all multi-step flows
2. For each flow, design 2-3 adversarial variations from the categories above
3. Execute each variation via MCP
4. Log anomalies with full flow description, screenshots at each step, and expected vs actual outcome

---

## Phase 2: Context Cross-Reference

Shift from discovery to analysis. NOW read the accumulated context.

### Steps

1. Read `app-context.md` — check "Known issues" for each page
2. Filter out findings already documented as known quirks or accepted behavior
3. Flag findings that **contradict** documented behavior — these escalate, they do NOT get filtered out
4. Note any discrepancies between documented state and observed state for Phase 4

### Output

Filtered findings with known issues removed. Discrepancies flagged for Phase 4.

---

## Phase 3: Test Cross-Reference

Scan existing test coverage against remaining findings.

### Steps

1. Read all spec files in the test directory
2. Read scenario docs (`docs/e2e-test-scenarios.md`) if they exist
3. Filter out findings already covered by a passing test
4. Flag findings that contradict what an existing test asserts in a different context — these are **regression candidates**

### Output

Classified findings with already-tested items removed, regression candidates flagged.

---

## Phase 4: Context-Derived Analysis

Use `app-context.md` as a **source** of new findings — not just a filter. Cross-reference what context documents against what probing actually observed.

### Discrepancy Patterns

| Pattern | Example |
|---|---|
| **Documented state never appeared** | app-context says page has empty state, probing never triggered it — is empty state broken? |
| **Documented flow doesn't match reality** | app-context says "Links to Settings", but link goes to 404 or different page |
| **Known workaround masks deeper issue** | Tests use `waitForState` for slow load — is slow load itself a performance bug? |
| **Inconsistent behavior across pages** | Similar components behave differently (date formats, validation rules, error messages) |
| **Missing error handling** | app-context documents actions but no error states — probing confirms errors unhandled |

### Output

New findings derived from discrepancies, classified the same as probing findings.

---

## Phase 5: Classification & Prioritization

Merge all findings from Phases 2, 3, and 4 into a single prioritized list.

### Classifications

| Classification | Meaning | Action |
|---|---|---|
| **New bug** | Not documented, not tested, clearly wrong | Phase 6 (reproduce) |
| **Regression candidate** | Contradicts existing test in different context | Phase 6 (reproduce with context note) |
| **Undocumented quirk** | Weird but possibly intentional | Flag in report, ask user |
| **Known but untested** | In app-context but no test guards it | Phase 6 (write guard test) |

### Severity

Severity is based on **real-world user impact** — what a user experiences, not what the DOM contains. Every finding MUST be screenshot-verified before severity assignment. If you cannot see the issue in a screenshot, it is not a user-facing bug.

| Severity | Definition | Decision criteria | Examples |
|---|---|---|---|
| **Critical** | Security vulnerabilities, privacy violations, leaked sensitive data, broken authentication, missing compliance certifications, or complete failure of a primary user journey. Issues that pose legal, financial, or reputational risk to the business, or that make the application fundamentally unusable for its intended purpose. | Ask: "Could this cause a data breach, legal liability, or prevent all users from achieving the app's core purpose?" If yes → Critical. | XSS/injection vulnerabilities, exposed API keys or credentials in client-side code, authentication bypass, SSL certificate errors, GDPR/CCPA violations (e.g., tracking without consent), broken payment flow, complete app crash on load |
| **High** | Functional bugs that block or seriously obstruct a user journey — the user cannot complete an intended action without a workaround, or the workaround is non-obvious. The affected feature is part of the app's core value proposition. | Ask: "Is a user stuck? Can they not complete what they came to do?" If yes → High. If a simple workaround exists and the feature is non-core → Medium. | Form submission silently fails with no error, primary navigation leads to error/blank page, core feature throws unhandled exception, search returns no results when results exist, login/signup flow broken |
| **Medium** | Broken links, 404 errors, expired or stale content, incorrect data display — issues that degrade the user experience and erode trust but do not prevent users from using the app. The user notices something is wrong but can continue their journey. | Ask: "Does the user notice something is wrong, but can still use the app?" If yes → Medium. Exception: if the broken content is critical to the app's purpose (e.g., pricing data on an e-commerce site), escalate to High. | Dead outbound links, expired job listings, 404 on linked pages, stale references to renamed products, broken images on content pages, incorrect phone numbers or addresses, outdated partner logos |
| **Low** | Issues that do not obstruct the usage of the app whatsoever. The information or functionality is still accessible, just slightly inconvenient. A typical user would not notice or care. | Ask: "Would a normal user even notice this? Does it prevent them from doing anything?" If no to both → Low. | Phone number displayed correctly but link uses `href="#"` instead of `tel:`, external links open in same tab (missing `target="_blank"`), minor naming inconsistencies between nav and footer, tooltip text slightly truncated |
| **No impact (DOM-only)** | Issues found only by inspecting the HTML source or DOM that are invisible to users. Hidden elements, zero-height containers, unused CMS template content, HTML metadata issues. These are code hygiene items, not bugs. | Ask: "Can I see this in a screenshot?" If no → No impact. Do NOT escalate DOM-only findings regardless of what the underlying issue appears to be. | Lorem ipsum in `display: none` sections, broken anchor links in collapsed/hidden navs, unused FAQ sections with zero dimensions, missing H1 in hidden blocks, generic `<title>` tags, placeholder content in zero-height containers |

### Visibility Rule

**A finding that is not visible to users in a screenshot cannot receive a severity above "No impact (DOM-only)".** This rule is absolute. DOM-only findings are reported in a separate section as code hygiene items — they are not bugs.

**Verification process — mandatory for every finding:**
1. Navigate to the page where the finding occurs
2. Take a screenshot of the viewport area where the element lives
3. **If the issue is visible in the screenshot** — the user would see this. Assign severity based on user impact using the decision criteria above.
4. **If the issue is NOT visible** (element hidden, zero-sized, off-screen, `display: none`, collapsed container) — classify as "No impact (DOM-only)" regardless of what DOM inspection reveals. A hidden broken link is not a broken link — it's unused HTML.
5. **When in doubt**, scroll to the element, take a full-page screenshot, and check. Do not rely on DOM inspection alone to determine visibility — CSS transforms, overflow hidden, z-index stacking, and scroll-reveal animations can all make an element invisible despite being "in the DOM".

### Also in this phase

Update `app-context.md` with any newly discovered pages, state variations, or quirks found during probing.

---

## Phase 6: Reproduction

Write a failing test for each confirmed bug.

### File Structure

```
tests/
  bug-discovery/
    element-bugs.spec.ts         # from Phase 1a findings
    flow-bugs.spec.ts            # from Phase 1b findings
    context-derived-bugs.spec.ts # from Phase 4 findings
```

### Test Conventions

- Uses Steps API from `./fixtures/base` — same as all other tests
- All selectors in `page-repository.json` — no inline selectors
- Test names describe the bug: `test('@bug-discovery double-click submit creates duplicate record')`
- Tests grouped in `test.describe('Bug Discovery — [category]')` blocks
- Each test has a JSDoc comment:

```ts
/**
 * @bug BUG-001
 * @severity Critical
 * @phase 1b
 * @steps
 * 1. Navigate to /checkout
 * 2. Click submit twice rapidly
 * 3. Check order count
 */
test('@bug-discovery double-click submit creates duplicate', async ({ steps }) => {
  // ...
});
```

- All tests tagged `@bug-discovery` for filtering: `npx playwright test --grep @bug-discovery`

### Assertion Strategy

Assert the **correct** behavior so the test **fails** against the current buggy state. When the bug is fixed, the test turns green without modification.

**If a test fails for unexpected reasons** (not the intended bug reproduction — e.g., wrong selector, navigation error, test code issue): invoke the `failure-diagnosis` protocol to diagnose and fix. The failure-diagnosis pipeline distinguishes between test issues (fix autonomously) and app bugs (report). Only use this for unintended failures — the expected failure from the bug reproduction is not a test issue.

Example: double-click creates duplicates → test double-clicks and asserts `verifyCount('Page', 'records', { exactly: originalCount + 1 })`.

### Visibility Pre-Check in Reproduction Tests

Every reproduction test for a user-visible bug MUST include a visibility assertion before testing the bug behavior. This confirms the element is actually visible to users and prevents false flags from hidden DOM content.

```ts
// User-visible bug — verify element is visible first, then assert correct behavior
test('@bug-discovery expired job listing links to live posting', async ({ steps }) => {
  await steps.navigateTo('/careers');
  await steps.verifyPresence('viewListingButton', 'CareersPage'); // visibility pre-check
  // ... then assert the bug
});
```

For DOM-only findings, tag tests with `@dom-only` instead of `@bug-discovery`, and include `@visibility: dom-only` in the JSDoc:

```ts
/**
 * @bug BUG-004
 * @severity No impact (DOM-only)
 * @visibility dom-only
 */
test('@dom-only missing H1 on blog page', async ({ steps, page }) => {
  // DOM inspection — no visibility pre-check needed
});
```

Run user-visible bugs: `npx playwright test --grep @bug-discovery`
Run DOM-only issues: `npx playwright test --grep @dom-only`

---

## Phase 7: Report & Triage

### Report Location

`docs/e2e/bug-discovery-report.md`

### Report Template

```markdown
# Bug Discovery Report
**Date:** YYYY-MM-DD
**App:** [baseURL from playwright config]
**Total findings:** X
**User-visible bugs:** X | **DOM-only issues:** X | **Undocumented quirks:** X

## Summary by Severity
| Severity | Count | Categories |
|----------|-------|------------|
| **User-Visible** | | |
| Critical | X     | ...        |
| High     | X     | ...        |
| Medium   | X     | ...        |
| Low      | X     | ...        |
| **DOM-Only** | | |
| No impact | X    | ...        |

## User-Visible Bugs (Confirmed)

### [BUG-001] Title
**Severity:** Critical | High | Medium | Low
**Visibility:** User-visible (confirmed via screenshot)
**Category:** Boundary input | State transition | Race condition | ...
**Phase discovered:** 1a | 1b | 4
**Page:** PageName — `/route`
**Reproduction test:** `tests/bug-discovery/element-bugs.spec.ts:L42`
**Screenshot:** ![](screenshots/BUG-001.png)
**Steps:**
1. Navigate to /page
2. Do X
3. Observe Y

**Expected:** Z
**Actual:** W

---

## DOM-Only Issues (Lowest Priority)
Issues found by inspecting the HTML/DOM that are not visible to users.
These are cleanup items, not user-facing bugs.

## Undocumented Quirks (User Decision Required)
Items that could not be definitively classified as bugs.
Each entry asks: "Is this intentional?"

## Coverage Notes
- Pages probed: X/Y
- Flows tested: X
- Categories covered: [list]
- Areas not probed (and why): [list]
```

### Post-Report

After generating the report, ask:

> "Bug discovery report written to `docs/e2e/bug-discovery-report.md`. Would you also like me to create GitHub issues for the confirmed bugs?"

If the user agrees, create one issue per confirmed bug with the same structure as the report entry, labeled `bug` and `bug-discovery`.
