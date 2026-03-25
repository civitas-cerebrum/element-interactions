#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..', '..');

const src  = path.join(__dirname, '..', 'skills', 'element-interactions.md');
const dest = path.join(projectRoot, '.claude', 'skills', 'element-interactions', 'SKILL.md');

try {
  if (!fs.existsSync(src)) {
    console.warn('[@civitas-cerebrum/element-interactions] Skill file not found, skipping.');
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[@civitas-cerebrum/element-interactions] ✔ Claude Code skill installed — restart Claude Code to pick it up.');
} catch (err) {
  console.warn(`[@civitas-cerebrum/element-interactions] Could not install Claude Code skill: ${err.message}`);
}
