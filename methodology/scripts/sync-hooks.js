#!/usr/bin/env node
// sync-hooks.js — dev convenience: copy this repo's methodology/hooks/ into the user's
// ~/.claude/hooks/ and register them in ~/.claude/settings.json.
//
// Why this exists
// ---------------
// methodology/scripts/postinstall.js short-circuits when run from the package's own
// repo (the `!packageDir.includes('node_modules')` guard) — that's correct
// for `npm install` here, where you don't want a dev `npm i` to clobber
// your global hook config. But when you're actively editing a hook in this
// repo and want the change live in your existing Claude Code session, you
// need a way to invoke just the hook-install path. That's what this is.
//
// Use:
//   npm run sync-hooks
//
// Calls the same installCivitasHooks() that postinstall.js runs for
// consumer installs — the two paths stay in lockstep automatically.
// (jq + chromium + skills are intentionally NOT touched here; the bundled
// jq is for consumers anyway, chromium lives outside the hooks surface,
// and skills are picked up by Claude Code from this repo's methodology/skills/ dir
// without a copy step.)

const { installCivitasHooks } = require('./postinstall.js');

try {
  installCivitasHooks();
} catch (err) {
  console.error(`[sync-hooks] failed: ${err.message}`);
  process.exit(1);
}
