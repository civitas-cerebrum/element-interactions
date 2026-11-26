import { test as base } from '@playwright/test';
import * as path from 'path';
import { baseFixture, resolvePlatform } from '../../src';
import { requireAppCapabilities } from '../cross-platform/appGuard';

/**
 * The fixture of the live Android spec: the test app `com.civitas.testapp`
 * (already installed on the device) through `baseFixture`. Platform,
 * capabilities and server come only from `E2E_PLATFORM`, `E2E_CAPABILITIES`
 * and `APPIUM_URL`; nothing about a device or a server is written here.
 */
export const platform = resolvePlatform(undefined);

/** The screens the spec opens: the home card, then the row of its category list. */
const SCREENS = {
    alerts: { card: 'alertsCard', item: 'alertsItem' },
    checkboxes: { card: 'elementsCard', item: 'checkboxesItem' },
    tall: { card: 'interactionsCard', item: 'tallPageItem' },
    longList: { card: 'edgeCasesCard', item: 'longListItem' },
    counter: { card: 'formsCard', item: 'counterItem' },
} as const;

export type Screen = keyof typeof SCREENS;

// No `session.capabilities` here: the app guard checks the file named by
// E2E_CAPABILITIES, so the session must open from that same file.
const stepsTest = baseFixture(base, path.join(__dirname, 'android-page-repository.json'), {
    platform,
    timeout: 30_000,
    // The app is relaunched before every test: each test starts on the home grid.
    session: { reset: 'relaunch' },
});

export const test = stepsTest.extend<{ openScreen: (screen: Screen) => Promise<void> }>({
    /**
     * Opens a screen from the home grid: waits for the grid first (a polling
     * step, so the relaunch has finished bringing the app to the front), then
     * the category card, then the screen's row of the category list.
     */
    openScreen: async ({ steps }, use) => {
        await use(async (screen: Screen) => {
            const { card, item } = SCREENS[screen];
            await steps.verifyPresence('grid', 'HomePage');
            await steps.scrollIntoView(card, 'HomePage', { direction: 'down' });
            await steps.click(card, 'HomePage');
            await steps.scrollIntoView(item, 'CategoryListPage', { direction: 'down' });
            await steps.click(item, 'CategoryListPage');
        });
    },
});

/**
 * A `beforeAll` guard: the capabilities file must name only the installed test
 * app (rules in `tests/cross-platform/appGuard.ts`). It runs before the session
 * opens, so an unsafe file is refused without launching anything.
 */
export function requireTestApp(): void {
    requireAppCapabilities(platform);
}

export { expect } from '@playwright/test';
