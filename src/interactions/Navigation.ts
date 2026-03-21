import { Page } from '@playwright/test';

/**
 * The `Navigation` class provides a streamlined interface for managing browser 
 * navigation, history, and viewport settings within Playwright.
 */
export class Navigation {

    /**
     * Initializes the Navigation class.
     * @param page - The current Playwright Page object.
     */
    constructor(private page: Page) { }

    /**
    * Navigates the active browser page to the specified URL.
    * Automatically waits for the page to reach the default 'load' state.
    * @param url - The absolute or relative URL to navigate to.
    * Absolute URLs are used as-is. Relative URLs are resolved against
    * `baseURL` from playwright.config.ts, preserving the base path.
    */
    async toUrl(url: string): Promise<void> {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            await this.page.goto(url);
            return;
        }
        const baseURL = (this.page.context() as any)._options?.baseURL;
        if (!baseURL) {
            await this.page.goto(url);
            return;
        }
        const resolved = new URL('.' + (url.startsWith('/') ? url : '/' + url), baseURL).href;
        await this.page.goto(resolved);
    }

    /**
     * Reloads the current page.
     * Useful for resetting application state or checking data persistence.
     */
    async reload(): Promise<void> {
        await this.page.reload();
    }

    /**
     * Navigates the browser history stack either backwards or forwards.
     * Mirrors the behavior of the browser's native Back and Forward buttons.
     * @param direction - The direction to move in history: either 'BACKWARDS' or 'FORWARDS'.
     */
    async backOrForward(direction: 'BACKWARDS' | 'FORWARDS'): Promise<void> {
        if (direction === 'BACKWARDS') {
            await this.page.goBack();
        } else {
            await this.page.goForward();
        }
    }

    /**
     * Resizes the browser viewport to the specified dimensions.
     * Useful for simulating different device screen sizes or responsive breakpoints.
     * @param width - The desired width of the viewport in pixels.
     * @param height - The desired height of the viewport in pixels.
     */
    async setViewport(width: number, height: number): Promise<void> {
        await this.page.setViewportSize({ width, height });
    }
}