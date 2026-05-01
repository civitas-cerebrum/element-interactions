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

> **Skill names: see `../element-interactions/references/skill-registry.md`.** Copy skill names from the registry verbatim. Never reconstruct a skill name from memory or recase it.

The onboarding skill brings a fresh project from zero to a comprehensive test suite. It is the orchestrator that sequences the existing element-interactions, journey-mapping, test-composer, bug-discovery, failure-diagnosis, and work-summary-deck skills behind a single user confirmation.

**Design reference:** `docs/superpowers/specs/2026-04-22-onboarding-skill-design.md`.

---

## Activation

This skill activates when:

1. The user's message matches onboarding intent ("onboard this project", "set up element-interactions", "start from scratch", "automate this app from zero").
2. The `element-interactions` orchestrator's Routing block invokes this skill after running the cascade detector.

On activation, immediately run the cascade detector (below). Do not prompt the user yet.

### Cascade detector

The cascade detector is the canonical onboarding-state probe used by this skill, the `element-interactions` orchestrator's routing, and `companion-mode` Phase 6. Its full table and per-caller response matrix live in [`../element-interactions/references/cascade-detector.md`](../element-interactions/references/cascade-detector.md). Run it in order; stop at the first match. The four levels are:

- **Level A** — `@civitas-cerebrum/element-interactions` not listed in `package.json` → install + scaffold + pipeline.
- **Level B** — package present, but any of `playwright.config.ts` / `tests/fixtures/base.ts` / `page-repository.json` missing → scaffold + pipeline.
- **Level C** — scaffold complete, but `tests/e2e/docs/journey-map.md` missing OR missing `<!-- journey-mapping:generated -->` on line 1 → pipeline only.
- **Level None** — all checks pass → exit with the re-invocation message (below).

Use the Read and Glob tools to perform the checks. Do not use Bash `ls` / `cat` for the detection. If a fifth level is ever added (e.g. for a new required scaffold file), it lands in the canonical reference first; this skill must be updated to handle it before the new check ships.

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
  • Full Phase-1 discovery (breadth-first crawl via @playwright/cli)
  • Automate the happy path you described (Stages 1–4 inline)
  • Full journey-mapping (Phases 2–4)
  • 5 coverage-expansion passes (priority + depth tiered)
  • 2 bug-hunt passes (element probing, then flow probing)
  • Work summary deck + onboarding-report.md

Scope preview — projected (Phase-1 discovery has NOT yet run at gate time, so these are
pre-discovery estimates; actuals land after Phase 1 and are reported via progress lines):
  • Phase 5 depth mode: ~<N_low>–<N_high> subagent dispatches across 5 passes + cleanup
    (every journey, every pass — no skips)
  • Phase 6 bug hunts: ~<M_low>–<M_high> dispatches
  • Parallel peak: <P> agents depending on credential availability
  • Model: opus default for every Stage A and Stage B dispatch (cost-blind);
    narrow cycle-1 Stage B sonnet-confirmation exception may apply to ~<sonnet-count>
    previously-greenlit journeys (per the skill's Model selection §)
  • Expected wall-clock: ~<H1>–<H2> h active

The scope preview is informational only. The skill's contract is full coverage; the
preview exists for transparency so the user knows what they're committing to. There is
no "reduce scope to save money" prompt — if the user wants a narrower run they invoke
`mode: breadth` or ask explicitly for a priority-tier limit.

Proceed? (y / cancel)
```

Wait for the user's reply. On `y` / `yes` / `proceed` / equivalent affirmative, move to the pipeline. On `cancel` or equivalent, stop without running any phase. Do not offer a "reduce scope" option and do not treat arbitrary replies as scope-change requests — the only valid responses are `y` (proceed with full coverage) or `cancel`.

**Populating the scope preview — pre-Phase-1 estimation.** The gate renders BEFORE Phase-1 discovery, so the scope-preview numbers are projections based on signals available at gate time, not measurements. Derive each value as follows:

- `<N_low>–<N_high>` for Phase-5 dispatch count (dual-stage expanded):
  - Best case (every journey cycle-1 greenlights): `journeys_low × 2 × 5 + cleanup` to `journeys_high × 2 × 5 + cleanup` (one Stage A + one Stage B per journey per pass, 5 passes, plus cleanup subagent).
  - Realistic case (average 1.5 cycles per journey per pass): `journeys_low × 3 × 5` to `journeys_high × 3 × 5`.
  - Worst case (cycle-cap on every journey every pass): `journeys_low × 14 × 5` to `journeys_high × 14 × 5`.

  The scope preview reports the realistic band (×3/pass) and footnotes the worst-case ceiling. The best case (×2/pass) is reported as the floor — every journey gets at least one Stage A + one Stage B per pass under the no-skip contract.

  `journeys_low`/`journeys_high` is a journey-count band estimated from:
  - the user-provided happy-path description (≥1 journey per major flow named),
  - the top-level nav/link count on the app's homepage (one `playwright-cli snapshot` before the gate, counted as discovery preamble), and
  - a fallback band of 15–40 if neither signal is reliable.
- `<M_low>–<M_high>` = `journeys_low × 0.5` to `journeys_high × 0.5` (bug hunts target ~half the journey set).
- `<P>` = min(4, credential-count-per-role from Phase-0 pre-flight) unless the shared-resource audit (below) reports a parallelism cap.
- `<H1>–<H2>` = wall-clock band derived from `<N_high>` and `<N_low>` at `<P>`-way parallel.

After Phase-1 discovery completes, the orchestrator emits a progress line of the form `[onboarding] scope update: <N_actual> journeys discovered — projection was <N_low>–<N_high>, proceeding with full coverage`. It does NOT re-prompt the user — the single-gate contract is preserved. If the actual lands outside the projected band, the progress line makes that visible; the run continues regardless.

**Why projections, not measurements.** Running Phase-1 discovery before the gate would (a) violate the single-front-load-gate contract the skill promises, and (b) spend budget on an app the user may still cancel. The band acknowledges this: the user commits to full coverage within an estimated envelope, the orchestrator updates the actuals post-Phase-1, and nothing about the full-coverage contract changes if the actuals differ.

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

Rendered example of the audit block inside the gate (positive detections):

```
Shared-resource audit:
  • Single Care Manager credential → manager-portal parallelism capped at 1 until seeding resolved.
  • CSRF tokens session-bound → mandatory `test.describe.configure({ mode: 'serial' })` on mutating specs.
  • No UI delete for caregivers/locations → tenant pollution expected; API-backdoor cleanup required.
```

**If the audit finds zero constraints**, the block still renders — silently skipping it would let a user assume the audit was not attempted. Render:

```
Shared-resource audit:
  • No shared-resource constraints detected. Parallelism cap: P = <P>.
```

The audit block is never omitted from the gate. Empty-findings runs still emit the block with the no-constraints line so the audit's execution is always visible to the user.

The audit output has two downstream effects, both informational-to-the-user but load-bearing for the pipeline:

1. **Onboarding report.** The audit block is copied verbatim into `tests/e2e/docs/onboarding-report.md` under a "Shared-resource audit" heading at Phase 7.
2. **Constraint tag for later phases.** Each positive detection becomes a constraint tag attached to the run (e.g. `parallelism-capped:manager-portal=1`, `mandatory-serial:mutating-specs`, `missing-ui-delete:caregiver,location`). Phase 5's `coverage-expansion` invocation reads these tags when selecting per-pass model/dispatch caps and when deciding whether to force `mode: 'serial'` on mutating spec files. The tags do not change the full-coverage contract — they change *how* it is executed.

The audit does not introduce a new prompt. The user still only sees `y / cancel`.

---

## Progress output

After every major milestone, emit a single line prefixed with `[onboarding]` to the terminal. Do not emit multi-line status dumps, do not paginate logs from companion skills, do not print intermediate `playwright-cli` transcripts.

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
[onboarding] Coverage expansion pass 1/5 starting — 44 journeys, dual-stage A↔B
[coverage-expansion] Pass 1/5, journey j-checkout: cycle 1/7, review greenlight
[coverage-expansion] Pass 1/5, journey j-account-mfa: cycle 2/7, review greenlight (1 retry — mobile variant added)
[coverage-expansion] Pass 1/5, journey j-admin-roles: cycle 7/7, review blocked-cycle-exhausted
[onboarding] Coverage expansion pass 1/5 complete — 27 tests added, 3 branches discovered, 1 journey blocked-cycle-exhausted
[onboarding] Coverage expansion pass 2/5 complete — 14 tests added, 1 sub-journey promoted, all journeys greenlit
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
- `tests/fixtures/base.ts` — `baseFixture` export wiring `Steps` and `ContextStore`, with four `HELPER SLOT` comment markers that Stage 4a (test optimization) populates on demand. Exact starting content:

  ```typescript
  import { test as base, expect } from '@playwright/test';
  import { baseFixture } from '@civitas-cerebrum/element-interactions';

  const test = baseFixture(base, 'tests/data/page-repository.json', { timeout: 60000 });

  // Stage-4a-managed helpers. Each slot is filled in only when both gates
  // (UI-covered + API discovered) confirm during Stage 4a; otherwise the slot
  // stays as a comment.
  //
  // HELPER SLOT: resetState — populated when a reset endpoint is discovered
  //   in app-context.md's Test Infrastructure section.
  // HELPER SLOT: setAuthCookie — populated when login/signup is UI-covered AND
  //   POST /api/auth/login is discovered.
  // HELPER SLOT: seedCart, createListingViaApi, etc. — populated per the
  //   shortcut list in references/test-optimization.md when both gates apply.
  // HELPER SLOT: dismissBanners — populated when Phase 1 discovery flagged a
  //   persistent banner/modal in Test Infrastructure.

  // HELPER SLOT: beforeEach — Stage 4a inserts test.beforeEach hooks here to
  //   wire fixture-level helpers (dismissBanners, fixture-level resetState if
  //   the project chooses fixture-level reset, etc.) into the test lifecycle.
  //   The slot is additive across protocol runs — append, do not overwrite.
  //   Per-test setup belongs in the spec, not in this slot.

  export { test, expect };
  ```

  The `HELPER SLOT` comments are a contract: Stage 4a replaces them with code, never editing arbitrary regions of the file. Full helper templates: see `../element-interactions/references/test-optimization.md` §1, §4, §5.
- `page-repository.json` — `{}` at the repo root (or `tests/e2e/page-repository.json`; follow existing convention if partial scaffold exists).
- `tests/e2e/` — directory created if missing.
- `tests/e2e/docs/` — directory created if missing.
- `screenshots/` — directory created at the repo root if missing. All screenshot artifacts produced during the run (probe evidence, adversarial captures, failure snapshots) must be written here — never to the repo root, never with bare basenames.
- `.gitignore` — add `screenshots/failures/` so transient Playwright failure captures stay untracked. Probe-evidence screenshots in `screenshots/` root remain tracked so reviewers can open the ledger and see what the subagent saw.

**Screenshot-path contract for dispatched subagents.** Every subagent brief this skill writes — Phase-3 happy-path agent, Phase-5 `coverage-expansion` subagents, Phase-6 `bug-discovery` subagents — must restate the following rule verbatim:

> All screenshot artifacts write to `screenshots/<descriptive-name>.png`. Never bare basenames. This applies to `playwright-cli screenshot --filename=<path>`, Playwright `page.screenshot({ path: ... })`, and any ledger reference citing a screenshot as evidence. Playwright failure screenshots write to `screenshots/failures/<test-name>-<timestamp>.png` (gitignored).

This is a pure-hygiene rule enforced at the skill-brief level — bare-basename screenshots litter the repo root and break ledger references whose resolution depends on Node's CWD.

**Brief-validation check before dispatch.** Before the orchestrator sends any Phase-3/5/6 subagent brief, it must grep the brief for `screenshots/` and for the bare-basename ban string above. A brief that omits the rule is malformed — the orchestrator regenerates it before dispatching rather than sending a brief that lets the subagent pick its own path convention. This is a one-line self-check, not a new review stage.

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

That skill runs five journey-by-journey passes internally (3 compositional via test-composer + 2 adversarial via bug-discovery), each pass split per-journey into Stage A (compose/probe) + Stage B (fresh staff-QA reviewer with its own isolated `playwright-cli` session) running an A↔B retry loop up to 7 cycles per journey per pass. Subagent dispatch is opus-default (cost-blind), parallelised for independent journeys, with map growth reconciled between passes. Onboarding's role here is simply to invoke it and relay `[coverage-expansion]` progress lines upstream — no per-pass or per-cycle orchestration at this layer.

Between and after the five passes, `coverage-expansion` itself refreshes its view of `app-context.md` and `journey-map.md`; onboarding does not need its own refresh step at this phase. When the skill returns, append a "Coverage expansion — new knowledge" section to `onboarding-report.md` summarising total tests added, new journeys discovered, and any sub-journeys promoted.

**The onboarding skill's Phase 5 is not satisfied by Pass 1 alone.** Do not mark Phase 5 complete in the onboarding report, in any task tracker, or in the summary deck until `coverage-expansion` returns from **all five passes + cleanup** (see that skill's §"Per-pass completion criteria"). If the orchestrator is budget-constrained mid-pipeline, it commits what it has, writes resume state per `coverage-expansion`'s state-file contract (`tests/e2e/docs/coverage-expansion-state.json`), and returns to the user with a clear "resume needed" message — it does NOT claim Phase 5 done and silently defer passes 2–5 or the ledger dedup. A Phase 5 report that reads "Pass 1 complete, 2–5 deferred for budget" is honest; a report that reads "Phase 5 complete" when only Pass 1 ran is a bug in the orchestrator's summarisation.

**Commits:** `coverage-expansion` commits once per pass (`test: coverage expansion pass <N>/5 — <summary>`). Onboarding adds no extra commit here.

**No stage may be silently skipped.** Onboarding has seven phases and each phase has its own internal stages (element-interactions has Stages 1–4; coverage-expansion has Passes 1–5 + cleanup; bug-discovery has Phases 1a and 1b). Partial-phase completion is reportable; partial-phase completion disguised as full-phase completion is a contract violation. The onboarding-report and any summary deck MUST state partial status explicitly when applicable — "Phase 5: Pass 1 complete (44/44), Pass 2 partial (3/44), Pass 3–5 pending" — not "Phase 5 complete."

**Dual-stage completion extension.** Phase 5 is complete only when every journey has a terminal `review_status` (`greenlight`, `blocked-cycle-stalled`, `blocked-cycle-exhausted`, or `blocked-dispatch-failure`) for every pass, not only when every journey has returned from Stage A. A pass where every journey's Stage A ran but some journeys have no `review_status` field in the state file is **incomplete**, per the extended no-skip contract. The onboarding-report's Phase-5 section must surface blocked-review-cycle and blocked-dispatch-failure journeys explicitly: `"Phase 5: Pass N/5 complete (44/44), 3 journeys blocked-cycle-stalled with unresolved review findings, 1 journey blocked-dispatch-failure (see state file for details)"`.

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
| `playwright-cli` / infra error | Halt. Commit what is stable. Print a clear stop reason with the last progress line. |

The only halt conditions are infra errors. The pipeline never halts on test or app failures.

### CLI call duration discipline

With `@playwright/cli` invoked from the Bash tool, the relevant time bound is the Bash tool's per-call timeout (default 2min, max 10min) — there is no MCP watchdog and no 600s silent-kill behaviour. Subagents driving long-running probes (Phase-3 happy-path stabilization, Phase-5 adversarial passes, Phase-6 bug-hunts) just need to keep each individual CLI call short enough to fit comfortably within the Bash timeout.

Skill-level guidance, included verbatim in every subagent brief that drives `@playwright/cli`:

> Issue one CLI command per Bash call. Do not chain more than a few commands per call (`-s=<name> open`, then `goto`, then `snapshot` is fine; a 50-page crawl in one Bash call is not). If a single command will plausibly take longer than ~90s (e.g. a `goto` against a slow staging environment, a long `tracing-stop` flush), pass `timeout: 180000` or higher to the Bash call explicitly. Do not run `playwright-cli show` (the interactive dashboard) or `playwright-cli pause-at` from a non-interactive subagent — those block on user input.

This is skill-level guidance, not a config knob. The CLI's `--raw` and `--json` modes both flush on completion; there is no streaming-keepalive concern.

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
