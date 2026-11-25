import { PlatformNotSupportedError } from '../../src';
import { test, expect, platform, requireTestApp } from './android-fixture';

/**
 * Live Android check of the platform steps against the purpose-built test app
 * `com.civitas.testapp` (already installed; nothing is installed or removed).
 * It drives only that app: lifecycle, the app's own dialogs, the keyboard,
 * orientation (always restored to portrait), contexts, screen swipes, scrolling,
 * lists and checkboxes. Nothing opens another app or system settings.
 * UiAutomator2's `setOrientation` also locks the screen rotation, so the
 * orientation tests restore portrait in their `afterEach`.
 *
 * Skipped unless the resolved platform is `android`. Run it:
 *
 *   E2E_PLATFORM=android E2E_CAPABILITIES=<capabilities-file> APPIUM_URL=<appium-server-url-with-base-path> \
 *     npx playwright test -c playwright.platform.config.ts tests/live
 *
 * The capabilities file is a flat W3C object (see tests/capabilities/README.md)
 * checked against an ALLOW-LIST before a session is opened
 * (tests/cross-platform/appGuard.ts): `"appium:appPackage": "com.civitas.testapp"`,
 * `appium:appActivity` absent or the main activity, `"appium:noReset": true`,
 * no `appium:app` / `appium:otherApps` (no install), no `fullReset`, no
 * `appium:options`, no `browserName`, `autoGrantPermissions` absent or `false`.
 *
 * Every test starts from a relaunched app on the home grid and opens its
 * screen from there.
 *
 * Not covered here, because the test app gives them nothing to act on:
 * - `openDeepLink`: the app declares no deep-link handler (its only intent
 *   filter is the launcher's MAIN / LAUNCHER).
 * - `setPermission`: the app declares no runtime permission.
 * - `acceptAlert` / `dismissAlert`: the app raises no system alert; its
 *   Alerts screen opens the app's own dialog, closed here with its OK button.
 * - `installApp` / `removeApp`: nothing may be installed or removed.
 *
 * Steps that depend on element-repository fixes not in the installed version
 * are `test.fixme` with the reason: the checked state of a CheckBox / Switch
 * (read from `selected` instead of `checked`) and the text of a container row
 * (its own text is empty; the visible text is in its child TextViews).
 */
const CHECKED_STATE_FIXME = 'element-repository reads the checked state from "selected"; a CheckBox / Switch reports it as "checked"';
const CONTAINER_TEXT_FIXME = 'element-repository reads a container row\'s own (empty) text, not the text of its child TextViews';

test.describe('live Android test app', () => {
    test.skip(platform !== 'android', 'Live Android check: runs only when E2E_PLATFORM=android (with E2E_CAPABILITIES and APPIUM_URL).');
    test.describe.configure({ timeout: 300_000 });

    // Runs before the session opens: refuses any file that is not the
    // installed test app (no other app, no install, no reset). See appGuard.ts.
    test.beforeAll(requireTestApp);

    test.describe('app lifecycle', () => {
        test('the relaunch starts on the home grid with the app in the foreground', async ({ steps }) => {
            await steps.verifyPresence('grid', 'HomePage');
            await steps.verifyAppInForeground();
            await steps.verifyCount('cards', 'HomePage', { greaterThan: 0 });
        });

        test('the first step, a non-polling page source read, already sees the test app, not the launcher', async ({ steps }) => {
            // No polling step before it: the relaunch itself must have waited
            // until the app was in the foreground.
            const source = await steps.getPageSource();
            expect(source, 'the page source belongs to the test app').toContain('package="com.civitas.testapp"');
            expect(source, 'the page source holds no launcher window').not.toMatch(/package="[^"]*launcher[^"]*"/i);
        });

        test('backgroundApp sends the app away and brings it back on the same screen', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.backgroundApp(2);
            await steps.verifyAppInForeground();
            await steps.verifyPresence('searchInput', 'LongListPage');
        });

        test('terminateApp then activateApp, and terminateApp then launchApp, start on the home grid', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.terminateApp();
            await steps.activateApp();
            await steps.verifyAppInForeground();
            await steps.verifyPresence('grid', 'HomePage');
            await steps.verifyAbsence('searchInput', 'LongListPage');

            await steps.terminateApp();
            await steps.launchApp();
            await steps.verifyAppInForeground();
            await steps.verifyPresence('grid', 'HomePage');
        });

        test('resetApp returns to the home grid', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.resetApp();
            await steps.verifyAppInForeground();
            await steps.verifyPresence('grid', 'HomePage');
            await steps.verifyAbsence('searchInput', 'LongListPage');
        });
    });

    test.describe('the app\'s own dialogs', () => {
        test('the Info button opens a dialog; OK closes it and the status label reports it', async ({ steps, openScreen }) => {
            await openScreen('alerts');
            await steps.verifyText('status', 'AlertsPage', 'Status: none');
            await steps.click('infoButton', 'AlertsPage');
            await steps.click('okButton', 'AppDialog');
            await steps.verifyAbsence('okButton', 'AppDialog');
            await steps.verifyText('status', 'AlertsPage', 'Status: Info dismissed');
        });

        test('the Error button opens a dialog; OK closes it and the status label reports it', async ({ steps, openScreen }) => {
            await openScreen('alerts');
            await steps.click('errorButton', 'AlertsPage');
            await steps.click('okButton', 'AppDialog');
            await steps.verifyTextContains('status', 'AlertsPage', 'Error dismissed');
        });
    });

    test.describe('keyboard', () => {
        test('fill shows the keyboard; hideKeyboard hides it; the field keeps the text', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.click('searchInput', 'LongListPage');
            await steps.fill('searchInput', 'LongListPage', 'Gamma');
            await steps.verifyInputValue('searchInput', 'LongListPage', 'Gamma');
            await steps.verifyKeyboardShown();
            await steps.hideKeyboard();
            await steps.verifyKeyboardShown({ negated: true });
            await steps.verifyText('countLabel', 'LongListPage', 'Showing 50 of 200 items');
        });
    });

    test.describe('orientation', () => {
        // Always back to portrait, whatever the test did.
        test.afterEach(async ({ steps }) => {
            await steps.setOrientation('portrait');
        });

        test('setOrientation landscape is reported by verifyOrientation, then portrait again', async ({ steps }) => {
            await steps.verifyOrientation('portrait');
            await steps.setOrientation('landscape');
            await steps.verifyOrientation('landscape');
            await steps.setOrientation('portrait');
            await steps.verifyOrientation('portrait');
            await steps.verifyPresence('grid', 'HomePage');
        });
    });

    test.describe('contexts', () => {
        test('getContexts lists NATIVE_APP and verifyContext confirms it', async ({ steps }) => {
            const contexts = await steps.getContexts();
            expect(contexts).toContain('NATIVE_APP');
            await steps.verifyContext('NATIVE_APP');
        });
    });

    test.describe('screen swipes and scrolling', () => {
        test('swipeScreen up moves a section up, swipeScreen down moves it back', async ({ steps, openScreen }) => {
            await openScreen('tall');
            const topOfSection3 = async (when: string): Promise<number> => {
                const box = await steps.getBoundingBox('section3', 'TallPage');
                expect(box, `section3 has a bounding box ${when}`).not.toBeNull();
                return box?.y ?? Number.NaN;
            };
            const before = await topOfSection3('before the swipes');

            // Finger up by 600 px: the page content (and the section) moves up.
            await steps.swipeScreen('up', { distance: 600 });
            const after = await topOfSection3('after swiping up');
            expect(after, 'swiping up moves section3 up').toBeLessThan(before);

            // Finger down by the same distance: the section comes back down.
            await steps.swipeScreen('down', { distance: 600 });
            const back = await topOfSection3('after swiping down');
            expect(back, 'swiping down moves section3 back down').toBeGreaterThan(after);
        });

        test('scrollUntilFound reaches the last section, then the first one again', async ({ steps, openScreen }) => {
            await openScreen('tall');
            await steps.verifyAbsence('section10', 'TallPage');
            await steps.scrollUntilFound('section10', 'TallPage', { direction: 'down', timeout: 120_000 });
            await steps.verifyPresence('section10', 'TallPage');
            await steps.verifyAbsence('section1', 'TallPage');
            await steps.scrollUntilFound('section1', 'TallPage', { direction: 'up', timeout: 120_000 });
            await steps.verifyPresence('section1', 'TallPage');
        });
    });

    test.describe('lists', () => {
        test('getCount and getAll read the rows through their child text views', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.verifyCount('row', 'LongListPage', { greaterThan: 2 });
            expect(await steps.getCount('row', 'LongListPage')).toBeGreaterThan(2);

            const titles = await steps.getAll('row', 'LongListPage', { child: { pageName: 'LongListPage', elementName: 'rowTitle' } });
            expect(titles.slice(0, 3)).toEqual(['Item 1', 'Item 2', 'Item 3']);
            const categories = await steps.getAll('row', 'LongListPage', { child: { pageName: 'LongListPage', elementName: 'rowCategory' } });
            expect(categories.slice(0, 4)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
        });

        test('verifyListedElement and clickListedElement pick a row by its descendant and act on its child', async ({ steps, openScreen }) => {
            await openScreen('longList');
            const rowTitle = { pageName: 'LongListPage', elementName: 'rowTitle' };
            const rowCategory = { pageName: 'LongListPage', elementName: 'rowCategory' };

            await steps.verifyListedElement('row', 'LongListPage', {
                withDescendant: { child: rowTitle, text: { regex: '^Item 3$' } },
                child: rowCategory,
                expectedText: 'Gamma',
            });
            await steps.verifyListedElement('row', 'LongListPage', {
                withDescendant: { child: rowCategory, text: 'Delta' },
                child: rowTitle,
                expectedText: 'Item 4',
            });
            // The row is not clickable (it has no click action): this checks
            // that clickListedElement finds the row by its descendant and taps
            // its child without error, and that the tap changes nothing.
            await steps.clickListedElement('row', 'LongListPage', {
                withDescendant: { child: rowTitle, text: { regex: '^Item 2$' } },
                child: rowTitle,
            });
            await steps.verifyText('countLabel', 'LongListPage', 'Showing 200 of 200 items');
        });

        test.fixme('getText and verifyText read a row container through its child text', { annotation: { type: 'fixme', description: CONTAINER_TEXT_FIXME } }, async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.verifyText('row1', 'LongListPage');
            await steps.verifyTextContains('row1', 'LongListPage', 'Item 1');
            expect(await steps.getText('row1', 'LongListPage')).toContain('Alpha');
            const rows = await steps.getAll('row', 'LongListPage');
            expect(rows[0]).toContain('Item 1');
            await steps.verifyListedElement('row', 'LongListPage', { text: 'Item 2', child: { pageName: 'LongListPage', elementName: 'rowCategory' }, expectedText: 'Beta' });
        });
    });

    test.describe('checkboxes and switches', () => {
        test.fixme('verifyState checked passes on the checkbox and switch that start checked', { annotation: { type: 'fixme', description: CHECKED_STATE_FIXME } }, async ({ steps, openScreen }) => {
            await openScreen('checkboxes');
            await steps.verifyState('checkedCheckbox', 'CheckboxesPage', 'checked');
            await steps.verifyState('toggleOn', 'CheckboxesPage', 'checked');
            await steps.verifyText('summary', 'CheckboxesPage', 'Checked, Toggle on');
        });

        test.fixme('check checks an unchecked box and leaves a checked one checked', { annotation: { type: 'fixme', description: CHECKED_STATE_FIXME } }, async ({ steps, openScreen }) => {
            await openScreen('checkboxes');
            await steps.check('uncheckedCheckbox', 'CheckboxesPage');
            await steps.check('checkedCheckbox', 'CheckboxesPage');
            await steps.verifyState('uncheckedCheckbox', 'CheckboxesPage', 'checked');
            await steps.verifyText('summary', 'CheckboxesPage', 'Unchecked, Checked, Toggle on');
        });

        test.fixme('uncheck unchecks a checked box and switch and leaves an unchecked one unchecked', { annotation: { type: 'fixme', description: CHECKED_STATE_FIXME } }, async ({ steps, openScreen }) => {
            await openScreen('checkboxes');
            await steps.uncheck('checkedCheckbox', 'CheckboxesPage');
            await steps.uncheck('toggleOn', 'CheckboxesPage');
            await steps.uncheck('toggleOff', 'CheckboxesPage');
            await steps.verifyText('summary', 'CheckboxesPage', 'None checked');
        });
    });

    test.describe('back and refusals', () => {
        test('pressBack goes back to the category list, then to the home grid', async ({ steps, openScreen }) => {
            await openScreen('longList');
            await steps.pressBack();
            await steps.verifyPresence('longListItem', 'CategoryListPage');
            await steps.verifyAbsence('searchInput', 'LongListPage');
            await steps.pressBack();
            await steps.verifyPresence('grid', 'HomePage');
        });

        test('a web-only step throws PlatformNotSupportedError naming android', async ({ steps }) => {
            expect(() => steps.getUrl()).toThrow(PlatformNotSupportedError);
            expect(() => steps.getUrl()).toThrow(expect.objectContaining({ method: 'getUrl', platform: 'android' }));
            await expect(steps.verifyUrlContains('/')).rejects.toBeInstanceOf(PlatformNotSupportedError);
            await expect(steps.verifyUrlContains('/')).rejects.toMatchObject({ method: 'verifyUrlContains', platform: 'android' });
        });
    });
});
