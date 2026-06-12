import { test, expect } from './fixture/StepFixture';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

// ══════════════════════════════════════════════════
// WAIT HONESTY (0.4.0 BREAKING CHANGE)
// waitForState throws on timeout by default;
// { optional: true } restores the soft probe.
// ══════════════════════════════════════════════════

test.describe('waitForState honesty', () => {
    test.beforeEach(async ({ steps, repo }) => {
        // Shorten repo resolution so the wait-level timeout dominates elapsed
        // time (same convention as expect-timeout.spec.ts). The absent-element
        // tests target a real repo entry from another page while staying on `/`.
        repo.setDefaultTimeout(1000);
        await steps.navigateTo('/');
    });

    test('waitForState rejects when the element never reaches the state', async ({ steps }) => {
        await expect(
            steps.waitForState('primaryButton', 'ButtonsPage', 'visible', { timeout: 1500 })
        ).rejects.toThrow(/'ButtonsPage\.primaryButton' did not reach state 'visible'/);
        log('wait-honesty: default wait rejected on timeout — passed');
    });

    test('waitForState with optional:true resolves false instead of throwing', async ({ steps }) => {
        const reached = await steps.waitForState('primaryButton', 'ButtonsPage', 'visible', {
            optional: true,
            timeout: 1500,
        });
        expect(reached).toBe(false);
        log('wait-honesty: optional wait resolved false — passed');
    });

    test('waitForState resolves true for a present element', async ({ steps }) => {
        const reached = await steps.waitForState('pageTitle', 'HomePage', 'visible', { optional: true });
        expect(reached).toBe(true);
        log('wait-honesty: optional wait resolved true for present element — passed');
    });
});
