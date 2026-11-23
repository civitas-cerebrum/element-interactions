import type { Page, Response } from '@playwright/test';
import type { Platform } from '@civitas-cerebrum/element-repository';
import type { INavigation } from '../interfaces/INavigation';
import type { ExpectNoRequestOptions, LoadState, WaitForNetworkIdleOptions, WaitUntilState } from '../enum/Options';
import { webOnly } from './unsupported';

/**
 * Navigation for the Appium family. Every `INavigation` method is browser
 * navigation (URLs, tabs, viewport, network), so every one throws
 * `PlatformNotSupportedError(method, platform)`; the synchronous ones throw
 * synchronously. App navigation on a device lives on `IDevice`
 * (`openDeepLink`, `pressBack`).
 */
export class AppiumNavigation implements INavigation {
    constructor(private readonly platform: Platform) {}

    async toUrl(_url: string, _waitUntil?: WaitUntilState): Promise<Response | null> { return webOnly('toUrl', this.platform); }
    getUrl(): string { return webOnly('getUrl', this.platform); }
    getCurrentPath(): string { return webOnly('getCurrentPath', this.platform); }
    async waitForUrl(
        _url: string | RegExp | ((url: URL) => boolean),
        _action?: () => Promise<unknown>,
        _options?: { timeout?: number; waitUntil?: WaitUntilState },
    ): Promise<void> { webOnly('waitForUrl', this.platform); }
    async reload(): Promise<void> { webOnly('reload', this.platform); }
    async backOrForward(_direction: 'back' | 'forward'): Promise<void> { webOnly('backOrForward', this.platform); }
    async setViewport(_width: number, _height: number): Promise<void> { webOnly('setViewport', this.platform); }
    async switchToNewTab(_action: () => Promise<unknown>): Promise<Page> { return webOnly('switchToNewTab', this.platform); }
    async closeTab(_targetPage?: Page): Promise<Page> { return webOnly('closeTab', this.platform); }
    getTabCount(): number { return webOnly('getTabCount', this.platform); }
    async waitForNetworkIdle(_options?: WaitForNetworkIdleOptions): Promise<void> { webOnly('waitForNetworkIdle', this.platform); }
    async waitForLoadState(_state: LoadState, _options?: { timeout?: number }): Promise<void> { webOnly('waitForLoadState', this.platform); }
    async waitForResponse(_urlPattern: string | RegExp, _action: () => Promise<void>): Promise<Response> { return webOnly('waitForResponse', this.platform); }
    async expectNoRequest(
        _urlPattern: string | RegExp,
        _action: () => Promise<void>,
        _options?: ExpectNoRequestOptions,
    ): Promise<void> { webOnly('expectNoRequest', this.platform); }
}
