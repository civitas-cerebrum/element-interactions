import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    requireAppCapabilities, capabilitiesBundleId, DEVICE_APPS, IOS_SETTINGS_APP, IOS_TEST_APP, ANDROID_TEST_APP,
} from './appGuard';

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

    test('without an app the default is the platform\'s app: Settings on iOS, the test app on Android', () => {
        expect(DEVICE_APPS.ios).toBe(IOS_SETTINGS_APP);
        expect(DEVICE_APPS.android).toBe(ANDROID_TEST_APP);
        // The iOS test app is not the default: the Settings rule refuses it.
        expectRefused('ios', { ...IOS_OK, 'appium:bundleId': IOS_TEST_APP.id }, 'appium:bundleId');
        expect(() => requireAppCapabilities('ios', env(IOS_OK), IOS_SETTINGS_APP)).not.toThrow();
    });

    test('an app of another platform is refused before the file is read', () => {
        expect(() => requireAppCapabilities('android', {}, IOS_TEST_APP)).toThrow(/runs on ios, not on android/);
        expect(() => requireAppCapabilities('ios', {}, ANDROID_TEST_APP)).toThrow(/runs on android, not on ios/);
        // On web every app is a no-op.
        expect(() => requireAppCapabilities('web', {}, IOS_TEST_APP)).not.toThrow();
    });
});

/** A simulator file for the iOS test app: no udid, the local build to install. */
const IOS_TEST_APP_SIMULATOR = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': '<simulator-name>',
    'appium:platformVersion': '<ios-version>',
    'appium:app': '/path/to/TestApp.app.zip',
    'appium:bundleId': 'com.civitas-cerebrum.test-app',
    'appium:newCommandTimeout': 300,
    'appium:noReset': true,
    'appium:autoAcceptAlerts': false,
    'appium:autoDismissAlerts': false,
    'appium:reduceMotion': true,
};
/** A real-device file for the iOS test app: a udid, nothing installed. */
const IOS_TEST_APP_DEVICE = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': '<device-name>',
    'appium:udid': '00000000-0000000000000000',
    'appium:bundleId': 'com.civitas-cerebrum.test-app',
    'appium:newCommandTimeout': 300,
    'appium:noReset': true,
};

test.describe('requireAppCapabilities with the iOS test app', () => {
    function check(caps: Record<string, unknown>): () => void {
        const e = env(caps);
        return () => requireAppCapabilities('ios', e, IOS_TEST_APP);
    }
    function refusedTestApp(caps: Record<string, unknown>, key: string): string {
        const e = env(caps);
        const message = refusal(() => requireAppCapabilities('ios', e, IOS_TEST_APP));
        expect(message).toContain(e.E2E_CAPABILITIES!);
        expect(message).toContain(`(key "${key}")`);
        expect(message).toMatch(/^Refusing to open an iOS session: this spec drives only the test app com\.civitas-cerebrum\.test-app/);
        return message;
    }

    test('a simulator file that installs the build is accepted, with either build form and either key form', () => {
        expect(check(IOS_TEST_APP_SIMULATOR)).not.toThrow();
        expect(check({ ...IOS_TEST_APP_SIMULATOR, 'appium:app': '/path/to/TestApp.app' })).not.toThrow();
        expect(check({ ...without(IOS_TEST_APP_SIMULATOR, 'appium:app'), app: 'dist/TestApp.app.zip' })).not.toThrow();
        expect(check(without(IOS_TEST_APP_SIMULATOR, 'appium:app', 'appium:reduceMotion'))).not.toThrow();
        expect(check({ ...IOS_TEST_APP_SIMULATOR, 'appium:fullReset': false })).not.toThrow();
    });

    test('a device file (with a udid) and the app already installed is accepted', () => {
        expect(check(IOS_TEST_APP_DEVICE)).not.toThrow();
    });

    test('the committed simulator example passes the test-app rule as committed and selects the test-app spec', () => {
        const example = { E2E_CAPABILITIES: 'tests/capabilities/ios-testapp-simulator.example.json' };
        expect(() => requireAppCapabilities('ios', example, IOS_TEST_APP)).not.toThrow();
        expect(capabilitiesBundleId(example)).toBe(IOS_TEST_APP.id);
        // The Settings rule refuses it (another app, and a build to install).
        expect(refusal(() => requireAppCapabilities('ios', example))).toContain('(key "appium:app")');
        // The same file with a device udid is refused: nothing is installed on a device.
        const device = JSON.parse(fs.readFileSync(example.E2E_CAPABILITIES, 'utf-8'));
        expect(refusedTestApp({ ...device, 'appium:udid': '00000000-0000000000000000' }, 'appium:app')).toContain('allowed only for a simulator');
    });

    test('on a device (a udid is set) installing the build is refused, with or without the prefix', () => {
        for (const written of ['appium:app', 'app']) {
            for (const value of ['/path/to/TestApp.app.zip', '/path/to/TestApp.app', '/path/to/TestApp.ipa', null]) {
                expect(refusedTestApp({ ...IOS_TEST_APP_DEVICE, [written]: value }, written))
                    .toContain('allowed only for a simulator');
            }
        }
        // The unprefixed udid counts the same.
        const bareUdid = { ...without(IOS_TEST_APP_DEVICE, 'appium:udid'), udid: '00000000-0000000000000000' };
        expect(refusedTestApp({ ...bareUdid, 'appium:app': '/path/to/TestApp.app.zip' }, 'appium:app')).toContain('"udid"');
        // So does a udid with an empty value: the file still names a device.
        refusedTestApp({ ...IOS_TEST_APP_DEVICE, 'appium:udid': '', 'appium:app': '/path/to/TestApp.app.zip' }, 'appium:app');
        refusedTestApp({ ...IOS_TEST_APP_DEVICE, 'appium:reduceMotion': true }, 'appium:reduceMotion');
    });

    test('on a simulator the build must be a local .app or .app.zip path', () => {
        for (const value of ['/path/to/TestApp.ipa', '/path/to/TestApp.zip', '/path/to/TestApp.app.zip.bak', 'https://example.com/TestApp.app.zip',
            'file:///path/to/TestApp.app', 'http:/h/TestApp.app.zip', 'http:h/TestApp.app.zip', 'file:/p/TestApp.app', '//h/TestApp.app.zip',
            ' http://h/TestApp.app.zip', '/path/to/TestApp.app ', '\t/path/to/TestApp.app.zip', '', null, true, 1, ['/path/to/TestApp.app']]) {
            expect(refusedTestApp({ ...IOS_TEST_APP_SIMULATOR, 'appium:app': value }, 'appium:app')).toContain('.app.zip');
        }
    });

    test('another bundle id is refused, Settings included', () => {
        for (const value of ['com.apple.Preferences', 'com.civitas-cerebrum.test-app.debug', 'COM.CIVITAS-CEREBRUM.TEST-APP', '', null]) {
            refusedTestApp({ ...IOS_TEST_APP_SIMULATOR, 'appium:bundleId': value }, 'appium:bundleId');
            refusedTestApp({ ...IOS_TEST_APP_DEVICE, 'appium:bundleId': value }, 'appium:bundleId');
        }
        refusedTestApp(without(IOS_TEST_APP_SIMULATOR, 'appium:bundleId'), 'appium:bundleId');
    });

    test('a second app, a browser and the nested form stay refused on a simulator', () => {
        for (const written of ['appium:otherApps', 'otherApps', 'browserName', 'appium:processArguments', 'appium:appPackage']) {
            refusedTestApp({ ...IOS_TEST_APP_SIMULATOR, [written]: '["/path/to/Other.app"]' }, written);
        }
        refusedTestApp({ ...IOS_TEST_APP_SIMULATOR, 'appium:options': { app: '/path/to/TestApp.app.zip' } }, 'appium:options');
        refusedTestApp({ ...IOS_TEST_APP_SIMULATOR, app: '/path/to/TestApp.app.zip' }, 'app');
    });

    test('noReset is required and true; fullReset absent or false; alert keys absent or false', () => {
        expect(refusedTestApp(without(IOS_TEST_APP_SIMULATOR, 'appium:noReset'), 'appium:noReset')).toContain('fast reset');
        for (const value of [false, 'true', null]) {
            refusedTestApp({ ...IOS_TEST_APP_SIMULATOR, 'appium:noReset': value }, 'appium:noReset');
        }
        for (const value of [true, 'false', null]) {
            refusedTestApp({ ...IOS_TEST_APP_SIMULATOR, 'appium:fullReset': value }, 'appium:fullReset');
        }
        for (const key of ['appium:autoAcceptAlerts', 'appium:autoDismissAlerts', 'autoGrantPermissions']) {
            for (const value of [true, 'false', 1]) {
                expect(refusedTestApp({ ...IOS_TEST_APP_SIMULATOR, [key]: value }, key)).toContain('only false or absent');
                refusedTestApp({ ...IOS_TEST_APP_DEVICE, [key]: value }, key);
            }
        }
    });

    test('the Settings rule still refuses a build to install, even on a simulator', () => {
        const settingsSimulator = { ...IOS_TEST_APP_SIMULATOR, 'appium:bundleId': 'com.apple.Preferences' };
        expectRefused('ios', settingsSimulator, 'appium:app');
        expectRefused('ios', without(settingsSimulator, 'appium:app'), 'appium:reduceMotion');
        expect(() => requireAppCapabilities('ios', env(without(settingsSimulator, 'appium:app', 'appium:reduceMotion')))).not.toThrow();
    });
});

test.describe('capabilitiesBundleId', () => {
    test('reads the bundle id with or without the prefix', () => {
        expect(capabilitiesBundleId(env(IOS_TEST_APP_SIMULATOR))).toBe('com.civitas-cerebrum.test-app');
        expect(capabilitiesBundleId(env(IOS_OK))).toBe('com.apple.Preferences');
        expect(capabilitiesBundleId(env({ ...without(IOS_OK, 'appium:bundleId'), bundleId: 'com.example.app' }))).toBe('com.example.app');
    });

    test('never throws: no file, an unreadable or non-iOS file, or no string bundle id give undefined', () => {
        expect(capabilitiesBundleId({})).toBeUndefined();
        expect(capabilitiesBundleId({ E2E_CAPABILITIES: path.join(dir, 'missing.json') })).toBeUndefined();
        const broken = path.join(dir, 'broken.json');
        fs.writeFileSync(broken, '{ not json');
        expect(capabilitiesBundleId({ E2E_CAPABILITIES: broken })).toBeUndefined();
        expect(capabilitiesBundleId(env(ANDROID_OK))).toBeUndefined();
        expect(capabilitiesBundleId(env(without(IOS_OK, 'appium:bundleId')))).toBeUndefined();
        expect(capabilitiesBundleId(env({ ...IOS_OK, 'appium:bundleId': 42 }))).toBeUndefined();
    });
});
