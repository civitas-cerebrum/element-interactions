const { validate } = require('../../../lib/selector-diff-validator.js');
const fs = require('fs');
const path = require('path');

const fixtures = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');

const cases = [
  // Pass cases — additive-only, single attribute, kebab-case value, expected attribute name
  { name: 'jsx additive data-testid', before: fixtures('jsx-baseline.tsx'),    after: fixtures('jsx-additive.tsx'),    expected: 'data-testid', file: 'jsx-additive.tsx',    pass: true },
  { name: 'vue additive data-testid', before: fixtures('vue-baseline.vue'),    after: fixtures('vue-additive.vue'),    expected: 'data-testid', file: 'vue-additive.vue',    pass: true },
  { name: 'svelte additive data-testid', before: fixtures('svelte-baseline.svelte'), after: fixtures('svelte-additive.svelte'), expected: 'data-testid', file: 'svelte-additive.svelte', pass: true },
  { name: 'html additive data-testid', before: fixtures('html-baseline.html'),  after: fixtures('html-additive.html'),  expected: 'data-testid', file: 'html-additive.html',  pass: true },

  // Fail cases — non-additive
  { name: 'jsx className change', before: fixtures('jsx-baseline.tsx'), after: fixtures('jsx-classname-changed.tsx'), expected: 'data-testid', file: 'jsx-classname-changed.tsx', pass: false, reason: 'modifies-existing-attribute' },
  { name: 'jsx structural wrap',  before: fixtures('jsx-baseline.tsx'), after: fixtures('jsx-structural-change.tsx'), expected: 'data-testid', file: 'jsx-structural-change.tsx', pass: false, reason: 'structural-change' },

  // Wrong attribute name
  { name: 'jsx wrong attribute (data-cy when expected data-testid)',
    before: fixtures('jsx-baseline.tsx'),
    after: fixtures('jsx-baseline.tsx').replace('onClick={onClick}>', 'onClick={onClick} data-cy="submit-button">'),
    expected: 'data-testid', file: 'jsx-cy-mismatch.tsx', pass: false, reason: 'wrong-attribute-name' },

  // Non-kebab-case value
  { name: 'jsx camelCase value rejected',
    before: fixtures('jsx-baseline.tsx'),
    after: fixtures('jsx-baseline.tsx').replace('onClick={onClick}>', 'onClick={onClick} data-testid="submitButton">'),
    expected: 'data-testid', file: 'jsx-camelcase.tsx', pass: false, reason: 'value-not-kebab-case' },

  // I1: Vue directive change alongside data-testid addition → FAIL (structural-change)
  // A model adding both data-testid AND a new @click handler must be rejected.
  { name: 'vue directive changed + data-testid added → structural-change',
    before: fixtures('vue-directive-baseline.vue'),
    after: fixtures('vue-directive-changed.vue'),
    expected: 'data-testid', file: 'vue-directive-changed.vue',
    pass: false, reason: 'modifies-existing-attribute' },

  // I1: Svelte directive change alongside data-testid addition → FAIL
  { name: 'svelte directive changed + data-testid added → modifies-existing-attribute',
    before: fixtures('svelte-directive-baseline.svelte'),
    after: fixtures('svelte-directive-changed.svelte'),
    expected: 'data-testid', file: 'svelte-directive-changed.svelte',
    pass: false, reason: 'modifies-existing-attribute' },

  // I2: JSX expression container — same-named prop with different expression body
  // onClick={a} → onClick={b}: offsets differ so normalized value differs.
  { name: 'jsx onClick handler change detected (I2 — different expression body)',
    before: 'export function C() { return <button onClick={a}>x</button>; }',
    after:  'export function C() { return <button onClick={b} data-testid="submit-button">x</button>; }',
    expected: 'data-testid', file: 'jsx-expr-change.tsx',
    pass: false, reason: 'modifies-existing-attribute' },
];

let passed = 0, failed = 0;
for (const c of cases) {
  const result = validate({ before: c.before, after: c.after, expectedAttr: c.expected, filePath: c.file });
  const ok = (result.ok === c.pass) && (c.pass || (result.reason === c.reason));
  if (ok) { passed++; console.log('  ✓', c.name); }
  else    { failed++; console.error('  ✗', c.name, '— got', JSON.stringify(result), 'expected pass=', c.pass, 'reason=', c.reason); }
}
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
