import { test as base } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { baseFixture, resolvePlatform } from '../../src';

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
 * `appium:appPackage: com.android.settings` on Android).
 */
export const platform = resolvePlatform(undefined);

const stepsTest = baseFixture(base, path.join(__dirname, 'page-repository.json'), {
    platform,
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

/** The app each device platform's page entries describe. */
const SETTINGS_APP: Partial<Record<string, { key: string; id: string }>> = {
    ios: { key: 'appium:bundleId', id: 'com.apple.Preferences' },
    android: { key: 'appium:appPackage', id: 'com.android.settings' },
};

/**
 * A `beforeAll` guard: on a device platform the capabilities file must name
 * the built-in Settings app, because the page entries describe it and the
 * spec is read-only only there. It runs before the session opens, so a file
 * naming another app is refused without launching it. A no-op on web.
 */
export function requireSettingsApp(): void {
    const expected = SETTINGS_APP[platform];
    if (!expected) return;
    const file = process.env.CAPABILITIES;
    if (!file) throw new Error(`CAPABILITIES is not set: a ${platform} run needs the path of a capabilities file.`);
    const capabilities = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8')) as Record<string, unknown>;
    if (capabilities[expected.key] !== expected.id) {
        throw new Error(
            `The cross-platform spec drives the built-in Settings app read-only: the capabilities file "${file}" must set `
            + `"${expected.key}": "${expected.id}" on ${platform}, found ${JSON.stringify(capabilities[expected.key])}.`,
        );
    }
}

export { expect } from '@playwright/test';
