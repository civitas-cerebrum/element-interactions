import { test, expect } from './fixture/StepFixture';
import type { Page } from '@playwright/test';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { Steps } from '../src';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

/**
 * Regression tests: visibility probes resolve the repository entry's FULL
 * selector.
 *
 * `isVisible()` / `.isVisible().click()` / `verifyAbsence()` used to build
 * their locator from `repo.getSelector(...)`, which keeps only the first
 * plain-string strategy of an entry:
 *
 *   - role + name   → `[role='button']` — the accessible name is dropped, so
 *                     the probe answers for ANY element carrying that role
 *                     (false "visible") and misses native elements (no
 *                     explicit role attribute) entirely;
 *   - regex text    → `text={"regex":…}` — matches nothing (false "hidden");
 *   - frame pages   → queried in the top document, never inside the frame.
 *
 * Actions (`click`, `fill`, `verify*`) resolve through `repo.get(...)` and were
 * always right, so a gate could skip — or run — the opposite way from the
 * action it guards. Each selector kind gets its own case below. Like
 * tests/click-retry-safety.spec.ts, these use page.setContent() — no server.
 */

const SHOP = `
    <main>
        <div role="button" tabindex="0" data-testid="add">Add to basket</div>
        <button type="button" onclick="window.__applyClicks = (window.__applyClicks || 0) + 1">Apply code</button>
        <button type="button" style="display:none" onclick="window.__hiddenClicks = (window.__hiddenClicks || 0) + 1">Secret</button>
        <p class="summary">Total ¤12.50</p>
        <ul>
            <li class="row" style="display:none">first</li>
            <li class="row">second</li>
        </ul>
        <iframe title="Payment form"
                srcdoc="<button type='button' data-testid='pay'>Pay now</button>"></iframe>
    </main>
`;

const REPOSITORY = {
    pages: [
        {
            name: 'ShopPage',
            elements: [
                { elementName: 'addToBasket', selector: { role: 'button', name: 'Add to basket' } },
                // Absent — but another element with role="button" is shown.
                { elementName: 'checkoutButton', selector: { role: 'button', name: 'Checkout' } },
                // Native <button>: no explicit role attribute.
                { elementName: 'applyCode', selector: { role: 'button', name: 'Apply code' } },
                { elementName: 'secretButton', selector: { role: 'button', name: 'Secret' } },
                { elementName: 'rows', selector: { css: '.row' } },
                { elementName: 'lateHidden', selector: { css: '#late' } },
                // Fallback chains attach-wait each node; neither node of ghostChain exists.
                { elementName: 'ghostChain', selector: { css: '#ghost-1', fallback: { css: '#ghost-2' } } },
                { elementName: 'fallbackHit', selector: { css: '#nope', fallback: { role: 'button', name: 'Apply code' } } },
                { elementName: 'totalLine', selector: { text: { regex: 'Total ¤[0-9.]+' } } },
                { elementName: 'refundLine', selector: { text: { regex: 'Refund ¤[0-9.]+' } } },
            ],
        },
        {
            name: 'PaymentFrame',
            frame: { css: "iframe[title='Payment form']" },
            elements: [
                { elementName: 'payButton', selector: { css: "[data-testid='pay']" } },
                { elementName: 'cancelButton', selector: { css: "[data-testid='cancel']" } },
            ],
        },
    ],
};

const PROBE_TIMEOUT = 400;

async function shopSteps(page: Page): Promise<Steps> {
    await page.setContent(SHOP);
    await page.frameLocator("iframe[title='Payment form']").locator("[data-testid='pay']").waitFor();
    // Repository default of 15s: a probe that paid it would blow the budget assertions below.
    return new Steps(new ElementRepository(page, REPOSITORY, 15000), { timeout: 2000 });
}

test.describe('Visibility probes resolve the full repository selector', () => {

    test('role + name: a named control is probed by its accessible name', async ({ page }) => {
        const steps = await shopSteps(page);
        expect(await steps.isVisible('addToBasket', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(true);
        // Before the fix: `[role='button']` matched "Add to basket" → true.
        expect(await steps.isVisible('checkoutButton', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(false);
        // Before the fix: `[role='button']` never matches a native <button> → false.
        expect(await steps.isVisible('applyCode', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(true);
        log('probe resolution: role + name — passed');
    });

    test('regex text: the pattern is honoured', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix: `text={"regex":…}` matched nothing → false.
        expect(await steps.isVisible('totalLine', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(true);
        expect(await steps.isVisible('refundLine', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(false);
        expect(await steps.isVisible('totalLine', 'ShopPage', { timeout: PROBE_TIMEOUT, containsText: '¤12.50' })).toBe(true);
        log('probe resolution: regex text — passed');
    });

    test('frame page: the probe looks inside the frame', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix: queried in the top document → false.
        expect(await steps.isVisible('payButton', 'PaymentFrame', { timeout: PROBE_TIMEOUT })).toBe(true);
        expect(await steps.isVisible('cancelButton', 'PaymentFrame', { timeout: PROBE_TIMEOUT })).toBe(false);
        log('probe resolution: frame page — passed');
    });

    test('fluent form agrees with the Steps form', async ({ page }) => {
        const steps = await shopSteps(page);
        expect(await steps.on('checkoutButton', 'ShopPage').isVisible({ timeout: PROBE_TIMEOUT })).toBe(false);
        expect(await steps.on('applyCode', 'ShopPage').isVisible({ timeout: PROBE_TIMEOUT })).toBe(true);
        log('probe resolution: fluent form — passed');
    });

    test('gate acts on a present named control and skips an absent one', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix the probe missed the native <button>, so the gate
        // skipped the click silently.
        await steps.isVisible('applyCode', 'ShopPage', { timeout: PROBE_TIMEOUT }).click();
        expect(await page.evaluate(() => (window as unknown as Record<string, number>).__applyClicks)).toBe(1);
        // Before the fix `[role='button']` opened the gate, and doubleClick()
        // (no second visibility check of its own) then waited for a "Checkout"
        // control that does not exist, failing after the step timeout.
        await steps.isVisible('checkoutButton', 'ShopPage', { timeout: PROBE_TIMEOUT }).doubleClick();
        expect(await steps.on('refundLine', 'ShopPage').isVisible({ timeout: PROBE_TIMEOUT }).clickIfPresent()).toBe(false);
        // Positive skip: a present-but-hidden control is probed false, so the gated action never reaches it.
        await steps.isVisible('secretButton', 'ShopPage', { timeout: PROBE_TIMEOUT }).doubleClick();
        await steps.isVisible('secretButton', 'ShopPage', { timeout: PROBE_TIMEOUT }).click();
        expect(await page.evaluate(() => (window as unknown as Record<string, number>).__hiddenClicks)).toBeUndefined();
        log('probe resolution: gate act / skip — passed');
    });

    test('a missing element reports false within the probe budget', async ({ page }) => {
        const steps = await shopSteps(page);
        for (const [el, pg] of [['checkoutButton', 'ShopPage'], ['refundLine', 'ShopPage'], ['cancelButton', 'PaymentFrame']]) {
            const started = Date.now();
            expect(await steps.isVisible(el, pg, { timeout: PROBE_TIMEOUT })).toBe(false);
            // Far below the 15s repository default, and (with the distinct-timeout test below) pins the probe to its own budget.
            expect(Date.now() - started, `${pg}.${el} probe elapsed`).toBeLessThan(PROBE_TIMEOUT + 1500);
        }
        log('probe resolution: short timeout honoured — passed');
    });

    test('the probe honours its own timeout: two distinct budgets scale the wait', async ({ page }) => {
        const steps = await shopSteps(page);
        const measure = async (timeout: number) => {
            const started = Date.now();
            expect(await steps.isVisible('checkoutButton', 'ShopPage', { timeout })).toBe(false);
            return Date.now() - started;
        };
        const short = await measure(300);
        const long = await measure(1200);
        // Ignoring the param would make both take the Steps default (2000ms) and be equal.
        expect(short, 'short probe elapsed').toBeLessThan(900);
        expect(long, 'long probe elapsed').toBeGreaterThanOrEqual(900);
        expect(long, 'long probe elapsed').toBeLessThan(1800);
        log('probe resolution: distinct budgets — passed');
    });

    test('a fallback chain that matches nothing is probed within the probe budget', async ({ page }) => {
        const steps = await shopSteps(page);
        const started = Date.now();
        expect(await steps.isVisible('ghostChain', 'ShopPage', { timeout: 300 })).toBe(false);
        // Per-node attach waits at 300ms stay under 1800ms; the 15s repository default per node would not.
        expect(Date.now() - started, 'ghost chain probe elapsed').toBeLessThan(1800);
        log('probe resolution: fallback chain — passed');
    });

    test('one budget: attach time is deducted from the visibility wait', async ({ page }) => {
        const steps = await shopSteps(page);
        // Attaches (hidden) after 1000ms; a probe with a 1500ms budget must give up at ~1500ms,
        // not 1000 + 1500 = 2500ms.
        await page.evaluate(() => setTimeout(() => {
            const el = document.createElement('div');
            el.id = 'late';
            el.style.display = 'none';
            document.body.appendChild(el);
        }, 1000));
        const started = Date.now();
        expect(await steps.isVisible('lateHidden', 'ShopPage', { timeout: 1500 })).toBe(false);
        const elapsed = Date.now() - started;
        expect(elapsed, 'probe elapsed').toBeGreaterThanOrEqual(1300);
        expect(elapsed, 'probe elapsed').toBeLessThan(2100);
        log('probe resolution: single budget — passed');
    });

    test('timeout 0 is clamped, not "wait forever"', async ({ page }) => {
        const steps = await shopSteps(page);
        const started = Date.now();
        expect(await steps.isVisible('checkoutButton', 'ShopPage', { timeout: 0 })).toBe(false);
        expect(await steps.on('checkoutButton', 'ShopPage').isVisible({ timeout: 0 })).toBe(false);
        expect(Date.now() - started, 'timeout:0 probes elapsed').toBeLessThan(3000);
        log('probe resolution: timeout 0 — passed');
    });

    test('containsText mismatch reports false', async ({ page }) => {
        const steps = await shopSteps(page);
        expect(await steps.isVisible('totalLine', 'ShopPage', { timeout: PROBE_TIMEOUT, containsText: 'nope' })).toBe(false);
        expect(await steps.isVisible('applyCode', 'ShopPage', { timeout: PROBE_TIMEOUT, containsText: 'Apply' })).toBe(true);
        log('probe resolution: containsText mismatch — passed');
    });
});

test.describe('verifyAbsence resolves the full repository selector', () => {

    test('passes for absent entries of every selector kind', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix: `[role='button']` was visible → false failure.
        await steps.verifyAbsence('checkoutButton', 'ShopPage');
        await steps.verifyAbsence('refundLine', 'ShopPage');
        await steps.verifyAbsence('cancelButton', 'PaymentFrame');
        log('absence resolution: absent entries — passed');
    });

    test('an absent entry is asserted fast, not after the 15s repository default', async ({ page }) => {
        const steps = await shopSteps(page);
        for (const [el, pg] of [['checkoutButton', 'ShopPage'], ['refundLine', 'ShopPage'], ['cancelButton', 'PaymentFrame']]) {
            const started = Date.now();
            await steps.verifyAbsence(el, pg);
            expect(Date.now() - started, `${pg}.${el} absence elapsed`).toBeLessThan(2500);
        }
        log('absence resolution: fast attach budget — passed');
    });

    test('a fallback chain is asserted absent without the repository attach wait', async ({ page }) => {
        const steps = await shopSteps(page);
        const started = Date.now();
        await steps.verifyAbsence('ghostChain', 'ShopPage');
        // 1ms attach budget per node; the 15s repository default per node would be 30s.
        expect(Date.now() - started, 'ghost chain absence elapsed').toBeLessThan(2500);
        await expect(steps.verifyAbsence('fallbackHit', 'ShopPage')).rejects.toThrow();
        log('absence resolution: fallback chain — passed');
    });

    test('multi-match entry: a visible later match fails the absence assertion', async ({ page }) => {
        const steps = await shopSteps(page);
        // First match hidden, second visible: asserting on the first match alone would pass.
        await expect(steps.verifyAbsence('rows', 'ShopPage')).rejects.toThrow();
        log('absence resolution: multi-match — passed');
    });

    test('fails for present entries of every selector kind', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix the regex-text and frame cases passed silently: the
        // selector they asserted on could never match anything.
        await expect(steps.verifyAbsence('totalLine', 'ShopPage')).rejects.toThrow();
        await expect(steps.verifyAbsence('payButton', 'PaymentFrame')).rejects.toThrow();
        await expect(steps.verifyAbsence('applyCode', 'ShopPage')).rejects.toThrow();
        log('absence resolution: present entries — passed');
    });
});
