---
name: journey-mapping
description: >
  Map user journeys through a web application before writing tests. Discovers pages, builds app context
  incrementally, identifies all user flows, and prioritizes them by business impact. This is a mandatory
  prerequisite for coverage expansion (test-composer) and the full pipeline. Invoke when: starting a
  full E2E suite, before coverage expansion, before any major test composing activity, or when asked to
  "map the app", "discover user journeys", "map user flows", or "understand the app".
---

# Journey Mapping — App Discovery & User Flow Analysis

Systematic discovery of a web application's structure, pages, and user journeys. Produces a prioritized journey map that serves as the blueprint for test coverage. Every test composed after this stage traces back to a mapped journey.

**Core principle:** Understand the app like a user before testing it like an engineer. Discovery comes before inspection. Journeys come before selectors.

---

## When This Skill Activates

This skill is a **mandatory companion** that activates in these contexts:

| Context | When it activates | What it does |
|---|---|---|
| **Full pipeline** | After Stage 1 scenario approval, before Stage 5 | Maps the entire app, prioritizes journeys, feeds into coverage expansion |
| **Coverage expansion** | Before test-composer begins | Maps uncovered areas, identifies journey gaps |
| **On request** | "Map the app", "discover journeys", "what flows exist?" | Standalone discovery and mapping |

**Hard rule:** Test Composer (Stage 5) MUST NOT begin without a completed journey map. If the journey map doesn't exist when test-composer is invoked, this skill runs first.

---

## What This Skill Does NOT Do

- **Does not inspect selectors.** Discovery focuses on what the app does and how users flow through it, not on CSS classes or DOM structure. Selector inspection happens in its dedicated stage (Stage 2) or during test-composer implementation.
- **Does not write tests.** It produces the map that guides test writing.
- **Does not read existing tests.** It discovers the app with fresh eyes to avoid blind spots where tests exist but journeys aren't mapped.

---

## Phase Structure

```
Phase 1: Page Discovery          ─── visit every page, build app context
Phase 2: Flow Identification     ─── trace user paths through discovered pages
Phase 3: Journey Prioritization  ─── rank by business impact
Phase 4: Journey Map Document    ─── write the deliverable
Phase 5: Coverage Checkpoint     ─── compare map vs implemented tests (post-implementation)
```

Phase 5 runs **after** test-composer completes, not during mapping. It's the verification gate.

---

## Phase 1: Page Discovery

Visit every reachable page in the application via the Playwright MCP. Build the app context document incrementally as you go.

### Process

1. **Start at the entry point** — usually the homepage or login page
2. **Take a snapshot** of each page
3. **Record to app-context.md** immediately (per Rule 9 of element-interactions):
   - URL pattern
   - Page purpose (one sentence)
   - Key sections visible
   - Interactive elements (buttons, links, forms, tabs)
   - Where this page links to (outbound navigation)
   - Where this page is reached from (inbound navigation)
4. **Follow every link** — navigate breadth-first through the app. Click nav items, CTAs, footer links, card links. Every reachable URL gets visited.
5. **Note state variations** — does the page look different when empty, loading, errored, or with different data? Document each state.
6. **Note gated pages** — pages behind login, roles, or paywalls. Document what's gated and what credentials/setup would be needed to access them.

### Discovery Scope Rules

- **Follow internal links only.** External links (social media, third-party services) are noted but not followed.
- **Stop at authentication boundaries.** If a page requires login, document it as gated and move on. Do not guess credentials.
- **Stop at infinite pagination.** Note that pagination exists and how many pages are accessible, but don't click through 500 pages of results.
- **Click dropdowns, tabs, and accordions.** These reveal hidden navigation and content that static page views miss.
- **Check mobile navigation.** Resize to mobile viewport once during discovery to identify mobile-only nav patterns (hamburger menu, bottom tabs).

### Output

An updated `tests/e2e/docs/app-context.md` with every discovered page documented. Plus a **site map** — a flat list of all discovered URLs:

```markdown
## Site Map
- / (Homepage)
- /contact
- /about-us
- /services/test-automation
- /services/performance-testing
...
Total: X pages discovered
Gated: Y pages behind authentication
```

---

## Phase 2: Flow Identification

Read the completed app-context.md and trace every path a user can take through the application. A flow is a sequence of pages connected by navigation actions.

### How to Identify Flows

1. **Start from every entry point.** Entry points are: homepage, direct URLs shared in marketing/email, login page, any page indexed by search engines.
2. **For each entry point, ask: "What does a user want to accomplish?"** Each answer is a potential journey.
3. **Trace the path.** From entry to goal, what pages does the user visit? What actions do they take on each page?
4. **Identify branches.** Where can the user go off-path? What happens if they navigate backwards, skip a step, or take an alternative route?

### Flow Categories

| Category | Description | Example |
|---|---|---|
| **Conversion flows** | Paths that lead to business outcomes — signups, purchases, contact submissions, bookings | Homepage → Services → Contact → Book meeting |
| **Content consumption flows** | Paths through informational content — reading articles, case studies, guides | Homepage → Guides → Read article → Related articles |
| **Navigation flows** | How users move between major sections — top nav, footer, breadcrumbs, CTAs | Nav dropdown → Service page → CTA → Contact |
| **Account flows** | Authentication, profile management, settings | Login → Dashboard → Settings → Change password |
| **Error recovery flows** | What happens when things go wrong — 404, expired sessions, invalid input | Submit invalid form → Error state → Correct input → Success |
| **Return visitor flows** | Users who come back — bookmarks, email links, saved state | Email link → Deep page → Navigate to related content |

### Output

A list of identified flows, each described as a sequence of steps:

```markdown
### Flow: Visitor to Contact
**Category:** Conversion
**Entry:** Homepage (/)
**Steps:**
1. User reads hero section
2. User clicks "Test Automation" pillar link → /test-automation
3. User reads service description
4. User clicks "Talk To Our Team" CTA → /contact
5. User views contact info and calendar
6. User selects meeting date and time
**Exit:** Meeting booked (HubSpot confirmation)
**Branches:**
- From step 2: user could click any of 3 pillar links
- From step 3: user could click case study instead of CTA
- From step 5: user could email or call instead of booking
```

---

## Phase 3: Journey Prioritization

Assign a priority to each identified flow based on business impact. Priority determines coverage depth.

### Priority Framework

| Priority | Criteria | Coverage expectation |
|---|---|---|
| **P0 — Revenue / Core conversion** | Directly leads to business outcomes: purchases, signups, bookings, lead submissions. If this flow breaks, the business loses money or customers. | Full journey test, error states, edge cases, mobile viewport, performance baseline |
| **P1 — Core experience** | Features most users interact with. Defines what the product is. If broken, users leave. | Full journey test, key error states, data verification |
| **P2 — Supporting content** | Resources, guides, blog, about pages, informational flows. Enhances experience but not critical path. | Page loads, links work, content present, one journey test |
| **P3 — Peripheral** | Legal pages, footer links, settings that rarely change, admin tools used internally. | Smoke test: page loads, no broken links |

### Prioritization Questions

For each flow, ask:
1. **Revenue impact:** Does this flow directly lead to a transaction or conversion? → P0
2. **User frequency:** Do most users go through this flow? → P1 minimum
3. **Failure impact:** If this flow breaks, do users notice? Can they work around it? → Raises priority
4. **Business context:** Is there a deadline, compliance requirement, or recent incident related to this flow? → Raises priority

If the app's business purpose is unclear, ask the user:
> "What is the primary goal of this application? What action do you most want users to complete?"

### Output

The flow list from Phase 2, now with priorities assigned:

```markdown
| Priority | Flow | Category | Entry → Exit |
|----------|------|----------|-------------|
| P0 | Visitor to Contact | Conversion | / → /contact → booking |
| P1 | Service browsing | Core experience | / → /services/* → /contact |
| P2 | Content discovery | Content | / → /guides → /guides/* |
| P3 | Legal review | Peripheral | footer → /terms-conditions |
```

---

## Phase 4: Journey Map Document

Write the complete journey map to `tests/e2e/docs/journey-map.md`. This is the blueprint that test-composer uses to determine what to implement and in what order.

### Document Structure

```markdown
# Journey Map — [App Name]

**Date:** YYYY-MM-DD
**App:** [URL]
**Pages discovered:** X
**Flows identified:** X
**Priority breakdown:** X P0, X P1, X P2, X P3

## Site Map
[flat URL list from Phase 1]

## User Journeys

### P0 — Revenue / Core Conversion

#### [Journey Name]
**Entry:** [page]
**Steps:**
1. [action] → [page]
2. [action] → [page]
...
**Exit:** [outcome]
**Branches:** [alternative paths]
**Test expectations:**
- Full journey test (entry to exit)
- Error state: [what if step N fails?]
- Edge case: [unusual input, timing, etc.]
- Mobile: [does this flow work on mobile?]

### P1 — Core Experience
...

### P2 — Supporting Content
...

### P3 — Peripheral
...

## Gated Areas (Not Mapped)
[pages behind auth, paywalls, etc. with notes on what's needed to access]

## Coverage Checkpoint Template
[filled in during Phase 5, after test-composer completes]
```

### Hard Gate

After writing the journey map, present it to the user:

> "Journey map written to `tests/e2e/docs/journey-map.md`. I identified X user journeys across X pages (X P0, X P1, X P2, X P3). Please review before I begin test implementation."

Wait for approval before proceeding to test-composer.

---

## Phase 5: Coverage Checkpoint

This phase runs **after test-composer completes** — not during mapping. It compares implemented tests against the journey map to verify full coverage.

### Process

1. **Read the journey map** (`tests/e2e/docs/journey-map.md`)
2. **Read all spec files** and list which journey steps are covered by tests
3. **Build a coverage matrix:**

```markdown
## Coverage Checkpoint

| Journey | Priority | Steps | Steps covered | Coverage | Status |
|---------|----------|-------|---------------|----------|--------|
| Visitor to Contact | P0 | 6 | 6 | 100% | Complete |
| Service browsing | P1 | 4 | 3 | 75% | Missing: case study branch |
| Content discovery | P2 | 3 | 3 | 100% | Complete |
| Legal review | P3 | 2 | 2 | 100% | Complete |
```

4. **Flag gaps:**
   - P0 journey with < 100% step coverage → **Must fix before shipping**
   - P0 journey without error state tests → **Must fix**
   - P1 journey with < 75% coverage → **Should fix**
   - P2/P3 with < 50% → **Nice to have**

5. **Report to user:**

> "Coverage checkpoint complete. X/Y journeys fully covered. Z gaps found: [list P0/P1 gaps]. Should I implement the missing coverage?"

### Hard Gate

If any P0 journey has less than 100% step coverage, the test suite is **not complete**. The coverage checkpoint must pass before the work-summary-deck is generated.

---

## Integration with Other Skills

### element-interactions (main orchestrator)
Journey mapping activates as a companion skill:
- **Full pipeline:** After initial scenario (Stages 1-4), before test-composer
- **Coverage expansion:** Before test-composer begins
- Journey map is the input to test-composer; coverage checkpoint is the final verification

### test-composer
Test composer reads the journey map to determine:
- **What to implement** — journey steps that lack test coverage
- **Implementation order** — P0 journeys first, then P1, P2, P3
- **Coverage depth** — P0 gets full journey + error states + mobile; P3 gets smoke tests
- **When to stop** — all journey steps covered at the depth specified by their priority

### bug-discovery
Bug discovery uses the journey map to design adversarial flow probes:
- **Phase 1b (Flow Probing)** reads the journey map to identify which flows to break
- Interrupted, out-of-order, and concurrent state probes target mapped journeys
- Higher-priority journeys get more adversarial attention

### work-summary-deck
The deck includes journey coverage metrics from the coverage checkpoint:
- Total journeys mapped vs. covered
- P0 coverage percentage
- Coverage matrix summary
