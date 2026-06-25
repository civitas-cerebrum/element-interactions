import { Page, Response, Route, errors } from '@playwright/test';
import { logger } from '../logger/Logger';

const log = logger('navigate');

/**
 * The page lifecycle state a navigation waits for before resolving. Mirrors the
 * `waitUntil` values accepted by Playwright's `page.goto` / `page.waitForURL`.
 *
 * - `'load'` (default) — the `load` event fired: full load incl. images and
 *   sub-resources. Robust, but blocks on slow analytics/images and can stall
 *   on a cold WebKit/Safari first paint.
 * - `'domcontentloaded'` — the `DOMContentLoaded` event fired: HTML parsed,
 *   deferred scripts run, but sub-resources may still be loading. The
 *   WebKit-safe choice for SPA navigations.
 * - `'networkidle'` — no network connections for at least 500ms. Discouraged
 *   for assertions; useful after background-fetch flows.
 * - `'commit'` — the navigation response was received and the document started
 *   loading. The earliest signal.
 */
export type WaitUntilState = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

/**
 * The page lifecycle state {@link Navigation.waitForLoadState} waits for.
 * Mirrors the states accepted by Playwright's `page.waitForLoadState` — note
 * this is a strict subset of {@link WaitUntilState}: `'commit'` is NOT a valid
 * load state (it is a navigation-only signal), so it is excluded here.
 *
 * - `'load'` (default) — the `load` event fired (full load incl. sub-resources).
 * - `'domcontentloaded'` — the `DOMContentLoaded` event fired (HTML parsed).
 * - `'networkidle'` — no network connections for at least 500ms.
 */
export type LoadState = 'load' | 'domcontentloaded' | 'networkidle';

/**
 * Options accepted by {@link Navigation.waitForNetworkIdle}.
 */
export interface WaitForNetworkIdleOptions {
    /**
     * Maximum time to wait for the network to go idle, in milliseconds. When
     * omitted, Playwright's default timeout applies (configurable via
     * `page.setDefaultTimeout` or the test config).
     */
    timeout?: number;
    /**
     * When true, a `TimeoutError` resolves quietly instead of throwing — use
     * after best-effort settling where lingering long-poll / analytics traffic
     * should not fail the test. Only the idle timeout is swallowed; real
     * failures (page/context closed, navigation interrupted) still throw.
     * Defaults to false (timeout throws).
     */
    optional?: boolean;
}

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
    * @param url - The absolute or relative URL to navigate to.
    * Absolute URLs are used as-is. Relative URLs are resolved against
    * `baseURL` from playwright.config.ts, preserving the base path.
    * @param waitUntil - The page lifecycle state to wait for before resolving.
    * Defaults to `'load'` (unchanged behaviour). Pass `'domcontentloaded'` for
    * SPA navigations that stall a cold WebKit/Safari on the full `load` event.
    * @returns The navigation `Response` (the response of the last redirect), or
    * `null` when navigation did not trigger a network request (e.g. same-document
    * hash navigation, or `about:blank`). Callers asserting status codes on
    * 404 / redirect contracts read `res.status()` from this; callers that ignore
    * the return value are unaffected.
    */
    async toUrl(url: string, waitUntil?: WaitUntilState): Promise<Response | null> {
        const options = waitUntil ? { waitUntil } : undefined;
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return await this.page.goto(url, options);
        }
        const baseURL = (this.page.context() as any)._options?.baseURL;
        if (!baseURL) {
            return await this.page.goto(url, options);
        }
        const resolved = new URL('.' + (url.startsWith('/') ? url : '/' + url), baseURL).href;
        return await this.page.goto(resolved, options);
    }

    /**
     * Returns the current page URL (the full href), synchronously. The
     * value-returning companion to the `verifyUrlContains` assertion — use it
     * when a test needs the live URL to compute a path, diff against a start
     * URL, or build a pattern.
     */
    getUrl(): string {
        return this.page.url();
    }

    /**
     * Returns the `pathname` of the current page URL (no origin, query, or
     * hash). Convenience over `new URL(getUrl()).pathname`, which the call
     * sites that compare routes overwhelmingly want.
     */
    getCurrentPath(): string {
        return new URL(this.page.url()).pathname;
    }

    /**
     * Waits until the page URL matches `url`, then resolves. Mirrors
     * Playwright's `page.waitForURL`: a string is a glob pattern, a RegExp is a
     * contains-style match, and a predicate receives the live `URL` and returns
     * whether it matches.
     *
     * Pass `action` to arm the wait **before** the navigation-triggering action
     * runs — the wait and the action are issued concurrently (via `Promise.all`)
     * so a fast client-side route change cannot complete in the gap between
     * acting and starting to wait. This is the race-safe form for rapid
     * navigations (e.g. swatch switches firing several navigations in a row).
     *
     * @param url - Glob string, RegExp, or `(url: URL) => boolean` predicate.
     * @param action - Optional action that triggers the navigation. When given,
     *   it is run concurrently with the wait.
     * @param options - Optional `{ timeout, waitUntil }`. `waitUntil` defaults to
     *   `'load'` per Playwright.
     */
    async waitForUrl(
        url: string | RegExp | ((url: URL) => boolean),
        action?: () => Promise<unknown>,
        options?: { timeout?: number; waitUntil?: WaitUntilState },
    ): Promise<void> {
        if (action) {
            await Promise.all([this.page.waitForURL(url, options), action()]);
            return;
        }
        await this.page.waitForURL(url, options);
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
     *
     * @param options - Optional `{ timeout, optional }`. `timeout` bounds the
     *   wait; `optional: true` resolves quietly on timeout instead of throwing
     *   (best-effort settling where lingering analytics/long-poll traffic should
     *   not fail the test). With no options, behaviour is unchanged.
     */
    async waitForNetworkIdle(options?: WaitForNetworkIdleOptions): Promise<void> {
        const loadStateOptions = options?.timeout !== undefined ? { timeout: options.timeout } : undefined;
        if (options?.optional) {
            try {
                await this.page.waitForLoadState('networkidle', loadStateOptions);
            } catch (error) {
                // Best-effort settle: swallow only a genuine idle-timeout. Real
                // failures (page/context closed, navigation interrupted) must
                // still surface — swallowing them would hide bugs and make a
                // broken test pass silently.
                if (error instanceof errors.TimeoutError) return;
                throw error;
            }
            return;
        }
        await this.page.waitForLoadState('networkidle', loadStateOptions);
    }

    /**
     * Waits for the page to reach the given lifecycle `state`. Thin wrapper over
     * Playwright's `page.waitForLoadState`. Unlike {@link waitForNetworkIdle}
     * (which is hard-wired to `'networkidle'`), this exposes the full set of
     * load states for standalone lifecycle waits **after an action** that does
     * not navigate — e.g. waiting for `'domcontentloaded'` after a client-side
     * render swap.
     *
     * @param state - `'load'`, `'domcontentloaded'`, or `'networkidle'`.
     * @param options - Optional `{ timeout }` bounding the wait.
     */
    async waitForLoadState(state: LoadState, options?: { timeout?: number }): Promise<void> {
        await this.page.waitForLoadState(state, options);
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
        // page.waitForResponse / page.waitForRequest. We call route.fallback()
        // (NOT route.continue()) so this stays a genuinely passive observer:
        // fallback() defers to the next matching handler, so a consumer's own
        // mock on an overlapping pattern still runs — and absent one, Playwright
        // performs the default action (the request proceeds to the network).
        // route.continue() would instead send the request to the network
        // *itself*, silently skipping every other matching handler and
        // clobbering the consumer's mocks for the duration of the window.
        const handler = async (route: Route): Promise<void> => {
            const request = route.request();
            const method = request.method().toUpperCase() as ExpectRequestMethod;
            if (!methods || methods.includes(method)) {
                const url = redactQuery ? scrubQuery(request.url()) : request.url();
                matches.push(`${method} ${url}`);
            }
            // Teardown race: if the page navigated away or the route was
            // already consumed, fallback() rejects. Swallow — our observation
            // already happened and the original request is no longer ours to
            // influence.
            try { await route.fallback(); } catch { /* request already handled */ }
        };

        await this.page.route(urlPattern, handler);
        try {
            await action();
            await this.page.waitForTimeout(timeout);
        } finally {
            // Guard the teardown: a failed unroute (page/context already closed)
            // must never replace a real error thrown by `action`.
            await this.page.unroute(urlPattern, handler).catch(() => { /* page already gone */ });
        }

        if (matches.length > 0) {
            const header = `expectNoRequest failed: ${matches.length} request${matches.length === 1 ? '' : 's'} matched ${urlPattern} during action (window ${timeout}ms):`;
            const body = matches.map((line) => `  ${line}`).join('\n');
            throw new Error(`${header}\n${body}`);
        }
    }

}