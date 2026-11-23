import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * The steps layer depends on the family interfaces only: it imports nothing
 * from the Appium family, never checks a family class with `instanceof`, and
 * reads the platform's family only in its web-only / platform-only guards
 * (`platformGuard.ts`). Family-specific behaviour lives in the family classes,
 * so another family never needs a change here.
 */

const STEPS_DIR = join(__dirname, '..', 'src', 'steps');
const files = readdirSync(STEPS_DIR).filter(f => f.endsWith('.ts'));

/** The source of `file` with comments removed, so a comment that names a family never counts. */
function code(file: string): string {
    return readFileSync(join(STEPS_DIR, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

test.describe('the steps layer depends on the family interfaces only', () => {
    test('there are steps files to check (control)', () => {
        expect(files).toEqual(expect.arrayContaining(['CommonSteps.ts', 'ElementAction.ts', 'ExpectMatchers.ts', 'VisibleChain.ts', 'platformGuard.ts']));
    });

    for (const file of files) {
        test(`${file} imports nothing from the Appium family`, () => {
            const imports = code(file).match(/from\s+['"][^'"]+['"]/g) ?? [];
            expect(imports.filter(i => /appium/i.test(i))).toEqual([]);
        });

        test(`${file} uses no instanceof on a family class`, () => {
            expect(code(file).match(/instanceof\s+(Appium|Playwright)\w*/g) ?? []).toEqual([]);
        });

        if (file !== 'platformGuard.ts') {
            test(`${file} does not branch on the driver family`, () => {
                expect(code(file).match(/\bfamilyOf\s*\(/g) ?? []).toEqual([]);
            });
        }
    }
});
