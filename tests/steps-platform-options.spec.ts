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

/**
 * Steps over a real AppiumFactory whose repository answers `carousel` with a
 * container element, `card` with the target and throws, as the repository
 * does, for any other name.
 */
function containerSteps(platform: (typeof DEVICE_PLATFORMS)[number]) {
    const mock = mockDriver({ capabilities: { ...CAPS[platform] } });
    const repoCalls: Call[] = [];
    const target = mockElement({ selector: '~card' });
    const carousel = mockElement({ selector: '~carousel' });
    const repo = stubRepo(repoCalls, target);
    (repo as unknown as Record<string, unknown>).get = async (name: string, page: string, options?: unknown) => {
        repoCalls.push(['repo', 'get', name, page, options]);
        if (name === 'card') return target;
        if (name === 'carousel') return carousel;
        throw new Error(`ElementRepository: Element '${name}' not found on page '${page}'.`);
    };
    const steps = new Steps(new AppiumFactory(mock.driver, platform, { timeout: 400 }), repo);
    return { steps, target, carousel, repoCalls };
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
            const { steps, element, repoCalls, mock } = deviceSteps(platform, 30000);
            await steps.scrollUntilFound('cards', 'Home', { strategy: 'index', index: 2, direction: 'up', maxSwipes: 3, timeout: 300 });
            await steps.scrollUntilFound('cards', 'Home');
            expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', INDEX_2], ['repo', 'get', 'cards', 'Home', undefined]]);
            // element-repository's scrollIntoView, always with a timeout: the sweep is time-bounded
            expect(element.calls).toEqual([
                ['scrollIntoView', { direction: 'up', maxSwipes: 3, timeout: 300 }],
                ['scrollIntoView', { timeout: 30000 }],
            ]);
            expect(mock.calls, 'no screen swipe of its own').toEqual([]);
        });

        test('scrollIntoView resolves with the strategy and forwards direction and the per-call timeout', async () => {
            const { steps, element, repoCalls } = deviceSteps(platform);
            await steps.scrollIntoView('cards', 'Home', { strategy: 'index', index: 2, direction: 'up', maxSwipes: 5, timeout: 650 });
            await steps.scrollIntoView('cards', 'Home');
            expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', INDEX_2], ['repo', 'get', 'cards', 'Home', undefined]]);
            expect(element.calls).toEqual([['scrollIntoView', { direction: 'up', maxSwipes: 5, timeout: 650 }], ['scrollIntoView', { timeout: 400 }]]);
        });
    });

    test.describe(`the scroll container on ${platform}`, () => {
        test('scrollIntoView and scrollUntilFound resolve the container on the same page and hand it to the primitive', async () => {
            const { steps, target, carousel, repoCalls } = containerSteps(platform);
            await steps.scrollIntoView('card', 'Shop', { direction: 'right', container: 'carousel', timeout: 700 });
            await steps.scrollUntilFound('card', 'Shop', { strategy: 'index', index: 2, direction: 'left', maxSwipes: 4, container: 'carousel' });
            // The container is resolved without the target's strategy, on the target's page,
            // with the per-call timeout when one is given.
            expect(repoCalls).toEqual([
                ['repo', 'get', 'card', 'Shop', undefined], ['repo', 'get', 'carousel', 'Shop', { timeout: 700 }],
                ['repo', 'get', 'card', 'Shop', INDEX_2], ['repo', 'get', 'carousel', 'Shop', undefined],
            ]);
            expect(target.calls).toEqual([
                ['scrollIntoView', { direction: 'right', container: carousel, timeout: 700 }],
                ['scrollIntoView', { direction: 'left', maxSwipes: 4, container: carousel, timeout: 400 }],
            ]);
            expect(target.calls[0][1]).toHaveProperty('container', carousel);
            expect(carousel.calls, 'the container itself is not acted on by the step').toEqual([]);
        });

        test('the fluent scrollIntoView and scrollUntilFound resolve the container on the chain\'s page with the chain timeout', async () => {
            const { steps, target, carousel, repoCalls } = containerSteps(platform);
            await steps.on('card', 'Shop').nth(2).scrollIntoView({ direction: 'right', container: 'carousel' });
            await steps.on('card', 'Shop').scrollUntilFound({ container: 'carousel', timeout: 90 });
            await steps.on('card', 'Shop').isVisible({ timeout: 50 }).scrollIntoView({ direction: 'left', container: 'carousel' });
            expect(repoCalls.filter(c => c[2] === 'carousel')).toEqual([
                ['repo', 'get', 'carousel', 'Shop', { timeout: 400 }],
                ['repo', 'get', 'carousel', 'Shop', { timeout: 90 }],
                ['repo', 'get', 'carousel', 'Shop', { timeout: 400 }],
            ]);
            expect(target.calls).toEqual([
                ['scrollIntoView', { direction: 'right', container: carousel, timeout: 400 }],
                ['scrollIntoView', { container: carousel, timeout: 90 }],
                ['scrollIntoView', { direction: 'left', container: carousel, timeout: 400 }],
            ]);
        });

        test('a container the page does not define fails before any scroll, naming the container and the page', async () => {
            const { steps, target } = containerSteps(platform);
            for (const run of [
                () => steps.scrollIntoView('card', 'Shop', { direction: 'right', container: 'carousell' }),
                () => steps.scrollUntilFound('card', 'Shop', { direction: 'right', container: 'carousell' }),
                () => steps.on('card', 'Shop').scrollIntoView({ container: 'carousell' }),
                () => steps.on('card', 'Shop').scrollUntilFound({ container: 'carousell' }),
            ]) {
                const error = await caught(run) as Error | undefined;
                expect(error).toBeInstanceOf(Error);
                expect(error?.message).toMatch(/^scroll(IntoView|UntilFound): container "carousell" on page "Shop" could not be resolved: ElementRepository: Element 'carousell' not found on page 'Shop'\.$/);
            }
            expect(target.calls, 'nothing was scrolled').toEqual([]);
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

        test('scrollUntilFound on the chain is the element\'s scrollIntoView with the chain timeout', async () => {
            const { steps, element, mock, repoCalls } = deviceSteps(platform, 5000);
            await steps.on('cards', 'Home').nth(2).scrollUntilFound({ direction: 'right' });
            await steps.on('cards', 'Home').scrollUntilFound({ maxSwipes: 2, timeout: 70 });
            expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', INDEX_2], ['repo', 'get', 'cards', 'Home', {}]]);
            expect(element.calls).toEqual([
                ['scrollIntoView', { direction: 'right', timeout: 5000 }],
                ['scrollIntoView', { maxSwipes: 2, timeout: 70 }],
            ]);
            expect(mock.calls).toEqual([]);
        });

        test('scrollIntoView on the chain forwards direction, maxSwipes and timeout; the no-argument form is unchanged', async () => {
            const { steps, element, repoCalls } = deviceSteps(platform);
            await steps.on('cards', 'Home').nth(2).scrollIntoView({ direction: 'up', maxSwipes: 4 });
            await steps.on('cards', 'Home').scrollIntoView({ direction: 'left', timeout: 90 });
            await steps.on('cards', 'Home').scrollIntoView();
            expect(repoCalls).toEqual([
                ['repo', 'get', 'cards', 'Home', INDEX_2],
                ['repo', 'get', 'cards', 'Home', {}],
                ['repo', 'get', 'cards', 'Home', {}],
            ]);
            expect(element.calls).toEqual([
                ['scrollIntoView', { direction: 'up', maxSwipes: 4, timeout: 400 }],
                ['scrollIntoView', { direction: 'left', timeout: 90 }],
                ['scrollIntoView', { timeout: 400 }],
            ]);
        });

        test('tapAt on the chain taps the offset inside the element the chain selects', async () => {
            const { steps, element, repoCalls, mock } = deviceSteps(platform);
            await steps.on('cards', 'Home').nth(2).tapAt({ x: 5, y: 7 });
            await steps.on('cards', 'Home').tapAt({ x: 1, y: 2 }, { timeout: 60 });
            expect(repoCalls).toEqual([['repo', 'get', 'cards', 'Home', INDEX_2], ['repo', 'get', 'cards', 'Home', {}]]);
            expect(element.calls).toEqual([
                ['tapAt', { x: 5, y: 7 }, { timeout: 400 }],
                ['tapAt', { x: 1, y: 2 }, { timeout: 60 }],
            ]);
            expect(mock.calls, 'the element primitive, not a screen tap').toEqual([]);
        });

        test('zoom on the chain takes ZoomOptions', async () => {
            const { steps, element } = deviceSteps(platform);
            await steps.on('cards', 'Home').zoom({ scale: 2.5, timeout: 80 });
            expect(element.calls).toEqual([['zoom', { scale: 2.5, timeout: 80 }]]);
        });

        test('an ifVisible() gate skips a gesture on a hidden element', async () => {
            const { steps, element } = deviceSteps(platform, 400, mockElement({ visible: false }));
            await steps.on('cards', 'Home').ifVisible(150).swipe('left');
            await steps.on('cards', 'Home').ifVisible(150).longPress();
            await steps.on('cards', 'Home').ifVisible(150).tapAt({ x: 1, y: 1 });
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

        test('a device query that never answers: the failure says so, with no element advice', async () => {
            const { steps, mock } = deviceSteps(platform, 30000);
            (mock.driver as unknown as Record<string, unknown>).getOrientation = () => new Promise<string>(() => undefined);
            const error = await caught(() => steps.verifyOrientation('landscape', { timeout: 250 }));
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect((error as Error).message).toMatch(
                /^verifyOrientation: expected orientation "landscape": timed out after 250 ms\. No answer was obtained: no check finished within the timeout\. The probe was still running when its \d+ ms ran out: one check \(a driver call or a lookup pass\) takes longer than the 250 ms timeout, or the driver stopped answering\. Allow more time with a longer timeout\.$/,
            );
            expect((error as Error).message).not.toMatch(/selector|byText|element check/);
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

    test('hideKeyboard on web refuses before its tapElement is resolved', async () => {
        const { steps, repoCalls } = webSteps();
        await expectNotSupported(() => steps.hideKeyboard({ tapElement: { pageName: 'Home', elementName: 'title' }, timeout: 1 }), 'hideKeyboard', 'web');
        expect(repoCalls).toEqual([]);
    });
});
