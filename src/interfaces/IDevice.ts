/** Screen orientation. */
export type Orientation = 'portrait' | 'landscape';

/** Target state for `setPermission`. */
export type PermissionState = 'grant' | 'deny' | 'reset';

/** Options of a polling device assertion. */
export interface DeviceVerifyOptions {
    /** How long to poll, in ms. Defaults to the family's timeout. */
    timeout?: number;
    /** Replaces the default description at the head of the failure message. */
    errorMessage?: string;
}

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
    /**
     * Whether this platform can perform the device step `step` (for example
     * `false` for `pressBack` on ios). Lets a caller refuse with
     * `PlatformNotSupportedError` before it logs or sends anything. The
     * Playwright family answers `false`.
     */
    supports(step: string): boolean;
    /**
     * The app id a step works on: `appId`, else the app under test. A family
     * that needs one and has none throws, naming `step` and the capability to
     * set, before anything is sent. The Playwright family answers `undefined`.
     */
    resolveAppId(step: string, appId?: string): string | undefined;

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

    // Polling assertions: each polls until it holds or `options.timeout`
    // expires, then throws with the last observed value.
    /** The app `appId` (default: the app under test) is in the foreground. */
    verifyAppInForeground(appId?: string, options?: DeviceVerifyOptions): Promise<void>;
    /** The device reports `orientation`. */
    verifyOrientation(orientation: Orientation, options?: DeviceVerifyOptions): Promise<void>;
    /** The on-screen keyboard is shown (hidden with `negated`). */
    verifyKeyboardShown(options?: DeviceVerifyOptions & { negated?: boolean }): Promise<void>;
    /** The current context is `name`. */
    verifyContext(name: string, options?: DeviceVerifyOptions): Promise<void>;
}
