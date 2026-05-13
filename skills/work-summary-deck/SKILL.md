---
name: work-summary-deck
description: >
  Generate a branded HTML presentation deck that summarizes QA work done in the current project.
  Use this skill when asked to "generate a report", "export a deck", "summarize work", "create a presentation",
  "work summary", "show what we've done", "QA report", "achievement report", "progress deck", "export summary",
  or any request to produce a visual summary of test automation work. Also triggers on requests to document
  or present test coverage, test results, or QA milestones to stakeholders. This skill is optional and
  on-demand only — it never activates during test writing or debugging workflows.
---

# Work Summary Deck — QA Achievement Report Generator

Generate a branded HTML presentation deck that summarizes the test automation work done in the current project. The deck is designed to communicate QA value to stakeholders — managers, product owners, and team leads who want to understand what was built, what it covers, and what value it delivers.

The output is a single self-contained HTML file plus an auto-rendered PDF. The PDF is exported every run — no user confirmation, no manual Print > Save as PDF step.

---

## When This Skill Activates

This skill is **on-demand only**. It activates when the user asks for a report, deck, summary, or presentation of QA work. It does NOT activate during test writing, debugging, or coverage expansion — those are handled by the singularity/element-interactions skills.

---

## Data Collection

Before generating the deck, collect data from every available source in the project. Not all sources will exist in every project — use what's available and note gaps.

### Step 1: Inventory the Project

Read these sources in parallel:

| Source | Path Pattern | What to Extract |
|--------|-------------|-----------------|
| **Test files** | `tests/**/*.spec.ts`, `tests/**/*.test.ts` | Test count, scenario names, test structure |
| **Page repository** | `**/page-repository.json` | Pages covered, element count per page, platforms defined |
| **App context** | `**/app-context.md`, `tests/e2e/docs/app-context.md` | Pages discovered, features documented, known issues |
| **Git history** | `git log --oneline` | Timeline of work, commit count, contributors |
| **Test results** | `playwright-report/`, `test-results/` | Pass/fail rates, last run date |
| **Package.json** | `package.json` | Which test framework packages are installed, versions |
| **Coverage data** | Coverage reports if they exist | Line/branch/statement coverage |
| **Bug reports** | `**/bug-report.md`, `**/bug-discovery-report.md` | Bugs found, severity, reproduction status |

### Step 2: Compute Metrics

From the collected data, compute:

- **Test count** — total number of `test()` blocks across all spec files
- **Scenario count** — number of `test.describe()` blocks (logical test groups)
- **Page coverage** — number of pages in `page-repository.json` that have at least one test targeting them
- **Element count** — total elements defined in the repository
- **Platform count** — unique `platform` values in page-repository entries (web, android, ios, etc.)
- **Commit count** — number of commits related to test automation
- **Bug count** — bugs discovered (if bug-discovery was run)
- **Package versions** — versions of installed test framework packages

If a data source doesn't exist, skip that metric — don't fabricate numbers.

### Step 3: Identify the Framework

Detect which framework the project uses:

- **If `@civitas-cerebrum/singularity` or `@civitas-cerebrum/singularity-engine` is installed**: This is a Singularity project (cross-platform)
- **If `@civitas-cerebrum/element-interactions` is installed without Singularity**: This is an Element Interactions project (Playwright-only)
- **If both are installed**: Mention both, lead with Singularity

This determines the language used in the deck (e.g., "platform-agnostic" vs "Playwright-focused").

---

## Deck Structure

Generate a self-contained HTML file with these slides. Each slide should have real data from the project — not generic placeholder text.

### Required Slides

1. **Title Slide** — Project name, framework used, date
2. **Project Overview** — What app is being tested, which framework, which packages installed (with versions)
3. **Test Coverage Summary** — Key metrics: test count, page coverage, element count, platform count
4. **Pages & Scenarios** — Which pages/screens are covered, with scenario summaries
5. **Closing** — npm package badges, links to the project repository

### Optional Slides (include when data exists)

- **Architecture** — Only if the project uses Singularity (show the factory pattern layers)
- **Before/After Comparison** — If the project has conventional Playwright tests alongside Steps API tests
- **Timeline** — If git history shows a meaningful progression of work
- **Bug Discovery Results** — If bug-discovery was run and produced a report
- **Coverage Gaps** — If app-context.md lists pages/features not yet covered by tests

Aim for 5-10 slides total. Fewer is better — each slide should earn its place with real data.

---

## Styling

The deck is unbranded by default. Read the template at `assets/template.html` (relative to this skill file) for the complete CSS and HTML structure. Consumers may layer their own brand identity on top (colors, logo, wordmark) by overriding the CSS custom properties defined in the template.

### Default Color Reference

| Element | Value |
|---------|-------|
| **Background** | `#0d1117` (primary), `#161b22` (secondary), `#21262d` (cards) |
| **Text** | `#e6edf3` (bright), `#7d8590` (muted), `#484f58` (faint) |
| **Accent green** | `#3fb950` — primary accent, used for highlights, stats, badges |
| **Accent blue** | `#58a6ff` — secondary accent |
| **Accent purple** | `#bc8cff` — tertiary accent |
| **Border** | `#30363d` |
| **Font** | `Inter` via Google Fonts, fallback to system `-apple-system` stack |

### NPM Badges

Render installed package versions as badges:

```html
<span class="npm-badge">
  <span class="pkg">@civitas-cerebrum/package-name</span>
  <span class="ver">0.x.x</span>
</span>
```

### Slide Structure

Every slide follows this pattern:

```html
<section class="slide">
  <div class="brand-mark"><!-- logo + text --></div>
  <div class="slide-number">NN / NN</div>
  <h2>Slide Title</h2>
  <p class="section-subtitle">One-line description</p>
  <!-- slide content -->
</section>
```

---

## Output

The flow is non-interactive — once the HTML is written, the PDF export runs automatically. Do **not** ask the user whether to render the PDF; always render it. The user can ignore the PDF if they only want the HTML.

1. **Write the HTML file** to the project root as `qa-summary-deck.html` (or a name the user specifies).
2. **Render the PDF** by running:
   ```bash
   node node_modules/@civitas-cerebrum/element-interactions/skills/work-summary-deck/scripts/export-pdf.js qa-summary-deck.html
   ```
   The script uses the project's existing `@playwright/test` peer dependency (no extra install) to print the deck in landscape with `@page` defaults preserved. Output PDF lands next to the HTML (`qa-summary-deck.pdf`). The script prints the resolved PDF path to stdout. If the script's stdout is non-empty AND the file exists, treat the export as complete.
3. **Open the PDF** for the user — `open <pdf-path>` on macOS, `xdg-open <pdf-path>` on Linux. Open the HTML too only if the user asked for it; the PDF is the canonical deliverable.

If the script errors (e.g. no Chromium binary, no `@playwright/test`), report the failure with the exact stderr to the user — do NOT silently fall back to "open it and Print > Save as PDF". The contract for this skill is: PDF every time, automatically.

---

## Example Prompt Flows

**User says:** "generate a report of the work we've done"
1. Collect data from all sources
2. Compute metrics
3. Generate the HTML deck with project-specific content
4. Auto-export to PDF via the bundled script (no confirmation prompt)
5. Open the PDF

**User says:** "create a deck for the team standup"
1. Same flow, but keep it shorter (5-6 slides)
2. Focus on metrics and recent progress
3. PDF still auto-exported

**User says:** "export a summary with our bug findings"
1. Same flow, but emphasize the bug discovery results slide
2. Include the full bug classification table if available
3. PDF still auto-exported

---

## Constraints

- **No fabricated data.** Every number in the deck must come from an actual project source. If you can't find test results, say "test results not available" — don't invent pass rates.
- **No generic content.** Every slide must reference the actual project. Don't use placeholder app names or hypothetical scenarios.
- **Self-contained HTML.** The output file must work offline except for the Google Fonts import. All CSS is inline, all SVGs are embedded, no external dependencies.
- **Print-ready.** Include `@page { size: landscape; margin: 0; }` and `page-break-after: always` on each slide for clean PDF export.
