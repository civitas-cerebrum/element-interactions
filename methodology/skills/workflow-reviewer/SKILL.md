---
name: workflow-reviewer
description: >
  Subagent-only skill. Loaded by every workflow-reviewer-phase<N>: /
  workflow-reviewer-pass<N>: / workflow-reviewer-cycle<N>: dispatch.
  Reviews the closing handover of an onboarding phase, a coverage-expansion
  pass, or a journey-mapping cycle against the canonical methodology exit
  criteria; returns verdict approve | reject | escalate per the
  workflow-reviewer.schema.json contract. Owns the 3-cycle reject cap and
  the skip / early-stop authorisation rules. Triggers when the brief
  carries one of the three role prefixes, or when the orchestrator names
  the skill in a Skill-tool invocation.
---

# Workflow reviewer — pipeline state-machine gate

> **Subagent-only.** This skill is dispatched by the onboarding
> orchestrator (or by an external automated CLI driver) at every phase,
> pass, and cycle transition. Loading it in the orchestrator's context is a
> methodology violation — the methodology itself lives in
> `methodology/skills/onboarding/SKILL.md`, `methodology/skills/coverage-expansion/SKILL.md`,
> and `methodology/skills/journey-mapping/SKILL.md`.

The reviewer's job is to read the closing handover envelope of the
last unit of work (phase / pass / cycle), check it against the
methodology's exit criteria, and return either:

- `verdict: approve` — the orchestrator may advance to the next unit
- `verdict: reject` — the orchestrator surgically fixes per the findings
  and re-dispatches the same reviewer (cap 3 cycles)
- `verdict: escalate` — the 3rd consecutive reject; the orchestrator
  surfaces all three reviewer returns to the user for manual triage

The reviewer is a thin, fast read-only critic. No code edits. No
spec writes. No further dispatching. The whole skill exists so
markdown-text contract enforcement no longer permits silent scope
compression at transition points — see §"Empirical origin" below.

---

## Role prefixes + scope

| Prefix | Fires between | Mapped to methodology section |
|---|---|---|
| `workflow-reviewer-phase<N>:` | onboarding phase N completion and phase N+1 start | `methodology/skills/onboarding/SKILL.md` §"Phase N" exit criteria (one per phase 1-8) |
| `workflow-reviewer-pass<N>:` | coverage-expansion pass N completion and pass N+1 start | `methodology/skills/coverage-expansion/SKILL.md` §"Per-pass completion criteria" |
| `workflow-reviewer-cycle<N>:` | journey-mapping cycle N completion and cycle N+1 start | `methodology/skills/journey-mapping/SKILL.md` §"Iterative discovery cycles" |

Per full onboarding run the reviewer fires ~15 times: 8 phase
transitions + 5 pass transitions (Phase 5 inner loop) + 2-5 cycle
transitions (Phase 4 inner loop).

---

## Inputs the reviewer receives in its brief

Every dispatch brief should give the reviewer:

1. **The ledger** at `tests/e2e/docs/onboarding-status.json` — the
   current phase / pass / cycle row + the prior unit's row for context.
2. **The canonical methodology section** for the unit being reviewed
   (see the table above). The brief includes either the section text
   inline or a file:line citation.
3. **The deliverables actually produced** — discovered via
   `git log --since=<unit start time>` plus reads of the named spec /
   doc files. The reviewer reads these directly; the orchestrator
   does not pre-digest.
4. **The closing handover envelope** of the last subagent of the unit
   being reviewed (matches `methodology/schemas/subagent-returns/handover.schema.json`).

---

## Per-unit checklist

The reviewer turns the methodology section into a checkable list of
yes/no items. Each item is a `{item, satisfied, evidence, methodology-ref}`
row. The full list is then summarised into the `checklist` field of
the return.

### Phase 1 — Scaffold (`workflow-reviewer-phase1`)
- `npx playwright test --list` lists zero specs without error
- `playwright.config.ts` exists with project URL + reporters
- `tests/e2e/fixtures/`, `tests/e2e/docs/`, `tests/e2e/playwright.setup.ts` exist
- `tests/e2e/.gitignore` covers `playwright-report/`, `test-results/`, `.last-run.json`

### Phase 2 — Groundwork (`workflow-reviewer-phase2`)
- `tests/e2e/docs/app-context.md` exists and covers what the app is + roles + auth model + URL surface
- `tests/e2e/page-repository.json` populated with one entry per discoverable page
- `tests/e2e/fixtures/auth.ts` mints test users at runtime (no hard-coded credentials)

### Phase 3 — Happy-path (`workflow-reviewer-phase3`)
- One `tests/e2e/<journey>.spec.ts` per primary user flow, all passing locally
- `tests/e2e/docs/.discovery-draft.json` exists with the Stage-3 sentinel
- Composer's reviewer-inloop returns recorded (no greenlights without an inloop pass)

### Phase 4 — Journey-mapping (`workflow-reviewer-phase4`)
- `tests/e2e/docs/journey-map.md` exists with priority groupings + sentinel on line 1
- `tests/e2e/docs/journey-map-coverage.md` maps every journey to a spec or `<missing>`
- The edge-probe cycle's findings are reflected in the map (not discarded)
- Required: cycle 1 + at least one edge-probe cycle ran (minimum 2 cycles)

### Phase 5 — Coverage-expansion (`workflow-reviewer-phase5`)
- Every P2 / P3 journey in the map has a spec OR a documented skip with `authorizer`
- Per-pass dedup landed at the end of every pass (no open duplicate findings)
- `coverage-expansion-state.json` has been deleted (successful completion marker)

### Phase 6 — Bug-discovery (`workflow-reviewer-phase6`)
- Every probe completed (`status: clean` or `findings-emitted`)
- Every `findings-emitted` return has a regression spec OR an explicit `app-bug` flag

### Phase 7 — Secrets-sweep (`workflow-reviewer-phase7`)
- A re-scan of `tests/e2e/**` surfaces no literal credentials / API keys / PII / URLs
- `.env`, `.env.example`, and the `.gitignore` entry all in place
- `npx playwright test` still passes against the env-driven suite

### Phase 8 — Report (`workflow-reviewer-phase8`)
- `qa-summary-deck.html` + `qa-summary-deck.pdf` exist at the project root
- Numbers in the deck match the actual state of the suite (no stale figures)

### Per coverage-expansion pass (`workflow-reviewer-pass<N>`)
- Every journey in the roster dispatched AND returned for this pass
- Per-pass dedup commit landed (empty-diff dedup commit is acceptable; silent skip is not)
- Stage A + Stage B both ran for every journey (no review_status without a Stage B dispatch)
- Pass-1 only: dispatch-mode in handover envelopes is `per-journey`, not `grouped` or `single-agent-collapsed`
- Pass-N+1 may not start until this pass's verdict is approved (enforced by `onboarding-ledger-gate.sh`)

### Per journey-mapping cycle (`workflow-reviewer-cycle<N>`)
- Every target section in `cycle-N-targets` dispatched (cycle 1 strict per-section; cycle 2+ relaxed under `cycleStrictness: standard`, strict under `depth`)
- `returned-sections` covers `dispatched-sections` (no abandoned dispatches)
- `new-sections-discovered` either feeds cycle N+1 OR convergence-status is `converged`
- Required: at least cycle 1 + one edge-probe cycle for the phase to complete

---

## Return shape

Conforms to [`methodology/schemas/subagent-returns/workflow-reviewer.schema.json`](../../schemas/subagent-returns/workflow-reviewer.schema.json).

Approve example:

```yaml
handover:
  role: workflow-reviewer-phase3
  cycle: 1
  status: approved
  next-action: orchestrator may advance to Phase 4
verdict: approve
phase: 3
reviewerCycle: 1
checklist:
  - item: One spec per primary journey passing locally
    satisfied: true
    evidence: tests/e2e/sign-in.spec.ts + tests/e2e/checkout.spec.ts (green)
    methodology-ref: methodology/skills/onboarding/SKILL.md §"Phase 3"
attestation: Phase 3 exit criteria met — happy-path specs + discovery draft seeded
```

Reject example:

```yaml
handover:
  role: workflow-reviewer-phase3
  cycle: 2
  status: rejected
  next-action: surgical fix + re-dispatch workflow-reviewer-phase3
verdict: reject
phase: 3
reviewerCycle: 2
findings:
  - checklist-item: tests/e2e/docs/.discovery-draft.json exists
    what-missing: file is absent
    methodology-ref: methodology/skills/onboarding/SKILL.md §"Phase 3" + element-interactions Stage 3
    fix-instruction: dispatch composer-discovery-draft: to author the draft from the happy-path runs
```

Escalate example (3rd consecutive reject):

```yaml
handover:
  role: workflow-reviewer-phase5
  cycle: 3
  status: escalated-to-user
  next-action: orchestrator surfaces all three reviewer returns to the user
verdict: escalate
phase: 5
reviewerCycle: 3
findings:
  - checklist-item: every P2/P3 journey has a spec
    what-missing: 7 journeys still uncovered after two surgical-fix cycles
    methodology-ref: methodology/skills/coverage-expansion/SKILL.md §"Per-pass completion criteria"
    fix-instruction: re-dispatch composer-j-<slug>: for each of the 7 — but this is a 3rd cycle, escalating instead
```

---

## Findings format — surgical fix list

When `verdict == reject` (or `escalate`), every entry in `findings[]`
follows the same shape:

| Field | Purpose |
|---|---|
| `checklist-item` | Verbatim text of the checklist item that failed |
| `what-missing` | What the reviewer expected to find vs what is there |
| `methodology-ref` | `file:section` pointer the orchestrator can cite back to the operator |
| `fix-instruction` | One concrete action the orchestrator should take next |

The fix must be *surgical* — name a specific dispatch / file edit /
state-file update. "Re-do the whole phase" is not a surgical fix; if
the unit's work is structurally wrong, return `verdict: escalate` even
on cycle 1.

---

## Skip / early-stop authorisation

The reviewer is the **only** legitimate path for skipping a phase or
stopping a pipeline early. It may approve a skip / early-stop **only**
when the brief carries an explicit `authorizer` — either a verbatim
user quote from the in-flight conversation, or a documented structural
exception.

Examples that count as legitimate authorisation:

- A verbatim user quote in the brief: `"user said: skip Phase 6 — adversarial coverage handled separately"`.
- A documented structural exception cited by name and file: e.g.
  `"phase6-redundant-with-phase5: depth-mode Pass 4+5 already provided adversarial coverage AND the user authorised at the front-load gate via args: 'phase6-redundant-with-phase5: true'"`.

Examples that do NOT count:

- `"session-length"` / `"budget"` / `"auto-mode"` — self-imposed reasons
- `"the suite already looks decent"` — orchestrator judgement
- `"inferred-pref"` / `"reasonable-stop"` — guessed user intent

When the reviewer approves a skip / early-stop, the return's
`authorizer` field carries the quote / attestation, and the orchestrator
records an `approvedDeviations[]` entry in the ledger. The
`onboarding-ledger-write-gate.sh` hook enforces that the entry has a
non-empty `authorizer`.

---

## 3-cycle reject cap

Per-unit reviewer dispatch count is tracked in the ledger's
`reviewerCycles` field (0 .. 3) for each phase / pass / cycle row.

- **Cycle 1** — first review. Approve → advance; reject → record
  findings + surgical fix + re-dispatch.
- **Cycle 2** — second review after the surgical fix. Approve → advance;
  reject → record findings + surgical fix + re-dispatch.
- **Cycle 3** — third review. Approve → advance; reject → escalate.

The 3rd reject is the **escalation point**. The reviewer's return
sets `verdict: escalate`, `handover.status: escalated-to-user`,
`reviewerCycle: 3`. The orchestrator surfaces all three reviewer
returns (with their findings + the surgical fixes that were attempted)
to the user for manual triage. The pipeline `status` in the ledger
becomes `blocked`.

This mirrors the existing 3-cycle process-validator pattern in the
package (see `methodology/skills/element-interactions/references/stages-protocol.md`).

---

## Cross-references

- `methodology/schemas/onboarding-status.schema.json` — the ledger the reviewer reads
- `methodology/schemas/subagent-returns/workflow-reviewer.schema.json` — return shape
- `methodology/schemas/subagent-returns/handover.schema.json` — envelope baseline
- `methodology/skills/onboarding/SKILL.md` §"Status ledger + workflow reviewer" — orchestrator-side contract
- `methodology/skills/coverage-expansion/SKILL.md` §"Authoritative state file" — pass-transition reviewer context
- `methodology/skills/journey-mapping/SKILL.md` §"Iterative discovery cycles" — cycle-transition reviewer context
- `methodology/skills/element-interactions/references/harness-hooks.md` — `onboarding-ledger-gate.sh` + `onboarding-ledger-write-gate.sh`

---

## Empirical origin

A 21-journey benchmark onboarding run demonstrated that markdown-text
contract enforcement alone permits silent scope compression even when
the rules are crisp. Observed failure modes:

- The orchestrator skipped a phase entirely without a documented
  authorisation.
- The orchestrator stopped early after Phase 5 Pass 1 with no
  in-flight dispatch (treating Exit #2 as a starting position).
- Subagents returned `status: complete` with handover envelopes whose
  deliverables list was missing required sub-deliverables.
- Phase-boundary handovers omitted the `.discovery-draft.json` write
  that Phase 4 depends on.

The `standard-mode-first-pass-guard.sh` hook addresses the most
egregious dispatch-shape compressions. The workflow-reviewer + ledger
addresses the structural compressions: the orchestrator now cannot
advance a phase / pass / cycle without an `approve` verdict from the
matching reviewer, and the reviewer's checklist is the methodology
itself.
