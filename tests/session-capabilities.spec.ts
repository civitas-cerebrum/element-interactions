import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadCapabilities, prepareSession } from '../src/session';

const IOS_EXAMPLE = 'tests/capabilities/ios.example.json';
const ANDROID_EXAMPLE = 'tests/capabilities/android.example.json';

let dir: string;
test.beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-caps-')); });
test.afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function writeFile(name: string, content: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    return file;
}

function errorOf(fn: () => unknown): Error {
    try {
        fn();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a throw');
}

test.describe('loadCapabilities', () => {
    test('passes the file content through exactly: deep-equal, no extra keys', () => {
        const raw = JSON.parse(fs.readFileSync(IOS_EXAMPLE, 'utf-8'));
        const { capabilities, file } = loadCapabilities(IOS_EXAMPLE, 'ios', {});
        expect(capabilities).toStrictEqual(raw);
        expect(Object.keys(capabilities)).toEqual(Object.keys(raw));
        expect(file).toBe(IOS_EXAMPLE);
    });

    test('keeps vendor keys, nested objects and odd values untouched', () => {
        const content = {
            platformName: 'android',
            'appium:appPackage': 'com.example.app',
            'vendor:options': { build: 'x', nested: { list: [1, 'two', null] } },
            'appium:newCommandTimeout': 0,
            'appium:noReset': false,
            empty: '',
        };
        const file = writeFile('vendor.json', JSON.stringify(content));
        expect(loadCapabilities(file, 'android', {}).capabilities).toStrictEqual(content);
    });

    test('platformName is compared case-insensitively', () => {
        expect(() => loadCapabilities(ANDROID_EXAMPLE, 'android', {})).not.toThrow();
        const file = writeFile('upper.json', JSON.stringify({ platformName: 'IOS' }));
        expect(loadCapabilities(file, 'ios', {}).capabilities.platformName).toBe('IOS');
    });

    test('falls back to CAPABILITIES (explicit env and process.env)', () => {
        expect(loadCapabilities(undefined, 'ios', { CAPABILITIES: IOS_EXAMPLE }).file).toBe(IOS_EXAMPLE);
        const saved = process.env.CAPABILITIES;
        process.env.CAPABILITIES = ANDROID_EXAMPLE;
        try {
            expect(loadCapabilities(undefined, 'android').file).toBe(ANDROID_EXAMPLE);
        } finally {
            if (saved === undefined) delete process.env.CAPABILITIES; else process.env.CAPABILITIES = saved;
        }
    });

    test('an empty CAPABILITIES counts as unset', () => {
        expect(errorOf(() => loadCapabilities(undefined, 'ios', { CAPABILITIES: '' })).message)
            .toMatch(/^No capabilities file for platform "ios"/);
        const saved = process.env.CAPABILITIES;
        process.env.CAPABILITIES = '';
        try {
            expect(errorOf(() => loadCapabilities(undefined, 'android')).message).toMatch(/^No capabilities file for platform "android"/);
        } finally {
            if (saved === undefined) delete process.env.CAPABILITIES; else process.env.CAPABILITIES = saved;
        }
    });

    test('the option wins over CAPABILITIES', () => {
        expect(loadCapabilities(IOS_EXAMPLE, 'ios', { CAPABILITIES: ANDROID_EXAMPLE }).file).toBe(IOS_EXAMPLE);
    });

    test('no file at all is an error that says how to give one', () => {
        expect(errorOf(() => loadCapabilities(undefined, 'ios', {})).message)
            .toMatch(/No capabilities file for platform "ios".*session\.capabilities.*CAPABILITIES/);
    });

    test('an inline object is rejected: capabilities are always a file path', () => {
        const err = errorOf(() => loadCapabilities({ platformName: 'iOS' }, 'ios', {}));
        expect(err.message).toMatch(/must be the path to a JSON capabilities file, got object/);
        expect(err.message).toMatch(/Inline capability objects are not accepted/);
    });

    test('a missing file names the file', () => {
        const err = errorOf(() => loadCapabilities('tests/capabilities/nope.json', 'ios', {}));
        expect(err.message).toMatch(/Capabilities file "tests\/capabilities\/nope\.json" was not found/);
    });

    test('bad JSON names the file', () => {
        const file = writeFile('bad.json', '{ "platformName": "iOS", ');
        expect(errorOf(() => loadCapabilities(file, 'ios', {})).message)
            .toContain(`Capabilities file "${file}" is not valid JSON`);
    });

    test('a non-object file names the file', () => {
        for (const content of ['[]', 'null', '"iOS"', '3']) {
            const file = writeFile('scalar.json', content);
            expect(errorOf(() => loadCapabilities(file, 'ios', {})).message)
                .toBe(`Capabilities file "${file}" must contain one JSON object of W3C capabilities.`);
        }
    });

    test('a file wrapped in alwaysMatch / firstMatch is refused: capabilities files are flat', () => {
        const cases: Array<[unknown, string]> = [
            [{ alwaysMatch: { platformName: 'iOS', 'appium:bundleId': 'com.example.app' } }, '"alwaysMatch"'],
            [{ firstMatch: [{ platformName: 'iOS' }] }, '"firstMatch"'],
            [{ platformName: 'iOS', alwaysMatch: {}, firstMatch: [{}] }, '"alwaysMatch" and "firstMatch"'],
        ];
        for (const [content, keys] of cases) {
            const file = writeFile('wrapped.json', JSON.stringify(content));
            expect(errorOf(() => loadCapabilities(file, 'ios', {})).message).toBe(
                `Capabilities file "${file}" has ${keys}: capabilities files are flat W3C objects `
                + '(top-level keys such as "platformName" and "appium:automationName", no alwaysMatch / firstMatch wrapper). '
                + 'Move the keys to the top level of the file.',
            );
        }
    });

    test('a missing platformName names the file and the key', () => {
        for (const content of [{ 'appium:bundleId': 'com.example.app' }, { platformName: '' }, { platformName: 7 }]) {
            const file = writeFile('noplatform.json', JSON.stringify(content));
            expect(errorOf(() => loadCapabilities(file, 'ios', {})).message)
                .toBe(`Capabilities file "${file}" is missing the required key "platformName".`);
        }
    });

    test('a platformName that disagrees with the platform names both', () => {
        const err = errorOf(() => loadCapabilities(ANDROID_EXAMPLE, 'ios', {}));
        expect(err.message).toContain(`Capabilities file "${ANDROID_EXAMPLE}" has "platformName": "Android", but the platform is "ios".`);
    });
});

test.describe('prepareSession', () => {
    test('resolves context, file and app id without opening anything', () => {
        const prepared = prepareSession('ios', { capabilities: IOS_EXAMPLE }, {});
        expect(prepared.context.platform).toBe('ios');
        expect(prepared.context.capabilities).toStrictEqual(JSON.parse(fs.readFileSync(IOS_EXAMPLE, 'utf-8')));
        expect(prepared.context.server).toEqual({ protocol: 'http', hostname: '127.0.0.1', port: 4723, path: '/' });
        expect(prepared.capabilitiesFile).toBe(IOS_EXAMPLE);
        expect(prepared.appId).toBe('com.example.app');
        expect(prepared.reset).toBe('relaunch');
        expect(prepareSession('android', { capabilities: ANDROID_EXAMPLE }, {}).appId).toBe('com.example.app');
    });

    test("reset 'relaunch' (default) needs the app id in the file; 'none' does not", () => {
        const file = writeFile('noapp.json', JSON.stringify({ platformName: 'iOS' }));
        expect(errorOf(() => prepareSession('ios', { capabilities: file }, {})).message)
            .toContain(`Capabilities file "${file}" has no "appium:bundleId"`);
        const prepared = prepareSession('ios', { capabilities: file, reset: 'none' }, {});
        expect(prepared.appId).toBeUndefined();
        expect(prepared.reset).toBe('none');
    });

    test('the app id is read from the nested appium:options form too; the message names both forms', () => {
        const ios = writeFile('nested-ios.json', JSON.stringify({ platformName: 'iOS', 'appium:options': { bundleId: 'com.example.nested' } }));
        expect(prepareSession('ios', { capabilities: ios }, {}).appId).toBe('com.example.nested');
        const android = writeFile('nested-android.json', JSON.stringify({ platformName: 'Android', 'appium:options': { appPackage: 'com.example.nested' } }));
        expect(prepareSession('android', { capabilities: android }, {}).appId).toBe('com.example.nested');

        const iosMissing = writeFile('nested-none.json', JSON.stringify({ platformName: 'iOS', 'appium:options': { automationName: 'XCUITest' } }));
        expect(errorOf(() => prepareSession('ios', { capabilities: iosMissing }, {})).message).toBe(
            `Capabilities file "${iosMissing}" has no "appium:bundleId" (nor "appium:options": { "bundleId": ... }): session.reset `
            + `'relaunch' relaunches the app under test between tests and needs it. Add "appium:bundleId" to the file, or set session.reset to 'none'.`,
        );
        const androidMissing = writeFile('nested-none-android.json', JSON.stringify({ platformName: 'Android' }));
        expect(errorOf(() => prepareSession('android', { capabilities: androidMissing }, {})).message)
            .toContain(`has no "appium:appPackage" (nor "appium:options": { "appPackage": ... })`);
    });

    test('unprefixed bundleId / appPackage are not the app id (only the appium: keys name the app)', () => {
        const ios = writeFile('unprefixed-ios.json', JSON.stringify({ platformName: 'iOS', bundleId: 'com.example.app' }));
        expect(errorOf(() => prepareSession('ios', { capabilities: ios }, {})).message).toContain('has no "appium:bundleId"');
        const android = writeFile('unprefixed-android.json', JSON.stringify({ platformName: 'Android', appPackage: 'com.example.app' }));
        expect(errorOf(() => prepareSession('android', { capabilities: android }, {})).message).toContain('has no "appium:appPackage"');
    });

    test('a file with browserName must set "wdio:enforceWebDriverClassic": true (WebdriverIO would add BiDi keys)', () => {
        for (const extra of [{}, { 'wdio:enforceWebDriverClassic': false }, { 'wdio:enforceWebDriverClassic': 'true' }]) {
            const file = writeFile('browser.json', JSON.stringify({
                platformName: 'Android', browserName: 'Chrome', 'appium:automationName': 'UiAutomator2', ...extra,
            }));
            const err = errorOf(() => prepareSession('android', { capabilities: file, reset: 'none' }, {}));
            expect(err.message).toContain(`Capabilities file "${file}" sets "browserName" but not "wdio:enforceWebDriverClassic": true.`);
            expect(err.message).toContain('webSocketUrl, unhandledPromptBehavior');
            expect(err.message).toContain('Add "wdio:enforceWebDriverClassic": true to the file: it stops WebdriverIO adding those keys.');
        }
        const ok = writeFile('browser-classic.json', JSON.stringify({
            platformName: 'Android', browserName: 'Chrome', 'wdio:enforceWebDriverClassic': true,
        }));
        expect(prepareSession('android', { capabilities: ok, reset: 'none' }, {}).context.capabilities)
            .toStrictEqual({ platformName: 'Android', browserName: 'Chrome', 'wdio:enforceWebDriverClassic': true });
    });

    test('an unknown reset value is refused', () => {
        expect(errorOf(() => prepareSession('ios', { capabilities: IOS_EXAMPLE, reset: 'always' as never }, {})).message)
            .toBe(`session.reset must be 'relaunch' or 'none', got "always".`);
    });

    test('macos and windows are declared but not implemented', () => {
        for (const platform of ['macos', 'windows'] as const) {
            expect(errorOf(() => prepareSession(platform, { capabilities: IOS_EXAMPLE }, {})).message)
                .toBe(`Platform "${platform}" is declared but not implemented yet.`);
        }
    });

    test('web has no session', () => {
        expect(errorOf(() => prepareSession('web', {}, {})).message).toMatch(/runs on Playwright/);
    });
});
