import { PlatformNotSupportedError, type Element } from '@civitas-cerebrum/element-repository';
import type { PermissionState } from '../../interfaces/IDevice';
import type { Direction } from '../../interfaces/IGestures';
import { swipeScreenW3C, type SwipeInset } from '../touch';
import { APP_STATE_FOREGROUND, mobile, type AppiumDriver, type PlatformStrategy } from './PlatformStrategy';

/**
 * The share of the window a screen swipe keeps clear on each side (x: left
 * and right, y: top and bottom), so it never starts or ends on the status
 * bar / Notification Centre and Control Center edge, on the home indicator
 * (whose upward swipe leaves the app) or on the back-swipe edge on the left.
 */
export const IOS_SWIPE_INSET: SwipeInset = Object.freeze({ x: 0.1, y: 0.15 });

/** `setPermission` state -> XCUITest `mobile: setPermission` access value. */
const PERMISSION_ACCESS: Record<PermissionState, 'yes' | 'no' | 'unset'> = {
    grant: 'yes',
    deny: 'no',
    reset: 'unset',
};

/** XCUITest element types whose `value` is the text typed into them. */
export const IOS_TEXT_INPUT_TYPES: readonly string[] = Object.freeze([
    'XCUIElementTypeTextField',
    'XCUIElementTypeSecureTextField',
    'XCUIElementTypeTextView',
    'XCUIElementTypeSearchField',
]);

/**
 * The visible text of an XCUITest element: its `label`, falling back to its
 * `value`; `''` when both are empty (blank counts as empty). `name` is never
 * read: it is usually the accessibility id. On a text input
 * ({@link IOS_TEXT_INPUT_TYPES}) a non-empty `value` wins over a `label`.
 * `label` and `value` are read together; `type` is read only when both are
 * non-empty, the one case where it decides, so an ordinary labelled element
 * costs two attribute reads. An empty text input reports its placeholder as
 * its value, so it reads the placeholder; use `getInputValue` /
 * `verifyInputValue` for the typed value.
 */
export async function iosReadText(element: Element): Promise<string> {
    const [label, value] = (await Promise.all([
        element.getAttribute('label'),
        element.getAttribute('value'),
    ])).map(v => v ?? '');
    if (!label.trim()) return value.trim() ? value : '';
    if (!value.trim()) return label;
    const type = await element.getAttribute('type');
    return type !== null && IOS_TEXT_INPUT_TYPES.includes(type) ? value : label;
}

/** iOS (XCUITest driver). Every command is a W3C or `mobile:` command of Appium 3. */
export const iosStrategy: PlatformStrategy = Object.freeze({
    platform: 'ios',
    implemented: true,
    appIdCapability: 'appium:bundleId',
    // No focus attribute verified across XCUITest versions; state('focused') throws on iOS.
    focusedAttribute: null,
    unsupported: Object.freeze(['pressBack']),
    snapshotAttributes: Object.freeze(['name', 'label', 'value', 'type', 'enabled', 'visible', 'accessible', 'selected',
        'placeholderValue']),

    readText: iosReadText,

    async launchApp(driver: AppiumDriver, appId: string) {
        await mobile(driver, 'launchApp', { bundleId: appId });
    },
    async activateApp(driver: AppiumDriver, appId: string) {
        await mobile(driver, 'activateApp', { bundleId: appId });
    },
    async terminateApp(driver: AppiumDriver, appId: string) {
        await mobile(driver, 'terminateApp', { bundleId: appId });
    },
    async resetApp(driver: AppiumDriver, appId: string) {
        await iosStrategy.terminateApp(driver, appId);
        await iosStrategy.activateApp(driver, appId);
    },
    async backgroundApp(driver: AppiumDriver, seconds: number) {
        await mobile(driver, 'backgroundApp', { seconds });
    },
    async installApp(driver: AppiumDriver, appPath: string) {
        await mobile(driver, 'installApp', { app: appPath });
    },
    async removeApp(driver: AppiumDriver, appId: string) {
        await mobile(driver, 'removeApp', { bundleId: appId });
    },
    async isAppInForeground(driver: AppiumDriver, appId: string) {
        return (await mobile<number>(driver, 'queryAppState', { bundleId: appId })) === APP_STATE_FOREGROUND;
    },
    async openDeepLink(driver: AppiumDriver, url: string, appId?: string) {
        await mobile(driver, 'deepLink', appId ? { url, bundleId: appId } : { url });
    },

    async pressBack(_driver: AppiumDriver) {
        // iOS has no system back; apps navigate back with an in-app control.
        throw new PlatformNotSupportedError('pressBack', 'ios');
    },
    async hideKeyboard(driver: AppiumDriver) {
        await mobile(driver, 'hideKeyboard');
    },
    async isKeyboardShown(driver: AppiumDriver) {
        return Boolean(await mobile<boolean>(driver, 'isKeyboardShown'));
    },

    /**
     * The shared W3C touch swipe (`swipeScreenW3C`, the gesture
     * element-repository's `PlatformElement.swipe` sends and that was verified
     * to scroll an iOS collection view), centred on the window centre inside
     * the window minus {@link IOS_SWIPE_INSET}: at most 70 % of the height or
     * 80 % of the width. XCUITest's `mobile: swipe` (no distance) and
     * `mobile: dragFromToForDuration` (a 0.5 s press first, a long-press risk)
     * are not used.
     */
    async swipeScreen(driver: AppiumDriver, direction: Direction, distance?: number) {
        await swipeScreenW3C(driver, direction, IOS_SWIPE_INSET, distance);
    },

    async acceptAlert(driver: AppiumDriver) {
        await mobile(driver, 'alert', { action: 'accept' });
    },
    async dismissAlert(driver: AppiumDriver) {
        await mobile(driver, 'alert', { action: 'dismiss' });
    },
    async setPermission(driver: AppiumDriver, permission: string, state: PermissionState, appId: string) {
        await mobile(driver, 'setPermission', {
            bundleId: appId,
            access: { [permission]: PERMISSION_ACCESS[state] },
        });
    },
});
