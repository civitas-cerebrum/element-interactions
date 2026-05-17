# Changelog

## Unreleased

**Onboarding state machine — status ledger + workflow-reviewer subagent family.** The eight-phase onboarding pipeline is now state-machine-enforced from the front-load gate to the Phase 8 report. The contract layer:

- **New status ledger** at `tests/e2e/docs/onboarding-status.json` (gitignored — same pattern as `.phase4-cycle-state.json` and `coverage-expansion-state.json`). Single source of truth for pipeline state: `currentPhase`, per-phase `status` + `handoverEnvelope` + `reviewerVerdict` + `reviewerCycles` (cap 3) + `deliverables`, optional `subStages` for phases 4 (cycles) and 5 (passes), and `approvedDeviations[]` for skip / early-stop authorisations. Schema: `schemas/onboarding-status.schema.json` (v1) with six fixtures under `schemas/onboarding-status.fixtures/` (two valid: fresh run, mid-phase-5 depth; four invalid: missing required, bad enum, wrong phase count, deviation without authorizer).
- **New `workflow-reviewer-*:` subagent role family.** Three prefixes: `workflow-reviewer-phase<N>:` between each onboarding phase, `workflow-reviewer-pass<N>:` between each coverage-expansion pass, `workflow-reviewer-cycle<N>:` between each journey-mapping cycle. ~15 dispatches per full onboarding run (8 phase + 5 pass + 2-5 cycle). Per-unit checklists map the canonical methodology exit criteria to checkable items. Return shape: `schemas/subagent-returns/workflow-reviewer.schema.json` — `verdict: approve | reject | escalate`. Approve requires `attestation`; reject + escalate require non-empty `findings[]` (surgical fix list). **3-cycle reject cap**: on the 3rd consecutive reject, the return sets `verdict: escalate` + `handover.status: escalated-to-user` and the orchestrator surfaces all three reviewer returns to the user for manual triage. Skip / early-stop transitions go through the same reviewer with explicit `authorizer` field (verbatim user quote OR documented structural exception); self-imposed reasons (`session-length`, `budget-cap`, `auto-mode`, `inferred-pref`) are explicitly rejected.
- **Two new hooks.** `onboarding-ledger-gate.sh` (PreToolUse:Agent, DENY) gates every Agent dispatch against the ledger: denies non-reviewer dispatches at any transition point until the matching `workflow-reviewer-*` has approved; denies out-of-order phase / pass / cycle dispatches; `workflow-reviewer-*` dispatches always allowed; silent-allow on missing / malformed ledger so brand-new runs can start. `onboarding-ledger-write-gate.sh` (PreToolUse:Write|Edit, DENY) validates every write to `tests/e2e/docs/onboarding-status.json` against the schema; additionally denies phase-skip transitions without a `status: skipped` + `approvedDeviations[]` entry carrying a non-empty `authorizer`, and denies `reviewerVerdict: approved` paired with a null `handoverEnvelope`. Both hooks registered in `scripts/postinstall.js` HOOK_MANIFEST (10s and 3s timeouts respectively).
- **New skill `workflow-reviewer/`.** Subagent-only methodology document loaded by every `workflow-reviewer-*:` dispatch. Defines role + scope per prefix family, per-unit checklists for all 8 phases + per-pass + per-cycle criteria, return shape + worked examples, surgical-fix-list format, skip / early-stop authorisation rules, and the 3-cycle reject cap with escalation.
- **Skill cross-references.** `skills/onboarding/SKILL.md` gains a top-level "Status ledger + workflow reviewer" section before the front-load gate. `skills/coverage-expansion/SKILL.md` §"Authoritative state file" and `skills/journey-mapping/SKILL.md` §"Cycle protocol" both gain an additive blockquote noting pass / cycle transitions are now reviewer-gated (existing state files unchanged). `skills/element-interactions/references/harness-hooks.md` indexes both new hooks.
- **Test coverage.** 21 new cases for `onboarding-ledger-gate.sh` (50-…), 17 new cases for `onboarding-ledger-write-gate.sh` (51-…). Combined with a fix to `47-public-package-contamination-scan.sh` that restores full-suite execution (the prior `set -e` + `exit 0` shape aborted the runner when `source`'d), the hook suite now reports 175 / 175 green — up from the pre-existing five-file partial run.
- **Empirical origin.** A 21-journey benchmark onboarding run (BookHive, Run 5) demonstrated that even crisp markdown-text contracts permit silent scope compression: the orchestrator skipped phases entirely, stopped early, accepted subagent "complete" returns whose deliverables were missing, and produced phase-boundary handovers that omitted required sub-deliverables. `standard-mode-first-pass-guard.sh` addresses the most egregious dispatch-shape compressions; this state-machine layer addresses the structural compressions — no phase / pass / cycle can advance without an explicit `approve` verdict from the matching reviewer.

**Methodology — strict first-pass / first-cycle, relaxed subsequent.** The `coverage-expansion` and `journey-mapping` skills now codify the empirically-observed rule that strict-parallel-per-X dispatch pays off most on the first pass / first cycle (baseline fidelity), while subsequent passes / cycles benefit from grouping (incremental refinement). The contract:

- **`coverage-expansion`:**
  - Rename `mode: depth` → `mode: standard`. `mode: depth` is preserved as a backward-compat alias — same pipeline, same defaults.
  - **Pass 1 is strict per-journey parallel.** `[group]` and `[P3-batch]` markers are FORBIDDEN on Pass 1. Hook-denied (see new `standard-mode-first-pass-guard.sh`).
  - **Passes 2-5 may use grouping** per the documented batching paths (`[group]` cap-7 for compositional Passes 2-3 with tier >5, `[P3-batch]` cap-7 for P3 peripherals).
  - **Adversarial Passes 4-5 may now use `[group]`** by default (the prior "no-batch-for-adversarial" rule is relaxed — adversarial findings cluster by app-wide pattern, so per-journey isolation is less load-bearing once the catalogue exists). Per-journey strictness becomes an opt-in via `args: "strict-adversarial: true"`.
  - `mode: breadth` is unchanged.
- **`journey-mapping`:**
  - **Cycle 1 (discovery) is strict per-section parallel in EVERY mode** (`full` and `phases-2-4`). Previously `full` mode was under-specified, allowing a single subagent to collapse the whole phase. Hook-denied for: (a) `phase4-prioritise-author:` before ≥ 2 cycle-1 sections; (b) single-subagent walkthroughs naming ≥ 3 canonical section IDs.
  - **Cycle 2+ (edge-probe, additional discovery) may be single-subagent sequential** when the orchestrator chooses. The hook does NOT block single-subagent cycle-2+ dispatches.
  - Phase 1 entry-crawl + post-crawl test-infra subagent contract unchanged.

**New handover envelope fields (additive).** `schemas/subagent-returns/handover.schema.json` gains two OPTIONAL fields:

- `dispatch-mode`: enum `["per-journey", "per-section", "grouped", "single-agent-collapsed"]`. Required on cycle-1 (journey-mapping) and Pass-1 (coverage-expansion) returns. The harness validator rejects cycle-1 / pass-1 returns with `dispatch-mode == grouped` or `single-agent-collapsed`.
- `parallel-wave-size`: integer ≥ 1. On cycle-1 / pass-1, wave-size 1 is rejected unless the roster genuinely contains only one item.

Both fields are additive — existing returns continue to validate (handover already had `additionalProperties: true`).

**New hook `standard-mode-first-pass-guard.sh`** (PreToolUse:Agent, DENY) — first-pass / first-cycle strict-dispatch backstop. Three deny rules: (1) Pass-1 `[group]` / `[P3-batch]`; (2) `phase4-prioritise-author:` before ≥ 2 cycle-1 sections; (3) single-subagent walkthroughs of journey-mapping cycle 1 (≥ 3 canonical section IDs in one description with no prior cycle-1 dispatches). Pass-2+ and cycle-2+ are silent-allowed. Wired through `HOOK_MANIFEST` in `scripts/postinstall.js` so consumers register the hook automatically on install / `npm run sync-hooks`. 23-case test suite at `hooks/tests/cases/49-standard-mode-first-pass-guard.sh`.

**Empirical origin.** A benchmark onboarding run on a 21-journey app surfaced two patterns the methodology change addresses: (a) `full`-mode journey-mapping collapsed to a single subagent and produced shallow per-section coverage; (b) the strict-per-journey contract on every coverage-expansion pass + cycle was expensive (high-teens / low-twenties dispatch count for a 21-journey app), with most Pass 2/3 dispatches gated-skipping and Pass 4/5 per-journey work producing minimal incremental value over grouped probes once the app-wide-pattern catalogue existed. The first-pass-strict / subsequent-pass-relaxed rule captures the fidelity moment where it pays without burning context on incremental refinement that would have grouped naturally anyway.

**Onboarding front-load gate now asks the user to pick the run mode.** A new Step 0 prepends the onboarding front-load gate (`skills/onboarding/SKILL.md` §"Step 0 — Mode selection"). Before the three precondition checks, the user picks:

- **standard** (default, recommended) — first-pass / first-cycle strict, subsequent passes / cycles relaxed. Best for everyday onboarding.
- **depth** — strict parallel per-journey on every compositional pass, strict per-section on every discovery cycle. Up to ~20× more subagent dispatches and token spend than standard. Best for high-stakes audits, package-quality benchmarks, and first-time onboarding of business-critical apps where exhaustive per-unit fidelity matters.

The selection propagates as:

- Phase 4 (`journey-mapping`) — `args: "phases: full"` always; under depth the extra `cycle-strictness: depth` arg is added. The orchestrator writes `cycleStrictness: "depth"` into `.phase4-cycle-state.json`; the `standard-mode-first-pass-guard.sh` hook reads the field and denies single-agent cycle-N walkthroughs on every cycle (not just cycle 1).
- Phase 5 (`coverage-expansion`) — `args: "mode: standard"` or `args: "mode: depth"`. The orchestrator writes `runMode: "depth"` into `coverage-expansion-state.json`; the hook reads the field and denies `[group]` / `[P3-batch]` on every pass (not just Pass 1). Adversarial Passes 4-5 are strict-per-journey by default under depth (the `strict-adversarial: true` opt-in is implicit).

**`mode: depth` is now an active first-class option, not a backward-compat alias.** The prior alias semantics (`mode: depth` → `mode: standard` with one log line) are retired. `mode: depth` now actively triggers strict-parallel-everywhere semantics on coverage-expansion: no grouping on any pass, no single-agent collapse on any cycle. Operators must understand the cost trade-off — depth runs up to ~20× the subagent dispatch count of standard mode (every pass dispatches per-journey instead of grouping, every cycle dispatches per-section instead of relaxing; the multiplier compounds across the 5-pass coverage-expansion pipeline and the up-to-5-cycle journey-mapping pipeline). Pick depth only when exhaustive per-unit fidelity is worth the spend.

**Hook + schema-doc updates for depth mode.** `standard-mode-first-pass-guard.sh` now reads the `runMode` and `cycleStrictness` state-file fields and applies the per-mode rejection scope (Pass-1-only under standard, every-pass under depth; cycle-1-only under standard, every-cycle under depth). 11 new test cases added to `hooks/tests/cases/49-standard-mode-first-pass-guard.sh` covering the depth-mode denials and the standard-mode preservation paths. Total: 34 cases (was 23); full hook test suite still passes 100%. `schemas/subagent-returns/README.md` documents that the harness validator rejects `dispatch-mode: grouped` / `single-agent-collapsed` returns on every pass / cycle under depth, not just the first (no schema-shape change — the rejection is harness-side and mode-conditional).

---

## Public-dependency cleanup

The package now ships as a generic test-automation framework with no project-specific contamination in shipped surface (hooks, skills, schemas, README, CHANGELOG, package.json).

**Breaking changes:**

- Removed 7 hooks that were not appropriate for a public dependency:
  `bash-command-allowlist`, `commit-attribution-gate`, `commit-author-signature-guard`, `harness-trusted-state-write-guard`, `playwright-config-defaults-guard`, `test-data-discipline-guard`, `version-bump-authorisation-guard`. Project-specific commit policy, sandbox hardening, and state-file gating are now consumer concerns.
- Replaced the prose-with-YAML §2.0-§2.7 contents of `skills/element-interactions/references/subagent-return-schema.md` with machine-readable JSON Schema files under `schemas/subagent-returns/` (handover envelope + 6 role schemas, each with valid + invalid YAML fixtures).
- `subagent-return-schema-guard.sh` now validates returns via Ajv against the schema files, replacing the prior prose-regex shape checks.
- `schemas/` is now part of the published file surface (added to `package.json` `files` array).

**Preserved (explicitly):**

The process improvements that landed in the 0.3.6 PR are fully preserved:
- coverage-expansion relevance grouping + per-pass dedup
- journey-mapping iterative-cycle Phase-4 protocol
- journey-mapping cycle gate / edge-probe / structural-smell prevention
- group-aware bug-discovery probe dispatch

This release is a hook + schema cleanup, not a workflow regression.

**Non-breaking improvements:**

- All skills scrubbed of project-specific identifiers (banned token list enforced as `hooks/tests/cases/47-public-package-contamination-scan.sh`, a permanent CI gate that runs as part of `npm run test:hooks` and `prepack`).
- Skill prose no longer cites retired hooks by name.
- New schema-fixture validator (`scripts/validate-schema-fixtures.mjs`) exercises every role's valid and invalid fixtures.
- Postinstall prunes hooks retired in this and earlier releases from the user's `~/.claude/hooks/` on upgrade.
- `work-summary-deck` skill no longer hardcodes Civitas Cerebrum brand identity; output is unbranded by default.
- **New skill `secrets-sweep/`** — Phase-7 methodology for extracting credentials / API keys / PII / app URLs from the test suite into `.env`. Closes the prior pedagogical gap (Phase 7 was hardcoded in achilles but had no public skill).
- **Onboarding skill expanded** — `skills/onboarding/SKILL.md` is no longer a redirect; it is the umbrella eight-phase methodology document, usable from an interactive Claude Code session without the achilles harness. The phase map cross-links to each role-scoped skill.
- **Schema integrity** — `handover` is now `required` at the top level of every role schema (composer, reviewer-inloop, probe, phase-validator, section-agent, phase4-prioritise-author); composer's `status` is a closed enum of `{blocked, skipped, new-tests-landed, covered-exhaustively}`. Reverses an over-relaxation that had let envelope-less returns and arbitrary statuses pass.
- **Ajv configuration** — `hooks/lib/validate-against-schema.mjs` and `scripts/validate-schema-fixtures.mjs` now run Ajv with `allowUnionTypes: true` + `strictSchema: false` so the handover envelope's deliberate `cycle: integer | string` union compiles. Previously the validator threw on first use.
- **LICENSE** — added MIT `LICENSE` file at repo root (was declared in `package.json` but file was absent).
- **CHANGELOG ships with the tarball.** `CHANGELOG.md` added to `package.json` `files` so consumers reading from the npm tarball can see the release notes.
- **`probe` schema status enum closed.** `probe.schema.json` now constrains `handover.status` to `{clean, findings-emitted, blocked}` — the same set the `subagent-return-schema-guard.sh` registry-deregister logic recognises. Removes a drift hole between the schema and the hook.
- **Removed stale `hooks/test/` directory.** The 0.3.5-era regression-smoke suite referenced retired hooks (`journey-mapping-cycle-gate.sh`, `phase4-concurrency-log-format.sh`) and was no longer runnable. The active hook test suite under `hooks/tests/` is unaffected.
- **`hooks/data/canonical-sections.txt` header updated** to drop the retired-hook reference; the file remains the authoritative section vocabulary mirrored by `skills/journey-mapping/SKILL.md`.
- **Relevance-group cap unified to 7** across `coverage-expansion/SKILL.md` and `coverage-expansion/references/depth-mode-pipeline.md`. Three stale `cap 5` / `≤5` / `capped at 5` references contradicted the surrounding prose (which works the cap-7 math: `⌈28/7⌉ = 4 groups`, `9 → 7+2` split, `≥3 of 7` attention-rationing trend trigger). The relevance-group path and the P3-batch path both cap at 7 — the two paths differ on priority eligibility, not on size.
- **New hook `subagent-schema-preread-gate.sh`** (PreToolUse:Agent, DENY) — for schema-validated role prefixes (composer-, reviewer-, probe-, phase-validator-), the dispatching brief must reference the corresponding `<role>.schema.json` file. Closes the pre-dispatch half of the schema-discipline loop: a brief that doesn't tell the subagent what shape to produce is now rejected at dispatch time with a remediation pointer. Pairs with the existing PostToolUse `subagent-return-schema-guard.sh`. Important specifically for interactive Claude Code use without an orchestrator harness — where the human parent reading WARN messages was previously the only feedback channel. The pair is deliberately asymmetric in severity (PreToolUse DENY, PostToolUse WARN): the pre-dispatch gate is cheap to retry (the subagent hasn't spent any tokens yet) and the violation is unambiguous (citation present or absent); the post-validation is expensive to retry (subagent has already run) and may need parent-side judgment (e.g., partial conformance), so WARN preserves consumer flexibility.

**Migration for consumers:**

- Re-install or run `npm rebuild @civitas-cerebrum/element-interactions` to trigger postinstall hook pruning of stale guards.
- If you were validating subagent returns externally against `references/subagent-return-schema.md` prose §2.x, switch to `schemas/subagent-returns/<role>.schema.json` — the prose lives only at §1 (ledger format) and §3-§5 (caller contract / non-goals) now.

---
