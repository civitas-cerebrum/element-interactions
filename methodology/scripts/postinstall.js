#!/usr/bin/env node

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const os    = require('os');
const { spawnSync } = require('child_process');

// __dirname is now `<package>/methodology/scripts/` — `packageDir` walks
// two levels up to reach the package root.
const packageDir  = path.resolve(__dirname, '..', '..');
const skillsDir   = path.join(packageDir, 'methodology', 'skills');

// When installed as a dependency, __dirname is:
//   <project>/node_modules/@civitas-cerebrum/element-interactions/methodology/scripts
// so five levels up reaches the consumer's project root.
const projectRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');

// Skip when running in the package's own repo (local dev `npm install`).
// The guard only fires when this file is executed directly via `node
// methodology/scripts/postinstall.js`. When require()'d (e.g. by methodology/scripts/sync-hooks.js
// for an in-repo dev sync), the guard is bypassed and the installers are
// exposed via module.exports for callers to invoke selectively.
if (require.main === module && !packageDir.includes('node_modules')) {
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

// Auto-discover every skill under methodology/skills/. A skill is any direct subdirectory
// of methodology/skills/ that contains a SKILL.md at its root. This keeps installs in sync
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

function installCivitasSkills() {
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
}

// Install the @civitas-cerebrum/element-interactions harness hooks into the
// user's ~/.claude/hooks/ directory and register them in ~/.claude/settings.json.
// Markdown rules in the skills ("dispatch one journey per Agent call",
// "use playwright-cli not the MCP browser tools", "preserve the journey-map
// sentinel", etc.) are skippable; the harness-level hooks are not.
//
// Per-hook manifest below — each entry: { file, event, matcher, timeout?, async? }.
//   file     — script name in <package>/methodology/hooks/, copied to ~/.claude/hooks/<file>
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
// The orchestrator-era hook surface (cascade-routing, phase-validator
// dispatch, onboarding-stop deny, parent-only orchestrator block, etc.)
// was retired when external automated drivers took ownership of the
// autonomous onboarding pipeline. Such drivers are deterministic JS
// processes that spawn per-role `claude -p` children with narrow
// allowlists — the per-phase progression guards are no longer needed
// inside element-interactions.
//
// Surviving hooks (role-agnostic defense-in-depth): playwright-cli isolation
// + cleanup, commit-message gate, subagent-return schema validation. The
// 0.3.6-era hardening hooks (bash allowlist, commit attribution / author
// signature, harness trusted-state, playwright-config defaults, test-data
// discipline, version-bump authorisation) were retired as part of the
// public-dependency cleanup — they encoded project-specific policy
// inappropriate for a generic test-automation framework.
const HOOK_MANIFEST = [
  // PreToolUse — guards (fail-closed)
  { file: 'playwright-cli-isolation-guard.sh',    event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'commit-message-gate.sh',               event: 'PreToolUse', matcher: 'Bash',        timeout: 10 },
  { file: 'subagent-schema-preread-gate.sh',      event: 'PreToolUse', matcher: 'Agent',       timeout: 10 },
  { file: 'standard-mode-first-pass-guard.sh',    event: 'PreToolUse', matcher: 'Agent',       timeout: 10 },
  // Pipeline-state machine: gates Agent dispatches and Write|Edit writes
  // against the onboarding-status ledger. Together these enforce every
  // phase / pass / cycle transition through a workflow-reviewer-*
  // subagent. 10s timeout for the Agent gate (may shell out to git +
  // jq); 3s timeout for the write gate (read-only-ish — Ajv compile
  // plus a JSON parse).
  { file: 'onboarding-ledger-gate.sh',            event: 'PreToolUse', matcher: 'Agent',       timeout: 10 },
  // Approver registry: records workflow-reviewer-* / phase-validator-*
  // dispatches so the ledger-write-gate can verify approval transitions
  // come from a registered approver context (separation of duties).
  { file: 'workflow-approver-registry.sh',        event: 'PreToolUse', matcher: 'Agent',       timeout: 5 },
  // Reviewer brief integrity: deny workflow-reviewer-* dispatches whose
  // brief doesn't cite the ledger + a verification verb + isn't trivially
  // short. Closes the orchestrator → reviewer brief-injection surface.
  { file: 'workflow-reviewer-brief-gate.sh',      event: 'PreToolUse', matcher: 'Agent',       timeout: 5 },
  { file: 'onboarding-ledger-write-gate.sh',      event: 'PreToolUse', matcher: 'Write|Edit',  timeout: 3 },
  // Phase-4 fidelity gates: ensure the journey-mapping skill is the
  // only legitimate author of tests/e2e/docs/journey-map.md. The
  // sentinel gate enforces the line-1 marker + the cycle-state preflight
  // (cycle 1 dispatched somewhere); the skill-preread gate enforces
  // that the orchestrator actually loaded the journey-mapping skill
  // (or the dispatching brief did) before issuing writes / phase4-*
  // Agent dispatches. Together they close the orchestrator-direct
  // shortcut on Phase 4.
  { file: 'journey-map-sentinel-gate.sh',         event: 'PreToolUse', matcher: 'Write|Edit',  timeout: 3 },
  { file: 'journey-mapping-skill-preread-gate.sh', event: 'PreToolUse', matcher: 'Write|Edit', timeout: 5 },
  { file: 'journey-mapping-skill-preread-gate.sh', event: 'PreToolUse', matcher: 'Agent',      timeout: 5 },

  // PostToolUse — observers (record + warn)
  { file: 'subagent-return-schema-guard.sh',      event: 'PostToolUse', matcher: 'Agent',      timeout: 10 },
  // Reviewer attestation integrity: WARN when a workflow-reviewer-*
  // approves without citing real on-disk file paths. PostToolUse can't
  // reverse the return, but the WARN ensures the audit trail captures
  // ungrounded approvals.
  { file: 'workflow-reviewer-attestation-gate.sh', event: 'PostToolUse', matcher: 'Agent',     timeout: 5 },

  // SubagentStop — cleanup (async)
  { file: 'playwright-cli-cleanup-on-stop.sh',    event: 'SubagentStop', matcher: null,        timeout: 30, async: true },

  // selector-development — activation + inertness gates (PreToolUse:Write|Edit)
  { file: 'selector-development-activation-gate.sh',     event: 'PreToolUse', matcher: 'Write|Edit', timeout: 10 },
  { file: 'selector-development-inertness-guard.sh',     event: 'PreToolUse', matcher: 'Write|Edit', timeout: 10 },

  // selector-development — pipeline stepper (Pre + Post on Bash|Write|Edit)
  { file: 'selector-development-pipeline-stepper.sh',    event: 'PreToolUse',  matcher: 'Bash|Write|Edit', timeout: 10 },
  { file: 'selector-development-pipeline-stepper.sh',    event: 'PostToolUse', matcher: 'Bash|Write|Edit', timeout: 10 },

  // selector-development — Stop-time revert WARN
  { file: 'selector-development-revert-on-stop.sh',      event: 'Stop', matcher: null,                 timeout: 10 },
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
    const hookSrc = path.join(packageDir, 'methodology', 'hooks', entry.file);
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

  // Copy methodology/hooks/lib/ helpers (e.g. selector-diff-validator, visual-diff). These
  // are required at runtime by hook scripts that shell out to node. Pattern:
  // idempotent file copy with mtime check, same as copyHookFile() above.
  const libSrcDir  = path.join(packageDir, 'methodology', 'hooks', 'lib');
  const libDestDir = path.join(userHooksDir, 'lib');
  if (fs.existsSync(libSrcDir)) {
    fs.mkdirSync(libDestDir, { recursive: true });
    for (const entry of fs.readdirSync(libSrcDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const srcPath  = path.join(libSrcDir, entry.name);
      const destPath = path.join(libDestDir, entry.name);
      let shouldCopy = !fs.existsSync(destPath);
      if (!shouldCopy) {
        try {
          shouldCopy = fs.statSync(srcPath).mtimeMs > fs.statSync(destPath).mtimeMs;
        } catch (_) {
          shouldCopy = true;
        }
      }
      if (shouldCopy) {
        fs.copyFileSync(srcPath, destPath);
        copiedCount++;
      }
    }
  }

  if (settingsModified) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  pruneRetiredHooks(userHooksDir);

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
    // chromium was NOT fetched.
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

// Hooks this package previously shipped but no longer does. On upgrade,
// remove them from the user's installed hook dir so they don't keep
// firing against stale source. Only deletes files we know we previously
// installed; never touches arbitrary user files.
const LEGACY_EI_HOOKS = [
  // Retired in the external-driver handoff (pre-0.4.0)
  'contribution-handover-gate.sh',
  'coverage-expansion-direct-compose-block.sh',
  'coverage-expansion-dispatch-guard.sh',
  'coverage-expansion-orchestrator-cli-block.sh',
  'coverage-state-deferral-auth-guard.sh',
  'coverage-state-schema-guard.sh',
  'contributing-skill-preread-guard.sh',
  'failure-diagnosis-stage0-preread-guard.sh',
  'journey-map-sentinel-guard.sh',
  'mcp-browser-tool-redirect.sh',
  'onboarding-pipeline-incomplete-stop-deny.sh',
  'parent-only-orchestrator-dispatch-block.sh',
  'phase-validator-dispatch-required.sh',
  'phase4-concurrency-log-format.sh',
  'raw-playwright-api-warning.sh',
  'skill-subagent-only-guard.sh',
  'subagent-spillover-rewrite-gate.sh',
  'suite-gate-ratchet.sh',
  'task-update-phase-ledger-audit.sh',
  'using-superpowers-carveout-guard.sh',
  'benchmark-write-guard.sh',
  'onboarding-report-write-guard.sh',
  'happy-path-discovery-draft-required.sh',
  'journey-mapping-cycle-gate.sh',
  // Retired in 0.4.0
  'bash-command-allowlist.sh',
  'commit-attribution-gate.sh',
  'commit-author-signature-guard.sh',
  'harness-trusted-state-write-guard.sh',
  'playwright-config-defaults-guard.sh',
  'test-data-discipline-guard.sh',
  'version-bump-authorisation-guard.sh',
  'version-bump-against-npm-guard.sh',
];

function pruneRetiredHooks(homeHooksDir) {
  for (const name of LEGACY_EI_HOOKS) {
    const p = path.join(homeHooksDir, name);
    try {
      fs.unlinkSync(p);
      console.log('[ei-postinstall] pruned retired hook:', name);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        console.warn('[ei-postinstall] could not prune', name + ':', e.message);
      }
    }
  }
}

// Expose installers so methodology/scripts/sync-hooks.js (and any future dev tooling)
// can run a subset without re-invoking the full postinstall flow.
module.exports = {
  installCivitasSkills,
  installCivitasHooks,
  installBundledJq,
  installChromium,
};

// Full postinstall runs only when this file is invoked directly. When
// require()'d, the caller picks which installers to run.
if (require.main === module) {
  (async () => {
    try {
      installCivitasSkills();
    } catch (err) {
      console.warn(`[@civitas-cerebrum/element-interactions] Could not install skills: ${err.message}`);
    }

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
}
