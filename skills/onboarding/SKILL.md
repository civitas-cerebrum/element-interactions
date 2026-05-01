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

## Reference index

| Reference file | What's in it |
|---|---|
| [`references/phases-walkthrough.md`](references/phases-walkthrough.md) | Phases 1–7 detail: per-phase task list, hard gates, progress-output discipline. |

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

The seven-phase pipeline (Phase 1 Scaffold → Phase 2 Groundwork discovery → Phase 3 Happy path → Phase 4 Full journey mapping → Phase 5 Coverage expansion → Phase 6 Bug hunts → Phase 7 Final summary) is specified in [`references/phases-walkthrough.md`](references/phases-walkthrough.md). Read it before authoring or modifying any phase logic.

Key invariants kept here:

- **All seven phases run in order, no skipping.** Phase 5 (coverage-expansion) and Phase 6 (bug-discovery) are the lengthy phases — the front-load gate authorises both.
- **Phase 5 invokes `coverage-expansion` with `mode: depth`** — the full 5-pass + cleanup pipeline. Onboarding does not invoke coverage-expansion in `mode: breadth`.
- **Hard gates between phases.** A phase that surfaces a malformed prerequisite (missing journey-map sentinel, missing tenant credentials, etc.) stops onboarding with a clear "blocked-on-prerequisite" message rather than silently proceeding.

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
