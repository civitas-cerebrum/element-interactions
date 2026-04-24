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

Scope preview — based on the journey count discovered in Phase-1, this run will dispatch:
  • Phase 5 depth mode: ~<N> subagent dispatches across 5 passes + cleanup
    (every journey, every pass — no skips)
  • Phase 6 bug hunts: ~<M> dispatches
  • Parallel peak: <P> agents depending on credential availability
  • Model mix: sonnet for P2/P3 journeys with ≤8 steps; opus for P0/P1 and
    complex journeys (per the skill's dispatch heuristic)
  • Expected wall-clock: ~<H1>–<H2> h active

The scope preview is informational only. The skill's contract is full coverage; the
preview exists for transparency so the user knows what they're committing to. There is
no "reduce scope to save money" prompt — if the user wants a narrower run they invoke
`mode: breadth` or ask explicitly for a priority-tier limit.

Proceed? (y / cancel)
```

Wait for the user's reply. On `y` / `yes` / `proceed` / equivalent affirmative, move to the pipeline. On `cancel` or equivalent, stop without running any phase. Do not offer a "reduce scope" option and do not treat arbitrary replies as scope-change requests — the only valid responses are `y` (proceed with full coverage) or `cancel`.

**Populating the scope preview.** Derive the numbers from Phase-1 discovery before rendering the gate:

- `<N>` = journey count from Phase-1 × 5 (passes) + cleanup-pass estimate.
- `<M>` = ~1 dispatch per P0/P1 journey for bug-hunt passes 1a and 1b combined.
- `<P>` = min(4, credential-count-per-role) unless the shared-resource audit (below) reports a parallelism cap.
- `<H1>–<H2>` = wall-clock band derived from `<N>` at `<P>`-way parallel.

These are projections, not commitments. The skill proceeds at full coverage regardless of whether the actuals land at the low or high end of the band.

### Shared-resource audit

Before the user confirms the gate, the orchestrator runs a shared-resource audit against the target app and renders the findings as an additional informational block inside the gate message. The audit's job is not to block the run — it makes contention constraints **visible before** they become mid-pass flakiness.

Run the checklist below and, for each row with a positive detection, emit a one-line constraint into the gate's "Shared-resource audit" block.

| Constraint | Detection | Mitigation the user should consider |
|---|---|---|
| Single credential per role (OAuth or form) | Phase-0 credential count ≤ 1 per role | Pre-seed 3+ throwaway accounts per parallel-eligible role |
| Global rate limits (per-IP or per-tenant) | Probe login endpoint for 429 behaviour | Confirm rate-limit ceiling vs. planned parallel-dispatch peak |
| CSRF tokens tied to session (concurrent POSTs fail) | Static scan of form handlers for `csrf` / `antiforgery` patterns | File-level serial on mutating specs + throwaway accounts per worker |
| Shared tenant/workspace state | Single-tenant app with no per-user partition | Throwaway tenant for the run, or mandatory teardown hooks |
| No UI delete for created entities | Static scan for `Delete`/`Verwijder` action absence on add-* pages | API-backdoor cleanup helper |

Rendered example of the audit block inside the gate:

```
Shared-resource audit:
  • Single Care Manager credential → manager-portal parallelism capped at 1 until seeding resolved.
  • CSRF tokens session-bound → mandatory `test.describe.configure({ mode: 'serial' })` on mutating specs.
  • No UI delete for caregivers/locations → tenant pollution expected; API-backdoor cleanup required.
```

The audit output has two downstream effects, both informational-to-the-user but load-bearing for the pipeline:

1. **Onboarding report.** The audit block is copied verbatim into `tests/e2e/docs/onboarding-report.md` under a "Shared-resource audit" heading at Phase 7.
2. **Constraint tag for later phases.** Each positive detection becomes a constraint tag attached to the run (e.g. `parallelism-capped:manager-portal=1`, `mandatory-serial:mutating-specs`, `missing-ui-delete:caregiver,location`). Phase 5's `coverage-expansion` invocation reads these tags when selecting per-pass model/dispatch caps and when deciding whether to force `mode: 'serial'` on mutating spec files. The tags do not change the full-coverage contract — they change *how* it is executed.

The audit does not introduce a new prompt. The user still only sees `y / cancel`.

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
- `screenshots/` — directory created at the repo root if missing. All screenshot artifacts produced during the run (probe evidence, adversarial captures, failure snapshots) must be written here — never to the repo root, never with bare basenames.
- `.gitignore` — add `screenshots/failures/` so transient Playwright failure captures stay untracked. Probe-evidence screenshots in `screenshots/` root remain tracked so reviewers can open the ledger and see what the subagent saw.

**Screenshot-path contract for dispatched subagents.** Every subagent brief this skill writes — Phase-3 happy-path agent, Phase-5 `coverage-expansion` subagents, Phase-6 `bug-discovery` subagents — must restate the following rule verbatim:

> All screenshot artifacts write to `screenshots/<descriptive-name>.png`. Never bare basenames. This applies to MCP `browser_take_screenshot({ filename: ... })`, Playwright `page.screenshot({ path: ... })`, and any ledger reference citing a screenshot as evidence. Playwright failure screenshots write to `screenshots/failures/<test-name>-<timestamp>.png` (gitignored).

This is a pure-hygiene rule enforced at the skill-brief level — bare-basename screenshots litter the repo root and break ledger references whose resolution depends on Node's CWD.

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

**Commits:** `coverage-expansion` commits once per pass (`test: coverage expansion pass <N>/5 — <summary>`). Onboarding adds no extra commit here.

### Phase 6 — Bug hunts (two passes)

Two sequential invocations of `bug-discovery`:

| Pass | `args` |
|---|---|
| 1 | `phase: 1a-element-probing` |
| 2 | `phase: 1b-flow-probing` |

Findings go to `tests/e2e/docs/onboarding-report.md` under "App bugs logged". The companion must NOT commit skipped tests for the findings; it logs them and continues.

**Commits:** `docs: bug-hunt 1/2 findings` and `docs: bug-hunt 2/2 findings`.

### Phase 7 — Final summary

1. Invoke `work-summary-deck` to produce `qa-summary-deck.html`.
2. Finalise `tests/e2e/docs/onboarding-report.md` with the sections in the next heading.

**Commit:** `docs: onboarding report and summary deck`.

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

### MCP watchdog heartbeat

Subagents driving long-running MCP probes (Phase-3 happy-path stabilization, Phase-5 adversarial passes, Phase-6 bug-hunts, Phase-7 deck generation) risk tripping the MCP watchdog's 600s no-output kill when a single tool call stalls or when analysis between calls runs long. A 10-minute stall loses all in-flight progress and forces a fresh dispatch with a narrower brief.

Skill-level guidance, included verbatim in every subagent brief that uses MCP:

> When the MCP has not produced output for ~120s, emit a heartbeat step — a trivial `browser_snapshot` or `browser_evaluate(() => Date.now())` — before continuing the main probe. This keeps the watchdog awake and prevents the silent 600s kill. The heartbeat is not a checkpoint and is not persisted to the ledger; its only purpose is to reset the watchdog clock.

This is skill-level guidance, not a config knob. No flag to toggle, no threshold to tune — subagents emit the heartbeat when they notice the 120s window closing, and the orchestrator does not need to track it.

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
