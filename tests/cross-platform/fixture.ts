import { test as base } from '@playwright/test';
import * as path from 'path';
import { baseFixture, resolvePlatform } from '../../src';
import { requireSettingsCapabilities } from './settingsGuard';

/**
 * The fixture of the cross-platform spec: one `baseFixture` call that serves
 * web, Android and iOS. The platform comes from `PLATFORM` (unset: web).
 * Capabilities and server come ONLY from `CAPABILITIES` / `APPIUM_URL`
 * (CONTRACT C2): nothing about a device or a server is written here.
 *
 *   web (default suite): the docker test site at the config's baseURL.
 *   ios:     PLATFORM=ios CAPABILITIES=<capabilities-file> APPIUM_URL=<appium-server-url-with-base-path> \
 *              npx playwright test -c playwright.platform.config.ts tests/cross-platform
 *   android: the same with PLATFORM=android.
 *
 * The capabilities file must name the built-in Settings app
 * (`appium:bundleId: com.apple.Preferences` on iOS,
 * `appium:appPackage: com.android.settings` on Android) and nothing that
 * installs or resets (see `settingsGuard.ts`).
 */
export const platform = resolvePlatform(undefined);

const stepsTest = baseFixture(base, path.join(__dirname, 'page-repository.json'), {
    platform,
    // Generous: the first gesture in a fresh iOS session took 15-30 s live.
    timeout: 60_000,
    session: { reset: 'relaunch' },
});

/**
 * Every test starts on the start screen: on a device the fixture relaunches
 * the app before each test (`reset: 'relaunch'`); on web the test site's home
 * page is opened here. The spec bodies therefore never branch on the platform
 * to get to their starting point.
 */
export const test = stepsTest.extend<{ startScreen: void }>({
    startScreen: [async ({ steps }, use) => {
        if (steps.platform === 'web') await steps.navigateTo('/');
        await use();
    }, { auto: true }],
});

/**
 * A `beforeAll` guard: on a device platform the capabilities file must target
 * only the built-in Settings app, because the page entries describe it and the
 * spec is read-only only there (rules in `settingsGuard.ts`). It runs before
 * the session opens, so an unsafe file is refused without launching anything.
 * A no-op on web.
 */
export function requireSettingsApp(): void {
    requireSettingsCapabilities(platform);
}

export { expect } from '@playwright/test';
