---
name: coverage-expansion
description: >
  Iteratively expand E2E test coverage across an entire mapped application. Owns
  priority ordering, journey-by-journey iteration, parallel dispatch for
  independent journeys, model selection per journey size, and map reconciliation
  between passes. Calls the test-composer skill per journey for compositional
  passes and invokes bug-discovery per journey for adversarial passes; does not
  compose tests itself. Runs in three modes: `breadth` (one horizontal sweep,
  fast); `standard` (three compositional passes + two adversarial passes +
  ledger dedup, journey-by-journey — the default); or `depth` (strict
  per-journey parallel on every pass, ~20× the dispatch cost — picked
  explicitly for high-fidelity audits).
  Triggers on "increase coverage", "expand tests", "iterative coverage",
  "deep coverage pass", and when invoked by the onboarding skill as its Phase 5.
---

# Coverage Expansion — Iterative Journey-by-Journey Test Growth

> **Skill names: see `../element-interactions/references/skill-registry.md`.** Copy skill names from the registry verbatim. Never reconstruct a skill name from memory or recase it.

The orchestrator for coverage growth. Iterates the user journey map, dispatches `test-composer` per journey for compositional passes, dispatches adversarial-probe subagents per journey for adversarial passes, and merges map discoveries between journeys. Standard mode runs 3 compositional passes + 2 adversarial passes + one cleanup/dedup step (Pass 1 strict, Passes 2-5 may group). Depth mode is the first-class strict-parallel-everywhere counterpart (every pass strict per-journey; no grouping anywhere; ~20× more dispatches than standard; for high-stakes audits + benchmarks). Breadth mode runs one sweep.

**Context discipline:** this skill holds only the map index (IDs, names, priorities, `Pages touched`), the independence graph, and the pass counter. All journey-level reasoning happens inside dispatched subagents with isolated context windows.

**Canonical return + ledger schema:** every subagent dispatched by this skill — compositional (`test-composer`) or adversarial — returns findings and writes ledger entries against the canonical schema in [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md). Dispatch briefs include a pointer to that file; the schema is never re-pasted. Key points:

- Finding-IDs use `<journey-slug>-<pass>-<nn>` inside Passes 1–5. Severities are `critical | high | medium | low | info`.
- `status: covered-exhaustively` requires a per-expectation mapping table. `status: no-new-tests-by-rationalisation` is **not a valid return** from any pass and is treated as a contract violation — the orchestrator re-dispatches with a stricter brief.
- Adversarial ledger appends (`tests/e2e/docs/adversarial-findings.md`) MUST validate against the ledger schema in §3 of the reference file before releasing the lockfile.

---

## Two valid exits — read this before anything else

There are exactly two ways for a coverage-expansion run to terminate:

1. **All 5 passes + cleanup complete** for `mode: standard` (alias `mode: depth`) (or the one breadth sweep complete for `mode: breadth`), with every journey dispatched in every pass.
2. **Commit-what-landed + write `coverage-expansion-state.json` + stop with an explicit "resume needed" message** naming the completed passes, the in-flight pass, and the pending journeys.

There is no third exit. Any framing that implies "partial run, but reasonable" — *"pragmatic Pass 1"*, *"honest Pass 1 only"*, *"most of the work done"*, *"deferred Passes 2–5 to a follow-up"*, *"reduced scope given session constraints"*, *"the realistic standard-mode contract for this app is an evening-or-overnight wall-clock run"*, *"the honest stopping point right now is to write state and resume in a fresh conversation"* — is the contract violation this skill exists to prevent. Tone does not change the contract: a "transparent" scope reduction is still a scope reduction, and silent scope reduction dressed in candid language is still silent scope reduction.

**Exit #2 is for budget-driven mid-pipeline stops, not for refusing to start.** Exit #2 requires AT LEAST ONE DISPATCH IN FLIGHT before it is invocable. A `coverage-expansion-state.json` written with `currentPass: 1` and zero recorded dispatches is not exit #2 — it is the pre-emptive-stop anti-pattern. The state file is a post-action ledger reflecting work that actually happened, not a pre-action plan. Harness-enforced: a `Write|Edit` schema guard denies pre-emptive state-file writes (see [`../element-interactions/references/harness-hooks.md`](../element-interactions/references/harness-hooks.md)).

**Deferral authorisation is harness-enforced too.** When `status: in-progress` is paired with `deferredJourneys[]` entries, every entry must justify itself in one of two ways:

- `reason` starts with one of the allowed structural prefixes — `blocked-on-app-bug:<id>`, `test-data-prerequisite:<thing>`, `user-authorised:<verbatim quote>`. These are subagent-returned or environment-attested reasons that need no further authorisation.
- The entry carries an `authorizer` field whose value is a non-empty string interpreted as a verbatim quote of in-conversation authorisation by the user.

Methodology rule — writes where any deferral satisfies neither form (no allowed structural prefix and no `authorizer:` field) are silent scope narrowing of the kind observed in #155 (25 deferred entries with `reason: budget-cap`). Self-imposed reasons like `budget-cap`, `session-length`, `mode-deviation`, `inferred-pref`, `auto-mode-stop` are invalid without an `authorizer:` field. (The harness deferral-auth guard that previously denied such writes was retired in the 0.3.6 cleanup for public-dep cleanliness; the rule itself still applies.)

If you are about to dispatch fewer passes than the mode requires, or fewer journeys than the map contains, you must EITHER (a) have explicit user authorisation in this conversation naming the reduction, OR (b) take exit #2 above (which requires at least one dispatch already in flight). Self-authorisation is not authorisation. Auto-mode is not authorisation. Inferred user preference is not authorisation. Estimated session length is not authorisation.

**Onboarding-pipeline contract**: when invoked from `onboarding` Phase 5 (autonomous mode), the front-load gate has already authorised the full pipeline ("tens of minutes to several hours"). The orchestrator may not stop pre-emptively in autonomous mode — the only valid mid-run stop is exit #2 *after at least one wave has returned*. "Mostly done with Phase 3 happy-path, surfacing back to user" is not a valid Phase 5 exit. (The onboarding contract holds identically under `mode: standard` and the `mode: depth` alias.)

### Reviewer parallelism is non-negotiable (and one optional batch step)

Stage B reviewers run **at host max parallelism**, not one at a time. A pass with 16 journeys dispatches up to 16 reviewers in one parallel wave (subject to the shared-resource audit's credential caps — see §"Parallel cap — lifted and jointly applied"). Reviewer dispatch is NOT a serialised cost.

The contract:
- **Per-journey**: each reviewer reads ONE journey's spec + journey block + live app (Stage B is per-journey by default).
- **Across journeys**: dispatched in parallel up to the host-max cap, sharing the same in-flight pool with Stage A retries.
- **Within a journey**: Stage A and Stage B are sequential (a journey's own A and B never overlap), but its B can run while a sibling journey's A is in flight.

**Batch reviewer mode — Pass 1/2/3 cycle-1 only.** For the cycle-1 Stage B of compositional Passes 1, 2, and 3, the orchestrator dispatches **one** Opus reviewer that reads all in-flight journeys' Stage A spill files together and emits per-journey verdicts in a single return. ~85% of compositional cycle-1 reviews return greenlight; per-journey isolation over-pays for that majority. Role-prefix `reviewer-batch-pass-<N>:`; return shape in [`references/reviewer-subagent-contract.md`](references/reviewer-subagent-contract.md) §"Batch reviewer mode (cycle-1 compositional only)". For any flagged journey in the batch return, the orchestrator dispatches a follow-up cycle-2 `mode: per-journey` reviewer. **Adversarial Passes 4 and 5 never batch** — the per-journey live-app probe + matrix coverage check is load-bearing. **Cycle-2+ is always per-journey**, regardless of pass.

If you are about to stop after Stage A claiming "running 16 reviewers is too much for this session" — re-read this section. 16 reviewers in parallel is one wave. The wave is the contract.

See §"Parallelism — Intra-group pipelining (dual-stage)" for the full pipelining model.

---

### Stage A per-journey dispatch is non-negotiable

Stage A composers run **one subagent per journey, in parallel up to host max** by default. A pass with 16 journeys dispatches up to 16 Stage A subagents in one parallel wave. Stage A is **not** "4 group agents each covering 4 journeys sequentially" by default — that is batched grouping, not per-journey dispatch.

**First-pass strict / subsequent-pass relaxed (standard) — or every-pass strict (depth).** Pass 1 of `mode: standard` is **strict per-journey parallel** — `[group]` and `[P3-batch]` markers are FORBIDDEN on Pass 1. The first pass establishes the test foundation at maximum fidelity; that quality propagates through every later pass. Passes 2-5 MAY use grouping (`[group]` cap-7 for tiers with >5 journeys, `[P3-batch]` cap-7 for P3 peripherals) when the trigger conditions in §"Relevance grouping for compositional passes" / §"Batched dispatch for P3 peripheral journeys" / §"Adversarial grouping for Passes 4 and 5" hold. The strict-per-journey contract on Passes 4 and 5 becomes an **opt-in** via `args: "strict-adversarial: true"`. Empirical rationale: adversarial findings cluster by app-wide pattern (see app-wide-patterns.md prelude) so per-journey isolation is less load-bearing once the catalogue exists; the strict-on-first-pass rule captures the fidelity moment where it pays. **Under `mode: depth`** (first-class strict-parallel-everywhere — selected via the onboarding front-load gate), `[group]` and `[P3-batch]` markers are FORBIDDEN on **every** pass (Passes 1, 2, 3, 4, AND 5); adversarial Passes 4-5 are strict-per-journey by default; ~20× more dispatches than standard. Harness-enforced: the `standard-mode-first-pass-guard.sh` hook reads `runMode` + `currentPhase` + `currentSubStage` from the workflow ledger `tests/e2e/docs/onboarding-status.json` (default `"standard"` when absent, with `coverage-expansion-state.json` as a fallback for bare invocations outside onboarding) and denies grouping dispatches per the mode's contract — Pass-1 only under standard, every pass under depth.

The contract:
- **Per-journey**: each Stage A subagent owns ONE journey's brief, ONE journey's `playwright-cli` session slug, and produces ONE journey's commit(s). The journey block + its referenced sub-journeys are the brief; sibling journeys are not in scope for that subagent.
- **Pass 1 strict — no grouping.** `[group]` and `[P3-batch]` are forbidden on Pass 1. Hook-denied.
- **P3 batching** (Passes 2-5 only): documented in §"Batched dispatch for P3 peripheral journeys" — P3 only, max 7 per brief, with cycle-1 split-out semantics.
- **Relevance grouping** (compositional Passes 2-3, > 5 journeys at a priority tier): documented in §"Relevance grouping for compositional passes" — same-priority + same-section grouping, max 7 journeys per group, applies to ALL priorities (P0/P1/P2/P3) once the >5 threshold is crossed. Stage B remains per-journey within a group.
- **Adversarial grouping** (Passes 4-5, opt-out path): documented in §"Adversarial grouping for Passes 4 and 5" — `[group]` cap-7 permitted by default; opt back into per-journey strictness with `args: "strict-adversarial: true"`. The same `[group]` marker is also used by `bug-discovery` Phase 6 element / flow probing — same trigger, same cap, same priority-pure rule, items use `probe-j-` prefix instead of `composer-j-`.
- **Across journeys**: dispatched in parallel up to the host-max cap, sharing the same in-flight pool with Stage B reviewers (per §"Parallel cap — lifted and jointly applied").

If you find yourself writing one Agent dispatch that owns multiple journeys without an explicit `[P3-batch]` or `[group]` marker prefix, stop. That is unmarked batching. Groups must declare themselves via the role-prefix marker so the harness dispatch-guard can validate the cap and so reviewers know to expect cross-journey context. The fix is either (a) split into N parallel single-journey dispatches in one message, or (b) re-issue under the `[group]` marker if the group conditions in §"Relevance grouping" hold.

The symptom of getting batching wrong: every Stage B reviewer for a batched-Stage-A journey returns `improvements-needed` because the batched composer rationed attention across siblings and skipped Test-expectations bullets (mobile, error states, edge cases) on each. The volume of `improvements-needed` returns is the diagnostic. The cap-7 group size and Stage-B-per-journey within a group are the safeguards against this; if a group's cycle-1 reviews trend toward `improvements-needed`, drop the group and split that wave into per-journey dispatches.

See §"Relevance grouping for compositional passes" and §"Batched dispatch for P3 peripheral journeys" for the two documented batching exceptions.

**Schema validation and `[group]` / `[P3-batch]` dispatches.** Grouped dispatches are intentionally **not** schema-validated by `subagent-return-schema-guard.sh` or `subagent-schema-preread-gate.sh`. The wrapper return contains per-item returns which the parent splits and validates individually. The schema-guards only fire on individual `composer-`/`probe-`/`reviewer-`/`phase-validator-` prefixed dispatches.

**Harness backstop.** A `PreToolUse:Agent` guardrail denies batched dispatches disguised as single-journey calls and bare role-ambiguous prefixes — markdown rules can be rationalised away mid-run, the hook cannot. Install-time skip available for enterprise-managed environments; doing so falls back to markdown-only enforcement and re-opens the loophole. See [`../element-interactions/references/harness-hooks.md`](../element-interactions/references/harness-hooks.md).

### Role prefixes

Every Agent dispatch description starts with a role-explicit prefix. The prefix routes the dispatch through the harness gates: a dispatch-guard validates inputs, the playwright-cli isolation guard ties the prefix to a session slug, and a return-schema guard validates the output shape against the role's contract. Same prefix on description, on CLI session slug, on the schema selector — one mechanical convention. (Harness gates indexed in [`../element-interactions/references/harness-hooks.md`](../element-interactions/references/harness-hooks.md).)

| Role | Description prefix | CLI session slug | Return shape |
|---|---|---|---|
| Stage A composer (per journey) | `composer-j-<slug>:` | `composer-j-<slug>-<pass>-c<N>` | `subagent-return-schema.md` §1 + §2 (Stage A) |
| Stage A composer (sub-journey) | `composer-sj-<slug>:` | `composer-sj-<slug>-<pass>-c<N>` | as above |
| Stage B reviewer (per journey) | `reviewer-j-<slug>:` | `reviewer-j-<slug>-<pass>-c<N>` | `subagent-return-schema.md` §2.4 (Stage B) |
| Stage B reviewer (batch — compositional cycle-1 only) | `reviewer-batch-pass-<N>:` | (no CLI session — static reader) | `subagent-return-schema.md` §2.4-batch (`verdicts:` array wrapping per-journey §2.4 returns) |
| Adversarial probe (passes 4-5) | `probe-j-<slug>:` | `probe-j-<slug>-<pass>` | Stage A finding shape + ledger |
| Sub-orchestrator (process-validator) | `process-validator-<scope>:` | (no CLI session) | Reviewer-shape (§2.4) applied to a manifest |
| Phase 1 discovery | `phase1-<entry>:` | `phase1-<entry>` | site-map / page entries |
| Phase 2+ discovery | `phase2-<scope>:` | `phase2-<scope>` | site-map / page entries |
| Stage 2 element inspection | `stage2-<scenario>:` | `stage2-<scenario>` | page-repository entries |
| P3-batch composer (≤7) | `[P3-batch] composer-j-<a>,composer-j-<b>,...:` | per-item slug | per-journey returns concatenated |
| Relevance-group composer (≤7) | `[group] composer-j-<a>,composer-j-<b>,...:` | per-item slug | per-journey returns concatenated |
| Cleanup / dedup | `cleanup-<scope>:` | `cleanup-<scope>` | unstructured |

**Forbidden:** bare `j-<slug>:` and bare `sj-<slug>:` — role-ambiguous, blocked at dispatch time. Pick one of `composer-`, `reviewer-`, or `probe-` based on what the subagent actually does.

---

## Self-talk red flags

When the orchestrator catches itself reasoning along certain framings — pre-emptive scope reduction, self-authorised batching, self-certifying greenlight, sonnet cost-down rationalisation, brief-leak, etc. — the relevant **failure-mode pattern** is documented in [`references/anti-rationalizations.md`](references/anti-rationalizations.md). The registry is keyed by category (not surface phrasing), names the symptoms that signal each pattern, the reality counter, and which hook (if any) catches that class mechanically.

A novel framing that doesn't obviously match anything → match to the closest existing pattern first; only add a new pattern if genuinely categorical-new. Symptom-level enumeration is what the registry consolidates **away** from — chasing every tactical excuse never keeps up.

## Reference index

This file is the orchestrator-side contract kernel. The heavy spec lives in `references/` — open the file relevant to what you're touching:

| Reference file | What's in it |
|---|---|
| [`references/depth-mode-pipeline.md`](references/depth-mode-pipeline.md) | Per-pass pipeline (steps 1–8), pass differences, commit-message conventions, per-pass completion criteria, whole-suite re-run gate, parallelism model, model selection (hybrid; opus where it pays), auto-compaction between passes, re-pass mode for compositional passes 2–3, **relevance grouping for compositional passes (`[group]`, cap 7, all priorities, triggered by tier size > 5)**, batched dispatch for P3 peripheral journeys (`[P3-batch]`, cap 7, P3-only), **per-pass dedup (one cleanup subagent at the end of every pass — within-pass test or finding consolidation)**, post-pass-5 cross-pass ledger dedup. |
| [`references/dual-stage-retry-loop.md`](references/dual-stage-retry-loop.md) | The 7-cycle Stage A↔B retry loop pseudocode, termination conditions, "fresh reviewer every cycle" invariant, dual-stage-specific anti-rationalizations. |
| [`references/state-file-schema.md`](references/state-file-schema.md) | `coverage-expansion-state.json` shape, per-journey `dispatches[]` entry fields including dual-stage fields, journey-roster mutability, corrupt-state-refusal protocol. |
| [`references/subagent-isolation.md`](references/subagent-isolation.md) | Per-role dispatch contracts (compositional, adversarial, cleanup): isolation guarantees, brief inputs, `playwright-cli` session naming, the orchestrator's never-hold-payload-content rule. |
| [`references/process-validator-workflow.md`](references/process-validator-workflow.md) | The sub-orchestrator pattern: when to invoke `process-validator-<scope>:`, manifest shape, validator review checklist, response shape (mirrors reviewer-return), parent's response handling. |
| [`references/anti-rationalizations.md`](references/anti-rationalizations.md) | Failure-mode patterns the orchestrator and subagents must recognise (keyed by category, not surface phrasing). Each entry: name, symptoms, reality, enforcing hook (or `markdown-only`), origin. |
| [`references/reviewer-subagent-contract.md`](references/reviewer-subagent-contract.md) | Stage B contract: role, inputs, must-fix calibration, hard constraints, the 7-step process. |
| [`references/adversarial-subagent-contract.md`](references/adversarial-subagent-contract.md) | Stage A contract for passes 4–5: probe categories, negative-case matrix, ledger append protocol, regression-test authoring rules. |
| [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md) | Canonical return + ledger schema. §1 finding-return shape; §2 return states; §2.4 reviewer-return; §3 ledger schema; §4 caller contract; §4.1 grep-based conformance check; §4.2 harness validator. |

### Kernel-resident invariants — convention

Throughout this file, sections that point at a reference for the full spec also include a `### Hard rules — kernel-resident` subsection listing the 3-10 invariants that MUST stay in working memory even when the reference is not loaded. These restated rules are deliberate redundancy — the canonical text lives in the reference, this file holds the no-load-required floor. Skills are loaded eagerly when activated; references are loaded on demand. A hard contract rule that lives only in a reference can be silently ignored if the model proceeds without loading the reference, so reinforced embedding (kernel + canonical) is the right pattern for rules whose violation produces broken state, contract violations, or unsafe behavior.

When a kernel-resident rule changes, the editor updates BOTH the kernel block here AND the canonical text in the reference. The redundancy is the cost of correct behavior under context pressure.

## Reading order for new contributors

1. **This file** — orchestrator-side kernel: two valid exits, role prefixes, no-skip contract, mandatory intent declaration, modes table.
2. **`references/depth-mode-pipeline.md`** — the bulk of how standard-mode actually runs (filename preserved for historical continuity).
3. **`references/dual-stage-retry-loop.md`** — the per-journey retry-loop semantics that the per-pass pipeline drives.
4. **`references/reviewer-subagent-contract.md`** — Stage B specifics.
5. **`references/adversarial-subagent-contract.md`** — Stage A specifics for passes 4–5.
6. **`../element-interactions/references/subagent-return-schema.md`** — the return + ledger schema both stages produce.

Stage A skills (`test-composer`, `bug-discovery`) have short "Role under dual-stage" awareness paragraphs near the top of their own SKILL.md files but no dual-stage-specific rules — their behaviour is unchanged from the single-stage era; they just know they will be reviewed.

Stage A skills (`test-composer`, `bug-discovery`) have short "Role under dual-stage" awareness paragraphs near the top of their own SKILL.md files but no dual-stage-specific rules — their behaviour is unchanged from the single-stage era; they just know they will be reviewed.

### Adding a new pass type

If a future contributor needs to add (say) a Pass 6 — accessibility-specific adversarial — the seven decisions to make explicit are:

1. **Position in pipeline** — does it slot before/after existing passes, or replace one?
2. **Compositional or adversarial shape** — drives Stage A skill choice (test-composer vs bug-discovery vs new) and review_status calibration.
3. **Stage A skill** — reuse an existing one with a flag, or new skill?
4. **Commit-message template** — append to §"Commit-message conventions" with the new pass's pattern.
5. **review_status calibration** — what counts as `must-fix` for this pass's reviewer? Add to `reviewer-subagent-contract.md` §"Must-fix calibration".
6. **Ledger location** — new ledger file or shared with adversarial-findings?
7. **Re-pass triggers** — does the new pass have a re-pass equivalent? If so, add a 5th trigger to §"Re-pass mode" (or a new section).

Update the canonical schema (§1 finding-IDs, §2 status enum) only if the new pass needs a return state none of the existing ones expresses. Default position is "reuse existing return states."

### Orchestrator-side validations (single source of truth)

The orchestrator runs three grep-based validation checks. All three live here for discoverability; each links to the authoritative definition:

- **Stage A return shape** — grep per `subagent-return-schema.md` §4.1's "Finding blocks" / "covered-exhaustively returns" / "Banned tokens" / "Ledger append" bullets.
- **Stage B return shape** — grep per `subagent-return-schema.md` §4.1's "Reviewer returns (§2.4)" bullet (status enum, finding-block regex, summary-line requirement on greenlights).
- **Re-pass subagent 4-trigger format** — grep per §"Re-pass mode for compositional passes 2–3" below for the literal strings "trigger 1" through "trigger 4" plus mapping-table header and per-expectation entries. (Note: this is the dispatched-subagent's in-dispatch audit; the orchestrator-side three-trigger gating in §"Trigger-gated re-pass for Passes 2 & 3" is the pre-dispatch check, see `references/depth-mode-pipeline.md` §"Re-pass mode for compositional passes 2-3" for the explicit mapping.)

If any check fails, the orchestrator re-dispatches with a brief explicitly quoting the rejected parts. Failures consume one cycle of the 7-cycle budget. Persistent malformed returns terminate as `blocked-dispatch-failure`.

**Harness backstop.** A `PostToolUse:Agent` return-schema guard mirrors §4.1's grep checks at the harness layer, catching malformed returns the orchestrator's own grep missed. It never substitutes for the orchestrator-side check. See [`../element-interactions/references/harness-hooks.md`](../element-interactions/references/harness-hooks.md).

---

## When to Use

Activate this skill when:
- A caller asks to "increase coverage", "expand tests iteratively", or runs a deep coverage pass.
- The `onboarding` skill reaches its Phase 5.
- A sentinel-bearing `tests/e2e/docs/journey-map.md` exists.

Do NOT use this for:
- Writing tests for one journey → `test-composer`.
- Mapping or discovering journeys → `journey-mapping`.
- Broad cross-app adversarial probing outside a mapped journey — that's still `bug-discovery`. This skill's adversarial passes (4 and 5) probe inside each mapped journey's flows, not across the app as a whole.

---

## Non-negotiables for standard mode

Read these as hard rules, not guidance. They prevent the most common shortcut path — running Pass 1, silently deferring passes 2–5 + cleanup "for budget", and reporting standard mode complete anyway.

- When invoked with `mode: standard` (or with no args, since standard is the default), the orchestrator **MUST complete 3 compositional passes + 2 adversarial passes + ledger dedup, in order**. No exceptions. "Only Pass 1 ran" is never a valid completion state for standard mode. (The same five-pass contract applies under `mode: depth`, with the additional strictness that every pass dispatches per-journey instead of grouping.)
- **Pass 1 alone is NOT coverage-expansion — it is one-fifth of the pipeline.** Any progress line, summary, or upstream report that conflates "ran Pass 1" with "ran coverage-expansion" is wrong and must be corrected before returning to the caller. The same goes for "ran passes 1–3 (compositional only)" — that is three-fifths of the pipeline; the adversarial passes + cleanup are part of the contract, not optional.
- **If context budget threatens completion mid-pipeline**, the orchestrator MUST:
  1. Commit whatever the most recent pass produced (do not lose subagent work).
  2. Write state to `tests/e2e/docs/coverage-expansion-state.json` containing at minimum: the journey index (IDs, priorities, pages-touched), the set of completed passes, the set of pending journeys within any in-flight pass, and the current pass number.
  3. **STOP with a clear "resume needed" message** to the caller naming the state-file path, the passes completed, and the passes still pending. Do NOT silently skip remaining passes and claim the pipeline is done.
- **On resume**, the orchestrator reads `coverage-expansion-state.json`, verifies that each previously-reported-completed pass actually landed as a commit (not just scaffolded in state), and continues from the first incomplete pass. A pass that was marked complete in the state file but whose commit is missing from git history is treated as incomplete and re-run.
- **State-file lifecycle.** The state file is a resume marker, not a run log. On **successful completion of all five passes + cleanup**, the orchestrator MUST delete `tests/e2e/docs/coverage-expansion-state.json` as part of the cleanup commit — otherwise the next invocation will mistake a completed run for a resume. On a **fresh invocation**, if the state file is present the orchestrator treats the run as a resume and verifies commit-existence per the previous bullet; it does NOT start from scratch silently. If the file exists but references a journey-map or commit graph that no longer matches reality (e.g., the branch was rebased, or journey IDs changed), the orchestrator stops and reports the conflict to the caller rather than guessing. **Cross-phase signals belong on the workflow ledger, not here.** Questions like "is grouping permitted on this Phase-6 dispatch?" or "what mode was this run started in?" survive Phase 5 only if they are read from `tests/e2e/docs/onboarding-status.json`, which lives for the whole 8-phase pipeline. The `standard-mode-first-pass-guard.sh` hook reads `runMode` + `currentPhase` + `currentSubStage` from the workflow ledger as its primary source, and falls back to `coverage-expansion-state.json` only for bare coverage-expansion invocations outside the onboarding pipeline. Concretely: deleting `coverage-expansion-state.json` at Pass-5 cleanup does NOT silently re-enable Pass-1-strict on Phase-6 grouped probes, because the harness reads its grouping-permission state from the workflow ledger.
- **"Structural-only" / "blocked with skipped placeholder" tests** count as coverage ONLY when the blocker is a documented tenant-data or environment constraint (e.g., "requires admin seed user not present in demo tenant"). Structural-only tests MUST appear in a separate column from fully-automated tests in any coverage report — never rolled into the automated total. Structural-only tests NEVER satisfy a Pass 4 or Pass 5 adversarial-probe requirement: a skipped placeholder is not an adversarial finding, a verified boundary, or a regression test.

---

## Recursive dispatch is impossible — plan, don't fan out

Subagents in this environment **cannot** dispatch their own sub-subagents. The Agent / Task tool is parent-only; a subagent that tries to fan out hits a hard wall (`"no Agent / Task tool available in my toolset"`). This is an environment constraint the methodology must work around, not a contract a skill can amend.

**Two valid patterns** for any work that conceptually needs hierarchical dispatch:

1. **Parent dispatches the wave directly.** Each subagent does ONE focused job. The parent fans out N parallel Agents in one message. This is the default for composer / reviewer / probe waves.
2. **Sub-orchestrator returns a manifest.** When the parent's context shouldn't hold the full skill content, dispatch a sub-orchestrator subagent (`description: "process-validator-<scope>:"` or similar) with the relevant skill loaded. The sub-orchestrator **plans** the wave and **returns a structured manifest** of N briefs. The parent reads the manifest and dispatches the wave. The sub-orchestrator never tries to fire its own children.

**Anti-pattern:** a brief that asks a subagent to "dispatch N parallel subagents", "spawn workers", "fan out", or "use the Agent tool to coordinate". The harness dispatch-guard blocks these explicitly because the subagent cannot satisfy them.

**Methodology rule.** Any dispatch whose prompt asks the subagent to *be* the `coverage-expansion` orchestrator (mode: standard/depth/breadth, "fan out per journey", "you are the coverage-expansion orchestrator", "five passes") — without a leaf role-prefix on the description — is forbidden, because the wasted-subagent failure mode is otherwise unavoidable. Same applies to `onboarding` (pipeline orchestration) and `bug-discovery` at app-wide scope. (The harness dispatch-block hook that previously denied these dispatches at the boundary was retired in the 0.3.6 cleanup; the rule still applies.)

**Process-validator role** (proactive Stage B for the orchestrator's plan): before fanning out a wave of N composer / reviewer / probe subagents, the parent dispatches a `process-validator-<scope>:` subagent with the relevant skill loaded. The validator reviews the planned dispatch manifest against the skill's contract — slug convention, role-prefix consistency, journey coverage, brief minimalism — and returns `greenlight` or `improvements-needed`. Only on `greenlight` does the parent fan out the wave. Same shape as Stage B reviewer, applied one level up.

**Workflow spec.** When to invoke (wave-size ≥ 3, pass boundary, scope change, recovery-after-improvements-needed), the manifest shape (table of role-prefix / journey-id / slug / model-hint / must-fix-list summary), the validator's review checklist (slug-length, role-prefix consistency, journey coverage, brief minimalism, parallelism cap, hook-rule pre-checks, model-hint sanity, pass-boundary fit), the response shape (mirrors `subagent-return-schema.md` §2.4 reviewer-return — `greenlight` requires `summary:`, `improvements-needed` carries findings under a `findings:` array), and the parent's response handling (greenlight → dispatch unchanged; improvements-needed → revise + re-validate; 3-cycle cap before escalating to the user) are all specified end-to-end in [`references/process-validator-workflow.md`](references/process-validator-workflow.md). The harness return-schema guard enforces the `process-validator-` return shape mechanically (see [`../element-interactions/references/harness-hooks.md`](../element-interactions/references/harness-hooks.md)).

**Slug-length constraint:** the `playwright-cli` daemon binds a UNIX socket under `$TMPDIR`. On macOS the path is capped at 104 chars; slugs longer than ~28 chars push the path over the limit and the daemon silently fails to bind. The playwright-cli isolation guard enforces this at the harness layer. With the role-explicit prefix (`composer-`, `reviewer-`, `probe-` — 8–9 chars), the journey slug needs to stay short: `composer-j-<short-slug>-1-c1` (≤28 chars) fits; `composer-j-<long-slug-name>-1-c1` (>28 chars) does not. Shorten the journey slug, not the role prefix.

---

## No-skip contract

This contract closes the "scope-to-gap-journeys" loophole — an orchestrator dispatching only the journeys it judges interesting and marking the pass complete by leaving the rest unrun. It stacks on top of §"Non-negotiables for standard mode" — that section ensures all 5 passes + cleanup run; this contract ensures every pass covers every journey. Both sets of rules are hard rules, not guidance.

1. **Every journey in the map gets a dispatch every compositional pass.** Pass 2 and Pass 3's wording "re-attempt any journey where pass 1 deferred stabilization or returned coverage gaps" names ONE legitimate reason to prioritise; it does NOT authorise skipping un-gapped journeys. Scoping the dispatch to only "interesting" journeys is a shortcut and constitutes partial-pass-completion.
2. **Every journey in the map gets a dispatch every adversarial pass.** Pass 4 and Pass 5 run bug-discovery per journey — 0 journeys × Pass 4 is not Pass 4. A journey whose adversarial subagent returns "no meaningful boundaries found" must still be recorded in the ledger section with that result — the dispatch happened.

   **Pass-4 prelude — app-wide pattern scan.** Before the per-journey Pass-4 dispatches start, the orchestrator dispatches **one** `probe-app-wide:` subagent that establishes the app-wide pattern catalogue at `tests/e2e/docs/app-wide-patterns.md`. The catalogue documents recurring patterns (CSRF tamper status, autocomplete attrs, sort-unknown-field handling, response headers, error envelope shapes, asset disclosure, rate limiting, session-cookie flags) that ~80% of per-journey `info`-severity findings empirically duplicate. After the scan, every per-journey Pass-4 / Pass-5 dispatch receives the catalogue file as input and cites patterns via `coverage: app-wide:<pattern-id>` rather than re-deriving them. Full spec: [`references/app-wide-scan.md`](references/app-wide-scan.md). The scan does NOT run in `mode: breadth`.
3. **Every dispatch returns a structured result.** Options are `new-tests-landed`, `no-new-tests (exhaustively covered)`, `blocked (reason)`, or `skipped (reason + who-authorized)`. `blocked` is **subagent-returned** and does not need orchestrator or user approval — it is the subagent saying "I dispatched but cannot complete because of tenant data / environment / credential gaps" (e.g., admin seed user missing in demo tenant). `skipped` is **orchestrator-proposed** and is only valid when the orchestrator has the user's explicit in-conversation authorisation to skip that specific journey; an LLM orchestrator may not authorise itself, and the budget-pressure clause in §"Non-negotiables for standard mode" is NOT such authorisation. If the orchestrator cannot tell whether a journey should be blocked or skipped, it dispatches and lets the subagent decide — that is always the correct default.
4. **Scope compression is a caller-facing decision.** If the orchestrator determines before dispatching that a journey's Pass-N work is likely no-op, it still dispatches; if it wants to formally skip, it RETURNS TO THE CALLER with a scope-compression proposal and waits for the caller to approve. Silent scope compression is a contract violation.
5. **No-op dispatches are cheap by design.** A well-behaved test-composer subagent, given an already-exhaustive journey, returns `no-new-tests` in seconds with no test-run — there is no budget justification for scope-compression on that basis.
6. **Pass 2 and Pass 3** may record `gated_skip: true` entries in lieu of dispatch when all three orchestrator triggers are false — see §"Trigger-gated re-pass for Passes 2 & 3". Gated-skips count as `result: covered-exhaustively` for the no-skip contract; the harness validates the trigger evidence.

### Structured-return recording

Every dispatch's return goes in two places, and both are required:

- **Progress log for the current run** — a per-journey line in the caller-visible progress output, of the form `j-<slug>: <return-type> — <reason-if-any>`.
- **`coverage-expansion-state.json`** — in the per-pass record, a `dispatches` array with one entry per journey: `{ journey: "j-<slug>", result: "new-tests-landed|no-new-tests|blocked|skipped", reason: "<text or null>", authorizer: "<user|null>" }`. `authorizer` is only non-null for `skipped`.

A state file without the `dispatches` array for every pass that has run is incomplete — it cannot be used to verify the no-skip contract was honoured on resume.

### Applies to both modes

This contract applies to **both** `mode: standard` (including the `mode: depth` alias) and `mode: breadth`. Breadth mode runs one horizontal sweep across all journeys — the same no-skip rule applies per tier. An orchestrator running breadth mode that scopes Tier-1 to "only journeys with P0 priority and recent commits" is committing the same loophole; breadth mode's single sweep must still dispatch for every journey in the map, returning one of the four structured results for each.

```
❌ WRONG (compositional): "Pass 2 Wave 1 covered the 3 journeys with Pass-1 gaps; the
   remaining 41 had no map-growth so I skipped them."

✅ RIGHT (compositional): "Pass 2 dispatched test-composer for all 44 journeys in 11 waves
   of parallel dispatch (per the independence graph). 38 returned `no-new-tests`
   (exhaustive), 3 returned `new-tests-landed`, 3 returned `blocked (tenant data)`.
   Pass 2 complete."

❌ WRONG (adversarial): "Pass 4 probed the 9 journeys with state-changing APIs; the other
   35 were read-only so I didn't dispatch."

✅ RIGHT (adversarial): "Pass 4 dispatched bug-discovery for all 44 journeys. 9 returned
   verified boundaries, 28 returned `no boundaries probed — no state-changing surface in
   this journey` (recorded in the ledger per the schema), 7 returned
   `blocked (read-only journey gated by admin seed user)`. Pass 4 complete."
```

### Per-pass completion criteria — no silent compression

This subsection extends §"Per-pass completion criteria" (see below). A pass's completion criteria are NOT satisfied by covering the journeys the orchestrator judged interesting. The criteria are satisfied by covering every journey in the map, with each covered journey returning one of the four structured results above. An orchestrator that writes "41 journeys had no gaps — no-op dispatches not run" in a state file is not writing a state file, it is writing a rationalisation; the state file should say either "pass complete, N/N journeys dispatched" or "pass incomplete, N/M journeys dispatched, waiting to resume" — using the exact same wording as §"Non-negotiables for standard mode" so resume logic can key off a single shared string.

---

## Dual-stage per-pass contract

Every one of the 5 passes runs **per journey** as two sequential stages — Stage A (compose / probe) and Stage B (adversarial review). They alternate in a bounded 7-cycle retry loop until the journey reaches one of four terminal `review_status` values: `greenlight`, `blocked-cycle-stalled`, `blocked-cycle-exhausted`, or `blocked-dispatch-failure`. The full retry-loop pseudocode, termination conditions, the "fresh reviewer every cycle" invariant, and dual-stage-specific anti-rationalizations are specified in [`references/dual-stage-retry-loop.md`](references/dual-stage-retry-loop.md).

### Hard rules — kernel-resident

- **Both stages, every journey, every pass.** A `review_status` written without a Stage B dispatch having occurred is fabricated state — corrupts the state file, breaks resume, lies to telemetry.
- **Stage B is fresh-eyes per cycle.** Each cycle dispatches a new reviewer with a new context and a new `playwright-cli` session. No state carried across cycles, no inheritance from the paired Stage A. The fresh-eyes property is load-bearing — a stateful reviewer starts agreeing with Stage A.
- **Stage B never writes tests, never appends to the ledger, never modifies files.** Pure review subagent. Findings come back in the return; the orchestrator (not Stage B) decides what to do with them.
- **Cap of 7 A↔B cycles per journey per pass.** Stalled (3 consecutive identical must-fix lists OR reviewer-flagged `stalled: true`) takes precedence over exhausted when both apply on cycle 7 — different downstream signal.
- **Cycle 7 reached without greenlight → `blocked-cycle-exhausted`.** Marking it greenlit when it isn't corrupts state. `blocked-cycle-exhausted` is a valid terminal, not a pass failure.
- **Empty findings on `improvements-needed` → coerce to greenlight after one re-dispatch.** Empty findings = no changes needed; the status was malformed.
- **Pass full findings through verbatim.** Compressed findings lose the surgical specificity Stage A needs. No "summary string" inputs to the next cycle.

## Prerequisites

1. `tests/e2e/docs/journey-map.md` must exist with `<!-- journey-mapping:generated -->` on line 1. If missing, stop and invoke `journey-mapping` first.
2. The map must be in the precise-embedding format (each journey is a self-contained `### j-<slug>:` block with a `Pages touched:` line). If the map is in an older format without stable IDs, invoke `journey-mapping` to re-emit it.

---

## Mandatory intent declaration — required before any dispatch

After the state-file read (next section) and before any subagent dispatch, the orchestrator MUST emit this declaration verbatim, with the placeholders filled:

```
[coverage-expansion] Pre-flight intent declaration
  Mode: <standard | breadth>   (depth → standard alias accepted; print "(alias)" suffix if used)
  Strict-adversarial: <true | false>   (default false; opt-in via args: "strict-adversarial: true")
  Plan: dispatch every journey in `tests/e2e/docs/journey-map.md` for every required pass
        (standard = 3 compositional + 2 adversarial + cleanup; breadth = 1 sweep).
        Pass 1 strict per-journey (no [group]/[P3-batch]); Passes 2-5 may group.
  Authorisation: <full-pipeline | user-authorised-scope>
  If "user-authorised-scope":
    Scope reduction: <description, e.g. "Pass 1 only across all journeys">
    Authorising user message: "<exact verbatim quote of the user's authorising words>"
    Conversation turn of authorisation: <turn number or "this turn">
```

Rules for this declaration:

- It is emitted exactly once per invocation, before the first dispatch.
- "Authorisation: full-pipeline" is the default and requires no quote — the full pipeline is what the skill exists to run.
- "Authorisation: user-authorised-scope" requires a verbatim quote of the user's words. *Inferred* preferences ("the user clearly wants…") do not count and must not be cited. If you cannot fill in a verbatim quote, you do not have authorisation; either declare full-pipeline or stop and ask.
- Auto-mode does not satisfy "user-authorised-scope". Auto-mode authorises proceeding without confirmation on routine decisions; scope-of-pipeline is not a routine decision per §"Two valid exits".
- After the declaration is emitted, the orchestrator is bound to it. A run that declares "full-pipeline" and then runs only Pass 1 is in violation regardless of intent.

The declaration also serves as the auditable record of *why* a partial run, if any, was sanctioned. A state file showing fewer passes than the mode requires must have a corresponding `user-authorised-scope` declaration in the progress log; otherwise it documents a contract violation.

---

## Authoritative state file — read first, always

The skill's first action on entry is to read `tests/e2e/docs/coverage-expansion-state.json`. The full schema (top-level fields, per-journey `dispatches[]` entry shape including dual-stage fields, journey-roster mutability rules, and the corrupt-state-refusal protocol) is specified in [`references/state-file-schema.md`](references/state-file-schema.md). Resumption is a contract, not a convention — read it before authoring or modifying any state-file-touching code.

> **Pass transitions are now reviewer-gated (additive).** When this skill is invoked as Phase 5 of the onboarding pipeline, every Pass N → Pass N+1 transition is gated by a `workflow-reviewer-pass<N>:` subagent reading the onboarding-status ledger (`tests/e2e/docs/onboarding-status.json`). The existing `coverage-expansion-state.json` is unchanged and remains the authoritative per-pass / per-journey resume marker; the new gate is additive — the orchestrator must dispatch `workflow-reviewer-pass<N>:` between passes, and the harness `onboarding-ledger-gate.sh` denies pass-N+1 composer / probe dispatches until the prior pass's `reviewerVerdict` is `approved`. See `skills/workflow-reviewer/SKILL.md` and `skills/onboarding/SKILL.md` §"Status ledger + workflow reviewer".

### Hard rules — kernel-resident

- **Read first, before anything else.** If currentPass is set, resume from that pass; if absent or `status == "complete"`, start Pass 1 from scratch.
- **The file is authoritative.** Do not reason about "where did we leave off" from chat history, commit log, or journey-map deltas — those are diagnostic, not authoritative. If the file says currentPass=3 with 22 of 45 journeys complete, Pass 3 resumes with the remaining 23.
- **Write after every per-pass commit AND every auto-compaction trigger.** A state file written without the dual-stage fields (`stage_a_cycles`, `stage_b_cycles`, `review_status`, `final_must_fix`) is incomplete — resume cannot reconstruct mid-A↔B-cycle journeys.
- **Delete after successful 5-pass + cleanup completion.** Otherwise the next invocation mistakes a completed run for a resume.
- **Roster is frozen at the start of each pass.** Journeys discovered mid-pass go to the NEXT pass's roster, not retroactively to the current pass's. Reconciliation commits write the new roster at the same commit that appends new map blocks.
- **Missing dual-stage fields = corrupt state.** A state file lacking `stage_a_cycles`, `stage_b_cycles`, or `review_status` for any journey that ran this pass is corrupt — stop and report; never silently proceed.
- **Corrupt-state stops the run.** Self-repair is out of scope — surface the mismatch to the caller. State referencing journeys not in `journey-map.md`, or `completedJourneys` ⊋ `journeyRoster`, both qualify.

## Modes

| Mode | Invocation | Behaviour |
|---|---|---|
| `mode: standard` (default) | `args: "mode: standard"` or no args | Five passes + cleanup, journey-by-journey in priority order, parallel where independent. Passes 1–3 are compositional; passes 4–5 are adversarial. Final cleanup dedupes the adversarial findings ledger. **Pass 1 is strict per-journey parallel** (no `[group]`, no `[P3-batch]`); Passes 2-5 may use grouping per the documented batching paths. The strict-per-journey contract on Passes 4 and 5 becomes an opt-in via `args: "strict-adversarial: true"`. The state file is written with `runMode: "standard"` on the first state-file write. |
| `mode: depth` (strict-parallel-everywhere) | `args: "mode: depth"` | Strict per-journey parallel on **every** pass — `[group]` and `[P3-batch]` markers are FORBIDDEN across all 5 passes (Passes 1, 2, 3, 4, AND 5). Adversarial Passes 4-5 are strict-per-journey by default (the `strict-adversarial: true` opt-in is implicit under depth — explicit declaration is a no-op since the strict contract already holds). The state file is written with `runMode: "depth"` on the first state-file write; the `standard-mode-first-pass-guard.sh` hook reads the field and denies grouping dispatches on every pass. **Cost:** up to ~20× more subagent dispatches and token spend than `mode: standard`. Best for high-stakes audits, package-quality benchmarks, and first-time onboarding of business-critical apps where you want exhaustive per-unit fidelity. |
| `mode: breadth` | `args: "mode: breadth"` | One horizontal sweep: priority × depth tiers across all journeys. Fast fallback for quick coverage growth. Adversarial passes do NOT run in breadth mode. Unchanged. |

---

## Standard mode — five-pass pipeline (3 compositional + 2 adversarial) + cleanup

Standard mode is the default for non-quick-pass coverage growth. Pass 1 fidelity is preserved by the strict-first-pass rule and Pass 2-5 efficiency is preserved by relaxed grouping. The `depth` mode below offers a strict-parallel-everywhere variant for cases where per-unit fidelity matters more than dispatch cost.

### Depth mode — strict-parallel-everywhere (first-class)

`mode: depth` selects the strict-parallel contract on **every** pass of the five-pass pipeline. The pass-by-pass execution shape is identical to standard mode (three compositional passes + two adversarial passes + ledger dedup); the difference is purely the dispatch-shape contract:

- **No grouping anywhere.** `[group]` and `[P3-batch]` markers are FORBIDDEN on Passes 1, 2, 3, 4, AND 5 — every Stage A composer/probe dispatch is per-journey, in parallel waves up to the host-max cap.
- **Adversarial Passes 4-5 strict by default.** The `strict-adversarial: true` opt-in described in §"Adversarial grouping for Passes 4 and 5" is implicit under depth mode; the per-journey contract already holds, so explicit declaration is a no-op.
- **State-file marker.** The orchestrator writes `"runMode": "depth"` into `tests/e2e/docs/coverage-expansion-state.json` on the first state-file write. The `standard-mode-first-pass-guard.sh` hook reads this field and denies any `[group]` / `[P3-batch]` dispatch on any pass when the mode is `depth`.
- **Cost.** Up to ~20× more subagent dispatches and token spend than `mode: standard`. The orchestrator emits one `[coverage-expansion] mode: depth — strict-per-journey on every pass (~20× cost vs standard)` declaration line on entry so the operator sees the trade-off acknowledged.
- **Pipeline shape unchanged.** All other pipeline rules (5-passes-+-cleanup, per-pass dedup, no-skip contract, hybrid model selection, auto-compaction, P3 adversarial opt-out, gated-skip logic for Passes 2-3) hold identically under both modes.

When to pick depth: high-stakes audits, package-quality benchmarks, first-time onboarding of business-critical apps where exhaustive per-unit fidelity matters more than token efficiency.

The full per-pass pipeline (steps 1–8), pass differences, commit-message conventions, per-pass completion criteria, the whole-suite re-run gate (incl. the harness-enforced windowed ratchet), the parallelism model, model selection (hybrid; opus where it pays), auto-compaction between passes, re-pass mode for compositional passes 2–3, batched dispatch for P3 peripheral journeys, adversarial grouping for Passes 4-5, and the post-pass-5 ledger dedup are specified in [`references/depth-mode-pipeline.md`](references/depth-mode-pipeline.md). Read it before authoring or modifying any standard-mode pass.

### Hard rules — kernel-resident

- **Five passes + per-pass dedup + cross-pass cleanup, in order, every run.** Three compositional (1–3) + two adversarial (4–5). Each pass ends with a single per-pass dedup subagent (test dedup for compositional, findings dedup for adversarial). After pass 5, one additional cross-pass cleanup subagent runs to synthesise cross-cutting findings. "Pass 1 only" is one-fifth of the pipeline, never a valid completion state for `mode: standard` (or the `mode: depth` alias). A pass is incomplete until its per-pass dedup commit lands (with empty diff + a "no consolidation" log entry if nothing was merged — silent skipping is forbidden).
- **Every journey, every pass.** Pass N is complete only when every journey in the map has been dispatched AND returned. Not "enough journeys", not "the P0/P1 tier", not "the journeys that fit the budget" — every journey. Pass 4 with 0 journeys is not Pass 4.
- **One journey per commit, per pass kind.** Commit-message templates are fixed per pass (`test(<j-slug>)`, `docs(ledger): <j-slug> — …`, `test(<j-slug>-regression)`, `docs(ledger): dedupe cross-cutting findings`). Agents MUST NOT reinvent the format — the git log has to be filterable by `<j-slug>` and pass kind.
- **Stage B never commits.** Reviewer judgements live in the state file's `review_status` and `final_must_fix` fields, never as commits. `review(j-…)` and any review-tagged commit form is forbidden.
- **Stage A and B are parallel by default.** A journey's Stage B fires as soon as that journey's Stage A returns and the cap has a slot — not after every Stage A in the pass completes. Finishing all Stage A first then starting all Stage B is contract-violating.
- **Parallel cap counts A and B jointly.** One pool of in-flight slots; A, B, and A-retry compete. A journey's own A and B never overlap (sequential within a journey); across journeys any A/B interleaving is possible. Queue order is FIFO.
- **Hybrid model selection — Pass 1, Pass 4, Pass 5 on Opus, Pass 2/3 execution on Sonnet, all review on Opus.** Empirical data from a 30-journey onboarding cycle showed Sonnet/Opus parity on adversarial probes for the categories observed in that cycle. The hybrid policy nonetheless keeps Pass 4 on Opus: Pass 4's findings feed Pass 5's regression layer, and probe-depth quality at the Pass 4 boundary determines what gets locked in downstream — the cost delta does not justify trading away regression-input quality. Pass 1 establishes the test foundation and runs Opus throughout (composer + reviewer); Pass 5 produces the regression layer that locks in verified boundaries — the durable artifact that catches future regressions — and runs Opus throughout (gap analysis, targeted probes, regression-test authoring). Sonnet is reserved for the mechanical re-pass composers in Passes 2 and 3, where the bulk of journeys return `covered-exhaustively` and the work is by definition incremental. Batched review keeps Opus reviewers affordable: one Opus reviewer cross-synthesises N journeys' worth of evidence, replacing N per-journey reviewers. Per-journey Stage B in passes 2-5 also stays on Opus while batching ramps — review judgement is the quality boundary the rest of the pipeline relies on. Default by dispatch type:

  | Dispatch type | Model | Rationale |
  |---|---|---|
  | Pass 1 Stage A composer | **opus** | Test architecture quality; Pass 1 sets the foundation for the suite |
  | Pass 1 Stage B reviewer | **opus** | Foundation review; quality bar set here propagates downstream |
  | Pass 2 Stage A composer (re-pass) | **sonnet** | 22 of 30 return `covered-exhaustively`; mechanical |
  | Pass 3 Stage A composer (re-pass) | **sonnet** | Same; final compositional sweep |
  | Pass 4 Stage A probe (adversarial) | **opus** | Findings feed Pass 5's regression layer; probe-depth quality at the boundary determines what gets locked in downstream |
  | Pass 5 gap analysis | **opus** | Cross-journey synthesis (orchestrator-level, not per-journey) |
  | Pass 5 targeted probes | **opus** | Regression layer is the durable artifact; quality at probe time determines what gets locked in |
  | Pass 5 regression-test authoring | **opus** | Same — assertion shape + edge nuance in regression tests propagates forward indefinitely |
  | Stage B reviewer — per-journey (passes 2-5) | **opus** | Review judgement boundary; per-journey while batching ramps |
  | Stage B batch reviewer (when used) | **opus** | Cross-journey synthesis is where Opus shines |
  | Cleanup ledger dedup | **opus** | Semantic clustering quality matters |
  | Phase 7 deck / report | **opus** | Client-facing narrative quality |
  | Failure-diagnosis | **opus** | Root-cause reasoning depth |

  The orchestrator passes the model hint via `model: <opus|sonnet|haiku>` in the dispatch brief. Subagents honour the hint when constructing their `subagent_type` — `general-purpose-sonnet` / `general-purpose-opus` etc., or whatever the harness exposes.

  **Override paths:**
  - The user may request Opus for everything (e.g. `mode: standard, model: opus-all`) for a high-stakes audit; document the override in the front-load gate.
  - A pass with `final_must_fix` carry-overs from the prior pass forces that journey's next Stage A composer onto Opus regardless of the table (the must-fix is hard; a mechanical Sonnet re-pass won't resolve it). Note this override is now scoped to Pass 2/3 Stage A composers — Stage B reviewers (per-journey and batch) are Opus by default, so no review-side override is required.

  This section supersedes the prior "cost-blind, opus-default" rule. The change is empirically grounded for execution-side dispatches: the Pass 2 and Pass 3 re-pass composers drop to Sonnet because the work is mechanical (the majority of journeys return `covered-exhaustively`). Pass 4 stays on Opus despite the observed Sonnet/Opus parity on adversarial probes — the parity covered the probe categories surfaced in that one cycle, and Pass 4's findings are the input to Pass 5's regression layer; probe-depth quality at that boundary determines what gets locked in. Review judgement stays on Opus across all passes — per-journey while batching ramps, and at the batch reviewer once batching is in steady state.
- **Pass 1 strict per-journey, no grouping (standard) / every pass strict (depth).** Under `mode: standard`, `[group]` and `[P3-batch]` markers are FORBIDDEN on Pass 1 only; once Pass 1 has landed the baseline at maximum quality, Passes 2-5 may relax (subject to the documented grouping paths). Under `mode: depth`, `[group]` and `[P3-batch]` markers are FORBIDDEN on **every** pass (1, 2, 3, 4, AND 5) — strict-per-journey holds throughout the pipeline, and adversarial Passes 4-5 are strict-per-journey by default (the `strict-adversarial: true` opt-in is implicit). Hook-denied: the `standard-mode-first-pass-guard.sh` hook reads `runMode` + `currentPhase` + `currentSubStage` from the workflow ledger `tests/e2e/docs/onboarding-status.json` (default `"standard"` when absent, with `coverage-expansion-state.json` as a fallback for bare invocations outside onboarding) and denies grouping per-pass according to mode. The strict-on-first-pass rule (standard) captures the fidelity moment where it pays the most; the strict-on-every-pass rule (depth) captures the ~20×-cost exhaustive-fidelity contract for high-stakes audits.
- **Stage A always per-journey on Pass 1; Passes 2-5 may use grouping per the documented batching paths: (a) the P3-batch ≤7 path for shared-project P3 peripherals (`[P3-batch]` marker); (b) the relevance-group ≤7 path for compositional Passes 2-3 when a priority tier has >5 journeys (`[group]` marker, all priorities eligible); (c) the adversarial-group ≤7 path for Passes 4-5 (`[group]` marker, all priorities eligible). Stage B per-journey except the documented compositional-cycle-1 batch-reviewer exception (one reviewer per pass; never adversarial; never cycle-2+).** P0/P1/P2 NEVER use the P3-batch Stage A exception — P3-only path, capped at 7 per brief; sharing pages with P3 siblings is not authorisation for the P3-batch path, priority is load-bearing. The relevance-group + adversarial-group paths apply to ALL priorities (P0/P1/P2/P3) once their trigger conditions hold; groups must be priority-pure (no mixing of tiers) and capped at 7. Adversarial Passes 4-5 grouping is the default for `mode: standard`; the per-journey contract becomes an opt-in via `args: "strict-adversarial: true"`. Cycle-2+ ALWAYS uses per-journey reviewers regardless of pass — by cycle 2 the orchestrator already knows which journeys need attention.
- **P3 small-surface journeys may opt OUT of adversarial passes (Passes 4 & 5).** P3 logout / role-chooser / modal-only journeys empirically produce 0–2 unique adversarial findings each — their entire adversarial surface is already covered via app-wide pattern citations from larger journeys. The skip is **opt-in per project**, declared up-front in the state file's `adversarialSkippedJourneys: []` field with rationale per entry. Default is "include all" — the orchestrator never silently skips a P3 from adversarial work; the operator opts the journey out by name. Compositional passes (1–3) ALWAYS run on every journey including P3. **Exclusion criteria** (must hold for a journey to qualify for opt-out):
  - Priority is P3.
  - The journey's `Pages touched` list is a subset of pages already adversarial-probed by a larger journey AND covered by a app-wide pattern entry.
  - The journey has zero unique adversarial findings in any prior pass-4 ledger entry (or has no prior entries).
  - The journey is one of: logout, role-chooser, single-modal disclosure, single-info-display, breadcrumb-nav, or equivalent low-surface shape.

  Any opt-out that doesn't meet ALL four criteria is silent scope narrowing. The state-file schema validates the field shape (per `references/state-file-schema.md`).
- **Auto-compaction at 70%.** State written first, then `/compact`, then resume from state. Mid-cycle Stage A returns persist to a scratch file (`tests/e2e/docs/.coverage-expansion-cycle-<slug>-cycle-<N>.json`) before compacting; mid-cycle restart from a fresh Stage A dispatch is NOT acceptable.
- **`blocked-cycle-stalled`, `blocked-cycle-exhausted`, `blocked-dispatch-failure` are valid terminals**, not pass failures. Mark them faithfully — calling cycle-7-exhausted "greenlit" corrupts the state file and the next pass's trigger-4 input.

### Trigger-gated re-pass for Passes 2 & 3

Pass 2 and Pass 3 are **conditional** on per-journey triggers checked at the orchestrator level. Empirically, 22 of 30 Pass-2 dispatches and 21 of 30 Pass-3 dispatches return `covered-exhaustively` — the subagent loaded full context just to confirm "no work needed." The orchestrator can make that decision in three checks, saving ~3.5M tokens per cycle.

**Per-journey triggers (orchestrator checks before dispatching):**

1. **Map-delta** — has the journey's block in `tests/e2e/docs/journey-map.md` changed since Pass 1's reconciliation commit? Compute via `git diff <pass-1-commit> -- tests/e2e/docs/journey-map.md` filtered to the journey's section.
2. **Sibling-ledger update** — does any finding added to `tests/e2e/docs/adversarial-findings.md` since Pass 1 list this journey as a regression candidate? When the finding schema supports cross-references, read those; otherwise substring-search the journey ID in ledger entries since the Pass-1 commit.
3. **Must-fix carry-over** — does the prior pass's `dispatches[journey == this].final_must_fix` array in `coverage-expansion-state.json` carry any unresolved finding-IDs for this journey? Read directly from the state file.

**If ALL THREE are false → write a gated-skip entry; do NOT dispatch:**

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

**If ANY trigger fires → dispatch test-composer normally**, with the trigger evidence in the brief (the relevant journey-map diff, the sibling finding-IDs, the carry-over must-fix list). The dispatched subagent runs the full re-pass discipline per `references/depth-mode-pipeline.md` §"Re-pass mode for compositional passes 2–3".

**Contract:**
- The orchestrator MUST record `triggers_checked` with all three booleans for every gated-skip entry. A skip without that evidence is silent scope narrowing. (The harness schema guard that previously denied such writes was retired in the 0.3.6 cleanup; the rule still applies.)
- A gated-skip entry with any trigger == true is a contract violation (the orchestrator should have dispatched).
- Gated-skip entries count as "work done" for the §"Two valid exits" pre-emptive-stop check — a Pass 2 with all 30 journeys gated-skipped is legitimately complete.
- This rule applies to **Passes 2 and 3 only**. Pass 1 dispatches every journey unconditionally; Passes 4 and 5 remain dispatch-driven (the adversarial discipline is empirically valuable, not redundant).
- The orchestrator never inferentially batches gated skips into one entry — one entry per journey, with that journey's three triggers explicitly checked.

The §"Re-pass mode for compositional passes 2–3" reference (depth-mode-pipeline.md) describes the dispatched-path's brief contents and rejection rules. Trigger-gating sits ABOVE that — only when at least one trigger fires does the dispatched-path apply.

### Adversarial grouping for Passes 4 and 5

**Default for `mode: standard`: `[group]` cap-7 permitted for adversarial Passes 4 and 5.** The prior "adversarial passes never batch" rule is relaxed. Empirical rationale: adversarial findings cluster by app-wide pattern (see `references/app-wide-scan.md`'s catalogue). Once the Pass-4 prelude has emitted `tests/e2e/docs/app-wide-patterns.md`, ~80% of per-journey `info`-severity findings duplicate the catalogue entries — per-journey isolation over-pays for that majority. Grouped probes share the catalogue brief and surface per-journey unique findings against it.

**Opt-in strictness.** A caller that needs per-journey isolation on the adversarial layer (regulated audit, high-risk domain, baseline-quality establishment) opts back into the per-journey contract via `args: "strict-adversarial: true"`. When set, `[group]` is forbidden on Passes 4 and 5 just as it is on Pass 1; the orchestrator emits a `[coverage-expansion] strict-adversarial: true — Pass 4/5 per-journey` declaration line. The `standard-mode-first-pass-guard.sh` hook does NOT deny adversarial `[group]` dispatches by default — that gate is Pass-1-only.

**Group composition rules** (same shape as compositional `[group]`, with the priority-pure relaxation for adversarial probes):
- **Cap 7.** Maximum 7 journeys per group. A tier of 28 journeys becomes ⌈28/7⌉ = 4 groups.
- **All priorities eligible.** P0/P1/P2/P3 all qualify once any tier crosses the >5 threshold.
- **Same-section preferred.** Group by section or overlapping `Pages touched`; cross-section grouping is allowed when section clusters are sparse.
- **`adversarialSkippedJourneys[]` honoured.** Opted-out P3 journeys (per §"Hard rules — kernel-resident" on P3 small-surface opt-out) are excluded from group composition.
- **Role-prefix:** `[group] probe-j-<a>,probe-j-<b>,...:`. Items use `probe-j-` (not `composer-j-`) — adversarial probes return Stage A finding shape + ledger appends per `references/adversarial-subagent-contract.md`.
- **Stage B remains per-journey** within a Pass-4/5 group — the cycle-1 batch-reviewer exception is compositional-only and does NOT extend to adversarial passes.

**Quality safeguard.** Same attention-rationing trend trigger as the compositional `[group]`: if ≥3 of 7 per-journey Stage B reviews in one adversarial group return `improvements-needed` for missed adversarial categories, the orchestrator stops grouping for the remainder of that pass and falls back to per-journey adversarial dispatch. Persistent rationing across multiple groups within a pass forces strict-adversarial mode for the next pass.

## Breadth mode — one horizontal sweep

For the quick-pass use case, run one invocation per priority tier. No journey-by-journey iteration; no parallel dispatch per journey (the sweep itself is serial). Standard mode (formerly `depth`) remains the default.

Sweep order (one commit per tier):

1. `priority=P0 depth=happy-path,error-states,edge-cases,mobile`
2. `priority=P1 depth=happy-path,error-states`
3. `priority=P2 depth=happy-path`
4. `priority=P3 depth=smoke`

In breadth mode, the legacy `passScope` shape may be passed through to `test-composer` (which still accepts it for backward compatibility).

---

## Isolated subagent contract

Every subagent dispatched by this skill — compositional `test-composer`, adversarial probe, Stage B reviewer, post-pass-5 cleanup — runs against an isolation contract. Full per-role detail in [`references/subagent-isolation.md`](references/subagent-isolation.md).

### Hard rules — kernel-resident

- **Every subagent has an isolated context window.** No prior session content, no other journey's data, no orchestrator scratch.
- **Every browser-using subagent has its own `playwright-cli` session** named per the role-prefix convention (`composer-j-<slug>-<pass>-c<N>`, `reviewer-j-<slug>-<pass>-c<N>`, `probe-j-<slug>-<pass>`, `cleanup-<scope>`). Sessions are OS-isolated; the subagent opens at start and closes at end.
- **The orchestrator NEVER holds subagent payload content.** Not in steady state, not at dispatch boundaries, not during reconciliation. Forbidden in orchestrator context: full journey blocks (only the indexed fields), DOM snapshots, test source, stabilization transcripts, ledger bodies — modulo the **single bounded exception**: when dispatching a pass-5 subagent, the orchestrator reads that journey's pass-4 ledger section into the brief and releases it from context immediately after dispatch.
- **Returns are structured summaries only.** No pasted test source, no DOM snapshots, no CLI transcripts. All returns conform to `subagent-return-schema.md` and are validated at the harness layer (see [`../element-interactions/references/harness-hooks.md`](../element-interactions/references/harness-hooks.md)).

## Progress output

Emit one line per significant event, prefixed `[coverage-expansion]`:

```
[coverage-expansion] Pass 1/5 starting — 14 journeys mapped (3 P0, 6 P1, 4 P2, 1 P3), dual-stage A↔B
[coverage-expansion] Pass 1/5 — dispatching 4 parallel A↔B pipelines for j-book-demo, j-reset-password, j-browse-catalog, j-view-pricing
[coverage-expansion] Pass 1/5, journey j-book-demo: cycle 1/7, review greenlight (6 tests added)
[coverage-expansion] Pass 1/5, journey j-reset-password: cycle 2/7, review greenlight (1 retry — mobile variant added per Stage B)
[coverage-expansion] Pass 1/5, journey j-browse-catalog: cycle 1/7, review greenlight
[coverage-expansion] Pass 1/5, journey j-view-pricing: cycle 7/7, review blocked-cycle-exhausted (2 must-fix unresolved — fires Pass 2 must_fix_carry_over trigger / subagent trigger 4)
[coverage-expansion] Pass 1/5 complete — 27 tests added, 3 branches discovered, 1 journey blocked-cycle-exhausted, committed
[coverage-expansion] Pass 2/5 starting — 15 journeys (1 sub-journey promoted), dual-stage A↔B
[coverage-expansion] Pass 2/5, journey j-create-user: gated-skip (no triggers fired — map_delta:false, sibling_ledger_update:false, must_fix_carry_over:false)
...
[coverage-expansion] Pass 3/5 complete — total 68 tests added across three compositional passes, all journeys greenlit
[coverage-expansion] Pass 4/5 starting — adversarial probing for 15 journeys, dual-stage A↔B
[coverage-expansion] Pass 4/5, journey j-returning-user-checkout: cycle 1/7, review improvements-needed (1 adversarial-missed)
[coverage-expansion] Pass 4/5, journey j-returning-user-checkout: cycle 2/7, review greenlight (12 probes, 8 boundaries, 1 high-severity suspected bug)
...
[coverage-expansion] Pass 4/5 complete — 216 probes, 147 boundaries verified, 9 suspected bugs (3 high, 5 medium, 1 low), all journeys greenlit
[coverage-expansion] Pass 5/5 starting — adversarial consolidation + regression authoring, dual-stage A↔B
[coverage-expansion] Pass 5/5 complete — 54 regression tests added, 11 new findings, all committed
[coverage-expansion] Cleanup — 7 cross-cutting findings consolidated across 18 journey sections
[coverage-expansion] Depth run complete — 5 passes + cleanup, 122 tests + 54 regression tests, ledger at tests/e2e/docs/adversarial-findings.md
```

The `Pass <N>/5, journey j-<slug>: cycle <c>/7, review <status>` per-cycle line is the user-facing visibility into the dual-stage retry loop. Emit one such line whenever a journey's A↔B cycle terminates (greenlight / blocked-cycle-stalled / blocked-cycle-exhausted / blocked-dispatch-failure). Skip per-cycle lines for cycles that complete with `improvements-needed` and trigger an immediate retry — only emit on terminal states or notable retries (cycle ≥ 2).

---

## Orchestrator context budget

Hold in context:
- Journey map **index only** (IDs, names, priorities, `Pages touched`, `Test expectations`). Never the full step lists, branches, or state variations.
- Independence graph (ids + edges).
- Pass counter, subagent dispatch roster, aggregated return summaries.
- **Adversarial totals counter** (passes 4–5): journeys probed, boundaries verified across all journeys, suspected-bug count by severity, regression tests added. Counts only — never per-finding detail.

Never hold in context:
- Any journey's full `### j-<slug>` block contents beyond the indexed fields.
- Any DOM snapshot from the live `playwright-cli` session.
- Any test source composed by a subagent.
- Any stabilization transcript.
- Any adversarial-findings ledger content beyond the one-journey exception documented below.

One bounded exception for pass 5: when dispatching a pass-5 subagent, the orchestrator does read the journey's pass-4 ledger section from the ledger file and pass it along as an input. This is strictly bounded to one journey's section for one subagent; the orchestrator releases it from context as soon as the dispatch is sent.

If orchestrator context approaches a budget boundary, follow the auto-compaction flow in §"Auto-compaction between passes". The authoritative state file is `tests/e2e/docs/coverage-expansion-state.json` (see §"Authoritative state file — read first, always"); resumption on any subsequent invocation is driven from that file.

### Hard rules — kernel-resident

- **The orchestrator does NOT compose tests directly.** Spec writes for `tests/e2e/j-<slug>.spec.ts` and `tests/e2e/sj-<slug>.spec.ts` (and their `-regression` variants) come from a dispatched `composer-j-<slug>:` / `composer-sj-<slug>:` / `probe-j-<slug>:` subagent — never from direct orchestrator action. Harness-enforced as a hard DENY by a `PostToolUse:Write|Edit` direct-compose block, paired with the `PreToolUse:Agent` dispatch-guard's in-flight registry of legitimate composer/probe slugs. `tests/e2e/happy-path.spec.ts` is exempt (Phase 3 of onboarding writes it before coverage-expansion's Pass 1). See [`../element-interactions/references/harness-hooks.md`](../element-interactions/references/harness-hooks.md).

  **Handover envelope (shorter leash than the registry TTL).** The registry TTL is a failsafe for crashed / abandoned dispatches. The primary cleanup path is the §2.0 handover envelope in [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md): every composer / reviewer / probe / process-validator / phase-validator return MUST be prefaced with `handover: { role, cycle, status, next-action }`. The harness return-schema guard reads the envelope and deregisters composer + probe slots immediately on terminal status — the registry slot clears as soon as the subagent hands over. Cycle-mismatch refuses to deregister and emits a fix-message. Reviewer / process-validator / phase-validator handovers carry the envelope for orchestrator-side `next-action` routing but have no harness-side registry effect. See [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md) §2.0 + §4.3.

  **Reviewer spillover contract (hard enforcement, scoped to `improvements-needed`).** A reviewer's `improvements-needed` return has historically carried the full `missing-scenarios:` / `craft-issues:` / `verification-misses:` sub-lists with all sub-bullets in the body — typically 1-3k tokens of structured detail absorbed into the orchestrator's transcript every cycle. Per [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md) §2.6, the reviewer writes that detail to a canonical spill file at `tests/e2e/docs/.subagent-returns/reviewer-<journey>-<pass>-c<cycle>.md` and emits only the index-level fields (`status`, `journey`, `pass`, `cycle`, `spill:` pointer, `findings:` ID list) inline. Hard-enforced via a `SubagentStop` rewrite-gate that blocks non-compliant returns and injects in-session feedback until the body conforms; the `PostToolUse:Agent` schema-guard adds a defense-in-depth WARN. The orchestrator constructs the next composer-cycle brief by referencing the spill-file path; it MUST NOT inline the spill contents. Composer briefs / probe briefs / phase-validator briefs are not yet under spillover — extension follows after this initial rollout produces real-world compliance data.
- **The orchestrator does NOT run `playwright-cli` for selector inspection.** The CLI session belongs to the dispatched subagent (its slug carries the subagent's role prefix — see §"Role prefixes"). Orchestrator-side `playwright-cli` use during coverage-expansion is a discipline violation: it pulls DOM snapshots into the orchestrator's context. Harness-enforced as a hard DENY at the `Bash` boundary against the in-flight registry; session-agnostic subcommands and dispatched-subagent sessions pass through. Redirect points the orchestrator to dispatch a `stage2-<scope>:` / `probe-j-<slug>:` / `composer-j-<slug>:` subagent. See [`../element-interactions/references/harness-hooks.md`](../element-interactions/references/harness-hooks.md).
- **The orchestrator does NOT run `npx playwright test` for stabilization.** Stabilization happens inside the composer subagent's loop, with the result captured in the structured return. The orchestrator-level test run is the **whole-suite re-run gate** at pass exit, not per-spec stabilization.
- **If parallel composer dispatch feels unsafe (e.g., shared-DB races), the fix is the per-test-user pattern**, not "absorb the composer work serially". See `../element-interactions/references/test-optimization.md` §1.A. The onboarding shared-resource audit's `global-reset:cross-test-race` tag is the trigger for §1.A.

---

## Integration with other skills

- **`journey-mapping`** — produces the precisely-embeddable journey map this skill reads. Map must be sentinel-bearing. No schema change required for adversarial passes.
- **`test-composer`** — called once per journey per compositional pass (1–3) with `args: "journey=<j-id>"`. Owns compose, stabilize, API compliance, coverage verification. NOT called during adversarial passes.
- **`bug-discovery`** — invoked from **inside** each adversarial-pass subagent, scoped to one journey. No change to the skill itself; it accepts a scoped invocation. Subagents decide probe-category selection autonomously based on live observation.
- **`failure-diagnosis`** — invoked inside any subagent (compositional or adversarial) when stabilization fails. The orchestrator does not call it directly.
- **`onboarding`** — calls this skill as its Phase 5 with `mode: standard` (default, recommended) OR `mode: depth` (strict-parallel-everywhere, ~20× more dispatches) depending on the operator's front-load gate selection (see `skills/onboarding/SKILL.md` §"Step 0 — Mode selection"). Onboarding writes the chosen mode into `coverage-expansion-state.json` as `runMode` on the first state-file write so the hook layer can enforce the depth-mode strict-everywhere semantics. Phase 5 now produces adversarial-findings as a side effect. Onboarding's Phase 6 (standalone `bug-discovery`) remains in place as a wider, cross-app adversarial sweep; per-journey adversarial coverage is handled earlier inside Phase 5.

---

## Non-goals

- Mapping new journeys from scratch — that's `journey-mapping`.
- Composing a single journey's tests — that's `test-composer`.
- Cross-application coverage — one invocation covers one app.
- Running adversarial probing in breadth mode. Breadth stays one horizontal sweep; users who want adversarial coverage explicitly want standard (formerly `depth`) mode.
- Writing regression tests for findings classified as `Suspected bugs` or `Ambiguous`. Never lock buggy behavior into a passing suite. Never use `test.fail()` markers — they rot into permanent CI noise.
- Growing the journey map during adversarial passes. Map growth is for compositional passes only.
- Broad cross-app adversarial sweeps — that's still the job of the standalone `bug-discovery` skill. This skill's adversarial passes are strictly per-journey.
