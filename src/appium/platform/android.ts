import type { Element } from '@civitas-cerebrum/element-repository';
import type { PermissionState } from '../../interfaces/IDevice';
import type { Direction } from '../../interfaces/IGestures';
import { swipeScreenW3C, type SwipeInset } from '../touch';
import { APP_STATE_FOREGROUND, mobile, type AppiumDriver, type PlatformStrategy } from './PlatformStrategy';

/**
 * The share of the window a screen swipe keeps clear on each side (x: left
 * and right, y: top and bottom), so it never starts or ends on the status
 * bar / notification shade or in the system gesture-navigation zones (back
 * from the side edges, home from the bottom edge).
 */
export const ANDROID_SWIPE_INSET: SwipeInset = Object.freeze({ x: 0.1, y: 0.2 });

/**
 * `setPermission` state -> UiAutomator2 `mobile: changePermissions` action.
 * Android runtime permissions have no separate "never asked" state that a
 * test can restore, so `reset` revokes: the app has to ask again.
 */
const PERMISSION_ACTION: Record<PermissionState, 'grant' | 'revoke'> = {
    grant: 'grant',
    deny: 'revoke',
    reset: 'revoke',
};

/** Android (UiAutomator2 driver). Every command is a W3C or `mobile:` command of Appium 3. */
export const androidStrategy: PlatformStrategy = Object.freeze({
    platform: 'android',
    implemented: true,
    appIdCapability: 'appium:appPackage',
    focusedAttribute: 'focused',
    unsupported: Object.freeze([]) as readonly string[],
    snapshotAttributes: Object.freeze(['resource-id', 'content-desc', 'text', 'class', 'package', 'checkable', 'checked',
        'clickable', 'enabled', 'focusable', 'focused', 'selected', 'displayed', 'bounds', 'hint']),

    /** The element's text (UiAutomator2 `text`), as `textContent` reads it. */
    async readText(element: Element) {
        return (await element.textContent()) ?? '';
    },

    async launchApp(driver: AppiumDriver, appId: string) {
        // UiAutomator2 has no separate "launch": activateApp starts the app
        // when it is not running and brings it to the front when it is.
        await mobile(driver, 'activateApp', { appId });
    },
    async activateApp(driver: AppiumDriver, appId: string) {
        await mobile(driver, 'activateApp', { appId });
    },
    async terminateApp(driver: AppiumDriver, appId: string) {
        await mobile(driver, 'terminateApp', { appId });
    },
    async resetApp(driver: AppiumDriver, appId: string) {
        await androidStrategy.terminateApp(driver, appId);
        await androidStrategy.activateApp(driver, appId);
    },
    async backgroundApp(driver: AppiumDriver, seconds: number) {
        await mobile(driver, 'backgroundApp', { seconds });
    },
    async installApp(driver: AppiumDriver, appPath: string) {
        await mobile(driver, 'installApp', { appPath });
    },
    async removeApp(driver: AppiumDriver, appId: string) {
        await mobile(driver, 'removeApp', { appId });
    },
    async isAppInForeground(driver: AppiumDriver, appId: string) {
        return (await mobile<number>(driver, 'queryAppState', { appId })) === APP_STATE_FOREGROUND;
    },
    async openDeepLink(driver: AppiumDriver, url: string, appId?: string) {
        await mobile(driver, 'deepLink', appId ? { url, package: appId } : { url });
    },

    async pressBack(driver: AppiumDriver) {
        await driver.back();
    },
    async hideKeyboard(driver: AppiumDriver) {
        await mobile(driver, 'hideKeyboard');
    },
    async isKeyboardShown(driver: AppiumDriver) {
        return Boolean(await mobile<boolean>(driver, 'isKeyboardShown'));
    },

    /**
     * The shared W3C touch swipe (`swipeScreenW3C`, the gesture
     * element-repository's `PlatformElement.swipe` sends), centred on the
     * window centre inside the window minus {@link ANDROID_SWIPE_INSET}: at
     * most 60 % of the height or 80 % of the width.
     */
    async swipeScreen(driver: AppiumDriver, direction: Direction, distance?: number) {
        await swipeScreenW3C(driver, direction, ANDROID_SWIPE_INSET, distance);
    },

    async acceptAlert(driver: AppiumDriver) {
        await driver.acceptAlert();
    },
    async dismissAlert(driver: AppiumDriver) {
        await driver.dismissAlert();
    },
    async setPermission(driver: AppiumDriver, permission: string, state: PermissionState, appId: string) {
        await mobile(driver, 'changePermissions', {
            permissions: [permission],
            appPackage: appId,
            action: PERMISSION_ACTION[state],
        });
    },
});
