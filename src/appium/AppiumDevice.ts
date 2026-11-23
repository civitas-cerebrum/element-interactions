import type { Platform } from '@civitas-cerebrum/element-repository';
import type { IDevice, Orientation, PermissionState } from '../interfaces/IDevice';
import type { AppiumDriver, PlatformStrategy } from './platform/PlatformStrategy';
import { notImplementedError } from './platform/notImplemented';

/**
 * Thrown when a call needs an app id and there is none: none was passed and
 * the capabilities file names no app under test. The message names `caller`
 * (the step or method that needed it) and the capability key to set. It is a
 * configuration error, so a polling step rethrows it at once instead of
 * retrying it for the step timeout.
 */
export class MissingAppIdError extends Error {
    constructor(
        readonly caller: string,
        readonly capability: string,
        readonly platform: Platform,
    ) {
        super(
            `${caller}: no app id. Pass one, or set "${capability}" in the capabilities file `
            + `(top level, or "${capability.replace(/^appium:/, '')}" inside "appium:options") for platform "${platform}".`,
        );
        this.name = 'MissingAppIdError';
    }
}

/** The context name Appium uses for the native UI. */
export const NATIVE_CONTEXT = 'NATIVE_APP';

/**
 * Device and app operations for the Appium family. Every platform
 * difference is delegated to the {@link PlatformStrategy}; this class only
 * resolves the app id and normalises results.
 *
 * `appId` arguments default to the app under test the factory was given
 * (read from the capabilities file). A call that needs an app id
 * when there is none throws, naming the capability key to set.
 */
export class AppiumDevice implements IDevice {
    constructor(
        private readonly driver: AppiumDriver,
        private readonly strategy: PlatformStrategy,
        private readonly defaultAppId?: string,
    ) {}

    private get platform(): Platform {
        return this.strategy.platform;
    }

    /** Driver-level methods (no strategy call) still refuse a declared-but-unimplemented platform. */
    private requireImplemented(): void {
        if (!this.strategy.implemented) throw notImplementedError(this.platform);
    }

    /**
     * Whether this platform can perform the device method `method` (`false`
     * for one in the strategy's `unsupported` list, e.g. `pressBack` on ios).
     * Lets a caller refuse with `PlatformNotSupportedError` before doing
     * anything else (logging, resolving).
     */
    supports(method: keyof IDevice): boolean {
        return !this.strategy.unsupported.includes(method);
    }

    /**
     * The given app id, else the app under test, else a
     * {@link MissingAppIdError} naming `caller` (the method or step asking)
     * and the capability key to set. Sends nothing.
     */
    resolveAppId(caller: string, appId?: string): string {
        const id = appId ?? this.defaultAppId;
        if (!id) throw new MissingAppIdError(caller, this.strategy.appIdCapability, this.platform);
        return id;
    }

    // ── App lifecycle ──

    async launchApp(appId?: string): Promise<void> {
        this.requireImplemented();
        await this.strategy.launchApp(this.driver, this.resolveAppId('launchApp', appId));
    }

    async activateApp(appId?: string): Promise<void> {
        this.requireImplemented();
        await this.strategy.activateApp(this.driver, this.resolveAppId('activateApp', appId));
    }

    async terminateApp(appId?: string): Promise<void> {
        this.requireImplemented();
        await this.strategy.terminateApp(this.driver, this.resolveAppId('terminateApp', appId));
    }

    async backgroundApp(seconds: number): Promise<void> {
        this.requireImplemented();
        if (!Number.isFinite(seconds) || seconds < 0) {
            throw new Error(`backgroundApp(seconds) requires a non-negative, finite number of seconds, got ${seconds}`);
        }
        await this.strategy.backgroundApp(this.driver, seconds);
    }

    /** Terminates and re-activates the app under test. */
    async resetApp(): Promise<void> {
        this.requireImplemented();
        await this.strategy.resetApp(this.driver, this.resolveAppId('resetApp'));
    }

    async installApp(appPath: string): Promise<void> {
        this.requireImplemented();
        if (!appPath) throw new Error('installApp: appPath is required.');
        await this.strategy.installApp(this.driver, appPath);
    }

    async removeApp(appId: string): Promise<void> {
        this.requireImplemented();
        if (!appId) throw new Error('removeApp: appId is required.');
        await this.strategy.removeApp(this.driver, appId);
    }

    async openDeepLink(url: string, appId?: string): Promise<void> {
        this.requireImplemented();
        if (!url) throw new Error('openDeepLink: url is required.');
        await this.strategy.openDeepLink(this.driver, url, appId ?? this.defaultAppId);
    }

    async isAppInForeground(appId?: string): Promise<boolean> {
        this.requireImplemented();
        return this.strategy.isAppInForeground(this.driver, this.resolveAppId('isAppInForeground', appId));
    }

    // ── System navigation and keyboard ──

    async pressBack(): Promise<void> {
        this.requireImplemented();
        await this.strategy.pressBack(this.driver);
    }

    async hideKeyboard(): Promise<void> {
        this.requireImplemented();
        await this.strategy.hideKeyboard(this.driver);
    }

    async isKeyboardShown(): Promise<boolean> {
        this.requireImplemented();
        return this.strategy.isKeyboardShown(this.driver);
    }

    // ── Orientation (W3C / Appium protocol, the same on every platform) ──

    async getOrientation(): Promise<Orientation> {
        this.requireImplemented();
        const raw = String(await this.driver.getOrientation()).toLowerCase();
        if (raw !== 'portrait' && raw !== 'landscape') {
            throw new Error(`getOrientation: the driver reported an unknown orientation "${raw}".`);
        }
        return raw;
    }

    async setOrientation(orientation: Orientation): Promise<void> {
        this.requireImplemented();
        if (orientation !== 'portrait' && orientation !== 'landscape') {
            throw new Error(`setOrientation: expected 'portrait' or 'landscape', got "${orientation}".`);
        }
        await this.driver.setOrientation(orientation.toUpperCase());
    }

    // ── Alerts and permissions ──

    async acceptAlert(): Promise<void> {
        this.requireImplemented();
        await this.strategy.acceptAlert(this.driver);
    }

    async dismissAlert(): Promise<void> {
        this.requireImplemented();
        await this.strategy.dismissAlert(this.driver);
    }

    async setPermission(permission: string, state: PermissionState): Promise<void> {
        this.requireImplemented();
        if (!permission) throw new Error('setPermission: permission is required.');
        if (state !== 'grant' && state !== 'deny' && state !== 'reset') {
            throw new Error(`setPermission: expected 'grant', 'deny' or 'reset', got "${state}".`);
        }
        await this.strategy.setPermission(this.driver, permission, state, this.resolveAppId('setPermission'));
    }

    // ── Contexts ──

    async getContexts(): Promise<string[]> {
        this.requireImplemented();
        const contexts = await this.driver.getAppiumContexts();
        return contexts.map(contextName);
    }

    async getContext(): Promise<string> {
        this.requireImplemented();
        return contextName(await this.driver.getAppiumContext());
    }

    async switchContext(name: string): Promise<void> {
        this.requireImplemented();
        if (!name) throw new Error(`switchContext: a context name is required ('${NATIVE_CONTEXT}' or 'WEBVIEW_*').`);
        await this.driver.switchAppiumContext(name);
    }

    // ── Extraction ──

    async getPageSource(): Promise<string> {
        this.requireImplemented();
        return this.driver.getPageSource();
    }
}

/** A context as Appium reports it: a plain name, or a detailed object carrying `id`. */
function contextName(context: unknown): string {
    if (typeof context === 'string') return context;
    if (context && typeof context === 'object' && typeof (context as { id?: unknown }).id === 'string') {
        return (context as { id: string }).id;
    }
    throw new Error(`Unexpected context value from the driver: ${JSON.stringify(context)}`);
}
