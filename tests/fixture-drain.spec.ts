import { test, expect } from '@playwright/test';
import { format } from 'util';
import { ABANDONED_LOOKUP_DRAIN_MS, drainAbandonedLookups } from '../src/fixture/BaseFixture';
import { abandonedProbeCount, pollUntil } from '../src/utils/poll';
import { log } from '../src/logger/Logger';
import { cellTree, slowDeviceSteps } from './appium/slow-driver';

/**
 * The platform fixture's wait for device lookups a timed-out check left
 * running. The order inside a real run (before the evidence, before the next
 * relaunch, at worker teardown) is asserted in fixture-platform-run.spec.ts.
 */

/** A stand-in for Playwright's TestInfo: its annotations, timeouts and every setTimeout call. */
function fakeInfo(timeout = 30_000, projectTimeout = 30_000) {
    const info = {
        annotations: [] as Array<{ type: string; description?: string }>,
        timeout,
        project: { timeout: projectTimeout },
        setTimeouts: [] as number[],
        setTimeout(ms: number) { info.setTimeouts.push(ms); info.timeout = ms; },
    };
    return info;
}
type Annotations = ReturnType<typeof fakeInfo>;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const driverStandIn = () => ({}) as unknown as WebdriverIO.Browser;

/** Leaves one probe abandoned under `driver` that settles after `ms` (never, with `Infinity`). */
async function abandonProbe(driver: WebdriverIO.Browser, ms: number): Promise<void> {
    const probe = () => (ms === Infinity ? new Promise<boolean>(() => undefined) : sleep(ms).then(() => true));
    await pollUntil(probe, v => !v, { timeout: 20, scope: driver }).catch(() => undefined);
    expect(abandonedProbeCount(driver)).toBe(1);
}

/** Captures console.warn and log.warn lines while `body` runs. */
async function captureWarnings(body: () => Promise<unknown>): Promise<{ console: string[]; log: string[] }> {
    const consoleLines: string[] = [];
    const logLines: string[] = [];
    const originalWarn = console.warn;
    const { log: originalLog, enabled } = log.warn;
    console.warn = (...args: unknown[]) => { consoleLines.push(format(...args)); };
    log.warn.enabled = true;
    log.warn.log = (...args: unknown[]) => { logLines.push(format(...args)); };
    try {
        await body();
    } finally {
        console.warn = originalWarn;
        log.warn.log = originalLog;
        log.warn.enabled = enabled;
    }
    return { console: consoleLines, log: logLines };
}

test('the drain cap holds one measured byText pass with a margin, below the relaunch budget', () => {
    // One pass: about 3.7 s (16 cells, iOS simulator), 3.05 to 3.57 s cold (11 cells, a real Android phone).
    expect(ABANDONED_LOOKUP_DRAIN_MS).toBe(10_000);
});

test('nothing abandoned: returns at once, no warning, no annotation', async () => {
    const info = fakeInfo();
    const started = Date.now();
    const warnings = await captureWarnings(() => drainAbandonedLookups(driverStandIn(), 'after the test', info));
    expect(Date.now() - started).toBeLessThan(50);
    expect(warnings.console).toEqual([]);
    expect(info.annotations).toEqual([]);
});

test('an abandoned lookup is waited for until it ends, quietly', async () => {
    const driver = driverStandIn();
    await abandonProbe(driver, 200);
    const info = fakeInfo();
    const warnings = await captureWarnings(() => drainAbandonedLookups(driver, 'after the test', info, 5000));
    expect(abandonedProbeCount(driver)).toBe(0);
    expect(warnings.console).toEqual([]);
    expect(info.annotations).toEqual([]);
});

test('a lookup still running at the cap: a console warning and a test annotation name how many and for how long, then it carries on', async () => {
    const driver = driverStandIn();
    await abandonProbe(driver, Infinity);
    const info = fakeInfo();
    const started = Date.now();
    const warnings = await captureWarnings(() => drainAbandonedLookups(driver, 'after the test', info, 150));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(warnings.console).toHaveLength(1);
    expect(warnings.console[0]).toMatch(
        /^\[element-interactions\] 1 device lookup\(s\) abandoned by a timed-out check still running after the test, after waiting \d+ ms \(the oldest for \d+ ms\); carrying on\. They may still send driver commands to the device\.$/,
    );
    expect(info.annotations).toEqual([{ type: 'warning', description: warnings.console[0].replace('[element-interactions] ', '') }]);
    // Without a test (worker teardown) only the warning is printed.
    const teardown = await captureWarnings(() => drainAbandonedLookups(driver, 'at worker teardown', undefined, 50));
    expect(teardown.console[0]).toContain('still running at worker teardown');
});

test('the drain never throws: a failure of its own is only logged', async () => {
    const driver = driverStandIn();
    await abandonProbe(driver, Infinity);
    const broken = { ...fakeInfo(), annotations: { push: () => { throw new Error('annotations are closed'); } } } as unknown as Annotations;
    const warnings = await captureWarnings(() => drainAbandonedLookups(driver, 'after the test', broken, 20));
    expect(warnings.log.join('\n')).toContain('Could not wait for the abandoned device lookups: annotations are closed');
});

test.describe('the drain extends the timeout it runs in by its cap, only when it has to wait', () => {
    test('after the body: the teardown slot (the larger of the project and test timeout) plus the cap', async () => {
        const driver = driverStandIn();
        await abandonProbe(driver, 300);
        const info = fakeInfo(600, 30_000);
        await drainAbandonedLookups(driver, 'after the test', info, 1000);
        expect(info.setTimeouts).toEqual([31_000]);
        const longTest = fakeInfo(60_000, 30_000);
        await abandonProbe(driver, 300);
        await drainAbandonedLookups(driver, 'after the test', longTest, 1000);
        expect(longTest.setTimeouts).toEqual([61_000]);
    });

    test('before the relaunch: the test timeout plus the cap', async () => {
        const driver = driverStandIn();
        await abandonProbe(driver, 300);
        const info = fakeInfo(600, 30_000);
        await drainAbandonedLookups(driver, 'before the relaunch', info, 1000, 'setup');
        expect(info.setTimeouts).toEqual([1600]);
    });

    test('nothing to wait for, or no timeout at all (0): the timeout is left alone', async () => {
        const nothing = fakeInfo(600);
        await drainAbandonedLookups(driverStandIn(), 'after the test', nothing, 1000);
        expect(nothing.setTimeouts).toEqual([]);
        for (const [testTimeout, projectTimeout, phase] of [[0, 30_000, 'teardown'], [600, 0, 'teardown'], [0, 30_000, 'setup']] as const) {
            const driver = driverStandIn();
            await abandonProbe(driver, 300);
            const info = fakeInfo(testTimeout, projectTimeout);
            await drainAbandonedLookups(driver, 'after the test', info, 1000, phase);
            expect(info.setTimeouts, `test ${testTimeout}, project ${projectTimeout}, ${phase}`).toEqual([]);
        }
    });
});

test.describe('abort, then drain: the wait is about one driver call, not the rest of a pass', () => {
    // 16 cells, 100 ms a read: one text pass reads for 1.6 s (android) to
    // 3.2 s (ios). The check gives up after 1200 ms, in the middle of a pass.
    const READ_MS = 100;
    const LOOKUP_MS = 50;
    for (const platform of ['ios', 'android'] as const) {
        test(`${platform}: a timed-out byText check is drained within one driver call, quietly`, async () => {
            const { steps, slow } = slowDeviceSteps(platform, cellTree(16), { lookupMs: LOOKUP_MS, readMs: READ_MS, repoTimeout: 1500, stepTimeout: 1200 });
            const driver = slow.mock.driver;
            await expect(steps.on('cells', 'Screen').byText('Item 1').timeout(1200).verifyAbsence()).rejects.toThrow(/timed out after 1200 ms/);
            const info = fakeInfo();
            const started = Date.now();
            const warnings = await captureWarnings(() => drainAbandonedLookups(driver, 'after the test', info));
            const waited = Date.now() - started;
            expect(abandonedProbeCount(driver)).toBe(0);
            expect(slow.inFlight(), 'nothing in flight once the drain returns').toBe(0);
            // The call in flight at the rejection, with room for a loaded host; a pass is several times longer.
            expect(waited, 'the drain waits for the call in flight only').toBeLessThanOrEqual(READ_MS + LOOKUP_MS + 150);
            expect(warnings.console).toEqual([]);
            expect(info.annotations).toEqual([]);
        });
    }
});
