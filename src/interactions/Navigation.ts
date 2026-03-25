import { Page, Response } from '@playwright/test';
import { logger } from '../logger/Logger';

const log = logger('navigate');

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
     * @param direction - The direction to move in history: either 'back' or 'forward'.
     */
    async backOrForward(direction: 'back' | 'forward'): Promise<void> {
        if (direction === 'back') {
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

    /**
     * Executes an action that opens a new tab/window, waits for the new page,
     * and returns it. The caller is responsible for interacting with the returned page.
     * @param action - An async function that triggers the new tab (e.g. a click).
     * @returns The newly opened Page object.
     */
    async switchToNewTab(action: () => Promise<void>): Promise<Page> {
        const [newPage] = await Promise.all([
            this.page.context().waitForEvent('page'),
            action(),
        ]);
        await newPage.waitForLoadState();
        log('Switched to new tab: %s', newPage.url());
        return newPage;
    }

    /**
     * Closes the specified page (or the current page) and returns focus
     * to the most recent remaining page in the context.
     * @param targetPage - The page to close. Defaults to the current page.
     * @returns The page that received focus after closing.
     */
    async closeTab(targetPage?: Page): Promise<Page> {
        const pageToClose = targetPage ?? this.page;
        await pageToClose.close();
        const pages = this.page.context().pages();
        const remainingPage = pages[pages.length - 1];
        log('Closed tab, returning to: %s', remainingPage.url());
        return remainingPage;
    }

    /**
     * Returns the number of open tabs/pages in the current browser context.
     * @returns The count of open pages.
     */
    getTabCount(): number {
        return this.page.context().pages().length;
    }

    /**
     * Waits until there are no in-flight network requests for at least 500ms.
     * Useful after actions that trigger background API calls, lazy loading, or analytics.
     */
    async waitForNetworkIdle(): Promise<void> {
        await this.page.waitForLoadState('networkidle');
    }

    /**
     * Executes an action and waits for a matching network response to complete.
     * The response is captured concurrently with the action to avoid race conditions.
     * @param urlPattern - A string substring or RegExp to match against the response URL.
     * @param action - An async function that triggers the network request (e.g. a form submit or click).
     * @returns The captured Playwright Response object.
     */
    async waitForResponse(urlPattern: string | RegExp, action: () => Promise<void>): Promise<Response> {
        const [response] = await Promise.all([
            this.page.waitForResponse(urlPattern),
            action(),
        ]);
        return response;
    }

}