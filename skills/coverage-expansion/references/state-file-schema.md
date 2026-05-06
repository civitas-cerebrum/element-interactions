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

A state file missing `stage_a_cycles`, `stage_b_cycles`, or `review_status` for any journey that has run this pass is incomplete — resume logic treats it as corrupt per `coverage-expansion/SKILL.md` §"Authoritative state file" (kernel-resident invariants).

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
