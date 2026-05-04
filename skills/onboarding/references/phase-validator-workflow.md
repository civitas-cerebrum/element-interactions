# Phase-Validator Workflow — Per-Phase Exit Checkpoint

**Status:** authoritative spec for the `phase-validator-<N>:` role. Cited from `onboarding/SKILL.md` §"Hard rules — kernel-resident".
**Scope:** when to invoke, manifest shape the parent passes in, validator-side review checklist per phase, response shape, parent's response handling, cycle cap.

---

## Background

Onboarding's per-phase completion contract names what each phase must finish before advancing — Stage 4a/4b for Phase 3, Phase 5 of journey-mapping for Phase 4, all 5 passes + cleanup for Phase 5, both probing passes for Phase 6, etc. Without a mechanical checkpoint, the orchestrator can rationalise its way past partial completion ("most of the work done", "honest stopping point") — the v0.3.4 onboarding test demonstrated this.

The phase-validator pattern lifts the **process-validator** role (which validates planned dispatch waves before fan-out, see `coverage-expansion/references/process-validator-workflow.md`) from "wave manifest" scope to "phase exit" scope. A fresh-context subagent reviews the phase's exit criteria, returns `greenlight` or `improvements-needed`, and onboarding advances only on greenlight.

This is the highest-level mechanical enforcement layer. Below it: dispatch-guard (per-dispatch contracts), schema-guard (per-return shape), suite-gate-ratchet (per-commit). Above it: the user. The phase-validator is what stands between "phase work happened" and "phase report claims complete".

---

## 1. When to invoke

Onboarding dispatches `phase-validator-<N>:` at the **end of every phase**, before advancing to phase N+1. This is non-negotiable — every phase, every run.

The dispatch fires after:
- The phase's sub-skill (or inline work, for Phases 1/2/7) has returned what it claims is its completion state.
- The orchestrator has gathered the artifacts the validator will verify (file paths, state-file content, commit hashes).
- Before any phase-N+1 work begins.

The validator dispatch is **not** an optional optimization step. Skipping it is a contract violation — the same family of violation as skipping the phase itself.

---

## 2. Manifest shape (what the parent passes in)

The phase-validator's brief is small — it doesn't need the full skill content of the phase being validated. Just enough context to verify the exit criteria.

### Manifest template

````markdown
## Phase-validator brief — Phase <N>

**Phase:** <1-7>
**Sub-skill:** <element-interactions | journey-mapping | coverage-expansion | bug-discovery | inline>
**Project root:** <abs path>

## Artifacts to verify

- <criterion 1 from per-phase completion contract> — evidence at <path or pointer>
- <criterion 2> — evidence at <path or pointer>
- ...

## Per-phase completion contract (verbatim from onboarding/SKILL.md)

<paste the row from the per-phase completion contract table for this phase>

## Cycle context

This is cycle <N> of 10 for Phase <P>. Previous improvements-needed findings (if any):
<paste the findings list from the previous cycle's return, or "none — first cycle">

## Return shape

See `skills/element-interactions/references/subagent-return-schema.md` §2.5.
````

### Field rules

| Field | Rule |
|---|---|
| `phase` | Integer 1-7. Must match the phase being validated. |
| `sub-skill` | The sub-skill name OR `inline` for Phases 1, 2, 7. |
| `project root` | Absolute path so the validator can read state files independently. |
| `artifacts to verify` | Pointers to files, state-file fields, or commit hashes the validator can read. NOT the content itself — the validator reads the artifacts itself for evidence. |
| `per-phase completion contract` | Verbatim copy of the row from `onboarding/SKILL.md`'s per-phase completion contract table. The validator's verification mirrors this row exactly. |
| `cycle context` | The validator needs to know its cycle number for cycle-cap awareness; previous findings are read so the validator can verify they were addressed. |

### What the manifest does NOT contain

- The full skill content of the phase being validated (validator loads its own).
- Test source, DOM snapshots, or stabilization transcripts.
- Cross-phase state from other phases (validator scope is one phase).

---

## 3. Validator-side verification — per-phase

The validator loads the relevant skill (`coverage-expansion` for Phase 5, `journey-mapping` for Phase 4, etc.), reads the per-phase completion contract from its brief, and verifies each criterion. Per phase:

| Phase | Sub-skill | Validator verifies |
|---|---|---|
| 1 — Scaffold | onboarding (inline) | (a) `package.json` has the three required deps installed (`@civitas-cerebrum/element-interactions`, `@civitas-cerebrum/element-repository`, `@playwright/test`). (b) Scaffolded files present: `playwright.config.ts`, `tests/fixtures/base.ts` with all four `HELPER SLOT` markers, `tests/e2e/docs/` directory. (c) Chromium browser binary installed (probe with `npx playwright --version` exit 0). |
| 2 — Groundwork | onboarding (inline) | (a) `tests/e2e/docs/app-context.md` written with `## Test Infrastructure` section populated. (b) Reset/seed endpoints probe complete (entry exists, even if "none discovered"). (c) Mutation endpoints section non-empty (or explicit "none observed during crawl"). |
| 3 — Happy path | element-interactions Stages 1–4 | (a) `tests/e2e/happy-path.spec.ts` exists. (b) Spec passes 3× green via `npx playwright test happy-path.spec.ts` (verify via the suite-gate window). (c) Stage 4a optimization markers in spec (e.g., `beforeEach(resetState)` per §1, `dismissBanners` per §5 if banners present). (d) Stage 4b api-reference compliance: spec uses Steps API, no raw `page.click(...)` etc. (e) Phase-3 commit landed. |
| 4 — Journey mapping | journey-mapping Phases 1–5 | (a) `tests/e2e/docs/journey-map.md` exists with `<!-- journey-mapping:generated -->` on line 1. (b) Coverage-checkpoint signature present (Phase-5 marker). (c) Roster non-empty; matches discovered journeys. (d) Sub-journeys (`sj-<slug>`) properly cross-referenced from journeys. (e) Phase-4 commit landed. |
| 5 — Coverage expansion | coverage-expansion `mode: depth` | (a) `tests/e2e/docs/coverage-expansion-state.json` exists with `status: "complete"`. (b) Every journey in roster has terminal `review_status` (greenlight / blocked-cycle-stalled / blocked-cycle-exhausted / blocked-dispatch-failure) on every pass (1-5). (c) Adversarial findings ledger exists and has both Pass-4 and Pass-5 sections per journey. (d) Cleanup commit `docs(ledger): dedupe cross-cutting findings` landed. (e) All 5 per-pass commits landed (per §"Commit-message conventions"). |
| 6 — Bug hunts | bug-discovery | (a) Both probing passes ran — element-level probing AND flow-level probing. (b) Findings appended to ledger. (c) Phase-6 commits landed. |
| 7 — Final summary | onboarding (inline) | (a) `tests/e2e/docs/onboarding-report.md` committed with all required sections (cascade level, happy-path sentence, runtime, coverage block, skipped-tests block, app-bugs-logged block, knowledge-per-pass block, next-steps block). (b) Work-summary deck generated. (c) Phase-7 commit landed. |

The validator runs these checks **mechanically** — reads files, greps for markers, counts roster entries vs `dispatches[]` entries. It does NOT re-do the phase's work; it verifies the phase's claimed completion.

### Finding-block shape

When a criterion fails, the validator produces a `pv-<phase>-<nn>` finding:

```
- **pv-<phase>-<nn>** [must-fix] — <one-line title>
  - criterion: <verbatim text from the failed exit criterion>
  - issue: <what's wrong; quote evidence pointers where relevant>
  - fix: <concrete remediation — what the orchestrator does to satisfy this criterion>
```

`<phase>` is `1`-`7`; `<nn>` is two-digit zero-padded. The `pv-` prefix is phase-validator-specific.

---

## 4. Response shape

Mirrors `subagent-return-schema.md` §2.5 (canonical). Two return forms:

### Greenlight (no findings)

````
status: greenlight
phase: <N>
sub-skill: <name | "inline">
exit-criteria-checked:
  - criterion: <verbatim text from per-phase completion contract>
    satisfied: true
    evidence: <file path | state-field | commit hash>
  - criterion: <verbatim text>
    satisfied: true
    evidence: <pointer>
  ...
findings: []
summary: <one sentence — names what was verified>
````

`exit-criteria-checked` enumerates EVERY criterion from the phase's row in the per-phase completion contract. Each row has `satisfied: true` on greenlight; `evidence` is a concrete pointer the orchestrator can independently verify if it doubts the validator's read. `findings: []` is REQUIRED (explicit empty array). The summary names what was verified, not what wasn't.

### Improvements-needed (≥1 finding)

````
status: improvements-needed
phase: <N>
sub-skill: <name>
exit-criteria-checked:
  - criterion: <verbatim>
    satisfied: false
    evidence: absent — <why no evidence was found>
  - criterion: <other>
    satisfied: true
    evidence: <pointer>
  ...
findings:
  - **pv-<phase>-<nn>** [must-fix] — <one-line title>
    - criterion: <verbatim>
    - issue: <what's wrong>
    - fix: <concrete remediation>
summary: <one sentence — N findings, phase N, blocking advance to N+1>
````

`exit-criteria-checked` shows BOTH satisfied and unsatisfied criteria — the validator must verify every criterion to demonstrate it ran the full check, not just stopped at the first failure. Each unsatisfied criterion gets a corresponding `pv-<phase>-<nn>` finding with concrete `fix:` text.

### Banned tokens

Inherited from §2.4: `nice-to-have`, `greenlight-with-notes`, top-level `notes:` sub-list. Inherited from §1: legacy finding-ID prefixes (`AF-`, `P4-`, `REG-`).

---

## 5. Onboarding's response handling

### Greenlight

1. Onboarding reads `status: greenlight`.
2. Records the greenlight in `tests/e2e/docs/onboarding-phase-ledger.json`:
   ```json
   {
     "phases": {
       "<N>": {
         "status": "greenlight",
         "validator": "phase-validator-<N>",
         "cycle": <cycle>,
         "at": "<ISO timestamp>",
         "evidence": [<list of evidence pointers from the return>]
       }
     }
   }
   ```
3. Advances to phase N+1.

### Improvements-needed

1. Onboarding reads each `findings[]` entry.
2. For each finding, applies the `fix:` action:
   - **Sub-skill re-run**: if the failed criterion is "sub-skill didn't finish all its passes", re-invoke the sub-skill with the missing scope. (Phase 5 example: re-invoke coverage-expansion with the resume marker.)
   - **Inline fix**: if the failed criterion is "scaffolded file missing", write the file directly.
   - **Commit landing**: if the failed criterion is "phase-N commit didn't land", produce the commit.
3. Increments cycle counter in the ledger.
4. Re-dispatches `phase-validator-<N>:` with the same brief plus the cycle context update (previous findings list).

### Cycle cap

**10 per phase.** After cycle 10 still `improvements-needed`:

1. Set ledger entry to `{ "status": "blocked-phase-validator-stalled", "cycle": 10, "unresolved-findings": [...] }`.
2. Commit what landed during the 10 cycles.
3. Surface to user with the unresolved findings list. Do NOT advance to phase N+1.

The cap is intentionally generous (vs the 7-cycle A↔B retry loop within a journey). Phase scope varies widely — a Phase 3 fix can be small, a Phase 5 fix can require a multi-pass re-run. 10 cycles gives genuine room for adversarial iteration without runaway.

### Cycle counting across resume

If the run pauses between cycles (e.g., context-budget auto-compaction), the ledger's `cycle` counter is the source of truth. The orchestrator's first action on resume reads the ledger; if a phase is mid-validator (cycle 1-10), it picks up at the recorded cycle number, not from cycle 1.

---

## 6. Mechanical enforcement

Two harness hooks enforce the validator dispatch + ledger contract:

### 6.1 `hooks/subagent-return-schema-guard.sh` — return-shape conformance

PostToolUse:Agent. Routes `phase-validator-<N>:` returns through §2.5 of `subagent-return-schema.md` (status enum, phase 1–7, exit-criteria-checked array, summary required on both statuses, `findings: []` on greenlight, ≥1 `pv-<phase>-<nn>` must-fix on improvements-needed, banned tokens). Emits a non-blocking `systemMessage` listing missing markers when the validator's return is malformed. Shipped in PR A (v0.3.6).

### 6.2 `hooks/phase-validator-dispatch-required.sh` — dispatch-required gate + auto-ledger

Two-event hook. Shipped in PR B (v0.3.7).

**PreToolUse:Agent (gate advance)**

When the orchestrator about to dispatch a Phase N+1 subagent (today: composer-/reviewer-/probe-/cleanup-/process-validator- prefixes = entering Phase 5), the hook reads `tests/e2e/docs/onboarding-phase-ledger.json` and checks Phase N's status:

| Ledger state for Phase N | Hook decision |
|---|---|
| `greenlight` | ALLOW — advance is authorised |
| `in-progress` (cycle 1-9, last validator returned improvements-needed) | DENY — re-dispatch phase-validator-N first; the deny message includes the next cycle number |
| `blocked-phase-validator-stalled` (cycle 10 cap reached) | DENY — terminal state; surface to user with unresolved findings |
| Missing entry / ledger absent | DENY — no validator has been dispatched yet |

`phase-validator-<N>:` dispatches are always allowed regardless of ledger state — gating the gate would deadlock the pipeline.

**PostToolUse:Agent (record ledger)**

When a `phase-validator-<N>:` Agent returns:

- `status: greenlight` → write Phase N entry: `{ status: "greenlight", validator: "phase-validator-N", cycle: <N>, at: "<ISO>", evidence: [...] }`. Cycle counter resets on next phase.
- `status: improvements-needed` AND cycle < 10 → write `{ status: "in-progress", cycle: <bumped>, at: "<ISO>" }`.
- `status: improvements-needed` AND cycle == 10 → write `{ status: "blocked-phase-validator-stalled", cycle: 10, at: "<ISO>", "unresolved-findings": [<pv-IDs>] }`.

The hook is the source of truth for the ledger. Onboarding MUST NOT hand-write entries — they only become valid via the harness layer.

### 6.3 Ledger state-file shape

`tests/e2e/docs/onboarding-phase-ledger.json`:

```json
{
  "phases": {
    "<N>": {
      "status": "greenlight" | "in-progress" | "blocked-phase-validator-stalled",
      "validator": "phase-validator-<N>",
      "cycle": <integer 1-10>,
      "at": "<ISO-8601 timestamp>",
      "evidence": ["<pointer>", "<pointer>", ...],            // greenlight only
      "unresolved-findings": ["pv-<N>-01", "pv-<N>-02", ...]  // blocked only
    },
    ...
  }
}
```

Field rules:

| Field | Rule |
|---|---|
| `phases` | Top-level object. Keys are phase numbers as strings (`"1"` ... `"7"`). Missing key = phase not yet validated. |
| `phases.<N>.status` | One of `greenlight | in-progress | blocked-phase-validator-stalled`. No other values. |
| `phases.<N>.validator` | Must be `phase-validator-<N>` (matches the role-prefix convention). |
| `phases.<N>.cycle` | Integer 1–10. The cycle the most recent validator dispatch ran. Resets on advance to next phase. |
| `phases.<N>.at` | ISO-8601 UTC timestamp of the most recent ledger update. |
| `phases.<N>.evidence` | Array of strings — pointers (file paths, state-file fields, commit hashes) the validator extracted from `exit-criteria-checked`. Present only on `status: "greenlight"`. |
| `phases.<N>.unresolved-findings` | Array of `pv-<N>-<nn>` finding-IDs from the cycle-10 validator return. Present only on `status: "blocked-phase-validator-stalled"`. |

The ledger is committed alongside Phase N's regular commits. Resume across sessions reads the ledger to determine which phase to enter; advancing requires the ledger to show the prior phase greenlit.

### 6.4 What this enforcement closes

| Failure mode | PR A (schema-guard) catches | PR B (dispatch-required) catches |
|---|---|---|
| Validator dispatched but return is malformed | ✅ | (PR B doesn't re-validate the return shape — PR A's schema-guard handles) |
| Validator return is well-formed but the orchestrator doesn't act on findings | (markdown-only — orchestrator must read the findings) | ✅ (next dispatch denied because ledger still shows `in-progress` with cycle bumped) |
| Orchestrator skips phase-validator dispatch entirely and dispatches Phase N+1 work | (markdown-only) | ✅ (PreToolUse deny because Phase N has no greenlight in ledger) |
| Cycle 10 reached with unresolved findings | (markdown-only) | ✅ (PostToolUse writes `blocked-phase-validator-stalled`; subsequent advance attempts hit a clear deny with the unresolved findings list) |
| Onboarding is invoked from scratch (no ledger) | (n/a) | ✅ (deny on first Phase N+1 dispatch with the "no ledger" message guides to dispatch phase-validator-N first) |

---

## 7. Worked example — Phase 5 validator

### Onboarding's manifest

````markdown
## Phase-validator brief — Phase 5

**Phase:** 5
**Sub-skill:** coverage-expansion
**Project root:** /Users/dev/bookhive

## Artifacts to verify

- coverage-expansion-state.json status field — `tests/e2e/docs/coverage-expansion-state.json`
- Every journey's terminal review_status across passes 1-5 — same file, `passes` field
- Adversarial findings ledger — `tests/e2e/docs/adversarial-findings.md`
- Cleanup commit — git log: search for `docs(ledger): dedupe cross-cutting findings`
- Per-pass commits — git log: search for `test(j-...)`, `docs(ledger): j-...`, `test(j-...-regression)`

## Per-phase completion contract (verbatim from onboarding/SKILL.md)

| 5 — Coverage expansion | coverage-expansion `mode: depth` | All 5 passes (3 compositional + 2 adversarial) + cleanup ledger dedup. Pass 1 alone is one-fifth of the pipeline. Every journey gets terminal review_status (greenlight / blocked-cycle-stalled / blocked-cycle-exhausted / blocked-dispatch-failure) on every pass — Stage-A-only is incomplete |

## Cycle context

This is cycle 1 of 10 for Phase 5. Previous improvements-needed findings: none — first cycle.

## Return shape

See `skills/element-interactions/references/subagent-return-schema.md` §2.5.
````

### Validator's improvements-needed return (Pass 4-5 not run)

````
status: improvements-needed
phase: 5
sub-skill: coverage-expansion

exit-criteria-checked:
  - criterion: coverage-expansion-state.json status: "complete"
    satisfied: false
    evidence: absent — file shows status: "in-progress", currentPass: 3
  - criterion: every journey terminal review_status on every pass
    satisfied: false
    evidence: absent — passes "4-adversarial" and "5-adversarial" are absent from passes object
  - criterion: cleanup commit "docs(ledger): dedupe cross-cutting findings" landed
    satisfied: false
    evidence: absent — git log shows no cleanup commit
  - criterion: per-pass commits across passes 1-3
    satisfied: true
    evidence: 22 test(j-...) commits across passes 1-3, all journeys covered

findings:
  - **pv-5-01** [must-fix] — Pass 4 (adversarial probing) not run
    - criterion: every journey terminal review_status on every pass
    - issue: state file's "passes" object has only "1-compositional", "2-compositional", "3-compositional" entries. No "4-adversarial" entry.
    - fix: re-invoke coverage-expansion with mode: depth + resume marker; it will pick up at Pass 4 and run adversarial-probe subagents per journey.

  - **pv-5-02** [must-fix] — Pass 5 (regression) not run
    - criterion: every journey terminal review_status on every pass
    - issue: state file lacks "5-adversarial" entry.
    - fix: covered by pv-5-01's resume — Pass 5 follows Pass 4.

  - **pv-5-03** [must-fix] — Cleanup ledger dedup not landed
    - criterion: cleanup commit "docs(ledger): dedupe cross-cutting findings"
    - issue: git log search returned no matching commit.
    - fix: after Pass 5 returns, dispatch the cleanup subagent (single dispatch, haiku model, ledger-only edits).

summary: 3 findings — Phases 4, 5, and cleanup not run. Onboarding cannot advance to Phase 6 until coverage-expansion completes the full 5-pass + cleanup pipeline.
````

### Onboarding's response

1. Reads the 3 findings.
2. Applies pv-5-01's `fix:` — re-invokes `coverage-expansion` with `mode: depth` (state file's resume marker picks up at Pass 4).
3. After coverage-expansion returns `status: complete`, dispatches `phase-validator-5:` again as cycle 2/10.
4. Cycle 2 validator re-runs the verification, finds all criteria satisfied, returns greenlight.
5. Onboarding writes Phase 5 greenlight to the ledger and advances to Phase 6.
