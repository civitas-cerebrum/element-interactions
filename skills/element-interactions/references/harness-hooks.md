# Harness hooks index

One-line discoverability layer for every harness-installed hook in this repo. Each entry cites the hook by **existence + event + purpose** and notes whether an escape hatch exists. The hook source file remains the canonical reference for full semantics (env-var names, sentinel paths, cap counts, deny-message wording, exit codes, payload field handling, settings.json registration, postinstall mechanics).

Skills that cite a hook should link this index once per skill rather than re-inlining hook internals.

Orchestrator-mode and cascade-routing concerns previously enforced by this package now live in the achilles companion (`npx @civitas-cerebrum/achilles onboarding`). This index documents only the hooks element-interactions still ships.

## PreToolUse

### Bash

- **[commit-author-signature-guard](../../../hooks/commit-author-signature-guard.sh)** — `PreToolUse:Bash` (`git commit` only). Denies commits whose body carries an AI-assistant `Co-Authored-By:` trailer (Claude / Anthropic / borealis sentinels). [escape hatch: yes]
- **[commit-message-gate](../../../hooks/commit-message-gate.sh)** — `PreToolUse:Bash` (`git commit` only). Denies coverage-expansion / journey-mapping commits that violate the conventions (wrong type, multi-journey, hook-bypass flags). [escape hatch: no]
- **[playwright-cli-isolation-guard](../../../hooks/playwright-cli-isolation-guard.sh)** — `PreToolUse:Bash` (`playwright-cli`). Denies `playwright-cli` invocations missing the role-prefixed `-s=<slug>` isolation flag. [escape hatch: no]
- **[version-bump-authorisation-guard](../../../hooks/version-bump-authorisation-guard.sh)** — `PreToolUse:Bash` (`npm version <X>`). Denies `npm version` invocations that lack the in-band `VERSION_BUMP_AUTHORISED=1` marker — release-time-only bumps must be explicitly authorised. [escape hatch: yes]

### Edit / Write

- **[harness-trusted-state-write-guard](../../../hooks/harness-trusted-state-write-guard.sh)** — `PreToolUse:Write|Edit|MultiEdit|Bash`. Denies agent writes to harness-trusted state paths (stop-authorisation sentinels, the phase-validator ledger, the stop-deny counter family). [escape hatch: yes (`HARNESS_TRUSTED_WRITE_GUARD=off`, out-of-band only)]
- **[playwright-config-defaults-guard](../../../hooks/playwright-config-defaults-guard.sh)** — `PreToolUse:Edit|Write` (`playwright.config.{ts,js,mjs,cjs}`). Warns when a config write strips documented `retries` / `video` / `trace` defaults. [escape hatch: yes]
- **[test-data-discipline-guard](../../../hooks/test-data-discipline-guard.sh)** — `PreToolUse:Edit|Write|MultiEdit` (`*.spec.{ts,js,…}` and `*.test.{ts,js,…}`). Denies hardcoded credentials (password / token / api_key / secret / bearer literals) in spec files unless the same line references `process.env.<NAME>`; warns on top-level magic constants outside a centralised test-data import. [escape hatch: yes (warn / off)]

## PostToolUse

- **[subagent-return-schema-guard](../../../hooks/subagent-return-schema-guard.sh)** — `PostToolUse:Agent`. Validates subagent-return canonical shape and drives the in-flight registry leash via the §2.0 handover envelope. [escape hatch: no]

## SubagentStop

- **[playwright-cli-cleanup-on-stop](../../../hooks/playwright-cli-cleanup-on-stop.sh)** — `SubagentStop`. Reaps orphaned per-subagent browser sessions via `playwright-cli close-all`. Never blocks. [escape hatch: no]
