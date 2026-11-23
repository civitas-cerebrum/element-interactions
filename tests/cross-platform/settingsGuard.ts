import { loadCapabilities } from '../../src';
import type { Platform } from '../../src';

/**
 * Device-safety guard shared by the cross-platform spec and the live iOS spec.
 *
 * Both specs drive ONLY the platform's built-in Settings app, read-only. On a
 * device platform the capabilities file is read the way the library reads it
 * (`loadCapabilities`: `CAPABILITIES`, flat object, `platformName` agreeing
 * with the platform) and checked against an ALLOW-LIST before any session
 * opens:
 *
 * - Keys are compared without a leading `appium:` (Appium accepts both forms).
 *   A file that sets the same key both with and without the prefix is refused,
 *   and so is `appium:options` (the nested form).
 * - Only the keys in {@link ALLOWED_KEYS} (plus the platform's app keys) may
 *   appear; anything else (`app`, `otherApps`, `browserName`, `intentAction`,
 *   `processArguments`, ...) is refused whatever its value.
 * - The app id is the platform's Settings app: `bundleId` exactly
 *   `com.apple.Preferences` on iOS; `appPackage` exactly `com.android.settings`
 *   on Android, with `appActivity` (optional) one of {@link SETTINGS_ACTIVITIES}.
 * - `noReset` is present and exactly `true` (absent, the driver's fast reset may
 *   clear app data); `fullReset` is absent or exactly `false`.
 *
 * Every error names the file and the offending key as written. A no-op on web.
 */

/** The built-in Settings app of each device platform (bare key, without `appium:`). */
export const SETTINGS_APPS: Readonly<Partial<Record<Platform, { key: string; id: string }>>> = {
    ios: { key: 'bundleId', id: 'com.apple.Preferences' },
    android: { key: 'appPackage', id: 'com.android.settings' },
};

/** The Settings main activity, the only `appActivity` allowed on Android. */
export const SETTINGS_ACTIVITIES: readonly string[] = ['.Settings', 'com.android.settings.Settings'];

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

/** App keys allowed per platform, on top of {@link ALLOWED_KEYS}. */
export const PLATFORM_APP_KEYS: Readonly<Partial<Record<Platform, readonly string[]>>> = {
    ios: ['bundleId'],
    android: ['appPackage', 'appActivity'],
};

const PREFIX = 'appium:';

/**
 * Throws unless the capabilities file of a device run targets only the
 * built-in Settings app without installing, resetting or launching anything
 * else.
 *
 * @param platform - The resolved platform of the run.
 * @param env - Environment to read `CAPABILITIES` from (default `process.env`).
 */
export function requireSettingsCapabilities(platform: Platform, env: NodeJS.ProcessEnv = process.env): void {
    const expected = SETTINGS_APPS[platform];
    if (!expected) return;

    const { file, capabilities } = loadCapabilities(undefined, platform, env);
    const refuse = (key: string, reason: string): never => {
        throw new Error(
            `Refusing to open a ${platform} session: this spec drives the built-in Settings app read-only, `
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

    const allowed = new Set([...ALLOWED_KEYS, ...(PLATFORM_APP_KEYS[platform] ?? [])]);
    for (const [key, { written }] of bare) {
        if (!allowed.has(key)) {
            refuse(written, `sets "${written}", which is not on the Settings allow-list `
                + `(${[...allowed].join(', ')}; each with or without "${PREFIX}")`);
        }
    }

    const appId = bare.get(expected.key);
    if (appId?.value !== expected.id) {
        refuse(appId?.written ?? `${PREFIX}${expected.key}`,
            `must set "${PREFIX}${expected.key}": "${expected.id}", found ${JSON.stringify(appId?.value)}`);
    }
    const activity = bare.get('appActivity');
    if (activity && !SETTINGS_ACTIVITIES.includes(activity.value as string)) {
        refuse(activity.written, `must launch only the Settings main activity: "${activity.written}" is `
            + `${JSON.stringify(activity.value)}, allowed: ${SETTINGS_ACTIVITIES.map(a => JSON.stringify(a)).join(', ')} or absent`);
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
}
