# Cascade Detector — Onboarding-State Probe

This file is the canonical source for the onboarding cascade detector — the four-step probe that classifies a project's onboarding state into one of `A | B | C | None`. Every skill that needs to know "is this project onboarded?" reads from this file rather than re-pasting the table. Drift between callers is the bug this file exists to prevent.

**Callers today:**

- `onboarding` — runs the detector at activation to decide whether to start the pipeline (any of A/B/C) or exit (None).
- `element-interactions` orchestrator — runs the detector during routing to decide whether to invoke `onboarding` or proceed inline.
- `companion-mode` — runs the detector at Phase 6 to shape the automation-graduation offer.

When you add a new caller, append a row above and cite this file rather than re-pasting the table.

---

## The detector

Run in order; stop at the first match.

| # | Check | Result | Level | Meaning |
|---|---|---|---|---|
| 1 | Is `@civitas-cerebrum/element-interactions` listed as a dependency in `package.json`? | No | **A** | Framework not installed. Install + scaffold + pipeline (or, in companion-mode, install + scaffold + Stage-3 graduation if user picks "(a) just this task"). |
| 2 | Are all of `playwright.config.ts`, `tests/fixtures/base.ts`, and `page-repository.json` present? | Any missing | **B** | Framework installed but scaffold incomplete. Scaffold + pipeline (or scaffold + Stage-3 graduation in companion-mode). |
| 3 | Does `tests/e2e/docs/journey-map.md` exist **and** have `<!-- journey-mapping:generated -->` on line 1? | No | **C** | Scaffold complete but journey map missing or unsanctioned. Pipeline only (in companion-mode, Stage-3 graduation can land without a journey map; only `coverage-expansion` / `test-composer` strictly require it). |
| 4 | All of the above pass | Yes | **None** | Fully onboarded. |

**Tooling:** use the Read and Glob tools to check these. Do **not** use Bash `ls` / `cat` for the detection — the harness's tracked-file state matters and Bash bypasses it.

**Sentinel discipline at step 3:** the journey-map presence check is two-part — the file must exist AND its line 1 must be exactly `<!-- journey-mapping:generated -->`. A `journey-map.md` authored by hand or by a non-`journey-mapping` skill returns Level **C**, not None. This sentinel is registered in `skill-registry.md` §"Non-skill sentinel strings" alongside the other case-sensitive markers.

---

## Caller-specific responses

The detector returns a level; what each caller does with that level is documented in the caller's own SKILL.md. The summary below is informational — the detail lives with each skill.

| Caller | Level None | Level A | Level B | Level C |
|---|---|---|---|---|
| `onboarding` | Print the already-onboarded exit message and stop. | Install + full scaffold + full pipeline. | Fill missing scaffold files + full pipeline. | Run the pipeline only. |
| `element-interactions` orchestrator routing | Greet as normal. | Invoke `onboarding`. | Invoke `onboarding`. | Invoke `onboarding`. |
| `companion-mode` Phase 6 | Offer "yes / no" to graduate to Stage 3. | Offer "(a) just this task / (b) full onboarding / no". (a) triggers minimum-scaffold writes by companion-mode itself. | Same as Level A. | Offer "(a) just this task / (b) full onboarding / no". (a) hands off directly to Stage 3 — no scaffold writes needed. |

---

## Already-onboarded exit message (used by `onboarding`)

When `onboarding` runs the detector and gets **None**, it prints this message and stops:

> "This project is already onboarded (found `tests/e2e/docs/journey-map.md` with the journey-mapping sentinel, scaffold complete). To expand coverage further, invoke `test-composer`. To run more bug hunts, invoke `bug-discovery`. To rebuild from scratch, delete `tests/e2e/docs/journey-map.md` and re-run onboarding."

Other callers do not print this message — `onboarding` owns it because Level None means "do nothing" only for that caller.

---

## In-flight pipeline detection (advisory)

The four-row detector above answers "is this project onboarded?" It does **not** answer "is a pipeline currently in flight?" That second question is answered by the presence of `tests/e2e/docs/coverage-expansion-state.json`, the resume marker described in `skills/coverage-expansion/SKILL.md` §"Non-negotiables for depth mode."

Callers that proceed differently when a pipeline is mid-flight should check for the state file alongside the cascade detector. Currently:

- `onboarding` — does not check; the cascade detector returning None already indicates a previous onboarding succeeded, and a mid-flight coverage run does not affect onboarding's decision.
- `companion-mode` — checks; on Phase 6, an in-flight state file triggers an additional advisory line in the report ("Detected an in-flight coverage-expansion run; graduating this task is fine and lands as a regular Stage-3 commit. Resume `coverage-expansion` separately when ready.").

---

## Maintenance

- **Adding a new check (e.g., a Level D for a new required scaffold file):** append a new row to the detector table, update each caller's "caller-specific responses" row, and bump every caller's SKILL.md to acknowledge the new level. Drift in either direction (caller doesn't handle the new level, or detector handles a level no caller responds to) is a bug.
- **Renaming a level:** do NOT. Every caller cites `A | B | C | None` by name; renaming breaks all of them.
- **Changing the sentinel string at step 3:** also update the `skill-registry.md` §"Non-skill sentinel strings" row for `<!-- journey-mapping:generated -->` and the `journey-mapping` SKILL.md sentinel description. Three-place edit.

---

## Relationship to other reference docs

| Reference | Scope |
|---|---|
| [`skill-registry.md`](skill-registry.md) | Canonical skill names, invocation strings, sentinel strings. |
| [`subagent-return-schema.md`](subagent-return-schema.md) | Canonical subagent finding-return format and adversarial-ledger schema. |
| [`cascade-detector.md`](cascade-detector.md) (this file) | Canonical onboarding-state detector and its caller-specific responses. |
