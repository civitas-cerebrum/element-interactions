import { PlatformNotSupportedError, PollTimeoutError } from '../../src';
import { test, expect, platform, runsTestApp, requireTestApp } from './ios-testapp-fixture';

/**
 * Live iOS check of the platform steps against the purpose-built test app
 * `com.civitas-cerebrum.test-app`. It covers what the read-only Settings spec
 * cannot: text entry, the keyboard, switches and checkboxes, gestures that
 * change the screen, the app's own alerts, lists, contexts and orientation.
 * It drives only that app; nothing opens another app or system settings.
 *
 * Skipped unless the resolved platform is `ios` AND the capabilities file
 * names the test app (`appium:bundleId` `com.civitas-cerebrum.test-app`); a
 * file naming Settings runs `ios-settings.spec.ts` instead. Run it:
 *
 *   E2E_PLATFORM=ios E2E_CAPABILITIES=<capabilities-file> APPIUM_URL=<appium-server-url-with-base-path> \
 *     npx playwright test -c playwright.platform.config.ts tests/live/ios-testapp.spec.ts
 *
 * The capabilities file is a flat W3C object (see tests/capabilities/README.md)
 * checked against an ALLOW-LIST before a session is opened
 * (tests/cross-platform/appGuard.ts, the iOS test-app rule):
 * `"appium:bundleId": "com.civitas-cerebrum.test-app"`, `"appium:noReset": true`,
 * `appium:fullReset` absent or `false`, `autoAcceptAlerts` / `autoDismissAlerts`
 * absent or `false` (the alerts below are answered by the steps, never by the
 * driver), no `appium:options`, no `otherApps`, no `browserName`. On a
 * simulator (a file without `appium:udid`) `appium:app` may name the local
 * `.app` / `.app.zip` build to install, and `appium:reduceMotion` may be set;
 * on a real device (a file with `appium:udid`) both are refused and the app
 * must already be installed.
 *
 * A run on a simulator is a simulator result: it never counts as verification
 * on a real device.
 *
 * Every test starts from a relaunched app on the home grid and opens its
 * screen from there.
 *
 * Marked `fixme` (not run) until the fix is installed; the test asserts the
 * correct behaviour:
 * - `hideKeyboard` on a keyboard without a Done key (the login form).
 *
 * The horizontal `scrollIntoView` / `scrollUntilFound` tests name the
 * carousel as the scroll `container`: it sits near the top of the screen, so a
 * sweep across the window would miss it.
 *
 * A landscape rotation is skipped as not applicable: the app is portrait only.
 */

/** Why each `fixme` test does not run yet (the annotation each one carries). */
const FIXME = {
    hideKeyboardReturnKey: 'iOS hideKeyboard sends a bare "mobile: hideKeyboard", which WebDriverAgent cannot apply to a keyboard '
        + 'without a Done key (the login fields use the default Return key); no Return-key or tap-outside fallback is tried yet.',
} as const;
const fixme = (description: string) => ({ annotation: { type: 'fixme', description } });

test.describe('live iOS test app', () => {
    test.skip(!runsTestApp, platform === 'ios'
        ? 'Live iOS test-app check: the capabilities file does not name com.civitas-cerebrum.test-app (ios-settings.spec.ts covers Settings).'
        : 'Live iOS test-app check: runs only when E2E_PLATFORM=ios with a capabilities file naming the test app (and APPIUM_URL).');
    test.describe.configure({ timeout: 300_000 });

    // Runs before the session opens: refuses any file that is not the test
    // app (no other app, no install on a device, no reset). See appGuard.ts.
    test.beforeAll(requireTestApp);

    test.describe('app start', () => {
        test('the first step, a non-polling page source read, already sees the test app\'s home grid', async ({ steps }) => {
            // No polling step before it: the relaunch itself must have waited
            // until the app was in the foreground.
            const source = await steps.getPageSource();
            expect(source).toContain('XCUIElementTypeApplication');
            expect(source, 'the page source holds the home grid of the test app').toContain('home-grid');
            await steps.verifyAppInForeground();
        });
    });

    test.describe('text inputs', () => {
        test('fill sets a field; getInputValue and verifyInputValue read it; the screen shows it', async ({ steps, openScreen }) => {
            await openScreen('textInputs');
            await steps.fill('textInput', 'TextInputsPage', 'hello world');
            expect(await steps.getInputValue('textInput', 'TextInputsPage')).toBe('hello world');
            await steps.verifyInputValue('textInput', 'TextInputsPage', 'hello world');
            await steps.verifyTextContains('valuesDisplay', 'TextInputsPage', 'text: hello world');
        });

        test('clearInput empties a filled field', async ({ steps, openScreen }) => {
            await openScreen('textInputs');
            await steps.fill('textInput', 'TextInputsPage', 'to be cleared');
            await steps.verifyInputValue('textInput', 'TextInputsPage', 'to be cleared');
            await steps.clearInput('textInput', 'TextInputsPage');
            await steps.verifyInputValue('textInput', 'TextInputsPage', '');
        });

        test('typeSequentially types the text character by character', async ({ steps, openScreen }) => {
            await openScreen('textInputs');
            await steps.typeSequentially('emailInput', 'TextInputsPage', 'a@b.io', 30);
            await steps.verifyInputValue('emailInput', 'TextInputsPage', 'a@b.io');
            expect(await steps.getInputValue('emailInput', 'TextInputsPage')).toBe('a@b.io');
        });
    });

    test.describe('keyboard', () => {
        test('hideKeyboard hides a keyboard with a Done key; the field keeps the text', async ({ steps, openScreen }) => {
            await openScreen('textInputs');
            await steps.verifyKeyboardShown({ negated: true });
            await steps.click('textInput', 'TextInputsPage');
            await steps.verifyKeyboardShown();
            await steps.typeSequentially('textInput', 'TextInputsPage', 'abc');
            await steps.hideKeyboard();
            await steps.verifyKeyboardShown({ negated: true });
            await steps.verifyInputValue('textInput', 'TextInputsPage', 'abc');
            await steps.verifyTextContains('valuesDisplay', 'TextInputsPage', 'text: abc');
        });

        test.fixme('hideKeyboard hides the login keyboard (Return key, no Done key) and the app signs in', fixme(FIXME.hideKeyboardReturnKey), async ({ steps, openScreen }) => {
            await openScreen('loginForm');
            await steps.fill('usernameInput', 'LoginFormPage', 'admin');
            await steps.fill('passwordInput', 'LoginFormPage', 'password123');
            await steps.verifyKeyboardShown();
            await steps.hideKeyboard();
            await steps.verifyKeyboardShown({ negated: true });
            await steps.click('submitButton', 'LoginFormPage');
            await steps.verifyText('successMessage', 'LoginFormPage', 'Login successful!');
        });
    });

    test.describe('checkboxes and switches', () => {
        /** A `checked` verification that timed out having read the control as unchecked (not one whose read threw). */
        async function expectUnchecked(verification: Promise<void>): Promise<void> {
            const error = await verification.then(() => undefined, (e: unknown) => e);
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect(error).toMatchObject({ lastValue: false });
        }

        test('verifyState checked passes on the checkbox and switch that start checked, and fails on unchecked ones', async ({ steps, openScreen }) => {
            await openScreen('checkboxes');
            await steps.verifyText('stateSummary', 'CheckboxesPage', 'Active: checkbox-checked, checkbox-disabled-checked, toggle-on');
            await steps.verifyState('checkedCheckbox', 'CheckboxesPage', 'checked');
            await steps.verifyState('toggleOn', 'CheckboxesPage', 'checked');
            await expectUnchecked(steps.verifyState('uncheckedCheckbox', 'CheckboxesPage', 'checked', 2000));
            await expectUnchecked(steps.verifyState('toggleOff', 'CheckboxesPage', 'checked', 2000));
        });

        test('check turns an off switch on and ticks an unchecked box; a checked one stays checked (no tap)', async ({ steps, openScreen }) => {
            await openScreen('checkboxes');
            await steps.check('toggleOff', 'CheckboxesPage');
            await steps.check('uncheckedCheckbox', 'CheckboxesPage');
            // Already on: check is a no-op, so the switch stays on.
            await steps.check('toggleOn', 'CheckboxesPage');
            await steps.verifyState('toggleOff', 'CheckboxesPage', 'checked');
            await steps.verifyState('uncheckedCheckbox', 'CheckboxesPage', 'checked');
            await steps.verifyInputValue('toggleOff', 'CheckboxesPage', '1');
            await steps.verifyText('stateSummary', 'CheckboxesPage',
                'Active: checkbox-checked, checkbox-disabled-checked, checkbox-unchecked, toggle-off, toggle-on');
        });

        test('uncheck turns an on switch off and clears a checked box; an unchecked one stays unchecked (no tap)', async ({ steps, openScreen }) => {
            await openScreen('checkboxes');
            await steps.uncheck('toggleOn', 'CheckboxesPage');
            await steps.uncheck('checkedCheckbox', 'CheckboxesPage');
            // Already off: uncheck is a no-op, so the switch stays off.
            await steps.uncheck('toggleOff', 'CheckboxesPage');
            await steps.verifyInputValue('toggleOn', 'CheckboxesPage', '0');
            await steps.verifyText('stateSummary', 'CheckboxesPage', 'Active: checkbox-disabled-checked');
            await expectUnchecked(steps.verifyState('checkedCheckbox', 'CheckboxesPage', 'checked', 2000));
        });
    });

    test.describe('the app\'s alerts', () => {
        // The Alerts screen raises a UIAlertController ("Alert", one OK action),
        // answered here by the steps; the driver answers nothing by itself.
        test('a tap raises the alert; acceptAlert closes it', async ({ steps, openScreen }) => {
            await openScreen('alerts');
            await steps.verifyAbsence('alert', 'AlertsPage');
            await steps.click('clickMeButton', 'AlertsPage');
            await steps.verifyText('alertMessage', 'AlertsPage', 'You clicked me!');
            await steps.acceptAlert();
            await steps.verifyAbsence('alert', 'AlertsPage');
            await steps.verifyPresence('clickMeButton', 'AlertsPage');
        });

        test('dismissAlert closes the alert (its only action is OK)', async ({ steps, openScreen }) => {
            await openScreen('alerts');
            await steps.click('clickMeButton', 'AlertsPage');
            await steps.verifyPresence('alert', 'AlertsPage');
            await steps.dismissAlert();
            await steps.verifyAbsence('alert', 'AlertsPage');
        });
    });

    test.describe('gestures', () => {
        test('longPress raises the long-press alert', async ({ steps, openScreen }) => {
            await openScreen('alerts');
            await steps.longPress('longPressMeButton', 'AlertsPage', { duration: 1_500 });
            await steps.verifyText('alertMessage', 'AlertsPage', 'You long-pressed me!');
            await steps.acceptAlert();
            await steps.verifyAbsence('alert', 'AlertsPage');
        });

        test('doubleClick raises the double-tap alert', async ({ steps, openScreen }) => {
            await openScreen('alerts');
            await steps.doubleClick('doubleTapMeButton', 'AlertsPage');
            await steps.verifyText('alertMessage', 'AlertsPage', 'You double-tapped me!');
        });

        test('doubleClick on the increment button raises the counter by two', async ({ steps, openScreen }) => {
            await openScreen('counter');
            await steps.verifyText('counterValue', 'CounterPage', '0');
            await steps.doubleClick('incrementButton', 'CounterPage');
            await steps.verifyText('counterValue', 'CounterPage', '2');
        });

        test('tapAt on an element taps inside it: the counter rises by one', async ({ steps, openScreen }) => {
            await openScreen('counter');
            await steps.verifyText('counterValue', 'CounterPage', '0');
            await steps.on('incrementButton', 'CounterPage').tapAt({ x: 12, y: 12 });
            await steps.verifyText('counterValue', 'CounterPage', '1');
        });

        test('tapAt on the screen at the centre of the increment button raises the counter', async ({ steps, openScreen }) => {
            await openScreen('counter');
            const box = await steps.getBoundingBox('incrementButton', 'CounterPage');
            expect(box, 'the increment button has a bounding box').not.toBeNull();
            await steps.tapAt(Math.round(box!.x + box!.width / 2), Math.round(box!.y + box!.height / 2));
            await steps.verifyText('counterValue', 'CounterPage', '1');
        });

        test('swipe up on the long list scrolls its first row away; scrollUntilFound up brings it back', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.verifyPresence('item1', 'LongListPage');
            await steps.swipe('list', 'LongListPage', 'up', { distance: 500 });
            await steps.verifyAbsence('item1', 'LongListPage');
            await steps.scrollUntilFound('item1', 'LongListPage', { direction: 'up', timeout: 120_000 });
            await steps.verifyPresence('item1', 'LongListPage');
        });

        test('scrollIntoView down reaches the last section of the tall page, and up the first one', async ({ steps, openScreen }) => {
            await openScreen('tall');
            await steps.scrollIntoView('section10', 'TallPage', { direction: 'down' });
            await steps.verifyState('section10', 'TallPage', 'inViewport');
            await steps.scrollIntoView('section1', 'TallPage', { direction: 'up' });
            await steps.verifyState('section1', 'TallPage', 'inViewport');
        });

        test('scrollUntilFound down reaches the last section, then up the first one again', async ({ steps, openScreen }) => {
            await openScreen('tall');
            await steps.scrollUntilFound('section10', 'TallPage', { direction: 'down', timeout: 120_000 });
            await steps.verifyPresence('section10', 'TallPage');
            await steps.scrollUntilFound('section1', 'TallPage', { direction: 'up', timeout: 120_000 });
            await steps.verifyPresence('section1', 'TallPage');
        });

        test('scrollIntoView right inside the carousel brings a later slide into the viewport, left the first one', async ({ steps, openScreen }) => {
            await openScreen('productCarousel');
            await steps.scrollIntoView('productName2', 'ProductCarouselPage', { direction: 'right', container: 'carousel' });
            await steps.verifyState('productName2', 'ProductCarouselPage', 'inViewport');
            await steps.scrollIntoView('productName0', 'ProductCarouselPage', { direction: 'left', container: 'carousel' });
            await steps.verifyState('productName0', 'ProductCarouselPage', 'inViewport');
        });

        test('scrollUntilFound right inside the carousel reaches a later slide, left the first one (fluent form)', async ({ steps, openScreen }) => {
            await openScreen('productCarousel');
            await steps.on('productName2', 'ProductCarouselPage').scrollUntilFound({ direction: 'right', container: 'carousel' });
            await steps.verifyState('productName2', 'ProductCarouselPage', 'visible');
            await steps.on('productName0', 'ProductCarouselPage').scrollUntilFound({ direction: 'left', container: 'carousel' });
            await steps.verifyState('productName0', 'ProductCarouselPage', 'visible');
        });
    });

    test.describe('orientation', () => {
        // Always back to portrait, whatever the test did.
        test.afterEach(async ({ steps }) => {
            await steps.setOrientation('portrait');
            await steps.verifyOrientation('portrait');
        });

        test('the app starts in portrait; setOrientation portrait keeps it there', async ({ steps }) => {
            await steps.verifyOrientation('portrait');
            await steps.setOrientation('portrait');
            await steps.verifyOrientation('portrait');
            await steps.verifyPresence('grid', 'HomePage');
        });

        test.skip('setOrientation landscape is reported by verifyOrientation', { annotation: { type: 'skip', description: 'not applicable: the app is portrait only' } }, async ({ steps }) => {
            await steps.setOrientation('landscape');
            await steps.verifyOrientation('landscape');
        });
    });

    test.describe('contexts', () => {
        test('getContexts lists NATIVE_APP; switchContext and verifyContext confirm it', async ({ steps }) => {
            const contexts = await steps.getContexts();
            expect(contexts).toContain('NATIVE_APP');
            await steps.verifyContext('NATIVE_APP');
            await steps.switchContext('NATIVE_APP');
            await steps.verifyContext('NATIVE_APP');
        });
    });

    test.describe('the long list', () => {
        test('a row is a container whose text is the row text; getText, verifyText and getAll read it', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.verifyText('countLabel', 'LongListPage', 'Showing 200 of 200 items');
            await steps.verifyText('item1', 'LongListPage', 'Item 1 - Lorem ipsum dolor sit amet');
            await steps.verifyTextContains('item1', 'LongListPage', 'Lorem ipsum');
            expect(await steps.getText('item1', 'LongListPage')).toBe('Item 1 - Lorem ipsum dolor sit amet');
            const rows = await steps.getAll('item', 'LongListPage');
            expect(rows.slice(0, 3)).toEqual([
                'Item 1 - Lorem ipsum dolor sit amet',
                'Item 2 - Lorem ipsum dolor sit amet',
                'Item 3 - Lorem ipsum dolor sit amet',
            ]);
        });

        test('getCount and verifyCount see the loaded rows (only the rows near the viewport are in the tree)', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.verifyCount('item', 'LongListPage', { greaterThan: 2 });
            const count = await steps.getCount('item', 'LongListPage');
            expect(count).toBeGreaterThan(2);
            expect(count, 'a virtualised list holds far fewer rows than its 200 items').toBeLessThan(200);
        });

        test('verifyListedElement finds a row by its text; filtering narrows the list to that row', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.verifyListedElement('item', 'LongListPage', { text: 'Item 3 -', expectedText: 'Item 3 - Lorem ipsum dolor sit amet' });

            await steps.fill('searchInput', 'LongListPage', 'item 150');
            await steps.verifyText('countLabel', 'LongListPage', 'Showing 1 of 200 items');
            await steps.verifyCount('item', 'LongListPage', { exactly: 1 });
            await steps.verifyListedElement('item', 'LongListPage', { text: 'Item 150 -', expectedText: 'Item 150 - Lorem ipsum dolor sit amet' });
            await steps.verifyAbsence('item1', 'LongListPage');
        });

        test('verifyCount accepts inclusive bounds and an inclusive range, and enforces both bounds of a range', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.verifyCount('item', 'LongListPage', { greaterThanOrEqual: 3 });
            await steps.verifyCount('item', 'LongListPage', { lessThanOrEqual: 200 });
            await steps.verifyCount('item', 'LongListPage', { greaterThanOrEqual: 3, lessThanOrEqual: 199 });
            // A two-sided range holds only when both bounds do: the unfiltered list holds more than 3 rows.
            await expect(steps.verifyCount('item', 'LongListPage', { greaterThan: 1, lessThan: 3 }, { timeout: 2_000 }))
                .rejects.toBeInstanceOf(PollTimeoutError);
            // After filtering to one row both bounds are exact.
            await steps.fill('searchInput', 'LongListPage', 'item 150');
            await steps.verifyCount('item', 'LongListPage', { greaterThanOrEqual: 1, lessThanOrEqual: 1 });
            // An upper bound below the count fails.
            await expect(steps.verifyCount('item', 'LongListPage', { greaterThanOrEqual: 0, lessThanOrEqual: 0 }, { timeout: 2_000 }))
                .rejects.toBeInstanceOf(PollTimeoutError);
        });
    });

    test.describe('refusals', () => {
        test('a web-only step throws PlatformNotSupportedError naming ios', async ({ steps }) => {
            expect(() => steps.getUrl()).toThrow(PlatformNotSupportedError);
            expect(() => steps.getUrl()).toThrow(expect.objectContaining({ method: 'getUrl', platform: 'ios' }));
            await expect(steps.verifyUrlContains('/')).rejects.toBeInstanceOf(PlatformNotSupportedError);
            await expect(steps.verifyUrlContains('/')).rejects.toMatchObject({ method: 'verifyUrlContains', platform: 'ios' });
        });

        test('pressBack throws PlatformNotSupportedError on ios and the screen stays', async ({ steps, openScreen }) => {
            await openScreen('counter');
            const refusal = await steps.pressBack().then(() => undefined, (error: unknown) => error);
            expect(refusal).toBeInstanceOf(PlatformNotSupportedError);
            expect(refusal).toMatchObject({ method: 'pressBack', platform: 'ios' });
            await steps.verifyPresence('counterValue', 'CounterPage');
        });
    });
});
