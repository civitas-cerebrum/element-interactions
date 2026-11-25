import { test as base } from '@playwright/test';
import * as path from 'path';
import type { ElementRepository } from '@civitas-cerebrum/element-repository';
import { baseFixture, resolvePlatform } from '../../src';
import { requireAppCapabilities } from './appGuard';

/**
 * The fixture of the cross-platform spec: one `baseFixture` call that serves
 * web, Android and iOS. The platform comes from `E2E_PLATFORM` (unset: web).
 * Capabilities and server come ONLY from `E2E_CAPABILITIES` / `APPIUM_URL`:
 * nothing about a device or a server is written here.
 *
 *   web (default suite): the docker test site at the config's baseURL.
 *   ios:     E2E_PLATFORM=ios E2E_CAPABILITIES=<capabilities-file> APPIUM_URL=<appium-server-url-with-base-path> \
 *              npx playwright test -c playwright.platform.config.ts tests/cross-platform
 *   android: the same with E2E_PLATFORM=android.
 *
 * The capabilities file must name the one app the platform may drive
 * (`appium:bundleId: com.apple.Preferences`, the built-in Settings app, on
 * iOS; `appium:appPackage: com.civitas.testapp`, the installed test app, on
 * Android) and nothing that installs or resets (see `appGuard.ts`).
 */
export const platform = resolvePlatform(undefined);

// No `session.capabilities` here: the app guard checks the file named by
// E2E_CAPABILITIES, so the session must open from that same file.
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
export const test = stepsTest.extend<{ startScreen: void; goBack: () => Promise<void> }>({
    startScreen: [async ({ steps }, use) => {
        if (steps.platform === 'web') await steps.navigateTo('/');
        await use();
    }, { auto: true }],

    /**
     * Leaves the destination screen the way the platform's user would: when
     * the active platform's `DestinationScreen` page defines a `backButton`
     * entry (web and iOS), that on-screen control is clicked; when it does not
     * (the Android test app has no on-screen back control), the platform's
     * own way back, the system back (`pressBack`). The choice follows the
     * repository, not the platform name, so the spec body does not branch.
     */
    goBack: async ({ steps, repo }, use) => {
        await use(async () => {
            if (hasEntry(repo, 'backButton', 'DestinationScreen')) await steps.click('backButton', 'DestinationScreen');
            else await steps.pressBack();
        });
    },
});

/**
 * Whether the active platform's page `pageName` defines `elementName`. A
 * lookup that answers instead of throwing: the repository's metadata read
 * throws for a missing page or entry, and touches no driver.
 */
function hasEntry(repo: ElementRepository, elementName: string, pageName: string): boolean {
    try {
        repo.getElementMeta(elementName, pageName);
        return true;
    } catch {
        return false;
    }
}

/**
 * A `beforeAll` guard: on a device platform the capabilities file must target
 * only the platform's allowed app, because the page entries describe it and
 * the device may run nothing else (rules in `appGuard.ts`). It runs before
 * the session opens, so an unsafe file is refused without launching anything.
 * A no-op on web.
 */
export function requireDeviceApp(): void {
    requireAppCapabilities(platform);
}

export { expect } from '@playwright/test';
