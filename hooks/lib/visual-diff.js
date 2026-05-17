// visual-diff.js — pixelmatch wrapper used by the pipeline-stepper at step 7.
// CLI usage:  node visual-diff.js <before.png> <after.png> [--threshold=N] [--out=diff.png]
// Module API: compare({ beforePath, afterPath, threshold, outPath? })
//             -> { pass: boolean, diffPixels: number, threshold: number, outPath?: string }

'use strict';
const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

function loadPng(p) { return PNG.sync.read(fs.readFileSync(p)); }

function compare({ beforePath, afterPath, threshold = 0, outPath = null }) {
  const before = loadPng(beforePath);
  const after  = loadPng(afterPath);
  if (before.width !== after.width || before.height !== after.height) {
    return { pass: false, diffPixels: Number.MAX_SAFE_INTEGER, threshold, reason: 'dimension-mismatch' };
  }
  const diff = new PNG({ width: before.width, height: before.height });
  const diffPixels = pixelmatch(before.data, after.data, diff.data, before.width, before.height, { threshold: 0.0 });
  if (outPath) fs.writeFileSync(outPath, PNG.sync.write(diff));
  return { pass: diffPixels <= threshold, diffPixels, threshold, outPath: outPath || undefined };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) { console.error('usage: visual-diff.js <before.png> <after.png> [--threshold=N] [--out=path]'); process.exit(2); }
  const [beforePath, afterPath, ...flags] = args;
  let threshold = 0, outPath = null;
  for (const f of flags) {
    const m = f.match(/^--threshold=(\d+)$/); if (m) threshold = Number(m[1]);
    const o = f.match(/^--out=(.+)$/);        if (o) outPath = o[1];
  }
  const r = compare({ beforePath, afterPath, threshold, outPath });
  console.log(JSON.stringify(r));
  process.exit(r.pass ? 0 : 1);
}

module.exports = { compare };
