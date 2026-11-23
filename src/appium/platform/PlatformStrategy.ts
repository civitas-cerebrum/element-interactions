import type {} from 'webdriverio';
// Keeps `WebdriverIO.Browser` resolvable in the published types without webdriverio installed.
import '../../types/webdriverio-global';
import type { Platform } from '@civitas-cerebrum/element-repository';
import type { PermissionState } from '../../interfaces/IDevice';
import type { Direction } from '../../interfaces/IGestures';

/** The WebdriverIO session the Appium family drives. */
export type AppiumDriver = WebdriverIO.Browser;

/**
 * Everything that differs between Appium-family platforms, in one object per
 * platform (`android.ts`, `ios.ts`, ...). The Appium classes never branch on
 * the platform name: they ask the strategy. Adding a platform means adding a
 * strategy file, not touching the classes.
 *
 * Every method takes the driver explicitly; a strategy holds no session state
 * and is frozen. Element text is not the strategy's business: it is read
 * through the element's own `textContent` primitive (element-repository).
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

    // App lifecycle (appId is resolved by the caller; never empty here)
    launchApp(driver: AppiumDriver, appId: string): Promise<void>;
    activateApp(driver: AppiumDriver, appId: string): Promise<void>;
    terminateApp(driver: AppiumDriver, appId: string): Promise<void>;
    /** Terminates, then activates the app: the default reset between tests of a session. */
    resetApp(driver: AppiumDriver, appId: string): Promise<void>;
    backgroundApp(driver: AppiumDriver, seconds: number): Promise<void>;
    installApp(driver: AppiumDriver, appPath: string): Promise<void>;
    removeApp(driver: AppiumDriver, appId: string): Promise<void>;
    isAppInForeground(driver: AppiumDriver, appId: string): Promise<boolean>;
    /** Opens `url`; `appId` (when known) names the app that should handle it. */
    openDeepLink(driver: AppiumDriver, url: string, appId?: string): Promise<void>;

    // System navigation and keyboard
    pressBack(driver: AppiumDriver): Promise<void>;
    hideKeyboard(driver: AppiumDriver): Promise<void>;
    isKeyboardShown(driver: AppiumDriver): Promise<boolean>;

    // Screen gestures
    /**
     * Swipes across the screen with the shared W3C touch swipe
     * (`swipeScreenW3C` in `../touch`, the same action sequence as
     * element-repository's `PlatformElement.swipe`); the strategy only chooses
     * the geometry (the safe area it keeps clear of system gesture zones).
     * `direction` is the way the FINGER moves, the meaning of
     * element-repository's `Element.swipe`: `'up'` drags the content up and
     * reveals what lies below. `distance` is the finger travel in px
     * (native-context viewport coordinates), shortened to the safe area; when
     * omitted, half the window along that axis. The caller has validated
     * `distance` (finite, at least `MIN_SWIPE_DISTANCE`).
     */
    swipeScreen(driver: AppiumDriver, direction: Direction, distance?: number): Promise<void>;

    // Alerts and permissions
    acceptAlert(driver: AppiumDriver): Promise<void>;
    dismissAlert(driver: AppiumDriver): Promise<void>;
    setPermission(driver: AppiumDriver, permission: string, state: PermissionState, appId: string): Promise<void>;
}

/**
 * The result of Appium's `mobile: queryAppState` meaning "running in
 * foreground" (0 not installed, 1 not running, 2 running in background
 * suspended, 3 running in background, 4 running in foreground).
 */
export const APP_STATE_FOREGROUND = 4;

/** Calls an Appium `mobile:` extension command with one argument object. */
export async function mobile<T = unknown>(driver: AppiumDriver, command: string, args: Record<string, unknown> = {}): Promise<T> {
    return await driver.execute(`mobile: ${command}`, args) as T;
}
