import { test, expect } from '@playwright/test';
import { pollUntil, PollTimeoutError, ProbeTimeoutError, DEFAULT_POLL_INTERVAL } from '../src/utils/poll';

/** Pure unit tests for the shared polling helper. Tiny real timeouts; no browser. */

/** A probe returning `values[i]` on its i-th call (the last value repeats). */
function sequence<T>(values: T[]) {
    let calls = 0;
    const probe = async () => values[Math.min(calls++, values.length - 1)];
    return { probe, calls: () => calls };
}

test.describe('pollUntil', () => {
    test('resolves on the first probe when the check passes, without sleeping', async () => {
        const { probe, calls } = sequence(['ok']);
        const started = Date.now();
        await expect(pollUntil(probe, v => v === 'ok', { timeout: 5000 })).resolves.toBe('ok');
        expect(calls()).toBe(1);
        expect(Date.now() - started).toBeLessThan(50);
    });

    test('retries until the value changes on the 3rd probe', async () => {
        const { probe, calls } = sequence(['a', 'b', 'c']);
        await expect(pollUntil(probe, v => v === 'c', { timeout: 2000, interval: 5 })).resolves.toBe('c');
        expect(calls()).toBe(3);
    });

    test('a check that returns nothing passes; one that throws is retried (assertion style)', async () => {
        const { probe, calls } = sequence([1, 2, 3]);
        const value = await pollUntil(probe, v => {
            if (v < 3) throw new Error(`still ${v}`);
        }, { timeout: 2000, interval: 5 });
        expect(value).toBe(3);
        expect(calls()).toBe(3);
    });

    test('probe errors are retried, not thrown, until the deadline', async () => {
        let calls = 0;
        const probe = async () => {
            calls++;
            if (calls < 3) throw new Error('stale element reference');
            return 'found';
        };
        await expect(pollUntil(probe, v => v === 'found', { timeout: 2000, interval: 5 })).resolves.toBe('found');
        expect(calls).toBe(3);
    });

    test('times out with the message, the timeout and the last observed value', async () => {
        const { probe } = sequence(['a', 'b', 'still wrong']);
        const error = await pollUntil(probe, v => v === 'right', {
            timeout: 120, interval: 10, message: 'Expected text "right"',
        }).catch(e => e);
        expect(error).toBeInstanceOf(PollTimeoutError);
        expect(error.message).toBe('Expected text "right": timed out after 120 ms. Last value: "still wrong".');
        expect(error.lastValue).toBe('still wrong');
        expect(error.timeout).toBe(120);
    });

    test('the timeout message carries the last error and the last value', async () => {
        const error = await pollUntil(async () => 5, v => { throw new Error(`count was ${v}`); }, {
            timeout: 30, interval: 5, message: () => 'Expected count 7',
        }).catch(e => e);
        expect(error.message).toBe('Expected count 7: timed out after 30 ms. Last value: 5. Last error: count was 5');
    });

    test('when every probe fails, the message says so and names the last error', async () => {
        const error = await pollUntil(async () => { throw new Error('no such element'); }, () => true, {
            timeout: 30, interval: 5,
        }).catch(e => e);
        expect(error.message).toBe(
            'Condition not met: timed out after 30 ms. Last value: (no value; every probe failed). Last error: no such element',
        );
        expect(error.lastError).toBeInstanceOf(Error);
    });

    test('honours the timeout: gives up close to the deadline, not before and not long after', async () => {
        const started = Date.now();
        await pollUntil(async () => false, v => v, { timeout: 300, interval: 20 }).catch(() => undefined);
        const elapsed = Date.now() - started;
        expect(elapsed).toBeGreaterThanOrEqual(295);
        expect(elapsed).toBeLessThan(600);
    });

    test('timeout 0 still probes exactly once', async () => {
        const { probe, calls } = sequence([false]);
        await expect(pollUntil(probe, v => v, { timeout: 0 })).rejects.toBeInstanceOf(PollTimeoutError);
        expect(calls()).toBe(1);
        const ok = sequence([true]);
        await expect(pollUntil(ok.probe, v => v, { timeout: 0 })).resolves.toBe(true);
    });

    test('default interval is 100 ms', async () => {
        expect(DEFAULT_POLL_INTERVAL).toBe(100);
        const { probe, calls } = sequence([false]);
        await pollUntil(probe, v => v, { timeout: 350 }).catch(() => undefined);
        // probes at ~0, 100, 200, 300 and a final one at the deadline
        expect(calls()).toBeGreaterThanOrEqual(4);
        expect(calls()).toBeLessThanOrEqual(6);
    });

    test('a probe that hangs is cut off at the deadline: the call fails at about timeout + interval', async () => {
        const started = Date.now();
        // Each probe answers only after 2 s (a driver's implicit wait), far past the 300 ms timeout.
        const slow = () => new Promise<string>(resolve => setTimeout(() => resolve('late'), 2000).unref());
        const error = await pollUntil(slow, v => v === 'never', { timeout: 300, interval: 50, message: 'Slow probe' }).catch(e => e);
        const elapsed = Date.now() - started;
        expect(error).toBeInstanceOf(PollTimeoutError);
        expect(error.lastError).toBeInstanceOf(ProbeTimeoutError);
        expect(error.message).toMatch(/^Slow probe: timed out after 300 ms\. Last value: \(no value; every probe failed\)\. Last error: the probe did not answer within \d+ ms$/);
        expect(elapsed).toBeGreaterThanOrEqual(295);
        expect(elapsed).toBeLessThan(300 + 50 + 150);
    });

    test('a slow probe that answers within the deadline is still accepted', async () => {
        const value = await pollUntil(() => new Promise<string>(resolve => setTimeout(() => resolve('ok'), 150)), v => v === 'ok', { timeout: 1000 });
        expect(value).toBe('ok');
    });

    test('a probe at timeout 0 still gets one interval to answer', async () => {
        const value = await pollUntil(() => new Promise<string>(resolve => setTimeout(() => resolve('ok'), 20)), v => v === 'ok', { timeout: 0, interval: 200 });
        expect(value).toBe('ok');
        const started = Date.now();
        const error = await pollUntil(() => new Promise<string>(() => undefined), () => true, { timeout: 0, interval: 60 }).catch(e => e);
        expect(error.lastError).toBeInstanceOf(ProbeTimeoutError);
        expect(Date.now() - started).toBeLessThan(60 + 150);
    });

    test('interval 0 at timeout 0 never gives a probe a zero budget', async () => {
        const error = await pollUntil(() => new Promise<string>(() => undefined), () => true, { timeout: 0, interval: 0 }).catch(e => e);
        expect(error).toBeInstanceOf(PollTimeoutError);
        expect(error.lastError).toBeInstanceOf(ProbeTimeoutError);
        expect((error.lastError as ProbeTimeoutError).budget).toBeGreaterThanOrEqual(1);
    });

    test('an abandoned probe that rejects late raises no unhandled rejection', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            const late = () => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('late failure')), 120));
            await pollUntil(late, () => true, { timeout: 30, interval: 10 }).catch(() => undefined);
            await new Promise(resolve => setTimeout(resolve, 250));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    test('rejects an invalid timeout or interval up front', async () => {
        await expect(pollUntil(async () => 1, () => true, { timeout: -1 })).rejects.toThrow(/timeout must be/);
        await expect(pollUntil(async () => 1, () => true, { timeout: Number.NaN })).rejects.toThrow(/timeout must be/);
        await expect(pollUntil(async () => 1, () => true, { timeout: 10, interval: -5 })).rejects.toThrow(/interval must be/);
    });
});
