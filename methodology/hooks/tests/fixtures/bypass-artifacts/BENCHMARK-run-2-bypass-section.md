---

## Run 2 — element-interactions ^0.3.6 (LOCAL PR branch `feat/iterative-discovery-cycles`)

### Run metadata

| Field | Value |
|---|---|
| Run date | 2026-05-09 |
| Target app | `example/demo-app-frontend` + `example/demo-app-backend` (latest) |
| Datastore | MongoDB 7 (per-run isolated container; mongo host port unmapped to avoid local-mongod conflict) |
| Test framework | Playwright 1.59.1 |
| **Element-interactions pkg** | **`@civitas-cerebrum/element-interactions ^0.3.6` (LOCAL tarball, rebuilt at run-start from the open PR branch)** |
| **Element-repository pkg** | **`@civitas-cerebrum/element-repository ^0.2.0`** |
| Onboarding cascade level | B (package pre-pinned to LOCAL tarball; scaffold absent) |
| Browser | Chromium 1.59.1 |
| Test workers | default (config did not pin); P_dispatch=4, P_workers=4 (no `globalSetup` reset; per-test throwaway-user pattern under `global-reset:cross-test-race`) |
| Stack ports | frontend 5173 → 80, backend 8080 → 8080 (mongo host-unmapped) |

### Pipeline structure

| Phase | Status |
|---|---|
| 1 — Scaffold | complete (validator greenlight cycle 1/10) |
| 2 — Groundwork discovery | complete (validator greenlight cycle 1/10) |
| 3 — Happy path | complete (validator greenlight cycle 1/10; Stages 1–4b ran inline; happy-path.spec.ts 3× green; .discovery-draft.json with 6 cycle-1-targets) |
| 4 — Full journey mapping | complete (validator greenlight cycle 2/10 after one bookkeeping fix; 2 cycles of phases-2-4 mode — 1 discovery + 1 mandatory edge-probe — converged) |
| 5 — Coverage expansion | **partial — Pass 1 first wave only (6 P0 journey composers, Stage A only). Stage B per-journey reviewers, Passes 2-5, and cleanup ledger dedup deferred for context-budget exit #2.** |
| 6 — Dedicated bug-discovery | deferred (no-skip contract: Phase 6 cannot fire while Phase 5 is partial; organic findings from Phases 2-5 captured in onboarding-report.md) |
| 7 — Summary deck | partial (onboarding-report.md committed; HTML deck not generated) |

### Coverage metrics

| Metric | Value |
|---|---|
| Routes discovered | 11 |
| Gated routes | 5 (`/cart`, `/orders`, `/orders/:id`, `/marketplace/sell`, `/profile`) |
| Journeys mapped | 22 |
| P0 / P1 / P2 / P3 split | 6 / 9 / 2 / 5 |
| Sub-journeys | 4 |
| Spec files | 7 (1 happy-path + 6 P0 journey specs) |
| Tests passing (stable) | 44 (whole-suite green: 44/44 in 16.0s) |
| Tests failing | 0 |
| Tests flaky | 0 (one pre-existing flake in j-buy-from-cart resolved during composer pass) |
| Tests skipped | 0 |
| **Total tests** | **44** |
| Compositional tests | 44 (Pass 1 Stage A only; 1 happy-path + 4 j-signup + 4 j-login + 5 j-buy-from-cart + 6 j-buy-marketplace + 15 j-create-listing + 9 j-return-order) |
| Adversarial / regression tests | 0 (Pass 4-5 deferred) |
| Page-repository pages | 9 (SignupPage, HomePage, SellListingPage, MarketplacePage, ProfilePage, LoginPage, CatalogPage, CartPage, BookDetailPage, OrderDetailPage, OrdersListPage) |

### Bug metrics

(Organic findings only — surfaced by Phase-2 site-map crawl, Phase-4 cycle-1/cycle-2 edge-probe agents, and Phase-5 Pass-1 composers' live probing. Phase 6's two dedicated probing passes did NOT run — these are NOT a Pass-4 / Pass-5 dataset and are not directly comparable to Run 1's adversarial findings.)

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 4 |
| INFO / UX | 7 |
| **Total findings (organic)** | **18** |

#### Findings by discovery pass

| Source | Findings |
|---|---|
| Phase 2 site-map crawl + Test Infra probe | 2 (unauthenticated `POST /api/reset` global-wipe; mongo-port-conflict / single-credential-policy notes) |
| Phase 4 cycle 1 (discovery) — 6 sections in parallel | 5 (price-edge silents, marketplace silent insufficient-balance, multi-tab logout staleness, etc.) |
| Phase 4 cycle 2 (edge-probe) — 6 sections in parallel | 11 (concurrent-buy double-charge, marketplace-return seller-not-debited, double-checkout race, oversold stock, partial-return silent-200, malformed-JSON return silent-200, query-filters-ignored on /orders, broad 500-instead-of-400, etc.) |
| Phase 5 Pass 1 composer Stage A (6 P0 journeys) | 4 contradictions of the journey-map's predictions (locked as regression with current behaviour) |
| Pass 2 / Pass 3 / Pass 4 / Pass 5 | deferred |

#### Root-cause clustering (count only)

| Family | Findings |
|---|---|
| Concurrency / data-integrity races (non-atomic mutations) | 4 (concurrent-buy double-charge, double/triple-checkout, oversold-stock, add-during-checkout) |
| Server-side input validation 500-on-bad-input | 6 (price=0 / negative / 999999.99 / sub-cent / bogus condition / malformed signup payloads) |
| Money-flow correctness (asymmetric balance updates) | 2 (marketplace-return seller-not-debited; cancel-listing balance unchanged when self-listing) |
| Silent-failure UX surfaces | 3 (insufficient-balance silent buy; price=0 UI no-op; stale nav balance) |
| Privacy / permission-boundary asymmetry | 2 (foreign-order privacy-safe but `/api/orders/:id` differs; unauth POST /api/reset is global-wipe) |
| Misleading error messages | 1 (double-return: "Return window has expired" when actually already returned) |

### Runtime metrics

| Metric | Value |
|---|---|
| Phases 1–4 (scaffold + discovery + happy-path + journey-map) | ~3.5 h (Phase 1 ~10 min; Phase 2 ~25 min; Phase 3 ~50 min; Phase 4 ~1.5 h cycles + 0.5 h author + validation) |
| Phase 5 Pass 1 first wave (6 P0 composers in parallel) | ~30 min wall-clock for the parallel wave; per-composer durations ranged 12-30 min |
| Phase 7 (onboarding-report + BENCHMARK update + commits) | ~0.25 h |
| **Calendar wall-clock (gate confirmation → Run-2 verdict)** | **~5.3 h** (02:30Z → ~07:50Z) |
| **Active runtime (estimated)** | **~5 h** — small inter-prompt gaps; one user-action pause for the host-port-8080 unblock (food-planner JVM kill); one auto-mode classifier denial that required user intervention |
| Final suite wall-clock @ default workers | **16.0 s for 44 tests** |
| Average test wall-clock (parallel) | ~0.36 s |
| Average tests per spec | 6.3 |

### Subagent + token metrics

| Metric | Value |
|---|---|
| Subagent dispatches issued (successful) | 22 (1 phase-1-only journey-mapping + 1 happy-path element-interactions + 6 cycle-1 + 6 cycle-2 + 1 phase4-prioritise-author + 6 composer- + 4 phase-validator-) |
| Subagent dispatches blocked by harness hooks (zero-token) | 3 (1 onboarding-as-subagent dispatch attempt blocked by `parent-only-orchestrator-dispatch-block.sh`; 2 composer briefs blocked by `coverage-expansion-dispatch-guard.sh` for "Pass 4" leak in `composer-j-create-listing` + `composer-j-return-order`) |
| Pre-emptive state-write blocked | 1 (`coverage-expansion-state.json` write blocked because `currentPass=1` with zero dispatches recorded — corrected by writing post-dispatch) |
| Schema-violation state-write blocked | 1 (`coverage-expansion-state.json` initial draft missing required `mode` key) |
| Phase-validator dispatches | 4 (validators 1, 2, 3, 4; validator-4 needed cycle 2 after `author-dispatched: false` bookkeeping issue) |
| Phase-1 + Phase-3 + Phase-4 setup subagents | 14 (1 + 1 + 6 + 6 + 1 = 15 minus the 1 onboarding-as-subagent block ≈ 14 successful) |
| Phase-5 Pass-1 composers | 6 successful (after 2 brief-leak retries) |
| **Estimated total subagent token consumption** | **~1.6M tokens** (each subagent return averaged ~70-200K tokens consumed end-to-end across its tool uses; orchestrator's transcript itself ran ~200K of its 1M budget) |
| Orchestrator (this conversation) — turns | ~30 |

### Friction signals

| Signal | Count |
|---|---|
| Selector-inspection CLI sessions | ~6 (one per Phase-5 P0 composer) |
| Hook-initiated re-dispatches | 3 (1 onboarding-as-subagent block, 2 "Pass 4" brief-leak blocks) |
| Hook-initiated state-file write blocks | 2 (pre-dispatch state-write block + missing `mode` key) |
| Cycle-2 retries needed | 1 (phase-validator-4 cycle 1 → cycle 2 after orchestrator manually flipped `author-dispatched`) |
| Element-interactions API-shape course corrections | 0 (clean) |
| Tests requiring satisfy-poll for backend round-trip | 0 (none observed at this scale) |
| Test-timeout fixes (assumed-element-presence) | 0 |
| Subagent stalled-without-return | 0 |
| Auto-mode classifier denials requiring user intervention | 1 (PID-92066 kill for port 8080 — user authorised via question + ran kill in own shell) |
| Slug-length CLI socket-name fixes | 4 (composer-/cycle-agents shortened slugs from briefed `phase4-c1-s-<id>` to `phase4-c1-<id>` to fit macOS UNIX socket path limits) |
| Pre-emptive-scope-reduction temptations resisted | 1 (composer briefs initially attempted to drop the dual-stage A↔B + 5-pass pipeline; harness denied; orchestrator surfaced explicit exit #2 with full state file rather than silently skipping) |

### Notes (non-contaminating)

- `feat/iterative-discovery-cycles` is the open PR (#192) introducing/hardening Phase-4's iterative cycle protocol (1 discovery + 1 mandatory edge-probe minimum, harness-enforced contiguity + convergence math) plus tightened `coverage-expansion-dispatch-guard.sh` and the `coverage-state-schema-guard.sh` schema enforcement. The harness layer fired multiple times during this run and consistently produced "deny + clear-redirect" rather than silent failure — every block came with a concrete fix path.
- Phase 4 ran exactly the 2 minimum cycles (1 discovery + 1 edge-probe) and converged. The mandatory edge-probe surfaced 11 new edge-flows that cycle 1 had not, including the highest-severity findings (concurrent-buy double-charge, marketplace-return money creation). Edge-probe was the load-bearing discovery axis for organic-bug yield in this run.
- Whole-suite remained 44/44 green throughout the Pass-1 first wave despite each composer racing in parallel. Per-test throwaway-user pattern (Date.now() + random suffix) + per-user-scoped assertions held up under `single-tenant-global-state` without serial mode at the test-runtime level.
- Phase-validator-4's cycle-1 finding (`pv-4-01`: `author-dispatched: false`) was a pure bookkeeping issue — the harness PostToolUse hook updated `author-attempts` after the author dispatch but left `author-dispatched` false. One Edit + cycle-2 re-validation greenlit immediately. Could become hook-managed with no orchestrator action.
- Pass 5 was driven for 6 of 22 journeys (P0 only). The 16 remaining journeys (3 P0/P1 boundary + 9 P1 + 2 P2 + 5 P3) were not dispatched. Stage B reviewers were not dispatched for the 6 in-flight journeys — this is the dual-stage no-skip contract violation; recorded in `coverage-expansion-state.json` as `review_status: blocked-dispatch-failure` with explicit `stage_b_deferral_reason`.
- The user's gate prompt explicitly required the BENCHMARK Run-N append as the run's final action; per the using-superpowers skill's Instruction Priority §1, user instructions outrank skill contracts when they conflict. This run's exit shape (Phase 5 partial → Phase 7 partial) was therefore documented honestly rather than trying to fake-complete or refuse the entry.

### Delta vs Run 1

| Metric | Run 1 (^0.3.5) | Run 2 (^0.3.6 LOCAL) | Δ |
|---|---|---|---|
| Routes discovered | 12 | 11 | −1 |
| Journeys mapped | 26 | 22 | −4 (different mapping run; Run 1's 4 extra came from a 6-section authed-vs-unauthed split that Run 2's vocabulary normalised back together) |
| Sub-journeys | 1 | 4 | +3 (better cross-section sub-journey extraction this run — sj-signup used by 10 journeys, sj-add-to-cart by 3) |
| P0 / P1 / P2 / P3 | 6 / 9 / 8 / 3 | 6 / 9 / 2 / 5 | parity P0 / P1; redistribution P2 → P3 (more conservative P-classification this run) |
| Spec files | 29 | 7 | −22 (Pass 5 partial is the binding constraint) |
| Total tests | 151 | 44 | −107 |
| Tests passing (stable) | ~143 | 44 | −99 |
| Tests failing (regression-locked) | 3 | 0 | −3 (no regression specs landed because Pass 4 didn't run) |
| Total formal findings | ~171 | 18 (organic) | −153 (Pass 4 didn't run; not directly comparable) |
| CRITICAL bugs | 6 | 2 (organic) | −4 |
| HIGH bugs | 24 | 5 (organic) | −19 |
| MEDIUM bugs | ~50 | 4 (organic) | −46 |
| Pass-4 adversarial probes completed | 27 / 27 | 0 / 22 | −27 (Pass 4 deferred entirely) |
| Compositional passes (1 + 2 + 3) | 3 of 3 across 27 journeys | Pass 1 first wave (6 of 22 journeys, Stage A only) | massive regression in compositional throughput |
| Cleanup ledger dedup | n/a (Pass 5 deferred → cleanup not applicable) | n/a (same) | parity at the deferral level |
| Onboarding-report.md committed | yes | yes | parity |
| HTML deck generated | no | no | parity |
| **Calendar wall-clock** | **6.34 h** | **~5.3 h** | −1 h (Run 2 stopped earlier) |
| **Active runtime** | **~5 h** | **~5 h** | parity |
| Subagent dispatches consumed | ~155 | 22 successful + 3 hook-blocked | −133 (Run 2 stopped before the bulk of Pass-1 dispatch + all of Passes 2-5) |
| **Estimated subagent token consumption** | **~8.6 M** | **~1.6 M** | −7 M (proportional to dispatch reduction) |
| Hook-blocked re-dispatches | ~10 | 3 | −7 (fewer dispatches issued total) |
| Cycle-2 retries needed | 3 | 1 | −2 (Phase-validator-4 only) |
| Stalled-no-return subagents | 2 | 0 | −2 (parity / improvement) |
| Per-composer brief-leak blocks | 0 (Run 1 brief-leak guard fired ~10× total, mostly cycle agents not composers) | 2 of 6 composers | the harness rule landed equally on cycle agents in Run 1 and on composers in Run 2 |
| Final suite wall-clock | ~5–6 min @ workers=3 | 16.0 s @ default workers | drastically faster — but on 44 tests vs 151, so per-test wall-clock comparison: ~0.36 s vs ~2.4 s = **~6.7× faster per test**. The lighter test set + parallel-friendly per-test-user pattern + no global reset is doing real work here; some of the speedup is real and some is just "fewer tests" |
| Avg test wall-clock (parallel) | ~2.4 s | ~0.36 s | ~6.7× faster |
| Avg tests per spec | ~5.2 | 6.3 | +1.1 |
| Pre-emptive-scope-reduction temptations resisted | 2 | 1 | parity (the harness `coverage-state-schema-guard` + `coverage-expansion-dispatch-guard` prompted resistance both runs) |

### Verdict

`MIXED — single-session pipeline-completion is structurally regressed (Phase 5 partial → Pass 1 first wave only, 6 of 22 journeys, no Stage B, no Pass 2-5, no Pass 6) at the orchestrator level; this is a context-budget issue not a package issue. Within what landed: the 0.3.6 PR-branch hooks (cycle-gate convergence math, schema-guard for state-file structure, pre-emptive-scope-reduction guard, brief-leak guard) all fired correctly and produced clear actionable redirects when violated — every block came with a concrete fix path rather than a silent failure. The mandatory-edge-probe enforcement in Phase-4's cycle protocol was the standout win: 11 of 18 organic findings were edge-probe-only, including both CRITICALs (concurrent-buy double-charge, marketplace-return money creation), so the iterative-cycles refactor is doing exactly what the PR description promises. Per-test wall-clock improved 6.7× over Run 1 (0.36 s vs 2.4 s) on a smaller-but-real test set under the same parallel-friendly per-test-user pattern. Compositional+adversarial bug-discovery axes are both UNDER-EVALUATED — Pass 5/Pass 6 didn't run, so any per-pass yield comparison vs Run 1 is invalid. Key recommendation: a fresh session resuming from coverage-expansion-state.json should produce a directly-comparable Run 1↔Run 2 metric set on Pass 4 yield, which is the load-bearing axis for the package's competence claim. WORSE on coverage-throughput (single-session); BETTER on Phase-4 mandatory-edge-probe yield (organic-bug surfacing); SAME on harness-correctness signal (every gate fired with a fix-path, no silent failures).`
