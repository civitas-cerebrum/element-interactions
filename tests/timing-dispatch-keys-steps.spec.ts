import { test, expect } from './fixture/StepFixture';

/**
 * Phase-3 coverage for the complementary-steps RFC — the timing + dispatch/keys
 * surface a consumer suite (Mr Marvis e2e) previously dropped to raw Playwright
 * `page.*` for:
 *
 *   A) Timing family — `steps.pace(ms)` (deliberate, semantic pause) and
 *      `steps.repeat(fn, times, { intervalMs })` (intent-revealing "do X N times").
 *   B) Dispatch / keys / geometry — `steps.dispatchEvent`, `steps.pressKeys`,
 *      `steps.getBoundingBox`.
 *
 * Assertions are CONTRACT-level and app-agnostic: counter deltas we drive
 * ourselves, loose timing lower-bounds (never an upper bound — CI is noisy),
 * and geometry contracts (a rendered button has positive size; a missing
 * element has no box).
 */

test.describe('Timing family — pace / repeat', () => {
    test('pace resolves after roughly the requested delay', async ({ steps }) => {
        const start = Date.now();
        await steps.pace(150);
        // Loose lower bound only — timers can fire a hair early, CI never early
        // by much; an upper bound would be flaky.
        expect(Date.now() - start).toBeGreaterThanOrEqual(120);
    });

    test('pace(0) resolves immediately; a negative duration throws', async ({ steps }) => {
        await steps.pace(0); // no throw
        await expect(steps.pace(-1)).rejects.toThrow(/non-negative/i);
    });

    test('repeat runs N times, passing the zero-based index, and collects results', async ({ steps }) => {
        const seen: number[] = [];
        const results = await steps.repeat((i) => { seen.push(i); return i * 2; }, 3);
        expect(seen).toEqual([0, 1, 2]);
        expect(results).toEqual([0, 2, 4]);
    });

    test('repeat(fn, 0) is a no-op returning []; a non-integer count throws', async ({ steps }) => {
        expect(await steps.repeat(() => 1, 0)).toEqual([]);
        await expect(steps.repeat(() => 1, 2.5)).rejects.toThrow(/non-negative integer/i);
    });

    test('repeat with intervalMs paces BETWEEN iterations (not after the last)', async ({ steps }) => {
        const start = Date.now();
        await steps.repeat(() => undefined, 3, { intervalMs: 100 });
        // 3 iterations → 2 gaps of ~100ms. Lower-bound the two gaps only.
        expect(Date.now() - start).toBeGreaterThanOrEqual(180);
    });

    test('repeat drives a real action N times — counter reflects the count', async ({ steps }) => {
        await steps.navigateTo('/pinia-counter');
        await steps.verifyText('counterValue', 'PiniaCounterPage', '0');
        await steps.repeat(() => steps.click('incrementButton', 'PiniaCounterPage'), 3, { intervalMs: 50 });
        await steps.verifyText('counterValue', 'PiniaCounterPage', '3');
    });
});

test.describe('Dispatch / keys / geometry', () => {
    test('dispatchEvent fires a synthetic click that the handler observes', async ({ steps }) => {
        await steps.navigateTo('/pinia-counter');
        await steps.verifyText('counterValue', 'PiniaCounterPage', '0');
        // A dispatched DOM 'click' drives the handler without actionability checks.
        await steps.dispatchEvent('incrementButton', 'PiniaCounterPage', 'click');
        await steps.verifyText('counterValue', 'PiniaCounterPage', '1');
    });

    test('pressKeys joins a chord and drives the focused field; an empty array throws', async ({ steps }) => {
        await steps.navigateTo('/text-inputs');
        await steps.click('textInput', 'TextInputsPage'); // focus the empty input
        // `Shift+A` is a deterministic, OS-independent chord: holding Shift while
        // pressing A types a capital 'A'. Proves the parts were joined with `+`
        // and the chord reached the focused field (unlike Control+A select-all,
        // whose semantics vary by platform).
        await steps.pressKeys(['Shift', 'A']);
        expect(await steps.getInputValue('textInput', 'TextInputsPage')).toBe('A');
        await expect(steps.pressKeys([])).rejects.toThrow(/at least one key/i);
    });

    test('getBoundingBox returns positive geometry for a rendered element', async ({ steps }) => {
        await steps.navigateTo('/buttons');
        const box = await steps.getBoundingBox('primaryButton', 'ButtonsPage');
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.height).toBeGreaterThan(0);
        expect(typeof box!.x).toBe('number');
        expect(typeof box!.y).toBe('number');
    });

    test('getBoundingBox returns null for an element that is not rendered', async ({ steps }) => {
        await steps.navigateTo('/');
        // `missingElement` is defined in the repo but never present in the DOM —
        // the soft attach-probe passes through and boundingBox() resolves null.
        const box = await steps.getBoundingBox('missingElement', 'HomePage');
        expect(box).toBeNull();
    });
});
