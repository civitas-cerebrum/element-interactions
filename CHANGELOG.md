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

**Migration for consumers:**

- Re-install or run `npm rebuild @civitas-cerebrum/element-interactions` to trigger postinstall hook pruning of stale guards.
- If you were validating subagent returns externally against `references/subagent-return-schema.md` prose §2.x, switch to `schemas/subagent-returns/<role>.schema.json` — the prose lives only at §1 (ledger format) and §3-§5 (caller contract / non-goals) now.

---
