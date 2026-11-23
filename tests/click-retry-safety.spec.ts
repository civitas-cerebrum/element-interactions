import { test, expect } from './fixture/StepFixture';
import { errors, type Page } from '@playwright/test';
import { Interactions, classifyClickFailure, isTimeoutError } from '../src/playwright/PlaywrightInteractions';
import { WebElement } from '@civitas-cerebrum/element-repository';

/**
 * Regression tests for the click double-fire defect in
 * Interactions.clickWithInterceptionRetry.
 *
 * The capped (5s max) first click attempt can time out AFTER Playwright has
 * dispatched the click's input. The old catch-all branch then blind-re-clicked
 * with the full timeout, which (a) inverted toggle controls and (b) wedged
 * against an overlay the first click had just opened. The fix classifies the
 * failed attempt by its call-log phase and only retries when the log proves
 * input was never dispatched.
 *
 * The first describe isolates those two mechanisms in purpose-built widgets:
 * a toggle group inside a dialog, and a trigger whose overlay covers it once
 * open (fixed positioning above the trigger's stacking context, plus a 300ms
 * entry animation so the actionability wait is realistic). The deadline race
 * itself is driven by a blocking handler — real environment slowness cannot be
 * summoned on demand.
 *
 * Like tests/upload-drop-unit.spec.ts, these Interactions-level tests use
 * page.setContent() — no server required.
 */

const counter = (page: Page, key: '__optionClicks' | '__triggerClicks') =>
    page.evaluate(k => (window as unknown as Record<string, number>)[k], key);

/**
 * A toggle group inside a dialog: each button flips its own `data-state` /
 * `aria-pressed`, so a second physical click deselects what the first selected.
 */
const TOGGLE_GROUP = `
    <style>
        body { margin: 0; font-family: system-ui, sans-serif; }
        .sheet { position: fixed; inset-inline: 0; bottom: 0; height: 100dvh; z-index: 50;
                 background: #fff; overflow: auto; animation: slide-up .3s ease-out; }
        @keyframes slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .option-list { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 16px; margin: 0; }
        .option-button { width: 54px; height: 59px; border: 1.5px solid #ccc; background: #eee; }
        .option-button[data-state="on"] { border-color: #000; }
    </style>
    <div class="sheet" role="dialog" data-testid="option-sheet" data-state="open" tabindex="-1" aria-label="Options">
        <h2>Options</h2>
        <ul class="option-list">
            <li class="option-item"><button class="option-button" type="button" data-state="off" aria-pressed="false">Option A</button></li>
            <li class="option-item"><button class="option-button" type="button" data-state="off" aria-pressed="false">Option B</button></li>
            <li class="option-item"><button class="option-button" type="button" data-state="off" aria-pressed="false">Option C</button></li>
            <li class="option-item"><button class="option-button" type="button" data-state="off" aria-pressed="false">Option D</button></li>
        </ul>
    </div>
    <script>
        window.__optionClicks = 0;
        document.querySelectorAll('li.option-item > button.option-button').forEach(function (btn) {
            btn.addEventListener('click', function () {
                window.__optionClicks++;
                var on = btn.getAttribute('data-state') === 'on';
                btn.setAttribute('data-state', on ? 'off' : 'on');
                btn.setAttribute('aria-pressed', on ? 'false' : 'true');
            });
        });
    </script>
`;

/**
 * A trigger in a low-stacking-context header that mounts a full-bleed overlay
 * above itself: once open, the panel covers the very button that opened it.
 */
const COVERING_OVERLAY = `
    <style>
        body { margin: 0; font-family: system-ui, sans-serif; }
        .site-header { position: sticky; top: 0; z-index: 40; background: #fff;
                       display: flex; justify-content: flex-end; padding: 12px 16px; border-bottom: 1px solid #ddd; }
        .filler { height: 200vh; }
        .scrim { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.5); animation: fade-in .3s ease-out; }
        .panel { position: fixed; top: 0; bottom: 0; right: 0; width: 100%; z-index: 50; background: #fff;
                 display: flex; flex-direction: column; animation: slide-in .3s ease-out; }
        @keyframes slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    </style>
    <header class="site-header">
        <button data-testid="overlay-trigger" type="button">Open panel</button>
    </header>
    <div class="filler"></div>
    <template id="panel-template">
        <div class="scrim"></div>
        <div class="panel" role="dialog" data-testid="overlay-panel" data-state="open" tabindex="-1" aria-label="Panel">
            <button type="button">Close</button>
            <p>Panel body</p>
        </div>
    </template>
    <script>
        window.__triggerClicks = 0;
        document.querySelector('[data-testid="overlay-trigger"]').addEventListener('click', function () {
            window.__triggerClicks++;
            if (document.querySelector('[data-testid="overlay-panel"]')) return;
            document.body.appendChild(document.getElementById('panel-template').content.cloneNode(true));
        });
    </script>
`;

/**
 * Stalls the renderer for 6s the first time `selector` is clicked — longer than
 * the 5s first-attempt cap, so the attempt times out in the "performing click
 * action" phase AFTER input was dispatched. Registered after the widget's own
 * handler, so the state change lands first.
 */
async function blockRendererOnFirstClick(page: Page, selector: string): Promise<void> {
    await page.evaluate((sel) => {
        document.querySelector(sel)!.addEventListener('click', () => {
            const end = Date.now() + 6000;
            while (Date.now() < end) { /* block the renderer */ }
        }, { once: true });
    }, selector);
}

test.describe('Deadline click on non-idempotent controls', () => {
    // A small mobile-ish viewport, so the overlay covers the whole header.
    test.use({ viewport: { width: 390, height: 640 } });

    const OPTION = "[role='dialog'] li.option-item button.option-button";
    const SELECTED = `${OPTION}[data-state='on']`;
    const TRIGGER = "[data-testid='overlay-trigger']";

    test('toggle inversion: a deadline click on a toggle is not re-clicked', async ({ page }, testInfo) => {
        test.setTimeout(60000);
        await page.setContent(TOGGLE_GROUP);
        await blockRendererOnFirstClick(page, OPTION);

        const interactions = new Interactions(page, 15000);
        await interactions.click(new WebElement(page.locator(OPTION).nth(0)));
        await interactions.click(new WebElement(page.locator(OPTION).nth(1)));

        // End state, not "two clicks happened": the blind retry re-clicked the
        // first toggle and switched it back off, leaving one selected.
        await expect(page.locator(SELECTED)).toHaveCount(2);
        expect(await page.locator(OPTION).nth(0).getAttribute('aria-pressed')).toBe('true');
        expect(await counter(page, '__optionClicks'), 'one click per toggle, no re-fire').toBe(2);

        const note = testInfo.annotations.find(a => a.type === 'deadline-click');
        expect(note, 'expected a deadline-click annotation on the test').toBeTruthy();
        expect(note?.description).toContain('performing click action');
    });

    test('open-then-wedge: a deadline click that opens a covering overlay is not re-clicked', async ({ page }, testInfo) => {
        test.setTimeout(60000);
        await page.setContent(COVERING_OVERLAY);
        await blockRendererOnFirstClick(page, TRIGGER);

        const interactions = new Interactions(page, 15000);
        const started = Date.now();
        await interactions.click(new WebElement(page.locator(TRIGGER)));
        const elapsed = Date.now() - started;

        // The panel the first click opened now covers its own trigger. The old
        // shape re-clicked into it and burned the whole budget before failing
        // with "subtree intercepts pointer events".
        await expect(page.locator("[data-testid='overlay-panel'][data-state='open']")).toBeVisible();
        expect(await counter(page, '__triggerClicks'), 'the panel opened exactly once').toBe(1);
        expect(elapsed, `expected the call to settle at the cap, took ${elapsed}ms`).toBeLessThan(10000);
        expect(testInfo.annotations.find(a => a.type === 'deadline-click')).toBeTruthy();
    });

    test('ifPresent path inherits the deadline handling', async ({ page }, testInfo) => {
        test.setTimeout(60000);
        await page.setContent(TOGGLE_GROUP);
        await blockRendererOnFirstClick(page, OPTION);

        const interactions = new Interactions(page, 15000);
        expect(await interactions.clickIfPresent(new WebElement(page.locator(OPTION).nth(0)))).toBe(true);

        await expect(page.locator(SELECTED)).toHaveCount(1);
        expect(await counter(page, '__optionClicks')).toBe(1);
        expect(testInfo.annotations.find(a => a.type === 'deadline-click')).toBeTruthy();
    });

    test('interceptionRetry: false does not re-arm the re-click on the deadline path', async ({ page }) => {
        test.setTimeout(60000);
        // The opt-out is scoped to the interception fallback (surfacing genuine
        // overlay bugs). It must not reintroduce the wedge.
        await page.setContent(COVERING_OVERLAY);
        await blockRendererOnFirstClick(page, TRIGGER);

        const interactions = new Interactions(page, 15000, false);
        await interactions.click(new WebElement(page.locator(TRIGGER)));

        await expect(page.locator("[data-testid='overlay-panel'][data-state='open']")).toBeVisible();
        expect(await counter(page, '__triggerClicks')).toBe(1);
    });
});

/**
 * Renders a click-counting button and returns its WebElement. Used by the
 * branches the widget fixtures above cannot reach — a permanently disabled
 * control, and a driver-level failure that cannot be provoked from the page.
 */
async function pageWithCountingButton(page: Page, disabled = false): Promise<WebElement> {
    await page.setContent(`
        <button id="btn" ${disabled ? 'disabled' : ''}>Click me</button>
        <div id="count" data-testid="click-count">0</div>
        <script>
            window.__clicks = 0;
            document.getElementById('btn').addEventListener('click', () => {
                window.__clicks++;
                document.getElementById('count').textContent = String(window.__clicks);
            });
        </script>
    `);
    return new WebElement(page.locator('#btn'));
}

const btnClicks = (page: Page) => page.evaluate(() => (window as unknown as { __clicks: number }).__clicks);

test.describe('Click retry safety (branches the widget fixtures cannot reach)', () => {
    test('never-actionable click stays inside the caller budget instead of cap + full retry', async ({ page }) => {
        test.setTimeout(60000);
        // Button never becomes enabled, so the click can only fail. The old
        // shape paid the 5s capped attempt AND a fresh full-timeout retry
        // (~13s for an 8s budget); the continuation now runs on the REMAINING
        // budget, so total elapsed stays bounded by the caller's timeout.
        const button = await pageWithCountingButton(page, true);
        const interactions = new Interactions(page, 8000);

        const started = Date.now();
        await expect(interactions.click(button)).rejects.toThrow();
        const elapsed = Date.now() - started;

        // 9.5s on an 8s budget: tight enough to catch a partial overrun, with
        // ~1.5s of slack for CI jitter. The old shape took ~13s.
        expect(elapsed, `expected the failure inside the 8s budget, took ${elapsed}ms`).toBeLessThan(9500);
        expect(await btnClicks(page)).toBe(0);
    });

    test('non-timeout failure is rethrown, never masked by a dispatched click', async ({ page }) => {
        const button = await pageWithCountingButton(page);

        // A hard driver failure (page/context closed, protocol error) surfacing
        // from the click attempt itself. Stubbing the Element's click is the
        // only way to produce one deterministically: on the real click path a
        // closed page or strict-mode violation is raised upstream by
        // waitForState, so this branch would otherwise never be exercised.
        const fatal = new Error('locator.click: Target page, context or browser has been closed');
        (button as unknown as { click: () => Promise<void> }).click = async () => { throw fatal; };

        const interactions = new Interactions(page, 5000);
        await expect(interactions.click(button)).rejects.toThrow(/has been closed/);

        // Causal assertion: no fallback click was dispatched to paper over the
        // error — the page saw nothing. (Letting `fatal` fall through to the
        // dispatchEvent fallback flips this to 1 and stops the rejection.)
        expect(await btnClicks(page)).toBe(0);
    });

    test('waiting-phase timeout: full-timeout retry is preserved and clicks exactly once', async ({ page }, testInfo) => {
        test.setTimeout(60000);
        // Button starts disabled and only becomes enabled AFTER the 5s
        // first-attempt cap, so the capped attempt provably times out while
        // still "waiting for element to be visible, enabled and stable" —
        // input was never dispatched, and the retry must still happen.
        const button = await pageWithCountingButton(page, true);
        await page.evaluate(() => {
            setTimeout(() => document.getElementById('btn')!.removeAttribute('disabled'), 6000);
        });

        const interactions = new Interactions(page, 15000);
        await interactions.click(button);

        expect(await btnClicks(page)).toBe(1);
        expect(testInfo.annotations.find(a => a.type === 'deadline-click')).toBeFalsy();
    });

    for (const option of ['force', 'withoutScrolling'] as const) {
        test(`click({ ${option} }) on a never-attached element fails within one timeout`, async ({ page }) => {
            await pageWithCountingButton(page);
            const missing = new WebElement(page.locator('#never-there'));
            const interactions = new Interactions(page);

            // 1.5s is under the 2s soft-probe cap, so a probe before the click's own
            // attach wait would make this fail after about twice the timeout.
            const started = Date.now();
            await expect(interactions.click(missing, { [option]: true, timeout: 1500 })).rejects.toThrow(/Timeout 1500ms exceeded/);
            const elapsed = Date.now() - started;
            expect(elapsed, `expected the failure after about 1.5s, took ${elapsed}ms`).toBeLessThan(2700);
        });

        test(`click({ ${option} }) dispatches once on an attached element, and on one attached late within the timeout`, async ({ page }) => {
            const button = await pageWithCountingButton(page);
            const interactions = new Interactions(page);
            await interactions.click(button, { [option]: true, timeout: 1500 });
            expect(await btnClicks(page)).toBe(1);

            await page.evaluate(() => {
                setTimeout(() => {
                    const late = document.createElement('button');
                    late.id = 'late';
                    late.addEventListener('click', () => { (window as unknown as { __clicks: number }).__clicks++; });
                    document.body.appendChild(late);
                }, 500);
            });
            await interactions.click(new WebElement(page.locator('#late')), { [option]: true, timeout: 3000 });
            expect(await btnClicks(page)).toBe(2);
        });
    }

    test('fast path: an immediately actionable click is unchanged', async ({ page }, testInfo) => {
        const button = await pageWithCountingButton(page);

        const interactions = new Interactions(page);
        await interactions.click(button);

        expect(await btnClicks(page)).toBe(1);
        expect(testInfo.annotations.find(a => a.type === 'deadline-click')).toBeFalsy();
        expect(testInfo.annotations.find(a => a.type === 'interception-fallback')).toBeFalsy();
    });
});

test.describe('classifyClickFailure', () => {
    // Verbatim Playwright call-log shapes (same format as the CI traces that
    // proved the defect: toggle inversion and open-then-wedge).
    const deadlineTimeout = () => {
        const err = new Error([
            'locator.click: Timeout 5000ms exceeded.',
            'Call log:',
            "  - waiting for locator('#btn')",
            '  -   locator resolved to <button id="btn">Click me</button>',
            '  - attempting click action',
            '  -   waiting for element to be visible, enabled and stable',
            '  -   element is visible, enabled and stable',
            '  -   scrolling into view if needed',
            '  -   done scrolling',
            '  -   performing click action',
        ].join('\n'));
        err.name = 'TimeoutError';
        return err;
    };

    const waitingPhaseTimeout = () => {
        const err = new Error([
            'locator.click: Timeout 5000ms exceeded.',
            'Call log:',
            "  - waiting for locator('#btn')",
            '  -   locator resolved to <button disabled id="btn">Click me</button>',
            '  - attempting click action',
            '  -   waiting for element to be visible, enabled and stable',
            '  -   element is not enabled',
            '  - retrying click action',
            '  -   waiting 20ms',
        ].join('\n'));
        err.name = 'TimeoutError';
        return err;
    };

    const interceptionTimeout = () => {
        const err = new Error([
            'locator.click: Timeout 5000ms exceeded.',
            'Call log:',
            "  - waiting for locator('#btn')",
            '  - attempting click action',
            '  -   waiting for element to be visible, enabled and stable',
            '  -   element is visible, enabled and stable',
            '  -   scrolling into view if needed',
            '  -   done scrolling',
            '  -   performing click action',
            '  -   <div id="overlay"></div> from <body> subtree intercepts pointer events',
            '  - retrying click action',
        ].join('\n'));
        err.name = 'TimeoutError';
        return err;
    };

    test('timeout that reached input dispatch is input-may-have-fired', () => {
        expect(classifyClickFailure(deadlineTimeout())).toBe('input-may-have-fired');
    });

    test('timeout still in an actionability waiting phase is not-dispatched', () => {
        expect(classifyClickFailure(waitingPhaseTimeout())).toBe('not-dispatched');
    });

    test('interception wins over performing click action (input was NOT dispatched)', () => {
        expect(classifyClickFailure(interceptionTimeout())).toBe('interception');
    });

    test('hard errors are fatal — never swallowed as a delivered click, never re-clicked', () => {
        // Same call log shape, but not a timeout — e.g. the page closed
        // mid-action. Must surface as-is rather than be masked by another click.
        const hardError = new Error([
            'locator.click: Target page, context or browser has been closed',
            'Call log:',
            '  - attempting click action',
            '  -   performing click action',
        ].join('\n'));
        expect(classifyClickFailure(hardError)).toBe('fatal');
    });

    // Classifier contract only: on the main click path a strict-mode violation
    // is raised upstream by waitForState and never reaches the classifier. This
    // pins the behaviour for the paths that do (continuation attempt, callers
    // using Interactions directly).
    test('strict-mode violations classify as fatal', () => {
        const strict = new Error(
            'locator.click: Error: strict mode violation: locator(\'button\') resolved to 2 elements',
        );
        expect(classifyClickFailure(strict)).toBe('fatal');
    });

    test('non-Error values are fatal', () => {
        expect(classifyClickFailure('boom')).toBe('fatal');
    });

    test('classification is by error class, not by a "Timeout Nms exceeded" substring', () => {
        // A non-timeout error whose text merely mentions a timeout must not be
        // treated as a driver timeout — the old message-sniffing shape did.
        const impostor = new Error([
            'locator.click: Error: Timeout 5000ms exceeded was reported by the app under test',
            'Call log:',
            '  -   performing click action',
        ].join('\n'));
        expect(classifyClickFailure(impostor)).toBe('fatal');

        const real = new errors.TimeoutError('locator.click: some wording the driver may change\n  -   performing click action');
        expect(classifyClickFailure(real)).toBe('input-may-have-fired');
        expect(isTimeoutError(real)).toBe(true);
        expect(isTimeoutError(impostor)).toBe(false);
    });
});
