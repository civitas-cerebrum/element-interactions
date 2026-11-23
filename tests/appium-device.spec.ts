import { test, expect } from '@playwright/test';
import { buildTouchSwipe, PlatformNotSupportedError, SWIPE_HOLD_MS, SWIPE_MOVE_MS } from '@civitas-cerebrum/element-repository';
import type { IDevice } from '../src/interfaces';
import {
    AppiumDevice,
    AppiumFactory,
    strategyFor,
    appIdFromCapabilities,
    appIdFromSession,
    androidStrategy,
    iosStrategy,
    macosStrategy,
    windowsStrategy,
} from '../src/appium';
import { MissingAppIdError } from '../src/appium/AppiumDevice';
import { STRATEGY_METHODS } from '../src/appium/platform/notImplemented';
import { IOS_SWIPE_INSET } from '../src/appium/platform/ios';
import { ANDROID_SWIPE_INSET } from '../src/appium/platform/android';
import { MIN_SWIPE_DISTANCE, touchSwipe } from '../src/appium/touch';
import { mockDriver, mockElement, expectNotSupported, methodsOf, screenSwipes, swipeActions, WINDOW, type Call } from './appium/mocks';

/**
 * Pure unit tests for the platform strategies and AppiumDevice over a mock
 * WebdriverIO session: no device, no Appium server, no browser.
 */

const APP = { android: 'com.example.app', ios: 'com.example.App' } as const;
const CAPS = {
    android: { platformName: 'Android', 'appium:appPackage': APP.android },
    ios: { platformName: 'iOS', 'appium:bundleId': APP.ios },
} as const;

/** What each device call must send to the driver, per platform. */
type Expectation = { call: (d: IDevice) => Promise<unknown>; android: Call[] | 'unsupported'; ios: Call[] | 'unsupported' };

const OTHER = 'org.example.other';

const EXPECTED: Record<string, Expectation> = {
    launchApp: {
        call: d => d.launchApp(),
        android: [['execute', 'mobile: activateApp', { appId: APP.android }]],
        ios: [['execute', 'mobile: launchApp', { bundleId: APP.ios }]],
    },
    activateApp: {
        call: d => d.activateApp(OTHER),
        android: [['execute', 'mobile: activateApp', { appId: OTHER }]],
        ios: [['execute', 'mobile: activateApp', { bundleId: OTHER }]],
    },
    terminateApp: {
        call: d => d.terminateApp(),
        android: [['execute', 'mobile: terminateApp', { appId: APP.android }]],
        ios: [['execute', 'mobile: terminateApp', { bundleId: APP.ios }]],
    },
    backgroundApp: {
        call: d => d.backgroundApp(3),
        android: [['execute', 'mobile: backgroundApp', { seconds: 3 }]],
        ios: [['execute', 'mobile: backgroundApp', { seconds: 3 }]],
    },
    resetApp: {
        call: d => d.resetApp(),
        android: [
            ['execute', 'mobile: terminateApp', { appId: APP.android }],
            ['execute', 'mobile: activateApp', { appId: APP.android }],
        ],
        ios: [
            ['execute', 'mobile: terminateApp', { bundleId: APP.ios }],
            ['execute', 'mobile: activateApp', { bundleId: APP.ios }],
        ],
    },
    installApp: {
        call: d => d.installApp('/tmp/build/app.bin'),
        android: [['execute', 'mobile: installApp', { appPath: '/tmp/build/app.bin' }]],
        ios: [['execute', 'mobile: installApp', { app: '/tmp/build/app.bin' }]],
    },
    removeApp: {
        call: d => d.removeApp(OTHER),
        android: [['execute', 'mobile: removeApp', { appId: OTHER }]],
        ios: [['execute', 'mobile: removeApp', { bundleId: OTHER }]],
    },
    openDeepLink: {
        call: d => d.openDeepLink('example://home'),
        android: [['execute', 'mobile: deepLink', { url: 'example://home', package: APP.android }]],
        ios: [['execute', 'mobile: deepLink', { url: 'example://home', bundleId: APP.ios }]],
    },
    isAppInForeground: {
        call: d => d.isAppInForeground(),
        android: [['execute', 'mobile: queryAppState', { appId: APP.android }]],
        ios: [['execute', 'mobile: queryAppState', { bundleId: APP.ios }]],
    },
    pressBack: {
        call: d => d.pressBack(),
        android: [['back']],
        ios: 'unsupported',
    },
    hideKeyboard: {
        call: d => d.hideKeyboard(),
        android: [['execute', 'mobile: hideKeyboard', {}]],
        ios: [['execute', 'mobile: hideKeyboard', {}]],
    },
    isKeyboardShown: {
        call: d => d.isKeyboardShown(),
        android: [['execute', 'mobile: isKeyboardShown', {}]],
        ios: [['execute', 'mobile: isKeyboardShown', {}]],
    },
    getOrientation: {
        call: d => d.getOrientation(),
        android: [['getOrientation']],
        ios: [['getOrientation']],
    },
    setOrientation: {
        call: d => d.setOrientation('landscape'),
        android: [['setOrientation', 'LANDSCAPE']],
        ios: [['setOrientation', 'LANDSCAPE']],
    },
    acceptAlert: {
        call: d => d.acceptAlert(),
        android: [['acceptAlert']],
        ios: [['execute', 'mobile: alert', { action: 'accept' }]],
    },
    dismissAlert: {
        call: d => d.dismissAlert(),
        android: [['dismissAlert']],
        ios: [['execute', 'mobile: alert', { action: 'dismiss' }]],
    },
    setPermission: {
        call: d => d.setPermission('camera-permission', 'grant'),
        android: [['execute', 'mobile: changePermissions', { permissions: ['camera-permission'], appPackage: APP.android, action: 'grant' }]],
        ios: [['execute', 'mobile: setPermission', { bundleId: APP.ios, access: { 'camera-permission': 'yes' } }]],
    },
    getContexts: {
        call: d => d.getContexts(),
        android: [['getAppiumContexts']],
        ios: [['getAppiumContexts']],
    },
    getContext: {
        call: d => d.getContext(),
        android: [['getAppiumContext']],
        ios: [['getAppiumContext']],
    },
    switchContext: {
        call: d => d.switchContext('WEBVIEW_1'),
        android: [['switchAppiumContext', 'WEBVIEW_1']],
        ios: [['switchAppiumContext', 'WEBVIEW_1']],
    },
    getPageSource: {
        call: d => d.getPageSource(),
        android: [['getPageSource']],
        ios: [['getPageSource']],
    },
};

test.describe('strategyFor', () => {
    test('returns one strategy per Appium-family platform', () => {
        expect(strategyFor('android')).toBe(androidStrategy);
        expect(strategyFor('ios')).toBe(iosStrategy);
        expect(strategyFor('macos')).toBe(macosStrategy);
        expect(strategyFor('windows')).toBe(windowsStrategy);
        for (const p of ['android', 'ios', 'macos', 'windows'] as const) expect(strategyFor(p).platform).toBe(p);
    });

    test('throws for web and for a value that is not a platform', () => {
        expect(() => strategyFor('web')).toThrow(/not in the Appium family/);
        expect(() => strategyFor('mobile' as never)).toThrow();
    });

    test('app id capability keys are the appium: keys per platform', () => {
        expect(androidStrategy.appIdCapability).toBe('appium:appPackage');
        expect(iosStrategy.appIdCapability).toBe('appium:bundleId');
        expect(macosStrategy.appIdCapability).toBe('appium:bundleId');
        expect(windowsStrategy.appIdCapability).toBe('appium:app');
    });

    test('focus attribute, and the unsupported list', () => {
        expect(androidStrategy.focusedAttribute).toBe('focused');
        expect(iosStrategy.focusedAttribute).toBeNull();
        expect(androidStrategy.unsupported).toEqual([]);
        expect(iosStrategy.unsupported).toEqual(['pressBack']);
        expect(androidStrategy.implemented).toBe(true);
        expect(iosStrategy.implemented).toBe(true);
        expect(macosStrategy.implemented).toBe(false);
        expect(windowsStrategy.implemented).toBe(false);
    });
});

test.describe('appIdFromCapabilities', () => {
    test('reads the platform key, top-level or in the nested appium:options form; top-level wins', () => {
        expect(appIdFromCapabilities('android', CAPS.android)).toBe(APP.android);
        expect(appIdFromCapabilities('ios', CAPS.ios)).toBe(APP.ios);
        expect(appIdFromCapabilities('windows', { 'appium:app': 'Example!App' })).toBe('Example!App');
        expect(appIdFromCapabilities('ios', { 'appium:options': { bundleId: 'com.example.Nested' } })).toBe('com.example.Nested');
        expect(appIdFromCapabilities('android', { 'appium:options': { appPackage: 'com.example.nested' } })).toBe('com.example.nested');
        expect(appIdFromCapabilities('windows', { 'appium:options': { app: 'Nested!App' } })).toBe('Nested!App');
        expect(appIdFromCapabilities('ios', { 'appium:bundleId': 'com.example.Top', 'appium:options': { bundleId: 'com.example.Nested' } }))
            .toBe('com.example.Top');
    });

    test('unprefixed keys are not read (only the appium: keys name the app)', () => {
        expect(appIdFromCapabilities('ios', { bundleId: 'com.example.Echo' })).toBeUndefined();
        expect(appIdFromCapabilities('android', { appPackage: 'com.example.echo' })).toBeUndefined();
        expect(appIdFromCapabilities('ios', { 'appium:options': { 'appium:bundleId': 'x' } })).toBeUndefined();
        expect(appIdFromCapabilities('ios', { 'appium:options': 'com.example.app' })).toBeUndefined();
        expect(appIdFromCapabilities('ios', { 'appium:options': { bundleId: '' } })).toBeUndefined();
    });

    test('never reads another platform\'s key; undefined when absent or empty', () => {
        expect(appIdFromCapabilities('android', CAPS.ios)).toBeUndefined();
        expect(appIdFromCapabilities('ios', CAPS.android)).toBeUndefined();
        expect(appIdFromCapabilities('ios', { 'appium:bundleId': '' })).toBeUndefined();
        expect(appIdFromCapabilities('ios', undefined)).toBeUndefined();
    });
});

for (const platform of ['android', 'ios'] as const) {
    test.describe(`AppiumDevice on ${platform}`, () => {
        const build = (appId?: string) => {
            const mock = mockDriver({ capabilities: CAPS[platform] });
            const device = new AppiumFactory(mock.driver, platform, appId ? { appId } : {}).createDevice();
            return { ...mock, device };
        };

        for (const [method, expectation] of Object.entries(EXPECTED)) {
            const expected = expectation[platform];
            if (expected === 'unsupported') {
                test(`${method} throws PlatformNotSupportedError and sends nothing`, async () => {
                    const { device, calls } = build();
                    await expectNotSupported(() => expectation.call(device), method, platform);
                    expect(calls).toEqual([]);
                });
            } else {
                test(`${method} sends ${expected.map(c => c[1] ?? c[0]).join(' + ')}`, async () => {
                    const { device, calls } = build();
                    await expectation.call(device);
                    expect(calls).toEqual(expected);
                });
            }
        }

        test('every IDevice method is covered by the table', () => {
            // The two queries send nothing; the polling assertions are covered in appium-entry.spec.ts.
            const notInTable = ['requireImplemented', 'supports', 'resolveAppId', 'pollDevice',
                'verifyAppInForeground', 'verifyOrientation', 'verifyKeyboardShown', 'verifyContext'];
            expect(methodsOf(AppiumDevice, notInTable)).toEqual(Object.keys(EXPECTED).sort());
        });

        test('the factory appId option wins over the capabilities', async () => {
            const { device, calls } = build('com.example.override');
            await device.terminateApp();
            const key = platform === 'android' ? 'appId' : 'bundleId';
            expect(calls).toEqual([['execute', 'mobile: terminateApp', { [key]: 'com.example.override' }]]);
        });

        test('an app-id call without any app id fails, naming the capability key', async () => {
            const mock = mockDriver({ capabilities: { platformName: platform } });
            const device = new AppiumFactory(mock.driver, platform).createDevice();
            const key = strategyFor(platform).appIdCapability;
            for (const call of [() => device.resetApp(), () => device.launchApp(), () => device.isAppInForeground(), () => device.setPermission('p', 'deny')]) {
                await expect(call()).rejects.toThrow(`set "${key}" in the capabilities file`);
            }
            expect(mock.calls).toEqual([]);
        });

        test('the factory reads the app id from a live session\'s capabilities (prefix stripped, file forms first)', async () => {
            const key = strategyFor(platform).appIdCapability;
            const bare = key.replace(/^appium:/, '');
            const appIdOf = (capabilities: Record<string, unknown>) =>
                new AppiumFactory(mockDriver({ capabilities }).driver, platform).appId;
            // What Appium returns for a session: unprefixed keys.
            expect(appIdOf({ platformName: platform, [bare]: 'com.example.session' })).toBe('com.example.session');
            // The capabilities-file forms, top level and inside appium:options, win over the bare key.
            expect(appIdOf({ [key]: 'com.example.top', [bare]: 'com.example.session' })).toBe('com.example.top');
            expect(appIdOf({ 'appium:options': { [bare]: 'com.example.nested' }, [bare]: 'com.example.session' })).toBe('com.example.nested');
            // Empty or non-string values are no app id.
            expect(appIdOf({ [bare]: '' })).toBeUndefined();
            expect(appIdOf({ [bare]: 42 })).toBeUndefined();
            expect(appIdOf({})).toBeUndefined();
            // The exported helper is the same rule.
            expect(appIdFromSession(platform, { [bare]: 'com.example.session' })).toBe('com.example.session');
            expect(appIdFromSession(platform, undefined)).toBeUndefined();
            // The other platform's key is not this platform's app id.
            const otherBare = strategyFor(platform === 'android' ? 'ios' : 'android').appIdCapability.replace(/^appium:/, '');
            expect(appIdOf({ [otherBare]: 'com.example.other' })).toBeUndefined();
        });

        test('MissingAppIdError is exported from the package entry points', async () => {
            const root = await import('../src/index');
            const appium = await import('../src/appium');
            expect(root.MissingAppIdError).toBe(MissingAppIdError);
            expect(appium.MissingAppIdError).toBe(MissingAppIdError);
        });

        test('a missing app id is a MissingAppIdError naming the caller and the capability key', async () => {
            const mock = mockDriver({ capabilities: { platformName: platform } });
            const device = new AppiumFactory(mock.driver, platform).createDevice() as AppiumDevice;
            const key = strategyFor(platform).appIdCapability;
            const error = await device.isAppInForeground().catch((e: unknown) => e);
            expect(error).toBeInstanceOf(MissingAppIdError);
            const bare = key.replace(/^appium:/, '');
            expect((error as MissingAppIdError).message).toBe(
                `isAppInForeground: no app id. Pass one, or set "${key}" in the capabilities file `
                + `(top level, or "${bare}" inside "appium:options") for platform "${platform}".`,
            );
            expect((error as MissingAppIdError).capability).toBe(key);
            expect(() => device.resolveAppId('verifyAppInForeground')).toThrow(/^verifyAppInForeground: no app id\./);
            expect(device.resolveAppId('x', 'com.example.given')).toBe('com.example.given');
            expect(mock.calls).toEqual([]);
        });

        test('supports() follows the strategy\'s unsupported list', () => {
            const device = build().device as AppiumDevice;
            expect(device.supports('pressBack')).toBe(platform === 'android');
            expect(device.supports('hideKeyboard')).toBe(true);
        });

        test('openDeepLink without any app id sends the url alone', async () => {
            const mock = mockDriver({ capabilities: { platformName: platform } });
            await new AppiumFactory(mock.driver, platform).createDevice().openDeepLink('example://x');
            expect(mock.calls).toEqual([['execute', 'mobile: deepLink', { url: 'example://x' }]]);
        });

        test('isAppInForeground is true only for queryAppState 4', async () => {
            const { device, executeResults } = build();
            for (const [state, expected] of [[4, true], [3, false], [1, false], [0, false]] as const) {
                executeResults['mobile: queryAppState'] = state;
                expect(await device.isAppInForeground()).toBe(expected);
            }
        });

        test('isKeyboardShown returns the driver answer as a boolean', async () => {
            const { device, executeResults } = build();
            executeResults['mobile: isKeyboardShown'] = true;
            expect(await device.isKeyboardShown()).toBe(true);
            executeResults['mobile: isKeyboardShown'] = false;
            expect(await device.isKeyboardShown()).toBe(false);
        });

        test('orientation is normalised to lower case and validated', async () => {
            const landscape = mockDriver({ capabilities: CAPS[platform], orientation: 'LANDSCAPE' });
            expect(await new AppiumFactory(landscape.driver, platform).createDevice().getOrientation()).toBe('landscape');
            const odd = mockDriver({ capabilities: CAPS[platform], orientation: 'UPSIDE_DOWN' });
            await expect(new AppiumFactory(odd.driver, platform).createDevice().getOrientation()).rejects.toThrow(/unknown orientation/);
            const { device, calls } = build();
            await expect(device.setOrientation('sideways' as never)).rejects.toThrow(/'portrait' or 'landscape'/);
            expect(calls).toEqual([]);
        });

        test('contexts come back as names, also from detailed context objects', async () => {
            const mock = mockDriver({ capabilities: CAPS[platform], contexts: ['NATIVE_APP', { id: 'WEBVIEW_7' }], context: { id: 'WEBVIEW_7' } });
            const device = new AppiumFactory(mock.driver, platform).createDevice();
            expect(await device.getContexts()).toEqual(['NATIVE_APP', 'WEBVIEW_7']);
            expect(await device.getContext()).toBe('WEBVIEW_7');
        });

        test('setPermission maps grant / deny / reset to the platform\'s values', async () => {
            const { device, calls } = build();
            await device.setPermission('perm', 'grant');
            await device.setPermission('perm', 'deny');
            await device.setPermission('perm', 'reset');
            const sent = calls.map(c => c[2] as Record<string, unknown>);
            if (platform === 'android') {
                expect(sent.map(a => a.action)).toEqual(['grant', 'revoke', 'revoke']);
            } else {
                expect(sent.map(a => (a.access as Record<string, string>).perm)).toEqual(['yes', 'no', 'unset']);
            }
        });

        test('arguments are validated before anything is sent', async () => {
            const { device, calls } = build();
            await expect(device.backgroundApp(-1)).rejects.toThrow(/non-negative/);
            await expect(device.installApp('')).rejects.toThrow(/appPath is required/);
            await expect(device.removeApp('')).rejects.toThrow(/appId is required/);
            await expect(device.openDeepLink('')).rejects.toThrow(/url is required/);
            await expect(device.switchContext('')).rejects.toThrow(/context name is required/);
            await expect(device.setPermission('', 'grant')).rejects.toThrow(/permission is required/);
            await expect(device.setPermission('p', 'maybe' as never)).rejects.toThrow(/'grant', 'deny' or 'reset'/);
            expect(calls).toEqual([]);
        });

        test('a driver error propagates (nothing is swallowed)', async () => {
            const { device, driver } = build();
            (driver as unknown as { execute: () => Promise<never> }).execute = async () => { throw new Error('An unknown server-side error occurred'); };
            await expect(device.hideKeyboard()).rejects.toThrow('An unknown server-side error occurred');
        });
    });
}

for (const platform of ['macos', 'windows'] as const) {
    test.describe(`${platform} (declared, not implemented)`, () => {
        const message = `Platform "${platform}" is declared but not implemented yet.`;

        test('the factory refuses the platform', () => {
            const { driver } = mockDriver();
            expect(() => new AppiumFactory(driver, platform)).toThrow(message);
        });

        test('every strategy method throws not-implemented', async () => {
            const { driver } = mockDriver();
            const strategy = strategyFor(platform) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
            for (const method of STRATEGY_METHODS) {
                await expect(strategy[method](driver, 'x', 'y', 'z'), method).rejects.toThrow(message);
            }
        });

        test('every IDevice method throws not-implemented and sends nothing', async () => {
            const { driver, calls } = mockDriver();
            const device = new AppiumDevice(driver, strategyFor(platform), 'com.example.app');
            for (const [method, { call }] of Object.entries(EXPECTED)) {
                await expect(call(device), method).rejects.toThrow(message);
            }
            expect(calls).toEqual([]);
        });
    });
}

test.describe('screen swipes through the platform strategy', () => {
    // WINDOW is 400x800. Both platforms send element-repository's W3C touch swipe (`performTouchSwipe`):
    // move instantly to the start, finger down, 100 ms hold, 600 ms move to the end, finger up, release.
    // The swipe is centred on the window centre inside the window minus the platform inset.

    test('the swipe timings are element-repository\'s (hold 100 ms, move 600 ms)', () => {
        expect(SWIPE_HOLD_MS).toBe(100);
        expect(SWIPE_MOVE_MS).toBe(600);
        expect(MIN_SWIPE_DISTANCE).toBe(10);
        expect(ANDROID_SWIPE_INSET).toEqual({ x: 0.1, y: 0.2 });
        expect(IOS_SWIPE_INSET).toEqual({ x: 0.1, y: 0.15 });
        expect(Object.isFrozen(ANDROID_SWIPE_INSET) && Object.isFrozen(IOS_SWIPE_INSET)).toBe(true);
    });

    for (const strategy of [androidStrategy, iosStrategy]) {
        const { platform } = strategy;
        test(`${platform}: exact W3C touch sequence per swipe, released after each, no mobile: command`, async () => {
            const { driver, calls } = mockDriver();
            await strategy.swipeScreen(driver, 'up', 240);
            await strategy.swipeScreen(driver, 'left');
            await strategy.swipeScreen(driver, 'down');
            await strategy.swipeScreen(driver, 'right', 5000);
            expect(calls.map(c => c[0])).toEqual(Array(4).fill(['performActions', 'releaseActions']).flat());
            expect(calls.filter(c => c[0] === 'execute')).toEqual([]);
            // exactly element-repository's buildTouchSwipe payload, sent through its performTouchSwipe
            expect(calls[0]).toEqual(['performActions', buildTouchSwipe({ x: 200, y: 520 }, { x: 200, y: 280 })]);
            expect(calls[0][1]).toEqual([{
                type: 'pointer',
                id: 'finger1',
                parameters: { pointerType: 'touch' },
                actions: swipeActions({ x: 200, y: 520 }, { x: 200, y: 280 }),
            }]);
            expect(screenSwipes(calls).map(({ from, to }) => [from, to])).toEqual([
                // up 240 px, centred on y = 400
                [{ x: 200, y: 520 }, { x: 200, y: 280 }],
                // default: half the width, centred on x = 200
                [{ x: 300, y: 400 }, { x: 100, y: 400 }],
                // default: half the height, centred on y = 400
                [{ x: 200, y: 200 }, { x: 200, y: 600 }],
                // shortened to the safe width: x in [40, 359]
                [{ x: 40, y: 400 }, { x: 359, y: 400 }],
            ]);
        });

        test(`${platform}: a long vertical swipe is shortened to the safe area`, async () => {
            const { driver, calls } = mockDriver();
            await strategy.swipeScreen(driver, 'down', 5000);
            await strategy.swipeScreen(driver, 'up', 5000);
            const [down, up] = screenSwipes(calls);
            // android keeps 20 % clear top and bottom (y in [160, 639]); ios 15 % (y in [120, 679])
            const [lo, hi] = platform === 'android' ? [160, 639] : [120, 679];
            expect(down).toMatchObject({ from: { x: 200, y: lo }, to: { x: 200, y: hi }, direction: 'down', distance: hi - lo });
            expect(up).toMatchObject({ from: { x: 200, y: hi }, to: { x: 200, y: lo }, direction: 'up', distance: hi - lo });
        });

        test(`${platform}: a swipe shorter than ${MIN_SWIPE_DISTANCE} px is refused and sends nothing`, async () => {
            const { driver, calls } = mockDriver();
            await expect(strategy.swipeScreen(driver, 'up', 9.4)).rejects.toThrow(/at least 10 px/);
            await expect(strategy.swipeScreen(driver, 'left', 0)).rejects.toThrow(/at least 10 px/);
            expect(calls).toEqual([]);
        });

        test(`${platform}: the touch actions are released when the swipe fails`, async () => {
            const { driver, calls } = mockDriver();
            (driver as unknown as { performActions: () => Promise<never> }).performActions = async () => { throw new Error('boom'); };
            await expect(strategy.swipeScreen(driver, 'up', 200)).rejects.toThrow('boom');
            expect(calls.map(c => c[0])).toEqual(['releaseActions']);
        });
    }

    test('touchSwipe clamps both points inside the window and refuses a swipe that would not move', async () => {
        const { driver, calls } = mockDriver();
        await touchSwipe(driver, { x: 200.4, y: 400 }, { x: 200, y: -50 }, WINDOW);
        await touchSwipe(driver, { x: -5, y: 300 }, { x: 900, y: 300 }, WINDOW);
        expect(screenSwipes(calls).map(({ from, to }) => [from, to])).toEqual([
            [{ x: 200, y: 400 }, { x: 200, y: 0 }],
            [{ x: 0, y: 300 }, { x: WINDOW.width - 1, y: 300 }],
        ]);
        calls.length = 0;
        // Both points clamp onto the bottom row: zero length.
        await expect(touchSwipe(driver, { x: 200, y: 900 }, { x: 200, y: 1200 }, WINDOW)).rejects.toThrow(/would move only 0 px/);
        await expect(touchSwipe(driver, { x: 200, y: 400 }, { x: 204, y: 404 }, WINDOW)).rejects.toThrow(/at least 10 px/);
        expect(calls).toEqual([]);
    });
});

test('STRATEGY_METHODS lists every method of the android and ios strategies', () => {
    const methodNames = (s: object) => Object.entries(s).filter(([, v]) => typeof v === 'function').map(([k]) => k).sort();
    expect(methodNames(androidStrategy)).toEqual([...STRATEGY_METHODS].sort());
    expect(methodNames(iosStrategy)).toEqual([...STRATEGY_METHODS].sort());
});

test('each strategy\'s unsupported list is exactly the methods that throw PlatformNotSupportedError', async () => {
    for (const strategy of [androidStrategy, iosStrategy]) {
        const { driver } = mockDriver();
        const methods = strategy as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
        const refusing: string[] = [];
        for (const method of STRATEGY_METHODS) {
            const args = method === 'setPermission' ? [driver, 'camera', 'grant', 'com.example.app'] : [driver, 'com.example.app'];
            const error = await methods[method](...args).then(() => undefined, (e: unknown) => e);
            if (error instanceof PlatformNotSupportedError) {
                expect(error.platform, `${strategy.platform}.${method}`).toBe(strategy.platform);
                expect(error.method).toBe(method);
                refusing.push(method);
            } else {
                expect(error, `${strategy.platform}.${method} should not throw with a working driver`).toBeUndefined();
            }
        }
        expect(refusing.sort(), strategy.platform).toEqual([...strategy.unsupported].sort());
    }
    // a not-implemented strategy refuses everything with the not-implemented error, so it lists nothing as unsupported
    expect(macosStrategy.unsupported).toEqual([]);
    expect(windowsStrategy.unsupported).toEqual([]);
});

test('the strategy objects and their unsupported lists are frozen', () => {
    for (const strategy of [androidStrategy, iosStrategy, macosStrategy, windowsStrategy]) {
        expect(Object.isFrozen(strategy), strategy.platform).toBe(true);
        expect(Object.isFrozen(strategy.unsupported), `${strategy.platform}.unsupported`).toBe(true);
        expect(() => { (strategy as { implemented: boolean }).implemented = !strategy.implemented; }).toThrow(TypeError);
        expect(() => { (strategy.unsupported as string[]).push('launchApp'); }).toThrow(TypeError);
    }
});

test('the factory refuses web', () => {
    const { driver } = mockDriver();
    expect(() => new AppiumFactory(driver, 'web')).toThrow(/not in the Appium family/);
});

// ─── Visible text: the element's own textContent ──────────────────────────

/**
 * The Appium family reads visible text only through element-repository's
 * `Element.textContent` (where the iOS label-first rule lives); it never reads
 * the `label` / `value` / `type` attributes itself. The label-first rule over
 * a real `PlatformElement` is covered through Steps in platform-paths.spec.ts.
 */
test.describe('the Appium family reads visible text through Element.textContent', () => {
    function textElement(text: string) {
        const reads: string[] = [];
        const el = mockElement({ text, attributes: { label: 'not the text', value: 'nor this', type: 'XCUIElementTypeButton' } });
        const getAttribute = el.getAttribute.bind(el);
        (el as { getAttribute: (name: string) => Promise<string | null> }).getAttribute = async (name: string) => {
            reads.push(name);
            return getAttribute(name);
        };
        return { el, reads };
    }

    for (const platform of ['android', 'ios'] as const) {
        test(`${platform}: verifications, extractions and getByText use textContent, no text attribute`, async () => {
            const factory = new AppiumFactory(mockDriver().driver, platform, { timeout: 300 });
            const { el, reads } = textElement('  General ');
            await factory.createVerifications().text(el, 'General');
            expect(await factory.createExtractions().getText(el)).toBe('General');
            expect(await factory.createExtractions().getAllTexts(mockElement({ children: [el] }))).toEqual(['General']);
            expect(await factory.createInteractions().getByText(mockElement({ children: [el] }), 'General')).toBe(el);
            expect(reads.filter(r => r === 'label' || r === 'value' || r === 'type')).toEqual([]);
        });
    }
});
