import { PlatformNotSupportedError } from '../../src';
import { test, expect, requireSettingsApp } from './fixture';

/**
 * One spec, unchanged on web, Android and iOS (design 5.3 "Tests and CI").
 * The page and element names are the same on every platform; only the page
 * repository (tests/cross-platform/page-repository.json) holds one block per
 * platform:
 *
 *   web:     the docker test site — home page -> Submission Form -> sidebar home link.
 *   ios:     Settings (read-only) — root -> General -> the navigation bar's back button.
 *            (English device language: the General title is matched by its localized name.)
 *   android: Settings (read-only) — home -> System -> "Navigate up" (entries provisional:
 *            not yet verified on a device).
 *
 * Every step below is a shared step; nothing toggles, types or changes a setting.
 * The way back is an ON-SCREEN control, never `pressBack` (iOS has no back key).
 */
test.describe('Cross-platform navigation', () => {
    test.beforeAll(requireSettingsApp);

    test('start screen -> destination -> back through the on-screen control', async ({ steps }) => {
        await test.step('the start screen lists entries', async () => {
            await steps.verifyCount('entries', 'StartScreen', { greaterThan: 0 });
        });

        await test.step('the destination entry is brought into view and the start landmark is shown', async () => {
            await steps.scrollIntoView('destinationEntry', 'StartScreen', { direction: 'down' });
            await steps.verifyPresence('landmark', 'StartScreen');
        });

        await test.step('opening the destination shows its landmark', async () => {
            await steps.click('destinationEntry', 'StartScreen');
            await steps.verifyPresence('landmark', 'DestinationScreen');
        });

        await test.step('the on-screen back control returns to the start screen', async () => {
            await steps.click('backButton', 'DestinationScreen');
            await steps.verifyPresence('landmark', 'StartScreen');
            await steps.verifyAbsence('landmark', 'DestinationScreen');
        });
    });

    test('a web-only step works on web and is refused on a device platform', async ({ steps }) => {
        // The one platform branch of this spec: the assertion itself differs.
        if (steps.platform === 'web') {
            await steps.verifyUrlContains('http');
            return;
        }
        const refusal = await steps.verifyUrlContains('/').then(() => undefined, (error: unknown) => error);
        expect(refusal).toBeInstanceOf(PlatformNotSupportedError);
        expect((refusal as PlatformNotSupportedError).method).toBe('verifyUrlContains');
        expect((refusal as PlatformNotSupportedError).platform).toBe(steps.platform);
    });
});
