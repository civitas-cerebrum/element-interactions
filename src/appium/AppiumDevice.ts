import { PlatformNotSupportedError, type DismissKeyboardOptions, type Platform } from '@civitas-cerebrum/element-repository';
import type { DeviceVerifyOptions, IDevice, Orientation, PermissionState } from '../interfaces/IDevice';
import { APP_STATE_FOREGROUND, APP_STATE_NAMES, type AppiumDriver, type PlatformStrategy } from './platform/PlatformStrategy';
import { notImplementedError } from './platform/notImplemented';
import { describeValue, pollUntil, PollTimeoutError } from '../utils/poll';

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

/**
 * Thrown by {@link AppiumDevice.waitForAppInForeground} when the app is not
 * in the foreground before the timeout. `lastState` is the last
 * `mobile: queryAppState` answer as the driver returned it (a number from 0
 * to 4 from a working driver; `undefined` when no query answered, and
 * `lastError` then holds the last query error).
 */
export class AppNotInForegroundError extends Error {
    constructor(
        readonly appId: string,
        readonly platform: Platform,
        readonly timeout: number,
        readonly lastState: unknown,
        readonly lastError?: unknown,
    ) {
        super(`App "${appId}" is not in the foreground on platform "${platform}" after ${timeout} ms (${describeAppState(lastState, lastError)}).`);
        this.name = 'AppNotInForegroundError';
    }
}

/**
 * `last app state: 3, running in background`; a last answer that is not a
 * number is shown as the driver returned it; with no answer at all, the last
 * query error.
 */
export function describeAppState(state: unknown, error?: unknown): string {
    if (state === undefined) {
        const why = error === undefined ? '' : `; last error: ${error instanceof Error ? error.message : String(error)}`;
        return `no app state could be read${why}`;
    }
    if (typeof state !== 'number') return `last answer: ${describeValue(state)}, not an app state`;
    return `last app state: ${state}, ${APP_STATE_NAMES[state] ?? 'unknown state'}`;
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
 *
 * The `verify*` assertions poll a read-only query until it holds or their
 * timeout (`options.timeout`, else the instance timeout) expires.
 */
export class AppiumDevice implements IDevice {
    constructor(
        private readonly driver: AppiumDriver,
        private readonly strategy: PlatformStrategy,
        private readonly defaultAppId?: string,
        private readonly timeout: number = 30000,
    ) {}

    private get platform(): Platform {
        return this.strategy.platform;
    }

    /** Driver-level methods (no strategy call) still refuse a declared-but-unimplemented platform. */
    private requireImplemented(): void {
        if (!this.strategy.implemented) throw notImplementedError(this.platform);
    }

    /**
     * Whether this platform can perform the device step `step` (`false`
     * for one in the strategy's `unsupported` list, e.g. `pressBack` on ios).
     * Lets a caller refuse with `PlatformNotSupportedError` before doing
     * anything else (logging, resolving).
     */
    supports(step: string): boolean {
        return !this.strategy.unsupported.includes(step);
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

    /**
     * Polls `mobile: queryAppState` until the app (default: the app under
     * test) is in the foreground, for `timeout` ms. A fatal driver error (dead
     * session, lost connection) is rethrown at once; any other query error is
     * retried. On timeout it throws {@link AppNotInForegroundError} with the
     * last observed app state.
     */
    async waitForAppInForeground(timeout: number, appId?: string): Promise<void> {
        this.requireImplemented();
        const id = this.resolveAppId('waitForAppInForeground', appId);
        try {
            await pollUntil(
                () => this.strategy.queryAppState(this.driver, id),
                state => state === APP_STATE_FOREGROUND,
                { timeout, scope: this.driver },
            );
        } catch (error) {
            if (!(error instanceof PollTimeoutError)) throw error;
            throw new AppNotInForegroundError(id, this.platform, timeout, error.lastValue, error.lastError);
        }
    }

    // ── System navigation and keyboard ──

    async pressBack(): Promise<void> {
        this.requireImplemented();
        await this.strategy.pressBack(this.driver);
    }

    /**
     * element-repository's `dismissKeyboard` (through the strategy), its
     * "no keyboard" answer confirmed with `mobile: isKeyboardShown`: `false`
     * with nothing sent only when no keyboard is shown; its
     * `KeyboardStillShownError` and fatal driver errors pass unchanged.
     */
    async hideKeyboard(options?: DismissKeyboardOptions): Promise<boolean> {
        this.requireImplemented();
        return this.strategy.hideKeyboard(this.driver, options);
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

    // ── Polling assertions ──

    async verifyAppInForeground(appId?: string, options?: DeviceVerifyOptions): Promise<void> {
        const id = this.resolveAppId('verifyAppInForeground', appId);
        await this.pollDevice(
            () => this.isAppInForeground(id),
            inForeground => inForeground === true,
            `verifyAppInForeground: expected app "${id}" in the foreground`,
            options,
        );
    }

    async verifyOrientation(orientation: Orientation, options?: DeviceVerifyOptions): Promise<void> {
        if (orientation !== 'portrait' && orientation !== 'landscape') {
            throw new Error(`verifyOrientation: expected 'portrait' or 'landscape', got "${orientation}".`);
        }
        await this.pollDevice(
            () => this.getOrientation(),
            actual => actual === orientation,
            `verifyOrientation: expected orientation "${orientation}"`,
            options,
        );
    }

    async verifyKeyboardShown(options?: DeviceVerifyOptions & { negated?: boolean }): Promise<void> {
        const shown = options?.negated !== true;
        await this.pollDevice(
            () => this.isKeyboardShown(),
            actual => actual === shown,
            `verifyKeyboardShown: expected the keyboard ${shown ? 'shown' : 'hidden'}`,
            options,
        );
    }

    async verifyContext(name: string, options?: DeviceVerifyOptions): Promise<void> {
        await this.pollDevice(
            () => this.getContext(),
            actual => actual === name,
            `verifyContext: expected context "${name}"`,
            options,
        );
    }

    /**
     * Polls a read-only device query until `accept` takes its value, for
     * `options.timeout` (else the instance timeout). A
     * `PlatformNotSupportedError` or a {@link MissingAppIdError} from the
     * query is not retried: it is rethrown at once (neither can change while
     * polling). On timeout the error leads with `options.errorMessage`, else
     * `message` (the step and what was expected), then the last observed value.
     */
    private async pollDevice<T>(
        probe: () => Promise<T>,
        accept: (value: T) => boolean,
        message: string,
        options?: DeviceVerifyOptions,
    ): Promise<void> {
        let refusal: PlatformNotSupportedError | MissingAppIdError | undefined;
        const REFUSED = Symbol('refused');
        await pollUntil<T | typeof REFUSED>(
            async () => {
                try {
                    return await probe();
                } catch (error) {
                    if (error instanceof PlatformNotSupportedError || error instanceof MissingAppIdError) {
                        refusal = error;
                        return REFUSED;
                    }
                    throw error;
                }
            },
            value => value === REFUSED || accept(value as T),
            { timeout: options?.timeout ?? this.timeout, message: options?.errorMessage ?? message },
        );
        if (refusal) throw refusal;
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
