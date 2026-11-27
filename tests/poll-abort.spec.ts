import { test, expect } from '@playwright/test';
import { ElementRepository, LookupAbortedError, type Element } from '@civitas-cerebrum/element-repository';
import { pollUntil, ProbeTimeoutError, PROBE_DONE_REASON, softRead, stopIfAborted } from '../src/utils/poll';
import { ReResolvingElement, withProbeSignal } from '../src/appium/ReResolvingElement';
import { probeVisibleOnDevice } from '../src/appium/entry';
import type { EntryTarget } from '../src/interfaces/IEntryTarget';
import { Steps } from '../src/index';
import { AppiumFactory } from '../src/appium';
import { cellPages, slowDriver, slowDeviceSteps } from './appium/slow-driver';
import type { MockNode } from './appium/mocks';

/**
 * Every poll probe gets an abort signal of its own. The poll aborts it when
 * it gives up on the probe and once it is done with it; the device probes
 * pass it to their repository lookups and check it between their own driver
 * calls, so a probe the poll gave up on starts no driver call afterwards.
 */

/** A command that starts this soon after the rejection was issued in the same turn as it. */
const SAME_TURN_MS = 5;

test.describe('pollUntil gives every probe an abort signal', () => {
    test('a probe that runs out of time has its signal aborted, the timeout as its reason, before the poll rejects', async () => {
        let seen: AbortSignal | undefined;
        let abortedWhenRejected: boolean | undefined;
        const poll = pollUntil(signal => { seen = signal; return new Promise<boolean>(() => undefined); }, v => v, { timeout: 30 });
        await poll.catch(() => { abortedWhenRejected = seen?.aborted; });
        expect(seen).toBeInstanceOf(AbortSignal);
        expect(abortedWhenRejected).toBe(true);
        expect(seen!.reason).toBeInstanceOf(ProbeTimeoutError);
    });

    test('an answered probe has its signal aborted once the poll is done with it; each probe gets a new one', async () => {
        const signals: AbortSignal[] = [];
        let n = 0;
        await pollUntil(signal => { signals.push(signal); expect(signal.aborted).toBe(false); return ++n; }, v => v >= 3, { timeout: 2000, interval: 1 });
        expect(signals).toHaveLength(3);
        expect(new Set(signals).size).toBe(3);
        for (const signal of signals) {
            expect(signal.aborted).toBe(true);
            expect((signal.reason as Error).message).toBe(PROBE_DONE_REASON);
        }
    });

    test('a lookup aborted by another signal is rethrown at once: never retried, never the last error', async () => {
        const cancelled = new LookupAbortedError({ elementName: 'row', pageName: 'Screen', reason: new Error('the caller cancelled') });
        let probes = 0;
        const started = Date.now();
        const error = await pollUntil(() => { probes++; throw cancelled; }, () => true, { timeout: 2000 }).catch(e => e);
        expect(error).toBe(cancelled);
        expect(probes).toBe(1);
        expect(Date.now() - started).toBeLessThan(1000);
    });

    test('softRead never reads an aborted lookup as its fallback', async () => {
        const aborted = new LookupAbortedError({ operation: 'a read', reason: undefined });
        await expect(softRead(async () => { throw aborted; }, false)).rejects.toBe(aborted);
        expect(await softRead(async () => { throw new Error('stale element reference'); }, false)).toBe(false);
    });

    test('stopIfAborted throws a LookupAbortedError naming the operation, the signal reason as its cause', () => {
        expect(() => stopIfAborted(undefined, 'x')).not.toThrow();
        const controller = new AbortController();
        expect(() => stopIfAborted(controller.signal, 'x')).not.toThrow();
        const reason = new Error('gave up');
        controller.abort(reason);
        let error: unknown;
        try { stopIfAborted(controller.signal, 'a read of row'); } catch (e) { error = e; }
        expect(error).toBeInstanceOf(LookupAbortedError);
        expect((error as Error).name).toBe('AbortError');
        expect((error as Error).message).toBe('a read of row aborted. (reason: gave up)');
        expect((error as Error).cause).toBe(reason);
    });
});

test.describe('a re-resolving element passes a bound signal to every resolution', () => {
    function recorder() {
        const signals: Array<AbortSignal | undefined> = [];
        let reads = 0;
        const element = {
            isVisible: async () => { reads++; return true; },
            first() { return element; },
            nth() { return element; },
            locateChild() { return element; },
            filter() { return element; },
            waitFor: async (options?: { signal?: AbortSignal }) => { signals.push(options?.signal); },
        } as unknown as Element;
        const resolve = async (signal?: AbortSignal) => { signals.push(signal); return element; };
        return { signals, reads: () => reads, re: new ReResolvingElement(resolve, "'Screen.row'") };
    }

    test('withSignal binds it, derived elements keep it, and an unbound element passes none', async () => {
        const { signals, re } = recorder();
        const controller = new AbortController();
        await re.isVisible();
        const bound = re.withSignal(controller.signal);
        await bound.isVisible();
        await bound.first().isVisible();
        await bound.nth(1).locateChild('~x').filter({ hasText: 'a' }).isVisible();
        expect(signals).toEqual([undefined, controller.signal, controller.signal, controller.signal]);
        expect(withProbeSignal(re, controller.signal)).toBeInstanceOf(ReResolvingElement);
        const plain = {} as Element;
        expect(withProbeSignal(plain, controller.signal)).toBe(plain);
    });

    test('once the signal is aborted, the read after a resolution does not start', async () => {
        const { reads, re } = recorder();
        const controller = new AbortController();
        const bound = re.withSignal(controller.signal);
        controller.abort(new Error('gave up'));
        await expect(bound.isVisible()).rejects.toBeInstanceOf(LookupAbortedError);
        await expect(bound.isVisible()).rejects.toThrow("a read of 'Screen.row' aborted. (reason: gave up)");
        expect(reads()).toBe(0);
    });

    test('waitFor passes the bound signal on, and a signal of its own wins', async () => {
        const { signals, re } = recorder();
        const bound = new AbortController().signal;
        const own = new AbortController().signal;
        await re.waitFor({ state: 'visible' });
        await re.withSignal(bound).waitFor({ state: 'visible' });
        await re.withSignal(bound).waitFor({ state: 'visible', signal: own });
        // Each call: the resolution's signal, then the one waitFor got.
        expect(signals).toEqual([undefined, undefined, bound, bound, bound, own]);
    });
});

test('the device visibility probe never reads a cancelled lookup as not visible', async () => {
    const aborted = new LookupAbortedError({ elementName: 'row', pageName: 'Screen', reason: undefined });
    const entry = { elementName: 'row', pageName: 'Screen', probe: async () => { throw aborted; } } as unknown as EntryTarget;
    await expect(probeVisibleOnDevice(entry, 500)).rejects.toBe(aborted);
});

test.describe('the signal reaches every repository lookup a device check makes', () => {
    for (const platform of ['ios', 'android'] as const) {
        test(`${platform}: get and getVisible get the probe's signal, aborted once the check gave up`, async () => {
            const slow = slowDriver(platform, [{ match: '~cell', text: 'Item 1', visible: false }], { lookupMs: 400, readMs: 1 });
            const repo = new ElementRepository(slow.mock.driver, cellPages(platform), { platform, timeout: 1500 });
            const seen: Array<AbortSignal | undefined> = [];
            const get = repo.get.bind(repo);
            repo.get = ((name: string, page: string, options?: { signal?: AbortSignal }) => { seen.push(options?.signal); return get(name, page, options); }) as typeof repo.get;
            const getVisible = repo.getVisible.bind(repo);
            repo.getVisible = ((name: string, page: string, strict?: boolean, options?: { signal?: AbortSignal }) => {
                seen.push(options?.signal);
                return getVisible(name, page, strict, options);
            }) as typeof repo.getVisible;
            const steps = new Steps(new AppiumFactory(slow.mock.driver, platform, { timeout: 200, appId: 'com.example.app' }), repo);
            await expect(steps.on('cells', 'Screen').byText('Item 1').timeout(200).verifyPresence()).rejects.toThrow(/timed out after 200 ms/);
            await expect(steps.on('cells', 'Screen').visible().timeout(200).text.toBe('Item 1')).rejects.toThrow(/timed out after 200 ms/);
            expect(seen.length).toBeGreaterThanOrEqual(2);
            for (const signal of seen) {
                expect(signal).toBeInstanceOf(AbortSignal);
                expect(signal!.aborted).toBe(true);
            }
            await slow.settle(300, 3000);
        });
    }
});

/** `count` hidden cells, then a shown one; every read takes `readMs`. */
function hiddenCells(count: number): MockNode[] {
    return [{
        match: '~table',
        children: [
            ...Array.from({ length: count }, (_, i) => ({ match: '~cell', text: `Item ${i + 2}`, visible: false })),
            { match: '~cell', text: 'Item 1' },
        ],
    }];
}

test.describe('a probe stops itself between its own reads once the poll gave up on it', () => {
    for (const platform of ['ios', 'android'] as const) {
        test(`${platform}: verifyAbsence reads no further match after the rejection`, async () => {
            const { steps, slow } = slowDeviceSteps(platform, hiddenCells(8), { lookupMs: 10, readMs: 150, repoTimeout: 1500, stepTimeout: 400 });
            const error = await steps.on('cells', 'Screen').timeout(400).verifyAbsence().catch(e => e);
            const rejectedAt = slow.now();
            expect(error).toBeInstanceOf(Error);
            await slow.settle(400, 3000);
            const late = slow.startedAfter(rejectedAt + SAME_TURN_MS);
            expect(late.map(c => `${c.method}@${c.start}`), 'commands started after the rejection').toEqual([]);
        });

        test(`${platform}: a listed-element pick reads no further item after the rejection`, async () => {
            const { steps, slow } = slowDeviceSteps(platform, hiddenCells(8), { lookupMs: 10, readMs: 150, repoTimeout: 1500, stepTimeout: 400 });
            const error = await steps.clickListedElement('cells', 'Screen', { attribute: { name: 'missing', value: 'x' } }).catch(e => e);
            const rejectedAt = slow.now();
            expect(error).toBeInstanceOf(Error);
            await slow.settle(400, 3000);
            expect(slow.startedAfter(rejectedAt + SAME_TURN_MS).map(c => `${c.method}@${c.start}`)).toEqual([]);
        });
    }
});
