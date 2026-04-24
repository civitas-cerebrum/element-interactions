# Dual-Stage Coverage Expansion — Design

**Status:** approved (2026-04-24)
**Target skill:** `coverage-expansion` (+ adjacent contracts in `test-composer`, `bug-discovery`, `onboarding`, and the canonical subagent-return-schema).
**Prior art:** builds on PRs #102 (5-pass count alignment), #103 (parallel-MCP dispatch discipline), #104 (non-negotiables for depth mode), #105 (no-skip contract), #108 (scope preview / auto-compaction / re-pass discipline / batched dispatch / state-file contract), #109 (canonical subagent return + ledger schema).
**Posture:** cost-blind. Quality and speed are the optimisation targets. Dispatch count, opus usage, and parallel width are not.

---

## 1. Motivation

Under the current 5-pass depth-mode design, each journey receives one test-composer dispatch per compositional pass and one adversarial probe dispatch per adversarial pass. Every dispatch is a single subagent that both does the work and self-certifies it. That self-certification is the weakest link: when a journey's composer subagent misses an error-state variant, or its probe subagent stops one compound probe short of a real finding, the miss only surfaces on a later pass (if at all). Pass 2's re-pass discipline (PR #108) recovers some of it by requiring explicit three-trigger evidence, but re-pass still runs the same dispatch shape — a single subagent that has also lost the fresh-eyes advantage.

The 2026-04-24 MediCheck onboarding run exposed this: several journeys were marked `covered-exhaustively` on Pass 2 with technically-valid three-trigger evidence, but a human audit found scenarios a staff QA would have demanded (mobile-viewport error states, concurrent-session conflicts, idempotency replays). The gap was not in the discipline — it was in the lack of an adversarial, independent second reader.

The fix is structural: **every pass becomes a dual-stage dispatch per journey**. Stage A is the existing compose-or-probe subagent. Stage B is a fresh staff-level-QA reviewer subagent with its own isolated MCP browser, whose only job is to find what Stage A missed and either greenlight the journey or return a structured `improvements-needed` brief. The two stages iterate up to 7 A↔B cycles per journey per pass until greenlight or cycle exhaustion.

---

## 2. Core change

Every pass (1 through 5) becomes per-journey:

| Stage | Role | Context | MCP | Returns |
|---|---|---|---|---|
| **A — Compose/Probe** | Existing `test-composer` (passes 1–3) or adversarial probe (passes 4–5). Unchanged contract. | Isolated, fresh per cycle | Yes (existing) | Per canonical schema |
| **B — Adversarial Review** | New. Staff-level QA reviewer. Reads Stage A output + journey context, navigates live app, judges completeness and craft, either greenlights or returns structured improvements. | Isolated, fresh per cycle | Yes (isolated browser per reviewer) | `greenlight` or `improvements-needed` |

A single journey's A↔B pair runs sequentially (A blocks its B; B's `improvements-needed` blocks the A-retry). Across journeys in the same independence group, pairs fire concurrently — journey X's B can run while journey Y's A is still running.

**Cycle cap: 7 A↔B cycles per journey per pass.** Worst-case dispatch count per journey per pass = 14 (7 A + 7 B). Pipeline-wide worst case (5 passes × N journeys × 14) is acceptable under the cost-blind posture.

---

## 3. Stage B role, per pass type

### 3.1 Passes 1–3 (compositional)

Reviewer reads:
- The committed test files for the journey (the `.spec.ts` files Stage A wrote or modified this cycle).
- The journey's `### j-<slug>` block from `journey-map.md` (expectations, pages touched, priority, test expectations).
- The `app-context.md` slice for those pages.
- Relevant entries in `tests/e2e/docs/adversarial-findings.md` (sibling-journey bug ledger — transferable concerns).

Reviewer navigates:
- The live app via an isolated Playwright MCP browser. Re-inspects every page the tests claim to exercise. Runs ad-hoc probes where needed.

Reviewer judges:
1. **Completeness.** Every item in `Test expectations:` has a covering test whose assertion matches what the expectation calls for. Missing items are `missing-scenarios`.
2. **Craft.** Every test uses the Steps API correctly, selectors are in `page-repository.json` (no inline selectors), describe-block timeout is set, file-level serial mode is present for tenant-mutating specs (per PR #107). Missing or incorrect craft is `craft-issues`.
3. **Verification fidelity.** Each test's assertions match what the live DOM actually exposes. A test that asserts a button exists but only renders after a modal the test never opens is a `verification-miss`.
4. **Adversarial fill.** Scenarios a staff-level QA would demand before sign-off, that Stage A did not write. Examples: mobile-viewport variant where the journey is P0/P1; boundary inputs where `Test expectations:` mentions validation; session-expiry mid-flow where the journey crosses auth.

### 3.2 Passes 4–5 (adversarial)

Reviewer reads:
- This-pass ledger entries (`tests/e2e/docs/adversarial-findings.md`) appended by Stage A for this journey.
- Any regression tests written this cycle (pass 5 only — `j-<slug>-regression.spec.ts`).
- The journey's map block and `app-context.md` slice.
- Probe-category vocabulary (`skills/coverage-expansion/references/adversarial-findings-schema.md`).

Reviewer navigates:
- The live app via an isolated MCP browser. Independently attempts 2–3 probes Stage A did not try in this cycle — picking categories underrepresented in Stage A's probe list.

Reviewer judges:
1. **Adversarial surface coverage.** Did Stage A probe enough of the journey's attack surface for this pass? Under-probed surfaces are `missing-scenarios` with category=adversarial.
2. **Ledger craft.** Every finding has well-formed `expected:`/`observed:`/`evidence:` lines per the canonical schema (PR #109 §3). Missing fields or vague prose are `craft-issues`.
3. **Regression-test lock (pass 5 only).** Every `Boundaries verified` finding from pass 4 + pass 5 has a passing regression test in `j-<slug>-regression.spec.ts` that actually locks the verified boundary (not a surrogate assertion). Missing or weak locks are `verification-misses`.
4. **Independent probes.** If any of the reviewer's 2–3 independent probes land a finding, flag as `missing-scenarios` category=adversarial-missed. Reviewer does NOT append their own probes to the ledger — Stage A does that on the next cycle.

---

## 4. Reviewer return contract

Returns use the canonical subagent-return-schema (PR #109 §1). Two terminal statuses:

### 4.1 `status: greenlight`

```
status: greenlight
journey: j-<slug>
pass: <N>
cycle: <cycle-number>
summary: <one sentence — e.g., "All 8 test-expectations covered, craft clean, live DOM matches assertions.">
```

No findings body. Orchestrator accepts and moves on.

### 4.2 `status: improvements-needed`

```
status: improvements-needed
journey: j-<slug>
pass: <N>
cycle: <cycle-number>

missing-scenarios:
  - **<FINDING-ID>** [must-fix | nice-to-have] — <one-line title>
    - why: <one sentence, staff-QA rationale>
    - category: <mobile | error-state | edge-case | adversarial | accessibility | i18n | lifecycle | concurrency>
    - suggested-test: <one-sentence description of the test to write>

craft-issues:
  - **<FINDING-ID>** [must-fix | nice-to-have] — <one-line title>
    - file: <path>
    - issue: <what's wrong — e.g., "inline selector instead of page-repo entry">
    - fix: <concrete remediation>

verification-misses:
  - **<FINDING-ID>** [must-fix | nice-to-have] — <one-line title>
    - file: <path>
    - test-name: <test(...) title>
    - asserted: <what the test currently asserts>
    - live-observed: <what the reviewer saw via MCP>
    - suggested-fix: <concrete remediation>
```

Every finding carries `must-fix` or `nice-to-have`. Only `must-fix` blocks greenlight — an otherwise-greenlit journey with only `nice-to-have` findings is accepted with the findings logged as review notes.

**Finding-ID format for reviewer findings.** Per §4 of the canonical subagent-return-schema (PR #109), schema extensions land in the reference file, not in caller SKILLs. This design extends the canonical schema to add a reviewer-subformat: `<journey-slug>-<pass>-<cycle>-R-<nn>` where `<cycle>` is a two-digit integer and `R` tags the finding as reviewer-sourced. That extension is part of the implementation work — the reference file update is part of this design's delivery, not a side quest.

---

## 5. Retry loop (orchestrator, per journey per pass)

```
stage_a_input = base_brief                                  # initial
history = []

for cycle in 1..7:
  a_return = dispatch Stage A with stage_a_input
  b_return = dispatch Stage B (fresh ctx, fresh MCP) to review a_return

  if b_return.status == "greenlight":
    review_status = "greenlight"
    break

  must_fix = [f for f in b_return.findings if f.priority == "must-fix"]

  if must_fix is empty:
    review_status = "greenlight-with-notes"
    break

  if history and must_fix == history[-1].must_fix:
    # Stage A cannot address these — further cycles will not help
    review_status = "blocked-cycle-stalled"
    break

  history.append({"cycle": cycle, "must_fix": must_fix})
  stage_a_input = base_brief + b_return.findings

if cycle == 7 and review_status is unset:
  review_status = "blocked-cycle-exhausted"

record journey review_status + cycle count + final must_fix list in state file
```

### 5.1 Termination conditions (before cycle 7)

| Condition | `review_status` | Action |
|---|---|---|
| Greenlight (no findings) | `greenlight` | Accept, commit this journey's work |
| `improvements-needed` but only `nice-to-have` | `greenlight-with-notes` | Accept, log notes to state file |
| `improvements-needed` with same `must-fix` list as previous cycle | `blocked-cycle-stalled` | Escalate — Stage A cannot fix |
| Cycle 7 reached without greenlight | `blocked-cycle-exhausted` | Escalate — retry budget spent |

Both blocked states are treated as the no-skip contract's `blocked (review-cycle-stalled | review-cycle-exhausted)` return type. They do NOT fail the pass — they are explicit, visible deferrals recorded in the state file and carried forward to the next pass as a Pass N+1 Stage A input.

### 5.2 Why cycle cap = 7

- Gives genuine room for adversarial iteration: first review catches the obvious gaps, second fills the subtler ones, third addresses anything the reviewer missed on the first read.
- Bounded worst case: 14 dispatches per journey per pass is the ceiling, which sets a predictable upper-bound on context and compute per journey.
- Aligns with the P3-batch cap of 7 from PR #108 as a numeric convention within the skill.

---

## 6. Parallelism

### 6.1 Independence graph — semantic unchanged

Same rule as PR #104 et al.: two journeys are dependent if they touch a non-universal page in common. Universal pages (login, homepage, global nav) are ignored.

### 6.2 Intra-group pipelining (new)

Within an independence group:
- All journeys in the group start Stage A concurrently (subject to the parallel cap — §6.3).
- Each journey's Stage B fires **as soon as that journey's Stage A returns** and the parallel cap has a slot — not after the whole group's Stage A completes.
- Each journey's A-retry fires **as soon as that journey's B returns with `improvements-needed`** and the cap has a slot.
- Journeys in the same group ride their own A↔B pipelines in parallel. A journey on cycle 3 and a sibling on cycle 1 coexist.

Across independence groups: groups run in priority order, each group exhausting parallelism before the next group starts.

### 6.3 Parallel cap — lifted and jointly applied

Previous: `min(4, credentials-per-role)` with batching for P3.
New: `host max` — the orchestrator uses whatever parallel width the dispatch primitive allows. An explicit user override is accepted if supplied (`args: "parallel-cap: 8"`), otherwise no artificial ceiling beyond the shared-resource audit's credential-contention findings (per PR #106).

**The cap counts Stage A and Stage B dispatches jointly.** There is one pool of in-flight subagent slots; A and B compete for the same slots within a group. Worst-case concurrent dispatches at a given moment equals the cap itself, distributed across any mix of A and B. A journey's own A and B never overlap (sequential within a journey), but across journeys any A/B interleaving is possible. When the cap is saturated, new dispatches — whether A, B, or A-retry — queue until a slot frees. The orchestrator does not prioritise A over B or vice versa in the queue; FIFO is the default.

### 6.4 Shared-resource audit interaction (PR #106)

The Phase-0 shared-resource audit still caps parallelism where the app genuinely can't tolerate more (single credential per role, rate limits, CSRF serialization). Those caps override the cost-blind default. The audit's constraint tags are applied to Stage A AND Stage B equally — reviewers compete for the same credentials.

---

## 7. Model selection (cost-blind)

- **Default model for every dispatch in every stage: opus.**
- Drop the sonnet-for-P2/P3 heuristic from the existing skill.
- Drop the sonnet-for-small-journey override.
- Only one exception: cycle-1 Stage B on a confirmed-greenlit journey (previous pass greenlit + no map delta + no sibling-bug update) MAY run sonnet as a fast confirmation pass. If that sonnet review returns greenlight, accept; if it returns `improvements-needed`, immediately re-run the same review on opus to confirm — the opus result is the authoritative one. This exception is a minor latency optimisation; it is NOT a cost-reduction mechanism.

---

## 8. P3 batching (PR #108) — narrowed

Previous: adjacent P3 journeys in the same Playwright project could be covered by one Stage A subagent in a single brief, cap 7 journeys per brief.

New, dual-stage-aware batching rule:

- **Stage A may still be batched** for eligible P3 journeys (all criteria from PR #108 must still hold: shared project, no pending gap flags, same priority tier, etc.).
- **Stage B is never batched.** Each journey in a batched Stage A still gets its own dedicated Stage B reviewer. The reviewer reads only its assigned journey's output from the batched Stage A return — the reviewer itself is never responsible for multiple journeys.
- Batching is accepted ONLY when every journey in the batch's cycle-1 Stage B returns `greenlight`.

If any journey's cycle-1 Stage B returns `improvements-needed`:
- **Split the batch.** From cycle 2 onward, the affected journey breaks out and runs its own per-journey Stage A (not batched) plus its own Stage B. The batched cycle-1 Stage A result is retained as history input to the affected journey's cycle-2 Stage A brief.
- The remaining cycle-1-greenlit journeys in the batch stay accepted at that cycle and proceed — they do NOT need further cycles because their review terminated at greenlight.

Effect: batching remains available for genuinely trivial P3 sweeps but can never hide a quality gap behind a batched brief, because the per-journey reviewer isolation is preserved regardless of whether Stage A was batched.

---

## 9. Interaction with existing contracts

### 9.1 No-skip contract (PR #105)
- Extends. Every journey must receive both Stage A AND Stage B in every pass.
- A journey with only Stage A (Stage B never dispatched) is as incomplete as one with no Stage A.
- Return-state enum gains `blocked (review-cycle-stalled)` and `blocked (review-cycle-exhausted)` as subagent-returned values (no orchestrator or user authorization required).

### 9.2 Per-pass completion criteria (PR #104)
- Pass is complete only when every journey has `review_status ∈ {greenlight, greenlight-with-notes, blocked-cycle-stalled, blocked-cycle-exhausted}`.
- Raw "Stage A returned" is not sufficient.

### 9.3 Re-pass triggers for passes 2–3 (PR #108)
- Add a 4th trigger: **"trigger 4 — unresolved review findings from pass N's Stage B for this journey"**. Any `blocked-cycle-*` journey from pass N carries forward its unresolved `must-fix` list into pass N+1 Stage A's brief.
- Pass 2/3 Stage A must explicitly check trigger 4 in its return evidence. The three-trigger check becomes a four-trigger check.

### 9.4 Subagent-return schema (PR #109)
- Add Stage B's return shape (§4 of this document) as a new subsection in the canonical schema file.
- Add `status: greenlight | greenlight-with-notes | improvements-needed` as reviewer-specific return states.
- Existing return states for Stage A (`new-tests-landed`, `covered-exhaustively`, `blocked`, `skipped`) are unchanged.

### 9.5 State-file contract (PR #108)
- Each `dispatches[]` entry now carries:
  ```json
  {
    "journey": "j-<slug>",
    "stage_a_cycles": <int>,
    "stage_b_cycles": <int>,
    "review_status": "greenlight | greenlight-with-notes | blocked-cycle-stalled | blocked-cycle-exhausted",
    "final_must_fix": [<finding-id>, ...],    // only when blocked
    "result": "new-tests-landed | covered-exhaustively | blocked",
    "authorizer": null
  }
  ```
- The existing `result` field follows the no-skip enum; `review_status` is the new parallel field specific to dual-stage.

### 9.6 Commit discipline
- Still one commit per pass. The commit aggregates the journey A-rounds whose `review_status` is `greenlight` or `greenlight-with-notes` this pass.
- Stage B returns do NOT produce their own commits — review artifacts are captured only in the state file's per-journey fields.
- Blocked journeys (cycle-stalled or cycle-exhausted) have their partial Stage A work committed anyway (if any tests landed), with the blocked `review_status` recorded — the no-skip contract requires visibility, not rollback.

### 9.7 MCP isolation (PR #103)
- Every Stage B reviewer gets its own isolated Playwright MCP browser. Rule 11 applies verbatim.
- Stage B and its paired Stage A never share an MCP instance (they run in separate cycles anyway, so this is mostly automatic, but the orchestrator must verify per the agent-owned prerequisite check).

### 9.8 Auto-compaction (PR #108)
- Same 70% threshold, same compaction flow. Dispatches roughly double under dual-stage, so the seam gets more traffic — no new mechanism needed, but the state file's per-journey dual-stage fields must be written before any compaction crossing.

---

## 10. Context discipline

- Orchestrator never holds Stage A test source or Stage B review body. Only structured summaries.
- Stage B is always fresh context. No reuse of the Stage A subagent even though it just operated on the same journey — "fresh eyes" is load-bearing. A reviewer who inherits the composer's context is no longer independent.
- Stage B across cycles is also fresh — cycle 2's B does not inherit cycle 1's B's context. Each review starts from the journey block + the current on-disk state.
- Subagent-return summaries from cycle N carry the minimum needed into cycle N+1's Stage A brief: the `must-fix` list only, not the whole B return body.

---

## 11. Per-pass orchestrator pipeline (updated)

Pipeline from PR #108 updated to the dual-stage shape:

```
1. Read the map → build in-memory journey index.
2. Recompute priority ordering per map deltas.
3. Build the journey independence graph.
4. Emit the per-pass scope preview (per PR #108), with updated numbers:
   - journey count N (unchanged)
   - parallel peak P (lifted to host max unless audit caps it)
   - expected dispatch count: ~1.5 × N worst case for cycle 1 greenlights,
     up to 14 × N for all-cycle-exhausted (show both ends of the band)
5. Dispatch Stage A + Stage B pipelines per journey in parallel, running
   the retry loop from §5 for each journey.
6. Collect structured returns from every A and B dispatch. State file
   updated after each journey's loop terminates (greenlight or blocked).
7. Reconcile artefacts (compositional: map; adversarial: ledger). Commit.
8. Update state file post-commit. Run auto-compaction check (PR #108)
   before moving to the next pass.
```

---

## 12. Onboarding skill interaction (PR #106)

- Phase-5 scope preview's per-pass dispatch band widens:
  - Low end: `<N_low> × 2` (one A + one B per journey, cycle-1 greenlight universal) — this is the minimum.
  - High end: `<N_high> × 14` (cycle-cap hit on every journey) — this is the absolute ceiling, rarely reached in practice.
  - Realistic expected: `<N> × 3` (average 1.5 A dispatches + 1.5 B dispatches per journey, across the pass).
- Phase-5 progress lines emit `[coverage-expansion] Pass N/5, journey j-<slug>: cycle <c>/7, review <status>` per journey, so the user sees cycle activity even on a single-journey run.
- Onboarding's Phase-5 completion gate (PR #104) extends: Phase 5 is complete only when every journey has a terminal `review_status` for every pass.

---

## 13. Non-goals

- **Not** cost reduction. The posture is cost-blind. P3 batching narrows as described, but only to prevent quality gaps — not to save money.
- **Not** a replacement for adversarial passes 4 and 5. Stage B reviewers in passes 4 and 5 are additive — they judge the existing adversarial work, they do not replace it.
- **Not** a lint rule. Stage B is a judgement-heavy reviewer. Structural checks (file-level serial for mutating specs, page-repo entries for selectors) remain test-composer's responsibility and can be additionally caught by the review.
- **Not** a new skill. Dual-stage is a contract change inside `coverage-expansion` (and adjacent schema / onboarding updates). No new skill is introduced.
- **Not** a parallelism-model redesign. Independence graph semantics are unchanged. Only the per-group pipelining and the parallel cap lift are new.

---

## 14. Open questions (to address during implementation)

1. **Reviewer prompt template.** The exact system-prompt wording for the staff-QA-reviewer persona — tuning this is material to review quality. Initial draft in the implementation plan; iterate with the skill-creator eval loop afterwards.
2. **Must-fix vs nice-to-have calibration.** Reviewers will differ on what warrants `must-fix`. Initial rule: any `missing-scenario` in a `Test expectations:` list item is `must-fix`; scenarios the reviewer invents adversarially default to `nice-to-have` unless the category is `mobile` for a P0/P1 journey or `adversarial-missed` for passes 4–5. Revisit after the first real run.
3. **Regression-test weight for Stage B in pass 5.** Does pass 5 Stage B run its own regression-test stabilization check? Tentative: no — stabilization stays with Stage A, reviewer only judges lock-quality. Revisit if stabilization failures surface in review.
4. **Interaction with `test-repair`.** If dual-stage surfaces tests that fail in the live app due to app bugs (not test bugs), does the reviewer surface them as `verification-misses`, or as app bugs to `bug-discovery`? Tentative: `verification-misses` with a `suspected-app-bug: true` flag — the orchestrator routes those to `bug-discovery` for confirmation rather than round-tripping Stage A.

---

## 15. Success criteria

- Every journey in a full depth-mode run reaches a terminal `review_status` within its pass's cycle budget.
- Stage B catches at least one `must-fix` scenario per pass per ~10 journeys on average in real runs (calibration baseline — will be measured).
- `blocked-cycle-stalled` journeys carry their unresolved findings forward and are resolved (or explicitly accepted) by Pass 5's end.
- No journey ships to the summary deck without an explicit `review_status`.
- Onboarding runs complete the Phase-5 scope band projection with accurate actuals (±20%) against the post-run dispatch count.

---

## 16. Out of scope for this design

- Changes to `bug-discovery` beyond the 4th-trigger wording.
- Changes to `test-composer`'s own contract (Stage A is the existing test-composer dispatch; no changes to what test-composer does internally).
- Changes to `work-summary-deck` or `test-catalogue` beyond consuming the new `review_status` field.
- A new skill named `coverage-review` or similar. Dual-stage is a contract extension, not a skill split.
