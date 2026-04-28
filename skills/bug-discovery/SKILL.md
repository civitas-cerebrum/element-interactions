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

> **Skill names: see `../element-interactions/references/skill-registry.md`.** Copy skill names from the registry verbatim. Never reconstruct a skill name from memory or recase it.

Systematic, automated bug discovery that runs after all existing test stages are complete. The agent probes the live application for bugs across edge cases, user flows, and cross-feature interactions, then cross-references findings against accumulated context and existing tests to produce a prioritized bug report with reproduction tests.

**Core principle — "First time effect":** Probe the live app BEFORE reading any context. Fresh eyes catch things that familiarity blinds you to. Context is used afterward to filter, classify, and derive additional findings.

**Probing perspective — think like a QA engineer.** This skill is not just for hunting "interesting" bugs in unusual corners. It is the QA-coverage layer of the pipeline: every potential use case a QA engineer would design a test for, including negative cases. When you sit down to probe a page or a journey, your starting question is *"what are all the use cases a QA engineer assigned to this feature would write tests for, including the negative complement of every positive expectation?"* Bug-hunting categories (race conditions, cross-feature, cumulative state) extend above that floor — they do not replace it.

---

## Canonical return + ledger schema

Every finding reported by this skill — whether returned directly to the user or appended to the adversarial-findings ledger by a `coverage-expansion` adversarial subagent — MUST conform to the canonical schema documented in [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md).

- **Finding-return format** — every finding uses `- **<FINDING-ID>** [<severity>] — <title>` with `scope`, `expected`, `observed`, `coverage` sub-bullets.
- **FINDING-ID** — `<journey-slug>-<pass>-<nn>` when invoked by `coverage-expansion` as a Pass-4 or Pass-5 subagent; `<journey-slug>-<nn>` for standalone invocations. No `AF-*`, `BUG-*`, `P4-*-BUG-NN`, or other legacy schemes.
- **Severity** — one of `critical`, `high`, `medium`, `low`, `info`. No other values. The "No impact (DOM-only)" classification in this skill's Phase 5 rubric maps to `info` when emitted in the canonical return shape.
- **Return states** — `covered-exhaustively` requires evidence (per-expectation mapping); `no-new-tests-by-rationalisation` is **not a valid return** from any adversarial pass.
- **Ledger schema** — when an adversarial subagent appends to `tests/e2e/docs/adversarial-findings.md`, the append MUST validate against the schema in §3 of the reference file (header, `### j-<slug>`, `**Pass <N> — <kind> (YYYY-MM-DD)**`, `Scope:`, `#### <FINDING-ID>` blocks with `expected` / `observed` / `ledger-only` / `coverage` lines, and a `**Pass <N> summary:**` footer). Validate in-memory before releasing the lock.

Do not re-paste the schema when dispatching sub-flows of this skill — point at the reference file instead.

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

## Invocation scope — standalone vs journey-scoped

This skill runs in two scopes. The probing categories below apply to both, but the journey-scoped invocation has an additional deterministic input.

- **Standalone** — user asked to bug-hunt the whole app. Probe every page using the open-ended categories in Phase 1a / 1b.
- **Journey-scoped** (dispatched by `coverage-expansion` as a Pass-4 or Pass-5 adversarial subagent) — the dispatch brief includes the journey's map block, page-repo slice, AND a **negative-case matrix** derived per the contract in [`../coverage-expansion/references/adversarial-subagent-contract.md`](../coverage-expansion/references/adversarial-subagent-contract.md) §"Negative-case matrix — full QA scope". Every matrix entry MUST be probed; the open-ended categories below extend above that floor. A journey-scoped invocation that probes only the open-ended categories without covering the matrix is a contract violation — re-dispatch with the matrix and probe again.

When standalone, derive an analogous per-page negative-case list on the fly: for every primary positive flow you observe on a page (the "QA happy-path" interpretation), enumerate at least one negative complement (missing required field, malformed input, unauthorised access, replay / idempotency, session boundary) before moving on. The matrix concept does not vanish in standalone mode — it is built ad-hoc from observation rather than supplied in a brief.

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

---

## Commit-message conventions

Every adversarial pass this skill produces MUST use the following template when the pass output is committed (whether committed by this skill directly or by the `coverage-expansion` orchestrator):

```
docs(bug-hunt): <journey-or-phase> — N findings
```

- `<journey-or-phase>` identifies the scope: a journey slug (`j-<slug>`) when invoked per-journey from `coverage-expansion`, or a phase label (`phase-1a`, `phase-1b`, `full`) when invoked standalone.
- `N` is the total count of findings written to the report/ledger in this pass.

Examples:
- `docs(bug-hunt): j-book-demo — 7 findings`
- `docs(bug-hunt): phase-1a — 23 findings`
- `docs(bug-hunt): full — 48 findings`

When this skill is invoked from `coverage-expansion` adversarial passes 4 or 5, the orchestrator may use the pass-specific templates from `coverage-expansion/SKILL.md` (`docs(ledger): <j-slug> — N probes, M boundaries, K suspected bugs` for pass 4; `test(<j-slug>-regression): lock <boundary-description>` for pass-5 regression tests). The `docs(bug-hunt): …` template applies to standalone invocations.

Do NOT use `fix(…): …` or `bug(…): …` for bug-hunt output — findings go to the report/ledger, not the code. Use `fix(…): …` only for test-code or app-code changes made to close out a finding.

---

## Invocation options

bug-discovery accepts two independent parameters via `args`: a `phase` selector and a `mode` selector.

### `phase`

| Phase | Behaviour |
|---|---|
| `phase: 'full'` (default) | Run Phase 1a (Element Probing), Phase 1b (Flow Probing), and everything downstream as documented above. |
| `phase: '1a-element-probing'` | Run Phase 1a only. Write findings to `onboarding-report.md` (or the default bug report file). Do not run Phase 1b. |
| `phase: '1b-flow-probing'` | Run Phase 1b only. Require that Phase 1a has already been run in a prior session (findings file exists). Use those findings to prioritise flow probes. |

Parameter parsing: recognise the literal substrings `1a-element-probing`, `1b-flow-probing`, or `full` in `args`. Default to `full`.

### `mode`

| Mode | Behaviour |
|---|---|
| `mode: 'live'` (default) | Probe the running application through Playwright MCP as documented in Phases 1a–1b. Requires MCP availability. |
| `mode: 'static'` | First-class static-only adversarial probing. No live navigation. See below. |

## Static mode — first-class adversarial probing

`mode: static` is a **first-class probing mode**, not a degraded fallback for when live probing fails. In environments where MCP is unavailable — CI runners without a browser, restricted sandboxes, read-only review checkouts — static mode is the default. Static findings stand on their own merit; they are simply a different class of evidence than live findings, and they are labelled as such.

### What the subagent reads

In static mode the subagent does not navigate the app. It reads, in order:

1. Spec files in the test directory — to understand what is currently asserted and what boundaries existing tests already guard.
2. `page-repository.json` — the authoritative selector inventory and element-attribute context (input types, max-length attributes, role hints).
3. `tests/e2e/docs/app-context.md` — documented pages, flows, and known quirks.
4. Sibling-journey ledger sections in `tests/e2e/docs/adversarial-findings.md` (or equivalent) — adversarial findings logged against related journeys often transfer to the journey under analysis.

### How bugs are inferred

Static mode infers likely bugs from pattern matches against the code and repository snapshot. Every inferred finding is recorded with `inferred: true` in its structured body. Examples of inference patterns:

1. **Missing `maxlength` on a free-text input** → likely HTTP 500 on long input (server-side length unguarded). Infer a boundary bug for payloads above the typical DB column cap (255, 4000, etc.).
2. **Missing `type="email"` / no client validation on an email field** → likely XSS or malformed-input vector; downstream rendering probably reflects user-supplied content unescaped.
3. **No `autocomplete="off"` on a password-reset or MFA entry field** → likely credential-leak surface via browser autofill in shared-device contexts.
4. **No CSRF token reference in a form handler that issues a mutating POST** → likely CSRF vulnerability, especially if the session cookie lacks `SameSite=Lax|Strict`.
5. **Numeric input without `min` / `max` / `step` attributes** → likely negative-number or floating-point edge-case bug (e.g., quantity=-1 bypassing validation, price=0.0001 rounding to 0).

These five are illustrative — the subagent applies the same inference pattern to any similar structural gap it observes. Each finding body states the evidence (which file, which element, which missing attribute), the inferred failure mode, and carries the `inferred: true` flag.

### What static mode must never claim

- **No verified-bug claims.** Static mode never asserts that a bug was reproduced. Findings are inferences from structural evidence. If the caller later re-runs in `mode: live`, the inference can be confirmed or refuted — but until then, the finding is documented as inferred only.
- **No reproduction test.** Phase 6 writes reproduction tests; static mode does not. A static finding can be handed to a later live pass for reproduction, but the static subagent itself stops at evidence + inference.

### Why this is first-class, not a fallback

Several environments are static-only by construction: CI runners without a browser, regulated sandboxes that block outbound network, code-review contexts, and offline audits. Running bug-discovery in those contexts is a legitimate use case, not a degraded one. Framing static mode as a first-class probing mode removes the "apology" framing that produces weaker findings and standardises the structured-return shape so the orchestrator can merge static and live findings on the same footing (with the `inferred: true` flag retaining the epistemic distinction).

### Orchestrator-side: no silent deprioritisation

Being first-class is not only framing — it is a constraint on how orchestrators (`coverage-expansion`, `onboarding`, Phase-7 deck generation) handle the findings:

- **Ranking.** Static findings rank by **severity**, not by evidence class. A `severity: high` inferred finding outranks a `severity: low` live-verified finding in any ordered list.
- **Inclusion in reports and decks.** Static findings appear in the onboarding-report and the summary deck on the same footing as live findings. The `inferred: true` flag is shown explicitly so readers can judge epistemic weight, but the finding is not buried or collapsed.
- **Follow-up suggestion.** When static findings landed in an earlier run and MCP later becomes available, the orchestrator SHOULD suggest re-running the affected journeys in `mode: live` to confirm or refute each `inferred: true` finding. "Suggest" means a one-line progress note to the caller, not an autonomous re-run.

**Rationalizations to reject:**

| Excuse | Reality |
|--------|---------|
| "Inferred findings are weaker so I'll bucket them separately in the deck" | Bucketing by evidence class rather than severity buries high-impact static findings. The flag carries the epistemic weight — ranking stays severity-first. |
| "Static-mode findings are probably false positives, so I'll drop the low-severity ones" | Every finding's severity is the subagent's judgement; filtering on evidence class on top of severity is double-discounting. |
| "Live mode ran fine so I can ignore any earlier static findings" | A live pass that failed to reproduce an inferred finding does not refute it — it demotes evidence, but the finding stays in the report unless the live pass reached the specific pattern. The orchestrator marks the inference as `live-unconfirmed`, not deleted. |
| "MCP is available so there's no reason to run static mode" | Correct for that one run. Static mode is not opportunistic redundancy — it is for environments where live is unavailable. Do not run static mode in parallel with live unless the caller specifically requested a code-audit pass. |
