import { test, expect } from '@playwright/test';
import { format } from 'util';
import { ABANDONED_LOOKUP_DRAIN_MS, drainAbandonedLookups } from '../src/fixture/BaseFixture';
import { abandonedProbeCount, pollUntil } from '../src/utils/poll';
import { log } from '../src/logger/Logger';

/**
 * The platform fixture's wait for device lookups a timed-out check left
 * running. The order inside a real run (before the evidence, before the next
 * relaunch, at worker teardown) is asserted in fixture-platform-run.spec.ts.
 */

type Annotations = { annotations: Array<{ type: string; description?: string }> };

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
    const info: Annotations = { annotations: [] };
    const started = Date.now();
    const warnings = await captureWarnings(() => drainAbandonedLookups(driverStandIn(), 'after the test', info));
    expect(Date.now() - started).toBeLessThan(50);
    expect(warnings.console).toEqual([]);
    expect(info.annotations).toEqual([]);
});

test('an abandoned lookup is waited for until it ends, quietly', async () => {
    const driver = driverStandIn();
    await abandonProbe(driver, 200);
    const info: Annotations = { annotations: [] };
    const warnings = await captureWarnings(() => drainAbandonedLookups(driver, 'after the test', info, 5000));
    expect(abandonedProbeCount(driver)).toBe(0);
    expect(warnings.console).toEqual([]);
    expect(info.annotations).toEqual([]);
});

test('a lookup still running at the cap: a console warning and a test annotation name how many and for how long, then it carries on', async () => {
    const driver = driverStandIn();
    await abandonProbe(driver, Infinity);
    const info: Annotations = { annotations: [] };
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
    const broken = { annotations: { push: () => { throw new Error('annotations are closed'); } } } as unknown as Annotations;
    const warnings = await captureWarnings(() => drainAbandonedLookups(driver, 'after the test', broken, 20));
    expect(warnings.log.join('\n')).toContain('Could not wait for the abandoned device lookups: annotations are closed');
});
