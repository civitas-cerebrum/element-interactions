import { test as base, expect } from '@playwright/test';
import * as fs from 'fs';
import { PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';
import { baseFixture, resolvePlatform } from '../src/fixture/BaseFixture';
import { PlatformInteractions } from '../src/fixture/PlatformInteractions';
import { AppiumInteractions, AppiumVerifications, AppiumGestures, AppiumDevice } from '../src/appium';
import { expectNotSupported } from './appium/mocks';
import { appCommands, fakeSession } from './fixture-platform/fakeSession';

const REPO = 'tests/fixture-platform/page-repository.json';
const CAPS = 'tests/capabilities/ios.example.json';

const fake = fakeSession();
let sessionStartedHook = 0;

const test = baseFixture(base, REPO, {
    platform: 'ios',
    timeout: 2000,
    repoTimeout: 1000,
    session: {
        capabilities: CAPS,
        provider: fake.provider,
        onSessionStarted: async (driver) => {
            expect(driver).toBe(fake.driver);
            sessionStartedHook++;
        },
    },
});

// Any browser launch in this file fails: the platform fixtures must not start one.
test.use({ launchOptions: { executablePath: '/nonexistent/browser' } });

/** `mobile: terminateApp` then `mobile: activateApp` once per test so far (relaunch before every test). */
function expectRelaunches(n: number) {
    const commands = appCommands(fake.calls).filter(c => c === 'mobile: terminateApp' || c === 'mobile: activateApp');
    expect(commands).toEqual(Array.from({ length: n }, () => ['mobile: terminateApp', 'mobile: activateApp']).flat());
}

test.describe.serial('baseFixture on ios (mock session)', () => {
    test('driver, repo, steps, interactions and contextStore work on the session', async ({ driver, repo, steps, interactions, contextStore }) => {
        expect(driver).toBe(fake.driver);
        expect(repo.platform).toBe('ios');
        expect(repo.driver).toBe(fake.driver);

        await steps.click('submit', 'LoginPage');
        expect(fake.calls.some(c => c[0] === 'el.click' && c[1] === '~login-submit')).toBe(true);
        await steps.verifyText('title', 'LoginPage', 'Sign in');

        expect(interactions).toBeInstanceOf(PlatformInteractions);
        const platformInteractions = interactions as unknown as PlatformInteractions;
        expect(platformInteractions.interact).toBeInstanceOf(AppiumInteractions);
        expect(platformInteractions.verify).toBeInstanceOf(AppiumVerifications);
        expect(platformInteractions.gestures).toBeInstanceOf(AppiumGestures);
        expect(platformInteractions.device).toBeInstanceOf(AppiumDevice);
        expect(platformInteractions.email).toBeNull();
        await expectNotSupported(() => platformInteractions.request, 'request', 'ios');

        contextStore.put('key', 'value');
        expect(contextStore.get('key')).toBe('value');
    });

    test('the session started once, with exactly the capabilities file, and onSessionStarted ran once', async ({ driver }) => {
        expect(driver).toBe(fake.driver);
        expect(fake.starts).toHaveLength(1);
        expect(sessionStartedHook).toBe(1);
        expect(fake.starts[0].platform).toBe('ios');
        expect(fake.starts[0].capabilities).toStrictEqual(JSON.parse(fs.readFileSync(CAPS, 'utf-8')));
        expect(fake.stops).toBe(0);
    });

    test('the app is relaunched (terminate + activate) before every test, the first included', async () => {
        expectRelaunches(3);
        const relaunch = fake.calls.filter(c => c[0] === 'execute' && c[1] === 'mobile: terminateApp');
        expect(relaunch[0][2]).toEqual({ bundleId: 'com.example.app' });
    });

    test('a test that asks for nothing still gets the relaunch (auto fixture)', async () => {
        expectRelaunches(4);
    });

    test('a web-only step throws PlatformNotSupportedError', async ({ steps }) => {
        await expectNotSupported(() => steps.navigateTo('/'), 'navigateTo', 'ios');
        await expectNotSupported(() => steps.hover('submit', 'LoginPage'), 'hover', 'ios');
    });

    test('the family members act on the worker session with the app id from the file', async ({ interactions }) => {
        const device = (interactions as unknown as PlatformInteractions).device;
        await device.terminateApp();
        const last = fake.calls.filter(c => c[0] === 'execute').at(-1)!;
        expect(last.slice(1)).toEqual(['mobile: terminateApp', { bundleId: 'com.example.app' }]);
        expect(fake.starts).toHaveLength(1);
    });
});

test.describe('platform resolution and web-only options', () => {
    test('resolvePlatform: option, else PLATFORM, else web; bad values name their source', () => {
        expect(resolvePlatform(undefined, {})).toBe('web');
        expect(resolvePlatform(undefined, { PLATFORM: 'android' })).toBe('android');
        expect(resolvePlatform('ios', { PLATFORM: 'android' })).toBe('ios');
        expect(() => resolvePlatform(undefined, { PLATFORM: 'mobile' }))
            .toThrow('PLATFORM is "mobile", which is not a platform. Expected one of: web, android, ios, macos, windows.');
        expect(() => resolvePlatform('iOS', {}))
            .toThrow('baseFixture option "platform" is "iOS", which is not a platform.');
        expect(() => resolvePlatform(undefined, { PLATFORM: '' })).toThrow('PLATFORM is "", which is not a platform.');
    });

    test('baseFixture reads PLATFORM when the option is absent', () => {
        const saved = process.env.PLATFORM;
        process.env.PLATFORM = 'nonsense';
        try {
            expect(() => baseFixture(base, REPO)).toThrow(/PLATFORM is "nonsense"/);
        } finally {
            if (saved === undefined) delete process.env.PLATFORM; else process.env.PLATFORM = saved;
        }
    });

    test('web-only options throw on a platform run, naming each', () => {
        const session = { capabilities: CAPS, provider: fake.provider };
        expect(() => baseFixture(base, REPO, { platform: 'ios', session, blockedOrigins: /x/ }))
            .toThrow('baseFixture: blockedOrigins is web-only and cannot be honoured on platform "ios".');
        expect(() => baseFixture(base, REPO, { platform: 'android', session, mutationInjection: true, interceptionRetry: false }))
            .toThrow('baseFixture: mutationInjection, interceptionRetry are web-only and cannot be honoured on platform "android".');
        expect(() => baseFixture(base, REPO, { platform: 'ios', session, screenshotOnFailure: { fullPage: true } }))
            .toThrow(/screenshotOnFailure \(\{ fullPage \}\) is web-only/);
        expect(() => baseFixture(base, REPO, { platform: 'ios', session, mutationInjection: false, screenshotOnFailure: false })).not.toThrow();
    });

    test('macos / windows build a fixture; the session start is what refuses them', () => {
        expect(() => baseFixture(base, REPO, { platform: 'macos' })).not.toThrow();
        expect(PlatformNotSupportedError).toBeDefined();
    });
});
