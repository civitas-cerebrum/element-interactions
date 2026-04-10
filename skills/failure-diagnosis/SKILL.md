---
name: failure-diagnosis
description: >
  Diagnose failing Playwright tests through structured evidence-based triage.
  Triggers when a test fails during any mode (authoring, maintenance, test-composer, bug-discovery),
  when the user says "test is failing", "debug this", "why is this failing", "fix this test",
  or when another companion skill encounters a test failure.
  Guides the agent through screenshot analysis, DOM inspection, root cause hypothesis,
  then fixes test issues autonomously or reports app bugs with evidence.
trigger: always
---

# Singularity — Failure Diagnosis

A structured diagnostic protocol for failing Playwright tests. Every failure gets the full pipeline — no "retry and hope."

## When This Activates

- A test run produces failures (from any mode)
- User says "test is failing", "debug this", "why is this failing", "fix this test"
- Another companion skill encounters a failure during its workflow

---

## Diagnostic Pipeline

### Stage 1 — Collect Evidence

Do NOT guess from the error message alone. Collect visual and structural evidence first.

1. **Read the error message and stack trace.** Note the test file, line number, step name, and error type.
2. **Open the Playwright HTML report.** Run `npx playwright show-report` and inspect the failure screenshot via Playwright MCP or browser MCP. The base fixture captures a `failure-screenshot` on every failure automatically.
3. **Describe what the screenshot shows.** State explicitly: page state, visible elements, error messages, unexpected UI, loading indicators, overlays. Write this down — it informs every subsequent decision.
4. **If the screenshot is insufficient:** use Playwright MCP to navigate to the failing page URL and take a fresh snapshot. Inspect the DOM for the element the test was trying to interact with.
5. **Check the error context file.** Failed tests produce an `error-context.md` in `test-results/` — read it for additional diagnostic information.

### Stage 2 — Group Failures

Before diagnosing individually, look at the big picture:

1. **Scan all failures** in the test run output.
2. **Group by likely root cause:**
   - Same missing page/element in the repository → single repo issue
   - Same page failing to load → navigation or app issue
   - Same timeout pattern → timing or environment issue
   - Same API misuse pattern → test code issue
3. **Prioritize:** Fix the root cause that unblocks the most tests first. A single missing page-repository entry might cause 10 failures — fix it once, not 10 times.

### Stage 3 — Classify

Determine whether each failure group is a **test issue**, **app bug**, or **ambiguous**. You must meet the burden of proof before classifying.

#### Test Issue — fix autonomously

**All** of the following must be true:
- Screenshot shows the page loaded correctly and the expected UI is present
- Error is traceable to test code: wrong selector, wrong param order, missing wait, stale repo entry, API misuse, incorrect assertion
- DOM inspection confirms the element exists but the test targeted it incorrectly

Common test issues:
- Wrong `(elementName, pageName)` argument order
- Missing or stale `page-repository.json` entry
- Missing `waitForState` or `waitForNetworkIdle` before interaction
- Hardcoded assertion value that doesn't match dynamic content
- Test isolation problem — stale cookies/localStorage from prior test
- Navigation race — test interacts before page finishes loading

#### App Bug — hard stop, report to user

**At least one** of the following must be true:
- Screenshot shows unexpected UI state (blank page, error message, broken layout, wrong content displayed)
- DOM inspection confirms the element genuinely doesn't exist or the app produces incorrect output
- The test logic is correct per the scenario — the app simply doesn't do what it should

Additionally: the bug must be **reproducible** (not a one-off network blip). Navigate to the page manually via Playwright MCP to confirm.

**When you identify an app bug: STOP.** Do NOT modify the test to accommodate the bug. Report it (see Stage 6).

#### Ambiguous — escalate to user

- Evidence supports both interpretations
- The app changed intentionally but tests weren't updated (is this a test issue or a spec change?)
- Present all evidence and ask the user to classify before acting

### Stage 4 — Edge Case Checklist

Before finalizing your classification, run through this checklist:

| Edge Case | What to Check | Likely Classification |
|---|---|---|
| **Element obscured/overlapped** | Screenshot shows overlays, modals, z-index issues blocking the target element | App bug if the overlay shouldn't be there; test issue if the test forgot to dismiss a dialog or close a modal |
| **Timing-dependent content** | Screenshot shows loading state, spinner, or skeleton instead of the expected content | Test issue — add explicit `waitForState`, `waitForNetworkIdle`, or `waitForResponse` before the interaction |
| **Data-dependent failure** | Assertion expects a specific count or text value that doesn't match what's displayed | Check whether the assertion is hardcoded to fragile values; may be either a test issue (use dynamic assertion) or app bug (data is wrong) |
| **Environment differences** | Failure only in CI, passes locally; or vice versa | Note the environment context; check viewport size, network conditions, base URL differences. Often a test issue — add resilience |
| **Partial page load** | Page loaded but a specific section didn't render (lazy-loaded component, conditional feature flag) | Inspect DOM for presence of the container; app bug if the component is missing from the DOM, test issue if it needs a wait |
| **Stale browser state** | Cookies, localStorage, or cached data from a previous test contaminating the current one | Test isolation issue — test issue. Ensure tests don't depend on shared state |
| **Navigation race** | URL shows an intermediate state; page is mid-redirect when the test tries to interact | Test issue — add `verifyUrlContains` or `waitForState` after navigation |
| **Third-party dependency** | CDN asset failed, external widget didn't load, embedded iframe timed out | Neither test nor app bug — report as infrastructure/external dependency issue |

### Stage 5 — Fix (test issues only)

1. **Apply the fix.** Use the Steps API correctly — refer to the API Reference in the main `singularity` skill for all method signatures.
2. **If the fix requires new selectors:** use Playwright MCP to inspect the DOM, propose the new `page-repository.json` entries, and get explicit user approval before editing.
3. **Run the test 3-5 times** to confirm stability. A single pass is not sufficient — flaky tests are worse than failing tests.
   ```bash
   # Run the specific test file multiple times
   for i in {1..5}; do npx playwright test <test-file> --reporter=line; done
   ```
4. **Only commit after all stability runs pass.**
5. **If any stability run fails:** re-enter the diagnostic pipeline from Stage 1. The fix is incomplete.

### Stage 6 — Report (app bugs only)

Present the bug report to the user with this structure:

> **Application Bug Report**
>
> **Test:** `tests/example.spec.ts` — TC_001: Login flow
> **Step:** "Verify dashboard loads after login"
>
> **Expected:** Dashboard page loads with welcome message and user stats
> **Actual:** Page shows "500 Internal Server Error"
>
> **Screenshot:** [describe what the screenshot shows]
> **DOM:** [describe what DOM inspection revealed — e.g., error page rendered, expected component absent]
> **Reproducible:** Yes — confirmed by navigating manually via Playwright MCP
>
> This is an application bug. The test has NOT been modified.

Do NOT modify the test to work around the bug. Do NOT skip the test. Do NOT add try/catch blocks to swallow the error. Report and stop.

---

## Stability Validation Protocol

A fix is confirmed only when the test passes **3-5 consecutive runs** without failure. This catches:
- Race conditions that pass 80% of the time
- Timing-sensitive tests that work on fast machines but fail under load
- State leakage between tests that only manifests on repeated runs

If any run in the stability check fails, the fix is incomplete. Do not commit — re-diagnose.

---

## Integration

This skill is activated by other companion skills:

| Calling Skill | Activation Point | What Happens Next |
|---|---|---|
| `maintenance` | First step when a test failure is reported | After fix + stability → return for compliance review + commit |
| `authoring` | When a newly written test fails in Stage 3 | After fix + stability → return for compliance review + commit |
| `test-composer` | When a test run produces failures | After fix + stability → return for next scenario |
| `bug-discovery` | When adversarial tests fail | After fix + stability OR bug report → return to caller |

After a successful fix + stability confirmation, control returns to the calling skill.

---

## API Reference

Refer to the API Reference in the main `singularity` skill for all method signatures, argument orders, and types. All Steps methods use `(elementName, pageName)` order.
