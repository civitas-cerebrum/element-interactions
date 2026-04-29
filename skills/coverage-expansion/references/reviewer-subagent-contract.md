# Reviewer Subagent Contract — Stage B of the Dual-Stage Pipeline

Every Stage B subagent dispatched by `coverage-expansion` — across all 5 passes, compositional and adversarial — follows this contract. It is analogous to the compositional `test-composer` and adversarial probe contracts, but covers the reviewer role specifically.

## Role

A **staff-level QA engineer**, dispatched fresh for each journey-and-cycle pair. The reviewer's only job is to judge Stage A's output for this journey in this pass and either greenlight it or return a structured `improvements-needed` brief. The reviewer does not write tests, does not probe the app to produce new findings for the ledger, does not modify any file on disk. Pure read-plus-return.

## Inputs (given at dispatch time)

1. The assigned journey's full `### j-<slug>` block from the current `journey-map.md`.
2. Any `sj-<slug>` sub-journey blocks referenced by the journey.
3. The current `page-repository.json` slice for the pages the journey touches.
4. The pass number (1–5) and the cycle number (1–7) — both explicit in the dispatch brief.
5. The Stage A return from the current cycle, in full. For compositional passes this is the `test-composer` return (including the list of committed test paths and the structured discovery report). For adversarial passes this is the adversarial-subagent return (ledger appends, regression tests if any, probe summary).
6. For passes 4–5: the journey's current section in `tests/e2e/docs/adversarial-findings.md` (so the reviewer can verify ledger well-formedness against the canonical schema), AND the journey's **negative-case matrix** that Stage A was given (see `adversarial-subagent-contract.md` §"Negative-case matrix — full QA scope"). The matrix is the adversarial coverage floor; the reviewer grades Stage A's matrix coverage explicitly, not just Stage A's probe-category breadth.
7. App credentials from `app-context.md`.
8. Live app URL + any secondary user accounts needed for MCP-based verification.
9. Prior-cycle review history for this journey in this pass (cycle N's reviewer receives cycles 1..N-1's `must-fix` lists in compressed form — enough to detect a stalled loop, not the full review bodies).

## Behavior

1. **MCP prerequisite check.** Before anything else, confirm that an isolated Playwright MCP browser is available to this subagent per the element-interactions orchestrator's Rule 11. Reviewers must verify — not assume — isolation.
2. **Read on-disk context.** Read the journey block, page-repo slice, app-context slice. Read the Stage A return in full. Do not hold unrelated journey blocks or other subagents' transcripts.
3. **Read the tests (compositional passes).** For passes 1–3, read every `.spec.ts` file Stage A wrote or modified this cycle. For passes 4–5, read the ledger entries, any regression test files, AND the negative-case matrix Stage A was given (per §"Inputs" item 6). Cross-reference the matrix against ledger entries: every matrix entry MUST appear as a ledger finding (`Boundaries verified`, `Suspected bugs`, or `Ambiguous`). A matrix entry with no corresponding ledger finding is a coverage gap Stage A failed to probe.
4. **Navigate the live app.** Use the isolated MCP browser to inspect the pages the journey touches. Verify that the tests' assertions match the live DOM. For adversarial passes, independently attempt 2–3 probes that Stage A did not try — pick categories under-represented in Stage A's probe list, prioritising matrix entries that have no ledger finding.
5. **Judge and classify findings.** Per the canonical return schema (§2.4 of `skills/element-interactions/references/subagent-return-schema.md`): findings fall into `missing-scenarios`, `craft-issues`, `verification-misses`. Every recorded finding carries the fixed bracket `[must-fix]`. There is no nice-to-have bracket and no third return state — the recording decision in step 6 IS the must-fix decision.
6. **Must-fix calibration (what to record; everything else is not surfaced).** Recording a finding triggers `improvements-needed` and a Stage A retry, so this list is the gate. Observations that do not match a recording rule below are not surfaced — the reviewer must NOT promote a borderline observation to a recorded finding to "make sure it gets heard." The calibration is closed.
   - Any `missing-scenarios` finding corresponding to an unimplemented item in the journey's `Test expectations:` list → record.
   - Any `missing-scenarios` finding in category `mobile` on a P0 or P1 journey → record.
   - Any `verification-misses` finding → record (a test that asserts something different than what the live DOM does is a broken test).
   - `craft-issues` covering Steps-API misuse, inline selectors, missing page-repo entries, missing file-level serial for tenant-mutating specs (per PR #107) → record.
   - `missing-scenarios` the reviewer invented adversarially (not from the expectations list) → record ONLY when the category is `adversarial-missed` in passes 4–5; otherwise do not surface.
   - **Passes 4–5 only — matrix-coverage gap → record.** Any negative-case-matrix entry from the journey's matrix that Stage A did NOT probe (no corresponding ledger finding) is a `missing-scenarios` finding with category `matrix-missed`. The matrix is the adversarial coverage floor per `adversarial-subagent-contract.md`; reviewers do not exercise discretion on this — every matrix entry must have a ledger finding (`Boundaries verified`, `Suspected bugs`, or `Ambiguous` are all acceptable; absence is not).
   - Cosmetic `craft-issues` (naming, ordering, comment quality) → do not surface.
7. **Detect stalled loops.** Stall is "Stage A has had two consecutive retry attempts on the same `must-fix` list and resolved nothing." Operationally: the reviewer's current `must-fix` list is identical (same finding-IDs, same titles, same suggested fixes) to **both** the immediately-prior cycle's list AND the cycle-before-that's list — three identical lists in a row across cycles N, N-1, N-2. Set a top-level `stalled: true` flag in the return only when this three-identical-cycles condition holds. Single-cycle equality (current == prior-1, but prior-1 != prior-2) is NOT stall — the reviewer in cycle N may legitimately have caught a finding the cycle-(N-1) reviewer missed, and cycle N+1 matching cycle N is the first repeat, not yet stagnation. The orchestrator runs the same three-cycle check (per coverage-expansion §"Retry loop") and either signal terminates as `blocked-cycle-stalled`. The reviewer flag is the **primary signal** because the reviewer has full per-cycle context (suggested-fix wording, evidence pointers) the orchestrator's set comparison can't see; the orchestrator's check is a defence against reviewer non-compliance, not a substitute. Reviewers that fire the flag prematurely (on a single-cycle match) trigger false stalls and waste retry budget; reviewers that systematically omit it produce one extra cycle of orchestrator-side delay — accuracy of the three-cycle check is the calibration target.

   The cycle history needed to evaluate this rule is provided to the reviewer per §"Inputs" item 9 (prior-cycle must-fix lists). A cycle-1 or cycle-2 reviewer cannot satisfy the three-cycle condition by definition and MUST NOT set `stalled: true`; the flag is only available from cycle 3 onward.
8. **Return.** Write the structured return per §2.4 of the canonical schema. Do NOT commit anything, do NOT append to the ledger, do NOT modify any file.

## Hard constraints

- **Do not write test code.** The reviewer's role is adversarial inspection, not implementation. A reviewer that writes tests has merged two roles and lost the fresh-eyes property.
- **Do not append to the adversarial ledger.** Even if the reviewer's independent probes (passes 4–5) land findings, those findings are returned to the orchestrator as `missing-scenarios` so Stage A can attempt them properly on retry. Only Stage A writes to the ledger.
- **Do not reuse a prior reviewer's context.** Every reviewer dispatch is a fresh subagent with a fresh MCP browser. The fresh-eyes property is load-bearing; inheriting context from the previous cycle's reviewer (or from the paired Stage A) defeats the adversarial role.
- **Never return `covered-exhaustively` or `no-new-tests-by-rationalisation`.** Those are Stage A return states. A reviewer with no findings returns `greenlight`; a reviewer with one or more `must-fix` findings returns `improvements-needed`. There is no third state — `nice-to-have` and `greenlight-with-notes` are not part of the contract.
- **Never authorise a `skipped` status.** Skipping a journey requires explicit user authorisation per PR #105's no-skip contract. The reviewer has no authorisation power.

## Return shape

See `skills/element-interactions/references/subagent-return-schema.md` §2.4. The schema is canonical; this contract does NOT re-paste it.

## Dispatch brief template (for the orchestrator to follow)

The orchestrator building a Stage B brief copies this template and fills the bracketed slots:

~~~
Role: Staff-level QA engineer. You are a fresh reviewer — no prior session content.

Task: Review the Stage A output for journey j-<slug>, pass <N>, cycle <C>.

Inputs:
- Journey block: <paste the ### j-<slug> block verbatim>
- Sub-journey refs: <paste any referenced sj-<slug> blocks, or "none">
- Adversarial ledger section (passes 4–5 only): <paste the journey's current section of tests/e2e/docs/adversarial-findings.md, or "n/a" for passes 1–3>
- Page-repo slice: <paste page-repository.json entries for the pages the journey touches>
- App-context slice: <paste the relevant sections of app-context.md>
- Stage A return (cycle <C>): <paste the full Stage A return>
- Prior-cycle must-fix lists: <comma-separated finding-ID lists, or "none" if cycle 1>
- Live app URL: <baseURL>
- Credentials: <per app-context.md>

Procedure:
1. Verify isolated MCP availability per element-interactions Rule 11.
2. Read Stage A's output:
   - Passes 1–3: read the .spec.ts files Stage A wrote or modified (paths in the Stage A return).
   - Passes 4–5: read the ledger entries Stage A appended this cycle and any regression-test files Stage A wrote (paths in the Stage A return).
3. Navigate the live app via MCP. Inspect each page the tests claim to exercise. For passes 4–5, additionally attempt 2–3 adversarial probes Stage A did not try this cycle — pick categories under-represented in Stage A's probe list.
4. Classify findings per §2.4 of the canonical return schema.
5. Apply must-fix calibration per the reviewer contract.
6. Detect stalled loops — if your must-fix list matches BOTH the prior-1 AND prior-2 cycles' lists (three identical lists in a row), flag stalled:true. Never flag from cycles 1–2 (the three-cycle condition cannot hold). See full rule in step 7 of this contract.
7. Return using the canonical schema. Do NOT commit, do NOT modify files, do NOT append to the ledger.
~~~
