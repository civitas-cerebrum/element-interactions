---
name: test-catalogue
description: >
  Use when asked to "produce a test catalogue", "generate a scenario report", "catalogue the suite",
  "client-ready catalogue", "export the scenario inventory", or any request for a stakeholder-facing
  list answering "what scenarios are we running, and why?". Opt-in and on-demand only: never activates
  during test writing, coverage expansion, repair, or debugging. Requires a sentinel-bearing
  `tests/e2e/docs/journey-map.md` and at least one spec file to be present.
---

# Test Catalogue — Client-Ready Scenario Inventory PDF

Generate a printable, stakeholder-facing catalogue that answers the question **"what scenarios are we running, and why?"** at a glance. The audience is non-technical: a product owner, a manager, a client sponsor. They want to see coverage organised by portal and priority, with a short human-readable line per scenario and a transparent list of anything explicitly deferred.

Output is an A4-landscape PDF (and its HTML source), cover page first, sectioned by portal, sorted by priority, with a dedicated adversarial-regression section and a skipped-with-reason section at the end.

---

## When This Skill Activates

This skill is **on-demand only**.

Activation phrases:
- "produce a test catalogue"
- "generate a scenario report"
- "catalogue the suite"
- "client-ready catalogue"
- "export the scenario inventory"

It does NOT activate during test writing, coverage expansion, repair, or debugging — those belong to the primary `element-interactions` stages. It is a paired document to `work-summary-deck`: the deck tells the narrative, the catalogue lists the inventory.

---

## Required Inputs

| Source | Path | Purpose |
|---|---|---|
| Spec files | `tests/e2e/**/*.spec.ts` | Scenario extraction |
| Journey map | `tests/e2e/docs/journey-map.md` | Must start with `<!-- journey-mapping:generated -->` sentinel. Cross-referenced for priority / category / entry / portal. |

If either input is missing, stop and tell the user — do not fabricate a journey map.

### Optional Inputs

| Source | Path | Effect if present |
|---|---|---|
| App context | `tests/e2e/docs/app-context.md` | Populates the cover-page app summary line |
| Adversarial findings | `tests/e2e/docs/adversarial-findings.md` | Used to distinguish regression specs as "adversarial-regression" |

### Optional Args

| Arg | Default | Effect |
|---|---|---|
| `brand: <name>` | generic dark-mode | Overrides the cover/accent palette. Known brands: `spritecloud` (blue `#00A3FF` + orange `#FF7A1A`), `civitas-cerebrum` (green `#3fb950`). |
| `output: <path>` | `test-catalogue.pdf` | Output PDF filename at repo root |

---

## Phases

### Phase 1 — Extract

For every `tests/e2e/**/*.spec.ts`:

1. Parse the file content.
2. Capture each `test.describe(...)` context (nesting allowed).
3. For each `test(...)`, `test.skip(...)`, or `test.fail(...)` that appears at statement position (ignore inner `test.skip(condition, 'msg')` calls inside test bodies — those are runtime skips, not structural skips):
   - File path (relative to repo root)
   - Enclosing describe chain
   - Test name (the first string argument)
   - Marker: `active | skipped | failing-expected`
   - Any `@tag` substrings inside the test name (e.g., `@mobile`, `@security`)
4. Determine the journey ID from either:
   - The outer `describe` name if it starts with `j-` or `sj-`, or
   - The file-name convention: `<portal>-<slug>.spec.ts` → attempt matching `j-<portal>-<slug>` against journey-map headings.

Implementation hint: a tolerant regex-based walk is sufficient. You do not need a real AST — spec files in this framework follow predictable patterns (see `references/spec-parsing.md`).

### Phase 2 — Cross-reference

Load `journey-map.md`. For each `### j-…` heading, extract the metadata block that follows (Priority, Category, Entry, Portal-inferred-from-Entry). Build a lookup table.

For each extracted test:
- If its journey matches → attach priority, category, portal, short purpose (the heading text).
- If the spec file name ends in `-regression.spec.ts` → mark as `adversarial-regression` and, when adversarial-findings.md lists a matching boundary (`VB-NN` or `P4-…` code), attach that code.
- If the enclosing describe starts with `sj-` → mark as `structural` (these are composed into journeys rather than being user-facing journeys themselves).
- If the test is `test.skip` at statement position → keep the skip + capture any human-readable reason from a nearby comment on the preceding lines (best-effort).

Unmatched tests go into an "Unmapped" bucket in the catalogue — visible so the user sees what needs mapping.

### Phase 3 — Categorise

The catalogue is grouped on **two axes**:

1. **Primary (outer) grouping — portal.** Read from the journey-map Entry URL prefix or file-name convention:
   - Manager portal
   - Administrator portal
   - Cross-cutting (sub-journeys, regression-only specs spanning both)

2. **Secondary (inner) grouping — page section.** Within each portal, group by the part of the application the scenarios exercise (e.g., Login / Auth, Clients, Locations, Groups, Caregivers, Administrators, Organisation settings, Orders, Medication administration, Double-control, Account / Profile). **Never group by priority tier.** Stakeholders care about "what parts of the app are covered," not "which priority bucket does the test sit in." Priority stays visible as a per-scenario chip (see below) — it does not drive the grouping.

Within a page section, sort **alphabetically by journey ID**.

#### Deriving the page-section taxonomy

The taxonomy is never hardcoded. Derive it per project by reading three sources:

1. **`journey-map.md` `Pages touched:` lines** — every journey lists concrete URL paths or page names. Cluster these.
2. **`app-context.md` section headings** — if the page-discovery skill recorded section names, those are the canonical human labels.
3. **Spec file naming and `describe()` blocks** — often reveal the intended section (`clients.spec.ts`, `describe('Groups — manager')`).

Algorithm:

1. Enumerate every distinct URL path / page name from `Pages touched:` across all journeys.
2. Cluster by URL-path prefix (e.g., `/clients/*`, `/locations/*`, `/users/*`). One cluster = one candidate section.
3. For each cluster, assign the human label from `app-context.md` if available, otherwise infer from the URL segment (`/caregivers` → "Caregivers").
4. Fold singleton clusters (≤1 journey) into the closest sibling section — or into a catch-all "Miscellaneous" section if none fits. Do not leave a section with a single journey unless the project genuinely has a standalone section.
5. Target **10–14 total sections** across both portals. Fewer than 8 means the taxonomy is too coarse to be useful; more than 18 means it's too granular to scan. Adjust by merging adjacent singletons or splitting overly broad sections.

The result is a derived, project-specific taxonomy. Write it out in the skill's return summary so reviewers can see what was chosen. Present the final section list on the catalogue's contents page with journey count per section, so a reader can see coverage density at a glance.

If the journey map is sparse or missing, fall back to clustering by spec-file name prefix — this is less accurate but produces a usable taxonomy without the map.

#### Per-scenario labels (chips)

Each scenario row shows:
- **Priority chip** — P0 (crit red), P1 (high orange), P2 (medium yellow), P3 (low grey). Always visible, never the grouping axis.
- **Type chip** — inferred from test-name keywords:
  - happy path (the first non-error test in a non-regression spec)
  - error state (name contains `error`, `invalid`, `reject`, `blank`, `duplicate`, `unauthorized`, `401`, `403`)
  - edge case (name contains `edge`, `boundary`, `empty`, `max`, `min`, `overflow`, `timeout`, `concurrent`)
  - mobile (name or `@tag` contains `mobile`, `iPad`, `small screen`)
  - structural (sub-journey / smoke nav)
  - regression (file in `-regression.spec.ts`)
  
  When a test matches more than one rule, pick the **most specific** one (mobile > edge > error > structural > regression > happy path).
- **Status chip** — Active / Skipped (with reason) / Failing-expected.

### Phase 4 — Render HTML

The catalogue is a sequence of A4-landscape "pages" (CSS `page-break-after: always`).

Every page has a header (brand wordmark + section micro-label + page-number `NN / TOTAL`) and a consistent 64px horizontal padding.

Page order:

1. **Cover page** — app name, date, headline totals (total scenarios, journeys covered, portal breakdown, active-vs-skipped count).
2. **Contents page** — section list with starting page numbers.
3. **One or more pages per portal.** For each portal:
   - Section header page (portal name, portal one-liner, scenario count, priority distribution).
   - Table pages grouped by priority tier. Columns: `Journey` · `Scenario` · `Type` · `Status`. When the table overflows, continue on the next page with the same headers.
4. **Adversarial regression section.** Table of every boundary-lock test with file, test name, verified-boundary code (if extractable), and category.
5. **Skipped-with-reason section.** Full list of every skipped test grouped by reason (env, blocked by tenant data, known bug, etc). This page is the transparency commitment — it must exist even when empty (rendering an explicit "No scenarios deferred" block).

Styling rules:
- A4 landscape: `1123 × 794 px` at 96dpi. CSS must declare `@page { size: A4 landscape; margin: 0; }` and every page must be `page-break-after: always`.
- Dark-mode default palette, tuned for print (see below). Must include `-webkit-print-color-adjust: exact; print-color-adjust: exact;` so Chromium honours the dark background in PDF.
- Typography: Inter via Google Fonts, fallback to system sans.
- Tables: zebra rows at low opacity (`rgba(255,255,255,0.02)`), 1px rule below the header, tight line-height.
- Priority chips: P0 = crit red, P1 = high orange, P2 = medium yellow, P3 = low grey.
- Status chips: `Active` = ok-green, `Skipped` = mute-grey, `Failing-expected` = accent-orange.
- Never include runtime / effort / "we wrote this in X hours" language. Never include an author block.
- Screenshots (if the template references any) must always use `screenshots/<file>.png` path-qualified, never bare basenames (§3.0 convention).

### Phase 5 — Render PDF

Chromium's single-pass PDF engine truncates documents that push past its rendering limits — observed in practice at ~25–30k CSS pixels of stacked content (e.g., a 37-slide catalogue truncates to 8 PDF pages). **Always render in small batches and merge.** A monolithic `page.pdf()` call is unsafe for any catalogue longer than ~15 slides.

**Required approach:** per-slide rendering + PDF merge.

1. Each `<section class="slide">` in the generated HTML must carry a `data-slide-id="<integer>"` attribute. The build script emits this during HTML generation.
2. Install `pdf-lib` (pure-JS, no native deps) once per project: `npm install --save-dev pdf-lib`.
3. The renderer:
   - Launches Chromium with viewport `1123 × 794`.
   - Navigates to the HTML file; `waitUntil: 'networkidle'`.
   - Awaits `document.fonts.ready` before rendering.
   - Emulates print media.
   - For each `data-slide-id`, injects a style tag that hides every other slide (`display: none !important`) and shows only the current slide (`display: flex !important`). Then calls `page.pdf()` with explicit `width: '1123px', height: '794px'` → single-page PDF buffer.
   - Removes the injected style tag before the next iteration.
   - Merges every single-page buffer into one output PDF via `pdf-lib`'s `PDFDocument.create()` / `copyPages()` / `addPage()`.
4. **Verification (mandatory):** after merge, read the output PDF's page count and compare against the slide count. If they differ, throw — the render is corrupt. This catches the truncation bug in CI and prevents shipping a broken deliverable.

Example skeleton (`scripts/render-catalogue-pdf.js`):

```js
const { chromium } = require('@playwright/test');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1123, height: 794 } });
  const page = await ctx.newPage();
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);

  const ids = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-slide-id]')).map(el => el.dataset.slideId)
  );

  const out = await PDFDocument.create();
  for (const id of ids) {
    const styleHandle = await page.addStyleTag({
      content: `.slide{display:none!important}.slide[data-slide-id="${id}"]{display:flex!important}`,
    });
    const buf = await page.pdf({
      width: '1123px', height: '794px',
      printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    await page.evaluate(el => el.remove(), styleHandle);
    const src = await PDFDocument.load(buf);
    const [p] = await out.copyPages(src, [0]);
    out.addPage(p);
  }
  fs.writeFileSync(pdfPath, await out.save());
  await browser.close();

  // MANDATORY verification
  const finalDoc = await PDFDocument.load(fs.readFileSync(pdfPath));
  if (finalDoc.getPageCount() !== ids.length) {
    throw new Error(`PDF has ${finalDoc.getPageCount()} pages but HTML has ${ids.length} slides`);
  }
})();
```

Do not fall back to a monolithic `page.pdf()` call even for small catalogues — keep one code path. The per-slide approach is equally fast at small sizes (each render is sub-second) and is the only approach that scales.

After the page-count check passes, proceed to **Phase 6 — Exhaustive Visual Inspection** before delivering the catalogue. Phase 5 confirms the PDF is *structurally* complete (right number of pages); Phase 6 confirms each page is *visually* correct. Both gates are mandatory.

### Phase 6 — Exhaustive Visual Inspection (mandatory, before delivery)

The catalogue is a stakeholder-facing deliverable; the stakeholder cannot proof it themselves. Every page must be visually inspected by you before the catalogue is reported as ready. Sampling a handful of pages is not enough — a single broken page in a 30-slide catalogue undermines the whole inventory and the transparency contract that drives this skill.

#### Process

1. **Read every page** of the rendered PDF using the `Read` tool with the `pages:` parameter. The tool accepts ranges (`1-5`, `12`, `20-30`) and is capped at 20 pages per request — for catalogues longer than 20 slides, batch the reads (`pages: "1-20"`, then `pages: "21-40"`, etc.) so every page is actually opened.
2. **Walk pages in order.** For each page, run the per-page-type checks below. Maintain a one-line note per page so you can cite specific failures in the return summary.
3. **Per-page checks:**

   | Page type | Mandatory checks |
   |---|---|
   | Cover | App name and date correct; every stat tile shows a real number (no `NaN`, `undefined`, `0 of 0` when the suite has tests); brand wordmark renders; dark background fills the entire page (no white margins from a `print-color-adjust` failure). |
   | Contents | Every section produced by Phase 3 (Categorise) is listed with a starting page number; page numbers monotonically increasing; no missing or duplicated section. |
   | Portal section header | Portal name + one-liner present; per-portal scenario count matches the portal split shown on the cover; priority-distribution chips render. |
   | Portal table page | Header row `Journey · Scenario · Type · Status` visible; rows aligned, no horizontal overflow; priority and type chips coloured per palette; zebra striping present; no truncated cells; no "—" in a column that should be populated. |
   | Adversarial regression section | One row per `*-regression.spec.ts` test that exists in the source; boundary-lock codes attached when `adversarial-findings.md` lists them; no "Unknown boundary" rows that should have been resolved upstream in Phase 2. |
   | Skipped-with-reason section | When empty: an explicit "No scenarios deferred" block, not a blank page. When non-empty: every row has a human-readable reason — no `TODO`, `tbd`, blank, or `?` reasons. Reasons grouped consistently. |
   | Every page (cross-cutting) | Page-number footer `NN / TOTAL` monotonically increasing, `TOTAL` constant across every page; brand palette consistent; no page falls back to Chromium light-mode default while neighbours stay dark; header micro-label matches the section the page belongs to. |

4. **Per-page failure handling.** If any check fails, **do NOT deliver**. Diagnose by failure pattern:

   | Symptom | Likely cause | Fix |
   |---|---|---|
   | Blank / fully white page | Slide has no `data-slide-id` so the per-slide style toggle hid every slide on that render | Add the missing `data-slide-id` in the HTML generator and re-render |
   | White background, light-mode look | `-webkit-print-color-adjust: exact; print-color-adjust: exact;` missing or overridden in CSS | Restore the declaration on `html, body, .slide` and re-render |
   | Overlapping rows / content past the page bottom | Table overflowed without pagination | Split the table in the HTML generator (one journey set per slide) and re-render |
   | Truncated / clipped text mid-cell | Row height too tight or text exceeds column width | Adjust the column width or wrap the cell in the template; re-render |
   | Stat tile shows `NaN` / `undefined` | Phase 1 extraction missed a code path or Phase 2 lookup returned null | Fix the extractor / lookup, regenerate HTML, re-render |
   | Skipped-with-reason row has blank reason | Phase 1 didn't capture a nearby comment for a `test.skip(...)` | Either add the comment to the spec, or accept the gap and surface it in the return summary — do not ship a blank-reason row |

   After fixing, re-run Phase 5 (which re-runs the page-count check) and then Phase 6 in full — partial re-inspection of only the changed pages is not sufficient because a fix can perturb pagination upstream.

5. **Return-summary obligation.** When Phase 6 passes, the skill's return summary must include the line `visual-inspection: PASS (<N> pages reviewed)`. When Phase 6 surfaces an unfixable issue (e.g., a missing journey-map entry that produced an Unmapped row that cannot be resolved without `journey-mapping` re-running), **deliver the catalogue with the issue still present AND surface it explicitly** — for example, `visual-inspection: WARN — 3 Unmapped rows in cross-cutting section, journey-map.md is stale (run journey-mapping)`. Silently shipping a known-broken page violates the catalogue's transparency contract.

6. **Hard rule.** Phase 6 runs every time, including for re-renders after a fix. There is no "I already inspected most of this last iteration" shortcut — repagination from a fix can shift content onto previously-clean pages.

#### Rationalizations to reject (Phase 6)

| Excuse | Reality |
|--------|---------|
| "I already spot-checked the cover and a mid-document table; it'll be fine" | Spot-checking is what Phase 5 does; Phase 6 is exhaustive precisely because spot-checking has shipped truncated PDFs and palette regressions in past runs. The cost of reading 30 pages is seconds; the cost of shipping a broken stakeholder deliverable is the engagement. |
| "The page-count check passed, so the PDF is fine" | The page-count check confirms the merge produced the right number of pages. It cannot detect a blank page, a palette regression, a `NaN` stat tile, or an overflowed table — those are page-content failures, not page-count failures. |
| "Re-rendering after the fix is wasteful — I'll just re-inspect the page I changed" | A fix that splits one overflowed table into two slides shifts every downstream page-number footer by one; a fix that adds a missing `data-slide-id` changes the slide ordering. Inspection has to be exhaustive on every render or the contract isn't held. |
| "The Unmapped section has rows but the user said to ship today, so I'll skip Phase 6" | Phase 6 is non-negotiable — but its outcome can be a `WARN` summary that ships the catalogue WITH the known issues surfaced, rather than a `PASS`. Skipping the inspection altogether destroys the transparency signal; running it and surfacing the warning preserves it. |
| "Reading 30 pages with the Read tool is slow" | Each `Read` call is sub-second; even a 60-page catalogue is two `Read` calls (one for `1-20`, one for `21-40`, etc.). The slow path is shipping a broken catalogue and re-issuing — measure the cost there. |

---

## Palette (default, print-tuned dark)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0A0E14` | Page background |
| `--ink` | `#E6EAF2` | Body text |
| `--ink-mute` | `#8892A6` | Subtitles, muted copy |
| `--brand` | `#00A3FF` | Primary chips, accents, underlines |
| `--accent` | `#FF7A1A` | Secondary accents, warnings |
| `--crit` | `#FF5757` | P0 chips |
| `--high` | `#FF8A3D` | P1 chips |
| `--med` | `#FFC93D` | P2 chips |
| `--low` | `#9CA3AF` | P3 chips |
| `--ok` | `#34D399` | Active-status chips |

Brand overrides:
- `brand: spritecloud` — same palette as above (this is already the default alignment).
- `brand: civitas-cerebrum` — swap `--brand` to `#3fb950`, keep `--accent` at `#58a6ff`, use `#0d1117` as `--bg`.

---

## Context discipline

This skill is a **single-run** skill. No parallel subagents. No orchestration. No MCP browser work. It reads spec files and the journey map, writes HTML + PDF, and exits.

If spec parsing produces an Unmapped bucket with > 10 tests, **warn the user** that the journey map is stale — do not try to auto-repair it. Repair belongs to the `journey-mapping` skill.

This skill does not read `autonomousMode: true`. It is never invoked by another skill's pipeline; it is only invoked directly by the user on demand.

## Registry

When PR #110 (canonical skill registry) lands, add this row to `skills/element-interactions/references/skill-registry.md`:

```
| `test-catalogue` | `test-catalogue` | — (user-invoked, on-demand) | "produce a test catalogue", "generate a scenario report", "catalogue the suite", "client-ready catalogue", "export the scenario inventory"; never auto-invoked by any other skill. |
```

The registry row is a hard dependency of this skill's discoverability — if the registry exists and this skill isn't in it, agents will reconstruct the name from memory and the case-exact invocation string will drift.

---

## Do Not

- Brag about runtime, effort, or velocity. The audience cares about coverage, not how long it took.
- Include API internals, package versions, or implementation detail the client did not ask for.
- Duplicate the `work-summary-deck` narrative. This is an inventory, not a story.
- Fabricate journey metadata. If a spec's journey is unknown, list it in Unmapped.
- Introduce screenshots without path-qualification.

### Rationalizations to reject

| Excuse | Reality |
|--------|---------|
| "The client asked how long it took, so I'll add a runtime/velocity section" | Answer the client directly in chat or in the deck narrative — the catalogue is an inventory document, not an engagement report. Velocity language in the catalogue signals "we're selling effort, not coverage" to the client's procurement team. |
| "The journey map is missing but I can infer from specs" | Stop and ask the user to run `journey-mapping` first. An inferred map makes up priority / portal / purpose data — the catalogue then ships with authoritative-looking but fabricated metadata. |
| "I'll combine the deck and the catalogue to save effort" | They are deliberately paired but distinct: deck = narrative, catalogue = inventory. Merging them produces a document that is too long to present and too abstract to audit. |
| "Light-mode for clients who print B&W" | Dark-mode is the skill's contract; adding a light-mode toggle doubles the rendering surface and the brand-palette matrix without the client having asked. If a specific engagement needs light-mode, land a branded-override row in the skill's palette table — not an ad-hoc fork at render time. |
| "PDF verification is slow / fails on corner cases — comment it out to ship" | Verification is non-negotiable. A catalogue that ships with a silently-truncated PDF is a broken deliverable to a stakeholder who cannot verify it themselves; the verification IS the guarantee. Fix the root cause (usually an HTML slide without a `data-slide-id`) rather than removing the check. |
| "The Unmapped bucket has 15 entries — I'll quietly drop them" | The Unmapped bucket is the honest signal that journey-mapping is stale. Dropping entries hides the drift from the next onboarding run and the next client. Surface it. |

---

## Example Prompts

**User says:** "produce a test catalogue for the client"
1. Parse `tests/e2e/**/*.spec.ts`.
2. Cross-reference `journey-map.md`.
3. Render `test-catalogue.html` and `test-catalogue.pdf` at repo root (per-slide render + page-count verify).
4. **Phase 6: exhaustive visual inspection** — read every page of the PDF in order, run the per-page-type checks, fix and re-render until every page passes.
5. Report headline numbers (total scenarios, journeys covered, portal breakdown, skipped count) plus the `visual-inspection:` line (PASS or WARN with surfaced issues).

**User says:** "catalogue the suite, brand: spritecloud, output: medicheck-catalogue.pdf"
1. Same flow, palette forced to spritecloud, output filename overridden.
2. Phase 6 runs unchanged.
3. Report the headline + `visual-inspection:` line.

**User says:** "scenario report including regression coverage"
1. Same flow. The adversarial-regression section is always included — it is not opt-in. Phase 6 inspects it like any other section.
