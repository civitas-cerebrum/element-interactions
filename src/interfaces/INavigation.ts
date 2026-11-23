import type { Page, Response } from '@playwright/test';
import type {
    ExpectNoRequestOptions,
    LoadState,
    WaitForNetworkIdleOptions,
    WaitUntilState,
} from '../playwright/PlaywrightNavigation';

/**
 * Navigation: the full contract every driver family implements.
 *
 * Almost all of it is browser navigation. Web-only on the Appium family
 * (throws `PlatformNotSupportedError`): `toUrl`, `getUrl`, `getCurrentPath`,
 * `waitForUrl`, `reload`, `backOrForward`, `setViewport`, `switchToNewTab` and
 * `closeTab` (take / return a Playwright `Page`), `getTabCount`,
 * `waitForNetworkIdle`, `waitForLoadState`, `waitForResponse` (returns a
 * Playwright `Response`), `expectNoRequest`. App navigation on a device lives
 * on `IDevice` (`openDeepLink`, `pressBack`).
 */
export interface INavigation {
    /** Web only. Resolves the browser's main-frame response. */
    toUrl(url: string, waitUntil?: WaitUntilState): Promise<Response | null>;
    /** Web only. */
    getUrl(): string;
    /** Web only. */
    getCurrentPath(): string;
    /** Web only. */
    waitForUrl(
        url: string | RegExp | ((url: URL) => boolean),
        action?: () => Promise<unknown>,
        options?: { timeout?: number; waitUntil?: WaitUntilState },
    ): Promise<void>;
    /** Web only. */
    reload(): Promise<void>;
    /** Web only. */
    backOrForward(direction: 'back' | 'forward'): Promise<void>;
    /** Web only. */
    setViewport(width: number, height: number): Promise<void>;
    /** Web only (Playwright `Page`). */
    switchToNewTab(action: () => Promise<unknown>): Promise<Page>;
    /** Web only (Playwright `Page`). */
    closeTab(targetPage?: Page): Promise<Page>;
    /** Web only. */
    getTabCount(): number;
    /** Web only. */
    waitForNetworkIdle(options?: WaitForNetworkIdleOptions): Promise<void>;
    /** Web only. */
    waitForLoadState(state: LoadState, options?: { timeout?: number }): Promise<void>;
    /** Web only (Playwright `Response`). */
    waitForResponse(urlPattern: string | RegExp, action: () => Promise<void>): Promise<Response>;
    /** Web only. */
    expectNoRequest(urlPattern: string | RegExp, action: () => Promise<void>, options?: ExpectNoRequestOptions): Promise<void>;
}
