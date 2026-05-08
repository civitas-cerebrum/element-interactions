# Reviewer Subagent Contract — Stage B of the Dual-Stage Pipeline

Every Stage B subagent dispatched by `coverage-expansion` — across all 5 passes, compositional and adversarial — follows this contract. It is analogous to the compositional `test-composer` and adversarial probe contracts, but covers the reviewer role specifically.

**Two invocation modes:**

- **`mode: per-journey`** — one Stage B reviewer per journey per cycle. Used for cycle-2+ retries, all adversarial Pass-4/5 reviews, and any cycle the operator has flagged as needing human-grade attention. Full per-journey contract: §"Role" through §"Dispatch brief template" below.
- **`mode: batch`** — one Stage B reviewer per **pass** that reads all in-flight journeys' spill files together and emits per-journey verdicts. Used for **Pass 1 / 2 / 3 cycle-1 only** — ~85% of compositional cycle-1 reviewers return `greenlight`, so per-journey isolation over-pays for that majority. Batch contract: §"Batch reviewer mode (cycle-1 compositional only)" at the end of this file.

**Mode selection** (the orchestrator decides at dispatch time):

| Pass | Cycle | Mode |
|---|---|---|
| 1 (compositional) | 1 | batch |
| 1 (compositional) | 2+ | per-journey (only flagged journeys re-dispatched) |
| 2 (compositional re-pass) | 1 | batch |
| 2 (compositional re-pass) | 2+ | per-journey |
| 3 (compositional consolidation) | 1 | batch |
| 3 (compositional consolidation) | 2+ | per-journey |
| 4 (adversarial probing) | any | per-journey (always) |
| 5 (adversarial regression) | any | per-journey (always) |

Adversarial passes never use batch mode — the per-journey live-app probe + matrix coverage check is load-bearing for adversarial discipline and benefits from isolated context. Compositional cycle-2+ retries are per-journey because the orchestrator already knows which specific journeys need attention; batching cycle-2 retries would defeat the purpose.

A `mode: batch` reviewer that wants per-journey depth on a flagged journey returns `improvements-needed` for that journey in its return; the orchestrator then dispatches a follow-up cycle-2 per-journey reviewer for that journey only. Subagents do not switch modes mid-flight.

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
8. Live app URL + any secondary user accounts needed for `playwright-cli`-based verification.
9. Prior-cycle review history for this journey in this pass (cycle N's reviewer receives cycles 1..N-1's `must-fix` lists in compressed form — enough to detect a stalled loop, not the full review bodies).

## Behavior

1. **Open the dedicated `playwright-cli` session.** Open your assigned session at the start: `npx playwright-cli -s=<journey-slug>-<pass>-stage-b open --browser=chromium <baseURL>`. Sessions are OS-isolated by construction — there is no isolation-prerequisite check (see [`../../element-interactions/references/playwright-cli-protocol.md`](../../element-interactions/references/playwright-cli-protocol.md) §1). Close it at the end with `npx playwright-cli -s=<your-slug> close`.
2. **Read on-disk context.** Read the journey block, page-repo slice, app-context slice. Read the Stage A return in full. Do not hold unrelated journey blocks or other subagents' transcripts.
3. **Read the tests (compositional passes).** For passes 1–3, read every `.spec.ts` file Stage A wrote or modified this cycle. For passes 4–5, read the ledger entries, any regression test files, AND the negative-case matrix Stage A was given (per §"Inputs" item 6). Cross-reference the matrix against ledger entries: every matrix entry MUST appear as a ledger finding (`Boundaries verified`, `Suspected bugs`, or `Ambiguous`). A matrix entry with no corresponding ledger finding is a coverage gap Stage A failed to probe.
4. **Navigate the live app via `playwright-cli`.** Use your dedicated session to inspect the pages the journey touches: `npx playwright-cli -s=<your-slug> goto <URL>`, then `npx playwright-cli -s=<your-slug> snapshot` and `... eval`/`... cookie-get`/`... requests` as needed. Verify that the tests' assertions match the live DOM. For adversarial passes, independently attempt 2–3 probes that Stage A did not try — pick categories under-represented in Stage A's probe list, prioritising matrix entries that have no ledger finding.
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
- **Do not reuse a prior reviewer's context.** Every reviewer dispatch is a fresh subagent with a fresh `playwright-cli` session. The fresh-eyes property is load-bearing; inheriting context from the previous cycle's reviewer (or from the paired Stage A) defeats the adversarial role.
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
1. Open your dedicated playwright-cli session:
       npx playwright-cli -s=<journey-slug>-<pass>-stage-b open --browser=chromium <baseURL>
   (Sessions are OS-isolated by construction — no prerequisite check.)
2. Read Stage A's output:
   - Passes 1–3: read the .spec.ts files Stage A wrote or modified (paths in the Stage A return).
   - Passes 4–5: read the ledger entries Stage A appended this cycle and any regression-test files Stage A wrote (paths in the Stage A return).
3. Navigate the live app via playwright-cli. Inspect each page the tests claim to exercise (`-s=<your-slug> goto / snapshot / eval`). For passes 4–5, additionally attempt 2–3 adversarial probes Stage A did not try this cycle — pick categories under-represented in Stage A's probe list.
4. Classify findings per §2.4 of the canonical return schema.
5. Apply must-fix calibration per the reviewer contract.
6. Detect stalled loops — if your must-fix list matches BOTH the prior-1 AND prior-2 cycles' lists (three identical lists in a row), flag stalled:true. Never flag from cycles 1–2 (the three-cycle condition cannot hold). See full rule in step 7 of this contract.
7. **If your verdict is `improvements-needed`, apply the §2.6 spillover contract** — write the full `missing-scenarios:` / `craft-issues:` / `verification-misses:` sub-lists to `tests/e2e/docs/.subagent-returns/reviewer-<journey-slug>-<pass>-c<cycle>.md` (start the file with the sentinel comment `<!-- subagent-returns:reviewer:<journey-slug>:pass-<N>:cycle-<C> -->`). Your return body inlines only the index-level fields — `status`, `journey`, `pass`, `cycle`, `spill: <path>`, and a `findings:` list of finding-IDs (no inline blocks). A harness `SubagentStop` rewrite-gate enforces this — non-compliant returns are blocked at stop and you rewrite in-session. `greenlight` returns are exempt from spillover (already index-only by definition). See [harness-hooks.md](../../element-interactions/references/harness-hooks.md).
8. Close your session: `npx playwright-cli -s=<your-slug> close`. Return using the canonical schema. Do NOT commit, do NOT modify files, do NOT append to the ledger. Do NOT run `close-all` (the parent owns that).
~~~

---

## Batch reviewer mode (cycle-1 compositional only)

The batch reviewer is one Opus reviewer per pass that reads all in-flight journeys' spill files plus the journey-map slice plus the page-repository, and emits per-journey verdicts in a single return. Used for compositional Pass-1/2/3 cycle-1 reviews only; adversarial passes (4–5) and cycle-2+ retries always remain `mode: per-journey`.

The cross-journey synthesis is a real upgrade, not just a cost optimisation: a single reviewer reading 30 returns at once can flag "journey X surfaced pattern Y but journey Z missed it"; the per-journey reviewer is structurally blind to siblings.

### Inputs (given at dispatch time)

1. **Map slice**: the relevant `### j-<slug>` blocks for every in-flight journey, in `journey-map.md` order.
2. **Page-repo slices**: one consolidated page-repo entry list covering every page touched by any in-flight journey.
3. **Pass + cycle**: explicit (always cycle 1; pass ∈ {1, 2, 3}).
4. **Stage A returns**, per journey, in one of two forms (the orchestrator's brief picks per-journey based on Stage A's status):
   - **`status: new-tests-landed`** (the dominant case at compositional cycle-1) → the orchestrator passes the composer's full structured return body in the brief. Composer spillover does NOT trigger for `new-tests-landed` (per `subagent-return-schema.md` §2.6 — only `covered-exhaustively` triggers composer spillover, since `new-tests-landed` returns are already index-only). The brief includes: committed test paths, discovery report, expectations-mapped count, and any other index-level fields the composer emitted.
   - **`status: covered-exhaustively`** → the brief points at the §2.6 spill file at `tests/e2e/docs/.subagent-returns/composer-<JOURNEY>-<pass>-c1.md`. The reviewer reads the spill for the full per-expectation mapping table.

   The reviewer reads whichever form is provided; the brief construction is the orchestrator's responsibility.
5. **Per-journey gated-skip evidence**: journeys flagged `gated_skip: true` in the state file (per `coverage-expansion/SKILL.md` §"Trigger-gated re-pass") are excluded from the batch reviewer's roster — no review needed. The roster is the journeys whose Stage A actually dispatched this cycle.
6. **App-context slice**: the consolidated `app-context.md` sections for every page touched.
7. **No live app** — see §"Behavior" item 2 below for why the batch reviewer is a static reader.

### Behavior

1. **No `playwright-cli` session.** A batch reviewer is a static reviewer of Stage A spill files + map + page-repo. Live-app verification is per-journey work; the per-journey contract still applies for any journey the batch reviewer flags `improvements-needed`. The follow-up cycle-2 reviewer opens its own session per the legacy contract.
2. **Read every spill file** in the in-flight roster. Cross-reference each journey's spill against:
   - Its `Test expectations:` list in the map block (every expectation must have a covering test in the spill's mapping table).
   - The page-repo slice (selectors used in tests must exist in the page-repo).
   - Sibling spills (cross-journey consistency: pattern X surfaced in journey A but missed in journey B that shares the same page).
3. **Apply the must-fix calibration** from §"Behavior" item 6 of the per-journey contract — same recording rules. The batch reviewer is judging the same shape of finding, just across many journeys at once.
4. **Return per-journey verdicts** in a single structured return. The schema is the per-journey return schema (§2.4) wrapped in a top-level array:

   ```yaml
   handover:
     role: reviewer-batch-pass-<N>
     status: batch-complete
     pass: <N>
     cycle: 1
     verdicts:
       - journey: j-create-user
         status: greenlight
         summary: <one-line>
       - journey: j-zb-view-orders
         status: improvements-needed
         spill: tests/e2e/docs/.subagent-returns/reviewer-batch-pass-<N>-c1.md
         findings: [j-zb-view-orders-1-1-R-01, j-zb-view-orders-1-1-R-02]
       - journey: j-tt-permission-form-modal
         status: greenlight
         summary: <one-line>
   ```

   Greenlit journeys carry only a one-line `summary` — no spill file, no findings list. Flagged journeys carry the §2.6 spillover shape (`spill:` path + `findings:` list); the spill file is appended to the same `tests/e2e/docs/.subagent-returns/` directory but under a single filename naming the batch:

   ```
   tests/e2e/docs/.subagent-returns/reviewer-batch-pass-<N>-c1.md
   ```

   Inside that file, sections are namespaced by journey:

   ```markdown
   <!-- subagent-returns:reviewer-batch:pass-<N>:cycle-1 -->

   ## j-zb-view-orders

   ### missing-scenarios
   - **j-zb-view-orders-1-1-R-01** [must-fix] — mobile variant absent

   ### craft-issues
   - **j-zb-view-orders-1-1-R-02** [must-fix] — inline selector in spec

   ## j-other-journey-flagged

   ### verification-misses
   - **j-other-journey-flagged-1-1-R-01** [must-fix] — assertion targets a different element than tested
   ```

   Every flagged journey's section starts with `## j-<slug>`. The §2.6 sentinel goes at the top of the file (line 1).

5. **Stalled-loop detection does NOT apply** — batch mode is cycle-1 only. Stall detection is a cycle-3 mechanic; if a journey reaches cycle 3 without resolving, the per-journey reviewer flags it.

### Hard constraints (batch-specific)

- **The cycle-1 wave of pass N only.** A batch reviewer dispatched at cycle ≥ 2 within any pass, or at any cycle in adversarial Pass 4 / Pass 5, is a contract violation. One batch reviewer per compositional pass; the constraint applies independently per pass.
- **Compositional passes only.** Pass 4 and 5 dispatch one reviewer per journey, never a batch.
- **No live app.** The batch reviewer is a static reader; for any flagged journey that needs live-app verification, the orchestrator follows up with a `mode: per-journey` cycle-2 reviewer that opens its own session.
- **One return per pass.** The batch reviewer's return is a single object with a `verdicts:` array; the orchestrator parses verdicts and dispatches per-journey cycle-2 reviewers for any `improvements-needed` entry.
- **Dispatch-guard carve-out.** `hooks/coverage-expansion-dispatch-guard.sh` skips its meta-content leak check for descriptions matching `^reviewer-batch-pass-[0-9]+:` — the batch brief references compositional pass scope by construction, so those phrases are part of the rule rather than a leak.
- **Return-shape enforcement is markdown-only (for now).** `subagent-spillover-rewrite-gate.sh` and `subagent-return-schema-guard.sh` do not yet recognise the `reviewer-batch-pass-<N>` role-prefix or the `verdicts:` array shape; a non-compliant batch return will land in the orchestrator's transcript without harness intervention. Hook backstop is a follow-up.

### Dispatch prefix

The orchestrator dispatches batch with `description: "reviewer-batch-pass-<N>: cycle 1"`. The `reviewer-` family prefix is already recognised by `coverage-expansion-dispatch-guard.sh`; the `-batch-` infix triggers the batch return-shape validation in the schema-guard.
