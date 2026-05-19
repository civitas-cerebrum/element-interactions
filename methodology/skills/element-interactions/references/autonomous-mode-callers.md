# Autonomous-mode caller contracts

Canonical source for what each companion skill must pass when invoking the `element-interactions` orchestrator with `autonomousMode: true`. The orchestrator's `SKILL.md` summarises this file in the §"Autonomous-mode invocation cheat-sheet" table; full per-entry-point semantics live here so the orchestrator stays light.

When you add a new caller, append a section below and add a row to the cheat-sheet in `SKILL.md`. Drift between the cheat-sheet and this file is a bug.

---

## Entry points

The orchestrator supports two autonomous entry points, distinguished by the `entry:` arg. Each one has its own required-args contract and its own discovery story.

| Entry | Used by | Skips | Starts at |
|---|---|---|---|
| `entry: "stage1"` (default if absent) | `onboarding` Phase 3, `coverage-expansion` pass 1–3 | — | Stage 1 (scenario discovery) |
| `entry: "stage3"` | `companion-mode` Phase-6 graduation | Stages 1 + 2 | Stage 3 (write the durable spec) |

---

## Entry point: stage-1 (default — discovery from a sentence)

### Required args

| Caller | Required | Optional |
|---|---|---|
| `onboarding` Phase 3 | `autonomousMode: true`, `happyPathDescription: "<one sentence>"` | `context: [...]` |
| `coverage-expansion` pass 1–3 | `autonomousMode: true`, `journey: "<j-id>"` | — |

### Behaviour

- `happyPathDescription` replaces the Stage-1 discovery conversation. The orchestrator reformats it into Given/When/Then silently and proceeds to Stage 2 (selector inspection) using `@playwright/cli` (see [`playwright-cli-protocol.md`](playwright-cli-protocol.md)).
- For `coverage-expansion`: `journey: "<j-id>"` references an entry in `tests/e2e/docs/journey-map.md`. The orchestrator loads only that journey's block, not the whole map.
- The orchestrator runs the full Stage 1 → 2 → 3 → 4 sequence under autonomous gates.

### Mandatory output — discovery draft + app-context updates

Every agent that drives the live app MUST contribute back to the project's discovery record. There is no agent that drives the live app and is exempt from recording what it found. The shape of the contribution depends on the caller:

- **`onboarding` Phase 3** — the orchestrator produces a structured discovery draft alongside the spec, capturing every page the happy path touched and every link it observed but did not follow. The draft is the input that seeds `journey-mapping`'s iterative cycles in Phase 4.
- **`coverage-expansion` per-journey runs** — each composer/probe agent that surfaces a previously-unmapped flow, page, route, state variation, or app oddity appends to `tests/e2e/docs/app-context.md` (per-page summaries, mutation endpoints, banners, seed resources) AND, when the discovery is structurally a new journey or sub-journey rather than a state of an existing one, flags it for journey-mapping reconciliation between passes per `coverage-expansion`'s map-growth contract.
- **`companion-mode` evidence runs** — observed behaviours go in the bundle's summary; if the run uncovers a new section / route / state-variation that the durable journey map didn't have, the graduation step (Phase 6) folds the discovery into the map at promote-time.
- **`bug-discovery` adversarial probes** — surfaced flows AND surfaced bugs land in their respective ledgers (`adversarial-findings.md` for findings; `app-context.md` for newly-discovered routes/states/affordances; the journey map for newly-discovered flows that warrant their own block).

**Rationale.** Every interaction with the app in scope yields a journey or an app-context entry whenever a new app behaviour is observed. Discovery is not a one-shot artifact bound to Phase 3 — it's a continuous concern across the pipeline. An agent that drives the app and records nothing is silently throwing away signal the next phase will need.

The schema below is specifically for the `onboarding` Phase 3 happy-path draft (the most structured of these contributions, used to seed Phase 4). Other callers contribute via the canonical files (`app-context.md`, `journey-map.md`, `adversarial-findings.md`) using those files' own schemas — there is no separate "draft" required for non-Phase-3 callers, but their app-discovery contributions are still mandatory.

**File:** `tests/e2e/docs/.discovery-draft.json` (dotfile, but **committed** as a durable artifact — it lets a project re-run `journey-mapping` with `phases-2-4` standalone without first re-running Phase 3. The draft is regenerated each Phase-3 run; committing the latest version is cheap (~2KB JSON) and preserves the audit trail. Earlier framework versions gitignored this file; the rule was reversed when the trade-off — re-running Phase 3 just to regenerate the draft for an unrelated re-run of Phase 4 — proved too costly.)

**Sentinel:** the file's first key MUST be `"discovery-draft-version": 1`. Phase-4 hooks refuse to consume drafts without the sentinel.

**Schema:**

```json
{
  "discovery-draft-version": 1,
  "generated-by": "phase3-happy-path",
  "generated-at": "<ISO-8601>",
  "app-url": "<baseURL>",

  "visited-routes": [
    {
      "url": "/",
      "role-as": "unauthed-visitor | authed-user | authed-<role>",
      "kind-guess": "<section-id from canonical vocabulary>",
      "interactive-elements": ["<element>", ...],
      "links-out": [
        { "to": "/signup", "label-or-action": "Sign Up nav button" },
        { "to": "/items/{id}", "label-or-action": "card click into item detail" }
      ]
    }
  ],

  "unvisited-but-linked": [
    { "url": "/<gated-route>", "seen-from": "/", "section-guess": "<canonical section-id>" }
  ],

  "sections-inferred": [
    {
      "id": "<canonical section-id>",
      "routes-visited": ["/", "/items/{id}"],
      "routes-suggested": ["/?category=*"],
      "role-required": "unauthed-visitor | authed-user | authed-<role>",
      "seed-data-needed": "yes (N seeded items) | no | conditional"
    }
  ],

  "handover-to-phase4": {
    "cycle-1-targets": ["<section-id>", ...],
    "credentials-discovered": {
      "signup-open": true | false,
      "signup-endpoint": "<HTTP-method> <signup-path>",
      "demo-credentials": null | { "<role>": { "<credential-field>": "<value>" } },
      "admin-path": null | "<admin-route>"
    }
  }
}
```

`cycle-1-targets` is the union of `sections-inferred[].id` and the section-guesses in `unvisited-but-linked`. `credentials-discovered` tells `journey-mapping` Phase 4 whether cycle agents can self-credential or whether gated areas should defer to coverage-expansion. Canonical section vocabulary lives in `journey-mapping/SKILL.md` §"Section vocabulary" — cycle agents pick from the list.

**When the orchestrator writes the draft:** at the end of Stage 3 (after the spec runs 3× green), before Stage 4a starts. The draft is independent of the spec — Stage 4a/4b operate on the spec, not the draft.

**Failure mode:** if the orchestrator cannot infer at least one section (zero pages visited, zero links observed), it returns `{ status: 'failed', error: 'discovery-draft-empty', happyPathDescription }` rather than writing an empty draft. An empty draft is a contract violation; absence of the file is the error condition Phase 4 hooks check for.

---

## Entry point: stage-3 (bundle-driven — discovery already done)

### Required args

| Caller | Required | Optional |
|---|---|---|
| `companion-mode` Phase-6 graduation | `autonomousMode: true`, `entry: "stage3"`, `bundlePath: "<absolute-path-to-tests/e2e/evidence/<slug>-<ts>/>"` | — |

### Bundle-read schema

When `entry: "stage3"` is set, the orchestrator MUST read the following from `<bundlePath>`:

| Source file in the bundle | What the orchestrator reads | Maps to which Stage-1/2 output |
|---|---|---|
| `summary.md` — H1 heading `# Companion-mode evidence — <task>` | Verbatim task description (durable test name and Given/When/Then refactor) | Stage-1 scenario |
| `summary.md` — `**Pass criterion (user-supplied):** "<verbatim>"` line | Verbatim pass criterion (final assertion's `expect(...).toBe(...)` and the test's failure message) | Stage-1 acceptance criterion |
| `summary.md` — `**App URL:** <url>` line | Entry URL for the durable test | Stage-1 environment |
| `spec.ts` — Steps API calls and their `(elementName, pageName)` arguments | Already-discovered selectors and page names referenced | Stage-2 page-repository entries |

### Behaviour

- The orchestrator does **not** re-run Phase 2 discovery (no `playwright-cli` snapshot, no DOM walk). Companion-mode already did the equivalent work.
- Selectors that already exist in the project's `page-repository.json` are referenced as-is. Selectors that companion-mode inlined in the bundle's `spec.ts` are proposed for addition during Stage 3 under the autonomous Stage-2 gate-suspension rule (proposed entries are written directly).
- Stage 3 writes the durable spec at the standard `tests/<name>.spec.ts` location — NOT inside the bundle directory. The bundle remains read-only post-Phase-5 per `companion-mode` Rule 11.
- Stage 4 runs as usual.
- Commit message references the bundle path: `test: graduate companion-mode bundle <slug>-<ts>`.

### Malformed-bundle handling

If `<bundlePath>` is missing, unreadable, or its `summary.md` does not match the schema above (no task heading, no pass-criterion line, no app-URL line), the orchestrator stops and returns `{ status: 'failed', error: 'malformed-bundle', bundlePath }` to the caller without writing a durable test.

Companion-mode's Phase 5 produces the bundle in the schema documented at `methodology/skills/companion-mode/SKILL.md` §"`summary.md` — required sections". If that schema changes, this file MUST be updated in the same commit.

---

## Gate suspension (any entry point)

In autonomous mode:

- **Stage-1 scenario approval** — skipped. Reformatted scenario (or bundle-derived task description, for `entry: "stage3"`) is treated as approved.
- **Stage-2 page-repository approval** — skipped. Proposed entries are written directly (this is the ONLY exception to Rule 2 of the orchestrator, and it applies only inside autonomous mode). For `entry: "stage3"`, no live discovery happens — proposals come from the bundle's `spec.ts`.
- **Stage-3 stage-advancement prompts** — skipped.
- **Stage-4 API Compliance Review** — still runs, still fixes misuse. A failed review does NOT prompt; it auto-corrects and re-runs.
- **Failure-diagnosis on any test failure** — still runs, still classifies. App bugs halt the autonomous flow and surface to the caller.

## Commit discipline (any entry point)

Autonomous mode still commits after each passing + compliant test, same as interactive mode. The caller is responsible for the outer commit boundary:

- `onboarding` → `test: happy path — <name>` commit.
- `coverage-expansion` → per-pass commit message defined in that skill's §"Commit-message conventions".
- `companion-mode` Phase-6 graduation → `test: graduate companion-mode bundle <slug>-<ts>` commit.

## Returning control (any entry point)

When Stages 1–4 complete, the orchestrator returns:

```
{ status: 'passed' | 'failed', testsWritten: [paths], appBugs: [...] }
```

For `entry: "stage3"` graduation, the same shape applies plus `graduatedFromBundle: <bundlePath>` so the caller can audit the lineage.

The orchestrator does NOT advance to Stage 5 or show the Onboarding Completion Gate on its own — the caller decides what happens next.

---

## Relationship to other reference docs

| Reference | Scope |
|---|---|
| [`skill-registry.md`](skill-registry.md) | Canonical skill names, invocation strings, sentinel strings. |
| [`subagent-return-schema.md`](subagent-return-schema.md) | Canonical subagent finding-return format, return states, adversarial-ledger schema. |
| [`cascade-detector.md`](cascade-detector.md) | Canonical onboarding-state probe (Levels A/B/C/None) and caller-specific responses. |
| [`autonomous-mode-callers.md`](autonomous-mode-callers.md) (this file) | Canonical autonomous-mode entry-point contracts (`stage1` / `stage3`), bundle-read schema, gate suspension, commit discipline, return shape. |
