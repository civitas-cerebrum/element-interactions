import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Element } from '@civitas-cerebrum/element-repository';
import {
    AppiumFactory,
    AppiumInteractions,
    AppiumVerifications,
    AppiumExtractions,
    AppiumNavigation,
    AppiumUtils,
    AppiumGestures,
    AppiumDevice,
} from '../src/appium';
import { mockDriver, mockElement, touches, screenSwipes, expectNotSupported, methodsOf, changing, WINDOW, DEVICE_PLATFORMS, type Call } from './appium/mocks';
import { DEVICE_METHODS } from './appium/methods';

/**
 * Pure unit tests for the Appium family (factory, gestures, interactions,
 * extractions, navigation, utils, web-only refusals) over a mock WebdriverIO
 * session and mock platform elements. No device, no server, no browser.
 */

/** `options.timeout` is the time left of `total`: at most `total`, and not much less when nothing waited. */
function expectTimeLeft(options: unknown, total: number): void {
    const timeout = (options as { timeout: number }).timeout;
    expect(timeout).toBeLessThanOrEqual(total);
    expect(timeout).toBeGreaterThan(total - 50);
}

const CAPS = {
    android: { platformName: 'Android', 'appium:appPackage': 'com.example.app' },
    ios: { platformName: 'iOS', 'appium:bundleId': 'com.example.App' },
} as const;

/** Web-only methods per class, each with a call that must throw PlatformNotSupportedError(name, platform). */
const WEB_ONLY = {
    interactions: (i: AppiumInteractions, el: Element): Record<string, () => unknown> => ({
        uploadFile: () => i.uploadFile(el, '/tmp/a.txt'),
        dropFiles: () => i.dropFiles(el, ['a.txt']),
        selectDropdown: () => i.selectDropdown(el),
        hover: () => i.hover(el),
        rightClick: () => i.rightClick(el),
        setSliderValue: () => i.setSliderValue(el, 3),
        pressKey: () => i.pressKey('Enter'),
        pressKeys: () => i.pressKeys(['a', 'b']),
        dispatchEvent: () => i.dispatchEvent(el, 'click'),
        selectMultiple: () => i.selectMultiple(el, ['a']),
    }),
    extractions: (x: AppiumExtractions, el: Element): Record<string, () => unknown> => ({
        getCssProperty: () => x.getCssProperty(el, 'color'),
        getHtml: () => x.getHtml(el),
        getPageHtml: () => x.getPageHtml(),
        getPageText: () => x.getPageText(),
        getLocalStorageKeys: () => x.getLocalStorageKeys(),
        getSessionStorageKeys: () => x.getSessionStorageKeys(),
        getLocalStorage: () => x.getLocalStorage('k'),
        getSessionStorage: () => x.getSessionStorage('k'),
        setLocalStorage: () => x.setLocalStorage('k', 'v'),
        setSessionStorage: () => x.setSessionStorage('k', 'v'),
        removeLocalStorage: () => x.removeLocalStorage('k'),
        removeSessionStorage: () => x.removeSessionStorage('k'),
        clearLocalStorage: () => x.clearLocalStorage(),
        clearSessionStorage: () => x.clearSessionStorage(),
        getWindowProperty: () => x.getWindowProperty('a.b'),
        setWindowProperty: () => x.setWindowProperty('a.b', 1),
        evaluateScript: () => x.evaluateScript(() => 1),
    }),
    navigation: (n: AppiumNavigation): Record<string, () => unknown> => ({
        toUrl: () => n.toUrl('https://example.test/'),
        getUrl: () => n.getUrl(),
        getCurrentPath: () => n.getCurrentPath(),
        waitForUrl: () => n.waitForUrl('/x', async () => { throw new Error('action must not run'); }),
        reload: () => n.reload(),
        backOrForward: () => n.backOrForward('back'),
        setViewport: () => n.setViewport(1, 1),
        switchToNewTab: () => n.switchToNewTab(async () => undefined),
        closeTab: () => n.closeTab(),
        getTabCount: () => n.getTabCount(),
        waitForNetworkIdle: () => n.waitForNetworkIdle(),
        waitForLoadState: () => n.waitForLoadState('load'),
        waitForResponse: () => n.waitForResponse('/api', async () => undefined),
        expectNoRequest: () => n.expectNoRequest('/api', async () => undefined),
    }),
    verifications: (v: AppiumVerifications, el: Element): Record<string, () => unknown> => ({
        urlContains: () => v.urlContains('x'),
        pageContainsText: () => v.pageContainsText('x'),
        pageNotContainsText: () => v.pageNotContainsText('x'),
        pageTitle: () => v.pageTitle('x'),
        html: () => v.html(el, 'x'),
        htmlContains: () => v.htmlContains(el, 'x'),
        htmlMatches: () => v.htmlMatches(el, /x/),
        htmlStartsWith: () => v.htmlStartsWith(el, 'x'),
        htmlEndsWith: () => v.htmlEndsWith(el, 'x'),
        pageHtml: () => v.pageHtml('x'),
        pageHtmlContains: () => v.pageHtmlContains('x'),
        pageHtmlMatches: () => v.pageHtmlMatches(/x/),
        pageHtmlStartsWith: () => v.pageHtmlStartsWith('x'),
        pageHtmlEndsWith: () => v.pageHtmlEndsWith('x'),
        localStorage: () => v.localStorage('k', 'v'),
        localStorageContains: () => v.localStorageContains('k', 'v'),
        localStorageMatches: () => v.localStorageMatches('k', /v/),
        localStoragePresent: () => v.localStoragePresent('k'),
        sessionStorage: () => v.sessionStorage('k', 'v'),
        sessionStorageContains: () => v.sessionStorageContains('k', 'v'),
        sessionStorageMatches: () => v.sessionStorageMatches('k', /v/),
        sessionStoragePresent: () => v.sessionStoragePresent('k'),
        windowProperty: () => v.windowProperty('a', () => true, 'truthy'),
        images: () => v.images(el),
        tabCount: () => v.tabCount(1),
        cssProperty: () => v.cssProperty(el, 'color', 'red'),
        cssPropertyContains: () => v.cssPropertyContains(el, 'color', 'red'),
        cssPropertyMatches: () => v.cssPropertyMatches(el, 'color', /red/),
        visuallyMatches: () => v.visuallyMatches(el),
    }),
};

for (const platform of DEVICE_PLATFORMS) {
    const setup = (timeout?: number) => {
        const mock = mockDriver({ capabilities: CAPS[platform] });
        const factory = new AppiumFactory(mock.driver, platform, timeout === undefined ? {} : { timeout });
        return { ...mock, factory };
    };

    test.describe(`AppiumFactory on ${platform}`, () => {
        test('reports its platform and the appium family, and the app id from the capabilities', () => {
            const { factory } = setup();
            expect(factory.platform).toBe(platform);
            expect(factory.family).toBe('appium');
            expect(factory.appId).toBe(platform === 'android' ? 'com.example.app' : 'com.example.App');
        });

        test('creates every family member, a new instance each time', () => {
            const { factory } = setup(1234);
            expect(factory.createInteractions()).toBeInstanceOf(AppiumInteractions);
            expect(factory.createVerifications()).toBeInstanceOf(AppiumVerifications);
            expect(factory.createExtractions()).toBeInstanceOf(AppiumExtractions);
            expect(factory.createNavigation()).toBeInstanceOf(AppiumNavigation);
            expect(factory.createUtils()).toBeInstanceOf(AppiumUtils);
            expect(factory.createUtils().getTimeout()).toBe(1234);
            expect(factory.createGestures()).toBeInstanceOf(AppiumGestures);
            expect(factory.createDevice()).toBeInstanceOf(AppiumDevice);
            expect(factory.createGestures()).not.toBe(factory.createGestures());
        });

        test('the default timeout is 30000 and reaches the gestures', async () => {
            const { factory } = setup();
            expect(factory.createUtils().getTimeout()).toBe(30000);
            const el = mockElement();
            await factory.createGestures().longPress(el);
            expect(el.calls).toEqual([['longPress', { timeout: 30000 }]]);
        });

        test('two factories for different platforms do not share state', () => {
            const other = platform === 'android' ? 'ios' : 'android';
            const a = setup().factory;
            const b = new AppiumFactory(mockDriver({ capabilities: CAPS[other] }).driver, other);
            expect(a.strategy.platform).toBe(platform);
            expect(b.strategy.platform).toBe(other);
            expect(a.appId).not.toBe(b.appId);
        });
    });

    test.describe(`web-only methods throw PlatformNotSupportedError on ${platform}`, () => {
        const { factory, calls } = setup();
        const el = mockElement();
        const members = {
            interactions: WEB_ONLY.interactions(factory.createInteractions(), el),
            extractions: WEB_ONLY.extractions(factory.createExtractions(), el),
            navigation: WEB_ONLY.navigation(factory.createNavigation()),
            verifications: WEB_ONLY.verifications(factory.createVerifications(), el),
        };

        for (const [member, methods] of Object.entries(members)) {
            for (const [method, call] of Object.entries(methods)) {
                test(`${member}.${method}`, async () => {
                    await expectNotSupported(call, method, platform);
                    expect(calls).toEqual([]);
                    expect(el.calls).toEqual([]);
                });
            }
        }

        test('state() with a raw selector string is the web overload and throws', async () => {
            await expectNotSupported(() => factory.createVerifications().state('css=.x', 'visible', 100), 'state', platform);
        });

        test('the synchronous navigation methods throw synchronously', () => {
            const nav = factory.createNavigation();
            expect(() => nav.getUrl()).toThrow(/"getUrl" is not supported/);
            expect(() => nav.getTabCount()).toThrow(/"getTabCount" is not supported/);
        });

        test('completeness: every method is either web-only (above) or has a device meaning', () => {
            const classes = {
                interactions: AppiumInteractions,
                extractions: AppiumExtractions,
                navigation: AppiumNavigation,
                verifications: AppiumVerifications,
            } as const;
            for (const [member, ctor] of Object.entries(classes)) {
                const key = member as keyof typeof classes;
                const covered = [...Object.keys(members[key]), ...DEVICE_METHODS[key]].sort();
                expect(methodsOf(ctor), member).toEqual(covered);
            }
        });
    });

    test.describe(`AppiumGestures on ${platform}`, () => {
        const delegates: Array<[string, (g: AppiumGestures, el: Element) => Promise<unknown>, Call]> = [
            ['swipe', (g, el) => g.swipe(el, 'left', { distance: 100, timeout: 500 }), ['swipe', 'left', { distance: 100, timeout: 500 }]],
            ['scrollIntoView', (g, el) => g.scrollIntoView(el, { direction: 'up', timeout: 500 }), ['scrollIntoView', { direction: 'up', timeout: 500 }]],
            ['longPress', (g, el) => g.longPress(el, { duration: 800, timeout: 500 }), ['longPress', { duration: 800, timeout: 500 }]],
            ['tapAtElement', (g, el) => g.tapAtElement(el, { x: 3, y: 4 }, { timeout: 500 }), ['tapAt', { x: 3, y: 4 }, { timeout: 500 }]],
            ['pinch', (g, el) => g.pinch(el, { scale: 0.4, timeout: 500 }), ['pinch', { scale: 0.4, timeout: 500 }]],
            ['zoom', (g, el) => g.zoom(el, { scale: 3, timeout: 500 }), ['zoom', { scale: 3, timeout: 500 }]],
        ];
        const compositions = ['swipeScreen', 'tapAt', 'scrollUntilFound', 'centerElement'];

        for (const [method, call, expected] of delegates) {
            test(`${method} delegates to the element primitive with its options`, async () => {
                const { factory, calls } = setup();
                const el = mockElement();
                await call(factory.createGestures(), el);
                expect(el.calls).toEqual([expected]);
                expect(calls).toEqual([]);
            });
        }

        test('every IGestures method is covered', () => {
            const helpers = ['requireImplemented', 'settle'];
            expect(methodsOf(AppiumGestures, helpers)).toEqual([...delegates.map(([m]) => m), ...compositions].sort());
        });

        test('omitted timeouts fall back to the factory timeout; a per-call timeout wins', async () => {
            const { factory } = setup(1500);
            const g = factory.createGestures();
            const el = mockElement();
            await g.swipe(el, 'up');
            await g.scrollIntoView(el);
            await g.longPress(el, { duration: 200 });
            await g.longPress(el, { duration: 200, timeout: 50 });
            await g.tapAtElement(el, { x: 1, y: 2 });
            await g.pinch(el);
            await g.zoom(el);
            expect(el.calls).toEqual([
                ['swipe', 'up', { timeout: 1500 }],
                ['scrollIntoView', { timeout: 1500 }],
                ['longPress', { duration: 200, timeout: 1500 }],
                ['longPress', { duration: 200, timeout: 50 }],
                ['tapAt', { x: 1, y: 2 }, { timeout: 1500 }],
                ['pinch', { timeout: 1500 }],
                ['zoom', { timeout: 1500 }],
            ]);
        });

        /** The native command each platform uses for a measured screen swipe. */
        const MEASURED = platform === 'ios' ? 'mobile: dragFromToForDuration' : 'mobile: swipeGesture';

        test('swipeScreen sends one native swipe through the platform strategy, no W3C actions', async () => {
            const { factory, calls } = setup();
            await factory.createGestures().swipeScreen('up', { distance: 300 });
            expect(touches(calls)).toEqual([]);
            expect(calls.filter(c => c[0] === 'releaseActions')).toEqual([]);
            const [swipe] = screenSwipes(calls);
            expect(swipe.command).toBe(MEASURED);
            expect(swipe.direction).toBe('up');
            expect(swipe.distance).toBeCloseTo(300, 0);
        });

        test('swipeScreen without a distance uses the platform default; distance is clamped; 0 is refused', async () => {
            const { factory, calls } = setup();
            const g = factory.createGestures();
            await g.swipeScreen('left');
            await g.swipeScreen('down', { distance: 5000 });
            const [left, down] = screenSwipes(calls);
            if (platform === 'ios') {
                // XCUITest's own swipe: direction only.
                expect(left).toEqual({ command: 'mobile: swipe', direction: 'left' });
                // From the centre to the last row of the window.
                expect(down).toEqual({ command: MEASURED, direction: 'down', distance: WINDOW.height - 1 - 400 });
            } else {
                expect(left.direction).toBe('left');
                expect(left.distance).toBeCloseTo(WINDOW.width / 2, 0);
                // The whole swipe area (window minus the insets), percent capped at 1.
                expect(down).toEqual({ command: MEASURED, direction: 'down', distance: 480 });
            }
            await expect(g.swipeScreen('up', { distance: 0 })).rejects.toThrow(/positive/);
            await expect(g.swipeScreen('up', { distance: Number.NaN })).rejects.toThrow(/positive/);
        });

        test('tapAt taps the screen point and rejects points outside the window', async () => {
            const { factory, calls } = setup();
            const g = factory.createGestures();
            await g.tapAt(10, 20);
            expect(touches(calls)[0][0].actions).toEqual([
                { type: 'pointerMove', duration: 0, x: 10, y: 20, origin: 'viewport' },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration: 50 },
                { type: 'pointerUp', button: 0 },
            ]);
            await expect(g.tapAt(-1, 5)).rejects.toThrow(/outside the 400x800 window/);
            await expect(g.tapAt(5, 800)).rejects.toThrow(/outside/);
        });

        test('touch actions are released even when the gesture fails', async () => {
            const { factory, calls, driver } = setup();
            (driver as unknown as { performActions: () => Promise<never> }).performActions = async () => { throw new Error('boom'); };
            await expect(factory.createGestures().tapAt(1, 1)).rejects.toThrow('boom');
            expect(calls.map(c => c[0])).toEqual(['releaseActions']);
        });

        test('scrollUntilFound swipes until the element shows up (3rd read), finger opposite the direction', async () => {
            const { factory, calls } = setup();
            const visible = changing([false, false, true]);
            const el = mockElement({ visible: visible.read });
            await factory.createGestures().scrollUntilFound(el, { direction: 'down', timeout: 5000 });
            expect(visible.reads()).toBe(3);
            expect(touches(calls)).toEqual([]);
            const swipes = screenSwipes(calls);
            expect(swipes).toHaveLength(2);
            // content below -> finger moves up a third of the screen
            expect(swipes[0].command).toBe(MEASURED);
            expect(swipes[0].direction).toBe('up');
            expect(swipes[0].distance).toBeCloseTo(800 / 3, 0);
        });

        test('scrollUntilFound honours direction for horizontal lists', async () => {
            const { factory, calls } = setup();
            const visible = changing([false, true]);
            await factory.createGestures().scrollUntilFound(mockElement({ visible: visible.read }), { direction: 'right', timeout: 5000 });
            const [swipe] = screenSwipes(calls);
            expect(swipe.direction).toBe('left');
            expect(swipe.distance).toBeCloseTo(400 / 3, 0);
        });

        test('scrollUntilFound throws after its timeout, naming the swipes', async () => {
            const { factory } = setup();
            const started = Date.now();
            const error = await factory.createGestures()
                .scrollUntilFound(mockElement({ visible: false, selector: '~target' }), { timeout: 450 })
                .catch(e => e);
            expect(error.message).toMatch(/scrollUntilFound: element "~target" not displayed after \d+ swipe\(s\) scrolling down within 450 ms/);
            expect(Date.now() - started).toBeGreaterThanOrEqual(440);
            expect(Date.now() - started).toBeLessThan(2000);
        });

        test('scrollUntilFound treats a failing visibility read as not yet visible', async () => {
            const { factory } = setup();
            let n = 0;
            const el = mockElement({ visible: async () => { if (n++ < 1) throw new Error('stale'); return true; } });
            await expect(factory.createGestures().scrollUntilFound(el, { timeout: 5000 })).resolves.toBeUndefined();
        });

        test('centerElement swipes until the element is within tolerance of the centre', async () => {
            const { factory, calls } = setup();
            const box = changing([
                { x: 0, y: 700, width: 100, height: 40 }, // 320 px below centre -> step capped at 800/3
                { x: 0, y: 453, width: 100, height: 40 }, // 73 px below
                { x: 0, y: 390, width: 100, height: 40 }, // within 50 px
            ]);
            await factory.createGestures().centerElement(mockElement({ box: box.read }), { timeout: 5000 });
            expect(touches(calls)).toEqual([]);
            const swipes = screenSwipes(calls);
            expect(swipes).toHaveLength(2);
            expect(swipes.map(s => [s.command, s.direction])).toEqual([[MEASURED, 'up'], [MEASURED, 'up']]);
            expect(swipes[0].distance).toBeCloseTo(800 / 3, 0);
            expect(swipes[1].distance).toBeCloseTo(73, 0);
        });

        test('centerElement swipes the finger down for an element above the centre', async () => {
            const { factory, calls } = setup();
            const box = changing([{ x: 0, y: 200, width: 100, height: 40 }, { x: 0, y: 380, width: 100, height: 40 }]);
            await factory.createGestures().centerElement(mockElement({ box: box.read }), { timeout: 5000 });
            const [swipe] = screenSwipes(calls);
            expect(swipe.direction).toBe('down');
            expect(swipe.distance).toBeCloseTo(180, 0);
        });

        test('centerElement stops when the content no longer moves (scroll boundary)', async () => {
            const { factory, calls } = setup();
            await factory.createGestures().centerElement(mockElement({ box: { x: 0, y: 700, width: 10, height: 10 } }), { timeout: 5000 });
            expect(screenSwipes(calls)).toHaveLength(1);
        });

        test('centerElement rejects a vertically centred element that is off screen sideways', async () => {
            const { factory, calls } = setup();
            const g = factory.createGestures();
            for (const x of [900, -100]) {
                const error = await g.centerElement(mockElement({ selector: '~side', box: { x, y: 380, width: 40, height: 40 } }), { timeout: 5000 })
                    .catch(e => e);
                expect(error).toBeInstanceOf(Error);
                expect(error.message).toMatch(/^centerElement: element "~side" is not on screen \(centre at \(-?\d+, 400\) outside the 400x800 window\) after 0 swipe\(s\): it is vertically centred, but this scrolls only vertically\.$/);
            }
            expect(calls).toEqual([]);
        });

        test('centerElement throws when the element is still off screen at its deadline', async () => {
            const { factory } = setup();
            // Moves 100 px closer per read but starts far below the window: never on screen within 250 ms.
            let y = 5000;
            const el = mockElement({ selector: '~far', box: async () => ({ x: 0, y: (y -= 100), width: 10, height: 10 }) });
            const started = Date.now();
            const error = await factory.createGestures().centerElement(el, { timeout: 250 }).catch(e => e);
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toMatch(/^centerElement: element "~far" is not on screen \(centre at \(5, \d+\) outside the 400x800 window\) after \d+ swipe\(s\): timed out after 250 ms\.$/);
            expect(Date.now() - started).toBeLessThan(250 + AppiumGestures.SETTLE_MS + 300);
        });

        test('centerElement throws when the content stops moving with the element off screen', async () => {
            const { factory } = setup();
            const error = await factory.createGestures()
                .centerElement(mockElement({ box: { x: 0, y: 2000, width: 10, height: 10 } }), { timeout: 5000 }).catch(e => e);
            expect(error.message).toMatch(/not on screen .* after 1 swipe\(s\): the content stopped moving\.$/);
        });

        test('centerElement at its deadline returns quietly when the element is on screen but not centred', async () => {
            const { factory } = setup();
            let y = 700;
            // Slowly drifts (10 px per read): never centred, never stuck, always on screen.
            const el = mockElement({ box: async () => ({ x: 0, y: (y -= 10), width: 10, height: 10 }) });
            await expect(factory.createGestures().centerElement(el, { timeout: 250 })).resolves.toBeUndefined();
        });

        test('centerElement does nothing for an element already centred, and throws without bounds', async () => {
            const { factory, calls } = setup();
            const g = factory.createGestures();
            await g.centerElement(mockElement({ box: { x: 0, y: 380, width: 10, height: 40 } }));
            expect(calls).toEqual([]);
            await expect(g.centerElement(mockElement({ box: null }))).rejects.toThrow(/no bounds/);
        });
    });

    test.describe(`AppiumInteractions on ${platform}`, () => {
        test('click waits for visible with the timeout, then calls the click primitive with the time left', async () => {
            const { factory } = setup(700);
            const el = mockElement();
            await factory.createInteractions().click(el);
            expect(el.calls).toEqual([['waitFor', { state: 'visible', timeout: 700 }], ['click', { timeout: expect.any(Number) }]]);
            expectTimeLeft(el.calls[1][1], 700);
        });

        test('click({ timeout }) overrides the instance timeout', async () => {
            const { factory } = setup(700);
            const el = mockElement();
            await factory.createInteractions().click(el, { timeout: 90, withoutScrolling: true });
            expect(el.calls).toEqual([['waitFor', { state: 'visible', timeout: 90 }], ['click', { timeout: expect.any(Number) }]]);
            expectTimeLeft(el.calls[1][1], 90);
        });

        test('click shares one timeout between the visibility wait and the primitive', async () => {
            const { factory } = setup();
            const el = mockElement({ waitFor: async () => { await new Promise(r => setTimeout(r, 200)); } });
            await factory.createInteractions().click(el, { timeout: 500 });
            const clickTimeout = (el.calls.find(c => c[0] === 'click')![1] as { timeout: number }).timeout;
            expect(clickTimeout).toBeLessThanOrEqual(310);
            expect(clickTimeout).toBeGreaterThan(200);
        });

        test('click({ force }) taps the element centre through the tapAt primitive', async () => {
            const { factory, calls } = setup(700);
            const el = mockElement({ box: { x: 10, y: 20, width: 81, height: 40 } });
            await factory.createInteractions().click(el, { force: true });
            expect(el.calls).toEqual([['waitFor', { state: 'visible', timeout: 700 }], ['tapAt', { x: 40, y: 20 }, { timeout: expect.any(Number) }]]);
            expectTimeLeft(el.calls[1][2], 700);
            expect(calls).toEqual([]);
        });

        test('click fails when the element never becomes visible', async () => {
            const { factory } = setup(700);
            const el = mockElement({ waitFor: async () => { throw new Error('still not displayed after 700ms'); } });
            await expect(factory.createInteractions().click(el)).rejects.toThrow(/did not reach state 'visible' within 700ms/);
        });

        test('click({ ifPresent }) and clickIfPresent resolve false without touching an absent element', async () => {
            const { factory } = setup();
            const i = factory.createInteractions();
            const hidden = mockElement({ visible: false });
            const broken = mockElement({ visible: async () => { throw new Error('no such element'); } });
            expect(await i.click(hidden, { ifPresent: true })).toBe(false);
            expect(await i.clickIfPresent(broken)).toBe(false);
            expect(hidden.calls).toEqual([]);
            const shown = mockElement();
            expect(await i.clickIfPresent(shown, { timeout: 40 })).toBe(true);
            expect(shown.calls).toEqual([['click', { timeout: 40 }]]);
        });

        test('fill, typeSequentially, doubleClick, check, uncheck, clearInput and scrollIntoView delegate with the timeout', async () => {
            const { factory } = setup(900);
            const i = factory.createInteractions();
            const el = mockElement();
            await i.fill(el, 'hello');
            await i.typeSequentially(el, 'abc', 25);
            await i.doubleClick(el);
            await i.check(el);
            await i.uncheck(el);
            await i.clearInput(el);
            await i.scrollIntoView(el);
            const primitives = el.calls.filter(c => c[0] !== 'waitFor');
            expect(primitives).toEqual([
                ['fill', 'hello', { timeout: 900 }],
                ['pressSequentially', 'abc', 25, { timeout: 900 }],
                ['doubleClick', { timeout: 900 }],
                ['check', { timeout: 900 }],
                ['uncheck', { timeout: 900 }],
                ['clear', { timeout: 900 }],
                ['scrollIntoView', { timeout: 900 }],
            ]);
        });

        test('dragAndDrop onto a target uses the dragTo primitive', async () => {
            const { factory } = setup(800);
            const source = mockElement();
            const target = mockElement({ selector: '~target' });
            await factory.createInteractions().dragAndDrop(source, { target: target as never });
            const drags = source.calls.filter(c => c[0] === 'dragTo');
            expect(drags).toEqual([['dragTo', target, { timeout: expect.any(Number) }]]);
            expectTimeLeft(drags[0][2], 800);
        });

        test('dragAndDrop shares one timeout between both waits and the primitive', async () => {
            const { factory } = setup();
            const waits: number[] = [];
            const slowWait = async (options: unknown) => {
                waits.push((options as { timeout: number }).timeout);
                await new Promise(r => setTimeout(r, 150));
            };
            const source = mockElement({ waitFor: slowWait });
            const target = mockElement({ selector: '~target', waitFor: slowWait });
            await factory.createInteractions().dragAndDrop(source, { target: target as never, timeout: 600 });
            expect(waits[0]).toBe(600);
            const targetWait = waits[1];
            const dragTimeout = (source.calls.find(c => c[0] === 'dragTo')![2] as { timeout: number }).timeout;
            expect(targetWait).toBeLessThanOrEqual(460);
            expect(dragTimeout).toBeLessThanOrEqual(310);
            expect(dragTimeout).toBeGreaterThan(150);
        });

        test('dragAndDrop by offset drags the element centre with one touch gesture', async () => {
            const { factory, calls } = setup();
            const el = mockElement({ box: { x: 100, y: 200, width: 50, height: 20 } });
            await factory.createInteractions().dragAndDrop(el, { xOffset: 30, yOffset: -40 });
            const actions = touches(calls)[0][0].actions;
            expect(actions[0]).toMatchObject({ x: 125, y: 210 });
            expect(actions[2]).toMatchObject({ x: 155, y: 170, duration: 600 });
            await expect(factory.createInteractions().dragAndDrop(el, { xOffset: 1 })).rejects.toThrow(/must provide either 'target'/);
        });

        test('getByText picks the exact text first, then a substring, then a substring ignoring case; strict lists the texts', async () => {
            const { factory } = setup();
            const i = factory.createInteractions();
            const a = mockElement({ text: ' Apple ' });
            const b = mockElement({ text: 'banana' });
            const list = mockElement({ children: [a, b] });
            expect(await i.getByText(list, 'Apple')).toBe(a);
            expect(await i.getByText(list, 'BANANA')).toBe(b);
            expect(await i.getByText(list, 'cherry')).toBeNull();
            await expect(i.getByText(list, 'cherry', true)).rejects.toThrow('Available texts: \n- Apple\n- banana');
        });

        test('getByText finds a substring like the web family ("Settings" in "Wi-Fi Settings")', async () => {
            const { factory } = setup();
            const i = factory.createInteractions();
            const wifi = mockElement({ text: 'Wi-Fi Settings' });
            const settings = mockElement({ text: 'Settings' });
            const general = mockElement({ text: 'General' });
            expect(await i.getByText(mockElement({ children: [general, wifi] }), 'Settings')).toBe(wifi);
            // exact beats an earlier substring match
            expect(await i.getByText(mockElement({ children: [wifi, settings] }), 'Settings')).toBe(settings);
            // case-sensitive substring beats an earlier case-insensitive one
            const lower = mockElement({ text: 'network settings' });
            expect(await i.getByText(mockElement({ children: [lower, wifi] }), 'Settings')).toBe(wifi);
            expect(await i.getByText(mockElement({ children: [general, lower] }), 'SETTINGS')).toBe(lower);
        });

        test('getListedElement matches text (substring, then ignoring case), regex and attribute', async () => {
            const { factory } = setup(2000);
            const i = factory.createInteractions();
            const a = mockElement({ text: 'Order 1 - pending', attributes: { 'content-desc': 'row-1' } });
            const b = mockElement({ text: 'Order 2 - SHIPPED', attributes: { 'content-desc': 'row-2' } });
            const list = mockElement({ children: [a, b] });
            expect(await i.getListedElement(list, { text: 'pending' })).toBe(a);
            expect(await i.getListedElement(list, { text: 'shipped' })).toBe(b);
            expect(await i.getListedElement(list, { text: { regex: 'order 2', flags: 'i' } })).toBe(b);
            expect(await i.getListedElement(list, { attribute: { name: 'content-desc', value: 'row-2' } })).toBe(b);
            expect(await i.getListedElement(list, { text: 'Order', attribute: { name: 'content-desc', value: { regex: '2$' } } })).toBe(b);
        });

        test('getListedElement polls until the item appears (3rd read), then fails after its timeout', async () => {
            const { factory } = setup(3000);
            const late = mockElement({ text: 'late item' });
            const lists = changing([[], [], [late]]);
            const list = { ...mockElement(), all: lists.read } as unknown as Element;
            expect(await factory.createInteractions().getListedElement(list, { text: 'late' })).toBe(late);
            expect(lists.reads()).toBe(3);

            const short = setup(250).factory.createInteractions();
            const error = await short.getListedElement(mockElement({ children: [] }), { text: 'never' }).catch(e => e);
            expect(error.message).toMatch(/No listed element matched \{"text":"never"\}: timed out after 250 ms/);
        });

        test('getListedElement refuses withDescendant and child, and requires a criterion', async () => {
            const { factory } = setup();
            const i = factory.createInteractions();
            const list = mockElement();
            await expect(i.getListedElement(list, { withDescendant: { child: '~x' } })).rejects.toThrow(/"withDescendant" is not available/);
            await expect(i.getListedElement(list, { text: 'a', child: '~x' })).rejects.toThrow(/"child" is not available/);
            await expect(i.getListedElement(list, {})).rejects.toThrow(/requires "text", "attribute", or "withDescendant"/);
        });
    });

    test.describe(`AppiumExtractions on ${platform}`, () => {
        test('element reads delegate to the primitives', async () => {
            const { factory } = setup();
            const x = factory.createExtractions();
            const el = mockElement({ text: '  hi  ', inputValue: 'typed', attributes: { label: 'L' }, count: 3 });
            expect(await x.getText(el)).toBe('hi');
            expect(await x.getAttribute(el, 'label')).toBe('L');
            expect(await x.getInputValue(el)).toBe('typed');
            expect(await x.getCount(el)).toBe(3);
            expect(await x.getBoundingBox(el)).toEqual({ x: 100, y: 600, width: 80, height: 40 });
            expect(await x.getAllTexts(mockElement({ children: [mockElement({ text: ' a ' }), mockElement({ text: null })] }))).toEqual(['a', '']);
        });

        test('getBoundingBox is null for an element that is not in the tree', async () => {
            const { factory } = setup();
            expect(await factory.createExtractions().getBoundingBox(mockElement({ exists: false }))).toBeNull();
        });

        test('screenshot: element via the primitive, screen via the driver (written to path when given)', async () => {
            const { factory, calls } = setup();
            const x = factory.createExtractions();
            const el = mockElement();
            expect((await x.screenshot(el, { path: '/tmp/never-written.png' })).toString()).toBe('el');
            expect(el.calls).toEqual([['screenshot', { path: '/tmp/never-written.png' }]]);
            const dir = await mkdtemp(join(tmpdir(), 'appium-shot-'));
            try {
                const file = join(dir, 'screen.png');
                const buffer = await x.screenshot(undefined, { path: file });
                expect(buffer.toString()).toBe('png-bytes');
                expect((await readFile(file)).toString()).toBe('png-bytes');
                expect(calls).toEqual([['takeScreenshot']]);
            } finally {
                await rm(dir, { recursive: true, force: true });
            }
        });
    });

    test.describe(`AppiumUtils on ${platform}`, () => {
        test('waitForState delegates to waitFor and throws on timeout', async () => {
            const utils = new AppiumUtils(1000);
            const el = mockElement();
            expect(await utils.waitForState(el, 'hidden', 300)).toBe(true);
            expect(el.calls).toEqual([['waitFor', { state: 'hidden', timeout: 300 }]]);
            const stuck = mockElement({ waitFor: async () => { throw new Error('wait timed out'); } });
            await expect(utils.waitForState(stuck)).rejects.toThrow("Element did not reach state 'visible' within 1000ms. wait timed out");
            expect(await utils.waitForState(stuck, 'visible', 10, true)).toBe(false);
        });

        test('softProbe never throws and caps its wait at 2 s', async () => {
            const utils = new AppiumUtils(60000);
            const seen: unknown[] = [];
            const el = mockElement({ waitFor: async o => { seen.push(o); throw new Error('nope'); } });
            await expect(utils.softProbe(el)).resolves.toBeUndefined();
            expect(seen).toEqual([{ state: 'attached', timeout: 2000 }]);
        });

        test('pace and repeat validate and run', async () => {
            const utils = new AppiumUtils();
            await expect(utils.pace(-1)).rejects.toThrow(/non-negative/);
            expect(await utils.repeat(i => i * 2, 3, { intervalMs: 1 })).toEqual([0, 2, 4]);
            await expect(utils.repeat(() => 1, 1.5)).rejects.toThrow(/integer/);
        });
    });
}
