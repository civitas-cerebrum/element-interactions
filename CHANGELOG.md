# Changelog

## Unreleased

**Public-dependency cleanup.** The package now ships as a generic test-automation framework with no project-specific contamination in shipped surface (hooks, skills, schemas, README, CHANGELOG, package.json).

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
- **New hook `subagent-schema-preread-gate.sh`** (PreToolUse:Agent, DENY) — for schema-validated role prefixes (composer-, reviewer-, probe-, phase-validator-), the dispatching brief must reference the corresponding `<role>.schema.json` file. Closes the pre-dispatch half of the schema-discipline loop: a brief that doesn't tell the subagent what shape to produce is now rejected at dispatch time with a remediation pointer. Pairs with the existing PostToolUse `subagent-return-schema-guard.sh`. Important specifically for interactive Claude Code use without an orchestrator harness — where the human parent reading WARN messages was previously the only feedback channel. The pair is deliberately asymmetric in severity (PreToolUse DENY, PostToolUse WARN): the pre-dispatch gate is cheap to retry (the subagent hasn't spent any tokens yet) and the violation is unambiguous (citation present or absent); the post-validation is expensive to retry (subagent has already run) and may need parent-side judgment (e.g., partial conformance), so WARN preserves consumer flexibility.

**Migration for consumers:**

- Re-install or run `npm rebuild @civitas-cerebrum/element-interactions` to trigger postinstall hook pruning of stale guards.
- If you were validating subagent returns externally against `references/subagent-return-schema.md` prose §2.x, switch to `schemas/subagent-returns/<role>.schema.json` — the prose lives only at §1 (ledger format) and §3-§5 (caller contract / non-goals) now.

---
