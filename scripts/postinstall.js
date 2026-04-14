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

const files = [
  { src: 'element-interactions/SKILL.md', destDir: 'element-interactions', dest: 'SKILL.md' },
  { src: 'test-composer/SKILL.md', destDir: 'test-composer', dest: 'SKILL.md' },
  { src: 'bug-discovery/SKILL.md', destDir: 'bug-discovery', dest: 'SKILL.md' },
  { src: 'agents-vs-agents/SKILL.md', destDir: 'agents-vs-agents', dest: 'SKILL.md' },
  { src: 'failure-diagnosis/SKILL.md', destDir: 'failure-diagnosis', dest: 'SKILL.md' },
  { src: 'work-summary-deck/SKILL.md', destDir: 'work-summary-deck', dest: 'SKILL.md' },
];

try {
  const installedSkills = new Set();

  for (const skillsDestBase of destinations) {
    for (const file of files) {
      const srcPath  = path.join(skillsDir, file.src);
      const destPath = path.join(skillsDestBase, file.destDir, file.dest);

      if (!fs.existsSync(srcPath)) {
        continue;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      installedSkills.add(file.destDir);
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
