---
name: work-summary-deck
description: >
  Generate a branded Civitas Cerebrum HTML presentation deck that summarizes QA work done in the current project.
  Use this skill when asked to "generate a report", "export a deck", "summarize work", "create a presentation",
  "work summary", "show what we've done", "QA report", "achievement report", "progress deck", "export summary",
  or any request to produce a visual summary of test automation work. Also triggers on requests to document
  or present test coverage, test results, or QA milestones to stakeholders. This skill is optional and
  on-demand only — it never activates during test writing or debugging workflows.
---

# Work Summary Deck — QA Achievement Report Generator

Generate a branded HTML presentation deck that summarizes the test automation work done in the current project. The deck is designed to communicate QA value to stakeholders — managers, product owners, and team leads who want to understand what was built, what it covers, and what value it delivers.

The output is a single self-contained HTML file that can be opened in any browser and exported to PDF via Print > Save as PDF.

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
| **Package.json** | `package.json` | Which @civitas-cerebrum packages are installed, versions |
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
- **Package versions** — versions of installed @civitas-cerebrum packages

If a data source doesn't exist, skip that metric — don't fabricate numbers.

### Step 3: Identify the Framework

Detect which framework the project uses:

- **If `@civitas-cerebrum/singularity` or `@civitas-cerebrum/singularity-engine` is installed**: This is a Singularity project (cross-platform)
- **If `@civitas-cerebrum/element-interactions` is installed without singularity**: This is an Element Interactions project (Playwright-only)
- **If both are installed**: Mention both, lead with Singularity

This determines the language used in the deck (e.g., "platform-agnostic" vs "Playwright-focused").

---

## Deck Structure

Generate a self-contained HTML file with these slides. Each slide should have real data from the project — not generic placeholder text.

### Required Slides

1. **Title Slide** — Project name, framework used, date, Civitas Cerebrum branding
2. **Project Overview** — What app is being tested, which framework, which packages installed (with versions)
3. **Test Coverage Summary** — Key metrics: test count, page coverage, element count, platform count
4. **Pages & Scenarios** — Which pages/screens are covered, with scenario summaries
5. **Closing** — npm package badges, links to civitas-cerebrum GitHub

### Optional Slides (include when data exists)

- **Architecture** — Only if the project uses Singularity (show the factory pattern layers)
- **Before/After Comparison** — If the project has conventional Playwright tests alongside Steps API tests
- **Timeline** — If git history shows a meaningful progression of work
- **Bug Discovery Results** — If bug-discovery was run and produced a report
- **Coverage Gaps** — If app-context.md lists pages/features not yet covered by tests

Aim for 5-10 slides total. Fewer is better — each slide should earn its place with real data.

---

## Branding

The deck MUST use Civitas Cerebrum's visual identity. Read the template at `assets/template.html` (relative to this skill file) for the complete CSS and HTML structure.

### Brand Reference

| Element | Value |
|---------|-------|
| **Background** | `#0d1117` (primary), `#161b22` (secondary), `#21262d` (cards) |
| **Text** | `#e6edf3` (bright), `#7d8590` (muted), `#484f58` (faint) |
| **Accent green** | `#3fb950` — primary brand color, used for highlights, stats, badges |
| **Accent blue** | `#58a6ff` — secondary accent |
| **Accent purple** | `#bc8cff` — tertiary accent |
| **Border** | `#30363d` |
| **Font** | `Inter` via Google Fonts, fallback to system `-apple-system` stack |
| **Logo** | Two interlocking circle rings — white (#e6edf3) and green (#3fb950) — representing the two C's of Civitas Cerebrum |

### Logo SVG

Use this SVG for the logo on every slide:

```svg
<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="85" cy="100" r="50" fill="none" stroke="#e6edf3" stroke-width="4"/>
  <circle cx="115" cy="100" r="50" fill="none" stroke="#3fb950" stroke-width="4"/>
</svg>
```

For the brand mark (top-left of each slide), use the rings at 28x28px alongside "CIVITAS CEREBRUM" in 12px uppercase with letter-spacing 3px.

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

1. **Write the HTML file** to the project root as `qa-summary-deck.html` (or a name the user specifies)
2. **Open it in the browser** using `open <path>` (macOS) or `xdg-open <path>` (Linux)
3. **Tell the user** how to export to PDF: Print > Save as PDF, landscape mode. The CSS includes `@page` rules for clean page breaks.

---

## Example Prompt Flows

**User says:** "generate a report of the work we've done"
1. Collect data from all sources
2. Compute metrics
3. Generate the deck with project-specific content
4. Open in browser

**User says:** "create a deck for the team standup"
1. Same flow, but keep it shorter (5-6 slides)
2. Focus on metrics and recent progress

**User says:** "export a summary with our bug findings"
1. Same flow, but emphasize the bug discovery results slide
2. Include the full bug classification table if available

---

## Constraints

- **No fabricated data.** Every number in the deck must come from an actual project source. If you can't find test results, say "test results not available" — don't invent pass rates.
- **No generic content.** Every slide must reference the actual project. Don't use placeholder app names or hypothetical scenarios.
- **Self-contained HTML.** The output file must work offline except for the Google Fonts import. All CSS is inline, all SVGs are embedded, no external dependencies.
- **Print-ready.** Include `@page { size: landscape; margin: 0; }` and `page-break-after: always` on each slide for clean PDF export.
