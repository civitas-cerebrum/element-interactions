---
name: test-repair
description: >
  Use this skill to restore a rotted Playwright test suite to a stable, verified green state.
  Triggers on requests like "repair the suite", "fix my tests", "restore green", "heal the suite",
  "the tests are broken", "the suite rotted", "triage the failures", "diagnose the whole suite",
  "my suite is flaky", "the app changed and now tests fail everywhere". Also auto-escalates from
  `failure-diagnosis`, `test-composer`, or `bug-discovery` when a single run produces many failures
  or when failures repeat across diagnostic attempts — batch clustering finds shared root causes
  faster than per-failure diagnosis at scale. Do NOT use for a single failing test — that stays with
  `failure-diagnosis`. Do NOT use to find new bugs adversarially — that is `bug-discovery`. Do NOT
  use to write new tests — that is `test-composer`.
trigger: always
---

# Singularity — Test Repair

Batch orchestrator for repairing a rotted suite. Runs the suite, clusters failures by emergent patterns, verifies each hypothesis with targeted smaller batches, then delegates atomic heal-or-classify work to `failure-diagnosis`. Returns only when every test is passing stably or explicitly escalated — no silent skips, no silent deletes, no healing around app bugs.

---

## When This Activates

### Explicit (user-invoked)

- "repair the suite", "repair my tests", "fix my tests", "fix the suite"
- "restore green", "heal the suite", "heal my tests"
- "the suite is broken", "the suite rotted", "my tests are broken"
- "triage the failures", "diagnose the whole suite", "my suite is flaky"

### Auto-escalation from other skills

When a failure-centric workflow is already in flight, these conditions hand off from per-failure mode to batch mode. The handoff announces itself once so the operator can override back to the narrower path.

| Trigger | Signal | Why batch mode wins |
|---|---|---|
| **Volume** | A single run has ≥5 failures or ≥30% of executed tests failed | Per-failure diagnosis stops scaling; clustering finds the shared root cause faster |
| **Repetition** | `failure-diagnosis` has been invoked 3+ times in one session on distinct tests | A pattern across failures is likely — worth detecting before healing more in isolation |
| **Post-heal regression** | A heal from `failure-diagnosis` caused previously-passing tests to start failing | Cross-test interaction is invisible to single-failure mode; test-repair's post-heal verification stage is designed for this |
| **Caller-initiated batch** | `test-composer` or `bug-discovery` produced a run with multiple failures at once | Delegating per-failure would redo work; cluster once, fix once |

**Escalation announcement** (to the user, once):

> Detected <reason> — <N> failures. Escalating from per-failure diagnosis to the test-repair batch pipeline so we can cluster root causes before healing individually. Starting with a 3-run baseline. Reply "stay single-failure" to override.

### Do not activate

- **A single failure** — stays with `failure-diagnosis`. Batch orchestration is overkill for one data point.
- **Compile or type errors** — out of scope; these are build-time failures, not runtime.
- **Infrastructure failures** (app server down, CI runner OOM, DNS) — report and stop; this skill does not retry around infra.
- **User explicitly scoped to one test** ("fix the login test", with the file named) — respect scope; stay single-failure.

---

## The Repair Pipeline

Six stages, executed in order. Each stage's output is the next stage's input.

### Stage 1 — Baseline (3 full suite runs)

Three is the minimum floor to distinguish deterministic from flaky — not a ceiling. A single run tells you what failed this time; three runs tell you what's repeatable.

```bash
for i in 1 2 3; do
  npx playwright test --reporter=line 2>&1 | tee test-results/repair-baseline-$i.log
done
```

Record per-test, per-run outcome. The resulting matrix is the dataset for Stage 2.

Why 3 and not 5 upfront: running 5× full suites when the suite is truly broken wastes time on tests that will need healing regardless. Three runs catch the dominant patterns; more runs are spent adaptively in Stage 3, targeted at specific hypotheses.

### Stage 2 — Pattern detection and clustering

For every test, determine its run-pattern:

| Pattern | Signal | What it means |
|---|---|---|
| **Green** | 3/3 pass | Stable — skip |
| **Deterministic-fail** | 3/3 fail with same error signature | Repeatable failure — deterministic cause |
| **Flaky-consistent** | Mixed pass/fail, same error when failing | Timing or race condition with a stable target |
| **Flaky-chaotic** | Mixed pass/fail, different errors each run | Unclear cause — needs more data |

Then cluster the non-green tests by shared signal. A few of the clusters you will commonly see:

- Same missing `page-repository.json` entry → one cluster, one fix heals many
- Same page failing to load → one cluster, one navigation issue
- Same error type (timeout / selector / navigation / assertion) → one cluster
- Same predecessor test in suite order → state-leak candidate cluster

**Prioritize clusters by unblock count.** A cluster of 20 tests all missing one page-repo entry is worth fixing before 20 independent one-offs. Unblocking 20 tests with one edit also reveals whether those 20 tests have additional problems hidden behind the first one.

### Stage 3 — Adaptive pattern verification

Pattern-driven, not count-driven. For each cluster, form a hypothesis and verify with the cheapest targeted batch that would disprove it.

| Hypothesis | Verification batch |
|---|---|
| "All 8 failures share missing `CheckoutPage.payment-section`" | Run just those 8 tests in isolation — if they still fail identically, confirmed |
| "State leaks from the login test into the dashboard tests" | Re-run affected tests with a fresh context each — if they pass in isolation, confirmed |
| "Timing dependency on the `/products` page" | Re-run at slower network profile (`--slow-mo` or throttled CDP) — if failure rate increases, confirmed |
| "Flow changed — app now shows a consent modal between login and dashboard" | Run one affected test with Playwright MCP observing; compare actual page steps to expected |

**Adaptive iteration rule** (not hardcoded):

- If a pattern is **crisp** after the 3 baseline runs → proceed to targeted verification now
- If **ambiguous** (several flaky-chaotic clusters, or clusters disagree with each other) → run 2 more full suite passes and re-cluster
- If **still ambiguous at 5 runs** → escalate to the operator with the raw pattern data. Do NOT force a classification. Operator escalation beats a wrong heal.

Targeted batches matter because they disambiguate coincidence from shared root cause without the cost of another full suite pass. A confirmed hypothesis also makes the handoff to `failure-diagnosis` cheaper — it starts with the cluster's cause pre-identified instead of re-deriving it.

### Stage 4 — Delegate per cluster to failure-diagnosis

For each verified cluster, invoke `failure-diagnosis` with:

- A representative failure (one test from the cluster)
- The pattern hypothesis (e.g. "selector drift on `CheckoutPage.payment-section`")
- The cluster's member list, so a single fix can apply once and benefit all

`failure-diagnosis` runs its standard pipeline — evidence, classify, edge-case check, heal strategy selection (its Stage 4a, upgraded), fix, 5× stability — and returns one of:

- **Healed** — fix applied, 5× stability confirmed
- **App bug** — evidence shows wrong UI; escalated with report. Test is NOT modified.
- **Operator-pending** — a proposed heal (flow drift, assertion re-baseline) awaiting approval
- **Quarantined** — flake that resisted two heal strategies; tagged `@flaky`, documented

Record each cluster's outcome. Carry forward to Stage 5.

### Stage 5 — Post-heal verification

Run the **healed tests ×3 in suite order** after all clusters have been processed. This catches what Stages 1-4 cannot see:

- A heal in one test that breaks a previously-passing test
- A new flake introduced by a tighter timeout
- Inter-test state leaks that only surface under full ordering

```bash
for i in 1 2 3; do
  npx playwright test <healed-test-files> --reporter=line 2>&1 | tee test-results/repair-postheal-$i.log
done
```

If any post-heal run fails, identify which heal introduced the regression, revert it, and re-enter Stage 2 for that specific test. Do not proceed to Stage 6 with an unverified heal.

### Stage 6 — Repair summary

Write `test-results/repair-session-<ISO-timestamp>.md` with a clear audit trail:

```markdown
# Repair Session — <date> <time>

## Scope
- Tests in scope: <count>
- Runtime: <baseline> + <targeted batches> + <post-heal>

## Outcome
- Healed (auto): <count>
- Healed (proposed, operator-approved): <count>
- Reported bugs (NOT modified): <count>
- Operator-pending: <count>
- Quarantined `@flaky`: <count>
- Still green: <count>

## Healed (auto)
- `tests/checkout.spec.ts::TC_004` — selector drift on `submit-btn` (renamed to `place-order-btn`); updated page-repository.json
- ...

## Reported bugs
- `tests/cart.spec.ts::TC_012` — dashboard shows 500 after successful login. Screenshot: test-results/.../screenshot.png. Reproducible via manual MCP navigation. Test left unchanged.
- ...

## Operator-pending
- `tests/pricing.spec.ts::TC_003` — assertion value drifted from "Total: $42" to "Total: $45". Needs human judgment: intentional price change or cart miscalculation?
- ...

## Quarantined
- `tests/flaky-thing.spec.ts::TC_007` — intermittent timeout on `result-panel`; pattern persisted after timing-hardening heal. Tagged `@flaky` pending deeper investigation.
```

Present the summary in chat with counts; link the file for the full audit trail.

---

## Bug-vs-Heal Discipline

These are the non-negotiables that every cluster decision must respect. Together they preserve the framework's ability to find real app bugs instead of silently papering over them.

1. **Screenshot evidence of wrong UI → app bug, not heal.** If the failure screenshot shows a 500 error, blank page, broken layout, or content that should-not-be-there, the cluster is classified as an app bug. Report it with evidence, leave the test unchanged, move on. Never modify a test to accommodate a bug.

2. **Mechanical heals run automatically; semantic heals require approval.** Selector re-learning, timing hardening, and state isolation fixes apply autonomously. Assertion re-baselining and flow-step drift require operator approval, because both can mask data bugs or broken flows if applied without human judgment.

3. **No silent skip.** Flakes that resist healing are quarantined with a `@flaky` tag and documented in the repair summary. They are never `.skip()`'d silently. A quarantined flake is a surfaced problem awaiting investigation, not a hidden one.

4. **5× stability validates every heal.** Applied by `failure-diagnosis` in Stage 5 of its own pipeline. If a heal destabilizes, it gets reverted — instability means the heal was incomplete.

5. **Whole-test rewrites require operator alignment.** If a test no longer maps to the current app flow (scenario itself obsolete), do NOT silently regenerate. Present to the operator; on approval, invoke `test-composer` with journey context. Respect that the operator owns the scope of what's being tested.

---

## Scope boundaries (YAGNI)

- **No persistent flake database across sessions.** Each repair session is stateless. The repair summary is the record; long-term trending lives elsewhere.
- **No CI retry policies.** Infra concerns (flaky network, runner OOM) are out of scope; report and stop.
- **No test deletion.** Every test ends in one of: passing stably, reported as bug, operator-pending, quarantined. Deletion is a separate operator decision.
- **No new test authoring beyond (g) operator-approved rewrites.** New coverage is `test-composer`'s job.
- **No adversarial bug-hunting.** Finding new bugs deliberately is `bug-discovery`. This skill only reports bugs it encounters incidentally while repairing.
- **No cross-suite refactoring.** If a heal reveals systemic design debt, document it in the summary; don't attempt the refactor inside the repair session.

---

## Integration with other skills

| Skill | Relationship |
|---|---|
| `failure-diagnosis` | **Called per cluster in Stage 4.** The atomic heal-or-classify unit. Its contract is unchanged for all its other callers — this skill is an additional caller, not a replacement. |
| `test-composer` | **Called only in operator-approved whole-test rewrite (heal type g).** Not invoked for normal heals. |
| `bug-discovery` | Separate concern. This skill reports bugs it finds incidentally; it does not probe for new ones. `bug-discovery` may auto-escalate TO this skill if its adversarial run produces a batch of failures. |
| `journey-mapping` | Not called directly. When `test-composer` is invoked for a (g) rewrite, that chain may reach `journey-mapping` — but test-repair does not re-map. |
| `element-interactions` | Uses the Steps API to execute tests. No direct skill-level interaction. |
| `onboarding` | Out of scope; assumes a scaffolded project exists. If the project isn't onboarded, this skill reports that and stops. |
| `work-summary-deck` | May consume the repair-session summary as input data for a stakeholder report. |

---

## Success criteria

A repair session is complete when:

1. Every test in scope is in one of: passing stably (verified 5× in suite order), reported as app bug, operator-pending, or quarantined `@flaky` with evidence.
2. No new failures were introduced by heals (confirmed in Stage 5).
3. The repair-session summary has been written to `test-results/repair-session-<timestamp>.md`.
4. Zero tests were silently skipped or deleted.

If any of these cannot be achieved, the session is NOT complete. Report the blocker to the operator and stop — an incomplete repair that claims success is worse than one that clearly escalates.

---

## API Reference

Refer to the API Reference in the main `element-interactions` (or `singularity`) skill for all Steps method signatures. All Steps methods use `(elementName, pageName)` order.
