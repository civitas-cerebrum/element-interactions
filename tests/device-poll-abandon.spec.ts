import { test, expect } from '@playwright/test';
import type { Steps } from '../src/index';
import { abandonedProbeCount, drainAbandonedProbes, pollUntil } from '../src/utils/poll';
import { cellTree, slowDeviceSteps, type SlowDriverOptions } from './appium/slow-driver';
import * as fs from 'fs';
import * as path from 'path';
import { AppiumDevice } from '../src/appium/AppiumDevice';
import { strategyFor } from '../src/appium/platform';
import { mockDriver } from './appium/mocks';

/**
 * Probes a device poll gives up on.
 *
 * A verification polls a probe until its timeout. The probe still running at
 * the deadline is abandoned, and its abort signal is aborted: the repository
 * lookup it is in (a `byText` pass reading every candidate) starts no
 * further driver command, and the probe starts no read after it. Only the
 * command in flight finishes. If the app were relaunched before it did, that
 * command would hit a stale element that WebdriverIO finds again with a
 * lookup of the list.
 *
 * What is guaranteed:
 * - a poll never runs two of its probes at once, and starts none once a
 *   probe ran out of time;
 * - no driver command starts after the poll rejected (the commands in flight
 *   at the rejection finish);
 * - every abandoned probe is recorded under its driver, and draining that
 *   driver aborts them and waits (with a cap) until they are all done, so
 *   the fixture lets the last command finish on the same app launch, before
 *   the evidence and the next relaunch.
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

/**
 * Every `pollUntil` call (`pollUntil(` or `pollUntil<...>(`) in `source`, as
 * the text from its name to its closing parenthesis.
 */
function pollUntilCalls(source: string): string[] {
    const calls: string[] = [];
    const name = /\bpollUntil\s*(<[^>(]*>)?\s*\(/g;
    for (let match = name.exec(source); match; match = name.exec(source)) {
        let depth = 0;
        let end = match.index + match[0].length - 1;
        for (; end < source.length; end++) {
            if (source[end] === '(') depth++;
            else if (source[end] === ')' && --depth === 0) break;
        }
        calls.push(source.slice(match.index, end + 1));
    }
    return calls;
}

test.describe('every device poll records what it abandons under its driver', () => {
    test('a source scan: every pollUntil call under src/appium passes scope: this.driver', () => {
        const root = path.resolve(__dirname, '../src/appium');
        const files = fs.readdirSync(root, { recursive: true, encoding: 'utf-8' }).filter(f => f.endsWith('.ts'));
        const calls = files.flatMap(file => pollUntilCalls(fs.readFileSync(path.join(root, file), 'utf-8')).map(call => ({ file, call })));
        // The scan itself must see both forms, or it proves nothing.
        expect(calls.length, 'pollUntil calls found').toBeGreaterThanOrEqual(6);
        expect(calls.some(c => /^pollUntil\s*</.test(c.call)), 'a generic pollUntil<...>( call is seen').toBe(true);
        const missing = calls.filter(c => !/\bscope:\s*this\.driver\b/.test(c.call)).map(c => `${c.file}: ${c.call.slice(0, 80)}`);
        expect(missing, 'pollUntil calls without scope: this.driver').toEqual([]);
    });

    for (const platform of ['ios', 'android'] as const) {
        test(`${platform}: a device check (verifyOrientation) that times out leaves its probe recorded under the driver`, async () => {
            const mock = mockDriver({ capabilities: { platformName: platform } });
            (mock.driver as unknown as { getOrientation: () => Promise<string> }).getOrientation =
                () => new Promise(resolve => setTimeout(() => resolve('PORTRAIT'), 300));
            const device = new AppiumDevice(mock.driver, strategyFor(platform), 'com.example.app');
            await expect(device.verifyOrientation('landscape', { timeout: 20 })).rejects.toThrow(/timed out after 20 ms/);
            expect(abandonedProbeCount(mock.driver as object)).toBe(1);
            await drainAbandonedProbes(mock.driver as object, 2000);
            expect(abandonedProbeCount(mock.driver as object)).toBe(0);
        });
    }
});

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

    test.describe(`a rejected poll on ${platform} stops its lookup at the next driver call`, () => {
        for (const [name, run] of PATHS) {
            test(`${name}: no driver command starts after the rejection`, async () => {
                test.setTimeout(30000);
                const { error, slow, rejectedAt } = await reject(platform, run);
                expect(error, 'the check must fail').toBeDefined();
                await slow.settle(800, 10000);
                const late = slow.startedAfter(rejectedAt + SAME_TURN_MS);
                expect(late, `commands started after the rejection: ${summary(late)}`).toEqual([]);
            });

            test(`${name}: after a relaunch only the in-flight commands finish (each with its own refetch)`, async () => {
                test.setTimeout(30000);
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
