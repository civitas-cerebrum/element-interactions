const { compare } = require('../../../lib/visual-diff.js');
const path = require('path');
const dir = __dirname;

const cases = [
  { name: 'identical -> 0 diff pixels', before: 'before.png', after: 'after-identical.png', threshold: 0, pass: true,  diff: 0 },
  { name: 'different -> non-zero diff', before: 'before.png', after: 'after-different.png', threshold: 0, pass: false, diff: 1 },
  { name: 'different but under threshold of 5 -> pass', before: 'before.png', after: 'after-different.png', threshold: 5, pass: true, diff: 1 },
];

let passed = 0, failed = 0;
for (const c of cases) {
  const r = compare({ beforePath: path.join(dir, c.before), afterPath: path.join(dir, c.after), threshold: c.threshold });
  const ok = (r.pass === c.pass) && (r.diffPixels === c.diff);
  if (ok) { passed++; console.log('  ✓', c.name); }
  else    { failed++; console.error('  ✗', c.name, '— got', JSON.stringify(r)); }
}
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
