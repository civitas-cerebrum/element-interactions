# Harness hooks index

One-line discoverability layer for every harness-installed hook in this repo. Each entry cites the hook by **existence + event + purpose** and notes whether an escape hatch exists. The hook source file remains the canonical reference for full semantics (env-var names, sentinel paths, cap counts, deny-message wording, exit codes, payload field handling, settings.json registration, postinstall mechanics).

Skills that cite a hook should link this index once per skill rather than re-inlining hook internals.

## PreToolUse

### Bash

- **[commit-attribution-gate](../../../hooks/commit-attribution-gate.sh)** — `PreToolUse:Bash` (`git commit` only). Surfaces missing `Reported-by:` attribution when a commit references a GitHub issue. [escape hatch: yes]
- **[commit-author-signature-guard](../../../hooks/commit-author-signature-guard.sh)** — `PreToolUse:Bash` (`git commit` only). Denies commits whose body carries an AI-assistant `Co-Authored-By:` trailer (Claude / Anthropic / borealis sentinels). [escape hatch: yes]
- **[commit-message-gate](../../../hooks/commit-message-gate.sh)** — `PreToolUse:Bash` (`git commit` only). Denies coverage-expansion / journey-mapping commits that violate the conventions (wrong type, multi-journey, hook-bypass flags, missing scope). [escape hatch: no]
- **[contribution-handover-gate](../../../hooks/contribution-handover-gate.sh)** — `PreToolUse:Bash` (`git push origin <branch>` and `gh pr create`). Denies push / PR-open without a populated `.contribution-handover.json`. [escape hatch: no]
- **[coverage-expansion-orchestrator-cli-block](../../../hooks/coverage-expansion-orchestrator-cli-block.sh)** — `PreToolUse:Bash` (`playwright-cli`). Denies orchestrator-side `playwright-cli` calls during an active coverage-expansion run. [escape hatch: no]
- **[playwright-cli-isolation-guard](../../../hooks/playwright-cli-isolation-guard.sh)** — `PreToolUse:Bash` (`playwright-cli`). Denies `playwright-cli` invocations missing the role-prefixed `-s=<slug>` isolation flag. [escape hatch: no]
- **[suite-gate-ratchet](../../../hooks/suite-gate-ratchet.sh)** — `PreToolUse:Bash` (also `PostToolUse:Bash`; one script, two events). Denies phase-progression commits when the windowed suite-run history is red, unfilled, or stale. [escape hatch: yes]
- **[version-bump-against-npm-guard](../../../hooks/version-bump-against-npm-guard.sh)** — `PreToolUse:Bash` (`npm version <X>`). Warns when an explicit semver bump misaligns with the published `latest`. [escape hatch: yes]
- **[version-bump-authorisation-guard](../../../hooks/version-bump-authorisation-guard.sh)** — `PreToolUse:Bash` (`npm version <X>`). Denies `npm version` invocations that lack the in-band `VERSION_BUMP_AUTHORISED=1` marker — release-time-only bumps must be explicitly authorised. [escape hatch: yes]

### Edit / Write

- **[contributing-skill-preread-guard](../../../hooks/contributing-skill-preread-guard.sh)** — `PreToolUse:Edit|Write|MultiEdit`. Denies edits to this package's contribution surface (`src/`, `hooks/`, `skills/`, `scripts/`, `package.json`, `tsconfig*.json`) without first reading the contributing-to-element-interactions skill in the current session. [escape hatch: yes]
- **[coverage-state-deferral-auth-guard](../../../hooks/coverage-state-deferral-auth-guard.sh)** — `PreToolUse:Write|Edit` (`coverage-expansion-state.json` only). Denies deferred-journey writes whose `reason` lacks an allowed structural prefix or an `authorizer:` quote of in-band user authorisation. [escape hatch: yes]
- **[coverage-state-schema-guard](../../../hooks/coverage-state-schema-guard.sh)** — `PreToolUse:Write|Edit` (`coverage-expansion-state.json` only). Denies malformed writes to the coverage-expansion state file. [escape hatch: no]
- **[failure-diagnosis-stage0-preread-guard](../../../hooks/failure-diagnosis-stage0-preread-guard.sh)** — `PreToolUse:Edit|Write`. Denies failure-diagnosis edits / bug-report writes that skip the documented Stage 0 context pre-read. [escape hatch: yes]
- **[journey-map-sentinel-guard](../../../hooks/journey-map-sentinel-guard.sh)** — `PreToolUse:Write|Edit` (`tests/e2e/docs/journey-map.md` only). Denies writes that strip the line-1 `<!-- journey-mapping:generated -->` sentinel. [escape hatch: no]
- **[playwright-config-defaults-guard](../../../hooks/playwright-config-defaults-guard.sh)** — `PreToolUse:Edit|Write` (`playwright.config.{ts,js,mjs,cjs}`). Warns when a config write strips documented `retries` / `video` / `trace` defaults. [escape hatch: yes]
- **[test-data-discipline-guard](../../../hooks/test-data-discipline-guard.sh)** — `PreToolUse:Edit|Write|MultiEdit` (`*.spec.{ts,js,…}` and `*.test.{ts,js,…}`). Denies hardcoded credentials (password / token / api_key / secret / bearer literals) in spec files unless the same line references `process.env.<NAME>`; warns on top-level magic constants outside a centralised test-data import. [escape hatch: yes (warn / off)]

### Agent

- **[coverage-expansion-dispatch-guard](../../../hooks/coverage-expansion-dispatch-guard.sh)** — `PreToolUse:Agent`. Denies dispatches missing a role-explicit prefix, asking for recursive sub-dispatch, or carrying orchestrator meta-content / batched-disguised-as-single payloads. [escape hatch: no]
- **[parent-only-orchestrator-dispatch-block](../../../hooks/parent-only-orchestrator-dispatch-block.sh)** — `PreToolUse:Agent`. Denies dispatching a parent-only orchestrator skill (coverage-expansion, onboarding, app-wide bug-discovery) as a subagent — the Agent / Task tool is parent-only and recursive fan-out hits a hard wall. [escape hatch: yes]
- **[phase-validator-dispatch-required](../../../hooks/phase-validator-dispatch-required.sh)** — `PreToolUse:Agent` (gate) + `PostToolUse:Agent` (record). Denies Phase N+1 dispatches without the Phase N validator greenlight in the ledger. [escape hatch: no]

### Skill

- **[skill-subagent-only-guard](../../../hooks/skill-subagent-only-guard.sh)** — `PreToolUse:Skill`. Denies orchestrator-context invocations of subagent-only skills (`failure-diagnosis`, `contributing-to-element-interactions`); their methodology is too heavy to load into orchestrator memory and must run inside a dispatched subagent. [escape hatch: no (test-only env override)]

### MCP

- **[mcp-browser-tool-redirect](../../../hooks/mcp-browser-tool-redirect.sh)** — `PreToolUse:mcp__plugin_playwright_playwright__browser_*`. Denies every MCP browser-tool call and redirects to the equivalent `playwright-cli` invocation. [escape hatch: no]

## PostToolUse

- **[coverage-expansion-direct-compose-block](../../../hooks/coverage-expansion-direct-compose-block.sh)** — `PostToolUse:Write|Edit` (journey spec files only). Denies orchestrator-direct journey-spec writes during an active coverage-expansion run. [escape hatch: no]
- **[raw-playwright-api-warning](../../../hooks/raw-playwright-api-warning.sh)** — `PostToolUse:Write|Edit` (`tests/e2e/*.spec.ts` only). Warns when a spec write contains a raw Playwright API call that has a Steps API equivalent. [escape hatch: no]
- **[subagent-return-schema-guard](../../../hooks/subagent-return-schema-guard.sh)** — `PostToolUse:Agent`. Validates subagent-return canonical shape and drives the in-flight registry leash via the §2.0 handover envelope. [escape hatch: no]

## Stop

- **[onboarding-pipeline-incomplete-stop-deny](../../../hooks/onboarding-pipeline-incomplete-stop-deny.sh)** — `Stop`. Blocks orchestrator Stop events while an onboarding pipeline is mid-flight without a user-authorised early-stop sentinel; auto-releases after a per-session block-cap. [escape hatch: yes]

## SubagentStop

- **[playwright-cli-cleanup-on-stop](../../../hooks/playwright-cli-cleanup-on-stop.sh)** — `SubagentStop`. Reaps orphaned per-subagent browser sessions via `playwright-cli close-all`. Never blocks. [escape hatch: no]
- **[subagent-spillover-rewrite-gate](../../../hooks/subagent-spillover-rewrite-gate.sh)** — `SubagentStop`. Blocks subagent stops whose returns violate §2.6 spillover (structured detail must move to a spill file when status triggers spillover); auto-releases after a per-agent retry cap. [escape hatch: no]
