# Playwright CLI Protocol — Canonical Browser-Automation Primitive

**Status:** single source of truth for live browser automation across the `@civitas-cerebrum/element-interactions` skill suite.
**Replaces:** the prior `mcp__plugin_playwright_playwright__*` MCP-tool protocol and the Rule-11-era "isolated MCP browser per subagent" prerequisite check.

Skills that need to drive a real browser — `journey-mapping`, `coverage-expansion`, `test-composer`, `bug-discovery`, `failure-diagnosis`, `companion-mode`, `element-interactions` (Stages 1–2), `onboarding` (Phases 2/3/5/6) — invoke `@playwright/cli` from the Bash tool. Sessions are isolated by design: there is no Rule-11-style prereq check, no `[mcp-isolation: serializing]` fallback, no `.mcp.json` to write.

---

## 1. Why CLI, not MCP

The MCP-isolation rule existed because two parallel subagents on one MCP browser fight over the active tab and corrupt each other's snapshots. That risk does not exist with the CLI: every `playwright-cli -s=<name> open` spawns its **own browser process** with its **own user-data directory**. Sessions are OS-isolated, not just labelled.

This was empirically validated on 2026-05-01: four parallel sessions opened against four different URLs each reported their own `location.href` and their own snapshot — no last-write-wins, no cross-contamination. Cookies, localStorage, and sessionStorage are per-session. See HANDOVER.md §"Validation log" for the test transcript.

Consequence: the orchestrator no longer needs to "confirm per-subagent isolation is achievable" before dispatching. The parent dispatches N subagents in parallel; each subagent issues `playwright-cli -s=<unique-slug> open ...` in its own Bash; the OS provides isolation.

---

## 2. Detection and install

### 2.1 Package install — automatic

`@playwright/cli` is a **hard `dependencies` entry** of `@civitas-cerebrum/element-interactions`. After `npm install @civitas-cerebrum/element-interactions`, the CLI binary is reachable via `npx playwright-cli ...` immediately — no extra `npm install -D @playwright/cli` step. The postinstall script confirms reachability and prints the version.

If `npx --no-install playwright-cli --version` ever returns non-zero in a project where this package is installed, treat it as a corrupted install (consumer's `node_modules` is incomplete). The fix is `npm install`, not a separate dep add.

### 2.2 Browser binary — one-shot, manual

Even with the CLI package installed, the browser binary is **not** fetched automatically — Playwright's `playwright-core` postinstall doesn't download chromium-headless-shell until requested. The first session against an uninstalled browser fails with a clear error. Pre-warm once per dev machine:

```bash
npx playwright-cli install-browser chromium
```

This downloads `chromium-headless-shell` (~93 MiB) into the Playwright browsers cache (`~/Library/Caches/ms-playwright/` on darwin). Subsequent sessions reuse it. The postinstall script prints a reminder of this command after every install.

### 2.3 Workspace artifacts

The CLI writes timestamped snapshot YAMLs to `.playwright-cli/` in the cwd at runtime. This directory **must** be in `.gitignore` — see Phase F of the migration. The scaffolded `.gitignore` shipped by `onboarding` includes it.

---

## 3. Session model

Every multi-session workflow uses the `-s=<name>` flag. Sessions are isolated browser processes; `<name>` is a label the agent uses for re-attachment, listing, and cleanup.

```bash
# parent process — open one session per parallel worker
playwright-cli -s=phase1-/dashboard open --browser=chromium http://app/dashboard
playwright-cli -s=phase1-/settings  open --browser=chromium http://app/settings

# from the same parent, drive a session by its name (no re-open)
playwright-cli -s=phase1-/dashboard --raw snapshot
playwright-cli -s=phase1-/dashboard click e5

# enumerate
playwright-cli list

# tear down
playwright-cli -s=phase1-/dashboard close
playwright-cli close-all      # graceful — close every session
playwright-cli kill-all       # forceful — only when close-all leaves zombies
```

### 3.1 Session-name convention

Use `<phase>-<role>-<slug>` so `playwright-cli list` reads as a workflow summary:

| Workflow | Convention | Example |
|---|---|---|
| `journey-mapping` Phase 1 (per entry point) | `phase1-<entry-slug>` | `phase1-root`, `phase1-mkt`, `phase1-login` |
| `coverage-expansion` Pass-N Stage A (compositional) | `<journey-slug>-<pass>-stage-a` | `j-checkout-3-stage-a` |
| `coverage-expansion` Pass-N Stage B (reviewer) | `<journey-slug>-<pass>-stage-b` | `j-checkout-3-stage-b` |
| `bug-discovery` per-journey adversarial | `<journey-slug>-bd` | `j-checkout-bd` |
| `failure-diagnosis` per-failure debug session | `fd-<short-slug>` | `fd-cart-update-flake` |
| `companion-mode` single-task verification | `companion-<task-slug>` | `companion-onb-form` |

Slugs use ASCII, lowercase, dash-separated. Avoid `/` (it appears in URL paths but is fine in session names — the CLI tolerates it; just be aware `playwright-cli list` will print the literal name).

**Slug-length budget — keep under ~25 chars on darwin.** The CLI opens a Unix domain socket at `$TMPDIR/pw-<8>/cli/<16-hash>-<slug>.sock`. macOS's `sockaddr_un.sun_path` caps at 104 bytes, and after the `pw-XXXXXXXX/cli/<16-hash>-` prefix you have only ~25–30 characters of slug headroom before `listen()` fails with `EINVAL`. Empirically observed during Phase-2 validation on book-hive-pw-cli: `phase1-marketplace` (18 chars) failed; `phase1-mkt` (10 chars) worked. The cap is per-socket-path, not per-slug-string, so `$TMPDIR` length matters too.

Practical guidance:

- Compose phase prefixes from short tokens: `phase1-`, `bd-`, `fd-`, `companion-`, plus `<journey-slug>-<pass>-stage-{a,b}` for coverage-expansion.
- Keep journey slugs to ≤12 chars where you can — `j-checkout`, not `j-checkout-with-coupon-and-card`.
- Compose the slug, then `wc -c <<< "<slug>"`; abort and shorten if it crosses 25 chars.
- Linux's 108-byte limit is slightly more forgiving but the same discipline keeps cross-OS portability cheap.

If a longer slug is unavoidable, set `TMPDIR=/tmp` for the run — a shorter base path buys back a few characters — but treat that as a workaround, not a fix.

### 3.2 Quarantine on start

Onboarding-style workflows (and any pipeline that may have been interrupted) should run `playwright-cli close-all` at the start to reap stale sessions from prior runs. A leftover named session blocks future `-s=<same-name> open`.

```bash
playwright-cli close-all >/dev/null 2>&1 || true
```

---

## 4. Output format and parsing

The CLI ships three output modes; agents pick whichever matches the next consumer.

### 4.1 Default

After every command, the CLI prints a status block with a `### Page` header (URL + title) and a `### Snapshot` line that points at a `.playwright-cli/page-<timestamp>.yml` file. This is the "tell me what just happened" mode and is what the existing journey-mapping and Stage-1 discovery prose expects.

### 4.2 `--raw`

Strips the wrapper and returns only the result value. Use it whenever a downstream consumer is a string parser.

| Command | `--raw` output |
|---|---|
| `--raw eval "location.href"` | `"http://localhost:4444/dashboard"` (string literal, JSON-quoted) |
| `--raw cookie-get sid` | `sid=abc123 (domain: localhost, path: /, httpOnly: false, secure: false, sameSite: Lax)` |
| `--raw localstorage-get theme` | `theme=dark` |
| `--raw snapshot` | YAML-ish ARIA tree (see §5) |

Subagent return validators (`subagent-return-schema.md`) keep their grep-based shape — `--raw` outputs are stable line-oriented strings that grep cleanly.

### 4.3 `--json`

Wraps the reply as JSON. Use when a downstream is a JSON parser:

```bash
playwright-cli --json snapshot
# { "snapshot": "- generic [active] [ref=e1]:\n  - heading \"Dashboard\" [level=1] [ref=e2]\n  ..." }

playwright-cli list --json
# [{"name":"phase1-/dashboard","status":"open","browser-type":"chrome-for-testing", ...}, ...]
```

---

## 5. Snapshots and ref-IDs

`playwright-cli snapshot` emits the same ARIA-role + ref-ID format as the prior `mcp__playwright__browser_snapshot` tool. **No translation layer is required** — every skill that previously consumed MCP snapshots reads CLI snapshots unchanged.

Format:

```
- generic [active] [ref=e1]:
  - heading "Dashboard" [level=1] [ref=e2]
  - generic [ref=e3]:
    - textbox [ref=e4]
    - button "Go" [ref=e5]
```

- Refs are `eN` (zero-prefixed integer counter, scoped to the snapshot).
- Roles are ARIA roles (`heading`, `textbox`, `button`, `link`, `combobox`, etc.).
- Active focus is marked `[active]`; nesting is YAML-indent.

Interaction commands take a ref:

```bash
playwright-cli click e5
playwright-cli fill e4 "user@example.com"
playwright-cli press Enter
```

CSS selectors and Playwright locators are also accepted (`playwright-cli click "#submit"`, `playwright-cli click "getByRole('button', { name: 'Submit' })"`). Prefer refs from a fresh snapshot for stability — refs change across snapshots, so always re-snapshot before a chain of clicks.

### 5.1 Snapshot scoping

For large pages, scope the snapshot to a region or limit depth:

```bash
playwright-cli snapshot e34            # only the subtree at ref e34
playwright-cli snapshot --depth=4      # whole page, capped at 4 levels
playwright-cli snapshot "#main"        # CSS-selector-anchored
```

`coverage-expansion` Stage A subagents typically scope to the journey's region of interest rather than snapshotting the whole page on every step.

---

## 6. Auth state via `state-save` / `state-load`

Pre-authenticated browser state replays cleanly across sessions. The replay flow is `open → state-load → reload`:

```bash
# capture
playwright-cli -s=auth open --browser=chromium http://app/login
playwright-cli -s=auth fill e1 "user@example.com"
playwright-cli -s=auth fill e2 "password"
playwright-cli -s=auth click e3
playwright-cli -s=auth state-save tests/e2e/.auth/admin.json
playwright-cli -s=auth close

# replay in a fresh worker session
playwright-cli -s=worker open --browser=chromium http://app/
playwright-cli -s=worker state-load tests/e2e/.auth/admin.json
playwright-cli -s=worker reload
playwright-cli -s=worker --raw snapshot   # post-login state
```

The state file is the standard Playwright `storageState` JSON: cookies + per-origin localStorage. Reuse it across `coverage-expansion` workers, `bug-discovery` probes, and `failure-diagnosis` debug sessions for the same role.

> **Note:** there is no `open --load-storage=<file>` flag. Always use `state-load` after `open`. If the page is already mounted, follow with `reload` so the page picks up the loaded cookies.

---

## 7. Lifecycle and cleanup

| Command | When |
|---|---|
| `playwright-cli list` | "What is currently open?" — diagnostic, before-and-after. |
| `playwright-cli -s=<name> close` | End-of-task per-session cleanup. |
| `playwright-cli close-all` | End-of-phase orchestrator cleanup; safe to run from a parent that has dispatched parallel subagents. |
| `playwright-cli kill-all` | Only when `close-all` leaves zombie chromium processes (see troubleshooting). |
| `playwright-cli -s=<name> delete-data` | Wipe persistent profile data for a named session. Only relevant when `--persistent` was used. |

Every parent that opened sessions is responsible for closing them. Compositional and adversarial subagents dispatched by `coverage-expansion` close their own sessions at the end of their brief; the parent runs `close-all` at the end of the pass as a belt-and-suspenders.

---

## 8. Dispatch-brief template

Subagent-dispatching skills (`coverage-expansion`, `journey-mapping` Phase 1, `bug-discovery`) embed this snippet in every browser-using subagent brief. It replaces the prior "Rule-11 isolated MCP" boilerplate.

```
## Browser automation

Use `@playwright/cli` from the Bash tool. Open your dedicated session at the start
of your work and close it at the end:

    npx playwright-cli -s=<your-session-slug> open --browser=chromium <START-URL>
    # ... your work ...
    npx playwright-cli -s=<your-session-slug> close

Your session slug for this run is: **<concrete-slug>**.

Do NOT share a session with any sibling subagent — siblings have their own slugs.
Do NOT call `close-all` (the parent owns that). Do NOT use `--persistent` unless
this brief explicitly asks for it.

Snapshot format and command surface: see
`skills/element-interactions/references/playwright-cli-protocol.md` §5 / §3.
```

The orchestrator picks the slug per the convention in §3.1 and substitutes it.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `The browser '<name>' is not open, please run open first` | Session was never opened, or was closed (e.g. by a sibling running `close-all`). | `playwright-cli -s=<name> open ...` first. Never run `close-all` while siblings are working. |
| `Error: listen EINVAL` on `playwright-cli -s=<long-slug> open` | Unix-socket path under `$TMPDIR/pw-<8>/cli/<16-hash>-<slug>.sock` exceeds `sockaddr_un.sun_path` (104 bytes on darwin). | Shorten the slug — see §3.1's slug-length budget. As a workaround, `TMPDIR=/tmp` shortens the base path. |
| Stale chromium processes after `close-all` | Crash mid-run; `close-all` reaps gracefully but a hung process can survive. | `playwright-cli kill-all` then `ps aux | grep chrome-headless` to confirm. |
| `cannot read state file` on `state-load` | Path is relative to cwd, not to the session's user-data dir. | Use absolute paths or paths relative to the project root, and verify with `ls`. |
| Snapshot contains stale `[ref=eN]`s after a click | Refs are scoped to the most recent snapshot. | Re-run `playwright-cli snapshot` after every navigation/state change before the next ref-based command. |
| Output has `### Page` / `### Snapshot` wrapper a parser can't tolerate | Default mode is the wrapped form. | Add `--raw` (strings) or `--json` (structured). |
| Browser version drift between dev machines | Each `@playwright/cli` minor pins a chrome-for-testing build. | `npx playwright-cli install-browser chromium` re-pins to the version expected by the installed CLI. |

---

## 10. Out-of-scope / known constraints

- **`@playwright/cli` is alpha (v0.1.x as of 2026-05-01).** It is shipped as a hard `dependencies` entry of `@civitas-cerebrum/element-interactions`, pinned to a specific patch version (currently `0.1.10`). When the CLI ships a breaking change, this package's pin is bumped on the same release that absorbs the change — consumers never have to think about CLI versions. The pin tightens (caret → exact) precisely *because* it's alpha; let it become `^X.Y.Z` only after 1.0.
- **Adopting Playwright's `init-agents --loop claude` planner/generator/healer agents** is out of scope for this protocol — those overlap with `journey-mapping`, `test-composer`, and `failure-diagnosis` and need a separate architectural discussion.
- **`playwright-cli attach --cdp=...`** (attach mode) is **not** isolated when sessions share a CDP endpoint — only `open` mode gives per-session browser-process isolation. Attach mode is fine for single-failure debug sessions in `failure-diagnosis` but must not be used by parallel-dispatch skills.
- **Persistent profiles (`--persistent`).** Use only when a brief explicitly requires it (e.g. testing extension state). Default to in-memory user-data dirs so concurrent runs don't trample each other.
