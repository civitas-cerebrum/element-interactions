import { test as base, expect } from '@playwright/test';
import * as path from 'path';
import { baseFixture, resolvePlatform, PlatformNotSupportedError } from '../../src';
import { requireAppCapabilities } from '../cross-platform/appGuard';

/**
 * Live iOS check of the platform steps against the built-in Settings app on a
 * real device or simulator. READ-ONLY: it opens, reads, scrolls, swipes and
 * navigates into General and back. It never toggles a switch, changes a
 * setting, types into a field, opens the Apple Account page or another app.
 *
 * Skipped unless the resolved platform is `ios`. Run it:
 *
 *   E2E_PLATFORM=ios E2E_CAPABILITIES=<capabilities-file> APPIUM_URL=<appium-server-url-with-base-path> \
 *     npx playwright test -c playwright.platform.config.ts tests/live
 *
 * The capabilities file is a flat W3C object (see tests/capabilities/README.md)
 * checked against an ALLOW-LIST before a session is opened
 * (tests/cross-platform/appGuard.ts): only `platformName`,
 * `automationName`, `deviceName`, `udid`, `platformVersion`, `bundleId`,
 * `newCommandTimeout`, `noReset`, `fullReset`, alert, permission and driver
 * timeout keys (each with or without `appium:`, never both, never
 * `appium:options`); `"appium:bundleId": "com.apple.Preferences"`;
 * `"appium:noReset": true` REQUIRED; `appium:fullReset` absent or `false`;
 * `autoAcceptAlerts`, `autoDismissAlerts` and `autoGrantPermissions` absent
 * or `false`.
 * Anything else (`appium:app`, `appium:otherApps`, `browserName`, ...) is
 * refused.
 *
 * The row labels and the General navigation bar title are read in English
 * (`General`); the accessibility ids (`com.apple.settings.*`) do not depend on
 * the device language. The title whose text is verified is the header static
 * text inside the navigation bar: the bar itself has no label and no value,
 * so its visible text is empty.
 */
const platform = resolvePlatform(undefined);
const ROOT = 'SettingsRoot';
const GENERAL = 'GeneralScreen';

// No `session.capabilities` here: the app guard checks the file named by
// E2E_CAPABILITIES, so the session must open from that same file.
const test = baseFixture(base, path.join(__dirname, 'page-repository.json'), {
    platform,
    // Generous: the first gesture in a fresh iOS session took 15-30 s live.
    timeout: 60_000,
    session: { reset: 'relaunch' },
});

test.describe('live iOS Settings (read-only)', () => {
    test.skip(platform !== 'ios', 'Live iOS check: runs only when E2E_PLATFORM=ios (with E2E_CAPABILITIES and APPIUM_URL).');
    test.describe.configure({ timeout: 300_000 });

    // Runs before the session opens: refuses any file that is not the Settings
    // app read-only (no other app, no install, no reset). See appGuard.ts.
    test.beforeAll(() => requireAppCapabilities(platform));

    test('opens Settings in the foreground', async ({ steps }) => {
        await steps.verifyAppInForeground();
        await steps.verifyCount('cells', ROOT, { greaterThan: 0 });
    });

    test('verifyText reads a row label (polling)', async ({ steps }) => {
        await steps.verifyText('generalRow', ROOT, 'General');
        await steps.verifyTextContains('generalRowByPredicate', ROOT, 'Gen');
    });

    test('scrollIntoView with direction down reaches a row further down the root list', async ({ steps }) => {
        await steps.scrollIntoView('privacyRow', ROOT, { direction: 'down' });
        await steps.verifyPresence('privacyRow', ROOT);
    });

    test('swipeScreen up then down moves the list and back', async ({ steps }) => {
        await steps.scrollIntoView('generalRow', ROOT, { direction: 'down' });
        const before = await steps.getBoundingBox('generalRow', ROOT);
        expect(before).not.toBeNull();

        // Finger up: the content moves up, so the General row moves up (or leaves the tree).
        await steps.swipeScreen('up');
        const after = await steps.getBoundingBox('generalRow', ROOT, { timeout: 5_000 }).catch(() => null);
        if (after) expect(after.y).toBeLessThan(before!.y);

        // Finger down: the content comes back.
        await steps.swipeScreen('down');
        const back = await steps.getBoundingBox('generalRow', ROOT);
        expect(back).not.toBeNull();
        if (after) expect(back!.y).toBeGreaterThan(after.y);
    });

    test('scrollUntilFound finds a row down the list, then a row back up', async ({ steps }) => {
        await steps.scrollUntilFound('privacyRow', ROOT, { direction: 'down', timeout: 120_000 });
        await steps.verifyPresence('privacyRow', ROOT);
        await steps.scrollUntilFound('generalRow', ROOT, { direction: 'up', timeout: 120_000 });
        await steps.verifyPresence('generalRow', ROOT);
    });

    test('navigates into General and back with the on-screen back button', async ({ steps }) => {
        await steps.scrollIntoView('generalRow', ROOT, { direction: 'down' });
        await steps.click('generalRow', ROOT);
        // Polls through the push animation until the General title reads "General".
        await steps.verifyText('title', GENERAL, 'General');
        await steps.click('backButton', GENERAL);
        await steps.verifyPresence('generalRow', ROOT);
        await steps.verifyAbsence('navigationBar', GENERAL);
    });

    test('the first step, a non-polling page source read, already sees the Settings tree', async ({ steps }) => {
        // No polling step before it: the relaunch itself must have waited
        // until Settings was in the foreground.
        const source = await steps.getPageSource();
        expect(source).toContain('XCUIElementType');
        expect(source, 'the page source holds the General row of Settings').toContain('com.apple.settings.general');
    });

    test('a web-only step throws PlatformNotSupportedError', async ({ steps }) => {
        let refusal: unknown;
        try {
            steps.getUrl();
        } catch (error) {
            refusal = error;
        }
        expect(refusal).toBeInstanceOf(PlatformNotSupportedError);
        expect((refusal as PlatformNotSupportedError).method).toBe('getUrl');
        expect((refusal as PlatformNotSupportedError).platform).toBe('ios');
    });

    test('pressBack throws PlatformNotSupportedError on ios', async ({ steps }) => {
        const refusal = await steps.pressBack().then(() => undefined, (error: unknown) => error);
        expect(refusal).toBeInstanceOf(PlatformNotSupportedError);
        expect((refusal as PlatformNotSupportedError).method).toBe('pressBack');
        expect((refusal as PlatformNotSupportedError).platform).toBe('ios');
    });
});
