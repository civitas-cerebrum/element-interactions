import { test, expect } from './fixture/StepFixture';
import { gotoButtons } from './fixture/pageHelpers';

/**
 * Coverage for the Steps-API gaps closed in 0.3.7 — the surface a consumer
 * suite (Mr Marvis e2e) previously had to drop to raw Playwright `page.*` for:
 *
 * - `steps.navigateTo(url, { waitUntil })`            — non-`'load'` lifecycle wait
 * - `steps.getUrl()` / `steps.getCurrentPath()`       — current-URL getters
 * - `steps.waitForUrl(url, action?, options?)`        — URL predicate / race wait
 * - `steps.setLocalStorage` / `steps.setSessionStorage` — storage setters
 * - `steps.removeLocalStorage` / `removeSessionStorage` / `clearLocalStorage` /
 *   `clearSessionStorage`                              — storage removers / clears
 * - `steps.waitForNetworkIdle({ timeout, optional })`  — bounded / optional idle wait
 *
 * All run against the live Vue test app. Storage state is prepared / inspected
 * via `page.evaluate` directly (test code may script raw browser state to drive
 * the framework APIs under verification — the framework src/ never does).
 */

test.describe('navigateTo — waitUntil option', () => {
    test('waitUntil "domcontentloaded" resolves and lands on the URL', async ({ steps }) => {
        await steps.navigateTo('/buttons', { waitUntil: 'domcontentloaded' });
        await steps.verifyUrlContains('/buttons');
        // Page is genuinely interactive, not just committed.
        await steps.verifyPresence('primaryButton', 'ButtonsPage');
    });

    test('default (no waitUntil) still navigates and lands', async ({ steps }) => {
        await steps.navigateTo('/text-inputs');
        await steps.verifyUrlContains('/text-inputs');
    });

    test('query option still composes with waitUntil', async ({ steps }) => {
        await steps.navigateTo('/buttons', { query: { foo: 'bar' }, waitUntil: 'domcontentloaded' });
        expect(steps.getUrl()).toContain('foo=bar');
        await steps.verifyUrlContains('/buttons');
    });

    test('query is inserted before a hash fragment, preserving the fragment', async ({ steps }) => {
        await steps.navigateTo('/buttons#section', { query: { foo: 'bar' } });
        const url = steps.getUrl();
        expect(url).toContain('foo=bar');
        expect(url).toContain('#section');
        // The query must land BEFORE the fragment (`?foo=bar#section`), never
        // folded into it (`#section?foo=bar`).
        expect(url.indexOf('foo=bar')).toBeLessThan(url.indexOf('#section'));
    });
});

test.describe('getUrl / getCurrentPath', () => {
    test('getUrl returns the full href after navigation', async ({ steps }) => {
        await gotoButtons(steps);
        const url = steps.getUrl();
        expect(url).toMatch(/^https?:\/\//);
        expect(url).toContain('/buttons');
    });

    test('getCurrentPath returns only the pathname', async ({ steps }) => {
        await gotoButtons(steps);
        // pathname ends with the route and carries no query (base-path-agnostic
        // across the app's deployments).
        expect(steps.getCurrentPath()).toMatch(/\/buttons$/);
        expect(steps.getCurrentPath()).not.toContain('?');
        // The full href still carries the query the pathname strips.
        await steps.navigateTo('/');
        await steps.click('textInputsLink', 'SidebarNav');
        await steps.waitForUrl('**/text-inputs');
        expect(new URL(steps.getUrl()).pathname).toBe(steps.getCurrentPath());
    });

    test('getUrl reflects a client-side navigation', async ({ steps }) => {
        await steps.navigateTo('/');
        const home = steps.getCurrentPath();
        await steps.click('buttonsLink', 'SidebarNav');
        await steps.waitForUrl('**/buttons');
        expect(steps.getCurrentPath()).not.toBe(home);
        expect(steps.getCurrentPath()).toMatch(/\/buttons$/);
    });
});

test.describe('waitForUrl', () => {
    test('string glob form resolves after the URL changes', async ({ steps }) => {
        await steps.navigateTo('/');
        await steps.click('buttonsLink', 'SidebarNav');
        await steps.waitForUrl('**/buttons');
        expect(steps.getCurrentPath()).toMatch(/\/buttons$/);
    });

    test('RegExp form resolves (contains-style match)', async ({ steps }) => {
        await steps.navigateTo('/');
        await steps.click('checkboxesLink', 'SidebarNav');
        await steps.waitForUrl(/\/checkboxes$/);
        expect(steps.getCurrentPath()).toMatch(/\/checkboxes$/);
    });

    test('predicate form receives the live URL', async ({ steps }) => {
        await steps.navigateTo('/');
        await steps.click('textInputsLink', 'SidebarNav');
        await steps.waitForUrl((u: URL) => u.pathname.endsWith('/text-inputs'));
        expect(steps.getCurrentPath()).toMatch(/\/text-inputs$/);
    });

    test('race form: action armed before the navigation, both settle', async ({ steps }) => {
        await steps.navigateTo('/');
        // The wait is armed concurrently with the click — a fast client-side
        // route change cannot slip through the act→wait gap.
        await steps.waitForUrl(
            '**/table',
            async () => { await steps.click('tableLink', 'SidebarNav'); },
        );
        expect(steps.getCurrentPath()).toMatch(/\/table$/);
    });

    test('race form with predicate + timeout option', async ({ steps }) => {
        await steps.navigateTo('/');
        await steps.waitForUrl(
            (u: URL) => u.pathname.endsWith('/sortable'),
            async () => { await steps.click('sortableLink', 'SidebarNav'); },
            { timeout: 10000 },
        );
        expect(steps.getCurrentPath()).toMatch(/\/sortable$/);
    });
});

test.describe('setLocalStorage / setSessionStorage', () => {
    test.beforeEach(async ({ steps, page }) => {
        await gotoButtons(steps);
        await page.evaluate(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
        });
    });

    test('setLocalStorage round-trips with getLocalStorage', async ({ steps }) => {
        await steps.setLocalStorage('theme', 'dark');
        expect(await steps.getLocalStorage('theme')).toBe('dark');
    });

    test('setSessionStorage round-trips with getSessionStorage', async ({ steps }) => {
        await steps.setSessionStorage('cart.count', '3');
        expect(await steps.getSessionStorage('cart.count')).toBe('3');
    });

    test('setLocalStorage stores a deliberately malformed value verbatim', async ({ steps }) => {
        const bogus = 'not-json-{[bogus';
        await steps.setLocalStorage('wishlist', bogus);
        // The setter writes the raw string; getter reads it back unchanged.
        expect(await steps.getLocalStorage('wishlist')).toBe(bogus);
    });

    test('setLocalStorage overwrites an existing value', async ({ steps }) => {
        await steps.setLocalStorage('k', 'first');
        await steps.setLocalStorage('k', 'second');
        expect(await steps.getLocalStorage('k')).toBe('second');
    });

    test('local and session setters target independent stores', async ({ steps }) => {
        await steps.setLocalStorage('only', 'local');
        await steps.setSessionStorage('only', 'session');
        expect(await steps.getLocalStorage('only')).toBe('local');
        expect(await steps.getSessionStorage('only')).toBe('session');
    });
});

test.describe('removeLocalStorage / removeSessionStorage / clear*', () => {
    test.beforeEach(async ({ steps, page }) => {
        await gotoButtons(steps);
        await page.evaluate(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
            window.localStorage.setItem('theme', 'dark');
            window.localStorage.setItem('user.name', 'Ada');
            window.sessionStorage.setItem('cart.count', '3');
        });
    });

    test('removeLocalStorage drops one key and leaves the rest', async ({ steps }) => {
        await steps.removeLocalStorage('theme');
        expect(await steps.getLocalStorage('theme')).toBeNull();
        expect(await steps.getLocalStorage('user.name')).toBe('Ada');
    });

    test('removeLocalStorage is a no-op for an absent key', async ({ steps }) => {
        await steps.removeLocalStorage('does-not-exist');
        expect(await steps.getLocalStorage('theme')).toBe('dark');
    });

    test('removeSessionStorage drops the key', async ({ steps }) => {
        await steps.removeSessionStorage('cart.count');
        expect(await steps.getSessionStorage('cart.count')).toBeNull();
    });

    test('clearLocalStorage empties localStorage but not sessionStorage', async ({ steps }) => {
        await steps.clearLocalStorage();
        expect(await steps.getLocalStorage('theme')).toBeNull();
        expect(await steps.getLocalStorage('user.name')).toBeNull();
        // sessionStorage is a separate store — untouched by clearLocalStorage.
        expect(await steps.getSessionStorage('cart.count')).toBe('3');
    });

    test('clearSessionStorage empties sessionStorage but not localStorage', async ({ steps }) => {
        await steps.clearSessionStorage();
        expect(await steps.getSessionStorage('cart.count')).toBeNull();
        expect(await steps.getLocalStorage('theme')).toBe('dark');
    });
});

test.describe('waitForNetworkIdle — bounded / optional', () => {
    test('no-arg form still settles on a quiet page', async ({ steps }) => {
        await gotoButtons(steps);
        await steps.waitForNetworkIdle();
        // Reaching here without throwing is the assertion; confirm page is live.
        await steps.verifyPresence('primaryButton', 'ButtonsPage');
    });

    test('optional: true swallows a short timeout instead of throwing', async ({ steps, page }) => {
        await gotoButtons(steps);
        // Keep the network perpetually busy so 'networkidle' can never be
        // reached within the short timeout; optional must swallow it.
        await page.evaluate(() => {
            setInterval(() => { void fetch(window.location.href).catch(() => {}); }, 50);
        });
        await steps.waitForNetworkIdle({ timeout: 300, optional: true });
        // No throw — assert we are still on a live page.
        await steps.verifyPresence('primaryButton', 'ButtonsPage');
    });

    test('non-optional short timeout against busy network throws', async ({ steps, page }) => {
        await gotoButtons(steps);
        await page.evaluate(() => {
            setInterval(() => { void fetch(window.location.href).catch(() => {}); }, 50);
        });
        await expect(
            steps.waitForNetworkIdle({ timeout: 300 }),
        ).rejects.toThrow();
    });
});
