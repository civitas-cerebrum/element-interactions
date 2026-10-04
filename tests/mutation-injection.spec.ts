import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { baseFixture, forwardMutationInjection, readMutationInjection, MUTATION_RUN_VAR } from '../src';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

/**
 * `baseFixture(base, repo, { mutationInjection: true })` forwards the browser-level
 * mutation payload (`E2E_MUTATION_INIT`, `E2E_MUTATION_CSS`, gated on the explicit
 * `E2E_MUTATION_RUN` opt-in) to every page and frame of the test's context, so a
 * behavioural mutation runner can inject a broken state without a hand-written hook.
 *
 * What these tests guard is not "the mutation eventually showed up" but "the mutation
 * was in place before the first assertion, or the run said so out loud" — a silent
 * no-op is scored as a surviving mutant, i.e. a fabricated coverage gap.
 *
 * Pages are served by a context route, so nothing here needs the test website.
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

async function serve(context: BrowserContext, headers?: Record<string, string>): Promise<void> {
    await context.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: 'text/html', body: SHOP, ...(headers ? { headers } : {}) }));
}

const titleDisplay = (page: Page | ReturnType<Page['mainFrame']>): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.querySelector("[data-testid='title']")!).display);

/**
 * The injected state as the first assertion of a test would see it — read once,
 * with no polling: the CSS is adopted before the document's first script, so there
 * is no window in which a test can observe an unmutated page.
 */
async function mutatedState(page: Page): Promise<{ init: unknown; titleDisplay: string }> {
    return page.evaluate(() => ({
        init: (window as unknown as Record<string, unknown>).__mutated,
        titleDisplay: getComputedStyle(document.querySelector("[data-testid='title']")!).display,
    }));
}

const annotations = (info: { annotations: { type: string; description?: string }[] }, type: string) =>
    info.annotations.filter(a => a.type === type);

base.describe('readMutationInjection', () => {

    base('reads and trims both variables when the run opts in, dropping empty ones', async () => {
        const run = { [MUTATION_RUN_VAR]: '1' };
        expect(readMutationInjection({ ...run, E2E_MUTATION_INIT: `  ${INIT} `, E2E_MUTATION_CSS: CSS })).toEqual({ init: INIT, css: CSS });
        expect(readMutationInjection({ ...run, E2E_MUTATION_INIT: '', E2E_MUTATION_CSS: '   ' })).toEqual({});
        expect(readMutationInjection({ ...run })).toEqual({});
        expect(readMutationInjection({})).toEqual({});
        log('mutation injection: env parsing — passed');
    });

    base('ignores a payload that is not opted in, and says so in the report', async ({}, testInfo) => {
        // The leakage case: a variable left behind by an earlier mutation run in the
        // same CI job, exported by a shell profile, or committed to a .env that this
        // package's dotenv call loads. It must not mutate a normal run.
        expect(readMutationInjection({ E2E_MUTATION_INIT: INIT, E2E_MUTATION_CSS: CSS })).toEqual({});
        expect(readMutationInjection({ [MUTATION_RUN_VAR]: '0', E2E_MUTATION_CSS: CSS })).toEqual({});
        expect(readMutationInjection({ [MUTATION_RUN_VAR]: 'false', E2E_MUTATION_CSS: CSS })).toEqual({});

        const ignored = annotations(testInfo, 'mutation-injection-ignored');
        expect(ignored, 'an ignored payload must be visible in the report, not silent').toHaveLength(3);
        expect(ignored[0].description).toContain(MUTATION_RUN_VAR);

        expect(readMutationInjection({ [MUTATION_RUN_VAR]: 'yes', E2E_MUTATION_CSS: CSS })).toEqual({ css: CSS });
        expect(readMutationInjection({ [MUTATION_RUN_VAR]: 'true', E2E_MUTATION_CSS: CSS })).toEqual({ css: CSS });
        log('mutation injection: opt-in gate — passed');
    });
});

base.describe('forwardMutationInjection', () => {

    base('applies init script and CSS to the main page and to popups', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await serve(context);
            const mutation = await forwardMutationInjection(context, { init: INIT, css: CSS });
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            expect(await mutatedState(page)).toEqual({ init: 'init-applied', titleDisplay: 'none' });

            const [popup] = await Promise.all([context.waitForEvent('page'), page.click("[data-testid='open']")]);
            await popup.waitForLoadState();
            expect(await mutatedState(popup)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
            expect(await mutation.verify(), 'a working injection reports no problems').toEqual([]);
        } finally {
            await context.close();
        }
        log('mutation injection: main page and popup — passed');
    });

    base('re-applies on every load: after a reload and after a popup navigates', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await serve(context);
            await forwardMutationInjection(context, { init: INIT, css: CSS });
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            expect(await mutatedState(page)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
            await page.reload(); // a fresh document: the stylesheet must be adopted again
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

    base('is in place before the first assertion, with `load` still pending', async ({ browser }) => {
        const context = await browser.newContext();
        let releaseImage!: () => void;
        try {
            const imageHeld = new Promise<void>((resolve) => { releaseImage = resolve; });
            await context.route(`${ORIGIN}/slow.png`, async (route) => {
                await imageHeld; // `load` cannot fire while this is pending
                await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) });
            });
            await context.route(`${ORIGIN}/`, (route) => route.fulfill({ contentType: 'text/html', body: `${SHOP}<img src="/slow.png">` }));
            await forwardMutationInjection(context, { init: INIT, css: CSS });
            const page = await context.newPage();
            // The timing the README advertises: a test that asserts at domcontentloaded,
            // or after an action-triggered navigation, on a page whose subresource hangs.
            await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
            expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
            expect(await mutatedState(page), 'the mutation must not wait for `load`').toEqual({ init: 'init-applied', titleDisplay: 'none' });
        } finally {
            releaseImage();
            await context.close();
        }
        log('mutation injection: applied before `load` — passed');
    });

    base('applies under a `style-src` CSP that blocks an injected <style> element', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await serve(context, { 'Content-Security-Policy': "style-src 'self'" });
            await forwardMutationInjection(context, { init: INIT, css: CSS });
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            expect(await mutatedState(page), 'CSSOM is not subject to style-src').toEqual({ init: 'init-applied', titleDisplay: 'none' });

            // The control: the style-element route this policy blocks. Whether it
            // rejects or resolves, the rule never applies — which is why the CSS
            // goes through CSSOM instead.
            await page.addStyleTag({ content: "[data-testid='open'] { visibility: hidden !important; }" }).catch(() => { /* CSP refusal */ });
            const openVisibility = await page.evaluate(() => getComputedStyle(document.querySelector("[data-testid='open']")!).visibility);
            expect(openVisibility, 'addStyleTag is inert under this CSP').toBe('visible');
        } finally {
            await context.close();
        }
        log('mutation injection: style-src CSP — passed');
    });

    base('reaches child iframes, not just top-level pages', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await context.route(`${ORIGIN}/frame`, (route) => route.fulfill({ contentType: 'text/html', body: SHOP }));
            await context.route(`${ORIGIN}/`, (route) => route.fulfill({ contentType: 'text/html', body: `${SHOP}<iframe src="/frame"></iframe>` }));
            await forwardMutationInjection(context, { init: INIT, css: CSS });
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            const frame = page.frameLocator('iframe');
            await expect(frame.locator("[data-testid='title']")).toBeHidden();
            expect(await titleDisplay(page.frames()[1])).toBe('none');
        } finally {
            await context.close();
        }
        log('mutation injection: child iframe — passed');
    });

    base('reports CSS that cannot apply instead of silently ignoring it', async ({ browser }, testInfo) => {
        const context = await browser.newContext();
        try {
            await serve(context);
            const mutation = await forwardMutationInjection(context, { css: 'this is not CSS at all' });
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            const problems = await mutation.verify();
            expect(problems, 'invalid CSS must be reported').toHaveLength(1);
            expect(problems[0]).toContain('did not apply');
            expect(problems[0]).toContain('zero rules');
            expect(annotations(testInfo, 'mutation-injection-error').length).toBeGreaterThan(0);
        } finally {
            await context.close();
        }
        log('mutation injection: invalid CSS reported — passed');
    });

    base('reports CSS whose selectors match nothing — applied, but a no-op', async ({ browser }, testInfo) => {
        const context = await browser.newContext();
        try {
            await serve(context);
            const mutation = await forwardMutationInjection(context, { css: "[data-testid='not-on-this-page'] { display: none }" });
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            // A warning, not a hard failure: an SPA may add the node later.
            expect(await mutation.verify()).toEqual([]);
            const warnings = annotations(testInfo, 'mutation-injection-warning');
            expect(warnings.length, 'a mutation that matched nothing must be visible').toBeGreaterThan(0);
            expect(warnings.map(w => w.description).join(' ')).toContain('no-op');
        } finally {
            await context.close();
        }
        log('mutation injection: mis-selectored CSS warned — passed');
    });

    base('malformed init JS fails in Node under strict, and is reported otherwise', async ({ browser }) => {
        const broken = 'window.__mutated = ;';
        const strictContext = await browser.newContext();
        try {
            await expect(forwardMutationInjection(strictContext, { init: broken }, { strict: true }))
                .rejects.toThrow(/E2E_MUTATION_INIT is not valid JavaScript/);
        } finally {
            await strictContext.close();
        }

        const context = await browser.newContext();
        try {
            await serve(context);
            const mutation = await forwardMutationInjection(context, { init: broken });
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutated)).toBeUndefined();
            expect((await mutation.verify()).join(' ')).toContain('not valid JavaScript');
        } finally {
            await context.close();
        }
        log('mutation injection: malformed init JS — passed');
    });

    base('applies the CSS to a page that was already open and loaded', async ({ browser }) => {
        const context = await browser.newContext();
        try {
            await serve(context);
            const early = await context.newPage(); // created and navigated BEFORE forwarding
            await early.goto(`${ORIGIN}/`);
            await forwardMutationInjection(context, { init: INIT, css: CSS });
            // No reload: the current document of a pre-existing page gets the CSS too.
            expect(await titleDisplay(early)).toBe('none');
            // The init script cannot run "before the page's scripts" in a document that
            // already ran them; the next navigation is where it lands.
            expect(await early.evaluate(() => (window as unknown as Record<string, unknown>).__mutated)).toBeUndefined();
            await early.goto(`${ORIGIN}/second`);
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
            const mutation = await forwardMutationInjection(context, {});
            const page = await context.newPage();
            await page.goto(`${ORIGIN}/`);
            expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutated)).toBeUndefined();
            expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__eiMutationInjection)).toBeUndefined();
            await expect(page.locator("[data-testid='title']")).toBeVisible();
            expect(await mutation.verify()).toEqual([]);
        } finally {
            await context.close();
        }
        log('mutation injection: noop inert — passed');
    });
});

const MUTATION_KEYS = ['E2E_MUTATION_RUN', 'E2E_MUTATION_INIT', 'E2E_MUTATION_CSS'] as const;
const saved = Object.fromEntries(MUTATION_KEYS.map(key => [key, process.env[key]])) as Record<typeof MUTATION_KEYS[number], string | undefined>;
const restoreEnv = () => MUTATION_KEYS.forEach((key) => {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
});

const withInjection = baseFixture(base, 'tests/data/page-repository.json', { mutationInjection: true });
const withoutInjection = baseFixture(base, 'tests/data/page-repository.json');

base.describe('baseFixture({ mutationInjection })', () => {
    base.beforeAll(() => {
        process.env.E2E_MUTATION_RUN = '1';
        process.env.E2E_MUTATION_INIT = INIT;
        process.env.E2E_MUTATION_CSS = CSS;
    });
    base.afterAll(restoreEnv);

    withInjection('forwards an opted-in payload and records that the run is mutated', async ({ context, page, steps }, testInfo) => {
        await serve(context);
        await steps.navigateTo(`${ORIGIN}/`);
        expect(await mutatedState(page)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
        // popups opened from a fixture page receive the injection too
        const [popup] = await Promise.all([context.waitForEvent('page'), page.click("[data-testid='open']")]);
        await popup.waitForLoadState();
        expect(await mutatedState(popup)).toEqual({ init: 'init-applied', titleDisplay: 'none' });

        const active = annotations(testInfo, 'mutation-injection');
        expect(active, 'a mutated run must be recorded on the test').toHaveLength(1);
        expect(active[0].description).toContain('this run is mutated');
        log('mutation injection: fixture option on — passed');
    });

    withInjection('is applied at domcontentloaded, before the first assertion of the test', async ({ context, page, steps }) => {
        await serve(context);
        await steps.navigateTo(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
        expect(await mutatedState(page)).toEqual({ init: 'init-applied', titleDisplay: 'none' });
        log('mutation injection: fixture at domcontentloaded — passed');
    });

    withoutInjection('leaves pages untouched when the option is off (default)', async ({ context, page, steps }) => {
        await serve(context);
        await steps.navigateTo(`${ORIGIN}/`);
        expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutated)).toBeUndefined();
        await expect(page.locator("[data-testid='title']")).toBeVisible();
        log('mutation injection: fixture option off — passed');
    });
});

base.describe('baseFixture({ mutationInjection: true }) without the opt-in', () => {
    base.beforeAll(() => {
        delete process.env.E2E_MUTATION_RUN;
        process.env.E2E_MUTATION_INIT = INIT;
        process.env.E2E_MUTATION_CSS = CSS;
    });
    base.afterAll(restoreEnv);

    withInjection('ignores a leaked payload and says so, instead of mutating a normal run', async ({ context, page, steps }, testInfo) => {
        await serve(context);
        await steps.navigateTo(`${ORIGIN}/`);
        expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutated)).toBeUndefined();
        expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__eiMutationInjection)).toBeUndefined();
        await expect(page.locator("[data-testid='title']")).toBeVisible();
        expect(annotations(testInfo, 'mutation-injection-ignored')).toHaveLength(1);
        expect(annotations(testInfo, 'mutation-injection')).toHaveLength(0);
        log('mutation injection: leaked payload ignored — passed');
    });
});

base.describe('baseFixture({ mutationInjection: true }) with the payload deleted', () => {
    base.beforeAll(() => {
        process.env.E2E_MUTATION_RUN = '1';
        delete process.env.E2E_MUTATION_INIT;
        delete process.env.E2E_MUTATION_CSS;
    });
    base.afterAll(restoreEnv);

    withInjection('is a no-op — the runner\'s noop control through the fixture', async ({ context, page, steps }, testInfo) => {
        await serve(context);
        await steps.navigateTo(`${ORIGIN}/`);
        expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__mutated)).toBeUndefined();
        expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__eiMutationInjection)).toBeUndefined();
        await expect(page.locator("[data-testid='title']")).toBeVisible();
        expect(annotations(testInfo, 'mutation-injection')).toHaveLength(0);
        log('mutation injection: fixture option on, payload deleted — passed');
    });
});
