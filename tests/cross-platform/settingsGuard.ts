import { loadCapabilities } from '../../src';
import type { Platform } from '../../src';

/**
 * Device-safety guard shared by the cross-platform spec and the live iOS spec.
 *
 * Both specs drive ONLY the platform's built-in Settings app, read-only. On a
 * device platform the capabilities file is read the way the library reads it
 * (`loadCapabilities`: `CAPABILITIES`, flat object, `platformName` agreeing
 * with the platform) and refused BEFORE any session opens unless:
 *
 * - the app id (`appium:bundleId` on iOS, `appium:appPackage` on Android, top
 *   level) is the platform's Settings app;
 * - none of `appium:app`, `appium:otherApps`, `appium:options`, `browserName`
 *   is present at all (whatever its value);
 * - `appium:fullReset`, when present, is exactly `false`;
 * - `appium:noReset`, when present, is exactly `true`.
 *
 * Every error names the file and the offending key. A no-op on web.
 */

/** The built-in Settings app of each device platform. */
export const SETTINGS_APPS: Readonly<Partial<Record<Platform, { key: string; id: string }>>> = {
    ios: { key: 'appium:bundleId', id: 'com.apple.Preferences' },
    android: { key: 'appium:appPackage', id: 'com.android.settings' },
};

/** Keys that would install, launch or wrap another app or a browser: refused whatever their value. */
export const FORBIDDEN_KEYS: readonly string[] = ['appium:app', 'appium:otherApps', 'appium:options', 'browserName'];

/**
 * Throws unless the capabilities file of a device run targets only the
 * built-in Settings app without installing, resetting or wrapping anything.
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

    const appId = capabilities[expected.key];
    if (appId !== expected.id) {
        refuse(expected.key, `must set "${expected.key}": "${expected.id}", found ${JSON.stringify(appId)}`);
    }
    for (const key of FORBIDDEN_KEYS) {
        if (key in capabilities) refuse(key, `must not contain "${key}"`);
    }
    if ('appium:fullReset' in capabilities && capabilities['appium:fullReset'] !== false) {
        refuse('appium:fullReset', `must not reset the device: "appium:fullReset" is ${JSON.stringify(capabilities['appium:fullReset'])}, only false or absent is allowed`);
    }
    if ('appium:noReset' in capabilities && capabilities['appium:noReset'] !== true) {
        refuse('appium:noReset', `must not reset the app: "appium:noReset" is ${JSON.stringify(capabilities['appium:noReset'])}, only true or absent is allowed`);
    }
}
