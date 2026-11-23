import { test, expect, type Page } from '@playwright/test';
import { PlatformNotSupportedError, WebElement, type Element, type ElementRepository, type Platform } from '@civitas-cerebrum/element-repository';
import { Steps } from '../src/steps/CommonSteps';
import { AppiumFactory, AppiumGestures } from '../src/appium';
import { MissingAppIdError } from '../src/appium/AppiumDevice';
import { PlaywrightFactory } from '../src/playwright/PlaywrightFactory';
import { stepLog } from '../src/logger/Logger';
import type { Direction, LongPressOptions, PinchOptions, ScrollIntoViewOptions, SwipeOptions } from '../src/interfaces/IGestures';
import type { DeviceVerifyOptions, Orientation, PermissionState } from '../src/interfaces/IDevice';
import type { StepOptions } from '../src/enum/Options';
import { PollTimeoutError } from '../src/utils/poll';
import { mockDriver, mockElement, expectNotSupported, screenSwipes, touches, DEVICE_PLATFORMS, type Call } from './appium/mocks';

/**
 * Unit tests (no device, no browser) for the platform steps:
 * `Steps` over a real `AppiumFactory` on the mock WebdriverIO session for
 * android and ios (each step sends the expected driver commands through the
 * platform strategy), and over the Playwright family for web (every
 * platform-only step throws `PlatformNotSupportedError(<step>, 'web')` before
 * anything is resolved or acted on).
 */

// ─── Platform steps, exact signatures (compile-time check) ──────────────────

/** The platform steps and their published signatures. */
interface PlatformStepSurface {
    launchApp(appId?: string): Promise<void>;
    activateApp(appId?: string): Promise<void>;
    terminateApp(appId?: string): Promise<void>;
    backgroundApp(seconds: number): Promise<void>;
    resetApp(): Promise<void>;
    installApp(appPath: string): Promise<void>;
    removeApp(appId: string): Promise<void>;
    openDeepLink(url: string, appId?: string): Promise<void>;

    swipe(elementName: string, pageName: string, direction: Direction, options?: StepOptions & SwipeOptions): Promise<void>;
    swipeScreen(direction: Direction, options?: { distance?: number }): Promise<void>;
    scrollIntoView(elementName: string, pageName: string, options?: { direction?: Direction }): Promise<void>;
    scrollUntilFound(elementName: string, pageName: string, options?: StepOptions & ScrollIntoViewOptions): Promise<void>;
    longPress(elementName: string, pageName: string, options?: StepOptions & LongPressOptions): Promise<void>;
    tapAt(x: number, y: number): Promise<void>;
    pinch(elementName: string, pageName: string, options?: StepOptions & PinchOptions): Promise<void>;
    zoom(elementName: string, pageName: string, options?: StepOptions & PinchOptions): Promise<void>;

    pressBack(): Promise<void>;
    hideKeyboard(): Promise<void>;
    setOrientation(orientation: 'portrait' | 'landscape'): Promise<void>;
    acceptAlert(): Promise<void>;
    dismissAlert(): Promise<void>;
    setPermission(permission: string, state: 'grant' | 'deny' | 'reset'): Promise<void>;

    getContexts(): Promise<string[]>;
    switchContext(name: string): Promise<void>;

    verifyAppInForeground(appId?: string, options?: DeviceVerifyOptions): Promise<void>;
    verifyOrientation(orientation: 'portrait' | 'landscape', options?: DeviceVerifyOptions): Promise<void>;
    verifyKeyboardShown(options?: DeviceVerifyOptions & { negated?: boolean }): Promise<void>;
    verifyContext(name: string, options?: DeviceVerifyOptions): Promise<void>;

    getPageSource(): Promise<string>;
}

/** Exact type equality (not mere assignability; method parameters are bivariant). */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * Every platform step has exactly the published parameters and return type, except
 * `scrollIntoView`, the pre-existing step: its options are the published ones plus
 * the `StepOptions` every element step takes (a superset), checked by
 * assignability below.
 */
type ExactSteps = Exclude<keyof PlatformStepSurface, 'scrollIntoView'>;
/** The platform steps whose Steps signature differs from the published one (must be `never`). */
type MismatchedSteps = {
    [K in ExactSteps]: Equal<Parameters<Steps[K]>, Parameters<PlatformStepSurface[K]>> extends true
        ? (Equal<ReturnType<Steps[K]>, ReturnType<PlatformStepSurface[K]>> extends true ? never : K)
        : K
}[ExactSteps];
export type _SignaturesMatch = Expect<Equal<MismatchedSteps, never>>;
// scrollIntoView: every published call is a valid Steps call, and it returns the same.
type ScrollIntoViewAccepts = Expect<Parameters<PlatformStepSurface['scrollIntoView']> extends Parameters<Steps['scrollIntoView']> ? true : false>;
type ScrollIntoViewReturns = Expect<Equal<ReturnType<Steps['scrollIntoView']>, ReturnType<PlatformStepSurface['scrollIntoView']>>>;
// Steps itself is usable as the platform step surface.
const asPlatformStepSurface: (steps: Steps) => PlatformStepSurface = steps => steps;
void asPlatformStepSurface;
// Unused-type guards for noUnusedLocals.
export type _PlatformStepChecks = [ScrollIntoViewAccepts, ScrollIntoViewReturns];

/** The platform step names (runtime list), checked against the interface above. */
const PLATFORM_STEPS = [
    'launchApp', 'activateApp', 'terminateApp', 'backgroundApp', 'resetApp', 'installApp', 'removeApp', 'openDeepLink',
    'swipe', 'swipeScreen', 'scrollIntoView', 'scrollUntilFound', 'longPress', 'tapAt', 'pinch', 'zoom',
    'pressBack', 'hideKeyboard', 'setOrientation', 'acceptAlert', 'dismissAlert', 'setPermission',
    'getContexts', 'switchContext',
    'verifyAppInForeground', 'verifyOrientation', 'verifyKeyboardShown', 'verifyContext',
    'getPageSource',
] as const satisfies ReadonlyArray<keyof PlatformStepSurface>;
// Every platform step is in the runtime list.
type MissingFromList = Exclude<keyof PlatformStepSurface, (typeof PLATFORM_STEPS)[number]>;
export type _PlatformStepListComplete = Expect<Equal<MissingFromList, never>>;

/** Element-level gestures that work on web: they follow the element primitive (the element's own gesture) instead of a step guard. */
const ELEMENT_GESTURES = ['swipe', 'scrollIntoView', 'scrollUntilFound', 'longPress'] as const;
/** Every other platform step (`pinch` / `zoom` included) is platform-only: refused on web before anything happens. */
const PLATFORM_ONLY = PLATFORM_STEPS.filter(n => !(ELEMENT_GESTURES as readonly string[]).includes(n));

/** Sample arguments for every platform step. */
const ARGS: Record<(typeof PLATFORM_STEPS)[number], unknown[]> = {
    launchApp: [], activateApp: [], terminateApp: [], backgroundApp: [1], resetApp: [], installApp: ['/tmp/app.apk'],
    removeApp: ['org.example.other'], openDeepLink: ['example://home'],
    swipe: ['el', 'Page', 'up'], swipeScreen: ['up'], scrollIntoView: ['el', 'Page'], scrollUntilFound: ['el', 'Page'],
    longPress: ['el', 'Page'], tapAt: [10, 20], pinch: ['el', 'Page'], zoom: ['el', 'Page'],
    pressBack: [], hideKeyboard: [], setOrientation: ['landscape'], acceptAlert: [], dismissAlert: [],
    setPermission: ['camera', 'grant'], getContexts: [], switchContext: ['NATIVE_APP'],
    verifyAppInForeground: [], verifyOrientation: ['portrait'], verifyKeyboardShown: [], verifyContext: ['NATIVE_APP'],
    getPageSource: [],
};

test.describe('platform step signatures', () => {
    test('every platform step exists on Steps.prototype', () => {
        for (const name of PLATFORM_STEPS) {
            expect(typeof (Steps.prototype as unknown as Record<string, unknown>)[name], name).toBe('function');
        }
    });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const APP = { android: 'com.example.app', ios: 'com.example.App' } as const;
const CAPS = {
    android: { platformName: 'Android', 'appium:appPackage': APP.android },
    ios: { platformName: 'iOS', 'appium:bundleId': APP.ios },
} as const;
const OTHER = 'org.example.other';

type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** A repository stand-in: records lookups as `['repo', method, ...args]` and resolves to `element`. */
function stubRepo(calls: Call[], element: Element, driver?: unknown): ElementRepository {
    const resolve = (method: string) => async (...args: unknown[]) => { calls.push(['repo', method, ...args]); return element; };
    return {
        driver,
        get: resolve('get'),
        getAll: resolve('getAll'),
        getRandom: resolve('getRandom'),
        getByText: resolve('getByText'),
        getByIndex: resolve('getByIndex'),
        getVisible: resolve('getVisible'),
        getSelector: () => '~selector',
        getElementMeta: () => ({}),
    } as unknown as ElementRepository;
}

/** Steps over a real AppiumFactory on the mock driver. */
function deviceSteps(platform: DevicePlatform, timeout = 400) {
    const mock = mockDriver({ capabilities: { ...CAPS[platform] } });
    const element = mockElement({ selector: '~target' });
    const repoCalls: Call[] = [];
    const factory = new AppiumFactory(mock.driver, platform, { timeout });
    const steps = new Steps(factory, stubRepo(repoCalls, element));
    return { steps, mock, element, repoCalls, factory };
}

async function caught(call: () => unknown): Promise<unknown> {
    try {
        await call();
    } catch (error) {
        return error;
    }
    return undefined;
}

function callStep(steps: Steps, name: string, args: unknown[]): Promise<unknown> {
    return (steps as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name].apply(steps, args);
}

// ─── Device platforms: driver commands through the strategy ──────────────────

/** What each device step must send to the driver, per platform. */
type Expectation = { call: (s: Steps) => Promise<unknown>; android: Call[] | 'unsupported'; ios: Call[] | 'unsupported'; returns?: unknown };

const DEVICE_EXPECTED: Record<string, Expectation> = {
    'launchApp()': {
        call: s => s.launchApp(),
        android: [['execute', 'mobile: activateApp', { appId: APP.android }]],
        ios: [['execute', 'mobile: launchApp', { bundleId: APP.ios }]],
    },
    'launchApp(other)': {
        call: s => s.launchApp(OTHER),
        android: [['execute', 'mobile: activateApp', { appId: OTHER }]],
        ios: [['execute', 'mobile: launchApp', { bundleId: OTHER }]],
    },
    'activateApp()': {
        call: s => s.activateApp(),
        android: [['execute', 'mobile: activateApp', { appId: APP.android }]],
        ios: [['execute', 'mobile: activateApp', { bundleId: APP.ios }]],
    },
    'activateApp(other)': {
        call: s => s.activateApp(OTHER),
        android: [['execute', 'mobile: activateApp', { appId: OTHER }]],
        ios: [['execute', 'mobile: activateApp', { bundleId: OTHER }]],
    },
    'terminateApp()': {
        call: s => s.terminateApp(),
        android: [['execute', 'mobile: terminateApp', { appId: APP.android }]],
        ios: [['execute', 'mobile: terminateApp', { bundleId: APP.ios }]],
    },
    'terminateApp(other)': {
        call: s => s.terminateApp(OTHER),
        android: [['execute', 'mobile: terminateApp', { appId: OTHER }]],
        ios: [['execute', 'mobile: terminateApp', { bundleId: OTHER }]],
    },
    backgroundApp: {
        call: s => s.backgroundApp(3),
        android: [['execute', 'mobile: backgroundApp', { seconds: 3 }]],
        ios: [['execute', 'mobile: backgroundApp', { seconds: 3 }]],
    },
    resetApp: {
        call: s => s.resetApp(),
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
        call: s => s.installApp('/builds/app.bin'),
        android: [['execute', 'mobile: installApp', { appPath: '/builds/app.bin' }]],
        ios: [['execute', 'mobile: installApp', { app: '/builds/app.bin' }]],
    },
    removeApp: {
        call: s => s.removeApp(OTHER),
        android: [['execute', 'mobile: removeApp', { appId: OTHER }]],
        ios: [['execute', 'mobile: removeApp', { bundleId: OTHER }]],
    },
    'openDeepLink(url)': {
        call: s => s.openDeepLink('example://item/1'),
        android: [['execute', 'mobile: deepLink', { url: 'example://item/1', package: APP.android }]],
        ios: [['execute', 'mobile: deepLink', { url: 'example://item/1', bundleId: APP.ios }]],
    },
    'openDeepLink(url, other)': {
        call: s => s.openDeepLink('example://item/1', OTHER),
        android: [['execute', 'mobile: deepLink', { url: 'example://item/1', package: OTHER }]],
        ios: [['execute', 'mobile: deepLink', { url: 'example://item/1', bundleId: OTHER }]],
    },
    pressBack: {
        call: s => s.pressBack(),
        android: [['back']],
        ios: 'unsupported',
    },
    hideKeyboard: {
        call: s => s.hideKeyboard(),
        android: [['execute', 'mobile: hideKeyboard', {}]],
        ios: [['execute', 'mobile: hideKeyboard', {}]],
    },
    setOrientation: {
        call: s => s.setOrientation('landscape'),
        android: [['setOrientation', 'LANDSCAPE']],
        ios: [['setOrientation', 'LANDSCAPE']],
    },
    acceptAlert: {
        call: s => s.acceptAlert(),
        android: [['acceptAlert']],
        ios: [['execute', 'mobile: alert', { action: 'accept' }]],
    },
    dismissAlert: {
        call: s => s.dismissAlert(),
        android: [['dismissAlert']],
        ios: [['execute', 'mobile: alert', { action: 'dismiss' }]],
    },
    'setPermission(grant)': {
        call: s => s.setPermission('camera', 'grant'),
        android: [['execute', 'mobile: changePermissions', { permissions: ['camera'], appPackage: APP.android, action: 'grant' }]],
        ios: [['execute', 'mobile: setPermission', { bundleId: APP.ios, access: { camera: 'yes' } }]],
    },
    'setPermission(deny)': {
        call: s => s.setPermission('camera', 'deny'),
        android: [['execute', 'mobile: changePermissions', { permissions: ['camera'], appPackage: APP.android, action: 'revoke' }]],
        ios: [['execute', 'mobile: setPermission', { bundleId: APP.ios, access: { camera: 'no' } }]],
    },
    'setPermission(reset)': {
        call: s => s.setPermission('camera', 'reset'),
        android: [['execute', 'mobile: changePermissions', { permissions: ['camera'], appPackage: APP.android, action: 'revoke' }]],
        ios: [['execute', 'mobile: setPermission', { bundleId: APP.ios, access: { camera: 'unset' } }]],
    },
    getContexts: {
        call: s => s.getContexts(),
        android: [['getAppiumContexts']],
        ios: [['getAppiumContexts']],
        returns: ['NATIVE_APP', 'WEBVIEW_1'],
    },
    switchContext: {
        call: s => s.switchContext('WEBVIEW_1'),
        android: [['switchAppiumContext', 'WEBVIEW_1']],
        ios: [['switchAppiumContext', 'WEBVIEW_1']],
    },
    getPageSource: {
        call: s => s.getPageSource(),
        android: [['getPageSource']],
        ios: [['getPageSource']],
        returns: '<hierarchy/>',
    },
};

for (const platform of DEVICE_PLATFORMS) {
    test.describe(`platform steps on ${platform} (AppiumFactory over a mock driver)`, () => {
        for (const [name, expectation] of Object.entries(DEVICE_EXPECTED)) {
            const expected = expectation[platform];
            if (expected === 'unsupported') {
                test(`${name} throws PlatformNotSupportedError("${name}", "${platform}") and sends nothing`, async () => {
                    const { steps, mock, repoCalls } = deviceSteps(platform);
                    await expectNotSupported(() => expectation.call(steps), name, platform);
                    expect(mock.calls).toEqual([]);
                    expect(repoCalls).toEqual([]);
                });
                continue;
            }
            test(`${name} sends the ${platform} commands`, async () => {
                const { steps, mock, repoCalls } = deviceSteps(platform);
                const result = await expectation.call(steps);
                expect(mock.calls).toEqual(expected);
                expect(repoCalls, 'a device step resolves no element').toEqual([]);
                if ('returns' in expectation) expect(result).toEqual(expectation.returns);
                else expect(result).toBeUndefined();
            });
        }

        test('an optional appId defaults to the factory app id (not only the capabilities file)', async () => {
            const mock = mockDriver({ capabilities: {} });
            const steps = new Steps(new AppiumFactory(mock.driver, platform, { appId: OTHER, timeout: 400 }), stubRepo([], mockElement()));
            await steps.terminateApp();
            expect(mock.calls).toEqual([['execute', 'mobile: terminateApp', platform === 'ios' ? { bundleId: OTHER } : { appId: OTHER }]]);
        });

        test('a step needing an app id without one names the capability key', async () => {
            const mock = mockDriver({ capabilities: {} });
            const steps = new Steps(new AppiumFactory(mock.driver, platform, { timeout: 400 }), stubRepo([], mockElement()));
            const error = await caught(() => steps.launchApp());
            expect((error as Error).message).toContain(platform === 'ios' ? 'appium:bundleId' : 'appium:appPackage');
            expect(mock.calls).toEqual([]);
        });

        // ── Gestures ──

        test('swipe resolves the element and delegates to Element.swipe', async () => {
            const { steps, element, repoCalls, mock } = deviceSteps(platform);
            await steps.swipe('list', 'Page', 'up', { distance: 120 });
            expect(repoCalls).toEqual([['repo', 'get', 'list', 'Page', undefined]]);
            expect(element.calls).toEqual([['swipe', 'up', { distance: 120, timeout: 400 }]]);
            await steps.swipe('list', 'Page', 'left');
            expect(element.calls[1]).toEqual(['swipe', 'left', { timeout: 400 }]);
            expect(mock.calls, 'nothing sent at screen level').toEqual([]);
        });

        test('swipeScreen sends one W3C screen swipe in the finger direction', async () => {
            const { steps, mock, repoCalls } = deviceSteps(platform);
            const started = Date.now();
            await steps.swipeScreen('up', { distance: 200 });
            // The swipe settles (AppiumGestures.SETTLE_MS) before the step returns, like the compositions.
            expect(Date.now() - started).toBeGreaterThanOrEqual(AppiumGestures.SETTLE_MS - 10);
            const swipes = screenSwipes(mock.calls);
            expect(swipes).toHaveLength(1);
            expect(swipes[0].direction).toBe('up');
            expect(swipes[0].distance).toBe(200);
            mock.calls.length = 0;
            await steps.swipeScreen('right');
            expect(screenSwipes(mock.calls).map(s => s.direction)).toEqual(['right']);
            expect(repoCalls).toEqual([]);
        });

        test('swipeScreen refuses a distance that would register as a tap', async () => {
            const { steps, mock } = deviceSteps(platform);
            const error = await caught(() => steps.swipeScreen('up', { distance: 3 }));
            expect((error as Error).message).toMatch(/at least 10/);
            expect(mock.calls).toEqual([]);
        });

        test('scrollIntoView passes the direction to Element.scrollIntoView', async () => {
            const { steps, element } = deviceSteps(platform);
            await steps.scrollIntoView('row', 'Page', { direction: 'up' });
            expect(element.calls).toEqual([['scrollIntoView', { direction: 'up', timeout: 400 }]]);
        });

        test('scrollUntilFound swipes the screen until the element is displayed', async () => {
            const mock = mockDriver({ capabilities: { ...CAPS[platform] } });
            let reads = 0;
            const element = mockElement({ visible: () => ++reads >= 3 });
            const steps = new Steps(new AppiumFactory(mock.driver, platform, { timeout: 5000 }), stubRepo([], element));
            await steps.scrollUntilFound('row', 'Page');
            // Target below (default 'down'): the finger moves up; two swipes before the third read finds it.
            expect(screenSwipes(mock.calls).map(s => s.direction)).toEqual(['up', 'up']);
        });

        test('scrollUntilFound honours direction and timeout, failing with the swipe count', async () => {
            const mock = mockDriver({ capabilities: { ...CAPS[platform] } });
            const element = mockElement({ visible: false });
            const steps = new Steps(new AppiumFactory(mock.driver, platform, { timeout: 30000 }), stubRepo([], element));
            const started = Date.now();
            const error = await caught(() => steps.scrollUntilFound('row', 'Page', { direction: 'right', timeout: 300 }));
            expect(Date.now() - started).toBeLessThan(5000);
            expect((error as Error).message).toMatch(/not displayed after \d+ swipe\(s\) scrolling right within 300 ms/);
            const swipes = screenSwipes(mock.calls);
            expect(swipes.length).toBeGreaterThan(0);
            expect(new Set(swipes.map(s => s.direction))).toEqual(new Set(['left']));
        });

        test('longPress delegates to Element.longPress with the duration', async () => {
            const { steps, element } = deviceSteps(platform);
            await steps.longPress('item', 'Page', { duration: 1500 });
            await steps.longPress('item', 'Page');
            expect(element.calls).toEqual([
                ['longPress', { duration: 1500, timeout: 400 }],
                ['longPress', { timeout: 400 }],
            ]);
        });

        test('tapAt taps the screen at the coordinates with a W3C touch action', async () => {
            const { steps, mock, repoCalls } = deviceSteps(platform);
            await steps.tapAt(10, 20);
            const sent = touches(mock.calls);
            expect(sent).toHaveLength(1);
            expect(sent[0]).toHaveLength(1);
            expect(sent[0][0].actions[0]).toMatchObject({ type: 'pointerMove', x: 10, y: 20 });
            expect(sent[0][0].actions.map(a => (a as { type: string }).type)).toEqual(['pointerMove', 'pointerDown', 'pause', 'pointerUp']);
            expect(repoCalls).toEqual([]);
        });

        test('tapAt refuses a point outside the window and sends nothing', async () => {
            const { steps, mock } = deviceSteps(platform);
            const error = await caught(() => steps.tapAt(5000, 20));
            expect((error as Error).message).toMatch(/outside the 400x800 window/);
            expect(touches(mock.calls)).toEqual([]);
        });

        test('pinch / zoom delegate to the element primitives with the scale', async () => {
            const { steps, element } = deviceSteps(platform);
            await steps.pinch('map', 'Page', { scale: 0.3 });
            await steps.zoom('map', 'Page', { scale: 3 });
            await steps.pinch('map', 'Page');
            await steps.zoom('map', 'Page');
            expect(element.calls).toEqual([
                ['pinch', { scale: 0.3, timeout: 400 }],
                ['zoom', { scale: 3, timeout: 400 }],
                ['pinch', { timeout: 400 }],
                ['zoom', { timeout: 400 }],
            ]);
        });

        // ── Assertions: polling ──

        test('verifyAppInForeground retries until the app is in the foreground', async () => {
            const { steps, mock } = deviceSteps(platform, 3000);
            mock.executeResults['mobile: queryAppState'] = 3;
            setTimeout(() => { mock.executeResults['mobile: queryAppState'] = 4; }, 250);
            await steps.verifyAppInForeground();
            const queries = mock.calls.filter(c => c[1] === 'mobile: queryAppState');
            expect(queries.length).toBeGreaterThan(1);
            expect(queries[0][2]).toEqual(platform === 'ios' ? { bundleId: APP.ios } : { appId: APP.android });
        });

        test('verifyAppInForeground(appId) queries that app', async () => {
            const { steps, mock } = deviceSteps(platform);
            mock.executeResults['mobile: queryAppState'] = 4;
            await steps.verifyAppInForeground(OTHER);
            expect(mock.calls).toEqual([['execute', 'mobile: queryAppState', platform === 'ios' ? { bundleId: OTHER } : { appId: OTHER }]]);
        });

        test('verifyAppInForeground fails after the step timeout with the last value', async () => {
            const { steps, mock } = deviceSteps(platform, 400);
            mock.executeResults['mobile: queryAppState'] = 3;
            const started = Date.now();
            const error = await caught(() => steps.verifyAppInForeground());
            const elapsed = Date.now() - started;
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect((error as Error).message).toContain(`verifyAppInForeground: expected app "${APP[platform]}" in the foreground`);
            expect((error as Error).message).not.toContain('whether it is');
            expect((error as Error).message).toContain('timed out after 400 ms');
            expect((error as Error).message).toContain('Last value: false');
            expect(elapsed).toBeGreaterThanOrEqual(350);
            expect(elapsed).toBeLessThan(3000);
        });

        test('verifyOrientation retries until the orientation flips, and fails with the last one', async () => {
            const { steps, mock } = deviceSteps(platform, 3000);
            let orientation = 'PORTRAIT';
            (mock.driver as unknown as { getOrientation: () => Promise<string> }).getOrientation = async () => orientation;
            setTimeout(() => { orientation = 'LANDSCAPE'; }, 250);
            await steps.verifyOrientation('landscape');

            const short = deviceSteps(platform, 300);
            (short.mock.driver as unknown as { getOrientation: () => Promise<string> }).getOrientation = async () => 'PORTRAIT';
            const error = await caught(() => short.steps.verifyOrientation('landscape'));
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect((error as Error).message).toContain('verifyOrientation: expected orientation "landscape"');
            expect((error as Error).message).toContain('Last value: "portrait"');
        });

        test('verifyOrientation fails at once on a dead session, not at the step timeout', async () => {
            const { steps, mock } = deviceSteps(platform, 5000);
            const dead = Object.assign(new Error('invalid session id'), { name: 'invalid session id' });
            (mock.driver as unknown as { getOrientation: () => Promise<string> }).getOrientation = async () => { throw dead; };
            const started = Date.now();
            const error = await caught(() => steps.verifyOrientation('landscape'));
            expect(error).toBe(dead);
            expect(Date.now() - started).toBeLessThan(2000);
        });

        test('verifyOrientation refuses an unknown orientation before polling', async () => {
            const { steps, mock } = deviceSteps(platform);
            const error = await caught(() => steps.verifyOrientation('upside-down' as Orientation));
            expect((error as Error).message).toMatch(/expected 'portrait' or 'landscape'/);
            expect(mock.calls).toEqual([]);
        });

        test('verifyKeyboardShown retries until the keyboard state flips (shown and hidden)', async () => {
            const { steps, mock } = deviceSteps(platform, 3000);
            mock.executeResults['mobile: isKeyboardShown'] = false;
            setTimeout(() => { mock.executeResults['mobile: isKeyboardShown'] = true; }, 250);
            await steps.verifyKeyboardShown();
            setTimeout(() => { mock.executeResults['mobile: isKeyboardShown'] = false; }, 250);
            await steps.verifyKeyboardShown({ negated: true });
            expect(mock.calls.filter(c => c[1] === 'mobile: isKeyboardShown').length).toBeGreaterThan(2);
        });

        test('verifyKeyboardShown fails after the step timeout with the last value', async () => {
            const { steps, mock } = deviceSteps(platform, 300);
            mock.executeResults['mobile: isKeyboardShown'] = true;
            const error = await caught(() => steps.verifyKeyboardShown({ negated: true }));
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect((error as Error).message).toContain('verifyKeyboardShown: expected the keyboard hidden');
            expect((error as Error).message).not.toContain('whether it is');
            expect((error as Error).message).toContain('Last value: true');
        });

        test('verifyContext retries until the context switches, and fails with the last one', async () => {
            const { steps, mock } = deviceSteps(platform, 3000);
            let context = 'NATIVE_APP';
            (mock.driver as unknown as { getAppiumContext: () => Promise<unknown> }).getAppiumContext = async () => context;
            setTimeout(() => { context = 'WEBVIEW_1'; }, 250);
            await steps.verifyContext('WEBVIEW_1');

            const short = deviceSteps(platform, 300);
            const error = await caught(() => short.steps.verifyContext('WEBVIEW_9'));
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect((error as Error).message).toContain('verifyContext: expected context "WEBVIEW_9"');
            expect((error as Error).message).toContain('Last value: "NATIVE_APP"');
        });

        test('verifyAppInForeground without any app id fails at once, naming the step and the capability key, sending nothing', async () => {
            const mock = mockDriver({ capabilities: { platformName: platform } });
            const steps = new Steps(new AppiumFactory(mock.driver, platform, { timeout: 5000 }), stubRepo([], mockElement()));
            const started = Date.now();
            const error = await caught(() => steps.verifyAppInForeground());
            expect(Date.now() - started, 'not retried for the step timeout').toBeLessThan(1000);
            expect(error).toBeInstanceOf(MissingAppIdError);
            const message = (error as Error).message;
            expect(message).toMatch(/^verifyAppInForeground: no app id\./);
            expect(message).toContain(`set "${platform === 'ios' ? 'appium:bundleId' : 'appium:appPackage'}" in the capabilities file`);
            expect(message).not.toContain('isAppInForeground:');
            expect(mock.calls).toEqual([]);
        });

        test('a PlatformNotSupportedError from a probe is not retried', async () => {
            const { steps, mock } = deviceSteps(platform, 5000);
            let probes = 0;
            (mock.driver as unknown as { execute: () => Promise<unknown> }).execute = async () => {
                probes++;
                throw new PlatformNotSupportedError('isKeyboardShown', platform);
            };
            const started = Date.now();
            await expectNotSupported(() => steps.verifyKeyboardShown(), 'isKeyboardShown', platform);
            expect(probes).toBe(1);
            expect(Date.now() - started).toBeLessThan(1000);
        });
    });
}

test.describe('pressBack refuses ios before anything else', () => {
    /** Records the step log's navigate lines while `run` runs. */
    async function navigateLines(run: () => Promise<unknown>): Promise<string[]> {
        const lines: string[] = [];
        const original = stepLog.navigate.log;
        stepLog.navigate.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
        try {
            await run();
        } finally {
            stepLog.navigate.log = original;
        }
        return lines;
    }

    test('ios: PlatformNotSupportedError("pressBack", "ios") before logging and before the device is reached', async () => {
        const { steps, mock } = deviceSteps('ios');
        const device = (steps as unknown as { device: Record<string, unknown> }).device;
        let reached = 0;
        device.pressBack = async () => { reached++; };
        let refusal: unknown;
        const lines = await navigateLines(async () => { refusal = await caught(() => steps.pressBack()); });
        expect(refusal).toBeInstanceOf(PlatformNotSupportedError);
        expect((refusal as PlatformNotSupportedError).message).toContain('"pressBack"');
        expect((refusal as PlatformNotSupportedError).message).toContain('"ios"');
        expect(reached, 'the device was never reached').toBe(0);
        expect(lines.filter(l => l.includes('system back')), 'nothing was logged').toEqual([]);
        expect(mock.calls).toEqual([]);
    });

    test('android: pressBack logs and reaches the device (control)', async () => {
        const { steps, mock } = deviceSteps('android');
        const lines = await navigateLines(() => steps.pressBack());
        expect(mock.calls).toEqual([['back']]);
        if (stepLog.navigate.enabled) expect(lines.some(l => l.includes('system back'))).toBe(true);
    });
});

test.describe('macos / windows are not reachable', () => {
    for (const platform of ['macos', 'windows'] as const) {
        test(`AppiumFactory refuses ${platform}, so no Steps can be built for it`, () => {
            expect(() => new AppiumFactory(mockDriver().driver, platform)).toThrow(`Platform "${platform}" is declared but not implemented yet.`);
        });
    }
});

// ─── Web: platform-only steps refused before anything happens ────────────────

/** A Playwright page stand-in that records every property read after `arm()`. */
function recordingPage() {
    const touched: string[] = [];
    let armed = false;
    const target: Record<string, unknown> = { url: () => 'about:blank', isClosed: () => false };
    const page = new Proxy(target, {
        get(t, prop) {
            if (armed && typeof prop === 'string') touched.push(prop);
            return t[prop as string];
        },
    }) as unknown as Page;
    return { page, touched, arm: () => { armed = true; } };
}

function webSteps() {
    const repoCalls: Call[] = [];
    const { page, touched, arm } = recordingPage();
    const element = mockElement();
    const steps = new Steps(stubRepo(repoCalls, element, page));
    arm();
    return { steps, repoCalls, touched, element };
}

test.describe('platform steps on web (new Steps(repo))', () => {
    test('the web classification covers every platform step', () => {
        expect([...PLATFORM_ONLY, ...ELEMENT_GESTURES].sort()).toEqual([...PLATFORM_STEPS].sort());
        expect(PLATFORM_ONLY).toEqual(expect.arrayContaining(['swipeScreen', 'tapAt', 'getPageSource', 'verifyContext']));
    });

    for (const name of PLATFORM_ONLY) {
        test(`${name} throws PlatformNotSupportedError("${name}", "web") before resolving or acting`, async () => {
            const { steps, repoCalls, touched, element } = webSteps();
            await expectNotSupported(() => callStep(steps, name, ARGS[name]), name, 'web');
            expect(repoCalls, 'no repository resolution').toEqual([]);
            expect(touched, 'the page was not touched').toEqual([]);
            expect(element.calls).toEqual([]);
        });
    }

    /**
     * A web factory (`PlaywrightFactory` over the recording page) whose
     * gestures and device members record every property read: the guard order
     * is pinned when no platform-only step ever reaches them.
     */
    function recordingWebFactorySteps() {
        const { page, touched, arm } = recordingPage();
        const reached: string[] = [];
        const recorder = (member: string) => new Proxy({}, {
            get(_t, prop) {
                if (typeof prop === 'string') reached.push(`${member}.${prop}`);
                return async () => undefined;
            },
        });
        class RecordingWebFactory extends PlaywrightFactory {
            override createGestures() { return recorder('gestures') as ReturnType<PlaywrightFactory['createGestures']>; }
            override createDevice() { return recorder('device') as ReturnType<PlaywrightFactory['createDevice']>; }
        }
        const repoCalls: Call[] = [];
        const element = mockElement();
        const steps = new Steps(new RecordingWebFactory(page), stubRepo(repoCalls, element, page));
        reached.length = 0;
        arm();
        return { steps, reached, repoCalls, touched, element };
    }

    test('the recording web factory does record (control): swipe reaches gestures.swipe', async () => {
        const { steps, reached } = recordingWebFactorySteps();
        await steps.swipe('el', 'Page', 'up');
        expect(reached).toContain('gestures.swipe');
    });

    for (const name of PLATFORM_ONLY) {
        test(`${name} on a web factory never reaches its gestures or device members`, async () => {
            const { steps, reached, repoCalls, touched, element } = recordingWebFactorySteps();
            await expectNotSupported(() => callStep(steps, name, ARGS[name]), name, 'web');
            expect(reached, 'gestures / device never reached').toEqual([]);
            expect(repoCalls).toEqual([]);
            expect(touched).toEqual([]);
            expect(element.calls).toEqual([]);
        });
    }

    test('swipe on web delegates to WebElement.swipe (a real mouse drag)', async () => {
        const mouse: unknown[][] = [];
        const fakePage = {
            viewportSize: () => ({ width: 1000, height: 600 }),
            mouse: {
                move: async (...a: unknown[]) => { mouse.push(['move', ...a]); },
                down: async () => { mouse.push(['down']); },
                up: async () => { mouse.push(['up']); },
            },
        };
        const locator = {
            waitFor: async () => undefined,
            boundingBox: async () => ({ x: 100, y: 200, width: 100, height: 50 }),
            page: () => fakePage,
        };
        const web = new WebElement(locator as never, 'css=.list');
        const repoCalls: Call[] = [];
        const steps = new Steps(stubRepo(repoCalls, web, { url: () => 'about:blank' }));
        await steps.swipe('list', 'Page', 'up', { distance: 100 });
        expect(repoCalls).toEqual([['repo', 'get', 'list', 'Page', undefined]]);
        expect(mouse).toEqual([['move', 150, 225], ['down'], ['move', 150, 125, { steps: 10 }], ['up']]);
    });

    for (const name of ['pinch', 'zoom'] as const) {
        test(`${name} on web throws PlatformNotSupportedError("${name}", "web") before any repository call, even for an unknown name`, async () => {
            const repoCalls: Call[] = [];
            const repo = stubRepo(repoCalls, mockElement(), { url: () => 'about:blank' });
            // A repository that would fail (or wait out a fallback chain) on any lookup.
            (repo as unknown as { get: () => Promise<never> }).get = async () => { repoCalls.push(['repo', 'get']); throw new Error('unknown element'); };
            const steps = new Steps(repo);
            // Capture the interaction log (forced on, so an empty capture means nothing was logged).
            const lines: string[] = [];
            const { log: originalLog, enabled: originalEnabled } = stepLog.interact;
            stepLog.interact.enabled = true;
            stepLog.interact.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
            const started = Date.now();
            try {
                stepLog.interact('capture check');
                await expectNotSupported(() => steps[name]('no-such-element', 'NoSuchPage'), name, 'web');
            } finally {
                stepLog.interact.log = originalLog;
                stepLog.interact.enabled = originalEnabled;
            }
            expect(Date.now() - started).toBeLessThan(1000);
            expect(repoCalls, 'no repository resolution').toEqual([]);
            expect(lines.some(l => l.includes('capture check')), 'the capture works').toBe(true);
            expect(lines.filter(l => /Pinching|Zooming/.test(l)), 'no "Pinching" / "Zooming" line before the refusal').toEqual([]);
        });
    }

    test('scrollUntilFound and longPress on web delegate to the element primitives', async () => {
        const calls: string[] = [];
        const web = new WebElement({} as never, 'css=.x');
        (web as unknown as Record<string, unknown>).scrollIntoView = async (o: unknown) => { calls.push(`scrollIntoView ${JSON.stringify(o)}`); };
        (web as unknown as Record<string, unknown>).longPress = async (o: unknown) => { calls.push(`longPress ${JSON.stringify(o)}`); };
        const steps = new Steps(stubRepo([], web, { url: () => 'about:blank' }), { timeout: 900 });
        await steps.scrollUntilFound('x', 'Page', { timeout: 500 });
        await steps.longPress('x', 'Page', { duration: 1200 });
        expect(calls).toEqual(['scrollIntoView {"timeout":500}', 'longPress {"duration":1200,"timeout":900}']);
    });
});

// ─── Types used only in signatures ───────────────────────────────────────────
export type _Used = [Platform, PermissionState];
