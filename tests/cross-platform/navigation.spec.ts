import { PlatformNotSupportedError } from '../../src';
import { test, expect, requireDeviceApp } from './fixture';

/**
 * One spec, unchanged on web, Android and iOS.
 * The page and element names are the same on every platform; only the page
 * repository (tests/cross-platform/page-repository.json) holds one block per
 * platform:
 *
 *   web:     the docker test site — home page -> Submission Form -> sidebar home link.
 *   ios:     Settings (read-only) — root -> General -> the navigation bar's back button.
 *            (English device language: the General title is matched by its localized name.)
 *   android: the test app com.civitas.testapp — home grid -> the Edge Cases category list ->
 *            system back (entries provisional: not yet verified on a device).
 *
 * Every step below is a shared step; nothing toggles, types or changes a setting.
 * The way back (`goBack`, from the fixture) is the destination's ON-SCREEN back
 * control on web and iOS (iOS has no back key); the Android test app has no
 * on-screen back control, so there it is the system back.
 */
test.describe('Cross-platform navigation', () => {
    test.beforeAll(requireDeviceApp);

    test('start screen -> destination -> back to the start screen', async ({ steps, goBack }) => {
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

        await test.step('going back returns to the start screen', async () => {
            await goBack();
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
