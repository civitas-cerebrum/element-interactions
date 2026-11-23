import { PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';
import type { PermissionState } from '../../interfaces/IDevice';
import type { Direction } from '../../interfaces/IGestures';
import { travel, windowSize } from '../touch';
import { APP_STATE_FOREGROUND, mobile, type AppiumDriver, type PlatformStrategy } from './PlatformStrategy';

/**
 * How long a measured screen swipe holds the finger before dragging, in
 * seconds: the minimum XCUITest accepts for `mobile: dragFromToForDuration`.
 */
export const IOS_DRAG_HOLD_SECONDS = 0.5;

/** `setPermission` state -> XCUITest `mobile: setPermission` access value. */
const PERMISSION_ACCESS: Record<PermissionState, 'yes' | 'no' | 'unset'> = {
    grant: 'yes',
    deny: 'no',
    reset: 'unset',
};

/** iOS (XCUITest driver). Every command is a W3C or `mobile:` command of Appium 3. */
export const iosStrategy: PlatformStrategy = Object.freeze({
    platform: 'ios',
    implemented: true,
    appIdCapability: 'appium:bundleId',
    // No focus attribute verified across XCUITest versions; state('focused') throws on iOS.
    focusedAttribute: null,
    unsupported: Object.freeze(['pressBack']),

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
     * Without `distance`: XCUITest `mobile: swipe {direction}` on the
     * application element (its direction is the finger direction too, so it
     * is passed through unchanged; XCUITest sets the travel). With
     * `distance`: `mobile: dragFromToForDuration` from the screen centre,
     * the finger travelling exactly `distance` px (clamped to the window)
     * after a {@link IOS_DRAG_HOLD_SECONDS} s hold. W3C touch actions are not
     * used: they did not scroll an iOS collection view reliably.
     */
    async swipeScreen(driver: AppiumDriver, direction: Direction, distance?: number) {
        if (distance === undefined) {
            await mobile(driver, 'swipe', { direction });
            return;
        }
        const win = await windowSize(driver);
        const from = { x: Math.round(win.width / 2), y: Math.round(win.height / 2) };
        const to = travel(from, direction, distance, win);
        await mobile(driver, 'dragFromToForDuration', {
            duration: IOS_DRAG_HOLD_SECONDS,
            fromX: from.x, fromY: from.y,
            toX: Math.round(to.x), toY: Math.round(to.y),
        });
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
