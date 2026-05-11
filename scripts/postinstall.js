#!/usr/bin/env node

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const os    = require('os');
const { spawnSync } = require('child_process');

const packageDir  = path.resolve(__dirname, '..');
const skillsDir   = path.join(packageDir, 'skills');

// When installed as a dependency, __dirname is:
//   <project>/node_modules/@civitas-cerebrum/element-interactions/scripts
// so four levels up reaches the consumer's project root.
const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');

// Skip when running in the package's own repo (local dev `npm install`).
if (!packageDir.includes('node_modules')) {
  process.exit(0);
}

const homeDir = os.homedir();

// Install to both project-level and user-level .claude/skills/ directories.
// Project-level ensures the correct version is available for this project.
// User-level ensures stale skills from older installs are overwritten,
// preventing outdated user-level files from taking precedence.
const destinations = [
  path.join(projectRoot, '.claude', 'skills'),
  path.join(homeDir, '.claude', 'skills'),
];

// Auto-discover every skill under skills/. A skill is any direct subdirectory
// of skills/ that contains a SKILL.md at its root. This keeps installs in sync
// with the repo automatically — add a new skill folder and it ships on the next
// publish; no manifest edit required.
function discoverSkills(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => fs.existsSync(path.join(root, name, 'SKILL.md')));
}

// Recursively copy one skill directory. Copies SKILL.md and the whole
// references/ tree — everything SKILL.md's instructions refer to.
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const skills = discoverSkills(skillsDir);

try {
  const installedSkills = new Set();

  for (const skillsDestBase of destinations) {
    for (const skill of skills) {
      const srcDir = path.join(skillsDir, skill);
      const destDir = path.join(skillsDestBase, skill);

      copyDirRecursive(srcDir, destDir);
      installedSkills.add(skill);
    }
  }

  if (installedSkills.size > 0) {
    console.log(`[@civitas-cerebrum/element-interactions] ✔ ${installedSkills.size} skill${installedSkills.size > 1 ? 's' : ''} installed to ${destinations.length} locations — restart Claude Code to pick it up.`);
  } else {
    console.warn('[@civitas-cerebrum/element-interactions] Skill files not found, skipping.');
  }
} catch (err) {
  console.warn(`[@civitas-cerebrum/element-interactions] Could not install Claude Code skill: ${err.message}`);
}

// Install the @civitas-cerebrum/element-interactions harness hooks into the
// user's ~/.claude/hooks/ directory and register them in ~/.claude/settings.json.
// Markdown rules in the skills ("dispatch one journey per Agent call",
// "use playwright-cli not the MCP browser tools", "preserve the journey-map
// sentinel", etc.) are skippable; the harness-level hooks are not.
//
// Per-hook manifest below — each entry: { file, event, matcher, timeout?, async? }.
//   file     — script name in <package>/hooks/, copied to ~/.claude/hooks/<file>
//   event    — PreToolUse | PostToolUse | SubagentStop | Stop | …
//   matcher  — tool-name match string for the event (null for events without
//              matchers, e.g. SubagentStop)
//   timeout  — seconds the harness waits before killing the hook (default 10)
//   async    — true for fire-and-forget hooks (used for cleanup)
//
// Idempotent:
//   - Each hook file is copied iff missing or older than the bundled version.
//   - Each settings.json entry is added iff a matching {event, matcher, command}
//     triple is not already registered. Pre-existing user hooks are preserved.
//
// Opt-out: set CIVITAS_SKIP_HOOK_INSTALL=1 — useful for enterprise managed
// settings where postinstall scripts must not modify ~/.claude/settings.json.
const MCP_PLAYWRIGHT_BROWSER_TOOLS = [
  'mcp__plugin_playwright_playwright__browser_click',
  'mcp__plugin_playwright_playwright__browser_close',
  'mcp__plugin_playwright_playwright__browser_console_messages',
  'mcp__plugin_playwright_playwright__browser_drag',
  'mcp__plugin_playwright_playwright__browser_drop',
  'mcp__plugin_playwright_playwright__browser_evaluate',
  'mcp__plugin_playwright_playwright__browser_file_upload',
  'mcp__plugin_playwright_playwright__browser_fill_form',
  'mcp__plugin_playwright_playwright__browser_handle_dialog',
  'mcp__plugin_playwright_playwright__browser_hover',
  'mcp__plugin_playwright_playwright__browser_navigate',
  'mcp__plugin_playwright_playwright__browser_navigate_back',
  'mcp__plugin_playwright_playwright__browser_network_request',
  'mcp__plugin_playwright_playwright__browser_network_requests',
  'mcp__plugin_playwright_playwright__browser_press_key',
  'mcp__plugin_playwright_playwright__browser_resize',
  'mcp__plugin_playwright_playwright__browser_run_code_unsafe',
  'mcp__plugin_playwright_playwright__browser_select_option',
  'mcp__plugin_playwright_playwright__browser_snapshot',
  'mcp__plugin_playwright_playwright__browser_tabs',
  'mcp__plugin_playwright_playwright__browser_take_screenshot',
  'mcp__plugin_playwright_playwright__browser_type',
  'mcp__plugin_playwright_playwright__browser_wait_for',
].join('|');

const HOOK_MANIFEST = [
  // PreToolUse — guards (fail-closed)
  { file: 'coverage-expansion-dispatch-guard.sh', event: 'PreToolUse', matcher: 'Agent',       timeout: 10 },
  { file: 'parent-only-orchestrator-dispatch-block.sh', event: 'PreToolUse', matcher: 'Agent', timeout: 10 },
  { file: 'phase-validator-dispatch-required.sh', event: 'PreToolUse', matcher: 'Agent',       timeout: 10 },
  { file: 'playwright-cli-isolation-guard.sh',    event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'coverage-expansion-orchestrator-cli-block.sh', event: 'PreToolUse', matcher: 'Bash', timeout: 10 },
  { file: 'commit-message-gate.sh',               event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'commit-attribution-gate.sh',           event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'version-bump-against-npm-guard.sh',    event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'version-bump-authorisation-guard.sh',  event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'commit-author-signature-guard.sh',     event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'suite-gate-ratchet.sh',                event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'journey-map-sentinel-guard.sh',        event: 'PreToolUse', matcher: 'Write|Edit',  timeout: 10 },
  { file: 'coverage-state-schema-guard.sh',       event: 'PreToolUse', matcher: 'Write|Edit',  timeout: 10 },
  { file: 'coverage-state-deferral-auth-guard.sh', event: 'PreToolUse', matcher: 'Write|Edit', timeout: 10 },
  { file: 'playwright-config-defaults-guard.sh',  event: 'PreToolUse', matcher: 'Write|Edit',  timeout: 10 },
  { file: 'failure-diagnosis-stage0-preread-guard.sh', event: 'PreToolUse', matcher: 'Write|Edit', timeout: 10 },
  { file: 'contributing-skill-preread-guard.sh',  event: 'PreToolUse', matcher: 'Write|Edit|MultiEdit', timeout: 10 },
  { file: 'test-data-discipline-guard.sh',        event: 'PreToolUse', matcher: 'Write|Edit|MultiEdit', timeout: 10 },
  { file: 'mcp-browser-tool-redirect.sh',         event: 'PreToolUse', matcher: MCP_PLAYWRIGHT_BROWSER_TOOLS, timeout: 10 },
  { file: 'skill-subagent-only-guard.sh',         event: 'PreToolUse', matcher: 'Skill',       timeout: 10 },
  { file: 'using-superpowers-carveout-guard.sh',  event: 'PreToolUse', matcher: 'Skill',       timeout: 10 },
  { file: 'happy-path-discovery-draft-required.sh', event: 'PreToolUse', matcher: 'Agent',     timeout: 10 },
  { file: 'journey-mapping-cycle-gate.sh',        event: 'PreToolUse', matcher: 'Agent',       timeout: 10 },
  { file: 'phase4-concurrency-log-format.sh',     event: 'PreToolUse', matcher: 'Write|Edit',  timeout: 10 },
  { file: 'phase4-concurrency-log-format.sh',     event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'benchmark-write-guard.sh',             event: 'PreToolUse', matcher: 'Write|Edit',  timeout: 10 },
  { file: 'onboarding-report-write-guard.sh',     event: 'PreToolUse', matcher: 'Write|Edit',  timeout: 10 },
  // harness-trusted-state-write-guard — closes the BookHive Run-4 self-authorisation
  // exploit chain (self-authored stop sentinel + self-written phase-validator ledger).
  // Denies agent writes to .claude/onboarding-stop-authorized,
  // tests/e2e/docs/.onboarding-stop-authorized, and tests/e2e/docs/onboarding-phase-ledger.json
  // via Write/Edit/MultiEdit AND via Bash file-creation operators (touch, > , tee, mv, cp,
  // ln -s, dd of=). Out-of-band escape: HARNESS_TRUSTED_WRITE_GUARD=off.
  { file: 'harness-trusted-state-write-guard.sh', event: 'PreToolUse', matcher: 'Write|Edit|MultiEdit', timeout: 10 },
  { file: 'harness-trusted-state-write-guard.sh', event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  // bash-command-allowlist — sandbox the agent's Bash tool to a verb
  // allowlist. BookHive Run-5 rounds 3-6 closed 22 specific bash exploit
  // shapes (quoted redirects, FD-numbered redirects, process substitution,
  // script-source bodies, hardlinks, $() inside commit messages, etc.).
  // The structural cause is bash being Turing-complete — no regex set
  // enumerates every exfil shape. This hook inverts the denylist: only
  // allowlisted verbs (npm/npx/git/gh/playwright/ls/cat/...) are accepted;
  // everything else denied. Runs alongside trusted-state-write-guard as
  // defense-in-depth. Out-of-band escape: CIVITAS_BASH_ALLOWLIST=off.
  { file: 'bash-command-allowlist.sh',            event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },

  // PostToolUse — observers (record + warn)
  { file: 'suite-gate-ratchet.sh',                event: 'PostToolUse', matcher: 'Bash',       timeout: 10 },
  { file: 'task-update-phase-ledger-audit.sh',    event: 'PostToolUse', matcher: 'TodoWrite|TaskUpdate|TaskCreate|Task', timeout: 10 },
  { file: 'raw-playwright-api-warning.sh',        event: 'PostToolUse', matcher: 'Write|Edit', timeout: 10 },
  { file: 'subagent-return-schema-guard.sh',      event: 'PostToolUse', matcher: 'Agent',      timeout: 10 },
  { file: 'coverage-expansion-direct-compose-block.sh', event: 'PostToolUse', matcher: 'Write|Edit', timeout: 10 },
  { file: 'phase-validator-dispatch-required.sh', event: 'PostToolUse', matcher: 'Agent',      timeout: 10 },
  { file: 'happy-path-discovery-draft-required.sh', event: 'PostToolUse', matcher: 'Agent',    timeout: 10 },
  { file: 'journey-mapping-cycle-gate.sh',        event: 'PostToolUse', matcher: 'Agent',      timeout: 10 },

  // SubagentStop — enforcement (must run synchronously) + cleanup (async)
  { file: 'subagent-spillover-rewrite-gate.sh',   event: 'SubagentStop', matcher: null,        timeout: 10 },
  { file: 'playwright-cli-cleanup-on-stop.sh',    event: 'SubagentStop', matcher: null,        timeout: 30, async: true },

  // Stop — main-agent stop guards
  { file: 'onboarding-pipeline-incomplete-stop-deny.sh', event: 'Stop',  matcher: null,        timeout: 10 },
];

function copyHookFile(hookSrc, hookDest) {
  let shouldCopy = !fs.existsSync(hookDest);
  if (!shouldCopy) {
    try {
      const srcMtime  = fs.statSync(hookSrc).mtimeMs;
      const destMtime = fs.statSync(hookDest).mtimeMs;
      shouldCopy = srcMtime > destMtime;
    } catch (_) {
      shouldCopy = true;
    }
  }
  if (shouldCopy) {
    fs.copyFileSync(hookSrc, hookDest);
    fs.chmodSync(hookDest, 0o755);
  }
  return shouldCopy;
}

function registerHookInSettings(settings, entry, hookDest) {
  const { event, matcher, timeout, async: isAsync } = entry;

  settings.hooks = settings.hooks || {};
  settings.hooks[event] = settings.hooks[event] || [];

  // Find an existing matcher group for this {event, matcher} pair. matcher may
  // be null (e.g. SubagentStop has no matcher) — match nullish-to-nullish.
  let group = settings.hooks[event].find(g => g && (g.matcher || null) === (matcher || null));
  if (!group) {
    group = matcher ? { matcher, hooks: [] } : { hooks: [] };
    settings.hooks[event].push(group);
  }
  group.hooks = group.hooks || [];

  const alreadyRegistered = group.hooks.some(h =>
    h && h.type === 'command' && h.command === hookDest
  );
  if (alreadyRegistered) {
    return false;
  }

  const hookEntry = { type: 'command', command: hookDest };
  if (typeof timeout === 'number') hookEntry.timeout = timeout;
  if (isAsync === true) hookEntry.async = true;
  group.hooks.push(hookEntry);
  return true;
}

function installCivitasHooks() {
  if (process.env.CIVITAS_SKIP_HOOK_INSTALL === '1') {
    console.log('[civitas-cerebrum] CIVITAS_SKIP_HOOK_INSTALL=1 — harness hook install skipped.');
    return;
  }

  const userHooksDir = path.join(homeDir, '.claude', 'hooks');
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');
  fs.mkdirSync(userHooksDir, { recursive: true });

  // Load current settings.json (or {} if missing). Bail out preserving the
  // file on parse error — never overwrite malformed user config.
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, 'utf8').trim();
      settings = raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.warn(`[civitas-cerebrum] Could not parse ${settingsPath} — leaving it untouched. (${err.message})`);
      return;
    }
  }

  let copiedCount = 0;
  let registeredCount = 0;
  let settingsModified = false;

  for (const entry of HOOK_MANIFEST) {
    const hookSrc = path.join(packageDir, 'hooks', entry.file);
    if (!fs.existsSync(hookSrc)) {
      // Bundled hook missing — silently skip; don't fail consumer's npm install.
      continue;
    }
    const hookDest = path.join(userHooksDir, entry.file);

    if (copyHookFile(hookSrc, hookDest)) copiedCount++;
    if (registerHookInSettings(settings, entry, hookDest)) {
      registeredCount++;
      settingsModified = true;
    }
  }

  if (settingsModified) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  console.log(`[civitas-cerebrum] Harness hooks: ${copiedCount} script${copiedCount === 1 ? '' : 's'} copied, ${registeredCount} registration${registeredCount === 1 ? '' : 's'} added (others already present). Restart Claude Code to pick them up.`);
}

// Bundle a pinned `jq` binary alongside the harness hooks. The hooks parse
// JSON event payloads via jq; without it, every hook crashes with
// `jq: command not found` — silent non-blocking failures on PostToolUse,
// accept-all on PreToolUse. Closes #165.
//
// Approach (mirrors the @playwright/cli + chromium delivery idiom):
//   - Fetch jq 1.7.1 from the official jqlang/jq GitHub release.
//   - Land it at ~/.claude/hooks/bin/jq (chmod +x).
//   - Hooks resolve via `${BASH_SOURCE[0]}/bin/jq` with system-jq fallback
//     so the in-repo test suite still works before postinstall has run.
//
// Opt-out: set CIVITAS_SKIP_JQ_INSTALL=1 — useful for enterprise managed
// installs where postinstall scripts must not download external binaries.
const JQ_VERSION = '1.7.1';
const JQ_MIN_SIZE_BYTES = 100 * 1024; // anything smaller is a truncated download

function jqAssetForPlatform() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin' && a === 'arm64') return 'jq-macos-arm64';
  if (p === 'darwin' && a === 'x64')   return 'jq-macos-amd64';
  if (p === 'linux'  && a === 'x64')   return 'jq-linux-amd64';
  if (p === 'linux'  && a === 'arm64') return 'jq-linux-arm64';
  if (p === 'win32'  && a === 'x64')   return 'jq-windows-amd64.exe';
  return null;
}

// GET with redirect-following. GitHub release-asset URLs respond 302 to a
// codeload / objects.githubusercontent.com CDN, so we follow up to a small
// number of hops. Resolves with an open IncomingMessage on the final 200.
function httpsGetFollow(url, hopsLeft, cb) {
  https.get(url, (res) => {
    const status = res.statusCode || 0;
    if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && res.headers.location) {
      res.resume();
      if (hopsLeft <= 0) return cb(new Error(`too many redirects fetching ${url}`));
      const next = new URL(res.headers.location, url).toString();
      return httpsGetFollow(next, hopsLeft - 1, cb);
    }
    if (status !== 200) {
      res.resume();
      return cb(new Error(`HTTP ${status} fetching ${url}`));
    }
    cb(null, res);
  }).on('error', cb);
}

function downloadToFile(url, destPath, done) {
  httpsGetFollow(url, 5, (err, res) => {
    if (err) return done(err);
    const tmp = destPath + '.part';
    const out = fs.createWriteStream(tmp);
    res.pipe(out);
    out.on('finish', () => out.close(() => done(null, tmp)));
    out.on('error', (e) => {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      done(e);
    });
    res.on('error', (e) => {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      done(e);
    });
  });
}

function jqVersionAtPath(jqPath) {
  try {
    const probe = spawnSync(jqPath, ['--version'], { encoding: 'utf8' });
    if (probe.status !== 0) return null;
    return (probe.stdout || '').trim();
  } catch (_) {
    return null;
  }
}

async function installBundledJq() {
  if (process.env.CIVITAS_SKIP_JQ_INSTALL === '1') {
    console.log('[civitas-cerebrum] CIVITAS_SKIP_JQ_INSTALL=1 — bundled jq install skipped.');
    return;
  }

  const asset = jqAssetForPlatform();
  if (!asset) {
    console.warn(`[civitas-cerebrum] No bundled jq available for ${process.platform}/${process.arch}. Hooks will fall back to system jq; install jq manually if it isn't already on PATH. See https://jqlang.github.io/jq/download/.`);
    process.exitCode = 1;
    return;
  }

  // Bundled binary is for consumer-side hooks at ~/.claude/hooks/bin/jq.
  // (The package's own dev install is short-circuited at the top of this
  // file via `if (!packageDir.includes('node_modules')) process.exit(0)`,
  // so the in-repo test suite always uses system jq via the hook fallback.)
  const userHooksDir = path.join(homeDir, '.claude', 'hooks');
  const binDir       = path.join(userHooksDir, 'bin');
  const dest         = path.join(binDir, process.platform === 'win32' ? 'jq.exe' : 'jq');

  // Idempotent: if already on the right version, skip.
  if (fs.existsSync(dest)) {
    const ver = jqVersionAtPath(dest);
    if (ver && ver === `jq-${JQ_VERSION}`) {
      console.log(`[civitas-cerebrum] Bundled jq ${ver} already present at ${dest}.`);
      return;
    }
  }

  fs.mkdirSync(binDir, { recursive: true });

  const url = `https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/${asset}`;
  console.log(`[civitas-cerebrum] Fetching jq ${JQ_VERSION} (${asset}) → ${dest} …`);

  await new Promise((resolve) => {
    downloadToFile(url, dest, (err, tmpPath) => {
      if (err) {
        console.warn(`[civitas-cerebrum] Could not download jq from ${url}: ${err.message}. Hooks will fall back to system jq.`);
        process.exitCode = 1;
        return resolve();
      }
      try {
        const size = fs.statSync(tmpPath).size;
        if (size < JQ_MIN_SIZE_BYTES) {
          fs.unlinkSync(tmpPath);
          console.warn(`[civitas-cerebrum] jq download from ${url} was truncated (${size} bytes < ${JQ_MIN_SIZE_BYTES}). Aborting; hooks will fall back to system jq.`);
          process.exitCode = 1;
          return resolve();
        }
        fs.chmodSync(tmpPath, 0o755);
        fs.renameSync(tmpPath, dest); // atomic replace
        const ver = jqVersionAtPath(dest);
        if (!ver || ver !== `jq-${JQ_VERSION}`) {
          console.warn(`[civitas-cerebrum] Bundled jq landed at ${dest} but reports version '${ver || '(unknown)'}'. Hooks will still try the bundled path first.`);
          process.exitCode = 1;
        } else {
          console.log(`[civitas-cerebrum] ✔ Bundled jq ${ver} installed at ${dest}.`);
        }
      } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
        console.warn(`[civitas-cerebrum] Failed to finalize bundled jq at ${dest}: ${e.message}. Hooks will fall back to system jq.`);
        process.exitCode = 1;
      }
      resolve();
    });
  });
}

// @playwright/cli is shipped as a hard dependency of this package, so skills
// that drive a live browser can rely on it after `npm install` with no
// further action from the consumer. Confirm reachability, then fetch the
// chromium browser binary on the consumer's behalf — install-browser is
// idempotent (no-ops when already cached at $PLAYWRIGHT_BROWSERS_PATH or
// the platform default), so the cost on subsequent installs is negligible.
//
// Opt-out: set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 (the Playwright-standard
// env var) to skip the browser fetch — useful for offline installs and
// container builds that mount a pre-warmed browser cache.

function probePlaywrightCli() {
  const probe = spawnSync('npx', ['--no-install', 'playwright-cli', '--version'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return { ok: probe.status === 0, version: (probe.stdout || '').trim() };
}

function installChromium() {
  const cliProbe = probePlaywrightCli();
  if (!cliProbe.ok) {
    // Fail loudly — npm 7+ swallows postinstall stdout on success, but a
    // non-zero exit code surfaces the warning so the consumer learns
    // chromium was NOT fetched. See issue #153 (mitigation 4).
    console.warn('[@civitas-cerebrum/element-interactions] @playwright/cli not reachable via `npx`. The CLI is shipped as a dependency — re-run `npm install` if this is unexpected. Chromium was NOT fetched; subsequent skill activations may need to run `npx playwright-cli install-browser chromium` manually.');
    process.exitCode = 1;
    return;
  }
  if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1') {
    console.log(`[@civitas-cerebrum/element-interactions] @playwright/cli ${cliProbe.version} reachable. Browser fetch skipped (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).`);
    return;
  }
  console.log(`[@civitas-cerebrum/element-interactions] @playwright/cli ${cliProbe.version} reachable. Ensuring chromium is installed…`);
  const browserInstall = spawnSync('npx', ['--no-install', 'playwright-cli', 'install-browser', 'chromium'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (browserInstall.status === 0) {
    console.log('[@civitas-cerebrum/element-interactions] ✔ chromium ready (cached or freshly installed).');
  } else {
    console.warn(`[@civitas-cerebrum/element-interactions] chromium install exited with status ${browserInstall.status}. You may need to run \`npx playwright-cli install-browser chromium\` manually before driving a browser.`);
    process.exitCode = 1;
  }
}

(async () => {
  try {
    await installBundledJq();
  } catch (err) {
    console.warn(`[civitas-cerebrum] Could not install bundled jq: ${err.message}`);
    process.exitCode = 1;
  }

  try {
    installCivitasHooks();
  } catch (err) {
    console.warn(`[civitas-cerebrum] Could not install harness hooks: ${err.message}`);
  }

  try {
    installChromium();
  } catch (err) {
    console.warn(`[@civitas-cerebrum/element-interactions] Could not install chromium: ${err.message}`);
    process.exitCode = 1;
  }
})();
