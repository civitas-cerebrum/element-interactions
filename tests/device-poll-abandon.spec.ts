import { test, expect } from '@playwright/test';
import type { Steps } from '../src/index';
import { abandonedProbeCount, drainAbandonedProbes, pollUntil } from '../src/utils/poll';
import { cellTree, slowDeviceSteps, type SlowDriverOptions } from './appium/slow-driver';

/**
 * Probes a device poll gives up on.
 *
 * A verification polls a probe until its timeout. The probe still running at
 * the deadline is abandoned: it cannot be cancelled (element-repository has
 * no way to stop a started lookup), so a `byText` pass keeps reading every
 * remaining candidate. If the app is relaunched meanwhile, every one of
 * those reads hits a stale element that WebdriverIO finds again with a full
 * lookup of the list, and the next test waits behind that traffic.
 *
 * What element-interactions guarantees on its own:
 * - a poll never runs two of its probes at once, and starts none once a
 *   probe ran out of time;
 * - every abandoned probe is recorded under its driver, and draining that
 *   driver waits (with a cap) until they are all done, so the fixture can let
 *   the pass finish on the same app launch, before the evidence and the
 *   next relaunch.
 *
 * Driver: 16 cells, the wanted one last, a 120 ms lookup and 15 ms per
 * element command (a tenth of a measured iOS simulator run).
 */

const DRIVER: SlowDriverOptions & { repoTimeout: number; stepTimeout: number } = {
    lookupMs: 120, readMs: 15, repoTimeout: 1500, stepTimeout: 1200, wdioRefetch: true,
};
const TIMEOUT = 1200;
const CELLS = 16;
/** A command that starts this soon after an event was issued in the same turn as it. */
const SAME_TURN_MS = 5;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const PATHS: Array<[string, (steps: Steps) => PromiseLike<unknown>]> = [
    ['byText verifyAbsence of a shown row', s => s.on('cells', 'Screen').byText('Item 1').timeout(TIMEOUT).verifyAbsence()],
    ['byText visible.toBeFalse of a shown row', s => s.on('cells', 'Screen').byText('Item 1').timeout(TIMEOUT).visible.toBeFalse()],
    ['byText not.visible.toBeTrue of a shown row', s => s.on('cells', 'Screen').byText('Item 1').timeout(TIMEOUT).not.visible.toBeTrue()],
    ['byText verifyText with the wrong text', s => s.on('cells', 'Screen').byText('Item 1').timeout(TIMEOUT).verifyText('nope')],
    ['byText verifyPresence of a missing row', s => s.on('cells', 'Screen').byText('Nothing').timeout(TIMEOUT).verifyPresence()],
];

/** The element commands of one full text pass, plus the reads after it (displayed, text). */
function onePass(platform: 'android' | 'ios'): number {
    // iOS reads the type and the label of every cell; android its text.
    return (platform === 'ios' ? 2 : 1) * CELLS + 2;
}

async function reject(platform: 'android' | 'ios', run: (steps: Steps) => PromiseLike<unknown>) {
    const { steps, slow } = slowDeviceSteps(platform, cellTree(CELLS), DRIVER);
    let error: unknown;
    try {
        await run(steps);
    } catch (e) {
        error = e;
    }
    return { error, slow, rejectedAt: slow.now(), scope: slow.mock.driver as object };
}

const summary = (late: Array<{ method: string; start: number }>) => late.map(c => `${c.method}@${c.start}`).join(' ');

test.describe('abandoned probes are recorded per scope and drained', () => {
    test('a probe that ran out of time is recorded under its scope until it settles', async () => {
        const scope = {};
        const other = {};
        let finish!: () => void;
        const hanging = new Promise<boolean>(resolve => { finish = () => resolve(true); });
        await expect(pollUntil(() => hanging, v => !v, { timeout: 50, scope })).rejects.toThrow(/timed out after 50 ms/);
        expect(abandonedProbeCount(scope)).toBe(1);
        expect(abandonedProbeCount(other)).toBe(0);
        finish();
        await sleep(0);
        expect(abandonedProbeCount(scope)).toBe(0);
    });

    test('a probe that answers, and a poll without a scope, record nothing; a late rejection is recorded until it settles', async () => {
        const scope = {};
        await pollUntil(async () => true, v => v, { timeout: 200, scope });
        expect(abandonedProbeCount(scope)).toBe(0);
        await pollUntil(() => sleep(100).then(() => true), v => !v, { timeout: 20 }).catch(() => undefined);
        expect(abandonedProbeCount(scope)).toBe(0);
        await expect(pollUntil(() => sleep(100).then(() => { throw new Error('late'); }), () => true, { timeout: 30, scope }))
            .rejects.toThrow(/timed out/);
        expect(abandonedProbeCount(scope)).toBe(1);
        const drained = await drainAbandonedProbes(scope, 1000);
        expect(drained).toEqual(expect.objectContaining({ drained: 1, stillRunning: 0 }));
        expect(abandonedProbeCount(scope)).toBe(0);
    });

    test('draining waits until every abandoned probe of the scope settled', async () => {
        const scope = {};
        let done = 0;
        const slowProbe = () => sleep(300).then(() => { done++; return true; });
        await Promise.all([
            pollUntil(slowProbe, v => !v, { timeout: 30, scope }).catch(() => undefined),
            pollUntil(slowProbe, v => !v, { timeout: 60, scope }).catch(() => undefined),
        ]);
        expect(abandonedProbeCount(scope)).toBe(2);
        const started = Date.now();
        const result = await drainAbandonedProbes(scope, 5000);
        expect(done).toBe(2);
        expect(result.drained).toBe(2);
        expect(result.stillRunning).toBe(0);
        expect(Date.now() - started).toBeLessThan(1000);
    });

    test('the drain gives up at its cap and says how many are still running and for how long', async () => {
        const scope = {};
        await pollUntil(() => new Promise<boolean>(() => undefined), v => !v, { timeout: 20, scope }).catch(() => undefined);
        const started = Date.now();
        const result = await drainAbandonedProbes(scope, 150);
        const waited = Date.now() - started;
        expect(waited).toBeGreaterThanOrEqual(140);
        expect(waited).toBeLessThan(1000);
        expect(result.stillRunning).toBe(1);
        expect(result.drained).toBe(0);
        expect(result.longestRunningMs).toBeGreaterThanOrEqual(150);
        expect(result.waitedMs).toBeGreaterThanOrEqual(140);
    });

    test('an empty scope drains at once', async () => {
        const result = await drainAbandonedProbes({}, 5000);
        expect(result).toEqual({ drained: 0, stillRunning: 0, waitedMs: 0, longestRunningMs: 0 });
    });
});

for (const platform of ['ios', 'android'] as const) {
    test.describe(`a rejected device poll on ${platform}: one probe, drained on the same launch`, () => {
        for (const [name, run] of PATHS) {
            test(`${name}: at most one pass runs on after the rejection, and nothing once the drain returns`, async () => {
                test.setTimeout(30000);
                const { error, slow, rejectedAt, scope } = await reject(platform, run);
                expect(error, 'the check must fail').toBeDefined();
                expect(abandonedProbeCount(scope), 'the abandoned probe is recorded under the driver').toBeGreaterThanOrEqual(1);
                const result = await drainAbandonedProbes(scope, 10000);
                const drainedAt = slow.now();
                expect(result.stillRunning).toBe(0);
                expect(slow.inFlight(), 'nothing in flight once the drain returns').toBe(0);
                await slow.settle(500, 3000);
                expect(slow.startedAfter(drainedAt + SAME_TURN_MS), 'commands after the drain').toEqual([]);
                const late = slow.startedAfter(rejectedAt + SAME_TURN_MS);
                expect(late.length, `commands after the rejection: ${summary(late)}`).toBeLessThanOrEqual(onePass(platform));
                expect(late.filter(c => c.method === '$$' || c.method === '$'), 'no new lookup after the rejection').toEqual([]);
            });

            test(`${name}: drained before a relaunch, the pass ends on the same launch (no stale-element refetch)`, async () => {
                test.setTimeout(30000);
                const { error, slow, rejectedAt, scope } = await reject(platform, run);
                expect(error, 'the check must fail').toBeDefined();
                await drainAbandonedProbes(scope, 10000);
                const drainedAt = slow.now();
                // The next test relaunches the app: every element id handed out so far is stale.
                slow.invalidateIds();
                await slow.settle(500, 3000);
                expect(slow.startedAfter(drainedAt + SAME_TURN_MS), 'commands after the drain').toEqual([]);
                const lookups = slow.startedAfter(rejectedAt).filter(c => c.method === '$$' || c.method === '$');
                expect(lookups, `lookups after the rejection: ${summary(lookups)}`).toEqual([]);
            });
        }
    });

    test.describe(`pending element-repository's cancellable lookup: a rejected poll on ${platform} stops at the next driver call`, () => {
        test.fixme(true, 'needs a lookup that can be stopped (an abort signal in element-repository); element-interactions cannot stop a started pass on its own');
        for (const [name, run] of PATHS) {
            test(`${name}: no driver command starts after the rejection`, async () => {
                const { error, slow, rejectedAt } = await reject(platform, run);
                expect(error, 'the check must fail').toBeDefined();
                await slow.settle(800, 10000);
                const late = slow.startedAfter(rejectedAt + SAME_TURN_MS);
                expect(late, `commands started after the rejection: ${summary(late)}`).toEqual([]);
            });

            test(`${name}: after a relaunch only the in-flight commands finish (each with its own refetch)`, async () => {
                const { error, slow, rejectedAt } = await reject(platform, run);
                expect(error, 'the check must fail').toBeDefined();
                const inFlightAtReject = slow.inFlight();
                slow.invalidateIds();
                await slow.settle(800, 10000);
                const late = slow.startedAfter(rejectedAt + SAME_TURN_MS);
                expect(late.length, `commands started after the rejection: ${summary(late)}`).toBeLessThanOrEqual(2 * inFlightAtReject);
            });
        }
    });
}
