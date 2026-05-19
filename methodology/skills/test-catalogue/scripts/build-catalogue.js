#!/usr/bin/env node
/**
 * build-catalogue.js — reference implementation for the test-catalogue skill.
 *
 * Usage (from a project root that has tests/e2e/*.spec.ts and tests/e2e/docs/journey-map.md):
 *   node path/to/this/build-catalogue.js \
 *     [--brand civitas-cerebrum|default] \
 *     [--output test-catalogue.pdf]
 *
 * Writes test-catalogue.html to cwd. A second step (Playwright chromium) renders the PDF —
 * use methodology/scripts/render-catalogue-pdf.js inside the project, or add a sibling renderer.
 *
 * This script is a reference; the skill's SKILL.md is authoritative on behaviour.
 */

const fs = require('fs');
const path = require('path');

const args = parseArgs(process.argv.slice(2));
const REPO = process.cwd();
const SPEC_GLOB = path.join(REPO, 'tests', 'e2e');
const JOURNEY_MAP = path.join(REPO, 'tests', 'e2e', 'docs', 'journey-map.md');
const OUTPUT_HTML = path.join(REPO, 'test-catalogue.html');
const BRAND = args.brand || 'default';

main().catch((e) => { console.error(e); process.exit(1); });

async function main() {
  const specFiles = listSpecs(SPEC_GLOB);
  if (!specFiles.length) fail('No tests/e2e/*.spec.ts files found.');

  const journeyMap = loadJourneyMap(JOURNEY_MAP);
  const tests = [];
  for (const f of specFiles) {
    const rel = path.relative(REPO, f);
    tests.push(...extractTests(f, rel));
  }

  const decorated = tests.map((t) => crossReference(t, journeyMap));
  const grouped = groupBySection(decorated);
  const totals = computeTotals(decorated, journeyMap);

  const html = renderHtml({
    appName: args.app || 'Application',
    grouped,
    totals,
    brand: BRAND,
    date: new Date().toISOString().slice(0, 10),
  });

  fs.writeFileSync(OUTPUT_HTML, html);
  console.log('Wrote', OUTPUT_HTML);
  console.log('Totals:', totals);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i] ?? true;
  }
  return out;
}

function listSpecs(dir) {
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.spec.ts'))
    .map((n) => path.join(dir, n));
}

function loadJourneyMap(file) {
  if (!fs.existsSync(file)) fail('journey-map.md not found: ' + file);
  const src = fs.readFileSync(file, 'utf8');
  if (!src.startsWith('<!-- journey-mapping:generated -->')) {
    fail('journey-map.md is missing the <!-- journey-mapping:generated --> sentinel.');
  }
  const map = {};
  const blocks = src.split(/^### (?=j-)/m).slice(1);
  for (const block of blocks) {
    const lines = block.split('\n');
    const heading = lines[0];
    const id = heading.split(':')[0].trim();
    const purpose = heading.includes(':') ? heading.split(':').slice(1).join(':').trim() : '';
    const priority = /\*\*Priority:\*\*\s*(P[0-3])/.exec(block)?.[1] ?? null;
    const category = /\*\*Category:\*\*\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? null;
    const entry = /\*\*Entry:\*\*\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? null;
    const explicitSection = /\*\*Section:\*\*\s*([^\n]+)/.exec(block)?.[1]?.trim() ?? null;
    const section = inferSectionLabel({ explicitSection, entry, id });
    map[id] = { id, purpose, priority, category, entry, section };
  }
  return map;
}

/**
 * Derive a primary-section label per journey.
 *
 * Order of precedence (data-driven, no hardcoded app sections):
 *  1. Explicit `**Section:**` field in the journey-map block.
 *  2. Host + first path segment of the journey's `Entry:` URL.
 *  3. First hyphen-separated token of the journey's `j-<slug>` ID.
 *  4. "Cross-cutting" — the catch-all when nothing above resolves.
 *
 * The label IS whatever the data yields. The skill does not canonicalise to
 * named app sections — different apps will produce different labels, and that
 * is intentional. Cross-cutting goes last in render order regardless.
 */
function inferSectionLabel({ explicitSection, entry, id }) {
  if (explicitSection) return explicitSection;

  if (entry) {
    try {
      const url = new URL(entry);
      const host = url.hostname || '';
      const firstSegment = (url.pathname || '/').split('/').filter(Boolean)[0] || '';
      if (host && firstSegment) return `${host}/${firstSegment}`;
      if (host) return host;
    } catch (_) {
      // entry wasn't a parseable URL — fall through to id-based fallback
    }
  }

  if (id && id.startsWith('j-')) {
    const tokens = id.slice(2).split('-');
    if (tokens.length >= 2) return tokens[0];
  }

  return 'Cross-cutting';
}

function extractTests(absPath, relPath) {
  const src = fs.readFileSync(absPath, 'utf8');
  const lines = src.split('\n');
  const out = [];
  const describeStack = [];
  let depth = 0;

  const fileJourney = deriveJourneyFromFile(relPath);
  const isRegression = /-regression\.spec\.ts$/.test(relPath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // naive brace accounting; good enough for well-formed specs
    depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;

    const describeMatch = /^\s*test\.describe(?:\.serial|\.parallel|\.skip)?\(\s*['"`]([^'"`]+)['"`]/.exec(line);
    if (describeMatch) {
      describeStack.push(describeMatch[1]);
      continue;
    }

    const testMatch = /^\s*test(\.skip|\.fail)?\(\s*['"`]([^'"`]+)['"`]/.exec(line);
    if (testMatch) {
      const marker = testMatch[1] === '.skip' ? 'skipped'
        : testMatch[1] === '.fail' ? 'failing-expected'
        : 'active';
      const name = testMatch[2];
      const tags = (name.match(/@[a-z0-9-]+/gi) || []).map((t) => t.slice(1).toLowerCase());
      const describePath = [...describeStack];
      const journeyFromDescribe = describePath
        .map((d) => (/\b(j-|sj-)[a-z0-9-]+/i.exec(d) || [])[0])
        .filter(Boolean)[0];
      const journey = journeyFromDescribe || fileJourney;
      const reason = marker === 'skipped' ? findNearbyComment(lines, i) : null;

      out.push({
        file: relPath,
        describePath,
        name,
        marker,
        tags,
        journey,
        isRegression,
      });
      if (marker === 'skipped') out[out.length - 1].reason = reason;
    }
  }
  return out;
}

function deriveJourneyFromFile(rel) {
  const base = path.basename(rel, '.spec.ts').replace(/-regression$/, '');
  return 'j-' + base;
}

function findNearbyComment(lines, idx) {
  for (let j = idx - 1; j >= Math.max(0, idx - 6); j--) {
    const l = lines[j].trim();
    if (!l) continue;
    const m = /^(?:\/\/|\*|\/\*\*?)\s*(.+?)\s*\*?\*?\/?$/.exec(l);
    if (m && m[1]) return m[1].replace(/^[\*\-\s]+/, '');
  }
  return 'Skipped (no reason comment nearby)';
}

function crossReference(test, map) {
  const journeyMeta = map[test.journey] || null;
  const section = journeyMeta?.section
    ?? sectionFromFilename(test.file);
  const priority = journeyMeta?.priority || inferPriorityFromTags(test.tags) || 'P3';
  const type = classifyType(test);
  const purpose = journeyMeta?.purpose || '(Unmapped journey)';
  const status = test.marker === 'active' ? 'Active'
    : test.marker === 'failing-expected' ? 'Failing-expected'
    : 'Skipped';
  return { ...test, section, priority, type, purpose, status, journeyMeta };
}

function sectionFromFilename(file) {
  // Last-resort fallback when the journey isn't in the map and we have nothing
  // but a spec filename. Use the first hyphen-separated token of the basename.
  // Sub-journeys, regression batches, and unhyphenated files fall into
  // Cross-cutting so they don't inflate the primary axis.
  const base = path.basename(file, '.spec.ts');
  if (base.startsWith('sj-') || /-regression$/.test(base)) return 'Cross-cutting';
  const firstToken = base.split('-')[0];
  if (!firstToken || base === firstToken) return 'Cross-cutting';
  return firstToken;
}

function inferPriorityFromTags(tags) {
  for (const p of ['p0', 'p1', 'p2', 'p3']) if (tags.includes(p)) return p.toUpperCase();
  return null;
}

function classifyType(t) {
  const name = t.name.toLowerCase();
  if (name.includes('@mobile') || name.includes('mobile') || name.includes('ipad')) return 'mobile';
  if (/edge|boundary|empty|overflow|timeout|concurrent|max(imum)?|min(imum)?/.test(name)) return 'edge case';
  if (/error|invalid|reject|blank|duplicate|unauthori[sz]ed|\b4\d\d\b|fail/.test(name)) return 'error state';
  if ((t.describePath[0] || '').startsWith('sj-')) return 'structural';
  if (t.isRegression) return 'regression';
  return 'happy path';
}

function groupBySection(tests) {
  const sections = {};
  for (const t of tests) {
    (sections[t.section] ||= []).push(t);
  }
  for (const section of Object.keys(sections)) {
    sections[section].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority.localeCompare(b.priority);
      if (a.journey !== b.journey) return a.journey.localeCompare(b.journey);
      return a.name.localeCompare(b.name);
    });
  }
  return sections;
}

function computeTotals(tests, map) {
  const total = tests.length;
  const skipped = tests.filter((t) => t.status === 'Skipped').length;
  const failing = tests.filter((t) => t.status === 'Failing-expected').length;
  const active = total - skipped - failing;
  const journeys = new Set(tests.map((t) => t.journey).filter(Boolean));
  const bySection = {};
  for (const t of tests) bySection[t.section] = (bySection[t.section] || 0) + 1;
  const regressions = tests.filter((t) => t.isRegression).length;
  return { total, active, skipped, failing, journeys: journeys.size, bySection, regressions, mappedJourneys: Object.keys(map).length };
}

function fail(msg) { console.error(msg); process.exit(1); }

// ---------- rendering ----------

const palettes = {
  default: { bg: '#0A0E14', ink: '#E6EAF2', inkMute: '#8892A6', brand: '#00A3FF', accent: '#FF7A1A' },
  'civitas-cerebrum': { bg: '#0d1117', ink: '#e6edf3', inkMute: '#7d8590', brand: '#3fb950', accent: '#58a6ff' },
};

function renderHtml(ctx) {
  // Rendering is deliberately compact here — real skill invocations should
  // inline this template into the agent's generation so they can tailor the
  // cover-page copy per engagement.
  const pal = palettes[ctx.brand] || palettes.default;
  // Render section pages in a stable order: alphabetical, but with
  // "Cross-cutting" pinned to the end — it's structurally the catch-all.
  const sectionOrder = Object.keys(ctx.grouped)
    .filter((s) => s !== 'Cross-cutting')
    .sort()
    .concat(ctx.grouped['Cross-cutting'] ? ['Cross-cutting'] : []);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Test Catalogue — ${ctx.appName}</title>
<style>
:root { --bg:${pal.bg}; --ink:${pal.ink}; --mute:${pal.inkMute}; --brand:${pal.brand}; --accent:${pal.accent}; }
@page { size: A4 landscape; margin: 0; }
html,body{margin:0;padding:0;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.page{width:1123px;height:794px;padding:38px 64px 40px;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative;}
.page:last-child{page-break-after:auto;}
header.catalogue{display:flex;justify-content:space-between;align-items:baseline;font-size:12px;color:var(--mute);padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:24px;}
h1{font-size:54px;font-weight:800;margin:0;}
h2{font-size:26px;font-weight:700;margin:0 0 12px;}
h3{font-size:16px;font-weight:600;margin:8px 0;color:var(--mute);text-transform:uppercase;letter-spacing:2px;}
.total-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:28px;}
.stat{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:18px;}
.stat .num{font-size:40px;font-weight:800;color:var(--brand);}
.stat .lab{font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:1.5px;margin-top:4px;}
table{width:100%;border-collapse:collapse;font-size:11px;}
th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--mute);border-bottom:1px solid rgba(255,255,255,0.12);padding:6px 4px;}
td{padding:5px 4px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:top;}
tr:nth-child(odd) td{background:rgba(255,255,255,0.02);}
.chip{display:inline-block;font-size:10px;padding:1px 6px;border-radius:3px;font-weight:600;}
.p0{background:rgba(255,87,87,0.18);color:#ff8787;}
.p1{background:rgba(255,138,61,0.18);color:#ffb07a;}
.p2{background:rgba(255,201,61,0.18);color:#ffd773;}
.p3{background:rgba(156,163,175,0.15);color:#c5cad1;}
.active{color:#6EE7B7;}
.skipped{color:var(--mute);}
.failing-expected{color:var(--accent);}
</style></head><body>
${renderCover(ctx)}
${renderContents(ctx, sectionOrder)}
${sectionOrder.map((s) => renderSection(s, ctx.grouped[s], ctx)).join('\n')}
${renderRegressionSection(ctx)}
${renderSkippedSection(ctx)}
</body></html>`;
}

function renderCover(ctx) {
  return `<section class="page">
<header class="catalogue"><span>Test Catalogue — ${ctx.appName}</span><span>${ctx.date}</span></header>
<div style="flex:1;display:flex;flex-direction:column;justify-content:center;">
<h3>Scenario inventory</h3>
<h1>${ctx.appName}</h1>
<p style="color:var(--mute);font-size:16px;max-width:720px;margin-top:14px;">A stakeholder-facing inventory of every automated scenario in the suite — grouped by primary section, sorted by priority, with active, skipped and regression coverage listed transparently.</p>
<div class="total-grid">
<div class="stat"><div class="num">${ctx.totals.total}</div><div class="lab">Total scenarios</div></div>
<div class="stat"><div class="num">${ctx.totals.journeys}</div><div class="lab">Journeys covered</div></div>
<div class="stat"><div class="num">${ctx.totals.active}</div><div class="lab">Active</div></div>
<div class="stat"><div class="num">${ctx.totals.skipped}</div><div class="lab">Skipped (transparent)</div></div>
</div>
</div>
<footer style="font-size:10px;color:var(--mute);">01 / TOTAL</footer>
</section>`;
}

function renderContents(ctx, sectionOrder) {
  const rows = sectionOrder.map((s) => `<tr><td>${escapeHtml(s)}</td><td>${ctx.grouped[s].length}</td></tr>`).join('');
  return `<section class="page">
<header class="catalogue"><span>Contents</span><span>${ctx.appName}</span></header>
<h2>Contents</h2>
<table><thead><tr><th>Section</th><th>Scenarios</th></tr></thead><tbody>${rows}
<tr><td>Adversarial regression</td><td>${ctx.totals.regressions}</td></tr>
<tr><td>Skipped with reason</td><td>${ctx.totals.skipped}</td></tr>
</tbody></table>
</section>`;
}

function renderSection(section, tests, ctx) {
  const byPriority = {};
  for (const t of tests) (byPriority[t.priority] ||= []).push(t);
  const tables = ['P0', 'P1', 'P2', 'P3']
    .filter((p) => byPriority[p]?.length)
    .map((p) => renderPriorityTable(p, byPriority[p]))
    .join('\n');
  return `<section class="page">
<header class="catalogue"><span>${escapeHtml(section)}</span><span>${ctx.appName}</span></header>
<h2>${escapeHtml(section)}</h2>
<p style="color:var(--mute);font-size:12px;margin-bottom:16px;">${tests.length} scenarios</p>
${tables}
</section>`;
}

function renderPriorityTable(priority, tests) {
  const rows = tests.map((t) => `<tr>
<td><code style="color:var(--mute);">${t.journey || '—'}</code></td>
<td>${escapeHtml(t.name)}</td>
<td>${t.type}</td>
<td class="${t.status.toLowerCase()}">${t.status}</td>
</tr>`).join('');
  return `<h3><span class="chip ${priority.toLowerCase()}">${priority}</span> &nbsp; ${tests.length} scenarios</h3>
<table><thead><tr><th>Journey</th><th>Scenario</th><th>Type</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderRegressionSection(ctx) {
  const all = Object.values(ctx.grouped).flat().filter((t) => t.isRegression);
  const rows = all.map((t) => `<tr>
<td><code style="color:var(--mute);">${t.journey}</code></td>
<td>${escapeHtml(t.name)}</td>
<td>${t.file}</td>
</tr>`).join('');
  return `<section class="page">
<header class="catalogue"><span>Adversarial regression</span><span>${ctx.appName}</span></header>
<h2>Adversarial regression (boundary lock)</h2>
<p style="color:var(--mute);font-size:12px;margin-bottom:16px;">Every test below locks a verified boundary discovered during adversarial passes. Regressions here would indicate a real app change — never a flaky test.</p>
<table><thead><tr><th>Journey</th><th>Boundary scenario</th><th>Spec file</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function renderSkippedSection(ctx) {
  const all = Object.values(ctx.grouped).flat().filter((t) => t.status === 'Skipped');
  if (!all.length) {
    return `<section class="page">
<header class="catalogue"><span>Skipped with reason</span><span>${ctx.appName}</span></header>
<h2>Skipped with reason</h2>
<p style="color:var(--mute);">No scenarios are deferred. Every mapped scenario runs.</p>
</section>`;
  }
  const rows = all.map((t) => `<tr>
<td><code style="color:var(--mute);">${t.journey}</code></td>
<td>${escapeHtml(t.name)}</td>
<td>${escapeHtml(t.reason || '—')}</td>
</tr>`).join('');
  return `<section class="page">
<header class="catalogue"><span>Skipped with reason</span><span>${ctx.appName}</span></header>
<h2>Skipped with reason</h2>
<p style="color:var(--mute);font-size:12px;margin-bottom:16px;">Full transparency: every scenario deferred (awaiting tenant data, known bug, environmental precondition) is listed here.</p>
<table><thead><tr><th>Journey</th><th>Scenario</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
