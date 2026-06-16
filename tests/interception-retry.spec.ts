import { test, expect } from './fixture/StepFixture';
import type { Page } from '@playwright/test';

/**
 * Covers the click target with a fixed full-viewport overlay so a standard
 * Playwright click fails with "intercepts pointer events", exercising the
 * interception-retry fallback in Interactions.clickWithInterceptionRetry.
 */
async function coverWithOverlay(page: Page): Promise<void> {
    await page.evaluate(() => {
        const o = document.createElement('div');
        o.id = 'test-overlay';
        o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.01)';
        document.body.appendChild(o);
    });
}

test.describe('Click interception fallback (default-on)', () => {
    test('fallback fires, annotates the test, and clicks through', async ({ steps, page }, testInfo) => {
        await steps.navigateTo('/');
        await coverWithOverlay(page);

        // Overlay intercepts the pointer — the click succeeds only via the
        // dispatchEvent('click') fallback.
        await steps.click('elementsCard', 'HomePage');

        // Causal assertion: the dispatched click actually navigated.
        await steps.verifyUrlContains('/radiobuttons');

        // The fallback must be report-visible: a Playwright annotation that
        // names the element identity (pageName.elementName).
        const note = testInfo.annotations.find(a => a.type === 'interception-fallback');
        expect(note, 'expected an interception-fallback annotation on the test').toBeTruthy();
        expect(note?.description).toContain('HomePage');
        expect(note?.description).toContain('elementsCard');
        expect(note?.description).toContain('intercepts pointer events');
    });
});
