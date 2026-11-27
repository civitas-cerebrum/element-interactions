import { test, expect } from '@playwright/test';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { Steps, type ElementSnapshot } from '../src/index';
import { AppiumFactory } from '../src/appium';
import { DEVICE_PLATFORMS, driverError, mockUiDriver, type MockNode } from './appium/mocks';

/**
 * A visibility read that fails with a non-fatal driver error that is not a
 * "no match" (an `unknown error` from the driver, a stale reference twice in
 * a row) is no answer. element-repository's polled `isVisible()` now throws
 * it instead of answering `false`. No step reads it as "not visible" or
 * "absent": a polling check retries it within its timeout and reports it as
 * its last error; a one-shot gate (`isPresent`, `clickIfPresent`) throws it;
 * the visibility probe (`isVisible()` / `ifVisible()`) retries within its
 * budget and throws it when the budget ends on it. A real no-match stays
 * "not visible".
 */

const TIMEOUT = 500;

const PAGES = (platform: string) => ({
    pages: [{
        name: 'Screen',
        platform,
        elements: [
            { elementName: 'toast', selector: { 'accessibility id': 'toast' } },
            { elementName: 'rows', list: true, selector: { 'accessibility id': 'row' } },
            { elementName: 'missing', selector: { 'accessibility id': 'nothing' } },
        ],
    }],
});

/** A displayed read that fails with an `unknown error` (non-fatal, not a no-match) on every call, or for the first `times`. */
function failingDisplay(times = Infinity): { read: () => boolean; reads: () => number } {
    let reads = 0;
    return {
        read: () => {
            if (++reads <= times) throw driverError('unknown error', 'An unknown server-side error occurred while processing the command.');
            return true;
        },
        reads: () => reads,
    };
}

function deviceSteps(platform: 'android' | 'ios', tree: MockNode[]) {
    const mock = mockUiDriver(tree, { capabilities: { platformName: platform } });
    const repo = new ElementRepository(mock.driver, PAGES(platform), { platform, timeout: TIMEOUT });
    const steps = new Steps(new AppiumFactory(mock.driver, platform, { timeout: TIMEOUT, appId: 'com.example.app' }), repo);
    return { steps, mock };
}

async function caught(call: () => unknown): Promise<Error | undefined> {
    try {
        await call();
    } catch (error) {
        return error as Error;
    }
    return undefined;
}

const UNKNOWN = /unknown server-side error/;
const taps = (mock: ReturnType<typeof mockUiDriver>) => mock.calls.filter(c => c[0] === 'click').length;

for (const platform of DEVICE_PLATFORMS) {
    test.describe(`a visibility read that fails (not a no-match) on ${platform}`, () => {
        const toast = (read: () => boolean): MockNode[] => [{ match: '~toast', text: 'Saved', visible: read }];

        test('the isVisible() probe retries within its budget, then throws the error instead of answering false', async () => {
            const { steps } = deviceSteps(platform, toast(failingDisplay().read));
            const error = await caught(() => steps.on('toast', 'Screen').isVisible({ timeout: 400 }));
            expect(error?.message).toMatch(UNKNOWN);
            expect(error?.message).toMatch(/could not tell whether 'Screen\.toast' is displayed within 400 ms/);
            // A read that fails once and then answers is retried, not thrown.
            const flaky = failingDisplay(1);
            expect(await deviceSteps(platform, toast(flaky.read)).steps.on('toast', 'Screen').isVisible({ timeout: 2000 })).toBe(true);
            expect(flaky.reads()).toBeGreaterThanOrEqual(2);
        });

        test('the isVisible() gate and ifVisible() do not skip on the error: they throw, and tap nothing', async () => {
            const { steps, mock } = deviceSteps(platform, toast(failingDisplay().read));
            expect((await caught(() => steps.on('toast', 'Screen').isVisible({ timeout: 300 }).click()))?.message).toMatch(UNKNOWN);
            expect((await caught(() => steps.on('toast', 'Screen').ifVisible(300).click()))?.message).toMatch(UNKNOWN);
            expect(taps(mock)).toBe(0);
        });

        test('clickIfPresent throws the error instead of skipping, and taps nothing', async () => {
            const { steps, mock } = deviceSteps(platform, toast(failingDisplay().read));
            expect((await caught(() => steps.clickIfPresent('toast', 'Screen')))?.message).toMatch(UNKNOWN);
            expect((await caught(() => steps.on('toast', 'Screen').clickIfPresent()))?.message).toMatch(UNKNOWN);
            expect(taps(mock)).toBe(0);
        });

        test('isPresent throws the error instead of answering false', async () => {
            const { steps } = deviceSteps(platform, toast(failingDisplay().read));
            expect((await caught(() => steps.isPresent('toast', 'Screen')))?.message).toMatch(UNKNOWN);
            expect((await caught(() => steps.on('toast', 'Screen').isPresent()))?.message).toMatch(UNKNOWN);
        });

        test('a real no-match still answers false or passes: the probe, the gates, isPresent and not.visible', async () => {
            const { steps, mock } = deviceSteps(platform, toast(() => true));
            expect(await steps.on('missing', 'Screen').isVisible({ timeout: 300 })).toBe(false);
            expect(await steps.clickIfPresent('missing', 'Screen')).toBe(false);
            expect(await steps.on('missing', 'Screen').clickIfPresent()).toBe(false);
            expect(await steps.isPresent('missing', 'Screen')).toBe(false);
            expect(await steps.on('missing', 'Screen').isPresent()).toBe(false);
            await steps.on('missing', 'Screen').not.visible.toBeTrue();
            await steps.on('missing', 'Screen').verifyState('hidden');
            // An index past the end is the repository's no-match answer.
            expect(await steps.on('toast', 'Screen').nth(3).isVisible({ timeout: 300 })).toBe(false);
            await steps.on('toast', 'Screen').nth(3).not.visible.toBeTrue();
            expect(taps(mock)).toBe(0);
        });

        test('not.visible, visible.toBeFalse and verifyState hidden never pass on the error: they fail with it as the last error', async () => {
            const { steps } = deviceSteps(platform, toast(failingDisplay().read));
            for (const [name, run] of [
                ['not.visible', async () => { await steps.on('toast', 'Screen').not.visible.toBeTrue(); }],
                ['visible.toBeFalse', async () => { await steps.on('toast', 'Screen').visible.toBeFalse(); }],
                ['verifyState hidden', () => steps.on('toast', 'Screen').verifyState('hidden')],
                ['nth(0) not.visible', async () => { await steps.on('toast', 'Screen').nth(0).not.visible.toBeTrue(); }],
            ] as const) {
                const error = await caught(run);
                expect(error, `${name} must not pass`).toBeDefined();
                expect(error?.message, name).toMatch(/Last error: An unknown server-side error/);
            }
        });

        test('verifyPresence of a list entry reports the error, not "none visible"', async () => {
            const rows: MockNode[] = [{ match: '~row', visible: failingDisplay().read }, { match: '~row', visible: failingDisplay().read }];
            const error = await caught(() => deviceSteps(platform, rows).steps.verifyPresence('rows', 'Screen'));
            expect(error?.message).toMatch(/Last error: An unknown server-side error/);
            expect(error?.message).not.toMatch(/none visible/);
        });

        test('a satisfy() snapshot never reads the error as not visible', async () => {
            const { steps } = deviceSteps(platform, toast(failingDisplay().read));
            const error = await caught(async () => { await steps.on('toast', 'Screen').timeout(400).satisfy(s => !s.visible); });
            expect(error, 'a snapshot whose visibility read failed is no answer').toBeDefined();
            expect(error?.message).toMatch(UNKNOWN);
        });

        test('waitForState hidden never passes on the error', async () => {
            const { steps } = deviceSteps(platform, toast(failingDisplay().read));
            const error = await caught(() => steps.waitForState('toast', 'Screen', 'hidden', { timeout: 400 }));
            expect(error?.message).toMatch(/did not reach state 'hidden'/);
            expect(await steps.waitForState('toast', 'Screen', 'hidden', { timeout: 300, optional: true })).toBe(false);
        });
    });
}

/**
 * element-repository's RANDOM and ATTRIBUTE strategies turn ANY failure of
 * their first wait (a dead session, an `unknown error`) into a plain
 * `No elements found for '<el>' on '<page>'`. That message is no answer by
 * itself: a device chain confirms it with a lookup of every match, whose
 * errors pass through. These hold it against the installed package.
 */
for (const platform of DEVICE_PLATFORMS) {
    test.describe(`a random() / byAttribute() chain whose lookup fails on ${platform}`, () => {
        const DEAD = () => driverError('invalid session id', 'invalid session id: the session is gone');
        const FLAKY = () => driverError('unknown error', 'An unknown server-side error occurred while processing the command.');
        const toasts = (visible = true): MockNode[] => [{ match: '~toast', text: 'Saved', visible, attributes: { name: 'saved' } }];

        /** The probes of a chain: isPresent (step and fluent), not.visible and the ifVisible gate. */
        const probes = (steps: Steps, strategy: 'random' | 'attribute') => {
            const on = () => (strategy === 'random' ? steps.on('toast', 'Screen').random() : steps.on('toast', 'Screen').byAttribute('name', 'saved'));
            const options = strategy === 'random' ? { strategy: 'random' as const } : { strategy: 'attribute' as const, attribute: 'name', value: 'saved' };
            return {
                'steps.isPresent': () => steps.isPresent('toast', 'Screen', options),
                'on().isPresent': () => on().isPresent(),
                'not.visible': async () => { await on().timeout(400).not.visible.toBeTrue(); },
                'ifVisible gate': () => on().ifVisible(400).click(),
            };
        };

        for (const strategy of ['random', 'attribute'] as const) {
            test(`${strategy}: a dead session is never a no-match: every probe fails with it`, async () => {
                const { steps, mock } = deviceSteps(platform, toasts());
                mock.failWith(DEAD());
                for (const [name, run] of Object.entries(probes(steps, strategy))) {
                    const error = await caught(run);
                    expect(error, `${name} must not answer "not there"`).toBeDefined();
                    expect(error?.message, name).toMatch(/invalid session id/);
                }
                expect(taps(mock)).toBe(0);
            });

            test(`${strategy}: a transient lookup error is never a no-match: every probe fails with it`, async () => {
                const { steps, mock } = deviceSteps(platform, toasts());
                mock.failWith(FLAKY());
                for (const [name, run] of Object.entries(probes(steps, strategy))) {
                    const error = await caught(run);
                    expect(error, `${name} must not answer "not there"`).toBeDefined();
                    expect(error?.message, name).toMatch(UNKNOWN);
                }
                expect(taps(mock)).toBe(0);
            });

            test(`${strategy}: no match at all is still a no-match: false, passes, skips`, async () => {
                const { steps, mock } = deviceSteps(platform, []);
                const run = probes(steps, strategy);
                expect(await run['steps.isPresent']()).toBe(false);
                expect(await run['on().isPresent']()).toBe(false);
                await run['not.visible']();
                await run['ifVisible gate']();
                expect(taps(mock)).toBe(0);
            });
        }

        test('random: matches that are all hidden are a no-match (nothing visible to pick)', async () => {
            const { steps, mock } = deviceSteps(platform, toasts(false));
            const run = probes(steps, 'random');
            expect(await run['steps.isPresent']()).toBe(false);
            expect(await run['on().isPresent']()).toBe(false);
            await run['not.visible']();
            await run['ifVisible gate']();
            expect(taps(mock)).toBe(0);
        });
    });
}


/**
 * A `satisfy()` snapshot reads every field strictly: only a no-match answer
 * gives the field's default; any other error fails the snapshot, and the
 * loop retries it. A stale read never satisfies a predicate on a default.
 */
for (const platform of DEVICE_PLATFORMS) {
    test.describe(`a satisfy() snapshot whose read fails on ${platform}`, () => {
        const STALE = () => { throw driverError('stale element reference', 'stale element reference: the row was redrawn'); };
        const attribute = platform === 'android' ? 'checkable' : 'accessible';
        const satisfies = async (node: Partial<MockNode>, predicate: (s: ElementSnapshot) => boolean, patch?: (mock: ReturnType<typeof mockUiDriver>) => void) => {
            const { steps, mock } = deviceSteps(platform, [{ match: '~toast', text: 'Saved', ...node }]);
            patch?.(mock);
            return caught(async () => { await steps.on('toast', 'Screen').timeout(400).satisfy(predicate); });
        };

        test('text: a stale read is not an empty text', async () => {
            expect((await satisfies({ text: STALE }, s => s.text === ''))?.message).toMatch(/stale element reference/);
        });

        test('value: a stale read is not an empty value', async () => {
            const node: Partial<MockNode> = platform === 'android' ? { text: STALE } : { attributes: { value: STALE } };
            expect((await satisfies(node, s => s.value === ''))?.message).toMatch(/stale element reference/);
        });

        test('enabled: a stale read is not disabled', async () => {
            expect((await satisfies({ enabled: STALE }, s => !s.enabled))?.message).toMatch(/stale element reference/);
        });

        test('attributes: a stale read is not a missing attribute', async () => {
            expect((await satisfies({ attributes: { [attribute]: STALE } }, s => s.attributes[attribute] === undefined))?.message)
                .toMatch(/stale element reference/);
        });

        test('count: a failed count is not zero', async () => {
            const error = await satisfies({}, s => s.count === 0, mock => {
                const driver = mock.driver as unknown as Record<string, (s: string) => Promise<unknown>>;
                driver.$$ = async () => { throw driverError('stale element reference', 'stale element reference: the list was redrawn'); };
            });
            expect(error?.message).toMatch(/stale element reference/);
        });

        test('a missing element still reads as the defaults', async () => {
            const { steps } = deviceSteps(platform, []);
            await steps.on('missing', 'Screen').timeout(400).satisfy(s => s.count === 0 && s.text === '' && !s.visible && !s.enabled);
        });
    });
}
