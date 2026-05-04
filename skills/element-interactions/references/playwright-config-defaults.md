# Playwright config defaults

**Status:** authoritative spec for the `playwright.config.ts` defaults this package scaffolds and recommends. Cited from `onboarding/references/phases-walkthrough.md` Phase 1, `element-interactions/SKILL.md` Rule 8, and the harness hook `playwright-config-defaults-guard.sh`.

**Scope:** the project-level `playwright.config.ts` produced by Phase 1 scaffolding (Level A/B onboarding) and the equivalent baseline this package's own tests use.

---

## The default config

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

The fields above are the package's documented defaults. Every Phase-1 scaffold writes this shape. Consumers may override after the scaffold lands, but the **out-of-the-box behaviour** is what's documented here.

---

## Why these defaults

### `retries: process.env.CI ? 2 : 1`

A non-zero retry budget by default is what makes the video / trace defaults useful — without retries, the `'on-first-retry'` boundary is unreachable. One retry locally and two in CI is the sweet spot:

- One local retry catches transient flakes that would otherwise interrupt an authoring session.
- Two CI retries collapse the long tail of network-blip / cold-cache / startup-race failures that don't reproduce when the developer reads the report.
- More than two in CI starts hiding genuine flakiness and inflating run time.

### `use.video: 'on-first-retry'`

The single most asked-for diagnostic when triaging "why did this test fail in CI yesterday?" is video. The cost of recording is real (disk, CPU), so the right default is the boundary where it pays off most: the rerun.

- First pass: no video. Cheap. Most tests pass.
- First retry: video recorded. Failed once already, so capturing the rerun documents the failure shape that escaped the first pass — flake or genuine, the video is what tells you which.
- The report viewer (`npx playwright show-report`) embeds the video automatically. No extra plumbing.

`'on-first-retry'` beats `'retain-on-failure'` for the rerun-as-evidence framing: `'retain-on-failure'` records every test from the start and discards on success, which is heavier and captures the *first* attempt — the rerun-with-video pattern is more useful when triaging "what does the failure actually look like" because it captures the deterministic-or-flaky question on the same recording.

### `use.trace: 'on-first-retry'`

Full Playwright trace on the same boundary. Pairs with the video: video shows the user-visible failure shape, trace shows the test-action timeline + network requests + DOM snapshots at each step. Together they answer both *"what did the user see"* and *"what did the test do."*

Same boundary as video keeps the cost predictable: one retry boundary, two artefacts.

### `reporter: 'html'`

The HTML reporter is the lowest-friction surface for the diagnostic flow `failure-diagnosis/SKILL.md` Stage 1 prescribes (`npx playwright show-report`). Other reporters (line, list, junit) are valid for CI integration but should be ADDED, not substituted — `reporter: ['html', 'junit']` is correct; replacing with junit-only loses the on-disk artefacts the diagnosis pipeline reads.

### `headless: true`

Unattended runs default to headless. Authoring / debugging sessions opt in via `--headed` or per-test `test.use({ headless: false })`. Don't put `headless: false` in the default config — it changes CI behaviour silently.

---

## Minimum-viable customisations consumers can make

These are valid project-level overrides that don't drift from the documented defaults:

- Adding extra reporters: `reporter: ['html', ['junit', { outputFile: 'results.xml' }]]`
- Tightening or relaxing the retry count for project-specific reasons (e.g., `retries: 0` for a deterministic-only suite — see `contract-testing/SKILL.md` for the canonical zero-retry case).
- Per-project `expect.timeout`, `actionTimeout`, `navigationTimeout` adjustments.
- Adding `projects[]` for cross-browser fanout.

These are NOT valid default-strip overrides without an explicit reason in the PR description:

- `retries: 0` (kills the rerun boundary the video / trace defaults rely on).
- `video: 'off'` (regresses the documented "rerun documents failure" guarantee).
- `trace: 'off'` (regresses the diagnostic substrate `failure-diagnosis` reads).

The `playwright-config-defaults-guard.sh` hook surfaces a `systemMessage` warning when a write strips these defaults so reviewers see the deviation without it being silent.

---

## Why a hook backs this rule

This default is documentation. Documentation drifts. Six months from now a contributor re-running a project-specific scaffold can quietly delete the `video` line and the next failure investigation costs hours of "wait, why isn't there a video?" The contributing skill's hard rule §"Methodology improvements ship as programmatic hooks" requires every documented default carry a programmatic backstop. `playwright-config-defaults-guard.sh` is that backstop — it doesn't deny the write (consumer autonomy matters), but it raises a visible `systemMessage` so the deviation is surfaced rather than swallowed.

---

## Cross-links

- `onboarding/references/phases-walkthrough.md` Phase 1 — invokes this default during scaffold.
- `element-interactions/SKILL.md` Rule 8 — points here for the substance of "what the right config looks like" before any modification.
- `failure-diagnosis/SKILL.md` Stage 1 — relies on the HTML report + trace artefacts produced by this config.
- `contributing-to-element-interactions/SKILL.md` §"Methodology improvements ship as programmatic hooks" — the doctrine that motivates the hook backstop.
- `hooks/playwright-config-defaults-guard.sh` — the harness backstop.
