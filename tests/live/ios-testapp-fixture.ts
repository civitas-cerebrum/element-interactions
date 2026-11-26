import { test as base } from '@playwright/test';
import * as path from 'path';
import { baseFixture, resolvePlatform } from '../../src';
import { requireAppCapabilities, capabilitiesBundleId, IOS_TEST_APP } from '../cross-platform/appGuard';

/**
 * The fixture of the live iOS test-app spec: the purpose-built test app
 * `com.civitas-cerebrum.test-app` through `baseFixture`. Platform,
 * capabilities and server come only from `E2E_PLATFORM`, `E2E_CAPABILITIES`
 * and `APPIUM_URL`; nothing about a device, a simulator or a server is
 * written here.
 */
export const platform = resolvePlatform(undefined);

/**
 * True when this run drives the iOS test app: the platform is `ios` and the
 * capabilities file names the test app's bundle id. The live Settings spec
 * runs on the other iOS files, so each iOS spec selects itself by the file.
 */
export const runsTestApp = platform === 'ios' && capabilitiesBundleId() === IOS_TEST_APP.id;

/** The screens the spec opens: the home card, the row of its category list, and the screen's landmark. */
const SCREENS = {
    textInputs: { card: 'elementsCard', item: 'textInputsItem', page: 'TextInputsPage', landmark: 'textInput' },
    checkboxes: { card: 'elementsCard', item: 'checkboxesItem', page: 'CheckboxesPage', landmark: 'toggleOff' },
    alerts: { card: 'alertsCard', item: 'alertsItem', page: 'AlertsPage', landmark: 'clickMeButton' },
    tall: { card: 'interactionsCard', item: 'tallPageItem', page: 'TallPage', landmark: 'section1' },
    productCarousel: { card: 'mediaCard', item: 'productCarouselItem', page: 'ProductCarouselPage', landmark: 'carousel' },
    loginForm: { card: 'authCard', item: 'loginFormItem', page: 'LoginFormPage', landmark: 'usernameInput' },
    counter: { card: 'authCard', item: 'counterItem', page: 'CounterPage', landmark: 'counterValue' },
    longList: { card: 'edgeCasesCard', item: 'longListItem', page: 'LongListPage', landmark: 'searchInput' },
} as const;

export type Screen = keyof typeof SCREENS;

// No `session.capabilities` here: the app guard checks the file named by
// E2E_CAPABILITIES, so the session must open from that same file.
const stepsTest = baseFixture(base, path.join(__dirname, 'ios-testapp-page-repository.json'), {
    platform,
    // The step timeout. Generous: the first gesture in a fresh iOS session took 15-30 s live.
    timeout: 30_000,
    // The app is relaunched before every test: each test starts on the home grid.
    session: { reset: 'relaunch' },
});

export const test = stepsTest.extend<{ openScreen: (screen: Screen) => Promise<void> }>({
    /**
     * Opens a screen from the home grid: waits for the grid (a polling step,
     * so the relaunch has brought the app to the front), taps the category
     * card, then the screen's row of the category list, and waits until the
     * screen's landmark is visible.
     */
    openScreen: async ({ steps }, use) => {
        await use(async (screen: Screen) => {
            const { card, item, page, landmark } = SCREENS[screen];
            await steps.verifyPresence('grid', 'HomePage');
            await steps.scrollIntoView(card, 'HomePage', { direction: 'down' });
            await steps.click(card, 'HomePage');
            await steps.scrollIntoView(item, 'CategoryListPage', { direction: 'down' });
            await steps.click(item, 'CategoryListPage');
            await steps.waitForState(landmark, page, 'visible');
        });
    },
});

/**
 * A `beforeAll` guard: the capabilities file must name only the iOS test app
 * (rules in `tests/cross-platform/appGuard.ts`; its build may be installed on
 * a simulator only). It runs before the session opens, so an unsafe file is
 * refused without launching anything.
 */
export function requireTestApp(): void {
    requireAppCapabilities(platform, process.env, IOS_TEST_APP);
}

export { expect } from '@playwright/test';
