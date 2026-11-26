import { test, expect } from '@playwright/test';
import type { Element } from '@civitas-cerebrum/element-repository';
import { AppiumFactory } from '../src/appium';
import { MissingAppIdError } from '../src/appium/AppiumDevice';
import { ReResolvingElement } from '../src/appium/ReResolvingElement';
import { DEVICE_POLL_ATTACH_MS, DEVICE_POLL_SELECTION_MS, DEVICE_RESOLVE_SLICE_MS, selectionBudget } from '../src/appium/entry';
import { androidStrategy, iosStrategy } from '../src/appium/platform';
import type { EntryTarget } from '../src/interfaces/IEntryTarget';
import { PollTimeoutError } from '../src/utils/poll';
import { mockDriver, mockElement, driverError, DEVICE_PLATFORMS } from './appium/mocks';

/**
 * Unit tests (no device, no browser) for the Appium family's entry-level
 * methods: the polling target, the visibility probe, list presence, entry
 * absence, the chain's text read, `getAll` values and the `satisfy()`
 * snapshot, plus the device's polling assertions. The steps layer hands these
 * an `EntryTarget`; here a scripted one records every resolution and its
 * attach budget.
 */

const CAPS = {
    android: { platformName: 'Android', 'appium:appPackage': 'com.example.app' },
    ios: { platformName: 'iOS', 'appium:bundleId': 'com.example.App' },
} as const;

type Resolution = ['resolve' | 'resolveDefault' | 'resolveAll' | 'probe', number | undefined];

/** An EntryTarget whose resolvers answer `next()` (an element, or a thrown error) and record their budgets. */
function scriptedEntry(next: (kind: Resolution[0]) => Element) {
    const resolutions: Resolution[] = [];
    const answer = (kind: Resolution[0]) => async (budget?: number) => {
        resolutions.push([kind, budget]);
        return next(kind);
    };
    const entry: EntryTarget = {
        elementName: 'rows',
        pageName: 'Screen',
        resolve: answer('resolve'),
        resolveDefault: answer('resolveDefault'),
        resolveAll: answer('resolveAll'),
        probe: answer('probe'),
    };
    return { entry, resolutions };
}

function family(platform: (typeof DEVICE_PLATFORMS)[number], timeout = 400) {
    const mock = mockDriver({ capabilities: { ...CAPS[platform] } });
    const factory = new AppiumFactory(mock.driver, platform, { timeout });
    return {
        mock,
        verify: factory.createVerifications(),
        extract: factory.createExtractions(),
        device: factory.createDevice(),
    };
}

async function caught(call: () => unknown): Promise<unknown> {
    try {
        await call();
    } catch (error) {
        return error;
    }
    return undefined;
}

test.describe('selectionBudget', () => {
    test('is the full selection budget without a usable timeout, else half the timeout, between 1 ms and the budget', () => {
        expect(DEVICE_POLL_SELECTION_MS).toBe(2000);
        const cases: Array<[number | undefined, number]> = [
            [undefined, 2000], [Number.NaN, 2000], [Number.POSITIVE_INFINITY, 2000], [Number.NEGATIVE_INFINITY, 2000],
            [0, 1], [1, 1], [2, 1], [3, 1], [4, 2], [3999, 1999], [4000, 2000], [4001, 2000], [10000, 2000],
        ];
        for (const [timeout, budget] of cases) {
            expect(selectionBudget(timeout), `selectionBudget(${timeout})`).toBe(budget);
        }
    });
});

for (const platform of DEVICE_PLATFORMS) {
    test.describe(`AppiumVerifications entry methods on ${platform}`, () => {
        test('pollTarget re-resolves the entry with a one-check budget on every read', async () => {
            const { verify } = family(platform);
            let n = 0;
            const { entry, resolutions } = scriptedEntry(() => mockElement({ text: `t${++n}` }));
            const handle = await verify.pollTarget(entry);
            expect(handle).toBeInstanceOf(ReResolvingElement);
            expect(resolutions, 'nothing resolved until read').toEqual([]);
            await handle.textContent();
            await handle.textContent();
            expect(resolutions).toEqual([['resolve', DEVICE_POLL_ATTACH_MS], ['resolve', DEVICE_POLL_ATTACH_MS]]);
            const all = await verify.pollTarget(entry, true);
            await all.count();
            expect(resolutions.at(-1)).toEqual(['resolveAll', DEVICE_POLL_ATTACH_MS]);
            expect((handle as ReResolvingElement).description).toBe("'Screen.rows'");
        });

        test('probeVisible re-resolves per attempt and picks up an element that appears late', async () => {
            const { verify } = family(platform);
            let attempts = 0;
            const { entry, resolutions } = scriptedEntry(() => {
                attempts++;
                if (attempts < 3) throw new Error('no such element');
                return mockElement();
            });
            expect(await verify.probeVisible(entry, 2000)).toBe(true);
            expect(resolutions.map(r => r[0])).toEqual(['probe', 'probe', 'probe']);
            for (const [, budget] of resolutions) expect(budget).toBeLessThanOrEqual(DEVICE_RESOLVE_SLICE_MS);
        });

        test('probeVisible answers false after the timeout for a hidden element, and reads the visible text with containsText', async () => {
            const { verify } = family(platform);
            const hidden = scriptedEntry(() => mockElement({ visible: false }));
            const started = Date.now();
            expect(await verify.probeVisible(hidden.entry, 250)).toBe(false);
            expect(Date.now() - started).toBeLessThan(2000);
            expect(hidden.resolutions.length).toBeGreaterThan(1);

            const shown = scriptedEntry(() => mockElement({ text: 'General' }));
            expect(await verify.probeVisible(shown.entry, 250, 'Gen')).toBe(true);
            expect(await verify.probeVisible(shown.entry, 250, 'Privacy')).toBe(false);
        });

        test('probeVisible and visibleWithin throw a fatal driver error instead of answering false', async () => {
            const { verify } = family(platform);
            const dead = driverError('invalid session id');
            const { entry } = scriptedEntry(() => { throw dead; });
            expect(await caught(() => verify.probeVisible(entry, 2000))).toBe(dead);
            expect(await caught(() => verify.visibleWithin(entry, 2000))).toBe(dead);
        });

        test('visibleWithin is the same re-resolving probe', async () => {
            const { verify } = family(platform);
            expect(await verify.visibleWithin(scriptedEntry(() => mockElement()).entry, 200)).toBe(true);
            expect(await verify.visibleWithin(scriptedEntry(() => mockElement({ visible: false })).entry, 200)).toBe(false);
        });

        test('listPresence passes once any match of the re-resolved collection is displayed', async () => {
            const { verify } = family(platform);
            let polls = 0;
            const hidden = mockElement({ visible: false });
            const { entry, resolutions } = scriptedEntry(() => {
                polls++;
                const shown = mockElement({ visible: polls >= 3 });
                return mockElement({ children: [hidden, shown] });
            });
            await verify.listPresence(entry, 3000);
            expect(resolutions.every(r => r[0] === 'resolveAll' && r[1] === DEVICE_POLL_ATTACH_MS)).toBe(true);
            expect(resolutions.length).toBe(3);
        });

        test('listPresence fails after the timeout naming the entry and the match count', async () => {
            const { verify } = family(platform);
            const { entry } = scriptedEntry(() => mockElement({ children: [mockElement({ visible: false }), mockElement({ visible: false })] }));
            const error = await caught(() => verify.listPresence(entry, 250));
            expect((error as Error).message).toBe(
                `verifyPresence: 'Screen.rows' is a list entry ("list": true) — expected at least one visible match within 250ms, ` +
                'found 2 match(es) and none visible.',
            );
            expect(error).not.toBeInstanceOf(PollTimeoutError);
            const cause = (error as Error).cause;
            expect(cause).toBeInstanceOf(PollTimeoutError);
            expect((cause as PollTimeoutError).timeout).toBe(250);
        });

        test('listPresence rethrows a fatal driver error at once', async () => {
            const { verify } = family(platform);
            const dead = driverError('invalid session id');
            const { entry } = scriptedEntry(() => { throw dead; });
            const started = Date.now();
            expect(await caught(() => verify.listPresence(entry, 5000))).toBe(dead);
            expect(Date.now() - started).toBeLessThan(2000);
        });

        test('entryAbsence resolves the whole collection once with the attach slice, then polls absence', async () => {
            const { verify } = family(platform);
            let reads = 0;
            const element = mockElement({ visible: () => ++reads < 3 });
            const { entry, resolutions } = scriptedEntry(() => element);
            await verify.entryAbsence(entry, { timeout: 3000, attachSlice: 375 });
            expect(resolutions, 'only the whole-collection resolver: a strategy selector does not narrow absence').toEqual([['resolveAll', 375]]);
            expect(reads).toBeGreaterThanOrEqual(3);

            const error = await caught(() => verify.entryAbsence(scriptedEntry(() => mockElement()).entry, { timeout: 250, attachSlice: 250 }));
            expect(error).toBeInstanceOf(PollTimeoutError);
        });
    });

    test.describe(`AppiumExtractions entry methods on ${platform}`, () => {
        test('readText waits for attached with the given timeout, then reads the visible text, trimmed', async () => {
            const { extract } = family(platform);
            const element = mockElement({ text: '  General  ' });
            expect(await extract.readText(element, 1234)).toBe('General');
            expect(element.calls).toEqual([['waitFor', { state: 'attached', timeout: 1234 }]]);
        });

        test('readText reads a missing element as is, but rethrows a fatal driver error', async () => {
            const { extract } = family(platform);
            const missing = mockElement({ text: '', waitFor: async () => { throw new Error('no such element'); } });
            expect(await extract.readText(missing, 10)).toBe('');
            const dead = driverError('invalid session id');
            const deadElement = mockElement({ waitFor: async () => { throw dead; } });
            expect(await caught(() => extract.readText(deadElement, 10))).toBe(dead);
        });

        test('getAllValues: every match, a picked match alone, children gathered match by match, attributes', async () => {
            const { extract } = family(platform);
            const childOf = (name: string) => mockElement({ text: `${name}-child` });
            const a = mockElement({ text: 'A', attributes: { name: 'a' } });
            const b = mockElement({ text: 'B', attributes: { name: null } });
            (a as unknown as { locateChild: () => Element }).locateChild = () => mockElement({ children: [childOf('a1'), childOf('a2')] });
            (b as unknown as { locateChild: () => Element }).locateChild = () => mockElement({ children: [childOf('b1')] });
            const list = mockElement({ children: [a, b] });
            expect(await extract.getAllValues(list)).toEqual(['A', 'B']);
            expect(await extract.getAllValues(a, { picked: true })).toEqual(['A']);
            expect(await extract.getAllValues(list, { child: '~child' })).toEqual(['a1-child', 'a2-child', 'b1-child']);
            expect(await extract.getAllValues(list, { attribute: 'name' })).toEqual(['a']);
        });

        test('captureSnapshot re-resolves with a one-check budget and reads the platform attribute list', async () => {
            const { extract } = family(platform);
            const read: string[] = [];
            const element = mockElement({ text: ' Wi-Fi ', inputValue: 'v', count: 4 });
            const getAttribute = element.getAttribute.bind(element);
            (element as unknown as { getAttribute: (n: string) => Promise<string | null> }).getAttribute = async (name: string) => {
                read.push(name);
                return name === 'enabled' ? 'true' : getAttribute(name);
            };
            (element as unknown as { first: () => Element }).first = () => element;
            const { entry, resolutions } = scriptedEntry(() => element);
            const snapshot = await extract.captureSnapshot(entry);
            expect(resolutions.sort()).toEqual([['resolve', DEVICE_POLL_ATTACH_MS], ['resolveAll', DEVICE_POLL_ATTACH_MS]].sort());
            expect(snapshot).toMatchObject({ text: 'Wi-Fi', value: 'v', visible: true, enabled: true, count: 4 });
            expect(snapshot.attributes.enabled).toBe('true');
            const strategy = platform === 'ios' ? iosStrategy : androidStrategy;
            for (const name of strategy.snapshotAttributes) expect(read).toContain(name);
        });

        test('captureSnapshot reads a missing element as the empty snapshot, but throws a fatal driver error', async () => {
            const { extract } = family(platform);
            const gone = mockElement({ visible: () => { throw new Error('no such element'); }, count: 0, text: null });
            (gone as unknown as { first: () => Element }).first = () => gone;
            const snapshot = await extract.captureSnapshot(scriptedEntry(() => gone).entry);
            expect(snapshot).toMatchObject({ text: '', visible: false, count: 0 });

            const dead = driverError('invalid session id');
            const deadElement = mockElement({ visible: () => { throw dead; } });
            (deadElement as unknown as { first: () => Element }).first = () => deadElement;
            expect(await caught(() => extract.captureSnapshot(scriptedEntry(() => deadElement).entry))).toBe(dead);
        });
    });

    test.describe(`AppiumDevice polling assertions on ${platform}`, () => {
        test('supports / resolveAppId answer the strategy and the app under test', () => {
            const { device } = family(platform);
            expect(device.supports('pressBack')).toBe(platform === 'android');
            expect(device.supports('launchApp')).toBe(true);
            expect(device.resolveAppId('step')).toBe(platform === 'ios' ? 'com.example.App' : 'com.example.app');
            expect(device.resolveAppId('step', 'org.example.other')).toBe('org.example.other');
        });

        test('each assertion polls until it holds, with the per-call timeout and errorMessage', async () => {
            const { device, mock } = family(platform, 30000);
            mock.executeResults['mobile: queryAppState'] = 4;
            await device.verifyAppInForeground();
            await device.verifyOrientation('portrait');
            await device.verifyContext('NATIVE_APP');
            mock.executeResults['mobile: isKeyboardShown'] = false;
            await device.verifyKeyboardShown({ negated: true });

            const error = await caught(() => device.verifyKeyboardShown({ timeout: 200, errorMessage: 'type first' }));
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect((error as Error).message).toMatch(/^type first: timed out after 200 ms\. Last value: false\./);
        });

        test('without options the instance timeout applies', async () => {
            const { device } = family(platform, 250);
            const started = Date.now();
            const error = await caught(() => device.verifyContext('WEBVIEW_1'));
            expect(Date.now() - started).toBeLessThan(3000);
            expect((error as Error).message).toContain('verifyContext: expected context "WEBVIEW_1": timed out after 250 ms.');
        });

        test('a missing app id fails at once, naming the assertion', async () => {
            const mock = mockDriver({ capabilities: { platformName: platform } });
            const device = new AppiumFactory(mock.driver, platform, { timeout: 5000 }).createDevice();
            const error = await caught(() => device.verifyAppInForeground());
            expect(error).toBeInstanceOf(MissingAppIdError);
            expect((error as Error).message).toMatch(/^verifyAppInForeground: no app id\./);
            expect(mock.calls).toEqual([]);
        });
    });
}
