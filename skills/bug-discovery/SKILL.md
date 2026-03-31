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
4. Systematically try each probing category on each element
5. Log every anomaly with a screenshot — even if unsure whether it's a bug

### Output

A raw findings list. Each entry: page, action taken, observed result, screenshot.

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

| Severity | Definition |
|---|---|
| **Critical** | Data loss, security vulnerability, complete flow broken |
| **High** | Core feature broken (workaround exists), incorrect data displayed |
| **Medium** | UI glitch, non-critical flow broken, inconsistent behavior |
| **Low** | Cosmetic, edge case unlikely in normal usage |

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

Example: double-click creates duplicates → test double-clicks and asserts `verifyCount('Page', 'records', { exactly: originalCount + 1 })`.

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
**New bugs:** X | **Regression candidates:** X | **Undocumented quirks:** X | **Known but untested:** X

## Summary by Severity
| Severity | Count | Categories |
|----------|-------|------------|
| Critical | X     | ...        |
| High     | X     | ...        |
| Medium   | X     | ...        |
| Low      | X     | ...        |

## Findings

### [BUG-001] Title
**Severity:** Critical | High | Medium | Low
**Category:** Boundary input | State transition | Race condition | ...
**Phase discovered:** 1a | 1b | 4
**Page:** PageName — `/route`
**Reproduction test:** `tests/bug-discovery/element-bugs.spec.ts:L42`
**Steps:**
1. Navigate to /page
2. Do X
3. Observe Y

**Expected:** Z
**Actual:** W
**Screenshot:** ![](screenshots/BUG-001.png)

---

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
