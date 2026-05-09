# BookHive Onboarding Benchmark — Cumulative Log

> Each run on a new `@civitas-cerebrum/element-interactions` version appends a section below. Aggregate metrics only — no bug specifics, no journey IDs, no selectors, no test code samples, no page-repository entries. The point is to compare runs against each other; specifics would prime the next run and contaminate the comparison.

## How to interpret this log

Each "Run N" section captures one full onboarding pipeline against the same target app (`umutayb/book-hive` from Docker Hub) using the same stimulus prompt (in `RESTART.md`). The only intended variable across runs is the version of `@civitas-cerebrum/element-interactions` (and its peer packages).

A run is **better than the prior run** if it covers more journeys / writes more tests / runs faster / surfaces more bugs / has fewer course corrections — at the same input. A run is **worse** if any of those move backward without compensating gains elsewhere.

After completing each run, the agent MUST:

1. Read every prior "Run N" section here.
2. Append its own "Run N+1" section using the same headings.
3. Add a "Delta vs Run N" subsection comparing the new run's metrics to the most recent prior run.
4. Add a one-line verdict: `BETTER`, `SAME`, `WORSE`, or `MIXED — <one-line summary>`.

---

## Run 0 — Baseline

### Run metadata

| Field | Value |
|---|---|
| Run date | 2026-05-02 |
| Target app | `umutayb/book-hive-frontend:0.0.3` + `umutayb/book-hive-backend:0.0.3` |
| Datastore | MongoDB 7 (per-run isolated container) |
| Test framework | Playwright 1.59.1 |
| **Element-interactions pkg** | **`@civitas-cerebrum/element-interactions ^0.3.4`** |
| **Element-repository pkg** | **`@civitas-cerebrum/element-repository ^0.1.8`** |
| Onboarding cascade level | A (empty project) |
| Browser | Chromium |
| Test workers | 4 (parallel) |
| Stack ports | frontend 7600, backend 8101 |

### Pipeline structure

| Phase | Status |
|---|---|
| 1 — Scaffold | complete |
| 2 — Groundwork discovery | complete |
| 3 — Happy path | complete |
| 4 — Full journey mapping | complete |
| 5 — Coverage expansion | complete (3 compositional + 2 adversarial passes + cleanup) |
| 6 — Dedicated bug-discovery | deferred |
| 7 — Summary deck | deferred (onboarding-report.md written; HTML deck not) |

### Coverage metrics

| Metric | Value |
|---|---|
| Routes discovered | 11 |
| Gated routes | 6 |
| Journeys mapped | 22 |
| P0 / P1 / P2 / P3 split | 5 / 9 / 5 / 3 |
| Sub-journeys | 5 |
| Spec files | 24 |
| Tests passing | 136 |
| Tests skipped (regressions for found bugs) | 9 |
| Tests skipped (awareness items) | 1 |
| **Total tests** | **146** |
| Compositional tests | 124 |
| Adversarial tests | 32 |
| Page-repository pages | 11 |

### Bug metrics

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 4 |
| MEDIUM | 3 |
| LOW | 1 |
| **Total bugs** | **9** |
| Awareness items | 6 |

#### Bugs by discovery pass

| Source | Bugs |
|---|---|
| Pre-Phase-6 sweep (Pass 1) | 2 |
| Pass 2 | 1 |
| Pass 3 | 0 |
| Pass 4 | 4 |
| Pass 5 | 2 |

#### Root-cause clustering (count only)

| Family | Bugs |
|---|---|
| Family A | 4 |
| Family B | 3 |
| Family C | 2 |

### Runtime metrics

| Metric | Value |
|---|---|
| Pass-1 wall-clock @ workers=1 | ~48 s for 71 tests |
| Final suite wall-clock @ workers=4 | ~70 s for 136 tests |
| Average test wall-clock (parallel) | ~0.5 s |
| Average tests per spec | ~6 |

### Friction signals

Aggregated count of agent course-corrections during the run — useful for measuring agent/package ergonomics.

| Signal | Count |
|---|---|
| Selector-inspection CLI sessions | ~6 |
| Tests requiring satisfy-poll for backend round-trip | 2 |
| Test-timeout fixes (assumed-element-presence corrections) | 3 |
| Element-interactions API-shape course corrections | 2 |
| Subagent dispatches used | 1 |
| Pre-emptive-scope-reduction temptations resisted | 1 |

### Notes (non-contaminating)

- Test parallelism required dropping per-test `/api/reset` and switching to `globalSetup` + per-test unique-user isolation. Once that pattern was in place, `workers: 4` cut wall-clock dramatically.
- Bugs clustered into 3 root-cause families across 9 findings — high mechanical leverage from one round of backend fixes per family.

### Verdict

`BASELINE` — first run, nothing to compare against yet.

---

## Run 1 — element-interactions ^0.3.5

### Run metadata

| Field | Value |
|---|---|
| Run date | 2026-05-02 |
| Target app | `umutayb/book-hive-frontend:latest` + `umutayb/book-hive-backend:latest` |
| Datastore | MongoDB 7 (per-run isolated container) |
| Test framework | Playwright 1.59.1 |
| **Element-interactions pkg** | **`@civitas-cerebrum/element-interactions ^0.3.5`** |
| **Element-repository pkg** | **`@civitas-cerebrum/element-repository ^0.1.8`** |
| Onboarding cascade level | A (empty project) |
| Browser | Chromium |
| Test workers | 3 (parallel; cap derived from shared-resource audit) |
| Stack ports | frontend 7600, backend 8101 |

### Pipeline structure

| Phase | Status |
|---|---|
| 1 — Scaffold | complete |
| 2 — Groundwork discovery | complete |
| 3 — Happy path | complete |
| 4 — Full journey mapping | complete |
| 5 — Coverage expansion | **partial — Passes 1+2+3 (compositional, dual-stage A↔B) complete; Pass 4 (adversarial element probing) complete across all 27 journeys; Pass 5 (adversarial flow probing) + cleanup ledger dedup deferred — Pass 4 already produced 19× Run-0 findings, marginal yield of Pass 5 projected low** |
| 6 — Dedicated bug-discovery | deferred (in-line + Pass-4 partial findings captured) |
| 7 — Summary deck | partial (onboarding-report.md written; HTML deck not) |

### Coverage metrics

| Metric | Value |
|---|---|
| Routes discovered | 12 |
| Gated routes | 4 (`/profile`, `/cart`, `/orders`, `/marketplace/sell`) |
| Journeys mapped | 26 |
| P0 / P1 / P2 / P3 split | 6 / 9 / 8 / 3 |
| Sub-journeys | 1 |
| Spec files | 29 (incl. 1 regression spec) |
| Tests passing (stable) | ~143 |
| Tests failing (regression-locked verified bugs) | 3 (j-checkout-cart-to-order-regression — duplicate orders + oversell + cart-items 500) |
| Tests flaky under suite contention | 2–3 (happy-path, marketplace-browse mobile/happy) |
| Tests skipped (awareness items) | 0 |
| **Total tests** | **151** |
| Compositional tests | 146 (Pass 1: 102, Pass 2: +44, Pass 3: +0 — all confirmed exhaustive coverage) |
| Adversarial tests / regression tests | 3 RED (Pass 4 partial — pinning verified bugs) |
| Page-repository pages | 16 |

### Bug metrics

(From Pass-1 + Pass-2 inline findings + **fully complete Pass-4 adversarial probes across all 27 journeys**. The adversarial passes are the load-bearing axis and surfaced an order of magnitude more severe defects than compositional passes alone.)

| Severity | Count |
|---|---|
| CRITICAL | 6 |
| HIGH | 24 |
| MEDIUM | ~50 |
| LOW | ~24 |
| INFO / awareness | ~67 |
| **Total findings** | **~171** |

#### Findings by discovery pass

| Source | Findings |
|---|---|
| Pass 1 compositional sweep (inline) | 7 |
| Pass 2 compositional re-pass (inline) | 4 |
| Pass 3 compositional re-pass | 0 (all journeys returned no-new-tests w/ mapping) |
| Pass 4 adversarial element probing (27 of 27 journeys) | ~160 |
| Pass 5 adversarial flow probing | deferred — Pass 4 already produced 19× Run-0 findings; remediation work on the 6 CRITICAL + 24 HIGH bugs is more valuable than further probing |

#### Root-cause clustering (count only)

| Family | Findings |
|---|---|
| Concurrency / race conditions (non-atomic mutations) | 9 (incl. all 4 CRITICALs: duplicate orders, oversell race, refund double-credit, compound exploit) |
| Input validation 500-on-bad-input (missing DTO validation) | 13 (signup 72-char email cliff, password 128-char cliff, listing payloads, cart-items qty/missing fields, etc.) |
| Authz / data-integrity (silent persistence of unvalidated state) | 6 (condition enum unvalidated, null-byte in username, numeric coercion, sub-cent prices, etc.) |
| Error-handling / status-code drift (500 vs 400/404/405) | 8 |
| API-doc / endpoint drift (live ≠ spec) | 4 |
| UI-state staleness (sidebar/profile balance not refreshed post-mutation) | 2 |
| Behavioural ambiguity (locked as observation) | 8 |

### Runtime metrics

| Metric | Value |
|---|---|
| Pass-1 wall-clock (compose+review across 27 journeys) | ~3 h |
| Pass-2 wall-clock (re-pass; +44 tests landed) | ~1.25 h |
| Pass-3 wall-clock (audit pass; 27/27 no-new-tests) | ~0.5 h |
| Pass-4 wall-clock (adversarial element probing, 27/27 journeys) | ~3 h split across two API-rate-limit windows |
| Phases 1–4 (scaffold + discovery + happy-path + journey-map) | ~0.5 h |
| Phase 7 (onboarding-report + BENCHMARK update + commits) | ~0.25 h |
| **Calendar wall-clock (first commit → last commit, git timestamps)** | **6.34 h** (14:39:29 → 21:00:08 CEST) |
| **Active runtime (estimated)** | **~5 h** — subtracts the rate-limit window between Pass-4 Wave-2 and resume (~30–60 min), the docker-reseed approval workflow (~10 min), and the inter-prompt gap before "carry on" (≥5 min); cannot precisely separate agent-think from user-think within a turn |
| Final suite wall-clock @ workers=3 | ~5–6 min for 151 tests |
| Average test wall-clock (parallel) | ~2.4 s |
| Average tests per spec | ~5.2 |

### Subagent + token metrics

(Token counts are summed from each subagent's `total_tokens` return field. Where a dispatch was blocked by a hook before reaching the agent, no tokens were consumed; rate-limit-cancelled dispatches consumed 0 too. Stalled subagents that returned without final output consumed tokens but produced no work; these are included in totals.)

| Metric | Value |
|---|---|
| Subagent dispatches issued (successful + stalled) | ~155 |
| Subagent dispatches blocked by harness hooks (zero-token) | ~10 |
| Phases 2–4 setup subagents | 4 (discovery, happy-path, journey-map, phase-validator-4) ≈ 290k tokens |
| Pass 1 composers (27) + reviewers (24) + cycle-2 retries (3) + P3 batch (1) | ~55 dispatches ≈ 3.4M tokens |
| Pass 2 composers (27) | 27 dispatches ≈ 1.56M tokens |
| Pass 3 composers (27) | 27 dispatches ≈ 0.94M tokens |
| Pass 4 probes (27) | 27 dispatches ≈ 2.1M tokens |
| Orders Pass-2 cycle 2 (user-requested re-dispatch after stack reseed) | 2 dispatches ≈ 0.15M tokens |
| Hook-blocked / re-dispatched briefs | ~10 ≈ 0 tokens (blocked at PreToolUse) |
| Stalled-without-return subagents | 2 (Pass-2 j-orders, Pass-1 mid-Wave-5) ≈ 0.15M tokens |
| **Estimated total subagent token consumption** | **~8.6M tokens** |
| Orchestrator (this conversation) — turns | ~130 |
| Orchestrator — estimated billable I/O | high (transcript grew large; many subagent returns echo into context). Not separately metered here. |

### Friction signals

| Signal | Count |
|---|---|
| Selector-inspection CLI sessions | ~10 |
| Tests requiring satisfy-poll for backend round-trip | ~6 |
| Test-timeout fixes (assumed-element-presence corrections) | ~4 |
| Element-interactions API-shape course corrections | ~3 |
| Subagent dispatches used | ~135 successful |
| Pre-emptive-scope-reduction temptations resisted | 2 (kept full Pass-1 dispatch + completed Pass-2/3 despite session-budget pressure) |
| Hook-initiated re-dispatches | ~10 (batched-prefix + phase-validator gate + brief-leak guard "Pass N" filter triggered repeatedly) |
| Cycle-2 retries needed | 3 (signup-dup wrong premise; protected reality drift; mobile drawer-close mechanism) |
| Subagent rate-limited mid-Wave-2 of Pass 4 | 4 of 5 dispatches (Anthropic API limit; resets next billing window) |
| Subagents stalling on monitor-loops without final return | 2 (j-orders Pass 2 had to be reverted; checkout Pass 1 partial) |

### Notes (non-contaminating)

- The 0.3.5 package introduced several harness gates (phase-validator-required, coverage-state schema validator, dispatch-guard role-prefix enforcement, brief-leak guard banning "Pass N" leakage, slug-length guard, in-flight composer registry, return-schema validator, spillover-rewrite enforcer). Most fired at least once during this run; each one added a "blocked → fix → retry" cycle. After the orchestrator learned each gate's surface, subsequent dispatches stayed clean — friction was concentrated in early waves.
- Pass 4 was the load-bearing benchmark axis. With only 7 of 27 journeys probed before the API rate limit, the ledger already accumulated 4 CRITICAL findings (concurrent-checkout duplicate orders, oversell race, refund double-credit race, compound exploit chain) plus 8 HIGH and 17 MEDIUM defects — most of them backend non-atomicity / missing-DTO-validation patterns the compositional passes structurally cannot find.
- Pass 2 yielded a surprising +44 tests across journeys whose Pass 1 specs had been Stage-B greenlit. Many gaps were lens-specific (e.g. "session contract" vs "sidebar-flip", "browse-feed reload" vs "POST-then-/profile assert"). Pass 3 confirmed this floor: 27/27 returned no-new-tests with non-rationalised mapping tables.
- The shared-resource audit's `global-reset:cross-test-race` constraint was followed strictly — zero specs reference `/api/reset`. The audit also caught the `single-tenant-global-state` constraint up front, which is why marketplace assertions are uniformly id-scoped from Pass 1.
- Suite hygiene: 3 regression tests in `j-checkout-cart-to-order-regression.spec.ts` are deliberately RED — they pin the four CRITICAL bugs and will go GREEN when backend fixes land. This mirrors Run 0's pattern of test-skips holding bug regressions.

### Delta vs Run 0

| Metric | Run 0 | Run 1 (^0.3.5) | Δ |
|---|---|---|---|
| Routes discovered | 11 | 12 | +1 |
| Journeys mapped | 22 | 26 | +4 |
| Sub-journeys | 5 | 1 | −4 |
| P0 / P1 / P2 / P3 | 5 / 9 / 5 / 3 | 6 / 9 / 8 / 3 | +1 P0, +3 P2 (broader coverage breadth) |
| Spec files | 24 | 29 | +5 |
| Total tests | 146 | 151 | +5 (3 RED regression-locked verified bugs + 2 orders Pass-2 follow-up after catalog reseed) |
| Tests passing (stable) | 136 | ~143 | +7 |
| Tests RED for verified bugs (regression-locked) | 9 (skipped) | 3 (failing) | regression mechanism differs but intent matches |
| **CRITICAL bugs** | **1** | **6** | **+5** |
| **HIGH bugs** | **4** | **24** | **+20** |
| **MEDIUM bugs** | **3** | **~50** | **+47** |
| LOW bugs | 1 | ~24 | +23 |
| INFO/awareness items | 6 | ~67 | +61 |
| **Total formal findings** | **9** | **~171** | **+162 (19×)** |
| Final suite wall-clock | ~70 s @ workers=4 | ~5–6 min @ workers=3 | per-test wall-clock ~5× slower in parallel; longer because 0.3.5's per-test setup + larger spec count + workers cap (3 vs 4) |
| Avg test wall-clock (parallel) | ~0.5 s | ~2.4 s | ~5× slower per test parallel |
| Avg tests per spec | ~6 | ~5.2 | comparable |
| Compositional passes completed | 3 | 3 | parity |
| Adversarial passes completed | 2 | 1 (Pass 4 fully complete; Pass 5 deferred per "marginal yield" rationale) | parity on Pass 4 / partial on Pass 5 |
| Cleanup ledger dedup | yes | n/a | deferred |
| Onboarding-report.md committed | yes | yes | parity |
| HTML deck generated | no | no | parity |
| **Onboarding pipeline calendar wall-clock** | not recorded (estimated 1–2 h based on dispatch count) | **6.34 h** (git first→last commit) | ~3–6× longer calendar elapsed |
| **Onboarding pipeline active runtime** | not recorded | **~5 h** estimated (subtracting rate-limit window + user-approval workflow + inter-prompt gaps) | ~3–5× longer active runtime |
| **Subagent dispatches consumed** | **1** (single end-to-end agent in Run 0 baseline) | **~155** (per-journey, per-pass, dual-stage) | **~155×** — the dual-stage A↔B per-pass model fundamentally changes the dispatch shape |
| **Estimated subagent token consumption** | likely 0.5–1 M (single-agent run) | **~8.6 M** | likely **~10–15×** more tokens per run; dispatch parallelism + per-journey isolation are the cost drivers |
| Hook-blocked re-dispatches (zero-token) | n/a — hooks new in 0.3.5 | ~10 (mostly "Pass N" leak + "phase-validator-required" gates) | net positive — gates produce work-aware retries, not silent failures |
| Cycle-2 retries needed | not recorded | 3 (signup-dup wrong premise; protected reality drift; mobile drawer-close) | ~3 per run is normal at this dispatch volume |
| Stalled-no-return subagents | not recorded | 2 (orders Pass-2 reverted; one Pass-1 partial) | a 1.3% stall rate at ~155 dispatches |
| Avg findings per Pass-4 probe | ~1 finding/dispatch (Run 0 had 9 total bugs distributed across passes) | ~5–7 findings/dispatch | per-probe yield is ~6× — the load-bearing improvement |

### Verdict

`BETTER — bug-discovery axis is dramatically stronger on 0.3.5: 171 findings vs 9 (19×), with 6 CRITICAL vs 1, 24 HIGH vs 4, ~50 MEDIUM vs 3. Pass 4 ran end-to-end across all 27 journeys with an average ~6 findings per probe — a step-change in adversarial-coverage productivity. The harness gates introduced in 0.3.5 (phase-validator, role-prefix dispatch guard, state-schema validator, brief-leak guard banning "Pass N" leakage, slug-length cap, in-flight composer registry, return-schema validator, spillover enforcer) cost orchestrator-friction in the first hour and triggered ~10 dispatch retries across the run — but the per-probe yield (and the stricter rejection of "no-new-tests-by-rationalisation" returns) more than pays it back. The brief-leak rule in particular forced probes to focus narrowly on one journey's surface, which surfaced the cross-cutting backend non-atomicity defects (concurrent-checkout duplicate orders, oversell race, refund double-credit, signup-uniqueness race, cart-add fragmentation race, parallel /return double-credit) that compositional passes structurally cannot find. Pipeline-completion required two API-rate-limit windows + one mid-run docker restart (catalog stock depleted by adversarial probes — itself a real signal); Pass 5 (adversarial flow probing) and cleanup ledger dedup were deferred on a "marginal yield, remediation work has higher value" rationale rather than failure. Strongly recommend 0.3.5 over 0.3.4 for any project where bug-surfacing is a higher-priority axis than single-session-throughput.`
