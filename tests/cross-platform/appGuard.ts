import { loadCapabilities } from '../../src/session/capabilities';
import type { Platform } from '../../src';

/**
 * Device-safety guard shared by the cross-platform spec and the live specs.
 *
 * Each spec names the ONE app it may drive ({@link DeviceApp}); without one,
 * the platform's default app in {@link DEVICE_APPS}:
 *
 * - iOS, Settings ({@link IOS_SETTINGS_APP}, the iOS default): the built-in
 *   Settings app (`bundleId` exactly `com.apple.Preferences`), read-only.
 * - iOS, test app ({@link IOS_TEST_APP}, the live test-app spec only): the
 *   purpose-built test app (`bundleId` exactly `com.civitas-cerebrum.test-app`).
 *   On a SIMULATOR (a file without `udid`) the file may also install the app's
 *   build with `app` (a local `.app` or `.app.zip` path) and set
 *   `reduceMotion`; on a real device (a file with `udid`) both stay refused:
 *   nothing is installed on a device. A file without `udid` is treated as a
 *   simulator; this assumes the Appium server does not pick a real device for
 *   a request without a udid.
 * - Android ({@link ANDROID_TEST_APP}): the purpose-built test app
 *   (`appPackage` exactly `com.civitas.testapp`, `appActivity` optional and
 *   then exactly `com.civitas.testapp.MainActivity` or `.MainActivity`). The
 *   app must already be installed: nothing is installed.
 *
 * On a device platform the capabilities file is read the way the library reads
 * it (`loadCapabilities`: `E2E_CAPABILITIES`, flat object, `platformName`
 * agreeing with the platform) and checked against an ALLOW-LIST before any
 * session opens:
 *
 * - Keys are compared without a leading `appium:` (Appium accepts both forms).
 *   A file that sets the same key both with and without the prefix is refused,
 *   and so is `appium:options` (the nested form).
 * - Only the keys in {@link ALLOWED_KEYS} (plus the platform's app keys, and on
 *   a simulator the app's simulator-only keys) may appear; anything else
 *   (`app`, `otherApps`, `browserName`, `intentAction`, `processArguments`,
 *   ...) is refused whatever its value: no install, no second app, no browser.
 * - The app id is the spec's app.
 * - `noReset` is present and exactly `true` (absent, the driver's fast reset may
 *   clear app data); `fullReset` is absent or exactly `false`.
 * - `autoAcceptAlerts`, `autoDismissAlerts` and `autoGrantPermissions` are
 *   absent or exactly `false`: the specs must never answer a system dialog or
 *   grant a permission on their own.
 *
 * The guard checks the file named by `E2E_CAPABILITIES`. A fixture using it must
 * therefore not set `session.capabilities`, which would open the session from
 * another file than the one checked.
 *
 * Every error names the file and the offending key as written. A no-op on web.
 */

/** The one app a spec may drive (keys bare, without `appium:`). */
export interface DeviceApp {
    /** The platform the app runs on. */
    platform: Platform;
    /** The capability naming the app. */
    key: string;
    /** Its only allowed value. */
    id: string;
    /** The only allowed values of an (optional) `appActivity`; none allowed when unset. */
    activities?: readonly string[];
    /**
     * Keys allowed only when the file targets a simulator (it sets no `udid`).
     * `app` among them must be a local `.app` or `.app.zip` path.
     */
    simulatorOnlyKeys?: readonly string[];
    /** What the specs do with the app, for the error message. */
    description: string;
}

/** iOS: the built-in Settings app, read-only (the Settings spec and the cross-platform spec). */
export const IOS_SETTINGS_APP: DeviceApp = {
    platform: 'ios',
    key: 'bundleId',
    id: 'com.apple.Preferences',
    description: 'drives the built-in Settings app read-only',
};

/** iOS: the purpose-built test app (the live test-app spec). Its build may be installed on a simulator only. */
export const IOS_TEST_APP: DeviceApp = {
    platform: 'ios',
    key: 'bundleId',
    id: 'com.civitas-cerebrum.test-app',
    simulatorOnlyKeys: ['app', 'reduceMotion'],
    description: 'drives only the test app com.civitas-cerebrum.test-app (its build may be installed on a simulator, never on a device)',
};

/** Android: the purpose-built test app, already installed on the device. */
export const ANDROID_TEST_APP: DeviceApp = {
    platform: 'android',
    key: 'appPackage',
    id: 'com.civitas.testapp',
    activities: ['com.civitas.testapp.MainActivity', '.MainActivity'],
    description: 'drives only the installed test app com.civitas.testapp',
};

/** The default app of each device platform: what {@link requireAppCapabilities} checks when no app is named. */
export const DEVICE_APPS: Readonly<Partial<Record<Platform, DeviceApp>>> = {
    ios: IOS_SETTINGS_APP,
    android: ANDROID_TEST_APP,
};

/** Bare keys allowed on every device platform (the app keys are added per platform). */
export const ALLOWED_KEYS: readonly string[] = [
    'platformName',
    'automationName',
    'deviceName',
    'udid',
    'platformVersion',
    'newCommandTimeout',
    'noReset',
    'fullReset',
    'autoAcceptAlerts',
    'autoDismissAlerts',
    'autoGrantPermissions',
    'wdaLaunchTimeout',
    'wdaConnectionTimeout',
    'uiautomator2ServerInstallTimeout',
    'uiautomator2ServerLaunchTimeout',
    'adbExecTimeout',
    'usePrebuiltWDA',
    'showXcodeLog',
];

/** Keys allowed only when absent or exactly `false` (no dialog answered, no permission granted). */
export const FALSE_ONLY_KEYS: readonly string[] = ['autoAcceptAlerts', 'autoDismissAlerts', 'autoGrantPermissions'];

/** App keys allowed per platform, on top of {@link ALLOWED_KEYS}. */
export const PLATFORM_APP_KEYS: Readonly<Partial<Record<Platform, readonly string[]>>> = {
    ios: ['bundleId'],
    android: ['appPackage', 'appActivity'],
};

const PREFIX = 'appium:';

/** The platform with its article, for the refusal message. */
const SESSION_NAMES: Partial<Record<Platform, string>> = { android: 'an Android', ios: 'an iOS' };

/** A local simulator build: a path (not a URL) ending in `.app` or `.app.zip`. */
const SIMULATOR_BUILD = /\.app(\.zip)?$/;
/**
 * Anything that is not a local path: a URL scheme (`http:`, `file:`, with or
 * without `//` after it) or a network-path reference starting with `//`.
 */
const NOT_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * The iOS app the capabilities file names (`bundleId`, with or without
 * `appium:`), or `undefined` when there is no readable iOS file or no string
 * bundle id. Never throws: the specs call it while they are collected (to
 * decide which iOS spec runs), and the guard in their `beforeAll` is what
 * refuses a bad file.
 *
 * @param env - Environment to read `E2E_CAPABILITIES` from (default `process.env`).
 */
export function capabilitiesBundleId(env: NodeJS.ProcessEnv = process.env): string | undefined {
    let capabilities: Record<string, unknown>;
    try {
        ({ capabilities } = loadCapabilities(undefined, 'ios', env));
    } catch {
        return undefined;
    }
    const value = capabilities[`${PREFIX}bundleId`] ?? capabilities.bundleId;
    return typeof value === 'string' ? value : undefined;
}

/**
 * Throws unless the capabilities file of a device run targets only the
 * spec's app without installing (except a simulator build where the app
 * allows it), resetting or launching anything else.
 *
 * @param platform - The resolved platform of the run.
 * @param env - Environment to read `E2E_CAPABILITIES` from (default `process.env`).
 * @param app - The app the spec drives (default the platform's app in {@link DEVICE_APPS}).
 *   It must be an app of `platform`.
 */
export function requireAppCapabilities(
    platform: Platform,
    env: NodeJS.ProcessEnv = process.env,
    app: DeviceApp | undefined = DEVICE_APPS[platform],
): void {
    if (!DEVICE_APPS[platform]) return;
    if (!app || app.platform !== platform) {
        throw new Error(`requireAppCapabilities: the app ${app ? `"${app.id}" runs on ${app.platform}, not on ${platform}` : 'is missing'}.`);
    }
    const expected = app;

    const { file, capabilities } = loadCapabilities(undefined, platform, env);
    const refuse = (key: string, reason: string): never => {
        throw new Error(
            `Refusing to open ${SESSION_NAMES[platform] ?? `a ${platform}`} session: this spec ${expected.description}, `
            + `and the capabilities file "${file}" ${reason} (key "${key}").`,
        );
    };

    // Normalise: bare key -> the key as written and its value.
    const bare = new Map<string, { written: string; value: unknown }>();
    for (const written of Object.keys(capabilities)) {
        if (written === `${PREFIX}options`) {
            refuse(written, `must not use the nested "${written}" form: write each capability at the top level`);
        }
        const key = written.startsWith(PREFIX) ? written.slice(PREFIX.length) : written;
        const other = bare.get(key);
        if (other) {
            refuse(written, `sets "${key}" twice, as "${other.written}" and as "${written}"`);
        }
        bare.set(key, { written, value: capabilities[written] });
    }

    // A file without a udid targets a simulator (the driver picks it by name and version).
    const udid = bare.get('udid');
    const simulatorOnly = new Set(expected.simulatorOnlyKeys ?? []);
    const allowed = new Set([...ALLOWED_KEYS, ...(PLATFORM_APP_KEYS[platform] ?? []), ...(udid ? [] : simulatorOnly)]);
    for (const [key, { written }] of bare) {
        if (allowed.has(key)) continue;
        if (simulatorOnly.has(key)) {
            refuse(written, `sets "${written}", which is allowed only for a simulator (a file without "udid"), `
                + `but it names a device with "${udid!.written}": nothing is installed on a device`);
        }
        refuse(written, `sets "${written}", which is not on the allow-list `
            + `(${[...allowed].join(', ')}; each with or without "${PREFIX}")`);
    }

    const build = bare.get('app');
    if (build) {
        const value = build.value;
        if (typeof value !== 'string' || !SIMULATOR_BUILD.test(value) || NOT_LOCAL.test(value)) {
            refuse(build.written, `must name a local simulator build: "${build.written}" is ${JSON.stringify(value)}, `
                + 'allowed: a local path ending in ".app" or ".app.zip" (no URL)');
        }
    }

    const appId = bare.get(expected.key);
    if (appId?.value !== expected.id) {
        refuse(appId?.written ?? `${PREFIX}${expected.key}`,
            `must set "${PREFIX}${expected.key}": "${expected.id}", found ${JSON.stringify(appId?.value)}`);
    }
    const activities = expected.activities ?? [];
    const activity = bare.get('appActivity');
    if (activity && !activities.includes(activity.value as string)) {
        refuse(activity.written, `must launch only the app's main activity: "${activity.written}" is `
            + `${JSON.stringify(activity.value)}, allowed: ${activities.map(a => JSON.stringify(a)).join(', ')} or absent`);
    }

    const noReset = bare.get('noReset');
    if (noReset?.value !== true) {
        refuse(noReset?.written ?? `${PREFIX}noReset`, noReset
            ? `must not reset the app: "${noReset.written}" is ${JSON.stringify(noReset.value)}, only true is allowed`
            : `must set "${PREFIX}noReset": true (without it the driver's fast reset may clear app data)`);
    }
    const fullReset = bare.get('fullReset');
    if (fullReset && fullReset.value !== false) {
        refuse(fullReset.written, `must not reset the device: "${fullReset.written}" is ${JSON.stringify(fullReset.value)}, only false or absent is allowed`);
    }
    for (const key of FALSE_ONLY_KEYS) {
        const entry = bare.get(key);
        if (entry && entry.value !== false) {
            refuse(entry.written, `must not answer dialogs or grant permissions by itself: "${entry.written}" is `
                + `${JSON.stringify(entry.value)}, only false or absent is allowed`);
        }
    }
}
