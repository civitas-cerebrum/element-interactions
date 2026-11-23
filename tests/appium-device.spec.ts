import { test, expect } from '@playwright/test';
import { PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';
import type { IDevice } from '../src/interfaces';
import {
    AppiumDevice,
    AppiumFactory,
    strategyFor,
    appIdFromCapabilities,
    androidStrategy,
    iosStrategy,
    macosStrategy,
    windowsStrategy,
} from '../src/appium';
import { STRATEGY_METHODS } from '../src/appium/platform/notImplemented';
import { mockDriver, expectNotSupported, methodsOf, type Call } from './appium/mocks';

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

    test('app id capability keys follow CONTRACT B1', () => {
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
    test('reads the platform key, prefixed or as Appium echoes it unprefixed', () => {
        expect(appIdFromCapabilities('android', CAPS.android)).toBe(APP.android);
        expect(appIdFromCapabilities('ios', CAPS.ios)).toBe(APP.ios);
        expect(appIdFromCapabilities('ios', { bundleId: 'com.example.Echo' })).toBe('com.example.Echo');
        expect(appIdFromCapabilities('android', { appPackage: 'com.example.echo' })).toBe('com.example.echo');
        expect(appIdFromCapabilities('windows', { 'appium:app': 'Example!App' })).toBe('Example!App');
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
            expect(methodsOf(AppiumDevice, ['requireImplemented', 'appId'])).toEqual(Object.keys(EXPECTED).sort());
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
            const args = method === 'setPermission' ? ['camera', 'grant', 'com.example.app'] : ['com.example.app'];
            const error = await methods[method](driver, ...args).then(() => undefined, (e: unknown) => e);
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
