---
name: coverage-expansion
description: >
  Iteratively expand E2E test coverage across an entire mapped application. Owns
  priority ordering, journey-by-journey iteration, parallel dispatch for
  independent journeys, model selection per journey size, and map reconciliation
  between passes. Calls the test-composer skill per journey for compositional
  passes and invokes bug-discovery per journey for adversarial passes; does not
  compose tests itself. Runs in two modes: `breadth` (one horizontal sweep,
  fast) or `depth` (three compositional passes + two adversarial passes +
  ledger dedup, journey-by-journey, default). Triggers on "increase coverage",
  "expand tests", "iterative coverage", "deep coverage pass", and when invoked
  by the onboarding skill as its Phase 5.
---

# Coverage Expansion — Iterative Journey-by-Journey Test Growth

The orchestrator for coverage growth. Iterates the user journey map, dispatches `test-composer` per journey for compositional passes, dispatches adversarial-probe subagents per journey for adversarial passes, and merges map discoveries between journeys. Depth mode runs 3 compositional passes + 2 adversarial passes + one cleanup/dedup step. Breadth mode runs one sweep.

**Context discipline:** this skill holds only the map index (IDs, names, priorities, `Pages touched`), the independence graph, and the pass counter. All journey-level reasoning happens inside dispatched subagents with isolated context windows.

---

## When to Use

Activate this skill when:
- A caller asks to "increase coverage", "expand tests iteratively", or runs a deep coverage pass.
- The `onboarding` skill reaches its Phase 5.
- A sentinel-bearing `tests/e2e/docs/journey-map.md` exists.

Do NOT use this for:
- Writing tests for one journey → `test-composer`.
- Mapping or discovering journeys → `journey-mapping`.
- Broad cross-app adversarial probing outside a mapped journey — that's still `bug-discovery`. This skill's adversarial passes (4 and 5) probe inside each mapped journey's flows, not across the app as a whole.

---

## Prerequisites

1. `tests/e2e/docs/journey-map.md` must exist with `<!-- journey-mapping:generated -->` on line 1. If missing, stop and invoke `journey-mapping` first.
2. The map must be in the precise-embedding format (each journey is a self-contained `### j-<slug>:` block with a `Pages touched:` line). If the map is in an older format without stable IDs, invoke `journey-mapping` to re-emit it.

---

## Modes

| Mode | Invocation | Behaviour |
|---|---|---|
| `mode: depth` (default) | `args: "mode: depth"` or no args | Five passes + cleanup, journey-by-journey in priority order, parallel where independent. Passes 1–3 are compositional; passes 4–5 are adversarial. Final cleanup dedupes the adversarial findings ledger. |
| `mode: breadth` | `args: "mode: breadth"` | One horizontal sweep: priority × depth tiers across all journeys. Fast fallback for quick coverage growth. Adversarial passes do NOT run in breadth mode. |

---

## Depth mode — five-pass pipeline (3 compositional + 2 adversarial) + cleanup

Each pass runs a journey-by-journey pipeline with parallel dispatch where independent. The map grows between compositional passes; the adversarial ledger grows during adversarial passes. After pass 5, a single cleanup subagent dedupes the ledger.

### Per-pass pipeline

Every pass in depth mode runs this pipeline; steps 4 and 6 differ between compositional (1–3) and adversarial (4–5) passes.

1. **Read the map** (sentinel-verified). Build an in-memory index: `[(j-id, priority, pages-touched, test-expectations)]`. Read **only** these fields per journey — not full step lists, branches, or state variations.
2. **Recompute priority ordering.** Honour the map's priorities, but if a journey's `Test expectations` or pages touched have changed since the last pass (because a prior pass reconciled new branches into the map), adjust position.
3. **Build the journey independence graph** (see §"Journey independence graph" below). The graph is the same across compositional and adversarial passes — journey co-residence on pages determines parallelism either way.
4. **Dispatch subagents** — parallel for independent journeys, sequential for dependent ones. Model chosen per the heuristic below.
   - **Compositional passes (1–3):** each invocation dispatches `test-composer` with `args: "journey=<j-id>"`.
   - **Adversarial passes (4–5):** each invocation dispatches the adversarial probe subagent per `references/adversarial-subagent-contract.md`, passing the journey ID and the pass number. The subagent internally invokes `bug-discovery` scoped to its journey.
5. **Collect subagent returns.** Each return is a structured discovery report — for compositional passes per `test-composer`'s return format, for adversarial passes per the adversarial subagent contract's return shape.
6. **Reconcile artefacts.**
   - **Compositional passes:** reconcile the map. Append new branches to existing journey blocks. Add new `j-<slug>` or `sj-<slug>` blocks for newly-discovered journeys or sub-journeys. Append new pages/elements to `app-context.md`. Run a mini Phase 3.5 revision (see `journey-mapping`) if the pass introduced new overlaps.
   - **Adversarial passes:** the map is NOT reconciled. The ledger file is authoritative; its content is already written by the subagents during their append step. Aggregate the return summaries into the orchestrator's running adversarial-totals counter (journeys probed, boundaries verified, suspected-bug count by severity, regression tests added).
7. **Commit.** One commit per pass. Commit message template:
   - Compositional: `test: coverage expansion pass <N>/5 — <summary>`
   - Pass 4: `test: coverage expansion pass 4/5 — adversarial probing (<N> journeys, <B> boundaries, <S> suspected bugs)`. Commit diff is the ledger file only.
   - Pass 5: `test: coverage expansion pass 5/5 — adversarial consolidation (<N> journeys, <R> regression tests, <B> total boundaries)`. Commit diff is the ledger file plus the new `j-<slug>-regression.spec.ts` files.

### Pass differences

| Pass | Kind | Purpose |
|---|---|---|
| 1 — initial perception | compositional | Cover the map as produced by `journey-mapping`. Priorities as written. Each journey gets its full variant set (per `Test expectations:`). Map grows with whatever surfaces. Dispatches `test-composer` per journey. |
| 2 — map-growth widening | compositional | Re-read the enriched map. Promote newly-discovered branches and sub-journeys to first-class journeys where they warrant it. Re-evaluate priorities. Re-attempt any journey where pass 1 deferred stabilization or returned coverage gaps. Dispatches `test-composer` per journey. |
| 3 — consolidation | compositional | Final sweep on the refined map. Focus on cross-journey interactions, residual gaps, data-lifecycle variants that require wiring multiple journeys together, and any journey whose map block was materially refined in pass 2. Dispatches `test-composer` per journey. |
| 4 — adversarial probing | adversarial | One adversarial turn per journey. Dispatches a probe subagent (see `references/adversarial-subagent-contract.md`) that invokes `bug-discovery` scoped to the journey. Findings are appended to `tests/e2e/docs/adversarial-findings.md` — no tests are written in pass 4. |
| 5 — adversarial consolidation | adversarial + regression | Second adversarial turn. Each subagent reads its journey's pass-4 ledger section, attempts complementary/compound probes, and writes **passing** regression tests for every verified boundary (pass 4 + pass 5 combined) into `j-<slug>-regression.spec.ts`. Suspected bugs remain ledger-only — never committed as `test.fail()`. |

After pass 5: one single-dispatch cleanup subagent dedupes the ledger. See §"Ledger dedup" below.

### Journey independence graph

Two journeys are **dependent** if they touch an overlapping set of non-universal pages. Universal pages (e.g., `/login`, homepage, global top-nav) are ignored when computing overlap — otherwise every journey would appear dependent on every other.

- Compute the graph from each journey's `Pages touched:` list minus universal pages.
- Independent journeys run in parallel up to a dispatch cap (default: 4 concurrent subagents).
- Dependent journeys run sequentially; the later journey inherits the earlier's `page-repository.json` updates.

### Model selection heuristic

Orchestrator picks a model per subagent between `sonnet` and `opus` only. Journey-level test composition requires self-stabilization, API compliance review, and coverage verification — haiku is not reliable enough for that workload.

| Signal | Model |
|---|---|
| Steps ≤ 8 AND pages ≤ 4 AND priority ∈ {P1, P2, P3} AND no cross-feature/data-lifecycle variants | `sonnet` |
| Steps > 8, pages > 4, priority = P0, `Test expectations` lists cross-feature or data-lifecycle, or this journey failed stabilization on a prior pass | `opus` |

Override: promote from `sonnet` to `opus` on a journey that previously returned a stabilization, API-review, or coverage-verification failure.

For adversarial passes (4 and 5), default to **opus** regardless of journey size. Adversarial probing requires judgment to recognize subtle boundary failures. Sonnet is acceptable only for the smallest journeys (steps ≤ 4 AND pages ≤ 2 AND priority ∈ {P2, P3}). Any journey that returned a stabilization or coverage-verification failure in passes 1–3 must run on opus in passes 4 and 5.

---

## Ledger dedup (single cleanup subagent, runs once after pass 5)

After pass 5 commits, the orchestrator dispatches one additional, non-per-journey cleanup subagent.

### Task for the cleanup subagent

1. Read `tests/e2e/docs/adversarial-findings.md` in full.
2. Identify near-duplicate findings across journey sections (e.g., "nav-cart badge does not clear after checkout" flagged by multiple journeys).
3. Consolidate duplicates into the top-level `## Cross-cutting findings` section, listing every journey where each finding surfaced. Leave a short "_See cross-cutting: <title>_" backref in each journey's section (one line per moved finding).
4. Fix obvious formatting / ordering issues (broken lists, inconsistent severity labels).
5. Do NOT drop or edit substantive finding content. Do NOT re-classify findings. This is a dedup/consolidation step only.
6. Commit: `docs: adversarial-findings — dedupe cross-cutting findings`.

### Cleanup subagent constraints

- Model: **haiku** is sufficient. This is text-only editing with no MCP, no test composition, no probing.
- Single dispatch — NOT per-journey. Just one subagent, handed the full ledger file path.
- Isolated context. No prior session content.
- Does not modify the journey-map, the page-repository, or any test files. Only the ledger.

---

## Breadth mode — one horizontal sweep

For the quick-pass use case, run one invocation per priority tier. No journey-by-journey iteration; no parallel dispatch per journey (the sweep itself is serial). Deep mode remains the default.

Sweep order (one commit per tier):

1. `priority=P0 depth=happy-path,error-states,edge-cases,mobile`
2. `priority=P1 depth=happy-path,error-states`
3. `priority=P2 depth=happy-path`
4. `priority=P3 depth=smoke`

In breadth mode, the legacy `passScope` shape may be passed through to `test-composer` (which still accepts it for backward compatibility).

---

## Isolated subagent contract

### Compositional passes (1–3)

Every `test-composer` subagent dispatched by this skill must:

1. Receive an **isolated context window** — no prior session content, no other journey's data.
2. Receive only: its assigned journey block + any `sj-<slug>` sub-journey blocks it references + the current `page-repository.json` slice for the pages that journey touches.
3. Have access to an **isolated Playwright MCP browser instance** (see the `element-interactions` orchestrator's "Isolated MCP instances for parallel subagents" rule). Parallel subagents never share one browser.
4. Not return until stabilization green, API compliance review clean, and coverage verified exhaustive (enforced inside `test-composer`).
5. Return a structured discovery report only — no pasted test source, no DOM snapshots, no MCP transcripts.

### Adversarial passes (4–5)

Every adversarial probe subagent dispatched by this skill must:

1. Receive the same isolated context window and isolated Playwright MCP browser as compositional-pass subagents.
2. Additionally receive: the pass number (4 or 5), the ledger file path (`tests/e2e/docs/adversarial-findings.md`), and the lockfile path (`tests/e2e/docs/.adversarial-findings.lock`).
3. For pass 5 specifically: also receive the journey's pass-4 ledger section (read from the ledger file before dispatch and passed along — the orchestrator's single exception to the "never hold findings content" rule, bounded to one journey's section for one subagent).
4. Follow the adversarial subagent contract in `references/adversarial-subagent-contract.md` exactly.
5. Return a structured summary only, matching the return shape in that contract. No probe transcripts, no DOM snapshots, no test source.

### Cleanup subagent (post-pass-5)

1. Single dispatch, NOT per-journey.
2. Isolated context. Receives only the ledger file path.
3. No MCP browser. Text-only work.
4. Returns a one-line summary of how many cross-cutting findings were consolidated and how many journeys' sections were backref'd.

The orchestrator does not paste any probe transcripts, DOM snapshots, test source, or stabilization output into its own context at any point.

---

## Progress output

Emit one line per significant event, prefixed `[coverage-expansion]`:

```
[coverage-expansion] Pass 1/5 starting — 14 journeys mapped (3 P0, 6 P1, 4 P2, 1 P3)
[coverage-expansion] Pass 1/5 — dispatching 4 parallel subagents for j-book-demo, j-reset-password, j-browse-catalog, j-view-pricing
[coverage-expansion] Pass 1/5 — j-book-demo returned: 6 tests added, 1 new branch, 0 new pages
[coverage-expansion] Pass 1/5 complete — 27 tests added, 3 branches discovered, committed
[coverage-expansion] Pass 2/5 starting — 15 journeys (1 sub-journey promoted)
...
[coverage-expansion] Pass 3/5 complete — total 68 tests added across three compositional passes
[coverage-expansion] Pass 4/5 starting — adversarial probing for 15 journeys
[coverage-expansion] Pass 4/5 — j-returning-user-checkout returned: 12 probes, 8 boundaries, 1 high-severity suspected bug
...
[coverage-expansion] Pass 4/5 complete — 216 probes, 147 boundaries verified, 9 suspected bugs (3 high, 5 medium, 1 low)
[coverage-expansion] Pass 5/5 starting — adversarial consolidation + regression authoring
[coverage-expansion] Pass 5/5 complete — 54 regression tests added, 11 new findings, all committed
[coverage-expansion] Cleanup — 7 cross-cutting findings consolidated across 18 journey sections
[coverage-expansion] Depth run complete — 5 passes + cleanup, 122 tests + 54 regression tests, ledger at tests/e2e/docs/adversarial-findings.md
```

---

## Orchestrator context budget

Hold in context:
- Journey map **index only** (IDs, names, priorities, `Pages touched`, `Test expectations`). Never the full step lists, branches, or state variations.
- Independence graph (ids + edges).
- Pass counter, subagent dispatch roster, aggregated return summaries.
- **Adversarial totals counter** (passes 4–5): journeys probed, boundaries verified across all journeys, suspected-bug count by severity, regression tests added. Counts only — never per-finding detail.

Never hold in context:
- Any journey's full `### j-<slug>` block contents beyond the indexed fields.
- Any DOM snapshot from MCP.
- Any test source composed by a subagent.
- Any stabilization transcript.
- Any adversarial-findings ledger content beyond the one-journey exception documented below.

One bounded exception for pass 5: when dispatching a pass-5 subagent, the orchestrator does read the journey's pass-4 ledger section from the ledger file and pass it along as an input. This is strictly bounded to one journey's section for one subagent; the orchestrator releases it from context as soon as the dispatch is sent.

If orchestrator context approaches a budget boundary mid-pass, write state to `docs/superpowers/state/coverage-expansion.json` and resume on next invocation.

---

## Integration with other skills

- **`journey-mapping`** — produces the precisely-embeddable journey map this skill reads. Map must be sentinel-bearing. No schema change required for adversarial passes.
- **`test-composer`** — called once per journey per compositional pass (1–3) with `args: "journey=<j-id>"`. Owns compose, stabilize, API compliance, coverage verification. NOT called during adversarial passes.
- **`bug-discovery`** — invoked from **inside** each adversarial-pass subagent, scoped to one journey. No change to the skill itself; it accepts a scoped invocation. Subagents decide probe-category selection autonomously based on live observation.
- **`failure-diagnosis`** — invoked inside any subagent (compositional or adversarial) when stabilization fails. The orchestrator does not call it directly.
- **`onboarding`** — calls this skill as its Phase 5 with `mode: depth`. Phase 5 now produces adversarial-findings as a side effect. Onboarding's Phase 6 (standalone `bug-discovery`) remains in place as a wider, cross-app adversarial sweep; per-journey adversarial coverage is handled earlier inside Phase 5.

---

## Non-goals

- Mapping new journeys from scratch — that's `journey-mapping`.
- Composing a single journey's tests — that's `test-composer`.
- Cross-application coverage — one invocation covers one app.
- Running adversarial probing in breadth mode. Breadth stays one horizontal sweep; users who want adversarial coverage explicitly want depth.
- Writing regression tests for findings classified as `Suspected bugs` or `Ambiguous`. Never lock buggy behavior into a passing suite. Never use `test.fail()` markers — they rot into permanent CI noise.
- Growing the journey map during adversarial passes. Map growth is for compositional passes only.
- Broad cross-app adversarial sweeps — that's still the job of the standalone `bug-discovery` skill. This skill's adversarial passes are strictly per-journey.
