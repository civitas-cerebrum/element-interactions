#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');

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

// Install to both project-level and user-level .claude/skills/ directories.
// Project-level ensures the correct version is available for this project.
// User-level ensures stale skills from older installs are overwritten,
// preventing outdated user-level files from taking precedence.
const homeDir = require('os').homedir();
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

// Install the coverage-expansion dispatch-guard hook into the user's
// ~/.claude/hooks/ directory and register it as a PreToolUse:Agent hook in
// ~/.claude/settings.json. Markdown rules in the skill ("dispatch one
// journey per Agent call") are skippable; the harness-level hook is not.
//
// Idempotent:
//   - Hook file is copied iff missing or older than the bundled version.
//   - Hook entry in settings.json is added iff a matching command is not
//     already registered (other PreToolUse:Agent hooks are preserved).
//
// Opt-out: set CIVITAS_SKIP_HOOK_INSTALL=1 — useful for enterprise managed
// settings where postinstall scripts must not modify ~/.claude/settings.json.
function installDispatchGuardHook() {
  if (process.env.CIVITAS_SKIP_HOOK_INSTALL === '1') {
    console.log('[civitas-cerebrum] CIVITAS_SKIP_HOOK_INSTALL=1 — dispatch guard hook install skipped.');
    return;
  }

  const hookSrc = path.join(packageDir, 'hooks', 'coverage-expansion-dispatch-guard.sh');
  if (!fs.existsSync(hookSrc)) {
    // Bundled hook missing — quietly skip rather than failing the consumer's npm install.
    return;
  }

  const userHooksDir = path.join(homeDir, '.claude', 'hooks');
  const hookDest = path.join(userHooksDir, 'coverage-expansion-dispatch-guard.sh');
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');

  fs.mkdirSync(userHooksDir, { recursive: true });

  // Copy hook iff missing or bundled version is newer (mtime-based).
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

  // Register PreToolUse:Agent hook in ~/.claude/settings.json — idempotent.
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

  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  // Find an existing PreToolUse entry whose matcher targets the Agent tool.
  let agentEntry = settings.hooks.PreToolUse.find(e => e && e.matcher === 'Agent');
  if (!agentEntry) {
    agentEntry = { matcher: 'Agent', hooks: [] };
    settings.hooks.PreToolUse.push(agentEntry);
  }
  agentEntry.hooks = agentEntry.hooks || [];

  const alreadyRegistered = agentEntry.hooks.some(h => h && h.type === 'command' && h.command === hookDest);
  if (!alreadyRegistered) {
    agentEntry.hooks.push({ type: 'command', command: hookDest });
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  }

  console.log(`[civitas-cerebrum] Installed coverage-expansion dispatch guard at ${hookDest} and registered PreToolUse hook.`);
}

try {
  installDispatchGuardHook();
} catch (err) {
  console.warn(`[civitas-cerebrum] Could not install dispatch guard hook: ${err.message}`);
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
const { spawnSync } = require('child_process');

function probePlaywrightCli() {
  const probe = spawnSync('npx', ['--no-install', 'playwright-cli', '--version'], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return { ok: probe.status === 0, version: (probe.stdout || '').trim() };
}

const cliProbe = probePlaywrightCli();
if (!cliProbe.ok) {
  console.warn('[@civitas-cerebrum/element-interactions] @playwright/cli not reachable via `npx`. The CLI is shipped as a dependency — re-run `npm install` if this is unexpected.');
} else if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1') {
  console.log(`[@civitas-cerebrum/element-interactions] @playwright/cli ${cliProbe.version} reachable. Browser fetch skipped (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1).`);
} else {
  console.log(`[@civitas-cerebrum/element-interactions] @playwright/cli ${cliProbe.version} reachable. Ensuring chromium is installed…`);
  const browserInstall = spawnSync('npx', ['--no-install', 'playwright-cli', 'install-browser', 'chromium'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (browserInstall.status === 0) {
    console.log('[@civitas-cerebrum/element-interactions] ✔ chromium ready (cached or freshly installed).');
  } else {
    console.warn(`[@civitas-cerebrum/element-interactions] chromium install exited with status ${browserInstall.status}. You may need to run \`npx playwright-cli install-browser chromium\` manually before driving a browser.`);
  }
}
