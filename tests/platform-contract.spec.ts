import { test, expect, type Locator, type Page } from '@playwright/test';
import * as ElementRepositoryPackage from '@civitas-cerebrum/element-repository';
import type { Element } from '@civitas-cerebrum/element-repository';
import {
    ElementType,
    WebElement,
    PlatformNotSupportedError,
    PLATFORMS,
    isPlatformName,
    familyOf,
    PlaywrightFactory,
    PlaywrightInteractions,
    PlaywrightVerifications,
    PlaywrightExtractions,
    PlaywrightNavigation,
    Interactions,
    Verifications,
    Extractions,
    Navigation,
    Utils,
} from '../src/index';
import type { Platform, IDevice } from '../src/index';
import { PlaywrightGestures } from '../src/playwright/PlaywrightGestures';
import { PlaywrightDevice } from '../src/playwright/PlaywrightDevice';
import { ElementRepository, isFatalDriverError, SelectionStrategy, TextNotFoundError } from '@civitas-cerebrum/element-repository';
import { isCleanTextNotFound } from '../src/appium/AppiumVerifications';
import { isNoMatchAnswer } from '../src/utils/visibility';
import { DEVICE_PLATFORMS, driverError, mockUiDriver } from './appium/mocks';

/**
 * Pure unit tests for the platform interfaces: the shared vocabulary, the
 * not-supported error, and the Playwright family's factory / gestures / device.
 * No browser is launched: nothing here takes the `page` fixture, and the
 * factory is built on a stand-in object because no member touches the page
 * at construction time.
 */

const fakePage = {} as Page;

/** A stand-in element; the gesture tests below never reach the browser. */
function fakeElement(extra: Record<string, unknown> = {}): Element {
    return { ...extra } as unknown as Element;
}

/**
 * A stand-in element recording every primitive call (name and arguments).
 * `_type` makes element-repository's `isWeb` / `isPlatform` treat it as that kind.
 */
function recordingElement(type: ElementType, seen: unknown[][]): Element {
    const record = (name: string) => async (...args: unknown[]) => { seen.push([name, ...args]); };
    return fakeElement({
        _type: type,
        swipe: record('swipe'),
        scrollIntoView: record('scrollIntoView'),
        longPress: record('longPress'),
        tapAt: record('tapAt'),
        pinch: record('pinch'),
        zoom: record('zoom'),
        locator: { evaluate: record('locator.evaluate') },
    });
}

/** Reads the private default timeout a Playwright family class was built with. */
function timeoutOf(instance: object): number {
    return (instance as unknown as { ELEMENT_TIMEOUT: number }).ELEMENT_TIMEOUT;
}

async function expectNotSupported(call: () => Promise<unknown>, method: string, platform: Platform) {
    let caught: unknown;
    try {
        await call();
    } catch (error) {
        caught = error;
    }
    expect(caught, `${method} should throw`).toBeInstanceOf(PlatformNotSupportedError);
    const err = caught as PlatformNotSupportedError;
    expect(err.method).toBe(method);
    expect(err.platform).toBe(platform);
    expect(err.message).toBe(`"${method}" is not supported on platform "${platform}".`);
}

test.describe('Platform vocabulary', () => {
    test('PLATFORMS lists the five platforms', () => {
        expect([...PLATFORMS]).toEqual(['web', 'android', 'ios', 'macos', 'windows']);
    });

    test('familyOf maps web to playwright and every other platform to appium', () => {
        expect(familyOf('web')).toBe('playwright');
        expect(familyOf('android')).toBe('appium');
        expect(familyOf('ios')).toBe('appium');
        expect(familyOf('macos')).toBe('appium');
        expect(familyOf('windows')).toBe('appium');
    });

    test('familyOf throws for a value that is not a platform', () => {
        expect(() => familyOf('mobile' as never)).toThrow();
    });

    test('isPlatformName accepts exactly the platform names', () => {
        for (const p of PLATFORMS) expect(isPlatformName(p)).toBe(true);
        for (const v of ['mobile', 'native', 'appium', 'selenium', 'Web', '', undefined, null, 1, {}]) {
            expect(isPlatformName(v)).toBe(false);
        }
    });
});

test.describe('PlatformNotSupportedError', () => {
    test('carries method and platform and names both in the message', () => {
        const err = new PlatformNotSupportedError('pressBack', 'ios');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(PlatformNotSupportedError);
        expect(err.name).toBe('PlatformNotSupportedError');
        expect(err.method).toBe('pressBack');
        expect(err.platform).toBe('ios');
        expect(err.message).toBe('"pressBack" is not supported on platform "ios".');
    });
});

test.describe('Public names', () => {
    test('the Playwright* names are the historical classes', () => {
        expect(PlaywrightInteractions).toBe(Interactions);
        expect(PlaywrightVerifications).toBe(Verifications);
        expect(PlaywrightExtractions).toBe(Extractions);
        expect(PlaywrightNavigation).toBe(Navigation);
    });

    test('vocabulary and error are element-repository\'s own (identity across packages)', () => {
        expect(PlatformNotSupportedError).toBe(ElementRepositoryPackage.PlatformNotSupportedError);
        expect(familyOf).toBe(ElementRepositoryPackage.familyOf);
        expect(isPlatformName).toBe(ElementRepositoryPackage.isPlatformName);
        expect(PLATFORMS).toBe(ElementRepositoryPackage.PLATFORMS);
        expect(new PlatformNotSupportedError('x', 'ios')).toBeInstanceOf(ElementRepositoryPackage.PlatformNotSupportedError);
        expect(new ElementRepositoryPackage.PlatformNotSupportedError('y', 'android')).toBeInstanceOf(PlatformNotSupportedError);
    });
});

test.describe('PlaywrightFactory', () => {
    test('reports web / playwright', () => {
        const factory = new PlaywrightFactory(fakePage);
        expect(factory.platform).toBe('web');
        expect(factory.family).toBe('playwright');
    });

    test('creates every family member', () => {
        const factory = new PlaywrightFactory(fakePage, { timeout: 1234 });
        expect(factory.createInteractions()).toBeInstanceOf(Interactions);
        expect(factory.createVerifications()).toBeInstanceOf(Verifications);
        expect(factory.createExtractions()).toBeInstanceOf(Extractions);
        expect(factory.createNavigation()).toBeInstanceOf(Navigation);
        const utils = factory.createUtils();
        expect(utils).toBeInstanceOf(Utils);
        expect(utils.getTimeout()).toBe(1234);
        expect(factory.createGestures()).toBeInstanceOf(PlaywrightGestures);
        expect(factory.createDevice()).toBeInstanceOf(PlaywrightDevice);
    });

    test('timeout reaches gestures, interactions, verifications, extractions and utils', async () => {
        const factory = new PlaywrightFactory(fakePage, { timeout: 4321 });
        expect(timeoutOf(factory.createInteractions())).toBe(4321);
        expect(timeoutOf(factory.createVerifications())).toBe(4321);
        expect(timeoutOf(factory.createExtractions())).toBe(4321);
        expect(factory.createUtils().getTimeout()).toBe(4321);
        const seen: unknown[][] = [];
        await factory.createGestures().longPress(recordingElement(ElementType.WEB, seen));
        expect(seen).toEqual([['longPress', { timeout: 4321 }]]);
    });

    test('without options every member uses the default timeout (30000)', async () => {
        const factory = new PlaywrightFactory(fakePage);
        expect(timeoutOf(factory.createInteractions())).toBe(30000);
        expect(timeoutOf(factory.createVerifications())).toBe(30000);
        expect(timeoutOf(factory.createExtractions())).toBe(30000);
        expect(factory.createUtils().getTimeout()).toBe(30000);
        const seen: unknown[][] = [];
        await factory.createGestures().swipe(recordingElement(ElementType.WEB, seen), 'down');
        expect(seen).toEqual([['swipe', 'down', { timeout: 30000 }]]);
    });

    test('interceptionRetry reaches Interactions (default true, false when given)', () => {
        const retryOf = (i: object) => (i as unknown as { interceptionRetry: boolean }).interceptionRetry;
        expect(retryOf(new PlaywrightFactory(fakePage).createInteractions())).toBe(true);
        expect(retryOf(new PlaywrightFactory(fakePage, { interceptionRetry: false }).createInteractions())).toBe(false);
    });
});

test.describe('PlaywrightDevice', () => {
    const device: IDevice = new PlaywrightDevice();
    const calls: Array<[string, () => Promise<unknown>]> = [
        ['launchApp', () => device.launchApp('com.example.app')],
        ['activateApp', () => device.activateApp()],
        ['terminateApp', () => device.terminateApp()],
        ['backgroundApp', () => device.backgroundApp(1)],
        ['resetApp', () => device.resetApp()],
        ['installApp', () => device.installApp('/tmp/app.apk')],
        ['removeApp', () => device.removeApp('com.example.app')],
        ['openDeepLink', () => device.openDeepLink('example://home')],
        ['isAppInForeground', () => device.isAppInForeground()],
        ['pressBack', () => device.pressBack()],
        ['hideKeyboard', () => device.hideKeyboard()],
        ['isKeyboardShown', () => device.isKeyboardShown()],
        ['getOrientation', () => device.getOrientation()],
        ['setOrientation', () => device.setOrientation('landscape')],
        ['acceptAlert', () => device.acceptAlert()],
        ['dismissAlert', () => device.dismissAlert()],
        ['setPermission', () => device.setPermission('camera', 'grant')],
        ['getContexts', () => device.getContexts()],
        ['getContext', () => device.getContext()],
        ['switchContext', () => device.switchContext('NATIVE_APP')],
        ['getPageSource', () => device.getPageSource()],
        ['verifyAppInForeground', () => device.verifyAppInForeground()],
        ['verifyOrientation', () => device.verifyOrientation('portrait')],
        ['verifyKeyboardShown', () => device.verifyKeyboardShown()],
        ['verifyContext', () => device.verifyContext('NATIVE_APP')],
    ];

    test('supports nothing and resolves no app id', () => {
        expect(device.supports('pressBack')).toBe(false);
        expect(device.supports('launchApp')).toBe(false);
        expect(device.resolveAppId('launchApp')).toBeUndefined();
        expect(device.resolveAppId('launchApp', 'com.example.app')).toBeUndefined();
    });

    for (const [method, call] of calls) {
        test(`${method} throws PlatformNotSupportedError on web`, async () => {
            await expectNotSupported(call, method, 'web');
        });
    }

    test('every IDevice method is covered above', () => {
        const proto = Object.getOwnPropertyNames(PlaywrightDevice.prototype).filter(n => n !== 'constructor');
        expect(proto.sort()).toEqual([...calls.map(([m]) => m), 'supports', 'resolveAppId'].sort());
    });
});

test.describe('PlaywrightGestures', () => {
    const gestures = new PlaywrightGestures();

    /** Screen-level gestures: no element and no browser meaning, so they throw on web. */
    const throwsOnWeb: Array<[string, () => Promise<unknown>]> = [
        ['swipeScreen', () => gestures.swipeScreen('up', { distance: 100 })],
        ['tapAt', () => gestures.tapAt(10, 20)],
    ];

    /** Element-level gestures: each delegates to one Element primitive, options passed through. */
    const delegates: Array<[string, (el: Element) => Promise<unknown>, unknown[]]> = [
        ['swipe', el => gestures.swipe(el, 'left', { distance: 100, timeout: 500 }), ['swipe', 'left', { distance: 100, timeout: 500 }]],
        ['scrollIntoView', el => gestures.scrollIntoView(el, { direction: 'down', timeout: 500 }), ['scrollIntoView', { direction: 'down', timeout: 500 }]],
        ['scrollUntilFound', el => gestures.scrollUntilFound(el, { direction: 'up', timeout: 700 }), ['scrollIntoView', { direction: 'up', timeout: 700 }]],
        ['longPress', el => gestures.longPress(el, { duration: 800, timeout: 500 }), ['longPress', { duration: 800, timeout: 500 }]],
        ['tapAtElement', el => gestures.tapAtElement(el, { x: 3, y: 4 }, { timeout: 500 }), ['tapAt', { x: 3, y: 4 }, { timeout: 500 }]],
        ['pinch', el => gestures.pinch(el, { scale: 0.4, timeout: 500 }), ['pinch', { scale: 0.4, timeout: 500 }]],
        ['zoom', el => gestures.zoom(el, { scale: 3, timeout: 500 }), ['zoom', { scale: 3, timeout: 500 }]],
    ];

    /** Web-element-only composition (scrollIntoView, then centre in the viewport); tested below. */
    const webElementOnly = ['centerElement'];

    for (const [method, call] of throwsOnWeb) {
        test(`${method} throws PlatformNotSupportedError on web`, async () => {
            await expectNotSupported(call, method, 'web');
        });
    }

    for (const [method, call, expected] of delegates) {
        test(`${method} delegates to the Element primitive`, async () => {
            const seen: unknown[][] = [];
            await call(recordingElement(ElementType.WEB, seen));
            expect(seen).toEqual([expected]);
        });
    }

    test('every IGestures method is covered above', () => {
        const proto = Object.getOwnPropertyNames(PlaywrightGestures.prototype).filter(n => n !== 'constructor');
        const covered = [...throwsOnWeb.map(([m]) => m), ...delegates.map(([m]) => m), ...webElementOnly];
        expect(proto.sort()).toEqual(covered.sort());
    });

    test('omitted options fall back to the default timeout (30000)', async () => {
        const seen: unknown[][] = [];
        const el = recordingElement(ElementType.WEB, seen);
        await gestures.swipe(el, 'up');
        await gestures.scrollIntoView(el);
        await gestures.scrollUntilFound(el);
        await gestures.longPress(el);
        await gestures.tapAtElement(el, { x: 1, y: 2 });
        await gestures.pinch(el);
        await gestures.zoom(el);
        expect(seen).toEqual([
            ['swipe', 'up', { timeout: 30000 }],
            ['scrollIntoView', { timeout: 30000 }],
            ['scrollIntoView', { timeout: 30000 }],
            ['longPress', { timeout: 30000 }],
            ['tapAt', { x: 1, y: 2 }, { timeout: 30000 }],
            ['pinch', { timeout: 30000 }],
            ['zoom', { timeout: 30000 }],
        ]);
    });

    test('a constructor timeout replaces the default; a per-call timeout wins over both', async () => {
        const seen: unknown[][] = [];
        const el = recordingElement(ElementType.WEB, seen);
        const custom = new PlaywrightGestures(1500);
        await custom.longPress(el, { duration: 200 });
        await custom.longPress(el, { duration: 200, timeout: 50 });
        expect(seen).toEqual([
            ['longPress', { duration: 200, timeout: 1500 }],
            ['longPress', { duration: 200, timeout: 50 }],
        ]);
    });

    test('pinch and zoom on a real web element throw element-repository\'s PlatformNotSupportedError', async () => {
        const el = new WebElement({} as Locator, 'css=.x', 1000);
        await expectNotSupported(() => gestures.pinch(el), 'pinch', 'web');
        await expectNotSupported(() => gestures.zoom(el), 'zoom', 'web');
    });

    test('centerElement scrolls a web element into view, then centres it, with the timeout', async () => {
        const seen: unknown[][] = [];
        await gestures.centerElement(recordingElement(ElementType.WEB, seen), { timeout: 900 });
        expect(seen).toHaveLength(2);
        expect(seen[0]).toEqual(['scrollIntoView', { timeout: 900 }]);
        expect(seen[1][0]).toBe('locator.evaluate');
        expect(typeof seen[1][1]).toBe('function');
        expect(seen[1][3]).toEqual({ timeout: 900 });
    });

    test('centerElement uses the default timeout when none is given', async () => {
        const seen: unknown[][] = [];
        await gestures.centerElement(recordingElement(ElementType.WEB, seen));
        expect(seen[0]).toEqual(['scrollIntoView', { timeout: 30000 }]);
        expect(seen[1][3]).toEqual({ timeout: 30000 });
    });

    test('centerElement rejects a non-web element with a clear error and touches nothing', async () => {
        const seen: unknown[][] = [];
        await expect(gestures.centerElement(recordingElement(ElementType.PLATFORM, seen)))
            .rejects.toThrow(/centerElement needs a web \(Playwright\) element/);
        expect(seen).toEqual([]);
    });
});

/**
 * The Appium family tells a clean text-strategy miss from a pass cut short
 * by a driver error by element-repository's `TextNotFoundError` and its
 * `cleanMiss`. These pin the type and its fields against the installed
 * package.
 */
for (const platform of DEVICE_PLATFORMS) {
    test.describe(`element-repository's text not-found on ${platform}`, () => {
        const PAGES = { pages: [{ name: 'Screen', platform, elements: [{ elementName: 'items', selector: { 'accessibility id': 'item' } }] }] };
        const TREE = [{ match: '~item', text: 'Red 1' }, { match: '~item', text: 'Blue 1' }];

        async function notFound(mock: ReturnType<typeof mockUiDriver>, timeout = 1): Promise<TextNotFoundError> {
            const repo = new ElementRepository(mock.driver, PAGES, { platform, timeout });
            const error = await repo.get('items', 'Screen', { strategy: SelectionStrategy.TEXT, value: 'Nope' }).then(() => undefined, (e: unknown) => e);
            expect(error, `element-repository's text not-found is no longer a TextNotFoundError: ${String(error)}`).toBeInstanceOf(TextNotFoundError);
            return error as TextNotFoundError;
        }

        /** The mock's `$$` of the entry's selector fails with a stale element on the n-th call (from 1) when `fail(n)`. */
        function failingLookups(mock: ReturnType<typeof mockUiDriver>, fail: (n: number) => boolean): void {
            const driver = mock.driver as unknown as Record<string, (s: string) => Promise<unknown>>;
            const original = driver.$$;
            let n = 0;
            driver.$$ = async (selector: string) => {
                // element-repository's narrowing query (which the mock rejects) is not counted.
                if (selector === '~item' && fail(++n)) throw driverError('stale element reference', 'stale element reference: the list was redrawn');
                return original(selector);
            };
        }

        test('a clean miss: cleanMiss, the entry, the text and no driver error', async () => {
            const error = await notFound(mockUiDriver(TREE, { capabilities: { platformName: platform } }));
            expect(error).toMatchObject({ name: 'TextNotFoundError', elementName: 'items', pageName: 'Screen', text: 'Nope', cleanMiss: true });
            expect(error.lastDriverError).toBeUndefined();
            expect(error.message).toBe(`Element 'items' on 'Screen' with text "Nope" not found.`);
            expect(isCleanTextNotFound(error)).toBe(true);
        });

        test('a miss whose final pass failed is not clean, and carries the driver error', async () => {
            const mock = mockUiDriver(TREE, { capabilities: { platformName: platform } });
            failingLookups(mock, () => true);
            const error = await notFound(mock);
            expect(error.cleanMiss).toBe(false);
            expect((error.lastDriverError as Error).name).toBe('stale element reference');
            expect(error.message).toMatch(/last driver error: stale element reference/);
            expect(isCleanTextNotFound(error)).toBe(false);
        });

        test('a miss whose earlier pass failed and whose final pass read every match is clean', async () => {
            const mock = mockUiDriver(TREE, { capabilities: { platformName: platform } });
            failingLookups(mock, n => n === 1);
            const error = await notFound(mock, 400);
            expect(error.cleanMiss).toBe(true);
            expect((error.lastDriverError as Error).name).toBe('stale element reference');
            expect(isCleanTextNotFound(error)).toBe(true);
        });
    });
}

test('only a TextNotFoundError is a text not-found: the same message on a plain Error is not', () => {
    expect(isCleanTextNotFound(new Error(`Element 'items' on 'Screen' with text "Nope" not found.`))).toBe(false);
    expect(isCleanTextNotFound(new TextNotFoundError({ elementName: 'items', pageName: 'Screen', text: 'Nope' }))).toBe(true);
    expect(isCleanTextNotFound(new TextNotFoundError({ elementName: 'items', pageName: 'Screen', text: 'Nope', cleanMiss: false }))).toBe(false);
    expect(isCleanTextNotFound(undefined)).toBe(false);
});

/**
 * A device visibility read is "not visible" only for a no-match answer
 * (`isNoMatchAnswer`). element-repository throws several of those as a
 * plain `Error` (no class), so they are matched by message: these pin each
 * against the installed package, from real lookups that find nothing.
 */
for (const platform of DEVICE_PLATFORMS) {
    test.describe(`element-repository's no-match answers on ${platform}`, () => {
        const PAGES = { pages: [{ name: 'Screen', platform, elements: [{ elementName: 'items', selector: { 'accessibility id': 'item' } }] }] };
        const TREE = [{ match: '~item', text: 'Red 1', visible: false, attributes: { name: 'red' } }];

        async function failure(lookup: (repo: ElementRepository) => Promise<unknown>): Promise<unknown> {
            const repo = new ElementRepository(mockUiDriver(TREE, { capabilities: { platformName: platform } }).driver, PAGES, { platform, timeout: 1 });
            return lookup(repo).then(() => undefined, (e: unknown) => e);
        }

        test('each no-match answer of a lookup is recognised, by its message where it has no class', async () => {
            const answers = {
                index: await failure(repo => repo.get('items', 'Screen', { strategy: SelectionStrategy.INDEX, index: 4 })),
                attribute: await failure(repo => repo.get('items', 'Screen', { strategy: SelectionStrategy.ATTRIBUTE, attribute: 'name', value: 'blue' })),
                visible: await failure(repo => repo.getVisible('items', 'Screen', true)),
                text: await failure(repo => repo.get('items', 'Screen', { strategy: SelectionStrategy.TEXT, value: 'Nope' })),
            };
            for (const [name, error] of Object.entries(answers)) {
                expect(error, `${name}: the lookup must fail`).toBeInstanceOf(Error);
                expect(isNoMatchAnswer(error), `${name}: element-repository's no-match wording changed: ${(error as Error).message}`).toBe(true);
            }
        });

        test('RANDOM and ATTRIBUTE answer "No elements found" for a dead session too: by itself it is never a no-match', async () => {
            for (const options of [
                { strategy: SelectionStrategy.RANDOM },
                { strategy: SelectionStrategy.ATTRIBUTE, attribute: 'name', value: 'red' },
            ]) {
                const mock = mockUiDriver(TREE, { capabilities: { platformName: platform } });
                mock.failWith(driverError('invalid session id', 'invalid session id: the session is gone'));
                const repo = new ElementRepository(mock.driver, PAGES, { platform, timeout: 1 });
                const error = await repo.get('items', 'Screen', options).then(() => undefined, (e: unknown) => e);
                // element-repository hides the dead session behind its "no elements" message.
                expect((error as Error).message, options.strategy).toBe(`No elements found for 'items' on 'Screen'`);
                expect(isFatalDriverError(error), options.strategy).toBe(false);
                expect(isNoMatchAnswer(error), options.strategy).toBe(false);
            }
        });
    });
}

test('no-match answers of the driver are recognised; every other error is no answer', () => {
    expect(isNoMatchAnswer(driverError('no such element', 'An element could not be located on the page using the given search parameters.'))).toBe(true);
    expect(isNoMatchAnswer(new Error('no such element: Unable to locate element'))).toBe(true);
    expect(isNoMatchAnswer(new Error(`Can't call isDisplayed on element with selector "~x" because element wasn't found`))).toBe(true);
    expect(isNoMatchAnswer(new TextNotFoundError({ elementName: 'a', pageName: 'b', text: 'c', cleanMiss: false }))).toBe(false);
    expect(isNoMatchAnswer(driverError('unknown error', 'An unknown server-side error occurred: no such element was mentioned deeper'))).toBe(false);
    expect(isNoMatchAnswer(driverError('stale element reference', 'stale element reference: the row was redrawn'))).toBe(false);
    expect(isNoMatchAnswer('no such element')).toBe(false);
});
