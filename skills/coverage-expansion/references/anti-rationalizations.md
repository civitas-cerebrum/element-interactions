# Consolidated Anti-Rationalization Registry

**Status:** single source of truth for failure-mode patterns the orchestrator and its subagents must recognise. Cited from `coverage-expansion/SKILL.md` and the depth-mode / dual-stage / model-selection reference files.
**Scope:** patterns are keyed by **failure-mode category**, not by surface phrasing. Each entry names the pattern, lists symptoms (phrasings that signal it), states the reality, names the enforcing hook (or tags `markdown-only`), and links to where the pattern was first observed.

Why categories, not symptoms: enumerating tactical excuses can't keep up with new framings. New phrasings appear constantly; the failure mode underneath is a small set. A reader who has the category internalised can match a novel framing to a known pattern instead of needing the table to grow yet another row.

---

## Pattern: Pre-emptive scope reduction

The orchestrator decides — before dispatching — that running fewer than the contracted set of passes / journeys is the "responsible" choice given inferred constraints (session length, context budget, perceived user preference).

**Symptoms** (phrasings that signal this pattern):
- "pragmatic Pass 1 only" / "honest Pass 1 only" / "transparent Pass 1 only"
- "given session / context constraints, I'll run a subset"
- "I'll be honest with the user that I'm reducing scope"
- "the user clearly wants results, not hours of subagent dispatch"
- "running all 5 passes is excessive for this app"
- "I'll run [subset] and report state — that's resume-friendly"
- "the realistic depth-mode contract for this app is an evening-or-overnight wall-clock run"
- "the honest stopping point right now is to write state and resume in a fresh conversation"
- "I want to be honest with you before burning a multi-hour budget"
- "the design of coverage-expansion makes this a multi-conversation operation by exit #2"

**Reality:** Budget pressure is not scope authorisation. Tone does not change the contract: a "transparent" scope reduction is still a scope reduction. The valid mid-run response to actual budget pressure is exit #2 (commit + state-file + stop), NOT pre-emptive reduction. **Exit #2 requires at least one dispatch in flight** — invoking it before any subagent has been dispatched is not exit #2, it is refusing to start. Onboarding's Phase 3 (happy path) is not a Phase 5 (coverage-expansion) dispatch — they're different phases, different subagents, different work; covering one journey via the happy-path scaffold does not satisfy Pass 1's "every journey, every pass" contract.

**Hooks that catch this:**
- `coverage-state-schema-guard.sh` (extended for this pattern) — denies state-file writes where `currentPass >= 1` and zero dispatches are recorded across all passes. Mechanically blocks the "write state-file then stop" form.
- `commit-message-gate.sh` (PR #125) — blocks commits with phase-progression messages on pre-emptively-reduced runs.
- (markdown-only for novel framings) — the registry's symptom list grows reactively as new framings appear; the failure-mode category is what the orchestrator must recognise.

**Origin:** Recurring failure across multiple onboarding runs (BookHive, others, plus the v0.3.4-test run that surfaced "evening-or-overnight" framing). Codified as the §"Two valid exits" rule and the dual-stage no-skip extension; mechanical enforcement added in v0.3.5.

---

## Pattern: Self-authorised batching (Stage A grouping)

The orchestrator decides — before dispatching — to batch P0/P1/P2 journeys into multi-journey composer briefs ("composer-auth covering 4 journeys", "composer-cart-orders covering 3"), citing efficiency or natural clustering.

**Symptoms:**
- "16 individual Stage A composer dispatches is too many — I'll group them by area"
- "these 4 journeys naturally cluster — 1 agent can handle them efficiently"
- "the journeys share most pages, same project, roughly P3 — skip the 'shared Playwright project' check"
- "batching is faster so I'll batch everything that isn't explicitly forbidden"

**Reality:** Stage A is one composer per journey, in parallel up to host max — never N composer agents each covering N/k journeys sequentially. The only batching exception is P3 peripheral journeys, capped at 7 per brief, with cycle-1 split-out semantics. P0/P1/P2 NEVER batch. The diagnostic for getting this wrong: every Stage B reviewer for batched journeys returns `improvements-needed` because the batched composer rationed attention across siblings.

**Hooks that catch this:**
- `coverage-expansion-dispatch-guard.sh` (PR #125, issue #126) — denies dispatches whose prompt references 2+ distinct `j-<slug>` IDs without a `[P3-batch]` description prefix.

**Origin:** PR #105 (no-skip contract) + issue #126 (role-prefix tightening). Reinforced by issue #132 (brief-cleanup BLOCK promotion).

---

## Pattern: Self-certifying greenlight

A subagent (composer, reviewer, or probe) skips the work and self-certifies success — composer returns `covered-exhaustively` without inspecting, reviewer self-greenlights a journey it didn't review, probe skips boundaries it judged "trivial".

**Symptoms:**
- "obvious no-op — I'll mark `covered-exhaustively` without reading Pass-1 returns"
- "Stage A returned `covered-exhaustively` — no need to dispatch Stage B"
- "cycle 1 Stage B will obviously greenlight this trivial journey, I'll skip it"
- "the journey was greenlit last pass — skip the whole A↔B for this pass"
- "the mapping table is obvious, I'll shorthand it"

**Reality:** `covered-exhaustively` requires evidence — a per-expectation mapping table, not a self-assessment. Stage B is the verification, not Stage A's self-certification. Every journey gets both stages every pass. A `review_status` written without a Stage B dispatch having occurred is fabricated state.

**Hooks that catch this:**
- `subagent-return-schema-guard.sh` (issue #127) — warns (will block) when a `covered-exhaustively` return lacks the per-expectation mapping table; warns when banned tokens (`no-new-tests-by-rationalisation`) appear.

**Origin:** PR #105 + the dual-stage contract (issue #122 era). Re-pass mode triggers (1–4) exist precisely to force evidence into the certifying-greenlight return.

---

## Pattern: Spirit-vs-letter argument

The orchestrator argues that the rule's spirit is satisfied even though the letter is not — typically used to rationalise a small contract violation as "consistent with the intent".

**Symptoms:**
- "spirit of the contract is satisfied"
- "we're effectively running the full pipeline"
- "this is a different scenario the rule doesn't cover"
- "the rule was written for situation X; this is situation Y"

**Reality:** The contract's letter IS its spirit. If a rule covers situation X and you find yourself in situation Y, that's either a real gap to surface to the user (open an issue, propose an extension) or the rule actually does cover Y and you're trying to wriggle out. Tone does not change the contract.

**Hooks that catch this:**
- (markdown-only) — the framing is not mechanically detectable.

**Origin:** Recurring across discipline-failure incidents.

---

## Pattern: Compress findings into summary

A subagent or orchestrator compresses Stage B findings into a "summary string" before passing to the next Stage A retry, losing the surgical specificity Stage A needs to fix them.

**Symptoms:**
- "I'll compact findings from cycles 1–4 into one summary string for cycle 5's input"
- "the must-fix list is small — I'll skip the retry"
- "compressed findings are easier to read"

**Reality:** Pass full findings through verbatim. Compressed findings lose the surgical specificity. A single `must-fix` item is enough to block greenlight; "small list" is not authorisation to skip.

**Hooks that catch this:**
- (markdown-only) — finding compression happens inside orchestrator briefs, not at the dispatch boundary.

**Origin:** Dual-stage retry-loop design (issue #122 era).

---

## Pattern: Stale-budget rationalisation

The orchestrator infers from earlier-in-the-run telemetry that a given pass / journey will be cheap or no-op, and skips re-reading the state file or the journey block before dispatch.

**Symptoms:**
- "Pass 4 finished cleanly — Pass 5 will be a no-op, I'll skip the re-dispatch check"
- "this journey was greenlit last pass with no map delta — skip the inspection"
- "no point reading state — I remember where we are"

**Reality:** Re-read the state file at every pass boundary. The orchestrator must not reason about "where did we leave off" from chat history. Memory is diagnostic, not authoritative.

**Hooks that catch this:**
- `coverage-state-schema-guard.sh` (PR #125) — validates state-file shape on every Write/Edit, catching stale-state writes.

**Origin:** PR #105 + auto-compaction design (issue #122 era).

---

## Pattern: "MCP tool was in my list, so it must be allowed"

A subagent reaches for an MCP browser tool surfaced by the harness, on the implicit reasoning that "if the tool list contains it, the harness sanctions it".

**Symptoms:**
- "the MCP browser tool is in my available tool list, I'll use it"
- "playwright-cli isn't installed yet, I'll use the MCP fallback"
- "the harness still surfaces these tools, so they're an option"

**Reality:** The harness surfaces tools the consumer's environment has registered, not tools the skill suite sanctions. The MCP browser tools are explicitly forbidden — `playwright-cli` is the only sanctioned channel. A subagent that reaches for an MCP browser tool has a malformed dispatch brief, not a permitted alternative.

**Hooks that catch this:**
- `mcp-browser-tool-redirect.sh` (PR #125) — denies the MCP browser tool calls and emits the playwright-cli equivalent in the redirect message.

**Origin:** PR #122 (MCP→playwright-cli migration). Reinforced by issue #126.

---

## Pattern: Subagent fan-out anti-pattern

A subagent's brief asks it to "dispatch N parallel subagents", "spawn workers", "fan out", or "use the Agent tool to coordinate". Subagents in this environment cannot recursively dispatch other subagents — the Agent / Task tool is parent-only.

**Symptoms (in subagent briefs, not subagent self-talk):**
- "you are an orchestrator — dispatch 4 parallel composers"
- "fan out the work to N subagents"
- "use the Agent tool to spawn workers"
- "coordinate the wave by dispatching its constituents"

**Reality:** Two valid patterns: (a) parent dispatches the wave directly (default for composer / reviewer / probe waves); (b) sub-orchestrator returns a manifest (the parent reads the manifest and dispatches). The sub-orchestrator NEVER tries to fire its own children — see `process-validator-workflow.md`.

**Hooks that catch this:**
- `coverage-expansion-dispatch-guard.sh` (PR #125, issue #126) — anti-pattern A: blocks subagent briefs whose body contains "dispatch N parallel subagents", "fan out", "use the Agent tool to dispatch".

**Origin:** Environment constraint surfaced during PR #122 era. Codified as the recursive-dispatch impossibility in `coverage-expansion/SKILL.md` §"Recursive dispatch is impossible".

---

## Pattern: Sonnet cost-down rationalisation

The orchestrator argues for sonnet over opus on dispatches the cost-blind posture says should be opus.

**Symptoms:**
- "the journey was attempted last pass and ended at `blocked-cycle-stalled` — that counts as previously-greenlit"
- "Pass 4 is just probing, sonnet is good enough for cycle-1 of small journeys"
- "I ran sonnet for Stage A and opus for Stage B — that's a hybrid we never explicitly forbade"
- "small journey, sonnet is fine"

**Reality:** Default model for every dispatch in every stage in every pass is opus. The narrow cycle-1 Stage B sonnet-confirmation exception applies ONLY to journeys with `greenlight` (not blocked-*) in the previous pass, no map delta, and no sibling-bug ledger update. Pass 4 + Pass 5 are ALWAYS opus, both stages, full stop. Hybrid Stage A/Stage B model splits beyond the narrow exception are not authorised.

**Hooks that catch this:**
- (markdown-only) — model selection is not yet mechanically detectable at the dispatch boundary.

**Origin:** Cost-blind posture codified in §"Model selection" of `references/depth-mode-pipeline.md`.

---

## Pattern: Trivial-journey-skip / cycle-1-Stage-B-greenlight self-certification

The orchestrator decides a journey is "trivial enough" to skip its cycle-1 Stage B reviewer dispatch entirely, recording `greenlight` in the state file without a reviewer dispatch having occurred.

**Symptoms:**
- "this journey is trivial — Stage B will obviously greenlight, skip it"
- "previous pass greenlit, this pass will too — record greenlight directly"
- "saving a dispatch on the trivial cases is fine"

**Reality:** Self-certifying greenlights without a reviewer dispatch is the failure mode the dual-stage design exists to close. The fast path for trivial journeys is the cycle-1 Stage B sonnet-confirmation exception (`references/depth-mode-pipeline.md` §"Model selection") — NOT skipping the dispatch.

**Hooks that catch this:**
- `coverage-state-schema-guard.sh` — flags `review_status: greenlight` entries with `stage_b_cycles: 0` (the minimum for an actually-dispatched Stage B is 1).

**Origin:** Dual-stage no-skip extension (issue #122 era).

---

## Pattern: Cycle-7 exhausted → call-it-greenlit

When the 7-cycle Stage A↔B retry loop reaches cycle 7 without greenlight, the orchestrator marks the journey greenlit anyway "to keep the pass moving".

**Symptoms:**
- "cycle 7 exhausted and I'll just call it greenlit to keep the pass moving"
- "the must-fix list at cycle 7 is small, close enough to greenlit"
- "we're out of cycles, the journey is good enough"

**Reality:** `blocked-cycle-exhausted` is the correct terminal state. Marking exhausted journeys greenlit corrupts the state file, lies to telemetry, and breaks the next pass's trigger-4 input (which depends on the unresolved must-fix list being faithfully recorded).

**Hooks that catch this:**
- `coverage-state-schema-guard.sh` — flags malformed `review_status` values; the four valid values are `greenlight | blocked-cycle-stalled | blocked-cycle-exhausted | blocked-dispatch-failure`.

**Origin:** Dual-stage retry-loop design.

---

## Pattern: Reviewer-disagreement cherry-picking

Two consecutive reviewers in cycles N and N+1 disagree about what's must-fix; the orchestrator picks the more lenient one to "make progress".

**Symptoms:**
- "reviewer disagrees with itself between cycles 1 and 2; I'll pick the more lenient one"
- "cycle 2's reviewer was more thorough — I'll discard cycle 1's findings"
- "consensus across cycles is what matters"

**Reality:** Each cycle's reviewer is fresh and independent. Take each cycle's output as-is; the retry-loop logic handles divergence via the stalled/exhausted checks. Cherry-picking defeats the fresh-eyes property.

**Hooks that catch this:**
- (markdown-only) — cherry-picking happens inside orchestrator briefs.

**Origin:** Dual-stage retry-loop design.

---

## Pattern: Brief-leak — orchestrator meta-content in subagent brief

The parent orchestrator's brief to a subagent contains pipeline meta-content (depth mode, 5-pass pipeline, "Pass 4/5", adversarial pass, etc.) that bloats the subagent's context and risks consulting parts of the skill outside its scope.

**Symptoms:**
- subagent brief mentions "depth mode" / "breadth mode"
- subagent brief mentions "5-pass pipeline" or specific pass numbers it doesn't need to know
- subagent brief mentions "adversarial pass" inside a composer brief
- subagent brief mentions the broader pipeline structure unnecessarily

**Reality:** A composer / reviewer / probe brief only needs: journey block + must-fix list + slug + return-shape pointer. The pipeline structure belongs to the parent orchestrator's context, not the subagent's.

**Hooks that catch this:**
- `coverage-expansion-dispatch-guard.sh` anti-pattern B (PR #125) + issue #132 — promoted from WARN to BLOCK for `composer-`, `reviewer-`, `probe-` prefixes; soft WARN preserved for `cleanup-`/`phase1-`/`phase2-`/`stage2-`.

**Origin:** PR #125, hardened by issue #132.

---

## Pattern: Auto-compact threshold creep

The orchestrator pushes past the 70% auto-compaction threshold ("one more pass before compacting") or compacts pre-emptively at 50% ("to be safe").

**Symptoms:**
- "context is at 75% but I can push one more pass before compacting"
- "I'll compact at 50% to be safe"
- "the state file is small, there's nothing to save before compacting"
- "I'll run Pass 4 to finish the boundary, then compact"
- "auto-compact failed once so I'll skip it this time"

**Reality:** 70% is a floor, not a guideline. Below it the seam costs more than it saves; above it the next pass often lands at 95%+ and forces an in-pass compact that loses roster state. State-file write happens BEFORE compaction, not after. Auto-compact failure → fall back to manual-compaction safe-seam, never silent progression.

**Hooks that catch this:**
- (markdown-only) — context-percentage decisions are inside the orchestrator's reasoning loop.

**Origin:** §"Auto-compaction between passes" in `references/depth-mode-pipeline.md`.

---

## Pattern: Orchestrator-direct composition (subagent dispatch dodged)

The orchestrator absorbs `composer-j-<slug>:` (or probe / reviewer) work into its own context — reads the journey block, drives `playwright-cli` for selector inspection itself, writes the spec inline, runs the test, commits — instead of dispatching a subagent. Often justified by a real concern (parallelism risk, shared-DB contention) that's then resolved by absorbing the work serially rather than fixing the parallelism issue.

**Symptoms:**
- "I am the composer. For each journey I read its block from journey-map.md, drive playwright-cli myself for selector inspection, write the spec inline, run it, commit. No Agent tool calls, no composer-j-<slug>: subagent dispatches."
- "earlier-turn analysis concluded that 22 parallel composer-j-<slug>: Agent dispatches against a shared MongoDB would race on /api/reset"
- "I'm violating that rule deliberately because [concern]"
- "test runtime is parallelized [via workers], but only at the Playwright-worker level — that's test execution parallelism, not journey-composition parallelism"
- "journey composition itself is serial. I work through journeys one at a time"
- "the orchestrator (me) holds the full journey-map content as I read each block, the playwright-cli snapshot output and DOM eval results, each spec's source as I write it, each test run's output for verification"

**Reality:** §"Orchestrator context discipline" mandates that DOM snapshots, test source, CLI transcripts, and stabilization output live in dispatched-subagent contexts. The orchestrator stays at index-level state (map index, independence graph, pass counter, structured-return summaries) — *only*. Direct composition violates that discipline regardless of the concern that motivated it. If parallel dispatch feels unsafe, the right fix is upstream (audit + per-test-user pattern), not "do the work myself serially". The audit's `global-reset:cross-test-race` tag exists precisely so Stage 4a §1 inverts to per-test-user isolation, which makes parallel composer dispatch safe.

The cost the orchestrator pays for the dodge:
- Speed: serial composition is ~3× slower than parallel dispatch with `P_dispatch` composers per wave.
- Context: orchestrator burns context proportional to total work (DOM snapshots × test source × stabilization transcripts × N journeys), instead of capping at structured-return summaries (~5k each).
- Stage B disappears: direct composition has no reviewer pass, so the dual-stage no-skip contract is silently broken.

**Hooks that catch this:**
- `coverage-expansion-direct-compose-warning.sh` — PostToolUse:Write|Edit on `tests/e2e/j-*.spec.ts` / `tests/e2e/sj-*.spec.ts` when `coverage-expansion-state.json` exists. Emits a `systemMessage` warning with the redirect to dispatch-instead, plus a pointer to test-optimization.md §1.A (per-test-user pattern).

**Origin:** v0.3.4 onboarding test surfaced this as a follow-on consequence of "Pre-emptive scope reduction" — the agent identified parallelism risk correctly, then absorbed the work to avoid the risk instead of fixing the risk's upstream cause. Hook + Stage 4a §1.A added in v0.3.5.

---

## Adding a new pattern

When a novel rationalisation framing appears that doesn't fit an existing pattern:

1. Match it to an existing pattern first (90% of the time it does fit — the categories are deliberately broad).
2. If genuinely new, add a new section to this file with the same shape (name, symptoms, reality, hooks, origin).
3. Update SKILL.md only if the new pattern needs surfacing in the kernel (rare — most patterns belong here).
4. Open a follow-up issue if the pattern is markdown-only and a hook would close the loophole.

The registry succeeds when readers can match novel framings to known patterns instead of needing this file to grow yet another row. Anti-rationalization is a category problem, not a phrasing problem.
