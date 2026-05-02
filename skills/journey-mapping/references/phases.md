# Journey-Mapping Phase Protocols — Phases 1–3.5

**Status:** authoritative spec for the discovery → identification → prioritization → redundancy-revision phases of journey-mapping. Cited from `journey-mapping/SKILL.md`.
**Scope:** Phase 1 (Page Discovery + Test Infrastructure probe), Phase 2 (Flow Identification), Phase 3 (Journey Prioritization), Phase 3.5 (Redundancy Revision). Per-phase process, parallel-discovery model, output formats.

For Phase 4 (Journey Map document) and Phase 5 (Coverage Checkpoint), see `journey-mapping/SKILL.md` directly — those phases' outputs are tightly coupled to the SKILL.md's signature-marker and hard-gate rules.
For the canonical browser-automation primitive used in Phase 1 discovery, see `../element-interactions/references/playwright-cli-protocol.md`.

---

## Phase 1: Page Discovery

Visit every reachable page in the application via `@playwright/cli` (see [`../element-interactions/references/playwright-cli-protocol.md`](../element-interactions/references/playwright-cli-protocol.md)). Build the app context document incrementally as you go.

### Discovery Tool Rule — `playwright-cli` only

Page discovery **must** be performed through `@playwright/cli` from the Bash tool (`playwright-cli open`, `playwright-cli snapshot`, `playwright-cli click`, `playwright-cli eval`, etc.). This is non-negotiable:

- **Do not** infer pages from reading source files, route tables, router configs, sitemaps, or existing tests. Static inspection misses runtime-only routes, feature flags, auth-gated redirects, and client-side navigation state.
- **Do not** use `fetch`/`curl`/WebFetch to scrape HTML — those bypass client-side rendering and produce a false map.
- **Do not** substitute a headless Playwright test runner or shell scripts for the CLI. Discovery runs in a live `playwright-cli` session so snapshots, console errors, and navigation timing are observable and recordable.
- **Every URL in the site map must have a corresponding `playwright-cli` snapshot** taken during this phase. If a page appears in the map without a CLI visit, it was guessed — remove it and visit it, or mark it gated.
- **Do not** call the `mcp__plugin_playwright_playwright__browser_*` MCP tools, even when the harness lists them as available. They run a separate Chrome process, write to a separate `.playwright-mcp/` directory, and share no state with the CLI's session model — using them at any point in discovery (parent or subagent) silently breaks the per-session OS-isolation guarantee documented in `../element-interactions/references/playwright-cli-protocol.md`. The CLI is the only sanctioned discovery channel.

`@playwright/cli` ships as a hard dependency of `@civitas-cerebrum/element-interactions`, so it is always reachable via `npx playwright-cli` after the package is installed. If the binary is somehow unreachable, the install is corrupted — `npm install` fixes it. If the browser binary is missing on the dev machine, the first `... open` call exits with a clear error; run `npx playwright-cli install-browser chromium` once, then retry. Do not fall back to static analysis.

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

### Parallel discovery

For apps with multiple known entry points, Phase 1 parallelizes. **Parallel is the default** whenever two or more entry points are known. There is no isolation-prerequisite check: every dispatched subagent issues `playwright-cli -s=<unique-slug> open` and gets its own OS-isolated browser process by construction (see Rule 11 in the `element-interactions` orchestrator and `references/playwright-cli-protocol.md` §1).

**Protocol:**

1. Enumerate entry points: homepage (`/`), login page, and any other known top-level URLs (dashboard, known subsystem roots, explicitly user-listed starting points).
2. Quarantine: run `npx playwright-cli close-all` once at the start of the phase to reap any stale sessions from prior interrupted runs.
3. For each entry point, dispatch a discovery subagent in parallel. Each subagent gets:
   - Its assigned entry point URL.
   - A unique session slug (`phase1-<entry-slug>`, per `playwright-cli-protocol.md` §3.1).
   - Its own fresh context window — no prior session content.
   - A terse brief: crawl the subtree breadth-first, capture snapshots, return a structured list of discovered pages + interactive elements.
4. Parent journey-mapping agent merges each subagent's returned page list into `tests/e2e/docs/app-context.md` and the flat site map. Parent does **not** paste raw DOM snapshots or CLI transcripts into its own context.
5. Deduplicate pages discovered by multiple subagents (common boundary pages show up twice; keep one entry with merged metadata).
6. After every subagent has returned and closed its session, the parent runs `npx playwright-cli close-all` as belt-and-suspenders cleanup, then proceeds to Phase 2 with the consolidated site map.

**Concrete dispatch shape:**

For each entry point, the agent dispatches a subagent through whatever subagent-dispatch primitive its environment provides. Example shape:

```
dispatchSubagent({
  description: "Discover <subtree>",
  prompt: `
    Crawl <entry-point-URL> breadth-first. Capture a snapshot of each page,
    record URL, purpose, key sections, interactive elements, and outbound links.
    Return a structured list of discovered pages and interactive elements.
    Do not paste raw DOM into the return — summarize.

    Browser automation: use @playwright/cli from the Bash tool. Open and close
    your own session — siblings have their own slugs and sessions are isolated
    by construction (one browser process per -s= name).

        npx playwright-cli -s=phase1-<entry-slug> open --browser=chromium <entry-point-URL>
        # ...crawl with snapshot / click / goto...
        npx playwright-cli -s=phase1-<entry-slug> close

    Snapshot format and command surface:
    skills/element-interactions/references/playwright-cli-protocol.md §3 + §5.
    Do NOT call close-all (the parent owns that).
  `,
})
```

Dispatch one subagent per entry point, all in parallel. Each dispatched subagent opens its own browser session via `-s=<slug> open`. The parent does **not** drive its own browser during the parallel phase.

**Parallelism:** dispatch as many subagents in parallel as the independence graph allows — there is no fixed cap and no isolation-driven serialization. In Phase 1, every entry point is an independent root, so dispatch N subagents for N entry points.

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

### Test Infrastructure probe (split: per-entry observation + post-crawl `phase1-test-infra:` subagent)

Phase 1 captures the application's test-infrastructure surface — auth model, reset endpoint, persistent banners, mutation endpoints, stable seed resources — for downstream consumption by Stage 4a of the test-composition pipeline.

Load `references/test-infrastructure-probe.md` and run the protocol described there. The probe runs in **two coordinated layers**:

1. **In parallel with the crawl** — each per-entry-point `phase1-<entry>:` subagent records observed items (auth-model network shapes, mutation endpoints fired by the browser) in its structured return.
2. **After the crawl completes** — the orchestrator dispatches a single **`phase1-test-infra:` subagent** that runs the deliberate post-crawl probes (reset-endpoint detection, banner / modal selector resolution, stable-seed enumeration) AND reconciles the per-entry-point observations into a single deduplicated list, then writes the canonical `## Test Infrastructure` section to `tests/e2e/docs/app-context.md`.

**Why a subagent for the post-crawl probe.** The deliberate probe generates several thousand tokens of network output and DOM snapshots. Confining it to a throwaway subagent context keeps the orchestrator at index-level state — the orchestrator only sees the structured return (the `## Test Infrastructure` Markdown block + the audit-tag list). Same context-discipline rule coverage-expansion enforces for composer/probe work, applied here.

**Output:** a `## Test Infrastructure` section appended to `tests/e2e/docs/app-context.md`, in the canonical format documented in `references/test-infrastructure-probe.md`.

**Safety:** the reset-endpoint probe respects the host allowlist defined in the probe protocol. Hosts outside the allowlist short-circuit with `reset-endpoint: skipped`.

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

## Phase 3.5: Redundancy Revision

Before writing the journey map, scan the prioritised journey list for redundancy. Overlap between journeys is expected — real users traverse shared pages — but unmanaged overlap bloats the map and makes downstream parallel test composition harder. Revision rebalances the list.

### Checks

1. **Shared-segment extraction.** Any two journeys that share three or more consecutive steps on the same pages: extract the shared segment as a named sub-journey (`sj-<slug>`) and reference it from both parent journeys.
2. **Variant collapse.** Any two journeys that differ only in their final step or final page: consider merging as one journey with labelled variant exits.
3. **Decomposition.** Any single journey that chains multiple distinct user goals (e.g., "browse → purchase → manage account"): split into smaller journeys and record the cross-journey entry points explicitly.
4. **Explicit overlap annotation.** Where two journeys legitimately pass through the same page for different goals, annotate the page's role per journey on the journey blocks rather than silently.

### Process

1. Build a page × journey matrix from the Phase 2 flow list.
2. Scan row-by-row and column-by-column for the patterns above.
3. For each match, propose a revision and apply it to the journey list.
4. Emit a one-line revision log entry per change (e.g., "extracted sj-login from j-book-demo and j-request-quote").

### Output

A revised journey list where:
- Shared segments live as reusable sub-journeys (`sj-<slug>`).
- Each remaining journey has a stable ID (`j-<slug>`).
- Each journey's `Pages touched:` list is concrete.
- Every overlap between journeys is either routed through a sub-journey or explicitly annotated.

This revised list feeds Phase 4.

---

