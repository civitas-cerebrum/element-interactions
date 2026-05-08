# Coverage-Expansion State File — Schema and Lifecycle

**Status:** authoritative spec for `tests/e2e/docs/coverage-expansion-state.json`. Cited from `coverage-expansion/SKILL.md`.
**Scope:** what the file contains, when it is written, how to resume from it, and when to refuse a state file as corrupt.

For the auto-compaction flow that triggers state-file writes mid-pipeline, see `references/depth-mode-pipeline.md` §"Auto-compaction between passes".
For the dual-stage `dispatches[]` per-journey fields' meaning, see `references/dual-stage-retry-loop.md`.

---

## Authoritative state file — read first, always

The skill's **first action on entry**, before anything else, is to read `tests/e2e/docs/coverage-expansion-state.json`. Resumption is a contract, not a convention.

```
1. Read tests/e2e/docs/coverage-expansion-state.json.
2. If the file is absent, or status == "complete", start Pass 1 from scratch.
3. If currentPass is set, resume from that pass's journey roster.
4. Skip journeys already marked complete in the state file for the current pass.
5. Only when all 5 passes + cleanup show complete, return "coverage-expansion finished".
```

The state file is authoritative. The orchestrator must not reason about "where did we leave off" from chat history, commit log, or journey-map deltas — those are diagnostic, not authoritative. If the file says currentPass=3 with 22 of 45 journeys complete, Pass 3 resumes with the remaining 23 journeys and Pass 4/5/cleanup run afterwards.

State file shape (minimum fields):

```json
{
  "status": "in-progress",
  "currentPass": 3,
  "journeyRoster": ["j-...", ...],
  "completedJourneys": ["j-...", ...],
  "inFlightJourneys": ["j-...", ...],
  "dispatches": [
    {
      "journey": "j-<slug>",
      "stage_a_cycles": 2,
      "stage_b_cycles": 2,
      "review_status": "greenlight",
      "final_must_fix": [],
      "result": "new-tests-landed",
      "authorizer": null
    }
  ],
  "adversarialTotals": { ... },
  "adversarialSkippedJourneys": [
    {
      "journey": "j-logout",
      "rationale": "P3 logout, single-page surface already probed by a larger journey's pass-4 app-wide CSRF entry; zero unique findings in prior passes",
      "criteria": ["priority-p3", "page-subset-covered", "zero-prior-findings", "low-surface-shape"]
    }
  ],
  "updatedAt": "2026-04-24T..."
}
```

**Per-journey dispatch entry fields (dual-stage).** Each entry in `dispatches[]` carries:

- `journey` — the journey ID (`j-<slug>`).
- `stage_a_cycles` — integer; number of Stage A dispatches for this journey in this pass (1..7).
- `stage_b_cycles` — integer; number of Stage B dispatches for this journey in this pass (equal to or one less than stage_a_cycles depending on whether cycle 7 exhausted or greenlit early).
- `review_status` — one of `greenlight | blocked-cycle-stalled | blocked-cycle-exhausted | blocked-dispatch-failure`.
- `final_must_fix` — array of finding-IDs. Empty for `greenlight`; populated for blocked statuses with the list Stage A failed to resolve (carried to next pass's Stage A brief as trigger 4).
- `result` — the no-skip contract enum value (`new-tests-landed | covered-exhaustively | blocked | skipped`). `result` describes Stage A's outcome alongside the no-skip enum; `review_status` describes Stage B's judgement; together they describe both stages' outcomes.
- `authorizer` — only non-null for `skipped` (requires user authorisation).
- `batch_id` — nullable string. Non-null when this journey was part of a batched Stage A dispatch (per [`depth-mode-pipeline.md` §"Batched dispatch for P3 peripheral journeys"](depth-mode-pipeline.md)); the `batch_id` value is shared across every journey in the same batch so resume logic can reconstruct the batch grouping. Null for individually-dispatched journeys. When a journey breaks out of a batch mid-cycle (any cycle ≥ 2 after its Stage B returned `improvements-needed`), `batch_id` becomes null from cycle 2 onward — the cycle-1 batched entry retains the original `batch_id`, the cycle-2+ individual entry does not. `stage_a_cycles` is recorded per-journey in both cases.

A state file missing `stage_a_cycles`, `stage_b_cycles`, or `review_status` for any **dispatched** journey (i.e. excluding gated-skip entries — see §"Gated-skip entries" below) that has run this pass is incomplete — resume logic treats it as corrupt per `coverage-expansion/SKILL.md` §"Authoritative state file" (kernel-resident invariants).

**Gated-skip entries (Passes 2 & 3 only, issue #164.1).** When the orchestrator's three triggers all evaluate to false, a journey is recorded as a gated-skip instead of a dispatch:

```json
{
  "journey": "j-<slug>",
  "gated_skip": true,
  "result": "covered-exhaustively",
  "review_status": "greenlight",
  "triggers_checked": {
    "map_delta": false,
    "sibling_ledger_update": false,
    "must_fix_carry_over": false
  }
}
```

Required fields:

- `journey` — the journey ID.
- `gated_skip: true` — distinguishes the entry from a dispatch.
- `result: "covered-exhaustively"` — the Pass-2/3 contract is "the journey is covered to exhaustion" by Pass 1's tests; the gated-skip records that the orchestrator confirmed no new work was needed.
- `review_status: "greenlight"` — gated skips are by definition greenlit; no Stage B review applies.
- `triggers_checked` — object with three boolean fields naming each trigger explicitly. **All three MUST be `false`** for the entry to be valid; any `true` value means a trigger fired and the orchestrator should have dispatched. Missing fields are silent scope narrowing and are denied by `coverage-state-schema-guard.sh`.

Gated-skip entries count as "work done" for the §"Authoritative state file" pre-emptive-stop check — a Pass 2 with 30 gated skips and zero dispatches is legitimately complete. The hook recognises both shapes (dispatch with `stage_a_cycles`/`review_status`, or gated-skip with `triggers_checked`) as evidence of work.

Gated-skip entries are valid **only** for Passes 2 and 3. Pass 1 has no prior pass to gate against; Passes 4 and 5 (adversarial) keep dispatch-driven discipline because the per-journey adversarial yield is empirically uncorrelated with Pass-1 confidence.

**`adversarialSkippedJourneys[]` field (issue #164.4, opt-in P3 adversarial skip):** array of objects, each with:

- `journey` — the journey ID (`j-<slug>`).
- `rationale` — non-empty string explaining why the journey is being excluded from Passes 4 and 5. Vague rationales (`"low value"`, `"P3 doesn't need it"`) fail the contract; specific rationales naming the covered surface and the app-wide entry that subsumes it pass.
- `criteria` — array containing all four canonical strings naming the criteria (`priority-p3`, `page-subset-covered`, `zero-prior-findings`, `low-surface-shape`); the entry's validity requires all four to be present (the array is mechanical evidence, not a tickbox). Order doesn't matter; missing or extra strings DENY at the schema-guard hook.

The field is **opt-in per project, never silent**. The orchestrator may not append entries inferentially during a pass; entries land at project setup time (or in a between-pass commit explicitly authorised by the user) and stay through all subsequent runs. Compositional Passes (1–3) ignore this field — every journey gets compositional coverage regardless. Adversarial Passes (4 and 5) read it on entry and exclude listed journeys from their journey roster for those passes only.

**Implementation:** the orchestrator iterates `journeyRoster - adversarialSkippedJourneys[].journey` for Passes 4 and 5; `journeyRoster` itself is NOT rewritten and `completedJourneys` continues to track only journeys whose dispatch returned in the current pass. The skip evidence lives only in `adversarialSkippedJourneys[]`.

The state file is rewritten after every per-pass commit (and whenever auto-compaction triggers — see [`depth-mode-pipeline.md` §"Auto-compaction between passes"](depth-mode-pipeline.md)).

**`deferredJourneys[]` field (issue #155 Gap 2 — semantic authorisation).** Top-level array of objects, one entry per deferred journey. Each entry MUST satisfy one of:

- **(A)** `reason` starts with one of the allowed structural prefixes — `blocked-on-app-bug:<id>`, `test-data-prerequisite:<thing>`, `user-authorised:<verbatim quote>`. These are subagent-returned or environment-attested reasons that need no further authorisation.
- **(B)** The entry carries an `authorizer` field whose value is a non-empty string interpreted as a verbatim quote of in-conversation user authorisation.

Entry shape:

```json
{
  "journey": "<JOURNEY-ID>",
  "reason": "<allowed prefix or self-imposed reason>",
  "authorizer": "<verbatim quote, OR null/absent if reason has allowed prefix>"
}
```

**Namespace note.** This `authorizer` field is distinct from the per-`dispatches[]`-entry `authorizer` field documented above. The dispatch-entry `authorizer` is non-null only when `result == "skipped"` (per-journey skip authorised by user). The `deferredJourneys[]` `authorizer` is the verbatim quote authorising a self-imposed deferral. Two distinct contracts share the field name; the hook distinguishes by entry shape (presence of `stage_a_cycles` / `review_status` marks a dispatch entry; their absence + `journey` + `reason` marks a deferral entry).

Harness-enforced by `hooks/coverage-state-deferral-auth-guard.sh` (PreToolUse:Write|Edit). Self-imposed reasons (`budget-cap`, `session-length`, `mode-deviation`, `inferred-pref`, `auto-mode-stop`) are DENY without an `authorizer:` field. Empty / whitespace-only / `null` authorizer also denies.

**Journey-roster mutability.** The roster for a given pass is frozen at the start of that pass — it is a snapshot of the journey IDs the orchestrator intends to dispatch *this pass*. If a compositional pass discovers and promotes a new journey or sub-journey mid-pass, the new entry is appended to the **next** pass's roster, not retroactively to the current pass's. This prevents the "did I cover everything?" ambiguity where `journeyRoster` and `completedJourneys` diverge because the roster keeps growing. Reconciliation commits (Pass 2/3) write the new roster to the state file at the same commit that appends the new map blocks, so the post-compact resume reads a consistent roster-to-map alignment.

**Corrupted or stale state file.** If the state file is present but references journeys that no longer appear in `journey-map.md`, or if `currentPass` is set but `completedJourneys` is a superset of `journeyRoster`, the orchestrator stops and reports the mismatch to the caller rather than guessing. Self-repair is out of scope — a corrupted state file is a manual-triage signal, not a silent reset.

---
