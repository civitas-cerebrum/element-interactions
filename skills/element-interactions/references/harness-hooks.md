# Harness hooks index

One-line discoverability layer for every harness-installed hook in this repo. Each entry cites the hook by **existence + event + purpose** and notes whether an escape hatch exists. The hook source file remains the canonical reference for full semantics (env-var names, sentinel paths, cap counts, deny-message wording, exit codes, payload field handling, settings.json registration, postinstall mechanics).

Skills that cite a hook should link this index once per skill rather than re-inlining hook internals.

Orchestrator-mode and cascade-routing concerns previously enforced by this package now live in external automated CLI drivers. This index documents only the hooks element-interactions still ships.

## PreToolUse

### Agent

- **[subagent-schema-preread-gate](../../../hooks/subagent-schema-preread-gate.sh)** — `PreToolUse:Agent`. Denies schema-validated role-prefixed dispatches whose brief omits the schema citation. [escape hatch: no]
- **[standard-mode-first-pass-guard](../../../hooks/standard-mode-first-pass-guard.sh)** — `PreToolUse:Agent`. First-pass / first-cycle strict-dispatch enforcement for `coverage-expansion` + `journey-mapping`. Denies: (a) Pass-1 `[group]` / `[P3-batch]` dispatches under `mode: standard`; (b) `phase4-prioritise-author:` dispatches before ≥ 2 distinct cycle-1 sections have been dispatched; (c) single-subagent walkthroughs of journey-mapping cycle 1 (≥ 3 canonical section IDs in one description with no prior cycle-1 dispatches). Pass-2+ and cycle-2+ are silent-allowed. [escape hatch: no]
- **[onboarding-ledger-gate](../../../hooks/onboarding-ledger-gate.sh)** — `PreToolUse:Agent`. Pipeline state-machine enforcement. Reads `tests/e2e/docs/onboarding-status.json` and denies (a) non-`workflow-reviewer-*` Agent dispatches at any transition point where the prior phase's `reviewerVerdict` is still `pending`; (b) out-of-order phase / pass / cycle dispatches (e.g. `phase4-*` while `currentPhase = 2`, `composer-j-…-2` while `pass-1.reviewerVerdict != approved`, `phase4-cycle-2-section-*` while `cycle-1.reviewerVerdict != approved`). `workflow-reviewer-*` dispatches always allowed. Silent-allow on missing / malformed ledger so a brand-new run can start. [escape hatch: no]

### Write|Edit

- **[onboarding-ledger-write-gate](../../../hooks/onboarding-ledger-write-gate.sh)** — `PreToolUse:Write|Edit`. Schema + state-machine integrity gate for writes to `tests/e2e/docs/onboarding-status.json`. Validates against `schemas/onboarding-status.schema.json` via the existing Ajv toolchain; additionally denies phase-skip ledger transitions that lack a `status: skipped` + `approvedDeviations[]` entry with a non-empty `authorizer`, and denies `reviewerVerdict: approved` paired with a null `handoverEnvelope`. Silent-allows on non-ledger writes and when node / ajv aren't available. [escape hatch: no]

### Bash

- **[commit-message-gate](../../../hooks/commit-message-gate.sh)** — `PreToolUse:Bash` (`git commit` only). Denies coverage-expansion / journey-mapping commits that violate the conventions (wrong type, multi-journey, hook-bypass flags). [escape hatch: no]
- **[playwright-cli-isolation-guard](../../../hooks/playwright-cli-isolation-guard.sh)** — `PreToolUse:Bash` (`playwright-cli`). Denies `playwright-cli` invocations missing the role-prefixed `-s=<slug>` isolation flag. [escape hatch: no]

## PostToolUse

- **[subagent-return-schema-guard](../../../hooks/subagent-return-schema-guard.sh)** — `PostToolUse:Agent`. Validates subagent-return canonical shape and drives the in-flight registry leash via the §2.0 handover envelope. [escape hatch: no]

## SubagentStop

- **[playwright-cli-cleanup-on-stop](../../../hooks/playwright-cli-cleanup-on-stop.sh)** — `SubagentStop`. Reaps orphaned per-subagent browser sessions via `playwright-cli close-all`. Never blocks. [escape hatch: no]
