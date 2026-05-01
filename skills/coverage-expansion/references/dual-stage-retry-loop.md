# Dual-Stage Retry Loop — Stage A↔B Per Journey Per Pass

**Status:** authoritative spec for the per-journey dual-stage pipeline. Cited from `coverage-expansion/SKILL.md`.
**Scope:** the bounded 7-cycle Stage A↔B retry loop, termination conditions, the "fresh reviewer every cycle" invariant, and dual-stage-specific anti-rationalizations.

For the per-pass dispatch pipeline that drives one cycle into this loop, see `references/depth-mode-pipeline.md` §"Per-pass pipeline".
For the canonical Stage A and Stage B return shapes, see `../element-interactions/references/subagent-return-schema.md` §1, §2, §2.4.
For the Stage B reviewer's brief and must-fix calibration, see `reviewer-subagent-contract.md`.
For the adversarial Stage A contract, see `adversarial-subagent-contract.md`.

---

## Dual-stage per-pass contract

Every one of the 5 passes runs **per journey** as two sequential stages:

- **Stage A — Compose / Probe.** The existing `test-composer` (passes 1–3) or adversarial probe subagent (passes 4–5). Dispatch contract unchanged from the single-stage era.
- **Stage B — Adversarial Review.** A fresh staff-level-QA reviewer subagent, per journey, with its own isolated context and its own isolated `playwright-cli` session (`-s=<journey-slug>-stage-b`). Reads Stage A's output and the live app; returns `greenlight` or `improvements-needed`. Never writes tests, never appends to the ledger, never modifies files.

The dual-stage design addresses a concrete failure mode: a single subagent that both does the work AND self-certifies it misses scenarios a fresh independent reviewer would catch. Stage B is that independent reviewer. It exists to catch what Stage A missed.

**Per journey per pass**, Stage A and Stage B alternate in a bounded retry loop up to 7 A↔B cycles (see §"Retry loop" below). Worst case: 7 A dispatches + 7 B dispatches = 14 per journey per pass.

**Contracts:**
- Stage A: unchanged from its skill (see `test-composer` for compositional passes, `references/adversarial-subagent-contract.md` for adversarial passes).
- Stage B: see `references/reviewer-subagent-contract.md` for the full contract and dispatch-brief template.
- Return shape: both stages use the canonical subagent-return-schema. Stage B's return states (`greenlight`, `improvements-needed`) are additions; Stage A's existing states are unchanged.

**Cost posture.** This skill is **cost-blind**. The optimisation targets are completeness and speed, not dispatch cost. Default opus for every dispatch in every stage. The sonnet-for-P2/P3 heuristic from the prior design is removed; a narrow sonnet exception for cycle-1 Stage B confirmation on previously-greenlit journeys is documented in [`depth-mode-pipeline.md` §"Model selection"](depth-mode-pipeline.md).

**No-skip extension.** Under dual-stage, the no-skip contract (PR #105) extends: every journey must receive both Stage A and Stage B in every pass. A journey with Stage A but no Stage B is incomplete. The terminal `review_status` set gains three subagent-evidenced blocked values — `blocked-cycle-stalled`, `blocked-cycle-exhausted`, and `blocked-dispatch-failure` — per §"Retry loop" termination conditions. (These hyphenated forms are the canonical `review_status` enum used in the state file's `dispatches[]` array; the no-skip `result` field's `blocked (reason)` shape may carry these strings as the reason text, but `review_status` itself is the bare hyphenated form.)

**Dual-stage no-skip rationalizations to reject:**

> ↗ Cross-cutting categories: see [`anti-rationalizations.md`](anti-rationalizations.md) §"Self-certifying greenlight" and §"Trivial-journey-skip".

| Excuse | Reality |
|--------|---------|
| "Stage A returned `covered-exhaustively` with full mapping evidence — no need to dispatch Stage B for this journey" | Stage A's `covered-exhaustively` is one of four valid Stage A returns; it does not authorise skipping Stage B. The reviewer is the verification, not Stage A's self-certification. Dispatch B. |
| "Cycle 1 Stage B will obviously greenlight this trivial journey, I'll skip it and record `greenlight` in the state file" | Self-certifying greenlights without a reviewer dispatch is exactly the failure mode dual-stage was introduced to close. Dispatch the reviewer; if it really is trivial, sonnet-confirmation is the fast path documented in [`depth-mode-pipeline.md` §"Model selection"](depth-mode-pipeline.md). |
| "The journey was greenlit last pass with no map delta — skip the whole A↔B for this pass" | Every journey gets both stages every pass, full stop. Sonnet-confirmation reduces the cost of the trivial-greenlight case but does not eliminate the dispatch. |
| "The pass is otherwise clean — leaving one journey without a Stage B return is fine, I'll record review_status anyway" | A `review_status` written without a Stage B dispatch having occurred is fabricated state — corrupts the state file, breaks resume, and lies to telemetry. Dispatch B or surface the gap. |

### Retry loop (orchestrator, per journey per pass)

For each journey in the current pass's roster, the orchestrator runs:

```
stage_a_input = base_brief                             # initial cycle-1 input
history = []

for cycle in 1..7:
  try:
    a_return = dispatch Stage A with stage_a_input
  except DispatchFailure:                              # transport / timeout / malformed
    review_status = "blocked-dispatch-failure"
    break

  if not validates(a_return, schema_§4.1):             # malformed content
    re-dispatch once with same brief; if it fails again:
      review_status = "blocked-dispatch-failure"
      break

  b_return = dispatch Stage B (fresh ctx, fresh playwright-cli session) to review a_return

  if b_return.status == "greenlight":
    review_status = "greenlight"
    break

  must_fix = b_return.findings  # every reviewer finding is must-fix; no other priority exists

  if must_fix is empty:                               # status was "improvements-needed" but findings empty
    re-dispatch reviewer once with stricter brief; if same shape returns:
      coerce to "greenlight" (no findings = no changes needed)
      review_status = "greenlight"
      break

  # Stall detection — fires on either signal:
  #   (a) reviewer's self-flagged stalled: true (per reviewer-contract step 7), OR
  #   (b) three cycles in a row with identical must-fix lists (i.e., the
  #       current cycle and the two immediately-prior cycles all share the
  #       same must-fix list, meaning Stage A failed to address it across
  #       two consecutive retry attempts).
  # One match (current == prior-1) is NOT enough: a reviewer in cycle N+1 may
  # legitimately catch a finding the cycle-N reviewer missed, then cycle N+2's
  # reviewer matches N+1's — cycle N+1 was real progress, not stall. Require
  # current == prior-1 == prior-2 (two consecutive matches, three identical
  # lists in total). identical_run counts current + each prior that matches,
  # so the threshold is >= 3.
  identical_run = 1
  for prior in reversed(history):
    if prior.must_fix == must_fix:
      identical_run += 1
    else:
      break
  if b_return.stalled == true or identical_run >= 3:
    review_status = "blocked-cycle-stalled"
    break

  history.append({"cycle": cycle, "must_fix": must_fix})
  stage_a_input = base_brief + b_return.findings

if cycle == 7 and review_status is unset:
  review_status = "blocked-cycle-exhausted"

# Precedence note: if cycle 7's must_fix matches a stalled run, the loop breaks
# on blocked-cycle-stalled BEFORE the post-loop check. Stalled wins over exhausted
# when both apply — different downstream signal (re-pass trigger 4 wording,
# telemetry calibration). This is intentional.

record journey review_status + cycle count + final must_fix list in state file
```

**Termination conditions:**

| Condition | `review_status` | Action |
|---|---|---|
| Reviewer returns `greenlight` | `greenlight` | Accept, commit this journey's work this pass. |
| Reviewer returns `improvements-needed` with **empty** findings, twice in a row | `greenlight` (coerced) | Empty findings = no changes needed; the `improvements-needed` status was malformed. Coerce after one re-dispatch. |
| Reviewer's `must-fix` list identical for **3+ cycles in a row** (current == prior-1 == prior-2) OR reviewer sets `stalled: true` | `blocked-cycle-stalled` | Escalate — Stage A failed to address this list across two consecutive retries. Commit whatever Stage A landed; log the unresolved list. **Takes precedence over exhausted** when cycle 7's list satisfies the same condition. |
| Cycle 7 reached without greenlight (and not stalled) | `blocked-cycle-exhausted` | Escalate — retry budget spent. Commit whatever Stage A landed; log the unresolved list. |
| Stage A dispatch fails (transport / timeout / malformed schema), re-dispatch also fails | `blocked-dispatch-failure` | Escalate — infrastructure issue, not a discipline issue. Commit nothing for this journey this pass; carries to next pass with the failure noted in trigger-4 input. |

Both blocked statuses are valid terminal values under the no-skip contract (PR #105). They are **not** pass failures — they are visible deferrals. The orchestrator records the `must-fix` list to the state file and carries it forward to the next pass as an explicit Stage A input (see [`depth-mode-pipeline.md` §"Re-pass mode for compositional passes 2–3"](depth-mode-pipeline.md) trigger 4).

**Why 7 cycles.** Gives genuine room for adversarial iteration: first review catches obvious gaps, second fills subtler ones, third addresses what the reviewer missed the first read. The bounded cap prevents runaway loops while leaving enough slack that exhaustion is the exception rather than the common case. The same numeric value (7) appears as the P3 batch cap in [`depth-mode-pipeline.md` §"Batched dispatch for P3 peripheral journeys"](depth-mode-pipeline.md) — these two 7s are **independent design choices** that happen to share a number. Changing one does not require changing the other; the rationales are unrelated (cycle cap = adversarial-iteration-budget; batch cap = brief-size-and-per-journey-attention-budget).

**Fresh reviewer every cycle.** Every Stage B dispatch is a fresh subagent with a fresh `playwright-cli` session — no context inheritance from the prior cycle's reviewer, no context inheritance from the paired Stage A. The fresh-eyes property is load-bearing; if the reviewer carries state across cycles, it will start agreeing with Stage A.

**Rationalizations to reject:**

> ↗ Cross-cutting categories: see [`anti-rationalizations.md`](anti-rationalizations.md) §"Compress findings into summary", §"Cycle-7 exhausted → call-it-greenlit", and §"Reviewer-disagreement cherry-picking".

| Excuse | Reality |
|--------|---------|
| "Cycle 3 has the same must-fix list but I think Stage A could fix them with one more try" | If the list is identical, Stage A has already failed to address these items with the same inputs twice. `blocked-cycle-stalled` is the correct terminal state; human or follow-up-pass attention is the next step. |
| "Reviewer returned improvements-needed but the must-fix list is small; I'll skip the retry" | A single `must-fix` item is enough to block greenlight. Retry with the findings appended. |
| "I'll compact findings from cycles 1–4 into one summary string for cycle 5's input" | Compressed findings lose the surgical specificity Stage A needs to fix them. Pass the full findings through verbatim. |
| "Cycle 7 exhausted and I'll just call it greenlit to keep the pass moving" | `blocked-cycle-exhausted` is the correct terminal. Marking it greenlit when it isn't corrupts the state file and the next pass's trigger-4 input. |
| "Reviewer disagrees with itself between cycles 1 and 2; I'll pick the more lenient one" | Each cycle's reviewer is fresh and independent. Take each cycle's output as-is; the retry-loop logic handles divergence via the stalled/exhausted checks. |

---
