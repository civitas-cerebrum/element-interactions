---
name: onboarding
description: >
  Use this skill when asked to "onboard this project", "set up element-interactions",
  "start from scratch", "automate this app from zero", or any request to bring a new
  project from no test automation to a comprehensive element-interactions test suite.
  Also auto-invoked by the element-interactions orchestrator when the cascade detector
  reports a non-onboarded project state (missing framework dep, missing scaffold, or
  missing sentinel-bearing journey-map.md). Runs the full pipeline autonomously after
  a single front-load confirmation: install civitas-cerebrum + playwright deps,
  scaffold framework files, crawl the app, automate the happy path, complete the
  journey map, run five priority/depth-tiered coverage-expansion passes, run two
  bug-hunt passes, and produce a summary deck plus onboarding report. Emits periodic
  progress updates; requires no further prompts after the initial gate.
---

# Onboarding — Autonomous Project Setup

The onboarding skill brings a fresh project from zero to a comprehensive test suite. It is the orchestrator that sequences the existing element-interactions, journey-mapping, test-composer, bug-discovery, failure-diagnosis, and work-summary-deck skills behind a single user confirmation.

**Design reference:** `docs/superpowers/specs/2026-04-22-onboarding-skill-design.md`.

---

## Activation

This skill activates when:

1. The user's message matches onboarding intent ("onboard this project", "set up element-interactions", "start from scratch", "automate this app from zero").
2. The `element-interactions` orchestrator's Routing block invokes this skill after running the cascade detector.

On activation, immediately run the cascade detector (below). Do not prompt the user yet.

### Cascade detector

Run in order; stop at the first match.

| # | Check | Result | Level |
|---|---|---|---|
| 1 | Is `@civitas-cerebrum/element-interactions` listed as a dependency in `package.json`? | No | **A** — install + scaffold + pipeline |
| 2 | Are all of `playwright.config.ts`, `tests/fixtures/base.ts`, and `page-repository.json` present? | Any missing | **B** — scaffold + pipeline |
| 3 | Does `tests/e2e/docs/journey-map.md` exist **and** have `<!-- journey-mapping:generated -->` on line 1? | No | **C** — pipeline only |
| 4 | All of the above pass | Yes | **None** — exit with the re-invocation message |

Use the Read and Glob tools to check these. Do not use Bash `ls` / `cat` for the detection.

### Already-onboarded exit message

If the detector reports **None**, print this message and stop — do not run the pipeline:

> "This project is already onboarded (found `tests/e2e/docs/journey-map.md` with the journey-mapping sentinel, scaffold complete). To expand coverage further, invoke `test-composer`. To run more bug hunts, invoke `bug-discovery`. To rebuild from scratch, delete `tests/e2e/docs/journey-map.md` and re-run onboarding."

---

## Front-load gate

Exactly one user interaction, at the start. After the user confirms, no further prompts until the run completes.

Construct the gate message as follows:

```
Onboarding activated for <project name from package.json or directory basename>.

Detected: Level <A | B | C> — <one-line summary of what's missing>

Before I run, I need two things:
  1. App URL: <auto-detected from playwright.config.ts baseURL if present; otherwise
     ask the user>
  2. One-sentence description of the primary thing a user most wants to do in this
     app.

I will then, autonomously and without further prompts:
  <bullet list of phases that apply at the detected level, with the scaffolding /
   install items elided for Level C and the install item elided for Level B>
  • Full Phase-1 discovery (breadth-first crawl via Playwright MCP)
  • Automate the happy path you described (Stages 1–4 inline)
  • Full journey-mapping (Phases 2–4)
  • 5 coverage-expansion passes (priority + depth tiered)
  • 2 bug-hunt passes (element probing, then flow probing)
  • Work summary deck + onboarding-report.md

Expected runtime: tens of minutes to several hours.

Proceed? (y / describe changes)
```

Wait for the user's reply. On `y` / `yes` / `proceed` / equivalent affirmative, move to the pipeline. On any other reply, treat it as a scope change request: restate the gate with the change applied and ask again. Do not move past the gate without an explicit affirmative.

---

## Progress output

After every major milestone, emit a single line prefixed with `[onboarding]` to the terminal. Do not emit multi-line status dumps, do not paginate logs from companion skills, do not print intermediate MCP transcripts.

Examples:

```
[onboarding] Level A detected — installing civitas-cerebrum + playwright
[onboarding] Dependencies installed (3 packages)
[onboarding] Scaffolding tests/fixtures/base.ts, page-repository.json, playwright.config.ts
[onboarding] Phase 1 discovery — 12 pages visited so far…
[onboarding] Phase 1 complete — 23 pages, 4 gated
[onboarding] Journey mapping — 7 journeys identified (2 P0, 3 P1, 2 P2)
[onboarding] Happy path test written, stabilizing…
[onboarding] Happy path green — committed
[onboarding] Coverage expansion starting (mode: depth, 5 passes)
[onboarding] Coverage expansion pass 1/5 complete — 27 tests added, 3 branches discovered
[onboarding] Coverage expansion pass 2/5 complete — 14 tests added, 1 sub-journey promoted
[onboarding] Coverage expansion pass 3/5 complete — 8 tests added, cross-journey interactions covered
[onboarding] Coverage expansion pass 4/5 complete — 6 adversarial tests added, 2 edge cases surfaced
[onboarding] Coverage expansion pass 5/5 complete — 4 adversarial tests added, ledger dedup applied
[onboarding] Bug-hunt 1/2 (element probing) — 2 issues logged
[onboarding] Bug-hunt 2/2 (flow probing) — 3 issues logged
[onboarding] Generating work-summary-deck
[onboarding] Done. See onboarding-report.md.
```

---

## Pipeline

Seven phases. Each phase ends with exactly one commit. Phases are skipped when the cascade level does not require them (Level A runs all phases; Level B skips install; Level C skips install and scaffold).

### Phase 1 — Scaffold (Level A/B only)

**Owner:** onboarding (direct).

**Level A install scope:** install **only** missing packages from `@civitas-cerebrum/*` and Playwright:

- `@civitas-cerebrum/element-interactions` if missing from `dependencies`.
- `@civitas-cerebrum/element-repository` if missing.
- `@playwright/test` if missing.
- Run `npx playwright install chromium` (Chromium only; other browsers on request).

Do **not** add, remove, or upgrade any other dependencies. Do **not** modify the user's `package.json` scripts beyond adding a `test:e2e` script if one doesn't already exist.

**Scaffold files** (Level A and B, whichever are missing):

- `playwright.config.ts` — minimal config with `baseURL` from the front-load gate, `testDir: './tests/e2e'`, `reporter: 'html'`, headless true.
- `tests/fixtures/base.ts` — `baseFixture` export wiring `Steps` and `ContextStore`. Exact content: see `references/api-reference.md` from the `element-interactions` skill.
- `page-repository.json` — `{}` at the repo root (or `tests/e2e/page-repository.json`; follow existing convention if partial scaffold exists).
- `tests/e2e/` — directory created if missing.
- `tests/e2e/docs/` — directory created if missing.

**Commit:** `chore: scaffold element-interactions framework`.

### Phase 2 — Groundwork discovery

**Delegate to:** `journey-mapping` with `args: "phase-1-only"`.

The companion writes `tests/e2e/docs/app-context.md` and a sentinel-bearing `tests/e2e/docs/journey-map.md` whose body contains only the site map (Phase-2–4 sections are empty headings).

**Commit:** `docs: initial app-context and site map`.

### Phase 3 — Happy path

**Delegate to:** `element-interactions` with `args: "autonomousMode: true happyPathDescription: '<one-sentence description from the front-load gate>'"`.

The companion runs Stages 1–4 inline with gates suspended, using the description + the site map from Phase 2 to pick the target flow. Any failure routes through `failure-diagnosis` automatically.

**Commit:** `test: happy path — <scenario name>`. The orchestrator returns the scenario name in its summary; use that.

### Phase 4 — Full journey mapping

**Delegate to:** `journey-mapping` with `args: "phases-2-4"`.

The companion reads the existing sentinel-bearing Phase-1 map and fills in Phases 2–4 (flow identification, prioritisation, journey map document). File is overwritten in place; sentinel preserved.

**Commit:** `docs: journey map — <N> journeys prioritized`.

### Phase 5 — Coverage expansion (five passes, depth mode)

**Delegate to:** `coverage-expansion` with `args: "mode: depth"`.

That skill runs five journey-by-journey passes internally (3 compositional via test-composer + 2 adversarial via bug-discovery), parallelising subagent dispatch for independent journeys, picking a model per journey (sonnet/opus) by size and complexity, and reconciling map growth between passes. Onboarding's role here is simply to invoke it and relay `[coverage-expansion]` progress lines upstream — no per-pass orchestration at this layer.

Between and after the five passes, `coverage-expansion` itself refreshes its view of `app-context.md` and `journey-map.md`; onboarding does not need its own refresh step at this phase. When the skill returns, append a "Coverage expansion — new knowledge" section to `onboarding-report.md` summarising total tests added, new journeys discovered, and any sub-journeys promoted.

**The onboarding skill's Phase 5 is not satisfied by Pass 1 alone.** Do not mark Phase 5 complete in the onboarding report, in any task tracker, or in the summary deck until `coverage-expansion` returns from **all five passes + cleanup** (see that skill's §"Per-pass completion criteria"). If the orchestrator is budget-constrained mid-pipeline, it commits what it has, writes resume state per `coverage-expansion`'s state-file contract (`tests/e2e/docs/coverage-expansion-state.json`), and returns to the user with a clear "resume needed" message — it does NOT claim Phase 5 done and silently defer passes 2–5 or the ledger dedup. A Phase 5 report that reads "Pass 1 complete, 2–5 deferred for budget" is honest; a report that reads "Phase 5 complete" when only Pass 1 ran is a bug in the orchestrator's summarisation.

**Commits:** `coverage-expansion` commits once per pass (`test: coverage expansion pass <N>/5 — <summary>`). Onboarding adds no extra commit here.

**No stage may be silently skipped.** Onboarding has seven phases and each phase has its own internal stages (element-interactions has Stages 1–4; coverage-expansion has Passes 1–5 + cleanup; bug-discovery has Phases 1a and 1b). Partial-phase completion is reportable; partial-phase completion disguised as full-phase completion is a contract violation. The onboarding-report and any summary deck MUST state partial status explicitly when applicable — "Phase 5: Pass 1 complete (44/44), Pass 2 partial (3/44), Pass 3–5 pending" — not "Phase 5 complete."

### Phase 6 — Bug hunts (two passes)

Two sequential invocations of `bug-discovery`:

| Pass | `args` |
|---|---|
| 1 | `phase: 1a-element-probing` |
| 2 | `phase: 1b-flow-probing` |

Findings go to `tests/e2e/docs/onboarding-report.md` under "App bugs logged". The companion must NOT commit skipped tests for the findings; it logs them and continues.

**Phase 6 is two dedicated bug-discovery passes (element-probing 1a, flow-probing 1b) — not "the bugs we happened to find during coverage."** Organic findings from earlier phases (happy path, coverage-expansion compositional passes, coverage-expansion adversarial passes 4/5) go in the onboarding-report's "App bugs logged" section; Phase 6's two dedicated passes run **in addition to** whatever organic discovery happened in earlier phases. Repackaging organic findings as "the Phase 6 output" is a loophole — the two dedicated passes either ran or they did not. If the orchestrator skips Phase 6's passes (budget, infra halt, explicit user instruction), the onboarding-report and the summary deck MUST say `"Phase 6 deferred — <reason>"` or `"Phase 6 partial — pass 1a only"`, never `"Phase 6 complete"`. Finding count alone is not evidence that Phase 6 ran.

**Commits:** `docs: bug-hunt 1/2 findings` and `docs: bug-hunt 2/2 findings`.

### Phase 7 — Final summary

1. Invoke `work-summary-deck` to produce `qa-summary-deck.html`.
2. Finalise `tests/e2e/docs/onboarding-report.md` with the sections in the next heading.

**Commit:** `docs: onboarding report and summary deck`.

### Task-tracking granularity

Use pass-level tasks, not phase-level. A single "Phase 5" task that flips to done is a footgun — use `"Pass 1/5 compositional"`, `"Pass 2/5 compositional"`, `"Pass 3/5 compositional"`, `"Pass 4/5 adversarial"`, `"Pass 5/5 adversarial"`, `"Phase 5 cleanup"`, and a `"Phase 5 overall"` parent that only flips done when all child passes do. Same for Phase 6's two sub-passes (`"Phase 6 pass 1a element-probing"`, `"Phase 6 pass 1b flow-probing"`, `"Phase 6 overall"`). Parent tasks never flip done ahead of their children.

---

## Onboarding report (`tests/e2e/docs/onboarding-report.md`)

Accumulated throughout the run, committed at Phase 7. Structure:

```markdown
# Onboarding Report — <app name>

**Date:** YYYY-MM-DD
**Detected level:** A | B | C
**Happy path:** <user-supplied sentence>
**Runtime:** Xm Ys

## Coverage
| Priority | Journeys | Steps | Covered | % |
| P0 | <n> | <n> | <n> | <n> |
| P1 | <n> | <n> | <n> | <n> |
| P2 | <n> | <n> | <n> | <n> |
| P3 | <n> | <n> | <n> | <n> |

## Skipped tests
<list: test name + reason>

## App bugs logged
<list: short description + source phase>

## Knowledge gained per pass
Pass 1 — <3-line summary>
Pass 2 — <3-line summary>
Pass 3 — <3-line summary>
Pass 4 — <3-line summary>
Pass 5 — <3-line summary>

## Next steps
- Address app bugs listed above.
- Rerun test-composer once blockers clear.
```

---

## Failure handling

Every failure — in any phase — routes through `failure-diagnosis`. Four classifications:

| Classification | Action |
|---|---|
| Test issue | Fix autonomously, re-run. If still failing after 3 stabilization cycles, skip with a comment and log to the onboarding report. |
| App bug | Skip the test with a comment referencing the report; append the bug to `onboarding-report.md` under "App bugs logged"; continue. |
| Ambiguous | Skip + log + continue. |
| MCP / infra error | Halt. Commit what is stable. Print a clear stop reason with the last progress line. |

The only halt conditions are infra errors. The pipeline never halts on test or app failures.

---

## Re-invocation semantics

Onboarding never auto-overwrites an already-onboarded project. If the cascade detector returns **None**, it prints the already-onboarded exit message and stops. To rebuild from scratch, the user deletes `tests/e2e/docs/journey-map.md` (breaking the sentinel check) and re-invokes.

---

## Non-goals

This skill explicitly does not:

- Configure CI/CD.
- Set up test data fixtures beyond the scaffold file.
- Invoke `agents-vs-agents` (AI guardrail testing is opt-in).
- Publish to npm, push tags, or modify any git remote.
- Touch dependencies outside `@civitas-cerebrum/*` and Playwright.

If the user wants any of these, they ask for them separately after onboarding finishes.
