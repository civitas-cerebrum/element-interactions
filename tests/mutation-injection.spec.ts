import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { baseFixture, forwardMutationInjection, readMutationInjection } from '../src';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

/**
 * `baseFixture(base, repo, { mutationInjection: true })` forwards the two
 * browser-level mutation variables (`E2E_MUTATION_INIT`, `E2E_MUTATION_CSS`)
 * to every page of the test's context — popups included — so a behavioural
 * mutation runner can inject a broken state without a hand-written hook.
 * Pages are served by a context route (no server required).
 */

const ORIGIN = 'https://shop.example';

const SHOP = `
    <main>
        <h1 data-testid="title">Catalogue</h1>
        <a href="/popup" target="_blank" data-testid="open">Open</a>
    </main>
`;

const INIT = 'window.__mutated = "init-applied";';
const CSS = "[data-testid='title'] { display: none !important; }";

async function serve(context: BrowserContext): Promise<void> {
    await context.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html', body: SHOP }));
}

async function mutatedState(page: Page): Promise<{ init: unknown; titleDisplay: string }> {
    await page.locator("[data-testid='title']").waitFor({ state: 'attached' });
    // The style tag is attached on `load`; poll until the computed style settles.
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('style').length)).toBeGreaterThan(0);
    return page.evaluate(() => ({
        init: (window as unknown as Record<string, unknown>).__mutated,
        titleDisplay: getComputedStyle(document.querySelector("[data-testid='title']")!).display,
    }));
}

base.describe('readMutationInjection', () => {

    base('reads and trims both variables, dropping empty ones', async () => {
        expect(readMutationInjection({ E2E_MUTATION_INIT: `  ${INIT} `, E2E_MUTATION_CSS: CSS })).toEqual({ init: INIT, css: CSS });
        expect(readMutationInjection({ E2E_MUTATION_INIT: '', E2E_MUTATION_CSS: '   ' })).toEqual({});
        expect(readMutationInjection({})).toEqual({});
        log('mutation injection: env parsing — passed');
    });
});

base.describe('forwardMutationInjection', () => {

    base('applies init script and CSS to the main page and to popups', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await serve(context);
            await forwardMutationInjection(context, { init: INIT, css: CSS });
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            expect(await mutatedState(page)).toEqual({ init: 'init-applied', titleDisplay: 'none' });

            const [popup] = await Promise.all([context.waitForEvent('page'), page.click("[data-testid='open']")]);
            await popup.waitForLoadState();
            expect(await mutatedState(popup)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
        } finally {
            await context.close();
        }
        log('mutation injection: main page and popup — passed');
    });

    base('re-applies the CSS on every load: after a reload and after a popup navigates', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await serve(context);
            await forwardMutationInjection(context, { init: INIT, css: CSS });
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            expect(await mutatedState(page)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
            await page.reload(); // a fresh document: the style tag must be attached again
            expect(await mutatedState(page)).toEqual({ init: 'init-applied', titleDisplay: 'none' });

            const [popup] = await Promise.all([context.waitForEvent('page'), page.click("[data-testid='open']")]);
            await popup.waitForLoadState();
            await popup.goto(`${ORIGIN}/second`);
            expect(await mutatedState(popup)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
        } finally {
            await context.close();
        }
        log('mutation injection: re-applied on every load — passed');
    });

    base('applies to a page that existed before forwarding', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await serve(context);
            const early = await context.newPage(); // created BEFORE the injection is forwarded
            await forwardMutationInjection(context, { init: INIT, css: CSS });
            await early.goto(`${ORIGIN}/`);
            expect(await mutatedState(early)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
        } finally {
            await context.close();
        }
        log('mutation injection: pre-existing page — passed');
    });

    base('is inert when nothing is set (the noop control)', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await serve(context);
            await forwardMutationInjection(context, {});
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutated)).toBeUndefined();
            await expect(page.locator("[data-testid='title']")).toBeVisible();
        } finally {
            await context.close();
        }
        log('mutation injection: noop inert — passed');
    });
});

const saved = { init: process.env.E2E_MUTATION_INIT, css: process.env.E2E_MUTATION_CSS };
const restore = (key: 'E2E_MUTATION_INIT' | 'E2E_MUTATION_CSS', value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
};

const withInjection = baseFixture(base, 'tests/data/page-repository.json', { mutationInjection: true });
const withoutInjection = baseFixture(base, 'tests/data/page-repository.json');

base.describe('baseFixture({ mutationInjection })', () => {
    base.beforeAll(() => {
        process.env.E2E_MUTATION_INIT = INIT;
        process.env.E2E_MUTATION_CSS = CSS;
    });
    base.afterAll(() => {
        restore('E2E_MUTATION_INIT', saved.init);
        restore('E2E_MUTATION_CSS', saved.css);
    });

    withInjection('forwards the environment when the option is on', async ({ context, page, steps }) => {
        await serve(context);
        await steps.navigateTo(`${ORIGIN}/`);
        expect(await mutatedState(page)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
        // popups opened from a fixture page receive the injection too
        const [popup] = await Promise.all([context.waitForEvent('page'), page.click("[data-testid='open']")]);
        await popup.waitForLoadState();
        expect(await mutatedState(popup)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
        log('mutation injection: fixture option on — passed');
    });

    withoutInjection('leaves pages untouched when the option is off (default)', async ({ context, page, steps }) => {
        await serve(context);
        await steps.navigateTo(`${ORIGIN}/`);
        expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutated)).toBeUndefined();
        await expect(page.locator("[data-testid='title']")).toBeVisible();
        log('mutation injection: fixture option off — passed');
    });
});

base.describe('baseFixture({ mutationInjection: true }) with both variables deleted', () => {
    base.beforeAll(() => {
        delete process.env.E2E_MUTATION_INIT;
        delete process.env.E2E_MUTATION_CSS;
    });
    base.afterAll(() => {
        restore('E2E_MUTATION_INIT', saved.init);
        restore('E2E_MUTATION_CSS', saved.css);
    });

    withInjection('is a no-op — the runner\'s noop control through the fixture', async ({ context, page, steps }) => {
        await serve(context);
        await steps.navigateTo(`${ORIGIN}/`);
        expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutated)).toBeUndefined();
        expect(await page.evaluate(() => document.querySelectorAll('style').length)).toBe(0);
        await expect(page.locator("[data-testid='title']")).toBeVisible();
        log('mutation injection: fixture option on, env deleted — passed');
    });
});
