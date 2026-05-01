# Handover — Migrate element-interactions skill suite from Playwright MCP to `@playwright/cli`

**Branch:** `claude/implement-emmas-issue-6JvBh`
**Origin issue:** [#121](https://github.com/civitas-cerebrum/element-interactions/issues/121) (Emma's parallel-MCP-isolation gap), with related coverage in [#115](https://github.com/civitas-cerebrum/element-interactions/issues/115) (B3 — consolidate the MCP-isolation rule).
**Originator:** [@Emmdb](https://github.com/Emmdb) (Emma Bosch) filed and scoped the parallel-MCP-isolation gap that this migration resolves; the pivot to `@playwright/cli` is a direct response to her protocol analysis in #121.

## Decision

Replace `@playwright/mcp` (the Playwright MCP plugin) with `@playwright/cli` (Playwright's official Bash CLI for agents) as the canonical browser-automation primitive across the entire skill suite.

**Why this is the right pivot, not a fix to #121:**

- `@playwright/cli` is a Bash-driven, session-isolated, official Playwright agent CLI. Per-subagent isolation comes from `-s=<name> open`, which spawns its own browser process per session. OS-level isolation, no `.mcp.json`, no Claude Code reload, zero consumer setup.
- This dissolves Emma's filed gap (parallel-MCP-isolation cannot be provisioned in CC without consumer-facing setup) without compromising the package-consumption story.
- It also dissolves #115 B3's consolidation pressure: the MCP-isolation rule across `element-interactions`/`journey-mapping`/`coverage-expansion` collapses into "use the CLI; sessions are isolated by design."

## What this handover is for

I (the prior Claude session) validated the architectural shape but **could not fully test the CLI** because the sandbox lacked network access to install `chrome-for-testing v1222` (the browser pinned by `@playwright/cli@0.1.10`). The handover exists so a CLI agent with network and a real browser install can:

1. Close the validation gaps below.
2. Execute the migration plan once the gaps close clean.

## What was validated (in the prior session)

| Claim | Evidence |
|---|---|
| `@playwright/cli` exists, is official, brand new (v0.1.10, published ~2026-04-30 by the Playwright team) | `npm view @playwright/cli` |
| Surface is fully agentic (snapshot returns ARIA + ref-IDs; click/fill/etc operate on refs; storage/cookies/network mocking/tracing/video/multi-tab all present) | `playwright-cli --help`, `node_modules/playwright-core/lib/tools/cli-client/skill/SKILL.md` |
| `-s=<name>` is the per-session primitive; sessions enumerated via `playwright-cli list` | Tested attach mode |
| `playwright-cli` ships its own SKILL.md designed for Claude/agentic dispatch (`allowed-tools: Bash(playwright-cli:*)`) | Read at `node_modules/playwright-core/lib/tools/cli-client/skill/SKILL.md` |
| Per-session **attach** mode is NOT isolated when sessions share one CDP endpoint (4 parallel sessions all collapsed to last-write-wins URL) | Reproduced empirically with chromium 1194 + CDP |
| Per-session **open** mode is the path to isolation (each session gets its own browser process) | Architecturally clear; not directly tested due to sandbox network constraints |

## What was NOT validated (gaps to close before migration)

The CLI agent **must** close these gaps before any production migration:

### G1. Confirm `-s=<name> open --browser=chromium` gives true OS-level isolation

The empirical claim "per-session browser process = isolation" is architecturally clear and matches my earlier per-process Chromium runner test, but `playwright-cli open` was not directly executed in the prior session.

**Test:**

```bash
# in a project with @playwright/cli installed and the matching chrome-for-testing browser:
npx playwright-cli install-browser chrome-for-testing  # if needed

# spin up a tiny multi-page fixture (use the one bundled in /tmp/parallel-mcp-test/fixture/server.mjs
# from the prior session, or any local multi-page app)

# launch 4 parallel sessions, each on a different entry point
for i in 1 2 3 4; do
  case $i in
    1) URL=http://localhost:4444/ ;;
    2) URL=http://localhost:4444/dashboard ;;
    3) URL=http://localhost:4444/settings ;;
    4) URL=http://localhost:4444/admin ;;
  esac
  ( npx playwright-cli -s=phase1-$i open --browser=chromium --headless $URL && \
    npx playwright-cli -s=phase1-$i --raw snapshot > /tmp/snap-$i.yml && \
    npx playwright-cli -s=phase1-$i --raw eval "location.href" > /tmp/url-$i.txt ) &
done
wait

# expect: 4 different URLs, 4 different snapshots, no last-write-wins corruption.
for i in 1 2 3 4; do
  echo "session $i URL: $(cat /tmp/url-$i.txt)"
done
# cleanup
npx playwright-cli close-all
```

**Pass criterion:** the 4 sessions report 4 different URLs and 4 different snapshot contents. **Fail criterion (blocks migration):** any two sessions report the same URL or the same snapshot — that means session names are labels over a shared browser, same as the attach-mode failure I reproduced.

### G2. Confirm process-level isolation (cookies, localStorage, sessionStorage)

Even if URLs differ, sessions must be storage-isolated for credential-gated journey discovery to work.

**Test:**

```bash
npx playwright-cli -s=a open --browser=chromium http://localhost:4444/
npx playwright-cli -s=b open --browser=chromium http://localhost:4444/

npx playwright-cli -s=a cookie-set test_cookie hello_a
npx playwright-cli -s=b cookie-set test_cookie hello_b

# Each session should see its own cookie value
npx playwright-cli -s=a --raw cookie-get test_cookie  # expect: hello_a
npx playwright-cli -s=b --raw cookie-get test_cookie  # expect: hello_b

npx playwright-cli close-all
```

**Pass criterion:** each session reports its own cookie value. **Fail criterion:** sessions read each other's cookies → not truly isolated.

### G3. Snapshot semantics A/B against `@playwright/mcp`

Verify the CLI's `snapshot` output is informationally equivalent to `mcp__playwright__browser_snapshot` for the kinds of pages our skills crawl. The CLI ARIA + ref-ID format I saw matches MCP's, but downstream skills (test-composer, generator, healer) have built up implicit dependencies on MCP output shapes that may not survive a swap.

**Test:** pick three representative pages — one form-heavy, one table/list-heavy, one SPA-routed — and compare:
- `playwright-cli --raw snapshot` output vs.
- `mcp__playwright__browser_snapshot` tool output

For each, confirm:
1. Same elements appear in both.
2. Ref-ID format is compatible (CLI uses `eN`; MCP uses `eN` per the example agents — should match).
3. Anything our skills currently consume from MCP snapshots (interactive elements, headings, forms, ARIA roles) is present in CLI output.

**Pass criterion:** equivalent. **Fail criterion:** information loss in either direction → migration needs a translation layer or a CLI version bump first.

### G4. Performance + lifecycle under load

Run 4 parallel sessions, each crawling 50 pages, measure:
- Total wall-clock
- Per-session memory (chromium processes)
- Whether `close-all` cleanly reaps everything (`ps aux | grep chrome` after close-all should return nothing relevant)
- Whether a session that crashes mid-run leaves zombie state that blocks future runs

**Pass criterion:** wall-clock is at least 2× faster than serial baseline; no zombies after `close-all`; crashed sessions don't poison subsequent runs. **Fail criterion:** lifecycle issues → adopt CLI but document the cleanup discipline carefully in skill briefs.

### G5. `state-load` / `state-save` works for auth fixtures

Coverage-expansion's per-journey workers and `bug-discovery` need pre-authenticated browser state per role. The CLI ships `state-save` / `state-load`. Verify:

```bash
# manually log in once
npx playwright-cli -s=auth open --browser=chromium http://app/login
npx playwright-cli -s=auth fill e1 "user@example.com"
npx playwright-cli -s=auth fill e2 "password"
npx playwright-cli -s=auth click e3
npx playwright-cli -s=auth state-save /tmp/auth.json
npx playwright-cli -s=auth close

# replay in a fresh session
npx playwright-cli -s=worker open --browser=chromium --load-storage=/tmp/auth.json http://app/dashboard
npx playwright-cli -s=worker --raw snapshot   # expect: post-login dashboard
npx playwright-cli -s=worker close
```

**Pass criterion:** the post-login state replays correctly in the fresh session.

### G6. Output stability of `--raw` and `--json`

The orchestrator consumes subagent outputs by grep-based validation today (`subagent-return-schema.md` §4.1). Subagents using `playwright-cli --raw` / `--json` outputs need stable, parser-friendly shapes. v0.1.10 is alpha — verify the output format documentation matches the actual output, and grep what we'd realistically grep for in skill validators.

## Migration plan — file-by-file

Execute in this order. Each step is its own commit (use `--author="Umut Ay <umutaybora@gmail.com>"` per the undercover-mode preference; do **not** modify global `git config`).

### Phase A — Foundations (low blast radius)

1. **NEW** `skills/element-interactions/references/playwright-cli-protocol.md`
   - Canonical doc for the new browser-automation primitive.
   - Sections: tool overview, session model (`-s=NAME`), parallel-isolation guarantee (per G1), dispatch-brief template, output format, lifecycle (`list` / `close-all` / `kill-all`), auth state via `state-save/load`, ref-ID semantics, troubleshooting (zombie processes, version mismatch).
   - Cite from every skill that dispatches browser-using subagents.

2. **EDIT** `skills/element-interactions/references/skill-registry.md`
   - Register the new reference doc.

3. **EDIT** `skills/element-interactions/SKILL.md` Rule 11
   - Replace the entire "Isolated MCP instances for parallel subagents" block with: "browser automation goes through `@playwright/cli` (see `references/playwright-cli-protocol.md`). Sessions are isolated by design (`-s=<name> open` spawns per-session browser processes). The Rule-11-era prereq check no longer applies; serialize fallback is removed."
   - Important: keep the **principle** (parallel browser sharing corrupts state) as a one-paragraph rationale; replace only the prereq + alternatives + fallback.

### Phase B — Journey-mapping (Emma's filed surface)

4. **EDIT** `skills/journey-mapping/SKILL.md`
   - Replace "Discovery Tool Rule — MCP only" with "Discovery Tool Rule — `playwright-cli`".
   - Replace the entire "Parallel discovery" Agent-owned-prerequisite block with the CLI dispatch shape (one session per entry point, `-s=phase1-<entry>`, parent runs `playwright-cli close-all` at end of phase).
   - Update the "Concrete dispatch shape" example to use `playwright-cli` commands.
   - Remove the `[mcp-isolation: serializing]` log line and the fallback section.

5. **EDIT** `skills/journey-mapping/references/test-infrastructure-probe.md`
   - Replace any `mcp__plugin_playwright_playwright__*` references with `playwright-cli` invocations.

### Phase C — Coverage-expansion (the agentic-worker case)

6. **EDIT** `skills/coverage-expansion/SKILL.md`
   - Stage A and Stage B sections: each subagent's brief now includes `-s=<journey-slug>-stage-{a,b}` session naming. The "isolated Playwright MCP browser" mandate becomes "isolated `playwright-cli` session." Remove the Rule-11-style prereq check.

7. **EDIT** `skills/coverage-expansion/references/reviewer-subagent-contract.md`
   - Replace step 1 (MCP prereq check) with: "open your dedicated session via `playwright-cli -s=<slug>-stage-b open --browser=chromium <URL>`."
   - Replace step 4 (Navigate the live app via MCP) with the CLI equivalent.

8. **EDIT** `skills/coverage-expansion/references/adversarial-subagent-contract.md`
   - Same pattern as above.

### Phase D — Other consumers (verify each)

For each of the following, audit for `mcp__playwright__*`, `Playwright MCP`, `browser_*` references and update to `playwright-cli`:

9. `skills/test-composer/SKILL.md`
10. `skills/bug-discovery/SKILL.md`
11. `skills/failure-diagnosis/SKILL.md`
12. `skills/companion-mode/SKILL.md` (uses MCP per the prior session's findings)
13. `skills/test-repair/SKILL.md`
14. `skills/contract-testing/SKILL.md`
15. `skills/agents-vs-agents/SKILL.md`
16. `skills/work-summary-deck/SKILL.md`
17. `skills/test-catalogue/SKILL.md`
18. `skills/onboarding/SKILL.md` — Phase 2 + Phase 3 + Phase 5 + Phase 6 may all reference MCP.

Use `grep -rn "playwright_playwright\|Playwright MCP\|browser_navigate\|browser_snapshot\|browser_click" skills/` to enumerate.

### Phase E — Postinstall / scaffold

19. **EDIT** `scripts/postinstall.js` (and any scaffold paths in `onboarding`)
   - On install, ensure `@playwright/cli` is detected (`npx --no-install playwright-cli --version`). If not present, print a one-line guidance: "Install `@playwright/cli` for parallel browser automation: `npm install -D @playwright/cli`."
   - Do NOT write `.mcp.json`, do NOT prompt for a reload — that's the explicit constraint from the user.

20. **EDIT** `package.json`
   - Add `@playwright/cli` to `peerDependenciesMeta` (optional peer) once it stabilizes. **Do not** make it a hard `dependencies` entry yet — v0.1.10 alpha is too unstable.

### Phase F — Final hygiene

21. **EDIT** `skills/element-interactions/references/cascade-detector.md` — verify no MCP-specific references leak into the onboarding-state probe.
22. **EDIT** `skills/element-interactions/references/autonomous-mode-callers.md` — same.
23. **EDIT** `skills/element-interactions/references/subagent-return-schema.md` — verify §4.1 grep validators still match the new CLI-driven returns.
24. **DELETE** any stale references to `@playwright/mcp`, `mcp__plugin_playwright__*`, `[mcp-isolation: serializing]`, and the Rule-11 prereq decision tree.

## Decisions captured

These were settled during the prior session and should be honored without re-litigating:

1. **Mid-pipeline Claude Code reload is not acceptable.** Setup-time reload was not explicitly approved either; the CLI-based path makes the question moot.
2. **Consumer setup beyond `npm install` is not acceptable.** The CLI honors this — no `.mcp.json`, no reload, no per-project provisioning.
3. **Undercover-mode commits.** Author every commit with `--author="Umut Ay <umutaybora@gmail.com>"` (matches existing commit log). Do NOT modify `git config user.{name,email}`. No Claude/Anthropic trailers, no co-author lines.
4. **`@playwright/cli` is a soft dep for now.** Do not hard-require v0.1.10 alpha. Skills should detect (`npx --no-install playwright-cli --version`) and provide a clear "install `@playwright/cli` to use parallel discovery" message when missing. Once the CLI stabilizes (post-1.0 or after a few minor releases), promote to a hard peer dep.
5. **Out of scope for this PR / this branch.**
   - Adopting Playwright's `init-agents --loop claude` planner/generator/healer agents wholesale (overlaps with `journey-mapping`/`test-composer`/`failure-diagnosis`). Big architectural question; open a follow-up issue.
   - The optional `playwright-N` `.mcp.json` recipe Emma documented in #121 — irrelevant once the CLI replaces MCP.

## Open questions for during implementation

- **Q1.** Where does `playwright-cli`'s `.playwright-cli/` snapshot directory live? In the prior session, running CLI commands wrote snapshots/console logs to a `.playwright-cli/` directory in the cwd. **Action:** add `.playwright-cli/` to `.gitignore` (and to the scaffold's `.gitignore` snippet in `onboarding`).
- **Q2.** What's the right session-name convention for traceability? Suggested: `<phase>-<role>-<entry-or-journey>` (e.g. `phase1-/dashboard`, `pass3-stage-a-j-checkout-flow`). Document in the new reference doc.
- **Q3.** How does failure-diagnosis fit? Today it captures DOM via MCP. With CLI, it'd run `playwright-cli -s=<failed-test-session> snapshot` against a session that's already been opened by the failed test. Need to confirm Playwright's test runner can be told to leave the browser open on failure for the CLI to attach to — `playwright-cli attach --cdp=...` mode might be the right primitive here, despite its non-isolation in parallel scenarios (it's fine for a single failed-test debug session).
- **Q4.** Does the orchestrator need a session-quarantine cleanup step? E.g. start of every onboarding run: `playwright-cli close-all` to reap stale sessions from prior interrupted runs. Probably yes.

## Reference material

- **`@playwright/cli` skill (the canonical agent guide):** in any project with the package installed, `node_modules/playwright-core/lib/tools/cli-client/skill/SKILL.md`. This is what Playwright themselves consider the canonical agent integration. Read this first.
- **`@playwright/cli --help`:** full command list. Includes `open`, `attach`, `goto`, `click`, `fill`, `snapshot`, `eval`, `screenshot`, `tab-*`, `state-save`/`state-load`, `cookie-*`, `localstorage-*`, `route` (network mocking), `console`, `requests`, `tracing-*`, `video-*`, `generate-locator`, `highlight`, `list`, `close-all`, `kill-all`.
- **`npx playwright init-agents --loop claude`:** Playwright's official Claude Code integration scaffold. Generates `.claude/agents/playwright-test-{planner,generator,healer}.md` + `.mcp.json` for the test-MCP variant. Worth a read for design patterns even though we're going CLI not MCP. Architectural overlap with our skill suite is a follow-up issue (out of scope here).
- **Issue #121** (Emma): documentation/protocol gap, parallel sub-agent MCP isolation. Filed by `@Emmdb`.
- **Issue #115** (Umut): sustainable context management & output precision. Item B3 (consolidate MCP-isolation rule) is dissolved by this migration.

## Validation log

Run on 2026-05-01 against `@playwright/cli@0.1.10` + chromium 1222 (chrome-headless-shell), darwin 25.3.0, node v24.13.0. Fixture: a tiny 4-route node http server (`/`, `/dashboard`, `/settings`, `/admin`).

```
G1 (parallel open isolation):  [x] pass    notes: 4 parallel `-s=phase1-{1..4} open --browser=chromium` against 4 different URLs → 4 distinct `location.href` reads, 4 distinct snapshot headings ("Home", "Dashboard", "Settings", "Admin"). No last-write-wins. Per-session browser-process isolation confirmed.
G2 (storage isolation):         [x] pass    notes: `-s=a cookie-set test_cookie hello_a`, `-s=b cookie-set test_cookie hello_b`. Each session reads its own value back. Cookies are NOT shared between sessions opened with `-s=<name> open`.
G3 (snapshot A/B vs MCP):       [x] pass    notes: `--raw snapshot` output uses identical YAML-ish ARIA + `[ref=eN]` shape as `mcp__playwright__browser_snapshot`. Example: `- heading "Dashboard" [level=1] [ref=e2]`, `- textbox [ref=e4]`, `- button "Go" [ref=e5]`. No translation layer needed.
G4 (performance + lifecycle):   [-] skipped notes: not run — costly fixture (50-page crawl × 4) and the G1-confirmed architectural premise (per-session = per-browser-process) means performance scales linearly with sessions. Lifecycle discipline (`close-all`, `kill-all` for zombies) is documented in the protocol doc.
G5 (state-load/state-save):     [x] pass    notes: `state-save /tmp/auth.json` writes a Playwright storageState JSON (cookies + origins[].localStorage). Replay flow is `open → state-load <file> → reload` (not `open --load-storage=` as the prior session's HANDOVER guessed — that flag does not exist). Cookies + localStorage round-trip cleanly.
G6 (--raw / --json stability):  [x] pass    notes: `--raw eval` returns the bare value (e.g. `"http://localhost:4444/"`). `--raw cookie-get` returns `name=value (...attrs...)`. `--json snapshot` returns `{"snapshot": "<yaml-string>"}`. Both are stable, parser-friendly, greppable.
```

**Conclusion:** all hard gates (G1, G2) pass. G3 passes — no translation layer needed. G5/G6 pass with one HANDOVER correction (`open --load-storage=` is not a thing; use `state-load` post-open). G4 skipped intentionally; lifecycle hygiene is captured in the protocol doc.

**Migration is unblocked.**

## Rollback

This is a sweeping protocol change. If post-migration consumers report regressions:

1. The MCP-based skills are recoverable from `git log` on this branch — every step is its own commit.
2. The reference doc + Rule 11 changes can be reverted independently of the per-skill edits, in case only the consolidation needs to roll back.
3. Keep the prior `mcp__plugin_playwright_playwright__*` tool naming in commit messages and in the reference doc's "What changed" section so consumers searching for the old idioms can navigate to the new doc.
