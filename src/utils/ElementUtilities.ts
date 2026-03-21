import { Locator } from '@playwright/test';

/**
 * Utility class to handle standardized waiting logic across the framework.
 */
export class Utils {
    private readonly timeout: number;

    /**
     * @param timeout - Optional timeout in milliseconds. Defaults to 30000.
     */
    constructor(timeout: number = 30000) {
        this.timeout = timeout;
    }

    /**
     * Returns the current timeout value.
     */
    public getTimeout(): number {
        return this.timeout;
    }

    /**
     * Standardized wait logic for element states.
     * Does not fail the test on timeout; logs a warning instead.
     * If the locator resolves to multiple elements (strict mode violation),
     * the wait is retried automatically on the first matched element.
     * @param locator - The Playwright Locator to wait on.
     * @param state - The DOM state to wait for. Defaults to `'visible'`.
     * @returns A Promise that resolves when the element reaches the desired state,
     * or silently continues if the timeout is exceeded.
     */
    async waitForState(
        locator: Locator,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible'
    ): Promise<void> {
        try { await locator.waitFor({ state, timeout: this.timeout }); }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);

            if (message.includes('strict mode violation')) {
                console.warn(`Locator resolved to multiple elements. Waiting on first element instead.`);
                try { await locator.first().waitFor({ state, timeout: this.timeout }); }
                catch { console.warn(`First element failed to reach state '${state}' within ${this.timeout}ms. Proceeding...`); }
                return;
            }

            console.warn(`Element failed to reach state '${state}' within ${this.timeout}ms. Proceeding...`);
        }
    }
}