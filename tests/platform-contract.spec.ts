import { test, expect, type Page } from '@playwright/test';
import type { Element } from '@civitas-cerebrum/element-repository';
import {
    PlatformNotSupportedError,
    PLATFORMS,
    isPlatformName,
    familyOf,
    PlaywrightFactory,
    PlaywrightGestures,
    PlaywrightDevice,
    Interactions,
    Verifications,
    Extractions,
    Navigation,
    Utils,
} from '../src/index';
import type { Platform, IDevice } from '../src/index';

/**
 * Pure unit tests for the platform contract: the shared vocabulary, the
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
    ];

    for (const [method, call] of calls) {
        test(`${method} throws PlatformNotSupportedError on web`, async () => {
            await expectNotSupported(call, method, 'web');
        });
    }

    test('every IDevice method is covered above', () => {
        const proto = Object.getOwnPropertyNames(PlaywrightDevice.prototype).filter(n => n !== 'constructor');
        expect(proto.sort()).toEqual(calls.map(([m]) => m).sort());
    });
});

test.describe('PlaywrightGestures', () => {
    const gestures = new PlaywrightGestures();

    test('swipeScreen throws PlatformNotSupportedError on web', async () => {
        await expectNotSupported(() => gestures.swipeScreen('up'), 'swipeScreen', 'web');
    });

    test('tapAt (screen coordinates) throws PlatformNotSupportedError on web', async () => {
        await expectNotSupported(() => gestures.tapAt(10, 20), 'tapAt', 'web');
    });

    test('pinch throws PlatformNotSupportedError on web', async () => {
        await expectNotSupported(() => gestures.pinch(fakeElement(), { scale: 0.5 }), 'pinch', 'web');
    });

    test('zoom throws PlatformNotSupportedError on web', async () => {
        await expectNotSupported(() => gestures.zoom(fakeElement(), { scale: 2 }), 'zoom', 'web');
    });

    test('longPress delegates to the Element primitive when it exists', async () => {
        const seen: unknown[] = [];
        const el = fakeElement({ longPress: async (opts: unknown) => { seen.push(opts); } });
        await gestures.longPress(el, { duration: 800, timeout: 500 });
        expect(seen).toEqual([{ duration: 800, timeout: 500 }]);
    });

    test('longPress names the missing Element primitive when it does not exist', async () => {
        await expect(gestures.longPress(fakeElement())).rejects.toThrow(/Element primitive "longPress"/);
    });

    test('tapAtElement delegates to the Element primitive when it exists', async () => {
        const seen: unknown[] = [];
        const el = fakeElement({ tapAt: async (offset: unknown, opts: unknown) => { seen.push([offset, opts]); } });
        await gestures.tapAtElement(el, { x: 3, y: 4 }, { timeout: 500 });
        expect(seen).toEqual([[{ x: 3, y: 4 }, { timeout: 500 }]]);
    });

    test('tapAtElement names the missing Element primitive when it does not exist', async () => {
        await expect(gestures.tapAtElement(fakeElement(), { x: 1, y: 1 })).rejects.toThrow(/Element primitive "tapAt"/);
    });

    test('swipe, scrollIntoView and scrollUntilFound delegate to the Element', async () => {
        const seen: unknown[] = [];
        const el = fakeElement({
            swipe: async (direction: unknown, opts: unknown) => { seen.push(['swipe', direction, opts]); },
            scrollIntoView: async (opts: unknown) => { seen.push(['scrollIntoView', opts]); },
        });
        await gestures.swipe(el, 'left', { distance: 100, timeout: 500 });
        await gestures.scrollIntoView(el, { direction: 'down', timeout: 500 });
        await gestures.scrollUntilFound(el, { direction: 'up', timeout: 700 });
        expect(seen).toEqual([
            ['swipe', 'left', { distance: 100, timeout: 500 }],
            ['scrollIntoView', { direction: 'down', timeout: 500 }],
            ['scrollIntoView', { direction: 'up', timeout: 700 }],
        ]);
    });
});
