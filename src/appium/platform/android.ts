import type { PermissionState } from '../../interfaces/IDevice';
import type { Direction } from '../../interfaces/IGestures';
import { windowSize } from '../touch';
import { APP_STATE_FOREGROUND, mobile, type AppiumDriver, type PlatformStrategy } from './PlatformStrategy';

/**
 * The share of the window a screen swipe keeps clear on each side (x: left
 * and right, y: top and bottom), so it never starts on the status bar or in
 * the system gesture-navigation zones.
 */
export const ANDROID_SWIPE_INSET = Object.freeze({ x: 0.1, y: 0.2 });

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
     * UiAutomator2 `mobile: swipeGesture {left, top, width, height,
     * direction, percent}` over the window minus {@link ANDROID_SWIPE_INSET}
     * (its direction is the finger direction too, passed through unchanged).
     * `percent` is `distance` (default half the window along the swipe axis)
     * over the swipe area's size along that axis, capped at 1.
     */
    async swipeScreen(driver: AppiumDriver, direction: Direction, distance?: number) {
        const win = await windowSize(driver);
        const left = Math.round(win.width * ANDROID_SWIPE_INSET.x);
        const top = Math.round(win.height * ANDROID_SWIPE_INSET.y);
        const width = win.width - 2 * left;
        const height = win.height - 2 * top;
        const horizontal = direction === 'left' || direction === 'right';
        const travel = distance ?? (horizontal ? win.width : win.height) / 2;
        const percent = Math.min(travel / (horizontal ? width : height), 1);
        await mobile(driver, 'swipeGesture', { left, top, width, height, direction, percent: Math.round(percent * 1000) / 1000 });
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
