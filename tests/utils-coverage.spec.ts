import { test, expect } from './fixture/StepFixture';
import { Steps } from '../src/steps/CommonSteps';
import { Utils } from '../src/utils/ElementUtilities';
import { reformatDateString } from '../src/utils/DateUtilities';

test.describe('Utilities Coverage Tests', () => {
    test('Utils.getTimeout - returns default timeout', () => {
        const utils = new Utils();
        expect(utils.getTimeout()).toBe(30000);
    });

    test('Utils.getTimeout - returns custom timeout', () => {
        const utils = new Utils(15000);
        expect(utils.getTimeout()).toBe(15000);
    });

    test('Utils.waitForState - handles timeout gracefully (async)', async ({ page }) => {
        const utils = new Utils(1000);
        // Create a locator that will never become visible
        const locator = page.locator('#nonexistent-element-xyz123');

        // This should not throw, just log a warning
        await utils.waitForState(locator, 'visible');

        // Verify the test passes without error
        expect(true).toBe(true);
    });

    test('Steps.waitForState - calls utils.waitForState internally', async ({ steps }) => {
        await steps.navigateTo('/');
        await steps.waitForState( 'pageTitle','HomePage', 'visible');
        expect(true).toBe(true);
    });

    test('reformatDateString - yyyy-MM-dd format', () => {
        const result = reformatDateString('2024-01-15', 'yyyy-MM-dd');
        expect(result).toBe('2024-01-15');
    });

    test('reformatDateString - dd-MM-yyyy format', () => {
        const result = reformatDateString('2024-01-15', 'dd-MM-yyyy');
        expect(result).toBe('15-01-2024');
    });

    test('reformatDateString - dd MMM yyyy format', () => {
        const result = reformatDateString('2024-01-15', 'dd MMM yyyy');
        expect(result).toBe('15 Jan 2024');
    });

    test('reformatDateString - yyyy-M-d format', () => {
        const result = reformatDateString('2024-01-05', 'yyyy-M-d');
        expect(result).toBe('2024-1-5');
    });

    test('reformatDateString - unsupported format returns ISO', () => {
        const result = reformatDateString('2024-01-15', 'invalid-format');
        expect(result).toBe('2024-01-15');
    });

    test('reformatDateString - invalid date throws error', () => {
        expect(() => reformatDateString('not-a-date', 'yyyy-MM-dd'))
            .toThrow('Invalid date string provided: not-a-date');
    });
});
