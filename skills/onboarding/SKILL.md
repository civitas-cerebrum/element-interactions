---
name: onboarding
description: >
  End-to-end methodology for adding a brand-new e2e suite to a project that
  has none. Defines the eight-phase workflow (scaffold, groundwork,
  happy-path, journey-mapping, coverage-expansion, bug-discovery,
  secrets-sweep, report) and the gate criteria between phases. Use this
  skill to run the workflow interactively in Claude Code. For automated
  runs, the workflow is also packaged as the `@civitas-cerebrum/achilles`
  CLI.
---

# Onboarding — eight-phase e2e bootstrap

This is the umbrella methodology for taking a project from zero e2e tests to
a maintained suite. The same workflow runs two ways:

| Mode | When | How |
|---|---|---|
| **Interactive** | You want fine-grained control or you're learning the system | Read this skill and follow the phase playbook below |
| **Automated** | You want a hands-off run | `npx @civitas-cerebrum/achilles onboarding` |

The two modes execute the same phases against the same gate criteria. The
automated driver dispatches role-scoped subagents per phase; in interactive
mode you load the relevant role-scoped skill yourself and work the phase
through Claude Code's normal tool surface.

---

## Phase map

| # | Phase | What it produces | Skill |
|---|---|---|---|
| 1 | Scaffold | `playwright.config.ts`, `tests/e2e/` tree, shared fixtures, `.gitignore` additions | `element-interactions` (Stage 1) |
| 2 | Groundwork | `app-context.md`, `page-repository.json`, runtime self-credentialing fixture | `element-interactions` (Stage 2) |
| 3 | Happy-path | One spec per primary user flow that exercises sign-in + the critical action | `element-interactions` (Stages 3–4), `test-composer` |
| 4 | Journey mapping | `tests/e2e/docs/journey-map.md`, `tests/e2e/docs/journey-map-coverage.md` | `journey-mapping` |
| 5 | Coverage expansion | One spec per priority-2/3 journey, grouped passes 2–5 with cleanup dedup | `coverage-expansion`, `test-composer` |
| 6 | Bug discovery | Adversarial findings + regression specs that lock the failure modes | `bug-discovery` |
| 7 | Secrets sweep | Credentials/keys/PII/URLs extracted to `.env`; `.env.example` committed | `secrets-sweep` |
| 8 | Report | `tests/e2e/docs/onboarding-report.md` work summary deck | `work-summary-deck` |

A phase only advances once its **exit criteria** (below) are satisfied. A
human or an automated phase-validator checks the criteria; ambiguity blocks
the phase, not the run.

---

## Front-load gate (before Phase 1)

Before any scaffolding, confirm three preconditions:

1. **Dev server runs locally.** You can launch the app and reach its
   landing page in a browser. Phase 2's groundwork depends on this.
2. **`@civitas-cerebrum/element-interactions` installed.** `package.json`
   lists the dep; `node_modules/@civitas-cerebrum/element-interactions/`
   exists. (The package's postinstall installs the surviving hooks +
   skills into `~/.claude/`.)
3. **No prior e2e suite in conflict.** If `tests/e2e/` already exists with
   committed specs, this is a *resume* (not onboarding). Switch to running
   the relevant phase skill directly.

If the project already runs `playwright` end-to-end with substantial
coverage, do not run onboarding — it's designed for zero-to-suite, not
augmentation.

---

## Phase 1 — Scaffold

**Goal.** Land the Playwright config and the shared file tree.

**Steps.**

1. Create `playwright.config.ts` with the project's dev-server URL,
   the standard reporters (`html` + `json`), and a `webServer` block if
   the suite should launch the dev server itself.
2. Create `tests/e2e/{specs,fixtures,docs}/` and `tests/e2e/playwright.setup.ts`.
3. Add `tests/e2e/.gitignore` entries for `playwright-report/`,
   `test-results/`, `.last-run.json`.
4. Commit as `chore: scaffold e2e suite`.

**Exit criteria.**
- `npx playwright test --list` lists zero specs without error.
- The four scaffold files exist on disk.

Load `element-interactions` (Stage 1) for the exact file shapes.

---

## Phase 2 — Groundwork

**Goal.** Capture project context so later phases don't re-discover it.

**Steps.**

1. **App-context document.** Author `tests/e2e/docs/app-context.md`. Cover
   what the app is, primary user roles, authentication model, key
   subsystems, and the rough URL surface.
2. **Page repository.** Walk the running app and populate
   `tests/e2e/page-repository.json` with one entry per discoverable page
   (path, purpose, primary selectors). Use Playwright's snapshot tool
   interactively if helpful.
3. **Runtime self-credentialing fixture.** Add `tests/e2e/fixtures/auth.ts`
   that mints test users at runtime (signup → confirm → login) instead
   of relying on seeded credentials. Phase 7's secrets sweep depends on
   no credentials being hard-coded.

**Exit criteria.**
- The three artefacts exist and `npx playwright test --list` still works.

Load `element-interactions` (Stage 2) for the page-repository schema and
the self-credentialing pattern.

---

## Phase 3 — Happy path

**Goal.** One green spec per primary user flow.

**Steps.**

1. Identify the *primary* journeys from `app-context.md` (typically 2–5).
2. For each, dispatch (or run yourself) the `test-composer` skill with a
   brief naming the journey, its prerequisites, and the critical
   assertion. Composer writes the spec, lands tests, and self-verifies
   with `npx playwright test`.
3. Reviewer pass: `reviewer-inloop` skill checks each spec for craft
   issues, missing scenarios, and stale assertions. Revise until
   greenlight.
4. Commit each spec individually: `test(j-<journey>): happy path`.

**Exit criteria.**
- One spec per primary journey, all passing locally.
- `tests/e2e/docs/.discovery-draft.json` has been written by the
  Stage-3 happy-path pass (used as input by Phase 4).

Load `test-composer` and `reviewer-inloop` for the dispatch contract and
return shapes.

---

## Phase 4 — Journey mapping

**Goal.** Produce a structured map of every user journey worth testing,
prioritised P1 / P2 / P3.

**Steps.**

1. Load `journey-mapping`. The skill enforces an *iterative cycle*
   protocol: at least one discovery cycle plus exactly one edge-probe
   cycle. Shallow single-pass exploration is not accepted.
2. Produce `tests/e2e/docs/journey-map.md` (priority-grouped) and
   `tests/e2e/docs/journey-map-coverage.md` (mapping each journey to
   the spec that covers it, or `<missing>`).
3. Reviewer cross-check: the structural-smell prevention rule rejects
   maps that collapse distinct flows or split one flow across journeys.

**Exit criteria.**
- Journey map exists with priority groupings and `<missing>` markers.
- The edge-probe cycle's findings are reflected in the map (not just
  discarded).

Load `journey-mapping` for the cycle gate, the edge-probe contract, and
the priority-tier rubric.

---

## Phase 5 — Coverage expansion

**Goal.** Land one spec per priority-2 / priority-3 journey not already
covered, plus per-pass dedup.

**Steps.**

1. Load `coverage-expansion`. The skill defines compositional passes
   (1–5) plus an adversarial pass and a cleanup/dedup pass.
2. **Relevance grouping.** When a priority tier holds more than five
   journeys, group them by feature area and cap each group at seven.
   Project-agnostic clustering vocabulary: browse / transact / account
   / mutate / errors / auth. Avoid project-specific tokens.
3. **First pass is opus-tier.** Reserve the most capable model for the
   first compositional pass — the breadth scaffolding done here drives
   every later pass.
4. **Per-pass dedup.** Run one cleanup subagent at the end of every pass
   to consolidate duplicate scenarios within the pass.
5. **Adversarial passes.** Pass 4 (first adversarial) and pass 5 (second
   adversarial) emit findings. If pass 5 surfaces seven or more
   *unique* findings after dedup, run a third adversarial pass.

**Exit criteria.**
- Every P2 / P3 journey in the map has either a spec or a documented
  skip with explicit authorisation.
- The dedup pass at the end of each pass landed without leaving
  duplicate-scenario findings open.

Load `coverage-expansion` for the full pass protocol and the
`[group]` dispatch marker syntax.

---

## Phase 6 — Bug discovery

**Goal.** Surface adversarial findings — flows that *should* break the
application — and lock the failure modes with regression specs.

**Steps.**

1. Load `bug-discovery`. The skill dispatches probe subagents per journey
   (or per relevance group when there are many journeys).
2. Each probe runs against the live app, emits findings, and authors
   regression specs that reproduce each finding.
3. Findings without reproductions are flagged but not committed as
   specs; they go into `tests/e2e/docs/adversarial-findings.md`.

**Exit criteria.**
- Every probe completed (status `clean` or `findings-emitted`).
- All `findings-emitted` returns have a corresponding regression spec
  or an explicit `app-bug` flag for human triage.

Load `bug-discovery` for the relevance-grouping rules and the probe
return shape.

---

## Phase 7 — Secrets sweep

**Goal.** Move every credential, API key, PII-shape literal, and
hard-coded URL out of the test code into `.env`. The released suite
should be portable across local / CI / staging targets.

**Steps.**

1. Load `secrets-sweep`. The skill defines the four literal classes
   (credentials, API keys, PII, URLs) and the extraction playbook.
2. Scan `tests/e2e/**/*.spec.ts` and `tests/e2e/fixtures/**/*.ts`.
   *Do not* touch application source under `src/` or `app/`.
3. Replace literals with `process.env.<NAME>`; write `.env` (real
   values, gitignored) and `.env.example` (placeholders, committed);
   ensure `.gitignore` covers `.env`.

**Exit criteria.**
- A re-scan of `tests/e2e/**` surfaces no literal credentials.
- `.env`, `.env.example`, and the `.gitignore` entry are all in place.
- `npx playwright test` still passes against the now-env-driven suite.

Load `secrets-sweep` for the full playbook and the strict edit-scope
rules.

---

## Phase 8 — Report

**Goal.** Author the work summary so a stakeholder can understand what
the suite covers without reading every spec.

**Steps.**

1. Load `work-summary-deck`. The skill renders a markdown deck at
   `tests/e2e/docs/onboarding-report.md`.
2. The deck includes: total specs, journeys covered (priority-tiered),
   adversarial findings landed as regressions, open `app-bug` flags,
   and the suite's runtime envelope.

**Exit criteria.**
- `tests/e2e/docs/onboarding-report.md` exists.
- The deck reflects the actual state of the suite (no stale numbers).

---

## Cross-cutting rules

These rules apply to every phase. Violating them is a phase failure even
when the exit criteria are technically met.

- **Self-credentialing first.** No spec hard-codes a username, password,
  or token. Auth flows mint test users at runtime.
- **One commit per landed deliverable.** Phases commit per-spec, not
  per-phase, so a partial run can be safely resumed.
- **No project-specific vocabulary in shared docs.** Journey names use
  generic web-UI clustering vocabulary (browse / transact / account /
  mutate / errors / auth), not domain-specific tokens.
- **Return-shape conformance.** Every subagent dispatch you run must
  return a schema-conformant envelope (see
  `schemas/subagent-returns/`).

---

## Resuming a partial run

If onboarding was interrupted, find the latest greenlit phase from
`tests/e2e/docs/journey-map-coverage.md` and the commit history, then
restart from the next phase. Each phase is independently runnable as
long as its predecessor's deliverables exist on disk.

For automated runs: `npx @civitas-cerebrum/achilles onboarding --resume`.
