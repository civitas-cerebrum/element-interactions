import { Page, Response, Route } from '@playwright/test';
import { logger } from '../logger/Logger';

const log = logger('navigate');

/**
 * HTTP methods recognized by {@link Navigation.expectNoRequest}'s `methods` filter.
 * Named to avoid confusion with the `HttpMethod` enum exported by `@civitas-cerebrum/wasapi`.
 */
export type ExpectRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Options for {@link Navigation.expectNoRequest}.
 */
export interface ExpectNoRequestOptions {
    /**
     * Observation window in milliseconds after `action` resolves during which a
     * matching request would still trip the assertion. Defaults to 1000ms.
     */
    timeout?: number;
    /**
     * Restrict the assertion to specific HTTP methods. When omitted, requests
     * with any method match.
     */
    methods?: ExpectRequestMethod[];
    /**
     * When true, the query string of any offender URL is replaced with
     * `?…(redacted)` in the thrown error message. The match itself still uses
     * the full URL — only the rendered failure output is scrubbed. Use this
     * when test URLs may carry secrets in query parameters (bearer tokens,
     * API keys, signed-URL signatures) that you don't want surfacing in
     * runner output, CI logs, or Playwright traces.
     *
     * Defaults to false: the URL is shown verbatim so the offender is named
     * (the proposal's stated UX). Path, scheme, host, and fragment are
     * always shown.
     */
    redactQuery?: boolean;
}

/**
 * Replaces the query string of `url` with `?…(redacted)` while preserving the
 * fragment. Returns the input unchanged when no query is present. Pure string
 * manipulation — does not parse the URL (avoids node-URL's normalizations
 * like default-port stripping or trailing-slash addition that would surprise
 * the reader of the failure message).
 */
function scrubQuery(url: string): string {
    const q = url.indexOf('?');
    const h = url.indexOf('#');
    // If '#' appears before '?', the '?' is inside the fragment, not a real query.
    if (q < 0 || (h >= 0 && h < q)) return url;
    const tail = h >= 0 ? url.slice(h) : '';
    return `${url.slice(0, q)}?…(redacted)${tail}`;
}

/**
 * The `Navigation` class provides a streamlined interface for managing browser
 * navigation, history, and viewport settings within Playwright. Also hosts the
 * network primitives — `waitForNetworkIdle`, `waitForResponse`, and the
 * negative companion `expectNoRequest` — so request observation lives next to
 * the navigation calls that typically trigger requests.
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
     * @param urlPattern - A string (Playwright glob) or RegExp to match against the response URL.
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

    /**
     * Asserts that **no** network request matching `urlPattern` fires during
     * `action` (and an observation window afterwards). The negative companion
     * to {@link waitForResponse}.
     *
     * Use this to prove a client-side block — HTML5 `required`, native
     * `type=email` validation, custom JS guards — short-circuits before the
     * XHR is issued. The functional surrogates (URL unchanged, cookie not set)
     * prove the outcome; this asserts the mechanism.
     *
     * Matching uses Playwright's own URL matcher (via `page.route`), so strings
     * are interpreted as **glob patterns** (same as {@link waitForResponse}),
     * not naive substrings. Use a RegExp when you need a contains-style match.
     *
     * If `action` throws, the route handler is unregistered and the action's
     * error is propagated; the observation window is skipped and any matches
     * captured before the throw are discarded.
     *
     * **Secret-leak surface**: when the assertion fails, the offender URL is
     * embedded verbatim into the thrown error message — which flows into the
     * test runner's output, `--reporter` artifacts, and Playwright's HTML
     * report / trace zip (often uploaded as a CI artifact). If your tested
     * URLs carry secrets in query parameters (tokens, API keys, signed-URL
     * signatures), pass `{ redactQuery: true }` to scrub the query string
     * from the failure output. The match itself is unaffected.
     *
     * @param urlPattern - Playwright glob string or RegExp matched against `request.url()`.
     * @param action - The action whose absence-of-request is being asserted.
     * @param options - `timeout` is the observation window after `action`
     *   resolves (default 1000ms — short, because we're asserting absence,
     *   not waiting for arrival). `methods` restricts the assertion to a
     *   subset of HTTP methods. `redactQuery` scrubs query strings from
     *   offender URLs in the failure message.
     * @throws When at least one matching request fired during the window.
     *   The failure message names every offending `method url` line.
     */
    async expectNoRequest(
        urlPattern: string | RegExp,
        action: () => Promise<void>,
        options?: ExpectNoRequestOptions,
    ): Promise<void> {
        const timeout = options?.timeout ?? 1000;
        const methods = options?.methods;
        const redactQuery = options?.redactQuery ?? false;
        const matches: string[] = [];

        // page.route uses Playwright's own URL matcher — same semantics as
        // page.waitForResponse / page.waitForRequest. We pass route.continue()
        // straight through so this stays a passive observer; the only effect
        // on traffic is the unavoidable per-match route round-trip.
        const handler = async (route: Route): Promise<void> => {
            const request = route.request();
            const method = request.method().toUpperCase() as ExpectRequestMethod;
            if (!methods || methods.includes(method)) {
                const url = redactQuery ? scrubQuery(request.url()) : request.url();
                matches.push(`${method} ${url}`);
            }
            // Teardown race: if the page navigated away or the route was
            // already handled by another handler, route.continue() rejects.
            // Swallow — our observation already happened and the original
            // request is no longer ours to influence.
            try { await route.continue(); } catch { /* request already handled */ }
        };

        await this.page.route(urlPattern, handler);
        try {
            await action();
            await this.page.waitForTimeout(timeout);
        } finally {
            await this.page.unroute(urlPattern, handler);
        }

        if (matches.length > 0) {
            const header = `expectNoRequest failed: ${matches.length} request${matches.length === 1 ? '' : 's'} matched ${urlPattern} during action (window ${timeout}ms):`;
            const body = matches.map((line) => `  ${line}`).join('\n');
            throw new Error(`${header}\n${body}`);
        }
    }

}