import { test, expect } from '@playwright/test';
import { SelectionStrategy, WebElement, type Element, type ElementRepository } from '@civitas-cerebrum/element-repository';
import { Steps } from '../src/steps/CommonSteps';
import { AppiumFactory } from '../src/appium';
import { PollTimeoutError } from '../src/utils/poll';
import { mockDriver, mockElement, driverError, expectNotSupported, screenSwipes, DEVICE_PLATFORMS, type Call } from './appium/mocks';

/**
 * Unit tests (no device, no browser) for the step options of the gesture
 * steps and the device assertions: the gesture steps take the `StepOptions`
 * every element step takes (strategy, index, per-call timeout) and are on the
 * fluent chain too; the device assertions take `{ timeout, errorMessage }`
 * and `verifyKeyboardShown` takes `negated`.
 */

const CAPS = {
    android: { platformName: 'Android', 'appium:appPackage': 'com.example.app' },
    ios: { platformName: 'iOS', 'appium:bundleId': 'com.example.App' },
} as const;

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

/** Steps over a real AppiumFactory on the mock driver; the factory (step) timeout is `timeout`. */
function deviceSteps(platform: (typeof DEVICE_PLATFORMS)[number], timeout = 400, element = mockElement({ selector: '~cards' })) {
    const mock = mockDriver({ capabilities: { ...CAPS[platform] } });
    const repoCalls: Call[] = [];
    const steps = new Steps(new AppiumFactory(mock.driver, platform, { timeout }), stubRepo(repoCalls, element));
    return { steps, mock, element, repoCalls };
}

async function caught(call: () => unknown): Promise<unknown> {
    try {
        await call();
    } catch (error) {
        return error;
    }
    return undefined;
}

const INDEX_2 = { strategy: SelectionStrategy.INDEX, index: 2 };

for (const platform of DEVICE_PLATFORMS) {
    test.describe(`gesture steps take StepOptions on ${platform}`, () => {
        test('swipe resolves with the strategy and forwards distance and the per-call timeout', async () => {
            const { steps, element, repoCalls } = deviceSteps(platform);
            await steps.swipe('cards', 'Home', 'left', { strategy: 'index', index: 2, distance: 120, timeout: 700 });
            await steps.swipe('cards', 'Home', 'up');
            expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', INDEX_2], ['repo', 'get', 'cards', 'Home', undefined]]);
            expect(element.calls).toEqual([['swipe', 'left', { distance: 120, timeout: 700 }], ['swipe', 'up', { timeout: 400 }]]);
        });

        test('longPress resolves with the strategy and forwards duration and the per-call timeout', async () => {
            const { steps, element, repoCalls } = deviceSteps(platform);
            await steps.longPress('cards', 'Home', { strategy: 'index', index: 2, duration: 900, timeout: 650 });
            expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', INDEX_2]]);
            expect(element.calls).toEqual([['longPress', { duration: 900, timeout: 650 }]]);
        });

        test('pinch and zoom resolve with the strategy and forward scale and the per-call timeout', async () => {
            const { steps, element, repoCalls } = deviceSteps(platform);
            await steps.pinch('cards', 'Home', { strategy: 'index', index: 2, scale: 0.4, timeout: 600 });
            await steps.zoom('cards', 'Home', { strategy: 'text', text: 'Map', scale: 3, timeout: 600 });
            expect(repoCalls).toEqual([
                ['repo', 'get', 'cards', 'Home', INDEX_2],
                ['repo', 'get', 'cards', 'Home', { strategy: SelectionStrategy.TEXT, value: 'Map' }],
            ]);
            expect(element.calls).toEqual([['pinch', { scale: 0.4, timeout: 600 }], ['zoom', { scale: 3, timeout: 600 }]]);
        });

        test('scrollUntilFound resolves with the strategy and its per-call timeout wins over the step timeout', async () => {
            const { steps, repoCalls, mock } = deviceSteps(platform, 30000, mockElement({ visible: false }));
            const started = Date.now();
            const error = await caught(() => steps.scrollUntilFound('cards', 'Home', { strategy: 'index', index: 2, direction: 'up', timeout: 300 }));
            expect(Date.now() - started, 'the per-call timeout, not the 30 s step timeout').toBeLessThan(5000);
            expect((error as Error).message).toMatch(/scrolling up within 300 ms/);
            expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', INDEX_2]]);
            expect(new Set(screenSwipes(mock.calls).map(s => s.direction))).toEqual(new Set(['down']));
        });

        test('scrollIntoView resolves with the strategy and forwards direction and the per-call timeout', async () => {
            const { steps, element, repoCalls } = deviceSteps(platform);
            await steps.scrollIntoView('cards', 'Home', { strategy: 'index', index: 2, direction: 'up', timeout: 650 });
            await steps.scrollIntoView('cards', 'Home');
            expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', INDEX_2], ['repo', 'get', 'cards', 'Home', undefined]]);
            expect(element.calls).toEqual([['scrollIntoView', { direction: 'up', timeout: 650 }], ['scrollIntoView', { timeout: 400 }]]);
        });
    });

    test.describe(`gesture terminals on the fluent chain on ${platform}`, () => {
        test('swipe / longPress / pinch / zoom act on the element the chain selects, with the chain timeout', async () => {
            const { steps, element, repoCalls } = deviceSteps(platform);
            await steps.on('cards', 'Home').nth(2).swipe('left', { distance: 120 });
            await steps.on('cards', 'Home').nth(2).longPress({ duration: 900 });
            await steps.on('cards', 'Home').byText('Map').pinch({ scale: 0.4 });
            await steps.on('cards', 'Home').zoom();
            expect(repoCalls).toEqual([
                ['repo', 'get', 'cards', 'Home', INDEX_2],
                ['repo', 'get', 'cards', 'Home', INDEX_2],
                ['repo', 'get', 'cards', 'Home', { strategy: SelectionStrategy.TEXT, value: 'Map' }],
                ['repo', 'get', 'cards', 'Home', {}],
            ]);
            expect(element.calls).toEqual([
                ['swipe', 'left', { distance: 120, timeout: 400 }],
                ['longPress', { duration: 900, timeout: 400 }],
                ['pinch', { scale: 0.4, timeout: 400 }],
                ['zoom', { timeout: 400 }],
            ]);
        });

        test('.timeout(ms) and the options timeout reach the gesture', async () => {
            const { steps, element } = deviceSteps(platform);
            await steps.on('cards', 'Home').timeout(1234).swipe('right');
            await steps.on('cards', 'Home').timeout(1234).longPress({ timeout: 55 });
            expect(element.calls).toEqual([['swipe', 'right', { timeout: 1234 }], ['longPress', { timeout: 55 }]]);
        });

        test('scrollUntilFound on the chain swipes the screen until the element is displayed', async () => {
            let reads = 0;
            const { steps, mock, repoCalls } = deviceSteps(platform, 5000, mockElement({ visible: () => ++reads >= 3 }));
            await steps.on('cards', 'Home').nth(2).scrollUntilFound({ direction: 'right' });
            expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', INDEX_2]]);
            expect(screenSwipes(mock.calls).map(s => s.direction)).toEqual(['left', 'left']);
        });

        test('an ifVisible() gate skips a gesture on a hidden element', async () => {
            const { steps, element } = deviceSteps(platform, 400, mockElement({ visible: false }));
            await steps.on('cards', 'Home').ifVisible(150).swipe('left');
            await steps.on('cards', 'Home').ifVisible(150).longPress();
            expect(element.calls).toEqual([]);
        });

        test('an ifVisible() gate runs the gesture on a visible element', async () => {
            const { steps, element } = deviceSteps(platform, 400, mockElement({ visible: true }));
            await steps.on('cards', 'Home').ifVisible(150).swipe('left');
            await steps.on('cards', 'Home').ifVisible(150).longPress();
            expect(element.calls).toEqual([['swipe', 'left', { timeout: 400 }], ['longPress', { timeout: 400 }]]);
        });

        test('a fatal driver error in the ifVisible() gate is thrown and no gesture is sent', async () => {
            const dead = driverError('invalid session id');
            const { steps, element, mock } = deviceSteps(platform, 400, mockElement({ visible: () => { throw dead; } }));
            expect(await caught(() => steps.on('cards', 'Home').ifVisible(150).swipe('left'))).toBe(dead);
            expect(element.calls).toEqual([]);
            expect(screenSwipes(mock.calls)).toEqual([]);
        });
    });

    test.describe(`device assertions take { timeout, errorMessage } on ${platform}`, () => {
        test('verifyAppInForeground: the per-call timeout wins and errorMessage leads the failure', async () => {
            const { steps, mock } = deviceSteps(platform, 30000);
            mock.executeResults['mobile: queryAppState'] = 3;
            const started = Date.now();
            const error = await caught(() => steps.verifyAppInForeground(undefined, { timeout: 300, errorMessage: 'the app should be up' }));
            expect(Date.now() - started).toBeLessThan(3000);
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect((error as Error).message).toMatch(/^the app should be up: timed out after 300 ms\. Last value: false\./);
        });

        test('verifyOrientation: the per-call timeout wins and errorMessage leads the failure', async () => {
            const { steps } = deviceSteps(platform, 30000);
            const error = await caught(() => steps.verifyOrientation('landscape', { timeout: 250, errorMessage: 'rotate first' }));
            expect((error as Error).message).toMatch(/^rotate first: timed out after 250 ms\. Last value: "portrait"\./);
        });

        test('verifyContext: the per-call timeout wins; without errorMessage the default header stays', async () => {
            const { steps } = deviceSteps(platform, 30000);
            const error = await caught(() => steps.verifyContext('WEBVIEW_9', { timeout: 250 }));
            expect((error as Error).message).toMatch(/^verifyContext: expected context "WEBVIEW_9": timed out after 250 ms\./);
        });

        test('verifyKeyboardShown({ negated: true }) waits for the keyboard to hide', async () => {
            const { steps, mock } = deviceSteps(platform, 3000);
            mock.executeResults['mobile: isKeyboardShown'] = true;
            setTimeout(() => { mock.executeResults['mobile: isKeyboardShown'] = false; }, 200);
            await steps.verifyKeyboardShown({ negated: true });

            mock.executeResults['mobile: isKeyboardShown'] = true;
            const error = await caught(() => steps.verifyKeyboardShown({ negated: true, timeout: 250, errorMessage: 'keyboard still up' }));
            expect((error as Error).message).toMatch(/^keyboard still up: timed out after 250 ms\. Last value: true\./);

            const shown = await caught(() => steps.verifyKeyboardShown({ timeout: 250 }));
            expect(shown, 'without negated the keyboard must be shown').toBeUndefined();
        });

        test('without options the step timeout applies', async () => {
            const { steps } = deviceSteps(platform, 300);
            const started = Date.now();
            const error = await caught(() => steps.verifyOrientation('landscape'));
            expect(Date.now() - started).toBeLessThan(3000);
            expect((error as Error).message).toContain('timed out after 300 ms');
        });
    });
}

test.describe('gesture terminals on web', () => {
    function webSteps() {
        const repoCalls: Call[] = [];
        const calls: string[] = [];
        const web = new WebElement({} as never, 'css=.cards');
        for (const name of ['swipe', 'longPress', 'scrollIntoView', 'pinch', 'zoom']) {
            (web as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => { calls.push(`${name} ${JSON.stringify(args)}`); };
        }
        const steps = new Steps(stubRepo(repoCalls, web, { url: () => 'about:blank' }), { timeout: 900 });
        return { steps, repoCalls, calls };
    }

    for (const name of ['pinch', 'zoom'] as const) {
        test(`steps.on().${name}() throws PlatformNotSupportedError("${name}", "web") before resolving`, async () => {
            const { steps, repoCalls, calls } = webSteps();
            await expectNotSupported(() => steps.on('cards', 'Home').nth(1)[name]({ scale: 2 }), name, 'web');
            expect(repoCalls).toEqual([]);
            expect(calls).toEqual([]);
        });
    }

    test('swipe / longPress / scrollUntilFound follow the element primitive with the strategy and the chain timeout', async () => {
        const { steps, repoCalls, calls } = webSteps();
        await steps.on('cards', 'Home').nth(1).swipe('left', { distance: 80 });
        await steps.on('cards', 'Home').longPress({ duration: 700 });
        await steps.on('cards', 'Home').scrollUntilFound({ timeout: 500 });
        expect(repoCalls).toEqual([
            ['repo', 'get', 'cards', 'Home', { strategy: SelectionStrategy.INDEX, index: 1 }],
            ['repo', 'get', 'cards', 'Home', {}],
            ['repo', 'get', 'cards', 'Home', {}],
        ]);
        expect(calls).toEqual([
            'swipe ["left",{"distance":80,"timeout":900}]',
            'longPress [{"duration":700,"timeout":900}]',
            'scrollIntoView [{"timeout":500}]',
        ]);
    });

    test('scrollIntoView forwards the per-call timeout; without one the step timeout applies as before', async () => {
        const { steps, repoCalls, calls } = webSteps();
        await steps.scrollIntoView('cards', 'Home', { strategy: 'index', index: 1, timeout: 450 });
        await steps.scrollIntoView('cards', 'Home');
        expect(repoCalls).toEqual([
            ['repo', 'get', 'cards', 'Home', { strategy: SelectionStrategy.INDEX, index: 1 }],
            ['repo', 'get', 'cards', 'Home', undefined],
        ]);
        expect(calls).toEqual(['scrollIntoView [{"timeout":450}]', 'scrollIntoView [{"timeout":900}]']);
    });

    test('a web gesture step honours the strategy too', async () => {
        const { steps, repoCalls, calls } = webSteps();
        await steps.swipe('cards', 'Home', 'right', { strategy: 'index', index: 3, timeout: 450 });
        expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', { strategy: SelectionStrategy.INDEX, index: 3 }]]);
        expect(calls).toEqual(['swipe ["right",{"timeout":450}]']);
    });

    test('device assertions on web refuse before anything (their options do not matter)', async () => {
        const { steps } = webSteps();
        await expectNotSupported(() => steps.verifyKeyboardShown({ negated: true, timeout: 1 }), 'verifyKeyboardShown', 'web');
        await expectNotSupported(() => steps.verifyAppInForeground('x', { errorMessage: 'm' }), 'verifyAppInForeground', 'web');
    });
});
