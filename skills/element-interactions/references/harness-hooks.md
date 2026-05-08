# Harness hooks index

One-line discoverability layer for every harness-installed hook in this repo. Each entry cites the hook by **existence + event + purpose** and notes whether an escape hatch exists. The hook source file remains the canonical reference for full semantics (env-var names, sentinel paths, cap counts, deny-message wording, exit codes, payload field handling, settings.json registration, postinstall mechanics).

Skills that cite a hook should link this index once per skill rather than re-inlining hook internals.

## PreToolUse

### Bash

- **[commit-attribution-gate](../../../hooks/commit-attribution-gate.sh)** — `PreToolUse:Bash` (`git commit` only). Surfaces missing `Reported-by:` attribution when a commit references a GitHub issue. [escape hatch: yes]
- **[commit-message-gate](../../../hooks/commit-message-gate.sh)** — `PreToolUse:Bash` (`git commit` only). Denies coverage-expansion / journey-mapping commits that violate the conventions (wrong type, multi-journey, hook-bypass flags, missing scope). [escape hatch: no]
- **[contribution-handover-gate](../../../hooks/contribution-handover-gate.sh)** — `PreToolUse:Bash` (`git push origin <branch>` and `gh pr create`). Denies push / PR-open without a populated `.contribution-handover.json`. [escape hatch: no]
- **[coverage-expansion-orchestrator-cli-block](../../../hooks/coverage-expansion-orchestrator-cli-block.sh)** — `PreToolUse:Bash` (`playwright-cli`). Denies orchestrator-side `playwright-cli` calls during an active coverage-expansion run. [escape hatch: no]
- **[playwright-cli-isolation-guard](../../../hooks/playwright-cli-isolation-guard.sh)** — `PreToolUse:Bash` (`playwright-cli`). Denies `playwright-cli` invocations missing the role-prefixed `-s=<slug>` isolation flag. [escape hatch: no]
- **[suite-gate-ratchet](../../../hooks/suite-gate-ratchet.sh)** — `PreToolUse:Bash` (also `PostToolUse:Bash`; one script, two events). Denies phase-progression commits when the windowed suite-run history is red, unfilled, or stale. [escape hatch: yes]
- **[version-bump-against-npm-guard](../../../hooks/version-bump-against-npm-guard.sh)** — `PreToolUse:Bash` (`npm version <X>`). Warns when an explicit semver bump misaligns with the published `latest`. [escape hatch: yes]

### Edit / Write

- **[coverage-state-schema-guard](../../../hooks/coverage-state-schema-guard.sh)** — `PreToolUse:Write|Edit` (`coverage-expansion-state.json` only). Denies malformed writes to the coverage-expansion state file. [escape hatch: no]
- **[failure-diagnosis-stage0-preread-guard](../../../hooks/failure-diagnosis-stage0-preread-guard.sh)** — `PreToolUse:Edit|Write`. Denies failure-diagnosis edits / bug-report writes that skip the documented Stage 0 context pre-read. [escape hatch: yes]
- **[journey-map-sentinel-guard](../../../hooks/journey-map-sentinel-guard.sh)** — `PreToolUse:Write|Edit` (`tests/e2e/docs/journey-map.md` only). Denies writes that strip the line-1 `<!-- journey-mapping:generated -->` sentinel. [escape hatch: no]
- **[playwright-config-defaults-guard](../../../hooks/playwright-config-defaults-guard.sh)** — `PreToolUse:Edit|Write` (`playwright.config.{ts,js,mjs,cjs}`). Warns when a config write strips documented `retries` / `video` / `trace` defaults. [escape hatch: yes]

### Agent

- **[coverage-expansion-dispatch-guard](../../../hooks/coverage-expansion-dispatch-guard.sh)** — `PreToolUse:Agent`. Denies dispatches missing a role-explicit prefix, asking for recursive sub-dispatch, or carrying orchestrator meta-content / batched-disguised-as-single payloads. [escape hatch: no]
- **[phase-validator-dispatch-required](../../../hooks/phase-validator-dispatch-required.sh)** — `PreToolUse:Agent` (gate) + `PostToolUse:Agent` (record). Denies Phase N+1 dispatches without the Phase N validator greenlight in the ledger. [escape hatch: no]

### MCP

- **[mcp-browser-tool-redirect](../../../hooks/mcp-browser-tool-redirect.sh)** — `PreToolUse:mcp__plugin_playwright_playwright__browser_*`. Denies every MCP browser-tool call and redirects to the equivalent `playwright-cli` invocation. [escape hatch: no]

## PostToolUse

- **[coverage-expansion-direct-compose-block](../../../hooks/coverage-expansion-direct-compose-block.sh)** — `PostToolUse:Write|Edit` (journey spec files only). Denies orchestrator-direct journey-spec writes during an active coverage-expansion run. [escape hatch: no]
- **[raw-playwright-api-warning](../../../hooks/raw-playwright-api-warning.sh)** — `PostToolUse:Write|Edit` (`tests/e2e/*.spec.ts` only). Warns when a spec write contains a raw Playwright API call that has a Steps API equivalent. [escape hatch: no]
- **[subagent-return-schema-guard](../../../hooks/subagent-return-schema-guard.sh)** — `PostToolUse:Agent`. Validates subagent-return canonical shape and drives the in-flight registry leash via the §2.0 handover envelope. [escape hatch: no]

## SubagentStop

- **[playwright-cli-cleanup-on-stop](../../../hooks/playwright-cli-cleanup-on-stop.sh)** — `SubagentStop`. Reaps orphaned per-subagent browser sessions via `playwright-cli close-all`. Never blocks. [escape hatch: no]
- **[subagent-spillover-rewrite-gate](../../../hooks/subagent-spillover-rewrite-gate.sh)** — `SubagentStop`. Blocks subagent stops whose returns violate §2.6 spillover (structured detail must move to a spill file when status triggers spillover); auto-releases after a per-agent retry cap. [escape hatch: no]
