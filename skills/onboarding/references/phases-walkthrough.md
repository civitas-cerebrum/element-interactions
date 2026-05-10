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
- `.gitignore` — add `screenshots/failures/` so transient Playwright failure captures stay untracked, `.playwright-cli/` so the CLI's per-run snapshot YAMLs and console buffers stay untracked, `tests/e2e/docs/.phase4-cycle-state.json` (Phase-4 cycle ledger consumed by phase-validator-4 and discarded after the run), `tests/e2e/docs/.phase4-cycle-state.json.lockdir` (mkdir-based file lock; should never be committed), and `tests/e2e/docs/.phase4-concurrency-log.jsonl` (race-only signaling channel between parallel cycle agents; transient). Probe-evidence screenshots in `screenshots/` root remain tracked so reviewers can open the ledger and see what the subagent saw. **Note:** `tests/e2e/docs/.discovery-draft.json` IS committed (durable artifact) — it lets a project re-run `journey-mapping` standalone with `phases-2-4` mode without first re-running the happy-path step. The draft is regenerated each Phase-3 run; committing the latest version is cheap (~2KB) and keeps the audit trail intact.

**Screenshot-path contract for dispatched subagents.** Every subagent brief this skill writes — Phase-3 happy-path agent, Phase-5 `coverage-expansion` subagents, Phase-6 `bug-discovery` subagents — must restate the following rule verbatim:

> All screenshot artifacts write to `screenshots/<descriptive-name>.png`. Never bare basenames. This applies to `playwright-cli screenshot --filename=<path>`, Playwright `page.screenshot({ path: ... })`, and any ledger reference citing a screenshot as evidence. Playwright failure screenshots write to `screenshots/failures/<test-name>-<timestamp>.png` (gitignored).

This is a pure-hygiene rule enforced at the skill-brief level — bare-basename screenshots litter the repo root and break ledger references whose resolution depends on Node's CWD.

**Brief-validation check before dispatch.** Before the orchestrator sends any Phase-3/5/6 subagent brief, it must grep the brief for `screenshots/` and for the bare-basename ban string above. A brief that omits the rule is malformed — the orchestrator regenerates it before dispatching rather than sending a brief that lets the subagent pick its own path convention. This is a one-line self-check, not a new review stage.

**Mandatory Phase-1 deliverables:**

- `playwright.config.ts` at repo root with the canonical defaults documented above (baseURL from front-load gate, retries, video/trace on-first-retry).
- `tests/fixtures/base.ts` containing the canonical `baseFixture` wiring AND all four `HELPER SLOT` markers AND the `HELPER SLOT: beforeEach` slot.
- `page-repository.json` at repo root (or under `tests/e2e/`, following partial-scaffold convention if any exists) initialised to `{}`.
- `tests/e2e/`, `tests/e2e/docs/`, and `screenshots/` directories created.
- `.gitignore` updated with the per-run transient paths listed above (`screenshots/failures/`, `.playwright-cli/`, the `.phase4-cycle-state.json*` family).
- For Level A: the three required deps installed (`@civitas-cerebrum/element-interactions`, `@civitas-cerebrum/element-repository`, `@playwright/test`) plus `npx playwright install chromium`.

These are the artifacts the `phase-validator-1` workflow (`phase-validator-workflow.md` §3 row 1) verifies before greenlighting. A scaffold that produces only some of them is incomplete — Phase 1 is not complete until every line above is on disk.

**Commit:** `chore: scaffold element-interactions framework`.

### Phase 2 — Groundwork discovery

**Delegate to:** `journey-mapping` with `args: "phase-1-only"`.

The companion writes `tests/e2e/docs/app-context.md` and a sentinel-bearing `tests/e2e/docs/journey-map.md` whose body contains only the site map (Phase-2–4 sections are empty headings).

**Mandatory Phase-2 deliverables:**

- `tests/e2e/docs/app-context.md` with at minimum the `## Test Infrastructure` section populated (reset/seed endpoints probe — entry exists even if "none discovered"; mutation endpoints section non-empty or explicit "none observed during crawl").
- `tests/e2e/docs/journey-map.md` whose **line 1** is `<!-- journey-mapping:generated -->` (the sentinel) and whose body contains the breadth-first-crawl site map. Phase-2/3/3.5/4 sections are headings only at this point — they are filled in by Phase 4's iterative cycles, not Phase 2.
- The Phase-2 commit (`docs: initial app-context and site map`) lands.

`phase-validator-2` (`phase-validator-workflow.md` §3 row 2) verifies these. Missing sentinel, empty Test-Infrastructure section, or absent commit → improvements-needed with surgical `pv-2-NN` findings.

**Commit:** `docs: initial app-context and site map`.

### Phase 3 — Happy path

**Delegate to:** `element-interactions` with `args: "autonomousMode: true happyPathDescription: '<one-sentence description from the front-load gate>'"`.

The companion runs Stages 1–4 inline with gates suspended, using the description + the site map from Phase 2 to pick the target flow. Any failure routes through `failure-diagnosis` automatically.

**Mandatory Phase-3 deliverables (autonomous mode):**

- `tests/e2e/<scenario>.spec.ts` — the spec.
- `page-repository.json` entries for elements touched.
- **`tests/e2e/docs/.discovery-draft.json`** — structured discovery output that captures every page Stage 2/3 visited, every link observed (visited + unvisited-but-linked), section inferences, and credentials policy. Schema and sentinel rules in `../element-interactions/references/autonomous-mode-callers.md` §"Mandatory output for `onboarding` Phase 3 — discovery draft". The file is **committed** (durable artifact, ~2KB JSON) — it lets a project re-run `journey-mapping` standalone with `phases-2-4` mode without first re-running the happy-path step. An empty draft is a contract violation, not a degenerate case; the orchestrator returns `{ status: 'failed', error: 'discovery-draft-empty' }` rather than writing one.

**Commit:** `test: happy path — <scenario name>`. The orchestrator returns the scenario name in its summary; use that.

### Phase 4 — Full journey mapping (iterative cycles)

**Delegate to:** `journey-mapping` with `args: "phases-2-4"`.

The companion reads the existing sentinel-bearing Phase-1 map AND the Phase-3 discovery draft (`tests/e2e/docs/.discovery-draft.json`). Phases 2 / 3 / 3.5 run as **3 to 5 iterative cycles of parallel section-agents** driven by `tests/e2e/docs/.phase4-cycle-state.json`. Per-cycle dedup terminates the loop when no new sections appear; the loop is bounded at 5 cycles regardless. After cycles converge, a single `phase4-prioritise-author:` subagent applies Phase 3 prioritisation + Phase 3.5 redundancy revision + Phase 4 authoring, overwriting `journey-map.md` in place (sentinel preserved). Full protocol in `../journey-mapping/SKILL.md` §"Iterative discovery cycles".

The single-subagent sequential walkthrough is forbidden in `phases-2-4` mode — `journey-mapping`'s kernel rule and the `journey-mapping-cycle-gate.sh` hook both reject it. Gated areas the cycle agents cannot self-credential into are recorded under `## Gated Areas (Not Mapped)` for `coverage-expansion` to handle later (when the user supplies credentials).

**Mandatory Phase-4 deliverables:**

- `tests/e2e/docs/journey-map.md` rewritten in place (sentinel preserved on line 1) with: (a) coverage-checkpoint signature present (Phase-5 marker), (b) non-empty roster matching discovered journeys, (c) sub-journey cross-references intact (no orphans, no undefined `sj-<slug>` refs, every `Used by:` reciprocal of every `Sub-journey refs:`), (d) `## Section → Journey Map` table well-formed with every returned section either named or under `## Gated Areas (Not Mapped)`, (e) frontmatter `**Mapping completeness:**` line consistent with the cycle state file's `convergence-status`.
- `tests/e2e/docs/.phase4-cycle-state.json` with `convergence-status` ∈ {`converged`, `hard-cap-reached`}; ≥2 cycles ran; at least one cycle has `kind: "edge-probe"`; ≤5 cycles (or ≤10 with the extended-cycles authorisation sentinel); cycles contiguous 1..N; each cycle's `dispatched-sections[]` length matches `returned-sections[]`; `author-dispatched: true`; `author-attempts ≤ 3`.
- No structural-smell anti-patterns in any journey block (per `phase-validator-workflow.md` §3 row 4(i)).
- The Phase-4 commit (`docs: journey map — <N> journeys prioritized`) lands.

`phase-validator-4` (`phase-validator-workflow.md` §3 row 4) verifies these. Each unmet criterion produces a surgical `pv-4-NN` finding with `criterion: / issue: / fix:` text the orchestrator must quote verbatim in any re-dispatch.

**Commit:** `docs: journey map — <N> journeys prioritized`.

### Phase 5 — Coverage expansion (five passes, depth mode)

**Delegate to:** `coverage-expansion` with `args: "mode: depth"`.

That skill runs five journey-by-journey passes internally (3 compositional via test-composer + 2 adversarial via bug-discovery), each pass split per-journey into Stage A (compose/probe) + Stage B (fresh staff-QA reviewer with its own isolated `playwright-cli` session) running an A↔B retry loop up to 7 cycles per journey per pass. Subagent dispatch follows the hybrid model policy per `coverage-expansion/SKILL.md` §"Hybrid model selection" — Pass 1, Pass 4, and Pass 5 on Opus end-to-end (foundation + adversarial probes + regression layer), Pass 2/3 re-pass composers on Sonnet, all Stage B review and synthesis on Opus — parallelised for independent journeys, with map growth reconciled between passes. Onboarding's role here is simply to invoke it and relay `[coverage-expansion]` progress lines upstream — no per-pass or per-cycle orchestration at this layer.

Between and after the five passes, `coverage-expansion` itself refreshes its view of `app-context.md` and `journey-map.md`; onboarding does not need its own refresh step at this phase. When the skill returns, append a "Coverage expansion — new knowledge" section to `onboarding-report.md` summarising total tests added, new journeys discovered, and any sub-journeys promoted.

**The onboarding skill's Phase 5 is not satisfied by Pass 1 alone.** Do not mark Phase 5 complete in the onboarding report, in any task tracker, or in the summary deck until `coverage-expansion` returns from **all five passes + cleanup** (see that skill's §"Per-pass completion criteria"). If the orchestrator is budget-constrained mid-pipeline, it commits what it has, writes resume state per `coverage-expansion`'s state-file contract (`tests/e2e/docs/coverage-expansion-state.json`), and returns to the user with a clear "resume needed" message — it does NOT claim Phase 5 done and silently defer passes 2–5 or the ledger dedup. A Phase 5 report that reads "Pass 1 complete, 2–5 deferred for budget" is honest; a report that reads "Phase 5 complete" when only Pass 1 ran is a bug in the orchestrator's summarisation.

**Commits:** `coverage-expansion` commits once per pass (`test: coverage expansion pass <N>/5 — <summary>`). Onboarding adds no extra commit here.

**No stage may be silently skipped.** Onboarding has seven phases and each phase has its own internal stages (element-interactions has Stages 1–4; coverage-expansion has Passes 1–5 + cleanup; bug-discovery has Phases 1a and 1b). Partial-phase completion is reportable; partial-phase completion disguised as full-phase completion is a contract violation. The onboarding-report and any summary deck MUST state partial status explicitly when applicable — "Phase 5: Pass 1 complete (44/44), Pass 2 partial (3/44), Pass 3–5 pending" — not "Phase 5 complete."

**Dual-stage completion extension.** Phase 5 is complete only when every journey has a terminal `review_status` (`greenlight`, `blocked-cycle-stalled`, `blocked-cycle-exhausted`, or `blocked-dispatch-failure`) for every pass, not only when every journey has returned from Stage A. A pass where every journey's Stage A ran but some journeys have no `review_status` field in the state file is **incomplete**, per the extended no-skip contract. The onboarding-report's Phase-5 section must surface blocked-review-cycle and blocked-dispatch-failure journeys explicitly: `"Phase 5: Pass N/5 complete (44/44), 3 journeys blocked-cycle-stalled with unresolved review findings, 1 journey blocked-dispatch-failure (see state file for details)"`.

**Mandatory Phase-5 deliverables:**

- `tests/e2e/docs/coverage-expansion-state.json` with top-level `status: "complete"`. Any other status (`in-progress`, `mid-pass`, missing field) means Phase 5 has NOT delivered.
- Every journey in the roster has a terminal `review_status` for every pass 1–5 (greenlight / blocked-cycle-stalled / blocked-cycle-exhausted / blocked-dispatch-failure) — Stage-A-only is insufficient.
- `tests/e2e/docs/adversarial-findings.md` exists with both Pass-4 and Pass-5 sections per journey.
- All five per-pass commits landed (`test: coverage expansion pass <N>/5 — <summary>`).
- Cleanup commit (`docs(ledger): dedupe cross-cutting findings`) landed.
- "Coverage expansion — new knowledge" section appended to `onboarding-report.md`.

`phase-validator-5` (`phase-validator-workflow.md` §3 row 5) verifies these. The most common partial-delivery pattern is "Pass 1 complete, deferred 2–5 for budget" — that is honest reporting (commit what landed, write resume state), but it is NOT a Phase-5 greenlight. The validator returns `improvements-needed` with `pv-5-NN` findings naming the missing passes; the orchestrator's recovery is to re-invoke `coverage-expansion` with `mode: depth` (the state file's resume marker picks up at the missing pass).

### Phase 6 — Bug hunts (two passes)

Two sequential invocations of `bug-discovery`:

| Pass | `args` |
|---|---|
| 1 | `phase: 1a-element-probing` |
| 2 | `phase: 1b-flow-probing` |

Findings go to `tests/e2e/docs/onboarding-report.md` under "App bugs logged". The companion must NOT commit skipped tests for the findings; it logs them and continues.

**Phase 6 is two dedicated bug-discovery passes (element-probing 1a, flow-probing 1b) — not "the bugs we happened to find during coverage."** Organic findings from earlier phases (happy path, coverage-expansion compositional passes, coverage-expansion adversarial passes 4/5) go in the onboarding-report's "App bugs logged" section; Phase 6's two dedicated passes run **in addition to** whatever organic discovery happened in earlier phases. Repackaging organic findings as "the Phase 6 output" is a loophole — the two dedicated passes either ran or they did not. If the orchestrator skips Phase 6's passes (budget, infra halt, explicit user instruction), the onboarding-report and the summary deck MUST say `"Phase 6 deferred — <reason>"` or `"Phase 6 partial — pass 1a only"`, never `"Phase 6 complete"`. Finding count alone is not evidence that Phase 6 ran.

**Mandatory Phase-6 deliverables:**

- Both probing passes ran — `bug-discovery args="phase: 1a-element-probing"` AND `bug-discovery args="phase: 1b-flow-probing"`. One pass alone does not satisfy Phase 6.
- Findings appended to `tests/e2e/docs/onboarding-report.md` "App bugs logged" section (or to `tests/e2e/docs/adversarial-findings.md` if that is the canonical ledger location, per the bug-discovery skill's contract).
- Both Phase-6 commits landed: `docs: bug-hunt 1/2 findings` AND `docs: bug-hunt 2/2 findings`.

`phase-validator-6` (`phase-validator-workflow.md` §3 row 6) verifies the dedicated-pass contract. A partial Phase 6 (only 1a ran, only 1b ran, or only organic findings logged) returns `improvements-needed` with the missing-pass surgical fix.

**Commits:** `docs: bug-hunt 1/2 findings` and `docs: bug-hunt 2/2 findings`.

### Phase 7 — Final summary

1. Invoke `work-summary-deck` to produce `qa-summary-deck.html`.
2. Finalise `tests/e2e/docs/onboarding-report.md` with the sections in the next heading.

**Commit:** `docs: onboarding report and summary deck`.

### Task-tracking granularity

Use pass-level tasks, not phase-level. A single "Phase 5" task that flips to done is a footgun — use `"Pass 1/5 compositional"`, `"Pass 2/5 compositional"`, `"Pass 3/5 compositional"`, `"Pass 4/5 adversarial"`, `"Pass 5/5 adversarial"`, `"Phase 5 cleanup"`, and a `"Phase 5 overall"` parent that only flips done when all child passes do. Same for Phase 6's two sub-passes (`"Phase 6 pass 1a element-probing"`, `"Phase 6 pass 1b flow-probing"`, `"Phase 6 overall"`). Parent tasks never flip done ahead of their children.

---
