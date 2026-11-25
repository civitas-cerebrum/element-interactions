import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireAppCapabilities } from './appGuard';

/**
 * Pure unit tests of the device-app guard: temp capabilities files, no device,
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
    'appium:appPackage': 'com.civitas.testapp',
    'appium:appActivity': 'com.civitas.testapp.MainActivity',
    'appium:noReset': true,
};

let dir: string;
test.beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-guard-')); });
test.afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

let counter = 0;
function file(content: unknown): string {
    const p = path.join(dir, `caps-${counter++}.json`);
    fs.writeFileSync(p, JSON.stringify(content));
    return p;
}
function env(capabilities: unknown): NodeJS.ProcessEnv {
    return { E2E_CAPABILITIES: file(capabilities) };
}
function refusal(fn: () => void): string {
    try {
        fn();
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error('expected the guard to refuse');
}
function without(caps: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
    const copy = { ...caps };
    for (const key of keys) delete copy[key];
    return copy;
}
/** Asserts a refusal that names the file and the key as written. */
function expectRefused(platform: 'ios' | 'android', caps: Record<string, unknown>, key: string): string {
    const e = env(caps);
    const message = refusal(() => requireAppCapabilities(platform, e));
    expect(message).toContain(e.E2E_CAPABILITIES!);
    expect(message).toContain(`(key "${key}")`);
    return message;
}

test.describe('requireAppCapabilities', () => {
    test('web: a no-op, E2E_CAPABILITIES is not read', () => {
        expect(() => requireAppCapabilities('web', {})).not.toThrow();
    });

    test('ios: the Settings app with noReset true is accepted', () => {
        expect(() => requireAppCapabilities('ios', env(IOS_OK))).not.toThrow();
        expect(() => requireAppCapabilities('ios', env({ ...IOS_OK, 'appium:fullReset': false }))).not.toThrow();
    });

    test('android: the test app with noReset true is accepted, with either main activity form or none', () => {
        expect(() => requireAppCapabilities('android', env(ANDROID_OK))).not.toThrow();
        expect(() => requireAppCapabilities('android', env(without(ANDROID_OK, 'appium:appActivity')))).not.toThrow();
        expect(() => requireAppCapabilities('android', env({ ...ANDROID_OK, 'appium:appActivity': '.MainActivity' }))).not.toThrow();
        expect(() => requireAppCapabilities('android', env({ ...ANDROID_OK, 'appium:fullReset': false, 'appium:autoGrantPermissions': false }))).not.toThrow();
    });

    test('android: a file shaped like a real device file, without the install key, is accepted', () => {
        const device = {
            platformName: 'Android',
            'appium:automationName': 'UiAutomator2',
            'appium:udid': '<device-udid>',
            'appium:appPackage': 'com.civitas.testapp',
            'appium:appActivity': 'com.civitas.testapp.MainActivity',
            'appium:noReset': true,
            'appium:autoGrantPermissions': false,
            'appium:newCommandTimeout': 300,
        };
        expect(() => requireAppCapabilities('android', env(device))).not.toThrow();
        // The same file with the build to install is refused: nothing is installed.
        expectRefused('android', { ...device, 'appium:app': '/path/to/TestApp.apk' }, 'appium:app');
    });

    test('a file shaped like a real device file is accepted', () => {
        const device = {
            platformName: 'iOS',
            'appium:automationName': 'XCUITest',
            'appium:bundleId': 'com.apple.Preferences',
            'appium:deviceName': '<device-name>',
            'appium:udid': '00000000-0000000000000000',
            'appium:newCommandTimeout': 300,
            'appium:noReset': true,
            'appium:autoAcceptAlerts': false,
            'appium:autoDismissAlerts': false,
        };
        expect(() => requireAppCapabilities('ios', env(device))).not.toThrow();
    });

    test('the committed example files pass once the app id is set', () => {
        // The device-specific values a local copy fills in, plus the allowed app id.
        const ios = JSON.parse(fs.readFileSync('tests/capabilities/ios.example.json', 'utf-8'));
        expect(ios['appium:noReset']).toBe(true);
        expect(() => requireAppCapabilities('ios', env({
            ...ios,
            'appium:deviceName': 'iPhone Simulator',
            'appium:udid': '00000000-0000-0000-0000-000000000000',
            'appium:bundleId': 'com.apple.Preferences',
            'appium:wdaLaunchTimeout': 240000,
        }))).not.toThrow();

        const android = JSON.parse(fs.readFileSync('tests/capabilities/android.example.json', 'utf-8'));
        expect(android['appium:noReset']).toBe(true);
        expect(() => requireAppCapabilities('android', env({
            ...android,
            'appium:deviceName': 'Android Emulator',
            'appium:udid': 'emulator-5554',
            'appium:appPackage': 'com.civitas.testapp',
            'appium:appActivity': '.MainActivity',
            'appium:uiautomator2ServerInstallTimeout': 120000,
            'appium:adbExecTimeout': 120000,
        }))).not.toThrow();

        // As committed they name a placeholder app, which only the app id check refuses.
        expect(refusal(() => requireAppCapabilities('ios', { E2E_CAPABILITIES: 'tests/capabilities/ios.example.json' })))
            .toContain('(key "appium:bundleId")');
        expect(refusal(() => requireAppCapabilities('ios', { E2E_CAPABILITIES: 'tests/capabilities/ios.example.json' })))
            .toMatch(/^Refusing to open an iOS session: /);
        expect(refusal(() => requireAppCapabilities('android', { E2E_CAPABILITIES: 'tests/capabilities/android.example.json' })))
            .toMatch(/^Refusing to open an Android session: /);
    });

    test('a missing E2E_CAPABILITIES is refused', () => {
        expect(() => requireAppCapabilities('ios', {})).toThrow(/No capabilities file/);
    });

    test('a wrapped file and a platformName mismatch are refused the way the library refuses them', () => {
        expect(() => requireAppCapabilities('ios', env({ alwaysMatch: IOS_OK }))).toThrow(/alwaysMatch/);
        expect(() => requireAppCapabilities('android', env(IOS_OK))).toThrow(/platformName/);
    });

    test('another app id is refused, naming the file and the key', () => {
        expect(expectRefused('ios', { ...IOS_OK, 'appium:bundleId': 'com.example.app' }, 'appium:bundleId')).toContain('com.example.app');
        expectRefused('ios', without({ ...IOS_OK, bundleId: 'com.example.app' }, 'appium:bundleId'), 'bundleId');
        expectRefused('android', without(ANDROID_OK, 'appium:appPackage'), 'appium:appPackage');
        // The iOS key is not on the Android allow-list, and vice versa.
        expectRefused('android', { ...without(ANDROID_OK, 'appium:appPackage'), 'appium:bundleId': 'com.civitas.testapp' }, 'appium:bundleId');
        expectRefused('ios', { ...IOS_OK, 'appium:appPackage': 'com.civitas.testapp' }, 'appium:appPackage');
        expectRefused('ios', { ...IOS_OK, 'appium:appActivity': '.MainActivity' }, 'appium:appActivity');
    });

    test('android: any app other than the test app is refused, Android Settings included', () => {
        for (const value of ['com.android.settings', 'com.civitas.testapp.debug', 'com.civitas', 'COM.CIVITAS.TESTAPP', '', null, true]) {
            expectRefused('android', { ...ANDROID_OK, 'appium:appPackage': value }, 'appium:appPackage');
        }
        const settings = { ...ANDROID_OK, 'appium:appPackage': 'com.android.settings', 'appium:appActivity': '.Settings' };
        expect(expectRefused('android', settings, 'appium:appPackage')).toContain('com.civitas.testapp');
        expectRefused('android', without({ ...ANDROID_OK, appPackage: 'com.android.settings' }, 'appium:appPackage'), 'appPackage');
    });

    test('android: an appActivity other than the main activity is refused', () => {
        for (const value of ['.Settings', 'com.android.settings.Settings', '.OtherActivity', 'com.civitas.testapp/.MainActivity',
            'com.civitas.testapp.MainActivity2', 'MainActivity', '', null]) {
            expectRefused('android', { ...ANDROID_OK, 'appium:appActivity': value }, 'appium:appActivity');
        }
        expectRefused('android', { ...without(ANDROID_OK, 'appium:appActivity'), appActivity: '.Settings' }, 'appActivity');
    });

    test('android: installing or naming a second app is refused, with or without the prefix', () => {
        for (const written of ['appium:app', 'app', 'appium:otherApps', 'otherApps']) {
            for (const value of ['/path/to/TestApp.apk', '["/path/to/other.apk"]', '', null, false]) {
                expectRefused('android', { ...ANDROID_OK, [written]: value }, written);
            }
        }
    });

    test('android: fullReset true, any appium:options and a browserName are refused', () => {
        for (const key of ['appium:fullReset', 'fullReset']) {
            expectRefused('android', { ...ANDROID_OK, [key]: true }, key);
        }
        expectRefused('android', { ...ANDROID_OK, 'appium:options': { appPackage: 'com.civitas.testapp' } }, 'appium:options');
        expectRefused('android', { ...ANDROID_OK, browserName: 'Chrome' }, 'browserName');
        expectRefused('android', { ...ANDROID_OK, 'appium:browserName': 'Chrome' }, 'appium:browserName');
    });

    for (const key of ['app', 'otherApps', 'browserName', 'intentAction', 'optionalIntentArguments', 'processArguments', 'wdio:enforceWebDriverClassic']) {
        for (const written of key.includes(':') ? [key] : [key, `appium:${key}`]) {
            test(`"${written}" is not on the allow-list and is refused whatever its value`, () => {
                for (const value of ['/path/to/build.app', null, {}, false]) {
                    expectRefused('ios', { ...IOS_OK, [written]: value }, written);
                }
                expectRefused('android', { ...ANDROID_OK, [written]: 'x' }, written);
            });
        }
    }

    test('"appium:options" (the nested form) is refused outright, even when it only repeats safe values', () => {
        expectRefused('ios', { ...IOS_OK, 'appium:options': { noReset: true } }, 'appium:options');
        expectRefused('ios', { ...IOS_OK, 'appium:options': { bundleId: 'com.example.app', fullReset: true } }, 'appium:options');
        expectRefused('android', { ...ANDROID_OK, 'appium:options': {} }, 'appium:options');
    });

    test('a key set both with and without "appium:" is refused', () => {
        expect(expectRefused('ios', { ...IOS_OK, noReset: true }, 'noReset')).toContain('"appium:noReset"');
        expectRefused('ios', { ...IOS_OK, bundleId: 'com.apple.Preferences' }, 'bundleId');
        expectRefused('android', { appPackage: 'com.civitas.testapp', ...ANDROID_OK }, 'appium:appPackage');
    });

    test('"fullReset" other than false is refused, with or without the prefix', () => {
        for (const key of ['appium:fullReset', 'fullReset']) {
            for (const value of [true, 'true', 1, null]) {
                expectRefused('ios', { ...IOS_OK, [key]: value }, key);
                expectRefused('android', { ...ANDROID_OK, [key]: value }, key);
            }
        }
    });

    test('"noReset" other than true is refused, with or without the prefix', () => {
        for (const value of [false, 'false', 'true', 1, null]) {
            expectRefused('android', { ...ANDROID_OK, 'appium:noReset': value }, 'appium:noReset');
            expectRefused('ios', { ...without(IOS_OK, 'appium:noReset'), noReset: value }, 'noReset');
        }
        // The unprefixed form with the right value is the same capability.
        expect(() => requireAppCapabilities('ios', env({ ...without(IOS_OK, 'appium:noReset'), noReset: true }))).not.toThrow();
    });

    for (const key of ['autoAcceptAlerts', 'autoDismissAlerts', 'autoGrantPermissions']) {
        test(`"${key}" is allowed only as false, with or without the prefix`, () => {
            for (const written of [key, `appium:${key}`]) {
                expect(() => requireAppCapabilities('ios', env({ ...IOS_OK, [written]: false }))).not.toThrow();
                expect(() => requireAppCapabilities('android', env({ ...ANDROID_OK, [written]: false }))).not.toThrow();
                for (const value of [true, 'true', 'false', 1, 0, null]) {
                    expect(expectRefused('ios', { ...IOS_OK, [written]: value }, written)).toContain('only false or absent');
                    expectRefused('android', { ...ANDROID_OK, [written]: value }, written);
                }
            }
        });
    }

    test('a missing noReset is refused on both platforms', () => {
        expect(expectRefused('ios', without(IOS_OK, 'appium:noReset'), 'appium:noReset')).toContain('fast reset');
        expectRefused('android', without(ANDROID_OK, 'appium:noReset'), 'appium:noReset');
    });
});
