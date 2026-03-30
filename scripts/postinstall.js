#!/usr/bin/env node

const fs   = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const skillsDir   = path.join(__dirname, '..', 'skills');
const destDir     = path.join(projectRoot, '.claude', 'skills', 'element-interactions');

const files = [
  { src: 'element-interactions.md', dest: 'SKILL.md' },
  { src: 'references/test-composer.md', dest: 'references/test-composer.md' },
];

try {
  let installed = 0;

  for (const file of files) {
    const srcPath  = path.join(skillsDir, file.src);
    const destPath = path.join(destDir, file.dest);

    if (!fs.existsSync(srcPath)) {
      continue;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    installed++;
  }

  if (installed > 0) {
    console.log(`[@civitas-cerebrum/element-interactions] ✔ Claude Code skill installed (${installed} file${installed > 1 ? 's' : ''}) — restart Claude Code to pick it up.`);
  } else {
    console.warn('[@civitas-cerebrum/element-interactions] Skill files not found, skipping.');
  }
} catch (err) {
  console.warn(`[@civitas-cerebrum/element-interactions] Could not install Claude Code skill: ${err.message}`);
}
