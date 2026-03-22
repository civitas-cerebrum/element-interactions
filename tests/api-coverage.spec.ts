/**
 * API Coverage Report
 *
 * Programmatically inspects the Steps (primary), ElementRepository,
 * ElementInteractions (advanced/raw), and ContextStore APIs, then scans
 * the test file to report which methods are exercised and which are not.
 *
 * Run:  npx playwright test tests/api-coverage.spec.ts
 * View: cat api-coverage-report.txt
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Steps } from '../src/steps/CommonSteps';
import { Interactions } from '../src/interactions/Interaction';
import { Verifications } from '../src/interactions/Verification';
import { Extractions } from '../src/interactions/Extraction';
import { Navigation } from '../src/interactions/Navigation';
import { ContextStore } from '@civitas-cerebrum/context-store';
import { ElementRepository } from 'pw-element-repository';

interface MethodInfo {
  name: string;
  category: string;
  tier: 'primary' | 'advanced';
  covered: boolean;
}

function getClassMethods(cls: any): string[] {
  const methods: string[] = [];
  const proto = cls.prototype;
  if (!proto) return methods;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    if (typeof proto[name] === 'function') {
      methods.push(name);
    }
  }
  return methods.sort();
}

test('API Coverage Report', async () => {
  const testFilePath = path.resolve(__dirname, 'unit-tests.spec.ts');
  const testSource = fs.readFileSync(testFilePath, 'utf-8');

  const apis: MethodInfo[] = [];

  // ── Steps API (primary) ──
  for (const m of getClassMethods(Steps)) {
    apis.push({
      name: `steps.${m}`,
      category: 'Steps',
      tier: 'primary',
      covered: new RegExp(`steps\\.${m}\\b`).test(testSource),
    });
  }

  // ── ElementRepository API (primary) ──
  for (const m of getClassMethods(ElementRepository)) {
    apis.push({
      name: `repo.${m}`,
      category: 'ElementRepository',
      tier: 'primary',
      covered: new RegExp(`repo\\.${m}\\b`).test(testSource),
    });
  }

  // ── ContextStore API (primary) ──
  for (const m of getClassMethods(ContextStore)) {
    apis.push({
      name: `contextStore.${m}`,
      category: 'ContextStore',
      tier: 'primary',
      covered: new RegExp(`contextStore\\.${m}\\b`).test(testSource),
    });
  }

  // ── ElementInteractions sub-APIs (advanced/raw) ──
  const subApis: { prefix: string; cls: any }[] = [
    { prefix: 'interactions.interact', cls: Interactions },
    { prefix: 'interactions.verify', cls: Verifications },
    { prefix: 'interactions.extract', cls: Extractions },
    { prefix: 'interactions.navigate', cls: Navigation },
  ];
  for (const { prefix, cls } of subApis) {
    for (const m of getClassMethods(cls)) {
      const searchPattern = `${prefix.split('.')[1]}\\.${m}`;
      apis.push({
        name: `${prefix}.${m}`,
        category: 'ElementInteractions (raw)',
        tier: 'advanced',
        covered: new RegExp(searchPattern).test(testSource),
      });
    }
  }

  // ── Build report ──
  const primaryApis = apis.filter((a) => a.tier === 'primary');
  const advancedApis = apis.filter((a) => a.tier === 'advanced');
  const primaryCovered = primaryApis.filter((a) => a.covered);
  const advancedCovered = advancedApis.filter((a) => a.covered);

  const lines: string[] = [];
  lines.push('');
  lines.push('========================================================');
  lines.push('                  API COVERAGE REPORT                    ');
  lines.push('========================================================');

  // ── Primary APIs ──
  lines.push('');
  lines.push('  PRIMARY APIs (Steps + Repo + ContextStore)');
  lines.push('  ------------------------------------------');

  const primaryCategories = [...new Set(primaryApis.map((a) => a.category))];
  for (const cat of primaryCategories) {
    const catApis = primaryApis.filter((a) => a.category === cat);
    const catCovered = catApis.filter((a) => a.covered);
    const catPct = ((catCovered.length / catApis.length) * 100).toFixed(0);
    lines.push('');
    lines.push(`  ${cat}: ${catCovered.length}/${catApis.length} (${catPct}%)`);

    for (const api of catApis) {
      const icon = api.covered ? '  [x]' : '  [ ]';
      lines.push(`    ${icon} ${api.name}`);
    }
  }

  lines.push('');
  lines.push(`  Primary coverage: ${primaryCovered.length}/${primaryApis.length} (${((primaryCovered.length / primaryApis.length) * 100).toFixed(1)}%)`);

  // ── Advanced APIs ──
  lines.push('');
  lines.push('  ADVANCED APIs (ElementInteractions raw sub-APIs)');
  lines.push('  ------------------------------------------------');
  lines.push('  These are the internal APIs that Steps wraps.');
  lines.push('  Direct usage is for advanced/custom locator scenarios.');

  const advancedCategories = [...new Set(advancedApis.map((a) => a.category))];
  for (const cat of advancedCategories) {
    const catApis = advancedApis.filter((a) => a.category === cat);
    const catCovered = catApis.filter((a) => a.covered);
    const catPct = ((catCovered.length / catApis.length) * 100).toFixed(0);
    lines.push('');
    lines.push(`  ${cat}: ${catCovered.length}/${catApis.length} (${catPct}%)`);

    for (const api of catApis) {
      const icon = api.covered ? '  [x]' : '  [ ]';
      lines.push(`    ${icon} ${api.name}`);
    }
  }

  lines.push('');
  lines.push(`  Advanced coverage: ${advancedCovered.length}/${advancedApis.length} (${((advancedCovered.length / advancedApis.length) * 100).toFixed(1)}%)`);

  // ── Overall summary ──
  const allCovered = apis.filter((a) => a.covered);
  lines.push('');
  lines.push('========================================================');
  lines.push(`  OVERALL: ${allCovered.length}/${apis.length} methods (${((allCovered.length / apis.length) * 100).toFixed(1)}%)`);
  lines.push(`  PRIMARY: ${primaryCovered.length}/${primaryApis.length} methods (${((primaryCovered.length / primaryApis.length) * 100).toFixed(1)}%)`);
  lines.push(`  ADVANCED: ${advancedCovered.length}/${advancedApis.length} methods (${((advancedCovered.length / advancedApis.length) * 100).toFixed(1)}%)`);
  lines.push('========================================================');

  // ── Uncovered primary methods ──
  const uncoveredPrimary = primaryApis.filter((a) => !a.covered);
  if (uncoveredPrimary.length > 0) {
    lines.push('');
    lines.push('  Uncovered primary methods:');
    for (const api of uncoveredPrimary) {
      lines.push(`    [ ] ${api.name}`);
    }
  }

  lines.push('');

  const report = lines.join('\n');
  console.log(report);

  const reportPath = path.resolve(__dirname, '..', 'api-coverage-report.txt');
  fs.writeFileSync(reportPath, report, 'utf-8');

  await test.info().attach('API Coverage Report', {
    body: report,
    contentType: 'text/plain',
  });

  // ── Enforce 100% Coverage ──
  const uncoveredTotal = apis.filter((a) => !a.covered);

  expect(
    uncoveredTotal.length,
    `Test failed because API coverage is not 100%. Uncovered methods: ${uncoveredTotal.map(m => m.name).join(', ')}`
  ).toBe(0);
});
