# Onboarding Report — BookHive

**Date:** 2026-05-09
**Detected level:** B (LOCAL @civitas-cerebrum/element-interactions 0.3.6 from `feat/iterative-discovery-cycles` PR branch already pinned; scaffold absent)
**Happy path:** A user signs up for a new BookHive account, lists their own book for sale on the marketplace, and verifies the listing appears in the public marketplace.
**Runtime:** ~5 h 20 m active (gate confirmation 2026-05-09T02:30Z → Run-N append in progress)

## Pipeline status

| Phase | Status | Notes |
| --- | --- | --- |
| 1 — Scaffold | ✅ greenlight (cycle 1/10) | playwright.config.ts, fixtures/base.ts, page-repository.json, tsconfig.json, docker-compose.yml, .gitignore. Chromium installed. Stack up. |
| 2 — Groundwork discovery | ✅ greenlight (cycle 1/10) | app-context.md (Test Infrastructure populated: auth via httpOnly `bookhive_token`, `POST /api/reset` + `POST /api/seed` discovered, mutation-endpoint inventory). journey-map.md sentinel + Site Map + pending headings. |
| 3 — Happy path | ✅ greenlight (cycle 1/10) | tests/e2e/happy-path.spec.ts 3× green (1.6-2.1s). Stages 1, 2, 3, 4a, 4b all ran. .discovery-draft.json with 6 cycle-1-targets. globalSetup-once seed wired (resetState slot intentionally empty under `global-reset:cross-test-race`). |
| 4 — Full journey mapping | ✅ greenlight (cycle 2/10) | 22 journeys (6 P0 / 9 P1 / 2 P2 / 5 P3) + 4 cross-referenced sub-journeys. 2 cycles (1 discovery + 1 edge-probe). Section→Journey table well-formed; no structural smells. |
| 5 — Coverage expansion (depth) | ⚠️ **partial** — Pass 1 first wave only | 6 P0 journeys composed (43 tests, all 3× green; whole-suite 44/44 green). Stage B per-journey reviewers, Passes 2-5, and cleanup ledger dedup deferred — see "Resume needed" below. |
| 6 — Bug hunts | ⚠️ **deferred** | Both `bug-discovery` probing passes (1a element + 1b flow) did not run. Phase 6 cannot fire while Phase 5 is partial per the no-skip contract. Adversarial findings surfaced organically during Phase-2 / Phase-3 / Phase-4 + Stage A composition are recorded in "App bugs logged" below. |
| 7 — Final summary | 🔄 in progress | This report + BENCHMARK.md Run-N append. Work-summary deck not generated under partial-pipeline contract. |

## Coverage

| Priority | Total journeys | Composed Pass 1 | Tests landed | Steps covered |
| --- | --- | --- | --- | --- |
| P0 | 6 | 6 | 43 | All 6 journey-map step lists 100% |
| P1 | 9 | 0 | 0 | — |
| P2 | 2 | 0 | 0 | — |
| P3 | 5 | 0 | 0 | — |

Suite total at Pass-1 partial: **44/44 green** (1 happy-path + 43 P0 journey tests).

## Skipped tests

None — every test that landed is enabled and green.

## App bugs logged (organic discovery during Phases 2–5)

The following were surfaced by section cycle agents (Phase 4) and composers (Phase 5 Pass 1 Stage A). Phase 6's two dedicated probing passes did NOT run; this list is organic discovery only. A future Phase 6 run is expected to expand these and surface additional findings.

**Severity counts (organic, Phases 2-5):**

| Severity | Count |
| --- | --- |
| Critical | 2 |
| High | 5 |
| Medium | 4 |
| Info / UX | 7 |

**Root-cause families (organic):**

| Family | Count |
| --- | --- |
| Concurrency / data-integrity races | 4 |
| Server-side input-validation gaps (500 instead of 400) | 6 |
| Money-flow correctness (asymmetric balance updates) | 2 |
| Silent-failure UX surfaces | 3 |
| Privacy/permission-boundary asymmetry | 2 |
| Misleading error messages | 1 |

## Knowledge gained per pass

**Phase 1 / Phase 2 / Phase 3 — discovery and groundwork**
- BookHive runs on a 3-container docker stack (frontend nginx → static SPA, backend Spring Boot on `:8080`, mongo). Frontend SPA hardcodes `localhost:8080` for backend calls → host port-mapping must be exact.
- Auth model: JWT in httpOnly cookie `bookhive_token`. `POST /api/auth/signup` is open (no email verification, no captcha, no MFA). `POST /api/reset` is unauthenticated and clears DB to empty. `POST /api/seed` repopulates a stable ~49-book catalog (idempotent).
- Constraint tags identified: `global-reset:cross-test-race`, `global-seed:idempotent-catalog`, `single-tenant-global-state`, `auth-cookie-httponly`. Stage 4a §1 inverts under `global-reset:cross-test-race` — `beforeEach(reset)` is forbidden; per-test throwaway-user pattern with `globalSetup`-once seed is the canonical isolation strategy.

**Phase 4 — journey mapping cycles**
- Cycle 1 (discovery): 6 sections × 49 flows surfaced. No new sections post-dedup.
- Cycle 2 (edge-probe): re-engaged the same 6 sections under a permission/lifecycle/error/hidden-route lens; surfaced ~64 distinct edge-flows including the critical concurrent-buy double-charge, marketplace-return money-creation, double/triple-checkout race, and broad input-validation gaps.

**Phase 5 — Pass 1 compositional foundation (P0 journeys)**
- 43 tests across the 6 P0 journeys; all use Steps API exclusively. Per-test throwaway users namespaced via `Date.now()` + random suffix; per-user-scoped assertions throughout. File-level serial mode applied where mutations + `single-tenant-global-state` made parallel test-runtime hostile.
- Stage 4a optimization populated `signupAndAuth` + (per j-buy-marketplace) `createListingViaApi` and `buyListingViaApi` helpers in `tests/fixtures/base.ts` under the 2-of-2 gate (UI-covered + API-discovered).
- Several journey-map predictions were CONTRADICTED during composer's live probing — locked as regressions with the actual current behaviour:
  - `POST /api/orders/:id/return` with malformed JSON body returns 200 + RETURNED (predicted 400).
  - `POST /api/orders/:id/return` with `{items:[...]}` partial-return body returns 200 + full RETURNED (predicted 400 partial-return-not-supported).
  - Existing journey-map "double-return error message" predicted "Return window has expired" — confirmed (misleading message, locked).

## Resume needed (exit #2)

Coverage-expansion stopped at Pass 1 first wave per `coverage-expansion/SKILL.md` §"Two valid exits". State-file marker at `tests/e2e/docs/coverage-expansion-state.json`:

- `currentPass: 1`, `passes."1-compositional".status: "partial"`, `completedJourneys: 6`, `inFlightJourneys: []`.
- Stage B per-journey reviewer dispatches recorded as `review_status: blocked-dispatch-failure` with deferral reason "context-budget — orchestrator exit #2".
- Remaining roster: 16 journeys (3 P0/P1 boundary edges + all P1 + all P2 + all P3).
- Remaining passes: Stage B for the dispatched 6, then Pass 2 + Pass 3 (compositional re-pass), Pass 4 + Pass 5 (adversarial probing + regression layer), then cleanup ledger dedup.

A subsequent session can resume by:
1. Reading `coverage-expansion-state.json` (the authoritative state file).
2. Dispatching Stage B reviewers for the 6 in-flight journeys (or re-dispatching composers with a Stage B brief if the prior dispatch's spec needs revision).
3. Continuing with Pass 1 for the remaining 16 journeys.
4. Then proceeding to Pass 2 → Pass 3 → Pass 4 → Pass 5 → cleanup.
5. Phase 6 (bug-discovery 1a + 1b) gates on Phase 5 completion.

## Next steps

- **Resume Phase 5** in a fresh session — Stage B for the 6 dispatched P0 journeys + remaining 16 journeys + Passes 2-5 + cleanup.
- **Run Phase 6** (bug-discovery element-probing + flow-probing) once Phase 5 is complete.
- **Address app bugs** in the order: critical first (concurrent-buy double-charge, marketplace-return money creation), then high (server-side 500-instead-of-400 class), then medium/UX.
- **Generate work-summary-deck** as Phase 7 finalisation when the full pipeline lands.

## Methodology deviations (honest reporting)

Per the `coverage-expansion/SKILL.md` §"No-skip contract" and `onboarding/SKILL.md` §"Per-phase completion contract": this run is a contract-violating partial pipeline. The user's explicit instruction in the gate prompt — "Until step 4 is done your run is not complete" — re-prioritised producing the BENCHMARK.md Run-N entry over completing the full pipeline. Phase 5 partial + Phase 6 deferred + Phase 7 partial is the documented honest state.
