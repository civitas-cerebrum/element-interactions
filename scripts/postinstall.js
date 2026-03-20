#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');

// Resolve the root of the consuming project (three levels up from
// node_modules/pw-element-interactions/scripts/postinstall.js)
const projectRoot = path.resolve(__dirname, '..', '..', '..');

const src  = path.join(__dirname, '..', 'skills', 'SKILL.md');
const dest = path.join(projectRoot, '.claude', 'skills', 'pw-element-interactions', 'SKILL.md');

try {
  if (!fs.existsSync(src)) {
    console.warn('[pw-element-interactions] Skill file not found, skipping.');
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[pw-element-interactions] ✔ Claude Code skill installed — restart Claude Code to pick it up.');
} catch (err) {
  // Never fail the install — skill copy is best-effort
  console.warn(`[pw-element-interactions] Could not install Claude Code skill: ${err.message}`);
}