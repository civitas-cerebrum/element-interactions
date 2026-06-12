import { test as base, expect } from '@playwright/test';
import { baseFixture } from '../src/fixture/BaseFixture';
import type { Page } from '@playwright/test';

// Fixture options are per-baseFixture() call, so the opt-out lives in its own
// spec file (same pattern as the isolated fixture in email-filters.spec.ts).
// Short element timeout keeps the doomed click attempt fast.
const test = baseFixture(base, 'tests/data/page-repository.json', {
    interceptionRetry: false,
    timeout: 4000,
});

async function coverWithOverlay(page: Page): Promise<void> {
    await page.evaluate(() => {
        const o = document.createElement('div');
        o.id = 'test-overlay';
        o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.01)';
        document.body.appendChild(o);
    });
}

test.describe('Click interception opt-out (interceptionRetry: false)', () => {
    test('intercepted click rejects with the original error instead of falling back', async ({ steps, page }) => {
        await steps.navigateTo('/');
        await coverWithOverlay(page);

        await expect(
            steps.click('elementsCard', 'HomePage')
        ).rejects.toThrow(/intercepts pointer events/);

        // The genuine overlay bug surfaced — no silent dispatchEvent navigation.
        expect(page.url()).not.toContain('/radiobuttons');
    });
});
