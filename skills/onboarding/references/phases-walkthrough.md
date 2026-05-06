# Onboarding Pipeline — Phases 1–7

**Status:** authoritative spec for the autonomous onboarding pipeline. Cited from `onboarding/SKILL.md`.
**Scope:** the full seven-phase pipeline (Phase 1 Scaffold, Phase 2 Groundwork discovery, Phase 3 Happy path, Phase 4 Full journey mapping, Phase 5 Coverage expansion, Phase 6 Bug hunts, Phase 7 Final summary), per-phase task lists, hard gates, and progress-output discipline.

For the front-load gate that authorises the whole pipeline, see `onboarding/SKILL.md` §"Front-load gate".
For the coverage-expansion sub-skill that Phase 5 invokes, see `../coverage-expansion/SKILL.md`.

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

- `playwright.config.ts` — scaffolded with the package's documented defaults (see `../element-interactions/references/playwright-config-defaults.md`):
  - `baseURL` from the front-load gate
  - `testDir: './tests/e2e'`
  - `reporter: 'html'`
  - `headless: true`
  - **`retries: process.env.CI ? 2 : 1`** — at least one retry by default so transient failures get a second pass that produces video evidence.
  - **`use.video: 'on-first-retry'`** — the canonical default. First-pass failures stay light; reruns capture video so failures are documented automatically.
  - **`use.trace: 'on-first-retry'`** — full Playwright trace on the same boundary; pairs with the video for diagnosis.

  Concrete starting content:

  ```typescript
  import { defineConfig } from '@playwright/test';

  export default defineConfig({
    testDir: './tests/e2e',
    reporter: 'html',
    retries: process.env.CI ? 2 : 1,
    use: {
      baseURL: '<from front-load gate>',
      headless: true,
      video: 'on-first-retry',
      trace: 'on-first-retry',
    },
  });
  ```

  Consumers may override later, but the scaffold ships these on by default. The `playwright-config-defaults-guard.sh` hook surfaces a `systemMessage` warning when a `playwright.config.ts` write strips these defaults without a documented reason.
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
- `.gitignore` — add `screenshots/failures/` so transient Playwright failure captures stay untracked, and `.playwright-cli/` so the CLI's per-run snapshot YAMLs and console buffers stay untracked. Probe-evidence screenshots in `screenshots/` root remain tracked so reviewers can open the ledger and see what the subagent saw.

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
