import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * The steps layer depends on the family interfaces only: it imports nothing
 * from the Appium family, never checks a family class with `instanceof`, and
 * reads the platform's family only in its web-only / platform-only guards
 * (`platformGuard.ts`). Family-specific behaviour lives in the family classes,
 * so another family never needs a change here.
 */

const STEPS_DIR = join(__dirname, '..', 'src', 'steps');

/** Every `.ts` file under `dir`, recursively, as a path relative to the steps directory. */
function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sources(path);
        return entry.name.endsWith('.ts') ? [relative(STEPS_DIR, path)] : [];
    });
}

const files = sources(STEPS_DIR);

/** A module specifier naming the Appium family in any import form: `from`, side-effect `import`, dynamic `import()`, `require()`. */
const APPIUM_IMPORT = /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"][^'"]*appium[^'"]*['"]/gi;

function appiumImports(source: string): string[] {
    return source.match(APPIUM_IMPORT) ?? [];
}

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

    test('the import check catches every import form (control)', () => {
        const forms = [
            `import { AppiumFactory } from '../appium';`,
            `import type { X } from "../appium/AppiumDevice";`,
            `import '../appium/register';`,
            `const m = await import('../appium/AppiumGestures');`,
            `const m = require("../appium");`,
            `const m = require ( '../Appium/x' );`,
        ];
        for (const form of forms) expect(appiumImports(form), form).toHaveLength(1);
        expect(appiumImports(`import { Steps } from './CommonSteps';\nconst label = 'appium';`)).toEqual([]);
    });

    for (const file of files) {
        test(`${file} imports nothing from the Appium family`, () => {
            expect(appiumImports(code(file))).toEqual([]);
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
