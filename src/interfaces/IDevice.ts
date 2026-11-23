/** Screen orientation. */
export type Orientation = 'portrait' | 'landscape';

/** Target state for `setPermission`. */
export type PermissionState = 'grant' | 'deny' | 'reset';

/**
 * Device and app-level operations that have no element: app lifecycle, system
 * navigation, keyboard, orientation, alerts, permissions and contexts. The
 * full contract every driver family implements.
 *
 * `appId` is the Android package or iOS bundle id. When it is optional and
 * omitted, the app under test from the session's capabilities file is used.
 *
 * The Playwright family (`web`) throws `PlatformNotSupportedError(method,
 * 'web')` for every method. On the Appium family a method one platform cannot
 * perform (for example `pressBack` on iOS) throws the same error for that
 * platform.
 */
export interface IDevice {
    // App lifecycle
    launchApp(appId?: string): Promise<void>;
    activateApp(appId?: string): Promise<void>;
    terminateApp(appId?: string): Promise<void>;
    /** Sends the app to the background for `seconds`, then brings it back. */
    backgroundApp(seconds: number): Promise<void>;
    /** Terminates and re-activates the app under test. */
    resetApp(): Promise<void>;
    installApp(appPath: string): Promise<void>;
    removeApp(appId: string): Promise<void>;
    openDeepLink(url: string, appId?: string): Promise<void>;
    isAppInForeground(appId?: string): Promise<boolean>;

    // System navigation and keyboard
    /** System back. Android only. */
    pressBack(): Promise<void>;
    hideKeyboard(): Promise<void>;
    isKeyboardShown(): Promise<boolean>;

    // Orientation
    getOrientation(): Promise<Orientation>;
    setOrientation(orientation: Orientation): Promise<void>;

    // Alerts and permissions
    acceptAlert(): Promise<void>;
    dismissAlert(): Promise<void>;
    /** `permission` is the platform's permission name (Android permission or iOS service). */
    setPermission(permission: string, state: PermissionState): Promise<void>;

    // Contexts
    getContexts(): Promise<string[]>;
    getContext(): Promise<string>;
    /** `'NATIVE_APP'` or a `'WEBVIEW_*'` context name. */
    switchContext(name: string): Promise<void>;

    // Extraction
    /** The current screen's UI hierarchy as XML. */
    getPageSource(): Promise<string>;
}
