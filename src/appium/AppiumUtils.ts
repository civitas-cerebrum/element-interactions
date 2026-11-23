import type { Element } from '@civitas-cerebrum/element-repository';
import type { IUtils } from '../interfaces/IUtils';
import { log } from '../logger/Logger';

type WaitState = 'visible' | 'attached' | 'hidden' | 'detached';

/**
 * Element waiting and pacing for the Appium family. Waits go through the
 * element's own `waitFor` primitive (element-repository), never raw driver
 * calls. `waitForState` throws on timeout unless `optional` is set.
 */
export class AppiumUtils implements IUtils {
    /** Upper bound for a {@link softProbe}, in ms. */
    static readonly SOFT_PROBE_MS = 2_000;

    constructor(private readonly timeout: number = 30000) {}

    getTimeout(): number {
        return this.timeout;
    }

    /** Best-effort, short wait (at most 2 s); never throws. */
    async softProbe(element: Element, state: 'visible' | 'attached' = 'attached', timeout?: number): Promise<void> {
        await this.waitForState(element, state, Math.min(timeout ?? this.timeout, AppiumUtils.SOFT_PROBE_MS), true);
    }

    /**
     * Waits until the element reaches `state` (default `'visible'`).
     * @returns `true` when reached; `false` only when `optional` and the wait timed out.
     * @throws when the wait times out and `optional` is not set.
     */
    async waitForState(element: Element, state: WaitState = 'visible', timeout?: number, optional: boolean = false): Promise<boolean> {
        const effectiveTimeout = timeout ?? this.timeout;
        try {
            await element.waitFor({ state, timeout: effectiveTimeout });
            return true;
        } catch (error) {
            if (optional) {
                log.warn(`Element did not reach state '${state}' within ${effectiveTimeout}ms (optional wait — continuing).`);
                return false;
            }
            const cause = error instanceof Error ? error.message : String(error);
            throw new Error(`Element did not reach state '${state}' within ${effectiveTimeout}ms. ${cause}`);
        }
    }

    /** Deliberate pause for `ms` milliseconds. */
    async pace(ms: number): Promise<void> {
        if (!Number.isFinite(ms) || ms < 0) {
            throw new Error(`pace(ms) requires a non-negative, finite duration, got ${ms}`);
        }
        await new Promise<void>(resolve => setTimeout(resolve, ms));
    }

    /** Runs `fn` `times` times in sequence, pacing `intervalMs` between iterations. */
    async repeat<T>(fn: (index: number) => Promise<T> | T, times: number, options?: { intervalMs?: number }): Promise<T[]> {
        if (!Number.isInteger(times) || times < 0) {
            throw new Error(`repeat(fn, times) requires a non-negative integer count, got ${times}`);
        }
        const results: T[] = [];
        for (let i = 0; i < times; i++) {
            results.push(await fn(i));
            if (options?.intervalMs !== undefined && i < times - 1) {
                await this.pace(options.intervalMs);
            }
        }
        return results;
    }
}
