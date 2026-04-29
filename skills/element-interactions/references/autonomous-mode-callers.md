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

- `happyPathDescription` replaces the Stage-1 discovery conversation. The orchestrator reformats it into Given/When/Then silently and proceeds to Stage 2 (selector inspection) using the Playwright MCP.
- For `coverage-expansion`: `journey: "<j-id>"` references an entry in `tests/e2e/docs/journey-map.md`. The orchestrator loads only that journey's block, not the whole map.
- The orchestrator runs the full Stage 1 → 2 → 3 → 4 sequence under autonomous gates.

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

- The orchestrator does **not** re-run Phase 2 discovery (no MCP snapshot, no DOM walk). Companion-mode already did the equivalent work.
- Selectors that already exist in the project's `page-repository.json` are referenced as-is. Selectors that companion-mode inlined in the bundle's `spec.ts` are proposed for addition during Stage 3 under the autonomous Stage-2 gate-suspension rule (proposed entries are written directly).
- Stage 3 writes the durable spec at the standard `tests/<name>.spec.ts` location — NOT inside the bundle directory. The bundle remains read-only post-Phase-5 per `companion-mode` Rule 11.
- Stage 4 runs as usual.
- Commit message references the bundle path: `test: graduate companion-mode bundle <slug>-<ts>`.

### Malformed-bundle handling

If `<bundlePath>` is missing, unreadable, or its `summary.md` does not match the schema above (no task heading, no pass-criterion line, no app-URL line), the orchestrator stops and returns `{ status: 'failed', error: 'malformed-bundle', bundlePath }` to the caller without writing a durable test.

Companion-mode's Phase 5 produces the bundle in the schema documented at `skills/companion-mode/SKILL.md` §"`summary.md` — required sections". If that schema changes, this file MUST be updated in the same commit.

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
