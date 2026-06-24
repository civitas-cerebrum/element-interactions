import { test, expect } from './fixture/StepFixture';
import { gotoButtons } from './fixture/pageHelpers';

/**
 * Coverage for the residual raw-Playwright gaps closed in this change — the
 * surface a consumer suite previously had to drop to raw `page.*` for:
 *
 * - `steps.navigateTo(...)` returns the navigation `Response`  — status assertions
 * - `steps.waitForLoadState(state, options?)`                   — standalone lifecycle wait
 * - `steps.getLocalStorageKeys()` / `getSessionStorageKeys()`   — storage key enumeration
 * - `steps.getPageText()`                                       — page-level body text
 * - `steps.on(el, page).visible()`                             — visible-duplicate strategy selector
 *
 * All run against the live Vue test app. Storage state is prepared / inspected
 * via `page.evaluate` directly (test code may script raw browser state to drive
 * the framework APIs under verification — the framework src/ never does).
 *
 * Note on routes: the canonical app is a SPA served from GitHub Pages. The root
 * (`/`) is a real served file → HTTP 200; deep links (`/buttons`, unknown
 * routes) 404 at the HTTP layer while the SPA still renders client-side. The
 * status assertions below rely on that: `/` → 200, an unknown deep route → 404.
 */

test.describe('navigateTo — returns the navigation Response', () => {
    test('returns a non-null Response with status 200 for a served route', async ({ steps }) => {
        const res = await steps.navigateTo('/');
        expect(res).not.toBeNull();
        expect(res?.status()).toBe(200);
    });

    test('returns a Response exposing a 404 status for an unknown route', async ({ steps }) => {
        const res = await steps.navigateTo('/this-route-does-not-exist-xyz');
        expect(res).not.toBeNull();
        // Deep links 404 at the HTTP layer on GitHub Pages — the status is the
        // contract a consumer asserts without dropping to raw page.goto.
        expect(res?.status()).toBe(404);
        expect(typeof res?.status()).toBe('number');
    });

    test('return value is ignorable — callers unaffected by the new shape', async ({ steps }) => {
        // The pre-existing call form (ignoring the return) still works.
        await steps.navigateTo('/');
        await steps.verifyUrlContains('/');
    });
});

test.describe('waitForLoadState', () => {
    test("'domcontentloaded' resolves after a navigation", async ({ steps }) => {
        await steps.navigateTo('/');
        await steps.waitForLoadState('domcontentloaded');
        // Reaching here without throwing is the assertion; confirm page is live.
        await gotoButtons(steps);
        await steps.verifyPresence('primaryButton', 'ButtonsPage');
    });

    test("'networkidle' resolves on a quiet page", async ({ steps }) => {
        await gotoButtons(steps);
        await steps.waitForLoadState('networkidle');
        await steps.verifyPresence('primaryButton', 'ButtonsPage');
    });

    test('{ timeout } is respected — busy network trips a short networkidle wait', async ({ steps, page }) => {
        await gotoButtons(steps);
        // Keep the network perpetually busy so 'networkidle' can never settle
        // within the short timeout; the bounded wait must throw.
        await page.evaluate(() => {
            setInterval(() => { void fetch(window.location.href).catch(() => {}); }, 50);
        });
        await expect(
            steps.waitForLoadState('networkidle', { timeout: 300 }),
        ).rejects.toThrow();
    });
});

test.describe('getLocalStorageKeys / getSessionStorageKeys', () => {
    test.beforeEach(async ({ steps, page }) => {
        await gotoButtons(steps);
        await page.evaluate(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
        });
    });

    test('getLocalStorageKeys returns the seeded keys', async ({ steps, page }) => {
        await page.evaluate(() => {
            window.localStorage.setItem('theme', 'dark');
            window.localStorage.setItem('user.name', 'Ada');
        });
        const keys = await steps.getLocalStorageKeys();
        expect(keys).toContain('theme');
        expect(keys).toContain('user.name');
        expect(keys).toHaveLength(2);
    });

    test('getLocalStorageKeys reflects a removed key', async ({ steps, page }) => {
        await page.evaluate(() => {
            window.localStorage.setItem('a', '1');
            window.localStorage.setItem('b', '2');
        });
        await steps.removeLocalStorage('a');
        const keys = await steps.getLocalStorageKeys();
        expect(keys).not.toContain('a');
        expect(keys).toContain('b');
    });

    test('getSessionStorageKeys returns the seeded session keys', async ({ steps, page }) => {
        await page.evaluate(() => {
            window.sessionStorage.setItem('cart.count', '3');
        });
        const keys = await steps.getSessionStorageKeys();
        expect(keys).toContain('cart.count');
        // localStorage is a separate store — its keys never leak into the session set.
        expect(keys).not.toContain('theme');
    });

    test('keys reflect an empty store', async ({ steps }) => {
        // beforeEach cleared both stores.
        expect(await steps.getLocalStorageKeys()).toEqual([]);
        expect(await steps.getSessionStorageKeys()).toEqual([]);
    });
});

test.describe('getPageText', () => {
    test('returns body text containing known on-page copy', async ({ steps }) => {
        await gotoButtons(steps);
        const text = await steps.getPageText();
        // Sidebar nav + page heading copy the canonical app renders.
        expect(text).toContain('UI Components');
        expect(text).toContain('Buttons');
    });

    test('reflects a client-side navigation to a different page', async ({ steps }) => {
        await steps.navigateTo('/');
        await steps.click('textInputsLink', 'SidebarNav');
        await steps.waitForUrl('**/text-inputs');
        const text = await steps.getPageText();
        // Still the same app shell, but now on the Text Inputs route.
        expect(text).toContain('Text Inputs');
    });
});

test.describe('visible() strategy selector', () => {
    test('selects a visible element and composes with .click()', async ({ steps }) => {
        await gotoButtons(steps);
        // primaryButton is rendered and visible; .visible() resolves it and the
        // click drives the page's feedback element (a no-op would leave it empty).
        await steps.on('primaryButton', 'ButtonsPage').visible().click();
        await steps.on('resultText', 'ButtonsPage').verifyTextContains('Primary');
    });

    test('composes with a verification terminal', async ({ steps }) => {
        await gotoButtons(steps);
        await steps.on('primaryButton', 'ButtonsPage').visible().verifyState('visible');
    });

    test('the matcher-tree .visible field still works (no call)', async ({ steps }) => {
        // .visible (property) remains the boolean matcher; .visible() (call) is
        // the strategy selector. Both forms coexist on the same chain object.
        await gotoButtons(steps);
        await steps.on('primaryButton', 'ButtonsPage').visible.toBeTrue();
    });
});
