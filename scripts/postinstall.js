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

const skillsDestBase = path.join(projectRoot, '.claude', 'skills');

const files = [
  { src: 'element-interactions/SKILL.md', destDir: 'element-interactions', dest: 'SKILL.md' },
  { src: 'test-composer/SKILL.md', destDir: 'test-composer', dest: 'SKILL.md' },
  { src: 'bug-discovery/SKILL.md', destDir: 'bug-discovery', dest: 'SKILL.md' },
  { src: 'agents-vs-agents/SKILL.md', destDir: 'agents-vs-agents', dest: 'SKILL.md' },
];

try {
  let installed = 0;

  for (const file of files) {
    const srcPath  = path.join(skillsDir, file.src);
    const destPath = path.join(skillsDestBase, file.destDir, file.dest);

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
