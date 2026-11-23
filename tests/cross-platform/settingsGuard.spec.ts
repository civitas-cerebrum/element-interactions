import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireSettingsCapabilities } from './settingsGuard';

/**
 * Pure unit tests of the Settings guard: temp capabilities files, no device,
 * no session, no server.
 */

const IOS_OK = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': '<device-name>',
    'appium:bundleId': 'com.apple.Preferences',
    'appium:noReset': true,
};
const ANDROID_OK = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': '<device-name>',
    'appium:appPackage': 'com.android.settings',
    'appium:appActivity': '.Settings',
};

let dir: string;
test.beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-guard-')); });
test.afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

let counter = 0;
function file(content: unknown): string {
    const p = path.join(dir, `caps-${counter++}.json`);
    fs.writeFileSync(p, JSON.stringify(content));
    return p;
}
function env(capabilities: unknown): NodeJS.ProcessEnv {
    return { CAPABILITIES: file(capabilities) };
}
function refusal(fn: () => void): string {
    try {
        fn();
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error('expected the guard to refuse');
}

test.describe('requireSettingsCapabilities', () => {
    test('web: a no-op, CAPABILITIES is not read', () => {
        expect(() => requireSettingsCapabilities('web', {})).not.toThrow();
    });

    test('ios and android: the Settings app with no reset is accepted', () => {
        expect(() => requireSettingsCapabilities('ios', env(IOS_OK))).not.toThrow();
        expect(() => requireSettingsCapabilities('ios', env({ ...IOS_OK, 'appium:fullReset': false }))).not.toThrow();
        expect(() => requireSettingsCapabilities('android', env(ANDROID_OK))).not.toThrow();
    });

    test('a missing CAPABILITIES is refused', () => {
        expect(() => requireSettingsCapabilities('ios', {})).toThrow(/No capabilities file/);
    });

    test('a wrapped file and a platformName mismatch are refused the way the library refuses them', () => {
        expect(() => requireSettingsCapabilities('ios', env({ alwaysMatch: IOS_OK }))).toThrow(/alwaysMatch/);
        expect(() => requireSettingsCapabilities('android', env(IOS_OK))).toThrow(/platformName/);
    });

    test('another app id is refused, naming the file and the key', () => {
        const caps = env({ ...IOS_OK, 'appium:bundleId': 'com.example.app' });
        const message = refusal(() => requireSettingsCapabilities('ios', caps));
        expect(message).toContain(caps.CAPABILITIES!);
        expect(message).toContain('"appium:bundleId"');
        expect(message).toContain('com.example.app');

        const missing = { ...ANDROID_OK } as Record<string, unknown>;
        delete missing['appium:appPackage'];
        expect(refusal(() => requireSettingsCapabilities('android', env(missing)))).toContain('"appium:appPackage"');
        // The iOS key does not satisfy Android.
        expect(refusal(() => requireSettingsCapabilities('android', env({ ...missing, 'appium:bundleId': 'com.android.settings' }))))
            .toContain('"appium:appPackage"');
    });

    for (const key of ['appium:app', 'appium:otherApps', 'appium:options', 'browserName']) {
        test(`"${key}" is refused whatever its value`, () => {
            for (const value of ['/path/to/build.app', null, {}, false]) {
                const caps = env({ ...IOS_OK, [key]: value });
                const message = refusal(() => requireSettingsCapabilities('ios', caps));
                expect(message).toContain(caps.CAPABILITIES!);
                expect(message).toContain(`"${key}"`);
            }
            expect(refusal(() => requireSettingsCapabilities('android', env({ ...ANDROID_OK, [key]: 'x' })))).toContain(`"${key}"`);
        });
    }

    test('"appium:fullReset" other than false is refused', () => {
        for (const value of [true, 'true', 1]) {
            const caps = env({ ...IOS_OK, 'appium:fullReset': value });
            const message = refusal(() => requireSettingsCapabilities('ios', caps));
            expect(message).toContain(caps.CAPABILITIES!);
            expect(message).toContain('"appium:fullReset"');
        }
    });

    test('"appium:noReset" other than true is refused', () => {
        for (const value of [false, 'false', 0]) {
            const caps = env({ ...ANDROID_OK, 'appium:noReset': value });
            const message = refusal(() => requireSettingsCapabilities('android', caps));
            expect(message).toContain(caps.CAPABILITIES!);
            expect(message).toContain('"appium:noReset"');
        }
    });

    test('a nested appium:options is refused even when the top level is clean', () => {
        const caps = env({ ...IOS_OK, 'appium:options': { bundleId: 'com.example.app', fullReset: true } });
        expect(refusal(() => requireSettingsCapabilities('ios', caps))).toContain('"appium:options"');
    });
});
