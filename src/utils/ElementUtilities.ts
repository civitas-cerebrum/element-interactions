import { WebElement } from '@civitas-cerebrum/element-repository';
import { log } from '../logger/Logger';

/**
 * Utility class to handle standardized waiting logic across the framework.
 *
 * All waits go through `Element.waitFor` rather than raw Playwright so the
 * framework works consistently across web and platform drivers.
 */
export class Utils {
    static readonly SOFT_PROBE_MS = 2_000;
    private readonly timeout: number;
    constructor(timeout: number = 30000) {
        this.timeout = timeout;
    }

    /** Returns the current timeout value. */
    public getTimeout(): number {
        return this.timeout;
    }

    async softProbe(element: WebElement, state: 'visible' | 'attached' = 'attached', timeout?: number): Promise<void> {
        // `optional: true` — a probe must never fail the action; the action
        // call that follows carries the real timeout and throws on its own.
        await this.waitForState(element, state, Math.min(timeout ?? this.timeout, Utils.SOFT_PROBE_MS), true);
    }

    /**
     * Standardized wait logic for element states.
     * Throws on timeout as of 0.3.7; pass `optional: true` to get the
     * pre-0.4 soft behavior (resolves `false`, logs a warning).
     * If the resolver yields multiple elements (strict mode violation),
     * the wait retries on the first matched element and logs loudly.
     *
     * @param element  - An `Element` to wait on.
     * @param state    - The state to wait for. Defaults to `'visible'`.
     * @param timeout  - Per-call timeout override. Falls back to the instance timeout when omitted.
     * @param optional - When `true`, a timeout resolves `false` instead of throwing.
     * @returns `true` when the state was reached; `false` only when `optional` and the wait timed out.
     */
    async waitForState(
        element: WebElement,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible',
        timeout?: number,
        optional: boolean = false,
    ): Promise<boolean> {
        const effectiveTimeout = timeout ?? this.timeout;
        try {
            await element.waitFor({ state, timeout: effectiveTimeout });
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (message.includes('strict mode violation')) {
                log.warn(`Locator resolved to multiple elements (strict mode violation) — waiting on the FIRST match. Narrow the repository selector to silence this.`);
                try {
                    await element.first().waitFor({ state, timeout: effectiveTimeout });
                    return true;
                } catch (innerError) {
                    return this.handleWaitTimeout(state, effectiveTimeout, optional, innerError);
                }
            }

            return this.handleWaitTimeout(state, effectiveTimeout, optional, error);
        }
    }

    /**
     * Terminal handling for a timed-out wait: soft (warn + `false`) when the
     * wait was optional, an error carrying the original cause otherwise.
     */
    private handleWaitTimeout(state: string, timeout: number, optional: boolean, cause: unknown): boolean {
        if (optional) {
            log.warn(`Element did not reach state '${state}' within ${timeout}ms (optional wait — continuing).`);
            return false;
        }
        const causeMsg = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Element did not reach state '${state}' within ${timeout}ms. ${causeMsg}`);
    }
}
