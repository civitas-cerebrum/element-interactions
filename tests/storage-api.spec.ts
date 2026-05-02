import { test, expect } from './fixture/StepFixture';
import { Steps } from '../src';
import { gotoButtons } from './fixture/pageHelpers';

/**
 * Coverage for the browser-storage extraction + verification surface:
 *
 * - `steps.getLocalStorage` / `steps.getSessionStorage`              (extraction)
 * - `steps.verifyLocalStorage*` / `steps.verifySessionStorage*`      (assertions)
 * - exact-match / contains / matches / present variants
 * - negation, custom timeout, errorMessage, retry-on-poll semantics
 *
 * Storage state is prepared via `page.evaluate` directly in test setup —
 * test code is allowed to script raw browser state to drive the framework
 * APIs being verified. The framework src/ never reaches in this way; the
 * point of these tests is to confirm the framework wraps the Web Storage API
 * correctly.
 *
 * Negative-path tests construct a `Steps` with a short timeout so failing
 * polls resolve in <1s.
 */

const FAST_TIMEOUT = 500;

test.describe('Extraction — steps.getLocalStorage / steps.getSessionStorage', () => {
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

    test('getLocalStorage returns the stored value', async ({ steps }) => {
        expect(await steps.getLocalStorage('theme')).toBe('dark');
    });

    test('getLocalStorage returns null when key is missing', async ({ steps }) => {
        expect(await steps.getLocalStorage('does-not-exist')).toBeNull();
    });

    test('getLocalStorage handles keys with dot notation', async ({ steps }) => {
        expect(await steps.getLocalStorage('user.name')).toBe('Ada');
    });

    test('getSessionStorage returns the stored value', async ({ steps }) => {
        expect(await steps.getSessionStorage('cart.count')).toBe('3');
    });

    test('getSessionStorage returns null when key is missing', async ({ steps }) => {
        expect(await steps.getSessionStorage('absent')).toBeNull();
    });

    test('getSessionStorage and getLocalStorage are independent stores', async ({ steps }) => {
        // 'theme' lives in localStorage but not sessionStorage
        expect(await steps.getLocalStorage('theme')).toBe('dark');
        expect(await steps.getSessionStorage('theme')).toBeNull();
    });
});

test.describe('Verification — steps.verifyLocalStorage (positive)', () => {
    test.beforeEach(async ({ steps, page }) => {
        await gotoButtons(steps);
        await page.evaluate(() => {
            window.localStorage.clear();
            window.localStorage.setItem('theme', 'dark');
            window.localStorage.setItem('feature.beta', 'enabled-v2');
        });
    });

    test('equals matcher passes on exact match', async ({ steps }) => {
        await steps.verifyLocalStorage('theme', { equals: 'dark' });
    });

    test('contains matcher passes on substring', async ({ steps }) => {
        await steps.verifyLocalStorage('feature.beta', { contains: 'enabled' });
    });

    test('matches matcher passes on regex', async ({ steps }) => {
        await steps.verifyLocalStorage('feature.beta', { matches: /^enabled-v\d+$/ });
    });

    test('present: true passes when key exists', async ({ steps }) => {
        await steps.verifyLocalStorage('theme', { present: true });
    });

    test('equals + negated passes when value differs', async ({ steps }) => {
        await steps.verifyLocalStorage('theme', { equals: 'light', negated: true });
    });

    test('present: false passes when key absent', async ({ steps }) => {
        await steps.verifyLocalStorage('does-not-exist', { present: false });
    });

    test('present: true + negated also passes when key absent (XOR)', async ({ steps }) => {
        await steps.verifyLocalStorage('does-not-exist', { present: true, negated: true });
    });

    test('present: false + negated passes when key exists (XOR)', async ({ steps }) => {
        await steps.verifyLocalStorage('theme', { present: false, negated: true });
    });
});

test.describe('Verification — steps.verifyLocalStorage (negative paths)', () => {
    test.beforeEach(async ({ steps, page }) => {
        await gotoButtons(steps);
        await page.evaluate(() => {
            window.localStorage.clear();
            window.localStorage.setItem('theme', 'dark');
        });
    });

    test('equals throws on mismatch with header + actual value', async ({ repo }) => {
        const fast = new Steps(repo, { timeout: FAST_TIMEOUT });
        await fast.navigateTo('/buttons');
        await expect(
            fast.verifyLocalStorage('theme', { equals: 'light' }),
        ).rejects.toThrow(/expected localStorage\["theme"\] to be "light"[\s\S]*actual: "dark"/);
    });

    test('equals throws when key is missing (actual: null)', async ({ repo }) => {
        const fast = new Steps(repo, { timeout: FAST_TIMEOUT });
        await fast.navigateTo('/buttons');
        await expect(
            fast.verifyLocalStorage('missing', { equals: 'whatever' }),
        ).rejects.toThrow(/expected localStorage\["missing"\] to be "whatever"[\s\S]*actual: null/);
    });

    test('contains throws when key absent', async ({ repo }) => {
        const fast = new Steps(repo, { timeout: FAST_TIMEOUT });
        await fast.navigateTo('/buttons');
        await expect(
            fast.verifyLocalStorage('missing', { contains: 'x' }),
        ).rejects.toThrow(/localStorage\["missing"\] to contain "x"/);
    });

    test('matches throws when regex does not match', async ({ repo }) => {
        const fast = new Steps(repo, { timeout: FAST_TIMEOUT });
        await fast.navigateTo('/buttons');
        await expect(
            fast.verifyLocalStorage('theme', { matches: /^light$/ }),
        ).rejects.toThrow(/localStorage\["theme"\] to match/);
    });

    test('present: true throws when key absent', async ({ repo }) => {
        const fast = new Steps(repo, { timeout: FAST_TIMEOUT });
        await fast.navigateTo('/buttons');
        await expect(
            fast.verifyLocalStorage('missing', { present: true }),
        ).rejects.toThrow(/localStorage\["missing"\] to be present/);
    });

    test('errorMessage option overrides default header', async ({ repo }) => {
        const fast = new Steps(repo, { timeout: FAST_TIMEOUT });
        await fast.navigateTo('/buttons');
        await expect(
            fast.verifyLocalStorage('theme', { equals: 'light', errorMessage: 'CUSTOM HEADER' }),
        ).rejects.toThrow(/CUSTOM HEADER/);
    });

    test('per-call timeout shortens the wait', async ({ repo }) => {
        const slow = new Steps(repo, { timeout: 30000 });
        await slow.navigateTo('/buttons');
        const start = Date.now();
        await expect(
            slow.verifyLocalStorage('theme', { equals: 'light', timeout: 250 }),
        ).rejects.toThrow();
        const elapsed = Date.now() - start;
        // Must respect the per-call override (≤ ~1.5s) rather than waiting the
        // class-level 30s.
        expect(elapsed).toBeLessThan(2000);
    });
});

test.describe('Verification — sessionStorage parity', () => {
    test.beforeEach(async ({ steps, page }) => {
        await gotoButtons(steps);
        await page.evaluate(() => {
            window.sessionStorage.clear();
            window.sessionStorage.setItem('cart.count', '3');
            window.sessionStorage.setItem('flow.step', 'checkout-2');
        });
    });

    test('equals passes on exact match', async ({ steps }) => {
        await steps.verifySessionStorage('cart.count', { equals: '3' });
    });

    test('contains passes on substring', async ({ steps }) => {
        await steps.verifySessionStorage('flow.step', { contains: 'checkout' });
    });

    test('matches passes on regex', async ({ steps }) => {
        await steps.verifySessionStorage('flow.step', { matches: /^checkout-\d+$/ });
    });

    test('present: true passes when key exists', async ({ steps }) => {
        await steps.verifySessionStorage('cart.count', { present: true });
    });

    test('present: false passes when key absent', async ({ steps }) => {
        await steps.verifySessionStorage('absent', { present: false });
    });

    test('equals throws on mismatch with header naming sessionStorage', async ({ repo }) => {
        const fast = new Steps(repo, { timeout: FAST_TIMEOUT });
        await fast.navigateTo('/buttons');
        await expect(
            fast.verifySessionStorage('cart.count', { equals: '99' }),
        ).rejects.toThrow(/expected sessionStorage\["cart.count"\] to be "99"/);
    });
});

test.describe('Retry semantics — value lands after a tick', () => {
    test('verifyLocalStorage waits for late write', async ({ steps, page }) => {
        await gotoButtons(steps);
        await page.evaluate(() => window.localStorage.clear());
        // Schedule a late write: storage gets set ~300ms after the assertion starts.
        page.evaluate(() => {
            setTimeout(() => window.localStorage.setItem('lateKey', 'arrived'), 300);
        });
        await steps.verifyLocalStorage('lateKey', { equals: 'arrived', timeout: 5000 });
    });
});

test.describe('Raw verify.localStorage / verify.sessionStorage — direct API surface', () => {
    // These cover the methods on `Verifications` directly so the per-method
    // dispatch on Steps isn't the only call site (mirrors raw-api.spec.ts pattern).
    test('verify.localStorage and verify.sessionStorage execute directly', async ({ interactions, steps, page }) => {
        await gotoButtons(steps);
        await page.evaluate(() => {
            window.localStorage.clear();
            window.sessionStorage.clear();
            window.localStorage.setItem('k', 'v');
            window.sessionStorage.setItem('s', 't');
        });
        await interactions.verify.localStorage('k', 'v');
        await interactions.verify.localStorageContains('k', 'v');
        await interactions.verify.localStorageMatches('k', /^v$/);
        await interactions.verify.localStoragePresent('k');
        await interactions.verify.sessionStorage('s', 't');
        await interactions.verify.sessionStorageContains('s', 't');
        await interactions.verify.sessionStorageMatches('s', /^t$/);
        await interactions.verify.sessionStoragePresent('s');
    });
});
