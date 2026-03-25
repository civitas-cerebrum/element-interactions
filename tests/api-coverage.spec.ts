import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Steps } from '../src/steps/CommonSteps';
import { Interactions } from '../src/interactions/Interaction';
import { Verifications } from '../src/interactions/Verification';
import { Extractions } from '../src/interactions/Extraction';
import { Navigation } from '../src/interactions/Navigation';
import { ContextStore } from '@civitas-cerebrum/context-store';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { Utils } from '../src/utils/ElementUtilities';

interface MethodInfo {
  name: string;
  category: string;
  tier: 'primary' | 'advanced';
  covered: boolean;
}

// Extract public methods from a class prototype
function getPublicClassMethods(cls: any): string[] {
  const methods: string[] = [];
  const proto = cls.prototype;
  if (!proto) return methods;
  
  for (const name of Object.getOwnPropertyNames(proto)) {
    // Ignore constructors, private methods (starting with _), and non-functions
    if (name === 'constructor' || name.startsWith('_')) continue;
    if (typeof proto[name] === 'function') {
      methods.push(name);
    }
  }
  return methods.sort();
}

test('API Coverage Report', async () => {
  const testDir = path.resolve(__dirname);

  // ─── DYNAMIC DIRECTORY CRAWLER (Recursive) ────────────────────────
  const walkDir = (dir: string, fileList: string[] = []): string[] => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        walkDir(filePath, fileList);
      } else {
        // Grab .spec.ts files, excluding this one and vue-test-app
        if (file.endsWith('.spec.ts') && !file.includes('api-coverage') && !file.includes('vue-test-app')) {
          fileList.push(filePath);
        }
      }
    }
    return fileList;
  };

  const allTestFiles = walkDir(testDir);
  const testSource = allTestFiles.map(f => fs.readFileSync(f, 'utf-8')).join('\n');

  const apis: MethodInfo[] = [];

  // Helper to check if a method is called.
  // We look for ".methodName(" to allow for any instance name (e.g., mySteps.methodName() or repo.methodName())
  // Also check for specific utility patterns like utils.getTimeout() or utils.waitForState()
  const checkCoverage = (method: string) => {
    // First try the standard pattern
    const pattern = new RegExp(`\\.\\b${method}\\b\\s*\\(`);
    if (pattern.test(testSource)) return true;

    // Special handling for utility methods that may be called on `utils` instances
    if (method === 'getTimeout') {
      return /utils\.\bgetTimeout\b\s*\(/.test(testSource) || /this\.utils\.\bgetTimeout\b\s*\(/.test(testSource);
    }
    if (method === 'waitForState') {
      return /utils\.\bwaitForState\b\s*\(/.test(testSource) || /this\.utils\.\bwaitForState\b\s*\(/.test(testSource);
    }

    return false;
  };

  // ── Primary APIs ──
  for (const m of getPublicClassMethods(Steps)) {
    apis.push({ name: m, category: 'Steps', tier: 'primary', covered: checkCoverage(m) });
  }

  for (const m of getPublicClassMethods(ElementRepository)) {
    apis.push({ name: m, category: 'ElementRepository', tier: 'primary', covered: checkCoverage(m) });
  }

  for (const m of getPublicClassMethods(ContextStore)) {
    apis.push({ name: m, category: 'ContextStore', tier: 'primary', covered: checkCoverage(m) });
  }

  // ── Advanced/Raw APIs ──
  const advancedClasses = [
    { name: 'Interactions', cls: Interactions },
    { name: 'Verifications', cls: Verifications },
    { name: 'Extractions', cls: Extractions },
    { name: 'Navigation', cls: Navigation },
    { name: 'Utils', cls: Utils },
  ];

  for (const { name: catName, cls } of advancedClasses) {
    for (const m of getPublicClassMethods(cls)) {
      apis.push({ name: m, category: catName, tier: 'advanced', covered: checkCoverage(m) });
    }
  }

  // Manual coverage check for reformatDateString (standalone function, not a class)
  const reformatCovered = /\breformatDateString\b\s*\(/.test(testSource);
  apis.push({ name: 'reformatDateString', category: 'DateUtilities', tier: 'advanced', covered: reformatCovered });

  // ── Build report ──
  const primaryApis = apis.filter((a) => a.tier === 'primary');
  const advancedApis = apis.filter((a) => a.tier === 'advanced');
  const primaryCovered = primaryApis.filter((a) => a.covered);
  const advancedCovered = advancedApis.filter((a) => a.covered);

  const lines: string[] = [
    '',
    '========================================================',
    '                  API COVERAGE REPORT                    ',
    '========================================================',
    '',
    '  PRIMARY APIs (Steps + Repo + ContextStore)',
    '  ------------------------------------------'
  ];

  const buildCategoryReport = (apiList: MethodInfo[]) => {
    const categories = [...new Set(apiList.map((a) => a.category))];
    for (const cat of categories) {
      const catApis = apiList.filter((a) => a.category === cat);
      const catCovered = catApis.filter((a) => a.covered);
      const catPct = catApis.length ? ((catCovered.length / catApis.length) * 100).toFixed(0) : '0';
      
      lines.push('', `  ${cat}: ${catCovered.length}/${catApis.length} (${catPct}%)`);
      for (const api of catApis) {
        lines.push(`    ${api.covered ? '  [x]' : '  [ ]'} ${api.name}`);
      }
    }
  };

  buildCategoryReport(primaryApis);
  lines.push('', `  Primary coverage: ${primaryCovered.length}/${primaryApis.length} (${primaryApis.length ? ((primaryCovered.length / primaryApis.length) * 100).toFixed(1) : 0}%)`);

  lines.push(
    '',
    '  ADVANCED APIs (ElementInteractions raw sub-APIs)',
    '  ------------------------------------------------',
    '  These are the internal APIs that Steps wraps.',
    '  Direct usage is for advanced/custom locator scenarios.'
  );

  buildCategoryReport(advancedApis);
  lines.push('', `  Advanced coverage: ${advancedCovered.length}/${advancedApis.length} (${advancedApis.length ? ((advancedCovered.length / advancedApis.length) * 100).toFixed(1) : 0}%)`);

  // ── Overall summary ──
  const allCovered = apis.filter((a) => a.covered);
  lines.push(
    '',
    '========================================================',
    `  OVERALL: ${allCovered.length}/${apis.length} methods (${apis.length ? ((allCovered.length / apis.length) * 100).toFixed(1) : 0}%)`,
    `  PRIMARY: ${primaryCovered.length}/${primaryApis.length} methods (${primaryApis.length ? ((primaryCovered.length / primaryApis.length) * 100).toFixed(1) : 0}%)`,
    `  ADVANCED: ${advancedCovered.length}/${advancedApis.length} methods (${advancedApis.length ? ((advancedCovered.length / advancedApis.length) * 100).toFixed(1) : 0}%)`,
    '========================================================'
  );

  const uncoveredTotal = apis.filter((a) => !a.covered);
  
  if (uncoveredTotal.length > 0) {
    lines.push('', '  Uncovered methods (not in any test):');
    for (const api of uncoveredTotal) {
      lines.push(`    [ ] [${api.category}] ${api.name}`);
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

  expect(
    uncoveredTotal.length,
    `Test failed because API coverage is not 100%. Uncovered methods: ${uncoveredTotal.map(m => m.name).join(', ')}`
  ).toBe(0);
});