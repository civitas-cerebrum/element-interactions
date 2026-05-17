# Depth-Mode Pipeline — Per-Pass Detail, Parallelism, Model Selection

**Status:** authoritative spec for the 5-pass depth-mode pipeline. Cited from `coverage-expansion/SKILL.md` §"Modes".
**Scope:** the full per-pass pipeline (steps 1–8), pass differences, commit-message conventions, per-pass completion criteria, the whole-suite re-run gate, the parallelism model, model selection, auto-compaction, re-pass mode for compositional passes 2–3, and batched dispatch for P3 peripheral journeys.

For the dual-stage retry loop (Stage A↔B per journey per pass), see `references/dual-stage-retry-loop.md` (also cited from `SKILL.md`).
For the state-file schema and per-journey dispatch entry fields, see `references/state-file-schema.md`.
For the isolated-subagent contracts, see `references/subagent-isolation.md`.
For consolidated anti-rationalization patterns referenced throughout this doc, see `references/anti-rationalizations.md`.

---

## Depth mode — five-pass pipeline (3 compositional + 2 adversarial) + cleanup

Each pass runs a journey-by-journey pipeline with parallel dispatch where independent. The map grows between compositional passes; the adversarial ledger grows during adversarial passes. After pass 5, a single cleanup subagent dedupes the ledger.

### Per-pass pipeline

Every pass in depth mode runs this pipeline; steps 4 and 7 differ between compositional (1–3) and adversarial (4–5) passes.

1. **Read the map** (sentinel-verified). Build an in-memory index: `[(j-id, priority, pages-touched, test-expectations)]`. Read **only** these fields per journey — not full step lists, branches, or state variations.
2. **Recompute priority ordering.** Honour the map's priorities, but if a journey's `Test expectations` or pages touched have changed since the last pass, adjust position.
3. **Build the journey independence graph.** The graph is the same across compositional and adversarial passes.
4. **Emit the per-pass scope preview** (the declarative pre-dispatch summary documented near the end of §"Model selection" — `[coverage-expansion] Pass <N>/5 — dispatching ...`). Declarative only; no confirmation prompt.
5. **Run the per-journey dual-stage retry loop** for every journey in the map — parallel for independent journeys, sequential for dependent ones, per §"Parallelism". Each journey's A↔B loop follows [`dual-stage-retry-loop.md` §"Retry loop"](dual-stage-retry-loop.md). The loop terminates when the journey has one of the four terminal `review_status` values.
   - Model selection per §"Model selection" — default opus for both stages.
   - P3 batching narrowed per §"Batched dispatch for P3 peripheral journeys" — Stage A may be batched; Stage B never is.
6. **Collect all journey outputs.** Each journey contributes: its committed test files (from the final greenlit or blocked-with-tests-landed Stage A cycle), its `review_status`, its cycle counts, and (if blocked) its final `must-fix` list. The orchestrator does NOT hold Stage A test source or Stage B review bodies — only structured summaries and the on-disk file paths.
7. **Reconcile artefacts.**
   - **Compositional passes:** reconcile the map. Append new branches to existing journey blocks. Add new `j-<slug>` or `sj-<slug>` blocks for newly-discovered journeys or sub-journeys. Append new pages/elements to `app-context.md`. Run a mini Phase 3.5 revision (see `journey-mapping`) if the pass introduced new overlaps.
   - **Adversarial passes:** the map is NOT reconciled. The ledger file is authoritative; its content is already written by the subagents during their append step. Aggregate the return summaries into the orchestrator's running adversarial-totals counter (journeys probed, boundaries verified, suspected-bug count by severity, regression tests added).
8. **Commit, then update state file.** One commit per journey (compositional passes) or per journey per pass (adversarial passes). See §"Commit-message conventions" below for the exact templates. After the commit lands, rewrite `tests/e2e/docs/coverage-expansion-state.json` with the new pass counter, per-journey `dispatches[]` entries (including `stage_a_cycles`, `stage_b_cycles`, `review_status`, `final_must_fix`), and adversarial totals. Then run the auto-compaction check (§"Auto-compaction between passes") before the next pass's dispatch.

### Pass differences

| Pass | Kind | Purpose |
|---|---|---|
| 1 — initial perception | compositional | Cover the map as produced by `journey-mapping`. Priorities as written. Each journey gets its full variant set (per `Test expectations:`). Map grows with whatever surfaces. Dispatches `test-composer` per journey. |
| 2 — map-growth widening | compositional | Re-read the enriched map. Promote newly-discovered branches and sub-journeys to first-class journeys where they warrant it. Re-evaluate priorities. Re-attempt any journey where pass 1 deferred stabilization or returned coverage gaps. Dispatches `test-composer` per journey. |
| 3 — consolidation | compositional | Final sweep on the refined map. Focus on cross-journey interactions, residual gaps, data-lifecycle variants that require wiring multiple journeys together, and any journey whose map block was materially refined in pass 2. Dispatches `test-composer` per journey. |
| 4 — adversarial probing | adversarial | One adversarial turn per journey. Dispatches a probe subagent (see `references/adversarial-subagent-contract.md`) that invokes `bug-discovery` scoped to the journey. The probe covers the full QA-engineer test matrix for the journey — a deterministic negative-case complement for every positive `Test expectations:` entry plus cross-cutting negatives (auth tamper, tenant isolation, idempotency, session boundary, input boundaries) — in addition to `bug-discovery`'s open-ended categories. Findings are appended to `tests/e2e/docs/adversarial-findings.md` — no tests are written in pass 4. |
| 5 — adversarial consolidation | adversarial + regression | Second adversarial turn. Each subagent reads its journey's pass-4 ledger section, re-probes any negative-case-matrix entries that returned `Ambiguous`, attempts compound probes that combine matrix entries (e.g., auth-tamper × idempotency, tenant-isolation × session-boundary), and writes **passing** regression tests for every verified boundary (pass 4 + pass 5 combined) into `j-<slug>-regression.spec.ts`. Suspected bugs remain ledger-only — never committed as `test.fail()`. |

After pass 5: one single-dispatch cleanup subagent dedupes the ledger. See §"Ledger dedup" below.

### Commit-message conventions

One journey per commit, one template per pass kind. Agents MUST NOT reinvent the format — the git log has to be filterable by `<j-slug>` and by pass kind.

| Pass / phase | Commit-message template | Notes |
|---|---|---|
| Compositional passes (1–3) | `test(<j-slug>): <variant>` | One journey per commit, always. `<variant>` names the variant added (e.g. `happy-path`, `error-states`, `mobile`, `data-lifecycle`). If a single composer invocation adds multiple variants, produce one commit per variant. |
| Adversarial pass 4 | `docs(ledger): <j-slug> — N probes, M boundaries, K suspected bugs` | One commit per journey. Commit diff is the ledger file only. `N`, `M`, `K` come from the subagent return's structured summary. |
| Adversarial pass 5 — regression | `test(<j-slug>-regression): lock <boundary-description>` | One commit per verified-boundary regression test authored. `<boundary-description>` is a short phrase naming the boundary being locked (e.g. `empty-cart-checkout-rejected`, `nav-cart-badge-clears-after-checkout`). |
| Per-pass dedup — compositional (passes 1–3) | `docs(ledger): pass <N> test dedup` | One commit per compositional pass, after Stage B greenlights and before the next pass. Commit diff is the consolidated test files (or a notes-only file if no consolidation was needed). |
| Per-pass dedup — adversarial (passes 4–5) | `docs(ledger): pass <N> findings dedup` | One commit per adversarial pass, after every journey's findings are appended and before the next pass. Commit diff is `tests/e2e/docs/adversarial-findings.md` only. |
| Cleanup (post-pass-5 cross-pass dedup) | `docs(ledger): dedupe cross-cutting findings` | Single commit from the one cross-pass cleanup subagent that runs once after Pass 5's per-pass findings dedup. Cross-pass synthesis only — within-pass dedup is owned by the per-pass step. |
| Pass-4 prelude (app-wide scan) | `docs(app-wide): pattern catalogue established (pre-pass-4)` | Single commit at the start of Pass 4, before any per-journey probe is dispatched. Commit diff is `tests/e2e/docs/app-wide-patterns.md` only. |

**Stage B returns do NOT produce their own commits.** Reviewer judgements are captured in the state file's per-journey `review_status` and `final_must_fix` fields — never as commits. The git log records what landed (Stage A's tests, ledger entries, regression locks) but not the review trail; the state file records the review trail. Mixing reviews into commits creates a diff-noisy log that obscures the actual change history.

Anti-patterns — do NOT use:
- `test(pass5): j-xxx — <summary>` (pass number goes in the `-regression` suffix, not the scope)
- `feat(e2e): …` (coverage expansion is never `feat`)
- `test(j-xxx, j-yyy): …` (one journey per commit — no multi-journey commits even when batched)
- `review(j-xxx): …` or any review-tagged commit (Stage B never commits — see above)
- `fix(…): …` for new tests (use `test(…)`; `fix` is for fixing existing code)

### Per-pass completion criteria

A pass is complete only when **every** criterion for that pass is met. "Ran some journeys, ran out of budget" is not complete — see `coverage-expansion/SKILL.md` §"Non-negotiables for depth mode" for the resume-state contract.

- **Pass 1** complete = `test-composer` has been dispatched for and has returned on **every** journey in the map. Not "enough journeys", not "the P0/P1 tier", not "the journeys that fit the budget". Every journey.
- **Pass 2** complete = `test-composer` has been re-dispatched and returned for every journey, AND the map has been reconciled with any newly-promoted branches or sub-journeys surfaced in pass 1 or 2, AND — if the reconciliation produced map edits — the reconciliation commit has landed. If no map edits were needed, the pass still completes, but the orchestrator records `"pass 2 reconciliation — no map edits required"` in the state file / progress log rather than silently skipping the commit.
- **Pass 3** complete = cross-journey and data-lifecycle variants have been dispatched for every journey whose `Test expectations:` calls for them, AND any journey that returned residual coverage gaps in passes 1 or 2 has been re-attempted, AND the pass commit has landed (if tests were added in this pass).
- **Pass 4** complete = (a) the app-wide-scan prelude has emitted `tests/e2e/docs/app-wide-patterns.md` with the canonical sentinel (per `references/app-wide-scan.md`), AND (b) the adversarial-probe subagent has run for every journey in `journeyRoster - adversarialSkippedJourneys[].journey`, with terminal `review_status`. Journeys in `adversarialSkippedJourneys[]` are validly excluded per [`coverage-expansion/SKILL.md`](../SKILL.md) §"P3 small-surface journeys may opt OUT of adversarial passes". For every dispatched journey, the subagent's findings are appended to `tests/e2e/docs/adversarial-findings.md`. If no probes landed for a given dispatched journey (e.g., the subagent found nothing to probe or was gated), the orchestrator records `"no boundaries probed — <reason>"` for that journey in the ledger — it does NOT silently skip the journey. An empty ledger section for a dispatched journey is a bug, not a pass-4 completion state. The app-wide-scan prelude itself does NOT count toward the per-journey dispatch total — it is exempt per `app-wide-scan.md` §"Hard constraints".
- **Pass 5** complete = every verified pass-4 finding has either a committed regression test in `j-<slug>-regression.spec.ts` OR an explicit decline-with-reason line in the ledger ("no regression written — finding classified as suspected bug / ambiguous / duplicate of cross-cutting #N"). Regression-test files are committed per journey.
- **Per-pass dedup** complete (every pass 1–5) = one cleanup subagent has run for the pass, the within-pass consolidation commit (`docs(ledger): pass <N> test dedup` for compositional passes, `docs(ledger): pass <N> findings dedup` for adversarial passes) has landed (with empty diff + a "no consolidation" log entry if nothing was merged), AND the whole-suite re-run gate has passed since the dedup commit. The next pass does NOT dispatch until this criterion holds.
- **Post-pass-5 cross-pass cleanup** complete = one cross-pass cleanup subagent has run once, cross-cutting findings are consolidated into the top-level section with backrefs in each journey's section, and the commit `docs(ledger): dedupe cross-cutting findings` has landed. This is in addition to Pass 5's per-pass findings dedup — the cross-pass cleanup synthesises across all five passes' ledger contributions.

Only when **all** of the above are true may the orchestrator report depth-mode coverage-expansion complete to its caller. Anything less is a partial run and must be reported as such (see the resume-state contract).

**Dual-stage extension.** On top of the per-pass criteria above, a pass is complete only when **every dispatched journey has a terminal `review_status`** (`greenlight`, `blocked-cycle-stalled`, `blocked-cycle-exhausted`, or `blocked-dispatch-failure`) recorded in the state file's `dispatches[]` array. For Passes 4 and 5, "every dispatched journey" means every journey in `journeyRoster - adversarialSkippedJourneys[].journey`. A pass where every journey's Stage A returned but some journeys have no `review_status` is **incomplete**, even if the per-pass criteria above appear satisfied. Stage B participation is part of the completion gate, not optional.

### Whole-suite re-run gate (per-pass exit)

After a pass's per-journey subagents return clean and per-pass completion criteria are satisfied, run the whole-suite re-run gate documented in `../element-interactions/references/test-optimization.md` §7.

**Procedure:** identical to the canonical procedure documented in `../element-interactions/references/test-optimization.md` §7. Summary:

1. From the harness root: `npx playwright test --reporter=json > .stage4a-suite.json`.
2. Parse the JSON. Playwright's reporter writes `{ stats: { expected, unexpected, flaky, skipped, ... }, suites: [...] }`. Refuse to advance to the next pass if:
   - `stats.unexpected > 0` (includes timed-out, failed, interrupted), OR
   - `stats.skipped` exceeds the count of explicit `test.skip(` markers across spec files (`grep -rh '^\s*test\.skip\b' tests/e2e --include='*.spec.ts' | wc -l`).
3. On refusal, return `{ status: 'whole-suite-gate-failed', pass: <N>, stats: {...}, failures: [...], skips_unexplained: <delta> }` and DO NOT invoke the next pass. Resume on this pass once the caller resolves the failures.
4. Delete `.stage4a-suite.json` after parsing.

**Why it runs here:** per-journey subagent stabilization confirms each journey's tests pass in isolation, but cumulative state across the suite (DB pollution, port collisions, fixture drift, shared-resource depletion) only surfaces when the whole suite runs together. Running this gate at every pass exit catches integration-time regressions at the earliest pass that introduces them, rather than at end-of-pipeline.

**Harness backstop (issue #131).** The same gate is enforced at the commit boundary by a windowed `Bash`-event ratchet that blocks phase-progression commits when the recent suite-run history is red, unfilled, or stale. Window-size override available — see the hook header for specifics, and [harness-hooks.md](../../element-interactions/references/harness-hooks.md) for the index entry.

The windowed shape catches a class of failure single-shot gates miss: serial-mode flakes, click-PUT race conditions, and auth-state eviction that pass an isolated single run but fail across 3-5 reviewer-driven re-runs. A flake that passes 70% of the time can't displace a failed entry from the window — by design — so the gate can't be cleared by one lucky re-run after a real regression. Pair this with the orchestrator-side check above for end-to-end coverage: orchestrator-side fires at every pass exit; the harness ratchet fires at every commit on top of the same window.

### Parallelism

The parallelism model has three layers:

#### Independence graph (unchanged semantics)

Two journeys are **dependent** if they touch a non-universal page in common. Universal pages (login, homepage, global nav) are ignored. Independent journeys can run in parallel; dependent ones must serialize to avoid tab-sharing corruption.

Co-residence on pages is the only dependency signal. Two journeys that both touch `/admin/users` are dependent even if one only reads and one mutates — tab sharing is the bug, not data-layer contention.

#### Intra-group pipelining (dual-stage)

Within an independence group:
- **Both stages are parallel by default.** Stage B is not a serial follow-up to Stage A — it is dispatched per-journey-as-soon-as-Stage-A-returns, sharing the parallel pool with sibling journeys' Stage A retries. An orchestrator that finishes Stage A for the whole pass and then begins Stage B serially is implementing a different (slower, contract-violating) protocol.
- All journeys in the group start Stage A concurrently (subject to the parallel cap — see below).
- Each journey's Stage B fires **as soon as that journey's Stage A returns** and the parallel cap has a slot — not after the whole group's Stage A completes.
- Each journey's Stage A retry fires **as soon as that journey's Stage B returns with `improvements-needed`** and the cap has a slot.
- Journeys in the same group ride their own A↔B pipelines in parallel. A journey on cycle 3 and a sibling on cycle 1 coexist.

Across independence groups: groups run in priority order, each group exhausting parallelism before the next group starts.

#### Parallel cap — lifted and jointly applied

Previous: `min(4, credentials-per-role)` with batching for P3.
New: **`host max`** — the orchestrator uses whatever parallel width the dispatch primitive allows. An explicit user override is accepted (`args: "parallel-cap: 8"`), otherwise no artificial ceiling beyond the shared-resource audit's credential-contention findings (PR #106).

**The cap counts Stage A and Stage B dispatches jointly.** There is one pool of in-flight subagent slots; A and B compete for the same slots within a group. A journey's own A and B never overlap (sequential within a journey), but across journeys any A/B interleaving is possible. When the cap is saturated, new dispatches — whether A, B, or A-retry — queue until a slot frees. Queue order is FIFO; the orchestrator does not prioritise A over B or vice versa.

#### Shared-resource audit interaction

The Phase-0 shared-resource audit (PR #106) still caps parallelism where the app genuinely can't tolerate more (single credential per role, rate limits, CSRF serialization). Those caps override the host-max default. The audit's constraint tags apply to Stage A AND Stage B equally — reviewers compete for the same credentials.

### Model selection

Model selection per dispatch type — see [`coverage-expansion/SKILL.md`](../SKILL.md) §"Hybrid model selection — Pass 1, Pass 4, Pass 5 on Opus, Pass 2/3 execution on Sonnet, all review on Opus" for the canonical table. Pass 5 is the regression layer — its targeted probes and regression-test authoring run Opus because the artifacts they produce are durable; Pass 4's adversarial probes also run Opus because their findings are the input to that regression layer. The kernel rule supersedes any prior cost-blind / opus-default framing.

Before every pass dispatch (step 4 of the per-pass pipeline), emit a declarative scope preview. The preview is informational only — there is no confirmation prompt, no timeout, no abort option, and no reduce-scope offer. The contract is every journey in the (roster − adversarialSkippedJourneys), every pass; the preview makes that contract explicit so any mid-pass rationalisation is visible against the declared scope.

Template (values filled in per pass, from the map index, independence graph, and dispatch heuristic):

```
[coverage-expansion] Pass <N>/5 — dispatching <test-composer | adversarial probe> per journey
  Journeys: <count> (<delta-note, e.g., "3 newly promoted in pass <N-1>">)
  Independence graph: <G> groups, <K>-way parallel dispatch possible (cap <C>)
  Model mix: per dispatch-type table in `coverage-expansion/SKILL.md` §"Hybrid model selection".
  Expected wall-clock: ~<H>h at <K>-parallel
  Contract: every journey in the (roster − adversarialSkippedJourneys), this pass.
```

The model-mix figures derive from the canonical table; consult that section for the per-dispatch-type defaults and override paths. The wall-clock estimate is a ballpark from the per-subagent run times observed so far this run (or a default of ~20 min per opus dispatch if no prior data exists).

Completion check: if a pass starts with N journeys and ends with returns from fewer than N, the orchestrator must re-dispatch the missing journeys before claiming the pass is complete. The preview's journey count is the ground truth for the end-of-pass reconciliation.

### Auto-compaction between passes

Between passes — after the per-pass commit and state-file rewrite (step 8), before the next pass's dispatch — the orchestrator checks its own context usage. Context exhaustion is a transparent seam, not a pipeline-halt.

If the orchestrator's context is **>70% consumed**:

1. Write full state to `tests/e2e/docs/coverage-expansion-state.json` (journey roster, completed IDs, in-flight IDs, pass counter, adversarial totals, AND the dual-stage `dispatches[]` per-journey fields — `stage_a_cycles`, `stage_b_cycles`, `review_status`, `final_must_fix` — the shape documented in [`state-file-schema.md`](state-file-schema.md) (the canonical schema; kernel-resident invariants are in `coverage-expansion/SKILL.md` §"Authoritative state file")). The dual-stage fields MUST be written before the compaction crosses; without them the post-compact resume cannot reconstruct which journeys are mid-A↔B-cycle, which are blocked, or which are greenlit.
2. Emit exactly one line: `[coverage-expansion] context approaching budget — auto-compacting and resuming from state file`.
3. Invoke `/compact` (or the platform-equivalent compaction primitive exposed to the orchestrator).
4. On the post-compact turn, the skill's first action — reading the state file — picks up the run exactly where it left off, including any in-flight A↔B cycles. That's why [`state-file-schema.md`](state-file-schema.md)'s "read first, always" rule is non-negotiable.

**Mid-cycle compaction.** The 70% threshold is checked between passes by default, but if a single journey's A↔B retry loop pushes context past 70% mid-pass, the same flow applies: write state with the in-progress `stage_a_cycles` / `stage_b_cycles` / latest reviewer findings, then compact.

**In-flight Stage A returns must be persisted before compaction.** §10 of the design spec says the orchestrator never holds Stage A test source or Stage B review bodies in steady state — but during the brief window between Stage A return and Stage B dispatch, the Stage A return body is necessarily in orchestrator memory. If compaction crosses during that window, the return body would be lost. Mitigation: when an A↔B cycle is mid-flight at compaction time, the orchestrator **persists the latest Stage A return to a scratch file** at `tests/e2e/docs/.coverage-expansion-cycle-<journey-slug>-cycle-<N>.json` before compacting. The post-compact resume reads this scratch file as if it were a fresh Stage A return and proceeds to Stage B dispatch. The scratch file is deleted after the cycle terminates (any of the four `review_status` values) and the per-pass commit lands. Mid-cycle restart from Stage A is NOT acceptable — it would re-run a potentially expensive opus dispatch and lose the discipline gain from the prior cycle's reviewer findings.

**Platform note.** If no programmatic compaction primitive is available to the orchestrator, the skill must still make the seam safe for manual compaction: emit an unambiguous `[coverage-expansion] safe to compact — state is durable at tests/e2e/docs/coverage-expansion-state.json, resume with the same invocation args` line between passes whenever the >70% threshold is crossed. The user can then compact manually without losing progress, and the next turn resumes from the state file the same way.

Framing: this is a platform-aware seam for long runs. It is not a cost-reduction mechanism. The optimisation target remains complete coverage; auto-compaction exists so complete coverage doesn't get halved by a context ceiling.

**Rationalizations to reject:**

> ↗ Cross-cutting category: see [`anti-rationalizations.md` §"Auto-compact threshold creep"](anti-rationalizations.md).

| Excuse | Reality |
|--------|---------|
| "Context is at 75% but I can push one more pass before compacting" | 70% is the floor, not a guideline. Every pass adds subagent-return summaries that grow the state file and the running adversarial totals. One more pass from 75% often lands at 95%+ and forces an in-pass compact that loses roster state not yet committed. |
| "I'll compact at 50% to be safe" | Preemptive compaction destroys the prompt cache unnecessarily. 70% is the threshold because below it the seam costs more than it saves. |
| "The state file is small, there's nothing to save before compacting" | The state file is not the point — the orchestrator's own context (subagent returns, map index, reconciliation scratch) is. State is written *so* compaction is safe. Skipping the write because "state is small" is the bug. |
| "I'll run Pass 4 to finish the compositional-to-adversarial boundary, then compact" | The compositional-to-adversarial boundary is inside the pass loop, not at 70%. If the threshold was crossed before Pass 4, compact before Pass 4. |
| "Auto-compact failed once so I'll skip it this time" | The fallback is the manual-compaction safe-seam message, not silent progression. If `/compact` errors, emit the safe-compact line and stop; the user compacts and re-invokes. Never continue past 70% without either auto- or manual-compaction. |

### Re-pass mode for compositional passes 2–3

Passes 2 and 3 dispatch `test-composer` with an explicit `mode: re-pass` argument **when at least one of the orchestrator's three per-journey triggers fires** (per `coverage-expansion/SKILL.md` §"Trigger-gated re-pass for Passes 2 & 3"). When all three triggers are false, the orchestrator writes a gated-skip entry to the state file and never dispatches — Pass 1 already composed the journey's full variant set, and the orchestrator-side three-trigger check is sufficient evidence that no re-pass work is needed.

The §"Trigger-gated re-pass" content below describes the **dispatched path** — what the subagent does once a trigger has fired and the orchestrator has decided to invoke it.

**Orchestrator-side triggers vs subagent-preamble triggers** — when the orchestrator's gating fires, the dispatched subagent runs the legacy four-trigger discipline (full-inspection-and-confirm). The mapping:

- Orchestrator `map_delta` → subagent triggers 1+2 (delta markers + Pass-1 coverage-gaps).
- Orchestrator `sibling_ledger_update` → subagent trigger 3 (sibling-bug regression candidates).
- Orchestrator `must_fix_carry_over` → subagent trigger 4 (unresolved review findings).

The orchestrator's three triggers are pre-dispatch evidence; the subagent's four triggers are the in-dispatch audit. They are the same shape of evidence at two different times.

**Preamble embedded in every pass-2 / pass-3 test-composer brief:**

> You are a re-pass subagent. Pass 1 already composed this journey. Pass 2/3 work is valuable only when:
> - The journey map was materially enriched since Pass 1 (look for delta markers against the pre-pass journey block).
> - The journey's Pass-1 return reported `coverage-gaps: [...]` or `stabilization: deferred`.
> - A sibling journey surfaced a bug that should be regressed here too.
> - The prior pass's Stage B reviewer flagged `must-fix` items that Stage A did not resolve (the journey's `review_status` was `blocked-cycle-stalled` or `blocked-cycle-exhausted` last pass). Those unresolved findings are embedded in your brief — address them.
>
> You must perform the full inspection regardless — read the current journey block, read the Pass-1 return, read any sibling-bug ledger entries. Only *after* inspection may you return `status: covered-exhaustively` with:
> - a per-expectation mapping table showing which test covers which Pass-1 expectation,
> - an explicit check against each of the four triggers above ("trigger 1: no delta markers since Pass 1", "trigger 2: Pass-1 return reported no gaps or deferred stabilization", "trigger 3: sibling-bug ledger contains no regression candidates for this journey", "trigger 4: no unresolved review findings carried forward from the prior pass"),
> - no unexplained shorthand.
>
> **No tool-use budget. No tool-use cap.** Cost is not the optimisation target; signal quality is. The value of a re-pass is disciplined evidence that Pass 1 was exhaustive. An undisciplined cheap no-op is worse than a thorough no-op.

The re-pass mode's contribution is **disciplined justification**, not speed. Every return becomes an auditable artifact — either new tests with their rationale, or `covered-exhaustively` with the full mapping table and the three-trigger check. The orchestrator rejects any pass-2 / pass-3 return that does not include the per-expectation mapping and the three-trigger check, and re-dispatches that journey.

**Rationalizations to reject (subagent side):**

> ↗ Cross-cutting category: see [`anti-rationalizations.md` §"Self-certifying greenlight"](anti-rationalizations.md).

| Excuse | Reality |
|--------|---------|
| "Obvious no-op — I'll mark `covered-exhaustively` without reading Pass-1 returns" | The three-trigger check requires evidence. Fabricating "Pass-1 reported no gaps" without reading the return is the exact failure the orchestrator's rejection-and-redispatch step is designed to catch; the redispatch wastes more time than reading the return would have. |
| "The mapping table is obvious, I'll shorthand it" | Shorthand fails the orchestrator's check. The mapping table enumerates each expectation with the specific test covering it — not "all covered by existing tests". One-line-per-expectation or redispatch. |
| "Sibling-bug ledger is probably empty for this journey, skip it" | The check is "I read the ledger and found no regression candidates for this journey", not "I assumed there are none". Skipping the read is skipping the trigger. |
| "No tool-use budget means I can spam tool calls freely" | "No budget" is a signal that signal quality matters more than cost; it is NOT an invitation to over-probe. Use the tools needed to satisfy the three triggers and no more. |
| "Pass 1 was thorough so Pass 2/3 is always `covered-exhaustively`" | The three triggers explicitly include "map delta since Pass 1" and "sibling-bug regression candidate" — conditions that can only be evaluated at Pass 2/3 time, not inherited from Pass 1's confidence. The returning-it-without-inspection shortcut voids the pass. |

**Orchestrator-side rejection check.** When a pass-2 or pass-3 return arrives, the orchestrator greps the return for (a) the literal strings "trigger 1", "trigger 2", "trigger 3", "trigger 4", (b) a mapping-table header row, and (c) per-expectation entries. If any is missing the orchestrator re-dispatches the journey with a brief explicitly quoting the rejected parts. The orchestrator does NOT accept partial returns as a concession to save re-dispatch cost — the discipline holds on both sides.

### Relevance grouping for compositional passes

**Trigger.** A priority tier in scope for a compositional pass (**2 or 3** — Pass 1 is strict per-journey under `mode: standard`, no grouping; see `coverage-expansion/SKILL.md` §"Stage A per-journey dispatch is non-negotiable" for the first-pass strict rule) has **more than 5 journeys**. When the trigger fires, the orchestrator MAY group those journeys for Stage A dispatch instead of dispatching one subagent per journey. Grouping is allowed regardless of priority (P0/P1/P2/P3 all eligible once the >5 threshold is crossed for that tier). Adversarial Passes 4 and 5 have their own grouping path (`coverage-expansion/SKILL.md` §"Adversarial grouping for Passes 4 and 5") — default `[group]` cap-7, opt back into per-journey with `args: "strict-adversarial: true"`.

**Relationship to P3-batch.** Two distinct batching paths coexist:
- **P3-batch** (cap 7): narrow, P3-only, shared Playwright project, no gap flags. See §"Batched dispatch for P3 peripheral journeys" below — its criteria are unchanged.
- **Relevance group** (cap 7): broader, any priority once the >5 threshold is crossed, compositional passes only.

A pass MAY use both paths in the same wave (one or more `[P3-batch]` dispatches alongside one or more `[group]` dispatches), but a single dispatch belongs to exactly one path. Priorities below P3 fall under the relevance-group path; the P3-batch path remains the right shape for shared-project P3 sweeps.

**Group composition rules.**
- **Same priority.** A relevance group's journeys must all share a priority tier — never mix P1 and P2 in one group. Priority is load-bearing for the orchestrator's pass-level decisions; mixing tiers in one brief erases that signal.
- **Same section / shared `Pages touched`.** Group by relevance: prefer journeys that share a section identifier (e.g., all auth-section journeys, all cart-section journeys). When section alone leaves a tier with too few groupable journeys, fall back to overlapping `Pages touched` from the journey-map block — journeys that touch the same routes share page-repository entries and app-context knowledge, which is the cost saving the path is built around.
- **No pending gap flags.** A journey carrying any of the three re-pass triggers (coverage gap, deferred stabilization, refined map block) is dispatched per-journey, not in a group. Same rule as P3-batch — flagged journeys need the brief's full attention.
- **Cap 7.** Maximum 7 journeys per group. A tier of 28 journeys at the same priority becomes ⌈28/7⌉ = 4 groups. If a relevance cluster has 9 journeys, split it into 7+2 (the 2-journey group is fine — singleton and small groups are valid).

**Parallelism preserved.** Each group dispatches as ONE Stage A subagent under the `[group]` marker; multiple groups dispatch in parallel up to the host-max cap. With 28 journeys grouped 7-per (4 groups) the wave size is 4 — comparable to N parallel single-journey dispatches but with roughly one seventh of the brief overhead per dispatch. Across-tier ordering (P0 first, then P1, then P2, then P3) is unchanged.

**Stage B remains per-journey within a group.** Each journey in a `[group]` Stage A dispatch receives its own dedicated cycle-1 Stage B reviewer — same contract as the P3-batch path. The compositional-cycle-1 batch-reviewer exception (one cross-pass reviewer) is independent of `[group]` and does NOT compose with it; a `[group]` Stage A always produces per-journey cycle-1 Stage B reviewers.

**Cycle-1 split-out.** A group is accepted only when every journey's cycle-1 Stage B returns `greenlight`. If any journey returns `improvements-needed`, that journey breaks out and runs its own per-journey Stage A from cycle 2 onward (with the cycle-1 group return retained as history input). The remaining greenlit journeys stay accepted at cycle 1 and proceed.

**Quality safeguard.** The cap-7 group size and per-journey Stage B are the safeguards against the documented attention-rationing failure mode (every Stage B returns `improvements-needed` because the batched composer skipped Test-expectations bullets). If a group's cycle-1 reviews trend toward `improvements-needed` (≥3 of 7 in one group, or the same pattern across multiple groups in a pass), the orchestrator stops grouping for the remainder of that pass and falls back to per-journey dispatch.

**Role-prefix.** The dispatch description is `[group] composer-j-<a>,composer-j-<b>,...:`. Cap-7 rule, enforced by methodology (the comma count in the description tells you whether you're at the cap). The harness dispatch-guard hook that previously enforced the cap mechanically was retired in the 0.3.6 cleanup; the rule still applies. Items must be role-explicit `composer-` slugs (compositional passes). The same `[group]` marker is also accepted for `probe-j-` items by `bug-discovery` Phase 6 — see `bug-discovery/SKILL.md`. Returns are per-journey concatenated under one Agent return.

**Rationalizations to reject (relevance-group path):**

| Excuse | Reality |
|--------|---------|
| "Only 4 journeys at this priority — let's group anyway, it's neater" | Trigger is >5 journeys at the tier. With ≤5, per-journey dispatch is the rule; the saving doesn't pay for the attention-rationing risk. |
| "Group of 8, only one extra over the cap, I'll bend the rule" | Cap 7 is not negotiable. Split into 7+1, or 4+4 if the cluster shape supports it. |
| "Two journeys are P1 and three are P2, but they share pages — group them" | Same priority is required. Mixing erases the priority signal the orchestrator relies on for pass-level decisions. |
| "Journey X has a coverage-gap flag, but the gap is small — keep it in the group" | Any of the three re-pass triggers kicks the journey out into per-journey dispatch. Same rule as P3-batch. The flag's verdict is the subagent's, after reading prior-pass returns — which a grouped brief cannot do. |
| "Group cycle-1 had 4 of 7 return improvements-needed — keep grouping next pass anyway, the saving is too good" | The pattern is the rationing failure mode. Stop grouping for the rest of this pass and the next; revisit only if the pass-level review spread improves. |
| "Adversarial Pass 4 has 8 journeys — group them too" | Permitted under `mode: standard` default. See `coverage-expansion/SKILL.md` §"Adversarial grouping for Passes 4 and 5" — `[group]` cap-7 is the default; opt back into per-journey with `args: "strict-adversarial: true"`. (Prior versions of this row forbade adversarial grouping outright; that rule was relaxed once the app-wide-pattern catalogue made per-journey isolation less load-bearing on the adversarial layer.) |

### Batched dispatch for P3 peripheral journeys

**Path scope: P3 only.** This `[P3-batch]` path covers the narrow case of adjacent low-impact P3 journeys — typically smoke or admin-portal siblings sharing one Playwright project — batched into a single brief, cap 7. P0/P1/P2 are NEVER eligible for the P3-batch path; sharing pages with P3 siblings is not authorisation for grouping non-P3 journeys at this cap. Non-P3 grouping has its own path with different criteria — see §"Relevance grouping for compositional passes" above (`[group]` marker, cap 7, triggered by tier size > 5). Do NOT mix the two paths in one dispatch.

Dual-stage narrows this:

- **Stage A may still be batched** for eligible P3 journeys (shared project, no pending gap flags, same priority tier, cap 7 per brief — criteria from PR #108).
- **Stage B per-journey by default; one documented batch exception for compositional cycle-1.** In the P3-batch-A path, every journey in a batched Stage A still gets its own dedicated cycle-1 Stage B reviewer (the per-journey contract). The compositional-cycle-1 batch-reviewer exception (documented in `reviewer-subagent-contract.md` §"Batch reviewer mode (cycle-1 compositional only)") is a separate, narrower path — one reviewer per pass for the first cycle of compositional Passes 1, 2, 3 only — and **does NOT compose with P3-batch-A**: a P3 journey's batched Stage A still produces a per-journey cycle-1 Stage B (not folded into the cross-pass batch reviewer). Cycle-2+ is per-journey regardless. Adversarial passes (4 and 5) are always per-journey.
- Batching is accepted ONLY when every journey in the batch's cycle-1 Stage B returns `greenlight`.
- If any journey's cycle-1 Stage B returns `improvements-needed`: split the batch. From cycle 2 onward, the affected journey breaks out and runs its own per-journey Stage A plus its own Stage B. The batched cycle-1 Stage A return is retained as history input to the broken-out cycle-2 Stage A brief. The remaining greenlit journeys in the batch stay accepted at cycle 1 and proceed.

**Rationalizations to reject:**

> ↗ Cross-cutting category: see [`anti-rationalizations.md` §"Self-authorised batching (Stage A grouping)"](anti-rationalizations.md).

| Excuse | Reality |
|--------|---------|
| "This 8th journey is almost identical to the 7 in the batch, I'll include it" | Cap 7 is not negotiable. Split the batch (5 + 3, etc). The cap bounds brief size and per-journey attention. |
| "All these journeys are P3 and share a project, and this admin journey *could* be grouped — skip the P1 carve-out" | P0 / P1 always dispatch individually. Priority is load-bearing; a journey at P1 deserves its own brief even if it happens to share pages with P3 siblings. |
| "The journeys share most pages, same project, roughly P3 — skip the 'shared Playwright project' check" | Different Playwright projects require different `playwright-cli` sessions; batching across projects introduces session-swap complexity that defeats the dispatch optimisation. |
| "Batching is faster so I'll batch everything that isn't explicitly forbidden" | Batching is allowed, not preferred. P0/P1 individual dispatch is the default; batching is specifically for P3 peripheral sweeps. Defaulting to batch on P2 quietly compresses scope. |
| "One journey in the batch has a coverage-gap flag from Pass 1, but the gap is trivial" | Any flag in the three re-pass triggers kicks the journey out of the batch into individual dispatch. "Trivial" is the subagent's judgement after reading Pass-1 returns — which cannot happen inside a batched brief. |
| "All P3 same project, I'll batch Stage B too to save a dispatch" | The P3-batch path's Stage B is per-journey — that's the rule the rationalization is trying to evade. The compositional-cycle-1 batch-reviewer exception (`reviewer-subagent-contract.md` §"Batch reviewer mode") does NOT extend to P3-batch-A; mixing the two is rubber-stamping. |
| "I'll batch Stage B for cycle-2+ to save a dispatch" | Cycle-2+ Stage B is per-journey by hard rule (`reviewer-subagent-contract.md` §"Mode selection"). Cycle-2 already knows which specific journeys need attention; batching it would defeat the purpose. The compositional-cycle-1 batch-reviewer exception is empirically defensible — ~85% of cycle-1 reviews are greenlight, so the cross-journey synthesis is genuinely the better shape — but cycle-2+ has a different signal-to-noise profile. |
| "Cycle-1 Stage B greenlit 6 of 7 journeys, I'll greenlight the 7th too since it's similar" | The 7th journey's reviewer returned `improvements-needed` for a reason. Split out cycle-2 for that journey; the reason does not carry to the greenlit 6. |
| "Any flag on any journey kills the whole batch — too expensive, I'll keep batching" | Only the flagged journey breaks out. The greenlit journeys stay batched-and-accepted; no rework for them. |
| "I'll batch Stage A across P1+P3 journeys if they share a project" | The P3-batch path is P3-only; mixing in P1 here is the rationalization. P1 grouping has its own path (`[group]`, see §"Relevance grouping for compositional passes") with its own criteria — it does not compose with P3-batch. |

---

## Per-pass dedup (one cleanup subagent at the end of every pass)

After every pass's Stage B greenlights all journeys (or every dispatched journey reaches a terminal `review_status`) AND the whole-suite re-run gate passes, the orchestrator dispatches **one** cleanup subagent before advancing to the next pass. This is in addition to the post-pass-5 cross-pass cleanup (which still runs as the final dedup).

### Compositional passes (1–3): test dedup

Inputs to the cleanup subagent:
- The pass's commit range (`git log <pass-start-sha>..HEAD --grep '^test('`).
- The pass's authored journey blocks (verbatim from `journey-map.md`).
- The current `coverage-expansion-state.json`.

Task:
1. Identify semantically equivalent test cases across the journeys committed in this pass — same negative-case (e.g., "submit empty form rejected"), same boundary check, same error-state assertion.
2. Keep one canonical version per equivalence class. Cross-reference the others via a one-line comment in the consumer journey's spec (`// dedup: see j-<canonical>.spec.ts § <test name>`).
3. Do NOT touch tests authored in earlier passes — within-pass scope only.
4. Do NOT alter test semantics or coverage. If two tests look similar but exercise different invariants, keep both.
5. Commit: `docs(ledger): pass <N> test dedup` per the **Commit-message conventions** table.

### Adversarial passes (4–5): findings dedup

Inputs to the cleanup subagent:
- The pass's appendings to `tests/e2e/docs/adversarial-findings.md` (the per-journey sections committed in this pass).
- The current ledger.

Task:
1. Within-pass: identify duplicate findings across journeys in this pass — same boundary, same root cause, different journey contexts.
2. Consolidate duplicates into a single canonical entry under the relevant section, cross-referenced from each journey's section.
3. Do NOT drop or edit substantive finding content. Do NOT re-classify findings.
4. Commit: `docs(ledger): pass <N> findings dedup` per the **Commit-message conventions** table.

### Per-pass dedup constraints

- **Single dispatch.** One cleanup subagent per pass; never per-journey.
- **Within-pass scope.** The subagent reads only the current pass's commits / ledger appendings. Cross-pass synthesis is the post-pass-5 cleanup's job.
- **Runs after the whole-suite gate.** A pass that fails the whole-suite re-run gate does NOT get its dedup step until the failures are resolved and the gate passes.
- **Non-blocking for the next pass.** A per-pass dedup subagent that returns `no consolidation needed` still produces its commit (with an empty diff or a short notes file) so the git log records the gate having run. The orchestrator advances to the next pass on greenlight.

### Per-pass dedup completion criterion

For passes 1–5, the per-pass-dedup commit MUST land before the next pass dispatches. The orchestrator records `"pass <N> dedup — no consolidation"` in the state-file progress log when the subagent finds nothing to merge — silent skipping is forbidden.

## Ledger dedup (single cleanup subagent, runs once after pass 5)

After pass 5 commits, the orchestrator dispatches one additional, non-per-journey cleanup subagent.

### Task for the cleanup subagent

1. Read `tests/e2e/docs/adversarial-findings.md` in full.
2. Identify near-duplicate findings across journey sections (e.g., the same UI-state desync flagged by multiple journeys).
3. Consolidate duplicates into the top-level `## Cross-cutting findings` section, listing every journey where each finding surfaced. Leave a short "_See cross-cutting: <title>_" backref in each journey's section (one line per moved finding).
4. Fix obvious formatting / ordering issues (broken lists, inconsistent severity labels).
5. Do NOT drop or edit substantive finding content. Do NOT re-classify findings. This is a dedup/consolidation step only.
6. Commit: `docs(ledger): dedupe cross-cutting findings` (per the **Commit-message conventions** table above).

### Cleanup subagent constraints

- Model: **haiku** is sufficient. This is text-only editing with no browser session, no test composition, no probing.
- Single dispatch — NOT per-journey. Just one subagent, handed the full ledger file path.
- Isolated context. No prior session content.
- Does not modify the journey-map, the page-repository, or any test files. Only the ledger.

