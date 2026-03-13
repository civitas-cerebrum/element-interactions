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
     * @param locator - The Playwright Locator.
     * @param state - The state to wait for.
     */
    async waitForState(
        locator: Locator,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible'
    ): Promise<void> {
        try {
            await locator.waitFor({ state, timeout: this.timeout });
        } catch (error) {
            console.warn(`[Warning] -> Element failed to reach state '${state}' within ${this.timeout}ms. Proceeding...`);
        }
    }
}