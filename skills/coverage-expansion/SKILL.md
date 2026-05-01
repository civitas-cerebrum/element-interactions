---
name: coverage-expansion
description: >
  Iteratively expand E2E test coverage across an entire mapped application. Owns
  priority ordering, journey-by-journey iteration, parallel dispatch for
  independent journeys, model selection per journey size, and map reconciliation
  between passes. Calls the test-composer skill per journey for compositional
  passes and invokes bug-discovery per journey for adversarial passes; does not
  compose tests itself. Runs in two modes: `breadth` (one horizontal sweep,
  fast) or `depth` (three compositional passes + two adversarial passes +
  ledger dedup, journey-by-journey, default). Triggers on "increase coverage",
  "expand tests", "iterative coverage", "deep coverage pass", and when invoked
  by the onboarding skill as its Phase 5.
---

# Coverage Expansion — Iterative Journey-by-Journey Test Growth

> **Skill names: see `../element-interactions/references/skill-registry.md`.** Copy skill names from the registry verbatim. Never reconstruct a skill name from memory or recase it.

The orchestrator for coverage growth. Iterates the user journey map, dispatches `test-composer` per journey for compositional passes, dispatches adversarial-probe subagents per journey for adversarial passes, and merges map discoveries between journeys. Depth mode runs 3 compositional passes + 2 adversarial passes + one cleanup/dedup step. Breadth mode runs one sweep.

**Context discipline:** this skill holds only the map index (IDs, names, priorities, `Pages touched`), the independence graph, and the pass counter. All journey-level reasoning happens inside dispatched subagents with isolated context windows.

**Canonical return + ledger schema:** every subagent dispatched by this skill — compositional (`test-composer`) or adversarial — returns findings and writes ledger entries against the canonical schema in [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md). Dispatch briefs include a pointer to that file; the schema is never re-pasted. Key points:

- Finding-IDs use `<journey-slug>-<pass>-<nn>` inside Passes 1–5. Severities are `critical | high | medium | low | info`.
- `status: covered-exhaustively` requires a per-expectation mapping table. `status: no-new-tests-by-rationalisation` is **not a valid return** from any pass and is treated as a contract violation — the orchestrator re-dispatches with a stricter brief.
- Adversarial ledger appends (`tests/e2e/docs/adversarial-findings.md`) MUST validate against the ledger schema in §3 of the reference file before releasing the lockfile.

---

## Two valid exits — read this before anything else

There are exactly two ways for a coverage-expansion run to terminate:

1. **All 5 passes + cleanup complete** for `mode: depth` (or the one breadth sweep complete for `mode: breadth`), with every journey dispatched in every pass.
2. **Commit-what-landed + write `coverage-expansion-state.json` + stop with an explicit "resume needed" message** naming the completed passes, the in-flight pass, and the pending journeys.

There is no third exit. Any framing that implies "partial run, but reasonable" — *"pragmatic Pass 1"*, *"honest Pass 1 only"*, *"most of the work done"*, *"deferred Passes 2–5 to a follow-up"*, *"reduced scope given session constraints"* — is the contract violation this skill exists to prevent. Tone does not change the contract: a "transparent" scope reduction is still a scope reduction, and silent scope reduction dressed in candid language is still silent scope reduction.

If you are about to dispatch fewer passes than the mode requires, or fewer journeys than the map contains, you must EITHER (a) have explicit user authorisation in this conversation naming the reduction, OR (b) take exit #2 above. Self-authorisation is not authorisation. Auto-mode is not authorisation. Inferred user preference is not authorisation. Estimated session length is not authorisation.

### Reviewer parallelism is non-negotiable

Stage B reviewers run **at host max parallelism**, not one at a time. A pass with 16 journeys dispatches up to 16 reviewers in one parallel wave (subject to the shared-resource audit's credential caps — see §"Parallel cap — lifted and jointly applied"). Reviewer dispatch is NOT a serialised cost.

The contract:
- **Per-journey**: each reviewer reads ONE journey's spec + journey block + live app (Stage B is never batched).
- **Across journeys**: dispatched in parallel up to the host-max cap, sharing the same in-flight pool with Stage A retries.
- **Within a journey**: Stage A and Stage B are sequential (a journey's own A and B never overlap), but its B can run while a sibling journey's A is in flight.

If you are about to stop after Stage A claiming "running 16 reviewers is too much for this session" — re-read this section. 16 reviewers in parallel is one wave. The wave is the contract.

See §"Parallelism — Intra-group pipelining (dual-stage)" for the full pipelining model.

---

### Stage A per-journey dispatch is non-negotiable

Stage A composers also run **one subagent per journey, in parallel up to host max**. A pass with 16 journeys dispatches up to 16 Stage A subagents in one parallel wave. Stage A is **not** "4 group agents each covering 4 journeys sequentially" — that is batched grouping, not per-journey dispatch, and it is forbidden for P0/P1/P2.

The contract:
- **Per-journey**: each Stage A subagent owns ONE journey's brief, ONE journey's `playwright-cli` session slug, and produces ONE journey's commit(s). The journey block + its referenced sub-journeys are the brief; sibling journeys are not in scope for that subagent.
- **P3 batching**: the only batching exception is documented in §"Batched dispatch for P3 peripheral journeys" — P3 only, max 7 per brief, with cycle-1 split-out semantics. P0/P1/P2 are NEVER batched, full stop.
- **Across journeys**: dispatched in parallel up to the host-max cap, sharing the same in-flight pool with Stage B reviewers (per §"Parallel cap — lifted and jointly applied").

If you find yourself writing one Agent dispatch that owns multiple non-P3 journeys ("composer-auth", "composer-cart-orders", etc.), stop. That is grouped batching. The fix is N parallel single-journey dispatches in one message, not N/k grouped dispatches.

The symptom of getting this wrong: every Stage B reviewer for a batched-Stage-A journey returns `improvements-needed` because the batched composer rationed attention across siblings and skipped Test-expectations bullets (mobile, error states, edge cases) on each. The volume of `improvements-needed` returns is the diagnostic.

See §"Batched dispatch for P3 peripheral journeys" for the narrow P3-only exception.

**Harness-enforced, not markdown-only.** This rule is shipped with the package as a PreToolUse:Agent hook (`hooks/coverage-expansion-dispatch-guard.sh`, auto-installed into `~/.claude/hooks/` and registered in `~/.claude/settings.json` by `scripts/postinstall.js`). Every Agent dispatch the orchestrator issues during coverage-expansion / journey-mapping work is inspected at the tool-use boundary: if the prompt references 2+ distinct `j-<slug>` IDs and the description does not start with a role-explicit single-journey prefix (`composer-j-<slug>:`, `reviewer-j-<slug>:`, `probe-j-<slug>:`) or `[P3-batch] composer-j-<slug>,...` (capped P3 batch) prefix, the harness denies the call before it reaches the subagent. Bare `j-<slug>:` and `sj-<slug>:` are also denied — see §"Role prefixes" below. Markdown rules can be rationalised away mid-run; this hook cannot. Consumers that cannot accept settings-modification (e.g., enterprise-managed `~/.claude/settings.json`) may set `CIVITAS_SKIP_HOOK_INSTALL=1` at install time to skip registration — but doing so falls back to markdown-only enforcement and re-opens the loophole.

### Role prefixes

Every Agent dispatch description starts with a role-explicit prefix. The prefix routes the dispatch through the harness gates: the dispatch-guard validates inputs, the playwright-cli isolation guard ties the prefix to a session slug, and the return-schema guard (`hooks/subagent-return-schema-guard.sh`) validates the output shape against the role's contract. Same prefix on description, on CLI session slug, on the schema selector — one mechanical convention.

| Role | Description prefix | CLI session slug | Return shape |
|---|---|---|---|
| Stage A composer (per journey) | `composer-j-<slug>:` | `composer-j-<slug>-<pass>-c<N>` | `subagent-return-schema.md` §1 + §2 (Stage A) |
| Stage A composer (sub-journey) | `composer-sj-<slug>:` | `composer-sj-<slug>-<pass>-c<N>` | as above |
| Stage B reviewer | `reviewer-j-<slug>:` | `reviewer-j-<slug>-<pass>-c<N>` | `subagent-return-schema.md` §2.4 (Stage B) |
| Adversarial probe (passes 4-5) | `probe-j-<slug>:` | `probe-j-<slug>-<pass>` | Stage A finding shape + ledger |
| Sub-orchestrator (process-validator) | `process-validator-<scope>:` | (no CLI session) | Reviewer-shape (§2.4) applied to a manifest |
| Phase 1 discovery | `phase1-<entry>:` | `phase1-<entry>` | site-map / page entries |
| Phase 2+ discovery | `phase2-<scope>:` | `phase2-<scope>` | site-map / page entries |
| Stage 2 element inspection | `stage2-<scenario>:` | `stage2-<scenario>` | page-repository entries |
| P3-batch composer (≤7) | `[P3-batch] composer-j-<a>,composer-j-<b>,...:` | per-item slug | per-journey returns concatenated |
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
| [`references/depth-mode-pipeline.md`](references/depth-mode-pipeline.md) | Per-pass pipeline (steps 1–8), pass differences, commit-message conventions, per-pass completion criteria, whole-suite re-run gate, parallelism model, model selection (cost-blind), auto-compaction between passes, re-pass mode for compositional passes 2–3, batched dispatch for P3 peripheral journeys, post-pass-5 ledger dedup. |
| [`references/dual-stage-retry-loop.md`](references/dual-stage-retry-loop.md) | The 7-cycle Stage A↔B retry loop pseudocode, termination conditions, "fresh reviewer every cycle" invariant, dual-stage-specific anti-rationalizations. |
| [`references/state-file-schema.md`](references/state-file-schema.md) | `coverage-expansion-state.json` shape, per-journey `dispatches[]` entry fields including dual-stage fields, journey-roster mutability, corrupt-state-refusal protocol. |
| [`references/subagent-isolation.md`](references/subagent-isolation.md) | Per-role dispatch contracts (compositional, adversarial, cleanup): isolation guarantees, brief inputs, `playwright-cli` session naming, the orchestrator's never-hold-payload-content rule. |
| [`references/process-validator-workflow.md`](references/process-validator-workflow.md) | The sub-orchestrator pattern: when to invoke `process-validator-<scope>:`, manifest shape, validator review checklist, response shape (mirrors reviewer-return), parent's response handling. |
| [`references/anti-rationalizations.md`](references/anti-rationalizations.md) | Failure-mode patterns the orchestrator and subagents must recognise (keyed by category, not surface phrasing). Each entry: name, symptoms, reality, enforcing hook (or `markdown-only`), origin. |
| [`references/reviewer-subagent-contract.md`](references/reviewer-subagent-contract.md) | Stage B contract: role, inputs, must-fix calibration, hard constraints, the 7-step process. |
| [`references/adversarial-subagent-contract.md`](references/adversarial-subagent-contract.md) | Stage A contract for passes 4–5: probe categories, negative-case matrix, ledger append protocol, regression-test authoring rules. |
| [`../element-interactions/references/subagent-return-schema.md`](../element-interactions/references/subagent-return-schema.md) | Canonical return + ledger schema. §1 finding-return shape; §2 return states; §2.4 reviewer-return; §3 ledger schema; §4 caller contract; §4.1 grep-based conformance check; §4.2 harness validator (issue #127). |

## Reading order for new contributors

1. **This file** — orchestrator-side kernel: two valid exits, role prefixes, no-skip contract, mandatory intent declaration, modes table.
2. **`references/depth-mode-pipeline.md`** — the bulk of how depth-mode actually runs.
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
- **Re-pass 4-trigger format** — grep per §"Re-pass mode for compositional passes 2–3" below for the literal strings "trigger 1" through "trigger 4" plus mapping-table header and per-expectation entries.

If any check fails, the orchestrator re-dispatches with a brief explicitly quoting the rejected parts. Failures consume one cycle of the 7-cycle budget. Persistent malformed returns terminate as `blocked-dispatch-failure`.

**Harness backstop.** Returns are also validated by `hooks/subagent-return-schema-guard.sh` — a PostToolUse:Agent hook that mirrors §4.1's grep checks at the harness layer. The hook routes by description prefix (`composer-`/`reviewer-`/`probe-`/`process-validator-`) and emits a non-blocking `systemMessage` warning that names the missing field markers. Initial release is warn-only; a follow-up flips to block-mode after the false-positive rate is calibrated. The hook exists to catch malformed returns the orchestrator's own grep missed — it never substitutes for the orchestrator-side check.

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

## Non-negotiables for depth mode

Read these as hard rules, not guidance. They prevent the most common shortcut path — running Pass 1, silently deferring passes 2–5 + cleanup "for budget", and reporting depth mode complete anyway.

- When invoked with `mode: depth` (or with no args, since depth is the default), the orchestrator **MUST complete 3 compositional passes + 2 adversarial passes + ledger dedup, in order**. No exceptions. "Only Pass 1 ran" is never a valid completion state for depth mode.
- **Pass 1 alone is NOT coverage-expansion — it is one-fifth of the pipeline.** Any progress line, summary, or upstream report that conflates "ran Pass 1" with "ran coverage-expansion" is wrong and must be corrected before returning to the caller. The same goes for "ran passes 1–3 (compositional only)" — that is three-fifths of the pipeline; the adversarial passes + cleanup are part of the contract, not optional.
- **If context budget threatens completion mid-pipeline**, the orchestrator MUST:
  1. Commit whatever the most recent pass produced (do not lose subagent work).
  2. Write state to `tests/e2e/docs/coverage-expansion-state.json` containing at minimum: the journey index (IDs, priorities, pages-touched), the set of completed passes, the set of pending journeys within any in-flight pass, and the current pass number.
  3. **STOP with a clear "resume needed" message** to the caller naming the state-file path, the passes completed, and the passes still pending. Do NOT silently skip remaining passes and claim the pipeline is done.
- **On resume**, the orchestrator reads `coverage-expansion-state.json`, verifies that each previously-reported-completed pass actually landed as a commit (not just scaffolded in state), and continues from the first incomplete pass. A pass that was marked complete in the state file but whose commit is missing from git history is treated as incomplete and re-run.
- **State-file lifecycle.** The state file is a resume marker, not a run log. On **successful completion of all five passes + cleanup**, the orchestrator MUST delete `tests/e2e/docs/coverage-expansion-state.json` as part of the cleanup commit — otherwise the next invocation will mistake a completed run for a resume. On a **fresh invocation**, if the state file is present the orchestrator treats the run as a resume and verifies commit-existence per the previous bullet; it does NOT start from scratch silently. If the file exists but references a journey-map or commit graph that no longer matches reality (e.g., the branch was rebased, or journey IDs changed), the orchestrator stops and reports the conflict to the caller rather than guessing.
- **"Structural-only" / "blocked with skipped placeholder" tests** count as coverage ONLY when the blocker is a documented tenant-data or environment constraint (e.g., "requires admin seed user not present in demo tenant"). Structural-only tests MUST appear in a separate column from fully-automated tests in any coverage report — never rolled into the automated total. Structural-only tests NEVER satisfy a Pass 4 or Pass 5 adversarial-probe requirement: a skipped placeholder is not an adversarial finding, a verified boundary, or a regression test.

---

## Recursive dispatch is impossible — plan, don't fan out

Subagents in this environment **cannot** dispatch their own sub-subagents. The Agent / Task tool is parent-only; a subagent that tries to fan out hits a hard wall (`"no Agent / Task tool available in my toolset"`). This is an environment constraint the methodology must work around, not a contract a skill can amend.

**Two valid patterns** for any work that conceptually needs hierarchical dispatch:

1. **Parent dispatches the wave directly.** Each subagent does ONE focused job. The parent fans out N parallel Agents in one message. This is the default for composer / reviewer / probe waves.
2. **Sub-orchestrator returns a manifest.** When the parent's context shouldn't hold the full skill content, dispatch a sub-orchestrator subagent (`description: "process-validator-<scope>:"` or similar) with the relevant skill loaded. The sub-orchestrator **plans** the wave and **returns a structured manifest** of N briefs. The parent reads the manifest and dispatches the wave. The sub-orchestrator never tries to fire its own children.

**Anti-pattern:** a brief that asks a subagent to "dispatch N parallel subagents", "spawn workers", "fan out", or "use the Agent tool to coordinate". The hook `coverage-expansion-dispatch-guard.sh` blocks these explicitly because the subagent cannot satisfy them.

**Process-validator role** (proactive Stage B for the orchestrator's plan): before fanning out a wave of N composer / reviewer / probe subagents, the parent dispatches a `process-validator-<scope>:` subagent with the relevant skill loaded. The validator reviews the planned dispatch manifest against the skill's contract — slug convention, role-prefix consistency, journey coverage, brief minimalism — and returns `greenlight` or `improvements-needed`. Only on `greenlight` does the parent fan out the wave. Same shape as Stage B reviewer, applied one level up.

**Workflow spec.** When to invoke (wave-size ≥ 3, pass boundary, scope change, recovery-after-improvements-needed), the manifest shape (table of role-prefix / journey-id / slug / model-hint / must-fix-list summary), the validator's review checklist (slug-length, role-prefix consistency, journey coverage, brief minimalism, parallelism cap, hook-rule pre-checks, model-hint sanity, pass-boundary fit), the response shape (mirrors `subagent-return-schema.md` §2.4 reviewer-return — `greenlight` requires `summary:`, `improvements-needed` carries findings under a `findings:` array), and the parent's response handling (greenlight → dispatch unchanged; improvements-needed → revise + re-validate; 3-cycle cap before escalating to the user) are all specified end-to-end in [`references/process-validator-workflow.md`](references/process-validator-workflow.md). The harness validator hook (`hooks/subagent-return-schema-guard.sh`, issue #127) enforces the `process-validator-` return shape mechanically.

**Slug-length constraint:** the `playwright-cli` daemon binds a UNIX socket under `$TMPDIR`. On macOS the path is capped at 104 chars; slugs longer than ~28 chars push the path over the limit and the daemon silently fails to bind. Hook `playwright-cli-isolation-guard.sh` enforces a 6–28-char range. With the role-explicit prefix (`composer-`, `reviewer-`, `probe-` — 8–9 chars), the journey slug needs to stay short: `composer-j-checkout-1-c1` (24 chars) fits; `composer-j-marketplace-buy-1-c1` (31 chars) does not. Shorten the journey slug, not the role prefix.

---

## No-skip contract

This contract closes the "scope-to-gap-journeys" loophole — an orchestrator dispatching only the journeys it judges interesting and marking the pass complete by leaving the rest unrun. It stacks on top of §"Non-negotiables for depth mode" — that section ensures all 5 passes + cleanup run; this contract ensures every pass covers every journey. Both sets of rules are hard rules, not guidance.

1. **Every journey in the map gets a dispatch every compositional pass.** Pass 2 and Pass 3's wording "re-attempt any journey where pass 1 deferred stabilization or returned coverage gaps" names ONE legitimate reason to prioritise; it does NOT authorise skipping un-gapped journeys. Scoping the dispatch to only "interesting" journeys is a shortcut and constitutes partial-pass-completion.
2. **Every journey in the map gets a dispatch every adversarial pass.** Pass 4 and Pass 5 run bug-discovery per journey — 0 journeys × Pass 4 is not Pass 4. A journey whose adversarial subagent returns "no meaningful boundaries found" must still be recorded in the ledger section with that result — the dispatch happened.
3. **Every dispatch returns a structured result.** Options are `new-tests-landed`, `no-new-tests (exhaustively covered)`, `blocked (reason)`, or `skipped (reason + who-authorized)`. `blocked` is **subagent-returned** and does not need orchestrator or user approval — it is the subagent saying "I dispatched but cannot complete because of tenant data / environment / credential gaps" (e.g., admin seed user missing in demo tenant). `skipped` is **orchestrator-proposed** and is only valid when the orchestrator has the user's explicit in-conversation authorisation to skip that specific journey; an LLM orchestrator may not authorise itself, and the budget-pressure clause in §"Non-negotiables for depth mode" is NOT such authorisation. If the orchestrator cannot tell whether a journey should be blocked or skipped, it dispatches and lets the subagent decide — that is always the correct default.
4. **Scope compression is a caller-facing decision.** If the orchestrator determines before dispatching that a journey's Pass-N work is likely no-op, it still dispatches; if it wants to formally skip, it RETURNS TO THE CALLER with a scope-compression proposal and waits for the caller to approve. Silent scope compression is a contract violation.
5. **No-op dispatches are cheap by design.** A well-behaved test-composer subagent, given an already-exhaustive journey, returns `no-new-tests` in seconds with no test-run — there is no budget justification for scope-compression on that basis.

### Structured-return recording

Every dispatch's return goes in two places, and both are required:

- **Progress log for the current run** — a per-journey line in the caller-visible progress output, of the form `j-<slug>: <return-type> — <reason-if-any>`.
- **`coverage-expansion-state.json`** — in the per-pass record, a `dispatches` array with one entry per journey: `{ journey: "j-<slug>", result: "new-tests-landed|no-new-tests|blocked|skipped", reason: "<text or null>", authorizer: "<user|null>" }`. `authorizer` is only non-null for `skipped`.

A state file without the `dispatches` array for every pass that has run is incomplete — it cannot be used to verify the no-skip contract was honoured on resume.

### Applies to both modes

This contract applies to **both** `mode: depth` and `mode: breadth`. Breadth mode runs one horizontal sweep across all journeys — the same no-skip rule applies per tier. An orchestrator running breadth mode that scopes Tier-1 to "only journeys with P0 priority and recent commits" is committing the same loophole; breadth mode's single sweep must still dispatch for every journey in the map, returning one of the four structured results for each.

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

This subsection extends §"Per-pass completion criteria" (see below). A pass's completion criteria are NOT satisfied by covering the journeys the orchestrator judged interesting. The criteria are satisfied by covering every journey in the map, with each covered journey returning one of the four structured results above. An orchestrator that writes "41 journeys had no gaps — no-op dispatches not run" in a state file is not writing a state file, it is writing a rationalisation; the state file should say either "pass complete, N/N journeys dispatched" or "pass incomplete, N/M journeys dispatched, waiting to resume" — using the exact same wording as §"Non-negotiables for depth mode" so resume logic can key off a single shared string.

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
  Mode: <depth | breadth>
  Plan: dispatch every journey in `tests/e2e/docs/journey-map.md` for every required pass
        (depth = 3 compositional + 2 adversarial + cleanup; breadth = 1 sweep).
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
| `mode: depth` (default) | `args: "mode: depth"` or no args | Five passes + cleanup, journey-by-journey in priority order, parallel where independent. Passes 1–3 are compositional; passes 4–5 are adversarial. Final cleanup dedupes the adversarial findings ledger. |
| `mode: breadth` | `args: "mode: breadth"` | One horizontal sweep: priority × depth tiers across all journeys. Fast fallback for quick coverage growth. Adversarial passes do NOT run in breadth mode. |

---

## Depth mode — five-pass pipeline (3 compositional + 2 adversarial) + cleanup

The full per-pass pipeline (steps 1–8), pass differences, commit-message conventions, per-pass completion criteria, the whole-suite re-run gate (incl. issue #131's harness-enforced windowed ratchet), the parallelism model, model selection (cost-blind), auto-compaction between passes, re-pass mode for compositional passes 2–3, batched dispatch for P3 peripheral journeys, and the post-pass-5 ledger dedup are specified in [`references/depth-mode-pipeline.md`](references/depth-mode-pipeline.md). Read it before authoring or modifying any depth-mode pass.

### Hard rules — kernel-resident (never violate, even without loading the reference)

These are restated here so they're in working memory even when `references/depth-mode-pipeline.md` is not loaded. Canonical text in the reference; this list is the no-load-required floor.

- **Five passes + cleanup, in order, every run.** Three compositional (1–3) + two adversarial (4–5) + one ledger-dedup cleanup. "Pass 1 only" is one-fifth of the pipeline, never a valid completion state for `mode: depth`.
- **Every journey, every pass.** Pass N is complete only when every journey in the map has been dispatched AND returned. Not "enough journeys", not "the P0/P1 tier", not "the journeys that fit the budget" — every journey. Pass 4 with 0 journeys is not Pass 4.
- **One journey per commit, per pass kind.** Commit-message templates are fixed per pass (`test(<j-slug>)`, `docs(ledger): <j-slug> — …`, `test(<j-slug>-regression)`, `docs(ledger): dedupe cross-cutting findings`). Agents MUST NOT reinvent the format — the git log has to be filterable by `<j-slug>` and pass kind.
- **Stage B never commits.** Reviewer judgements live in the state file's `review_status` and `final_must_fix` fields, never as commits. `review(j-…)` and any review-tagged commit form is forbidden.
- **Stage A and B are parallel by default.** A journey's Stage B fires as soon as that journey's Stage A returns and the cap has a slot — not after every Stage A in the pass completes. Finishing all Stage A first then starting all Stage B is contract-violating.
- **Parallel cap counts A and B jointly.** One pool of in-flight slots; A, B, and A-retry compete. A journey's own A and B never overlap (sequential within a journey); across journeys any A/B interleaving is possible. Queue order is FIFO.
- **Cost-blind, opus-default model selection.** Default is opus for every dispatch in every stage in every pass. Two narrow exceptions: (a) cycle-1 Stage B sonnet-confirmation for previously-greenlit journeys with no map delta and no sibling-bug ledger update — sonnet's `improvements-needed` always re-runs on opus. **Pass 4 and Pass 5 are always opus, both stages, full stop** — the sonnet exception does NOT apply to adversarial passes. (b) Cleanup subagent (single post-pass-5 dispatch) may use haiku — text-only editing.
- **P0/P1/P2 NEVER batch.** P3-only batching, capped at 7 per brief, Stage A only — Stage B always per-journey. Sharing pages with P3 siblings is not authorisation; priority is load-bearing.
- **Auto-compaction at 70%.** State written first, then `/compact`, then resume from state. Mid-cycle Stage A returns persist to a scratch file (`tests/e2e/docs/.coverage-expansion-cycle-<slug>-cycle-<N>.json`) before compacting; mid-cycle restart from a fresh Stage A dispatch is NOT acceptable.
- **`blocked-cycle-stalled`, `blocked-cycle-exhausted`, `blocked-dispatch-failure` are valid terminals**, not pass failures. Mark them faithfully — calling cycle-7-exhausted "greenlit" corrupts the state file and the next pass's trigger-4 input.

## Breadth mode — one horizontal sweep

For the quick-pass use case, run one invocation per priority tier. No journey-by-journey iteration; no parallel dispatch per journey (the sweep itself is serial). Deep mode remains the default.

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
- **Returns are structured summaries only.** No pasted test source, no DOM snapshots, no CLI transcripts. All returns conform to `subagent-return-schema.md` (and are validated by `hooks/subagent-return-schema-guard.sh`, issue #127).

## Progress output

Emit one line per significant event, prefixed `[coverage-expansion]`:

```
[coverage-expansion] Pass 1/5 starting — 14 journeys mapped (3 P0, 6 P1, 4 P2, 1 P3), dual-stage A↔B
[coverage-expansion] Pass 1/5 — dispatching 4 parallel A↔B pipelines for j-book-demo, j-reset-password, j-browse-catalog, j-view-pricing
[coverage-expansion] Pass 1/5, journey j-book-demo: cycle 1/7, review greenlight (6 tests added)
[coverage-expansion] Pass 1/5, journey j-reset-password: cycle 2/7, review greenlight (1 retry — mobile variant added per Stage B)
[coverage-expansion] Pass 1/5, journey j-browse-catalog: cycle 1/7, review greenlight
[coverage-expansion] Pass 1/5, journey j-view-pricing: cycle 7/7, review blocked-cycle-exhausted (2 must-fix unresolved — carries to Pass 2 trigger 4)
[coverage-expansion] Pass 1/5 complete — 27 tests added, 3 branches discovered, 1 journey blocked-cycle-exhausted, committed
[coverage-expansion] Pass 2/5 starting — 15 journeys (1 sub-journey promoted), dual-stage A↔B
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

---

## Integration with other skills

- **`journey-mapping`** — produces the precisely-embeddable journey map this skill reads. Map must be sentinel-bearing. No schema change required for adversarial passes.
- **`test-composer`** — called once per journey per compositional pass (1–3) with `args: "journey=<j-id>"`. Owns compose, stabilize, API compliance, coverage verification. NOT called during adversarial passes.
- **`bug-discovery`** — invoked from **inside** each adversarial-pass subagent, scoped to one journey. No change to the skill itself; it accepts a scoped invocation. Subagents decide probe-category selection autonomously based on live observation.
- **`failure-diagnosis`** — invoked inside any subagent (compositional or adversarial) when stabilization fails. The orchestrator does not call it directly.
- **`onboarding`** — calls this skill as its Phase 5 with `mode: depth`. Phase 5 now produces adversarial-findings as a side effect. Onboarding's Phase 6 (standalone `bug-discovery`) remains in place as a wider, cross-app adversarial sweep; per-journey adversarial coverage is handled earlier inside Phase 5.

---

## Non-goals

- Mapping new journeys from scratch — that's `journey-mapping`.
- Composing a single journey's tests — that's `test-composer`.
- Cross-application coverage — one invocation covers one app.
- Running adversarial probing in breadth mode. Breadth stays one horizontal sweep; users who want adversarial coverage explicitly want depth.
- Writing regression tests for findings classified as `Suspected bugs` or `Ambiguous`. Never lock buggy behavior into a passing suite. Never use `test.fail()` markers — they rot into permanent CI noise.
- Growing the journey map during adversarial passes. Map growth is for compositional passes only.
- Broad cross-app adversarial sweeps — that's still the job of the standalone `bug-discovery` skill. This skill's adversarial passes are strictly per-journey.
