---
name: coverage-expansion
description: >
  Iteratively expand E2E test coverage across an entire mapped application. Owns
  priority ordering, journey-by-journey iteration, parallel dispatch for
  independent journeys, model selection per journey size, and map reconciliation
  between passes. Calls the test-composer skill per journey; does not compose
  tests itself. Runs in two modes: `breadth` (one horizontal sweep, fast) or
  `depth` (three vertical passes, journey-by-journey, default). Triggers on
  "increase coverage", "expand tests", "iterative coverage", "deep coverage
  pass", and when invoked by the onboarding skill as its Phase 5.
---

# Coverage Expansion — Iterative Journey-by-Journey Test Growth

The orchestrator for coverage growth. Iterates the user journey map, dispatches `test-composer` per journey, merges map discoveries between journeys, and runs the full loop three times in depth mode or once in breadth mode.

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
- Finding app bugs via adversarial probes → `bug-discovery`.

---

## Prerequisites

1. `tests/e2e/docs/journey-map.md` must exist with `<!-- journey-mapping:generated -->` on line 1. If missing, stop and invoke `journey-mapping` first.
2. The map must be in the precise-embedding format (each journey is a self-contained `### j-<slug>:` block with a `Pages touched:` line). If the map is in an older format without stable IDs, invoke `journey-mapping` to re-emit it.

---

## Modes

| Mode | Invocation | Behaviour |
|---|---|---|
| `mode: depth` (default) | `args: "mode: depth"` or no args | Three passes, journey-by-journey in priority order, parallel where independent. |
| `mode: breadth` | `args: "mode: breadth"` | One horizontal sweep: priority × depth tiers across all journeys. Fast fallback for quick coverage growth. |

---

## Depth mode — three-pass pipeline

Each pass runs the same pipeline; the map grows between passes.

### Per-pass pipeline

1. **Read the map** (sentinel-verified). Build an in-memory index: `[(j-id, priority, pages-touched, test-expectations)]`. Read **only** these fields per journey — not full step lists, branches, or state variations.
2. **Recompute priority ordering.** Honour the map's priorities, but if a journey's `Test expectations` or pages touched have changed since the last pass (because a prior pass reconciled new branches into the map), adjust position.
3. **Build the journey independence graph** (see §"Journey independence graph" below).
4. **Dispatch subagents** — parallel for independent journeys, sequential for dependent ones. Each subagent invocation: `test-composer` with `args: "journey=<j-id>"`. Model chosen per the heuristic below.
5. **Collect subagent returns.** Each return is a structured discovery report (per `test-composer` Step 8 return format).
6. **Reconcile the map.** Append new branches to existing journey blocks. Add new `j-<slug>` or `sj-<slug>` blocks for newly-discovered journeys or sub-journeys. Append new pages/elements to `app-context.md`. Run a mini Phase 3.5 revision (see `journey-mapping`) if the pass introduced new overlaps.
7. **Commit.** One commit per pass.

### Pass differences

| Pass | Purpose |
|---|---|
| 1 — initial perception | Cover the map as produced by `journey-mapping`. Priorities as written. Each journey gets its full variant set (per `Test expectations:`). Map grows with whatever surfaces. |
| 2 — map-growth widening | Re-read the enriched map. Promote newly-discovered branches and sub-journeys to first-class journeys where they warrant it. Re-evaluate priorities. Re-attempt any journey where pass 1 deferred stabilization or returned coverage gaps. |
| 3 — consolidation | Final sweep on the refined map. Focus on cross-journey interactions, residual gaps, data-lifecycle variants that require wiring multiple journeys together, and any journey whose map block was materially refined in pass 2. |

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

Every subagent dispatched by this skill must:

1. Receive an **isolated context window** — no prior session content, no other journey's data.
2. Receive only: its assigned journey block + any `sj-<slug>` sub-journey blocks it references + the current `page-repository.json` slice for the pages that journey touches.
3. Have access to an **isolated Playwright MCP browser instance** (see the `element-interactions` orchestrator's "Isolated MCP instances for parallel subagents" rule). Parallel subagents never share one browser.
4. Not return until stabilization green, API compliance review clean, and coverage verified exhaustive (enforced inside `test-composer`).
5. Return a structured discovery report only — no pasted test source, no DOM snapshots, no MCP transcripts.

The orchestrator does not paste any of the above into its own context, either.

---

## Progress output

Emit one line per significant event, prefixed `[coverage-expansion]`:

```
[coverage-expansion] Pass 1/3 starting — 14 journeys mapped (3 P0, 6 P1, 4 P2, 1 P3)
[coverage-expansion] Pass 1/3 — dispatching 4 parallel subagents for j-book-demo, j-reset-password, j-browse-catalog, j-view-pricing
[coverage-expansion] Pass 1/3 — j-book-demo returned: 6 tests added, 1 new branch, 0 new pages
[coverage-expansion] Pass 1/3 — j-reset-password returned: 4 tests added, 0 new branches
...
[coverage-expansion] Pass 1/3 complete — 27 tests added, 3 branches discovered, committed
[coverage-expansion] Pass 2/3 starting — 15 journeys (3 P0, 7 P1, 4 P2, 1 P3 — 1 sub-journey promoted)
...
[coverage-expansion] Pass 3/3 complete — total 68 tests added across three passes
```

---

## Orchestrator context budget

Hold in context:
- Journey map **index only** (IDs, names, priorities, `Pages touched`, `Test expectations`). Never the full step lists, branches, or state variations.
- Independence graph (ids + edges).
- Pass counter, subagent dispatch roster, aggregated return summaries.

Never hold in context:
- Any journey's full `### j-<slug>` block contents beyond the indexed fields.
- Any DOM snapshot from MCP.
- Any test source composed by a subagent.
- Any stabilization transcript.

If orchestrator context approaches a budget boundary mid-pass, write state to `docs/superpowers/state/coverage-expansion.json` and resume on next invocation.

---

## Integration with other skills

- **`journey-mapping`** — produces the precisely-embeddable journey map this skill reads. Map must be sentinel-bearing.
- **`test-composer`** — called once per journey per pass with `args: "journey=<j-id>"`. Owns compose, stabilize, API compliance, coverage verification.
- **`failure-diagnosis`** — invoked inside `test-composer` subagents when stabilization fails. The orchestrator does not call it directly.
- **`onboarding`** — calls this skill as its Phase 5 with `mode: depth`. Onboarding does not itself run test-composer sweeps anymore.
- **`bug-discovery`** — runs after this skill, not before. Coverage expansion adds passing tests; bug discovery finds failing conditions.

---

## Non-goals

- Mapping new journeys from scratch — that's `journey-mapping`.
- Composing a single journey's tests — that's `test-composer`.
- Adversarial bug hunting — that's `bug-discovery`.
- Cross-application coverage — one invocation covers one app.
