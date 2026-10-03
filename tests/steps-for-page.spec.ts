import { test, expect } from './fixture/StepFixture';
import type { Page } from '@playwright/test';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { Steps } from '../src';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

/**
 * `steps.forPage(page)` binds a `Steps` to a popup / new tab without the test
 * constructing an `ElementRepository` itself. Both documents are served by a
 * context route (no server required); the popup is a real `target="_blank"`
 * window, so the new page arrives through `switchToNewTab` exactly as a
 * third-party popup would.
 */

const ORIGIN = 'https://shop.example';

const SHOP = `
    <main>
        <h1>Checkout</h1>
        <a href="/wallet" target="_blank" data-testid="wallet">Pay with wallet</a>
    </main>
`;

const WALLET = `
    <main>
        <h1>Sign in to your wallet</h1>
        <a href="#" data-testid="cancel" onclick="window.close(); return false;">Cancel and return</a>
    </main>
`;

const REPOSITORY = {
    pages: [
        {
            name: 'CheckoutPage',
            elements: [
                { elementName: 'heading', selector: { role: 'heading', name: 'Checkout' } },
                { elementName: 'walletButton', selector: { css: "[data-testid='wallet']" } },
            ],
        },
        {
            name: 'WalletPopup',
            elements: [
                { elementName: 'heading', selector: { role: 'heading', name: { regex: 'sign in', flags: 'i' } } },
                { elementName: 'cancelLink', selector: { role: 'link', name: 'Cancel and return' } },
                { elementName: 'missing', selector: { css: "[data-testid='never-rendered']" } },
            ],
        },
    ],
};

const STEP_TIMEOUT = 1500;

async function checkoutSteps(page: Page): Promise<Steps> {
    await page.context().route(`${ORIGIN}/**`, (route) => {
        const body = new URL(route.request().url()).pathname === '/wallet' ? WALLET : SHOP;
        return route.fulfill({ contentType: 'text/html', body });
    });
    const steps = new Steps(new ElementRepository(page, REPOSITORY, 5000), { timeout: STEP_TIMEOUT });
    await steps.navigateTo(`${ORIGIN}/checkout`);
    return steps;
}

test.describe('steps.forPage — popup / new-tab binding', () => {

    test('resolves repository entries on the popup by name', async ({ page }) => {
        const steps = await checkoutSteps(page);
        const popup = await steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage').then(() => {}));
        const popupSteps = steps.forPage(popup);

        await popupSteps.verifyPresence('heading', 'WalletPopup');
        await popupSteps.verifyText('cancelLink', 'WalletPopup', 'Cancel and return');
        expect(popupSteps.getCurrentPath()).toBe('/wallet');

        // The original Steps is still bound to the checkout page.
        await steps.verifyPresence('heading', 'CheckoutPage');
        expect(steps.getCurrentPath()).toBe('/checkout');
        log('forPage: popup resolution by repository name — passed');
    });

    test('acts on the popup and leaves the opener untouched', async ({ page }) => {
        const steps = await checkoutSteps(page);
        const popup = await steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage').then(() => {}));
        expect(steps.getTabCount()).toBe(2);

        const closed = popup.waitForEvent('close');
        await steps.forPage(popup).click('cancelLink', 'WalletPopup');
        await closed;

        expect(steps.getTabCount()).toBe(1);
        await steps.verifyPresence('walletButton', 'CheckoutPage');
        log('forPage: action on popup — passed');
    });

    test('shares the step timeout with the original Steps', async ({ page }) => {
        const steps = await checkoutSteps(page);
        const popup = await steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage').then(() => {}));
        const started = Date.now();
        await expect(steps.forPage(popup).verifyPresence('missing', 'WalletPopup')).rejects.toThrow();
        // STEP_TIMEOUT is shared (plus the 2s attach cap and CI jitter) — the
        // 30s package default would blow this ceiling.
        expect(Date.now() - started).toBeLessThan(STEP_TIMEOUT + 6000);
        log('forPage: shared timeout — passed');
    });

    test('fails loudly when the repository driver cannot be rebound', async ({ page }) => {
        // A repository whose driver getter ignores the rebinding (e.g. a future
        // internal rename) must not silently hand back steps acting on the opener.
        class LockedDriverRepository extends ElementRepository {
            constructor(private readonly locked: Page) { super(locked, REPOSITORY, 5000); }
            override get driver(): any { return this.locked; }
        }
        const steps = new Steps(new LockedDriverRepository(page), { timeout: STEP_TIMEOUT });
        const other = await page.context().newPage();
        try {
            expect(() => steps.forPage(other)).toThrow(/forPage: cannot rebind repository driver/);
        } finally {
            await other.close();
        }
        log('forPage: unrebindable repository rejected — passed');
    });

    test('forPage on the bound page returns the same Steps', async ({ page }) => {
        const steps = await checkoutSteps(page);
        expect(steps.forPage(page)).toBe(steps);
        log('forPage: identity on the bound page — passed');
    });
});
