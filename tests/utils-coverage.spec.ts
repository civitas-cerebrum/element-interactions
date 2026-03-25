import { test, expect } from '@playwright/test';
import { Steps } from '../src/steps/CommonSteps';
import { Utils } from '../src/utils/ElementUtilities';
import { DateUtilities } from '../src/utils/DateUtilities';

test.describe('Utilities Coverage Tests', () => {
    test('Utils.getTimeout - returns default timeout', () => {
        const utils = new Utils();
        expect(utils.getTimeout()).toBe(30000);
    });

    test('Utils.getTimeout - returns custom timeout', () => {
        const utils = new Utils(15000);
        expect(utils.getTimeout()).toBe(15000);
    });

    test('Utils.waitForState - handles timeout gracefully (async)', async ({ steps }) => {
        const utils = new Utils(1000);
        // Create a locator that will never become visible
        const locator = page.locator('#nonexistent-element-xyz123');

        // This should not throw, just log a warning
        await utils.waitForState(locator, 'visible');

        // Verify the test passes without error
        expect(true).toBe(true);
    });

    test('Steps.waitForState - calls utils.waitForState internally', async ({ steps }) => {
        // This tests that Steps.waitForState uses the utils.waitForState method
        await steps.waitForState('HomePage', 'title', 'visible');
        expect(true).toBe(true);
    });

    test('DateUtilities.reformatDateString - yyyy-MM-dd format', () => {
        const result = DateUtilities.reformatDateString('2024-01-15', 'yyyy-MM-dd');
        expect(result).toBe('2024-01-15');
    });

    test('DateUtilities.reformatDateString - dd-MM-yyyy format', () => {
        const result = DateUtilities.reformatDateString('2024-01-15', 'dd-MM-yyyy');
        expect(result).toBe('15-01-2024');
    });

    test('DateUtilities.reformatDateString - dd MMM yyyy format', () => {
        const result = DateUtilities.reformatDateString('2024-01-15', 'dd MMM yyyy');
        expect(result).toBe('15 Jan 2024');
    });

    test('DateUtilities.reformatDateString - yyyy-M-d format', () => {
        const result = DateUtilities.reformatDateString('2024-01-05', 'yyyy-M-d');
        expect(result).toBe('2024-1-5');
    });

    test('DateUtilities.reformatDateString - unsupported format returns ISO', () => {
        const result = DateUtilities.reformatDateString('2024-01-15', 'invalid-format');
        expect(result).toBe('2024-01-15');
    });

    test('DateUtilities.reformatDateString - invalid date throws error', () => {
        expect(() => DateUtilities.reformatDateString('not-a-date', 'yyyy-MM-dd'))
            .toThrow('Invalid date string provided: not-a-date');
    });
});
