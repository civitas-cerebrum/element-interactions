import type {} from 'webdriverio';
// Keeps `WebdriverIO.Browser` resolvable in the published types without webdriverio installed.
import '../../types/webdriverio-global';
import { dismissKeyboard, isFatalDriverError, type DismissKeyboardOptions, type Platform } from '@civitas-cerebrum/element-repository';
import type { PermissionState } from '../../interfaces/IDevice';
import type { SwipeDirection } from '@civitas-cerebrum/element-repository';

/** The WebdriverIO session the Appium family drives. */
export type AppiumDriver = WebdriverIO.Browser;

/**
 * Everything that differs between Appium-family platforms, in one object per
 * platform (`android.ts`, `ios.ts`, ...). The Appium classes never branch on
 * the platform name: they ask the strategy. Adding a platform means adding a
 * strategy file, not touching the classes.
 *
 * Every method takes the driver explicitly; a strategy holds no session state
 * and is frozen. Element primitives (including an element's visible text,
 * `Element.textContent`) belong to element-repository; the strategy holds
 * only what differs per platform at the device level.
 * A method the platform cannot perform throws
 * `PlatformNotSupportedError(method, platform)` and is listed in
 * {@link PlatformStrategy.unsupported}.
 */
export interface PlatformStrategy {
    readonly platform: Platform;
    /**
     * `false` for a platform that is declared but not implemented yet
     * (`macos`, `windows`): every strategy method throws, and the Appium
     * classes refuse their driver-level calls too.
     */
    readonly implemented: boolean;
    /**
     * The capabilities-file key naming the app under test:
     * `appium:bundleId` (ios, macos), `appium:appPackage` (android),
     * `appium:app` (windows).
     */
    readonly appIdCapability: string;
    /** The native attribute reading `'true'` on the focused element; `null` when the platform has none (state 'focused' then throws). */
    readonly focusedAttribute: string | null;
    /** Device methods this platform cannot perform; each throws `PlatformNotSupportedError`. */
    readonly unsupported: readonly string[];
    /**
     * The attributes a `satisfy()` snapshot reads. A native element has no
     * attribute map to enumerate (the web snapshot iterates the DOM node's
     * attributes), so the snapshot reads the attributes the platform's driver
     * documents; one the driver does not report is left out, as an absent DOM
     * attribute is on web.
     */
    readonly snapshotAttributes: readonly string[];

    // App lifecycle (appId is resolved by the caller; never empty here)
    launchApp(driver: AppiumDriver, appId: string): Promise<void>;
    activateApp(driver: AppiumDriver, appId: string): Promise<void>;
    terminateApp(driver: AppiumDriver, appId: string): Promise<void>;
    /** Terminates, then activates the app: the default reset between tests of a session. */
    resetApp(driver: AppiumDriver, appId: string): Promise<void>;
    backgroundApp(driver: AppiumDriver, seconds: number): Promise<void>;
    installApp(driver: AppiumDriver, appPath: string): Promise<void>;
    removeApp(driver: AppiumDriver, appId: string): Promise<void>;
    /**
     * Appium's `mobile: queryAppState` for the app: 0 not installed, 1 not
     * running, 2 running in background or suspended, 3 running in background,
     * 4 running in foreground ({@link APP_STATE_NAMES}).
     */
    queryAppState(driver: AppiumDriver, appId: string): Promise<number>;
    /** Whether {@link PlatformStrategy.queryAppState} is {@link APP_STATE_FOREGROUND}. */
    isAppInForeground(driver: AppiumDriver, appId: string): Promise<boolean>;
    /** Opens `url`; `appId` (when known) names the app that should handle it. */
    openDeepLink(driver: AppiumDriver, url: string, appId?: string): Promise<void>;

    // System navigation and keyboard
    pressBack(driver: AppiumDriver): Promise<void>;
    /**
     * {@link hideKeyboardConfirmed} with this platform's name: `true` when a
     * shown keyboard is now gone, `false` only when no keyboard was shown
     * (nothing sent).
     */
    hideKeyboard(driver: AppiumDriver, options?: DismissKeyboardOptions): Promise<boolean>;
    isKeyboardShown(driver: AppiumDriver): Promise<boolean>;

    // Screen gestures
    /**
     * Swipes across the screen with the shared W3C touch swipe
     * (`swipeScreenW3C` in `../touch`, which sends element-repository's
     * `performTouchSwipe`, the action sequence of `PlatformElement.swipe`); the strategy only chooses
     * the geometry (the safe area it keeps clear of system gesture zones).
     * `direction` is the way the FINGER moves, the meaning of
     * element-repository's `Element.swipe`: `'up'` drags the content up and
     * reveals what lies below. `distance` is the finger travel in px
     * (native-context viewport coordinates), shortened to the safe area; when
     * omitted, half the window along that axis. The caller has validated
     * `distance` (finite, at least `MIN_SWIPE_DISTANCE`).
     */
    swipeScreen(driver: AppiumDriver, direction: SwipeDirection, distance?: number): Promise<void>;

    // Alerts and permissions
    acceptAlert(driver: AppiumDriver): Promise<void>;
    dismissAlert(driver: AppiumDriver): Promise<void>;
    setPermission(driver: AppiumDriver, permission: string, state: PermissionState, appId: string): Promise<void>;
}

/**
 * The result of Appium's `mobile: queryAppState` meaning "running in
 * foreground" (0 not installed, 1 not running, 2 running in background
 * or suspended, 3 running in background, 4 running in foreground).
 */
export const APP_STATE_FOREGROUND = 4;

/** What each `mobile: queryAppState` result means, for error messages. */
export const APP_STATE_NAMES: Readonly<Record<number, string>> = Object.freeze({
    0: 'not installed',
    1: 'not running',
    2: 'running in background or suspended',
    3: 'running in background',
    4: 'running in foreground',
});

/** Calls an Appium `mobile:` extension command with one argument object. */
export async function mobile<T = unknown>(driver: AppiumDriver, command: string, args: Record<string, unknown> = {}): Promise<T> {
    return await driver.execute(`mobile: ${command}`, args) as T;
}

/** The head of the error `hideKeyboard` throws when it cannot confirm whether a keyboard is shown. */
export const KEYBOARD_STATE_UNCONFIRMED = 'hideKeyboard: the keyboard state could not be confirmed and nothing was sent';

/**
 * element-repository's `dismissKeyboard` for `platform`, with its "no
 * keyboard" answer confirmed. `dismissKeyboard` asks WebdriverIO's
 * `driver.isKeyboardShown()` and answers `false`, sending nothing, also when
 * the driver has no such method or that check fails; the device's own
 * keyboard check is `mobile: isKeyboardShown`. So a `false` is checked again
 * with `mobile: isKeyboardShown`:
 *
 * - no keyboard: `false` (no keyboard was shown, nothing was sent);
 * - a keyboard shown: an `Error` headed {@link KEYBOARD_STATE_UNCONFIRMED};
 * - the check fails with an error that is not fatal: the same error, the
 *   driver error kept as its `cause`;
 * - a fatal driver error (element-repository's `isFatalDriverError`) is
 *   thrown unchanged.
 *
 * `true` and every error of `dismissKeyboard` itself pass unchanged.
 *
 * Not `dismissKeyboard({ strict: true })`: its strict mode throws
 * `KeyboardStateUnknownError` only when `driver.isKeyboardShown()` is
 * missing or fails, and never asks `mobile: isKeyboardShown`. So it throws
 * where this confirmation can answer `false` (no such method, and the
 * device reports no keyboard), and answers `false` where this throws
 * (`isKeyboardShown()` says no keyboard while the device shows one).
 * `KeyboardStateUnknownError` is therefore never thrown here, and this
 * package does not re-export it.
 */
export async function hideKeyboardConfirmed(driver: AppiumDriver, platform: Platform, options?: DismissKeyboardOptions): Promise<boolean> {
    if (await dismissKeyboard(driver, platform, options)) return true;
    let shown: boolean;
    try {
        shown = Boolean(await mobile<boolean>(driver, 'isKeyboardShown'));
    } catch (err) {
        if (isFatalDriverError(err)) throw err;
        const reason = (err instanceof Error ? err.message : String(err)).split('\n')[0].trim();
        throw new Error(`${KEYBOARD_STATE_UNCONFIRMED}: mobile: isKeyboardShown failed: ${reason}`, { cause: err });
    }
    if (shown) {
        throw new Error(`${KEYBOARD_STATE_UNCONFIRMED}: the driver's isKeyboardShown() answered no keyboard or could not answer, `
            + 'but mobile: isKeyboardShown reports one shown');
    }
    return false;
}
