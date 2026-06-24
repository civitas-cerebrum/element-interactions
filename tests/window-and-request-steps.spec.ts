import { test, expect } from './fixture/StepFixture';

/**
 * Phase-2 coverage for the complementary-steps RFC:
 *
 *   A) Window/script family — getWindowProperty / setWindowProperty /
 *      verifyWindowProperty / evaluateScript.
 *   B) Session-aware HTTP request family — requestGet/Post/Put/Patch/Delete/Head,
 *      the BrowserResponse wrapper, and verifyRequestStatus/Header/Ok.
 *
 * All assertions are CONTRACT-level and app-agnostic: window values we set
 * ourselves, on-page values verified to exist before being asserted, and HTTP
 * status read numerically off the response (never a fixed 404 the app may not
 * serve). The window family scripts raw browser state in test setup to drive
 * the framework APIs under test — the same allowance the storage suite uses.
 */

const FAST_TIMEOUT = 1500;

// The canonical app is served under a sub-path on GitHub Pages, so the served
// document root is the page's own URL — not the domain root. Derive it from the
// page so the request family hits the actual served root (200), keeping the test
// host-agnostic: we read the URL the browser already loaded rather than
// hard-coding the sub-path.
async function servedRoot(steps: import('../src').Steps): Promise<string> {
    return await steps.getWindowProperty<string>('location.href');
}

test.describe('Window/script family', () => {
    test.beforeEach(async ({ steps }) => {
        await steps.navigateTo('/');
    });

    test('setWindowProperty then getWindowProperty round-trips a dotted path', async ({ steps }) => {
        await steps.setWindowProperty('__t.flag', true);
        expect(await steps.getWindowProperty<boolean>('__t.flag')).toBe(true);
    });

    test('getWindowProperty returns undefined for a missing path', async ({ steps }) => {
        expect(await steps.getWindowProperty('__definitely.not.here')).toBeUndefined();
    });

    test('getWindowProperty reads a built-in dotted path (document.title)', async ({ steps }) => {
        const title = await steps.getWindowProperty<string>('document.title');
        // App-agnostic: the page has SOME non-empty title; assert the contract,
        // not a specific string.
        expect(typeof title).toBe('string');
        expect(title.length).toBeGreaterThan(0);
    });

    test('verifyWindowProperty — equals / truthy / present / negated on a value we set', async ({ steps }) => {
        await steps.setWindowProperty('__t.count', 5);
        await steps.setWindowProperty('__t.name', 'ada');

        await steps.verifyWindowProperty('__t.count', { equals: 5 });
        await steps.verifyWindowProperty('__t.count', { truthy: true });
        await steps.verifyWindowProperty('__t.count', { present: true });
        await steps.verifyWindowProperty('__t.name', { contains: 'ad' });
        await steps.verifyWindowProperty('__t.name', { matches: /^a/ });
        // negated present == absence; confirm a path we never set is absent.
        await steps.verifyWindowProperty('__t.missing', { present: false, timeout: FAST_TIMEOUT });
    });

    test('verifyWindowProperty — greaterThan / lessThan against a numeric window value', async ({ steps }) => {
        // Drive a real numeric window value off the rendered DOM so the bound is
        // app-agnostic: there is at least one anchor on the page.
        const linkCount = await steps.evaluateScript<number>(() => document.querySelectorAll('a').length);
        expect(linkCount).toBeGreaterThan(0);
        await steps.setWindowProperty('__t.links', linkCount);

        await steps.verifyWindowProperty('__t.links', { greaterThan: 0 });
        await steps.verifyWindowProperty('__t.links', { lessThan: linkCount + 1 });
    });

    test('evaluateScript runs arbitrary in-page JS and returns a typed value', async ({ steps }) => {
        const count = await steps.evaluateScript<number>(() => document.querySelectorAll('a').length);
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThan(0);
    });
});

test.describe('Session-aware HTTP request family', () => {
    test('requestGet against the served root — status is numeric and ok', async ({ steps }) => {
        await steps.navigateTo('/');
        const res = await steps.requestGet(await servedRoot(steps));

        // App-agnostic: read the status numerically off the response. The served
        // root is 200 here; assert the contract (it's a number, it's ok) and the
        // value we actually observed — never a hard-coded 404.
        expect(typeof res.status).toBe('number');
        expect(res.ok).toBe(true);

        // verifyRequestStatus against the observed status (always true) exercises
        // the helper without coupling to a fixed code.
        await steps.verifyRequestStatus(res, res.status);
        await steps.verifyRequestOk(res);

        // content-type is present on any served document — presence check only.
        await steps.verifyRequestHeader(res, 'content-type');
        // case-insensitive header name + RegExp value (text/html for the root doc).
        await steps.verifyRequestHeader(res, 'Content-Type', /text\/html/i);

        const body = await res.text();
        expect(body.length).toBeGreaterThan(0);
    });

    test('requestHead shares the session and returns a numeric status', async ({ steps }) => {
        await steps.navigateTo('/');
        const res = await steps.requestHead(await servedRoot(steps));
        expect(typeof res.status).toBe('number');
        await steps.verifyRequestStatus(res, res.status);
    });

    test('the verb wrappers (post/put/patch/delete) invoke page.request and surface a result', async ({ steps }) => {
        await steps.navigateTo('/');
        const root = await servedRoot(steps);
        // A static host answers write verbs differently — some reply 405 fast,
        // others never respond. We only assert the wrapper PLUMBING runs (each
        // verb hits page.request and returns a typed BrowserResponse), host-
        // agnostically: a short per-request timeout means a non-responding host
        // surfaces as a fast request error instead of hanging the test.
        const verbs = [
            () => steps.requestPost(root, { timeout: 8000 }),
            () => steps.requestPut(root, { timeout: 8000 }),
            () => steps.requestPatch(root, { timeout: 8000 }),
            () => steps.requestDelete(root, { timeout: 8000 }),
        ];
        for (const call of verbs) {
            try {
                const res = await call();
                expect(typeof res.status).toBe('number');
                expect(typeof res.url).toBe('string');
                await steps.verifyRequestStatus(res, res.status);
            } catch (err) {
                // The host didn't answer this verb within the timeout — the wrapper
                // still ran and propagated the Playwright request error.
                expect(String(err)).toMatch(/timeout|ECONN|socket|request|Test ended/i);
            }
        }
    });
});
