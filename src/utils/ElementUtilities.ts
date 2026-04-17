import { Locator } from '@playwright/test';
import { Element, WebElement } from '@civitas-cerebrum/element-repository';
import { log } from '../logger/Logger';

/** Accepts either a Playwright `Locator` or an element-repository `Element`. */
type Waitable = Locator | Element;

function toElement(target: Waitable): Element {
    if ('_type' in target) return target as Element;
    return new WebElement(target as Locator);
}

/**
 * Utility class to handle standardized waiting logic across the framework.
 *
 * All waits go through `Element.waitFor` rather than raw Playwright so the
 * framework works consistently across web and platform drivers.
 */
export class Utils {
    private readonly timeout: number;
    constructor(timeout: number = 30000) {
        this.timeout = timeout;
    }

    /** Returns the current timeout value. */
    public getTimeout(): number {
        return this.timeout;
    }

    /**
     * Standardized wait logic for element states.
     * Does not fail the test on timeout; logs a warning instead.
     * If the resolver yields multiple elements (strict mode violation),
     * the wait is retried automatically on the first matched element.
     *
     * @param target - An `Element` or Playwright `Locator` to wait on.
     * @param state  - The state to wait for. Defaults to `'visible'`.
     */
    async waitForState(
        target: Waitable,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible',
    ): Promise<void> {
        const element = toElement(target);
        try {
            await element.waitFor({ state, timeout: this.timeout });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (message.includes('strict mode violation')) {
                console.warn('Locator resolved to multiple elements. Waiting on first element instead.');
                try {
                    await element.first().waitFor({ state, timeout: this.timeout });
                } catch {
                    log.warn(`First element failed to reach state '${state}' within ${this.timeout}ms...`);
                }
                return;
            }

            log.warn(`Element failed to reach state '${state}' within ${this.timeout}ms...`);
        }
    }
}
