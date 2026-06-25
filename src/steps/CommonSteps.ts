import { Page, Response, Locator } from '@playwright/test';
import { ElementRepository, Element, WebElement, ElementResolutionOptions, SelectionStrategy } from '@civitas-cerebrum/element-repository';
import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { Utils } from '../utils/ElementUtilities';
import { EmailClientConfig, EmailSendOptions, EmailReceiveOptions, ReceivedEmail, EmailMarkOptions, EmailMarkAction, EmailFilter } from '@civitas-cerebrum/email-client';
import { WasapiClient, ApiResponse } from '@civitas-cerebrum/wasapi';
import { SqlClient, SqlResult, QueryBuilder, UnsupportedEngineException } from '@civitas-cerebrum/sql-client';
import { StepOptions, DropdownSelectOptions, TextVerifyOptions, CountVerifyOptions, DragAndDropOptions, ListedElementOptions, ListedElementMatch, VerifyListedOptions, GetListedDataOptions, FillFormValue, GetAllOptions, ScreenshotOptions, IsVisibleOptions, StorageVerifyOptions, VisualMatchOptions, VisualMaskTarget } from '../enum/Options';
import { ExpectNoRequestOptions, WaitUntilState, WaitForNetworkIdleOptions } from '../interactions/Navigation';
import { stepLog as log } from '../logger/Logger';
import { ElementAction } from './ElementAction';
import { ExpectBuilder } from './ExpectMatchers';

/**
 * The `Steps` class serves as a unified Facade for test orchestration.
 * It combines element acquisition (via `@civitas-cerebrum/element-repository`) with
 * Playwright interactions, navigation, and verifications to keep test files clean,
 * readable, and free of raw locators.
 */
export class Steps {
    private page: Page;
    private interact;
    private navigate;
    private extract;
    private verify;
    private utils;
    private email;
    private apiClients: Map<string, WasapiClient>;
    /** Lazily-built SqlClient cache, keyed by provider name (constructed on first DB step). */
    private dbClients: Map<string, SqlClient>;
    /** Provider name → connection string. Clients are built on first use so a missing driver fails at the first DB step, not at fixture setup. */
    private dbConfigs: Map<string, string>;
    private dbConnectTimeoutMs?: number;
    private timeout?: number;
    private interceptionRetry?: boolean;

    /**
     * Initializes the Steps class with the element repository.
     * The Playwright Page is obtained from the repository's driver.
     * @param repo - An initialized instance of `ElementRepository` containing your locators and the bound driver.
     * @param options - Optional configuration: emailCredentials, timeout, interceptionRetry, apiBaseUrl, and/or apiProviders.
     */
    constructor(
        private repo: ElementRepository,
        options?: {
            emailCredentials?: EmailClientConfig;
            timeout?: number;
            /**
             * When a click is intercepted by an overlaying element, retry it as a
             * dispatched DOM click event. Default `true` (compat). Set `false` so
             * genuine overlay bugs (stuck modals, cookie walls) fail the click.
             */
            interceptionRetry?: boolean;
            apiBaseUrl?: string;
            apiProviders?: Record<string, string>;
            dbUrl?: string;
            dbProviders?: Record<string, string>;
            /**
             * Connect-timeout (ms) applied to every SQL client, so a wrong/unreachable
             * `dbUrl` fails fast in CI instead of hanging on the first query.
             */
            dbConnectTimeoutMs?: number;
        }
    ) {
        this.page = repo.driver;
        const { emailCredentials, timeout, interceptionRetry, apiBaseUrl, apiProviders } = options ?? {};
        const interactions = new ElementInteractions(this.page, { emailCredentials, timeout, interceptionRetry });
        this.interceptionRetry = interceptionRetry;
        this.interact = interactions.interact;
        this.navigate = interactions.navigate;
        this.extract = interactions.extract;
        this.verify = interactions.verify;
        this.timeout = timeout;
        this.utils = new Utils(timeout);
        this.email = interactions.email;
        this.apiClients = new Map();

        if (apiBaseUrl) {
            this.apiClients.set('default', new WasapiClient.Builder().setBaseUrl(apiBaseUrl).setLogHeaders(false).buildRaw());
        }
        if (apiProviders) {
            for (const [name, url] of Object.entries(apiProviders)) {
                this.apiClients.set(name, new WasapiClient.Builder().setBaseUrl(url).setLogHeaders(false).buildRaw());
            }
        }
        const { dbUrl, dbProviders, dbConnectTimeoutMs } = options ?? {};
        // Register connection strings only — clients are constructed lazily on the
        // first DB step so a missing engine driver surfaces a clear, actionable error
        // at the call site (not at fixture setup, before any SQL is run).
        this.dbClients = new Map();
        this.dbConfigs = new Map();
        this.dbConnectTimeoutMs = dbConnectTimeoutMs;
        if (dbUrl) {
            this.dbConfigs.set('default', dbUrl);
        }
        if (dbProviders) {
            for (const [name, url] of Object.entries(dbProviders)) {
                this.dbConfigs.set(name, url);
            }
        }
    }

    /**
     * Maps StepOptions to ElementResolutionOptions for the repository.
     */
    private toResolutionOptions(options?: StepOptions): ElementResolutionOptions | undefined {
        if (!options?.strategy || options.strategy === 'first') return undefined;

        switch (options.strategy) {
            case 'random':
                return { strategy: SelectionStrategy.RANDOM };
            case 'index':
                return { strategy: SelectionStrategy.INDEX, index: options.index };
            case 'text':
                return { strategy: SelectionStrategy.TEXT, value: options.text ?? options.value };
            case 'attribute':
                return { strategy: SelectionStrategy.ATTRIBUTE, attribute: options.attribute, value: options.value };
            case 'all':
                return { strategy: SelectionStrategy.ALL };
            default:
                return undefined;
        }
    }

    /**
     * Returns resolution options that force the ALL strategy (no .first() narrowing).
     * Used by collection-based methods like getCount, verifyCount, getAll, verifyOrder.
     */
    private toAllResolutionOptions(options?: StepOptions): ElementResolutionOptions {
        if (options?.strategy && options.strategy !== 'first') {
            return this.toResolutionOptions(options) ?? { strategy: SelectionStrategy.ALL };
        }
        return { strategy: SelectionStrategy.ALL };
    }

    /**
     * Resolves an element from the repository and narrows its type to
     * `WebElement`. This package is Playwright-only, so every resolved element
     * is in practice a `WebElement`. Calling this once at the repo boundary
     * lets every downstream call use the richer `WebElement` type (with its
     * `locator` / `rightClick` / `selectOption` / `getAllAttributes`) without
     * per-call casts.
     */
    private async getWebElement(elementName: string, pageName: string, options?: StepOptions): Promise<WebElement> {
        return (await this.repo.get(elementName, pageName, this.toResolutionOptions(options))) as WebElement;
    }

    /**
     * Same as `getWebElement` but forces the ALL strategy. For collection-based
     * methods (getCount, verifyOrder, verifyImages, etc.).
     */
    private async getAllWebElement(elementName: string, pageName: string, options?: StepOptions): Promise<WebElement> {
        return (await this.repo.get(elementName, pageName, this.toAllResolutionOptions(options))) as WebElement;
    }

    /**
     * Returns a fluent `ElementAction` with the caller's `StepOptions` strategy
     * applied via the fluent strategy selectors. Lets the legacy positional
     * `verify*` methods delegate into the matcher tree without losing the
     * `{ strategy: 'random' | 'index' | 'text' | 'attribute' }` escape hatch.
     */
    private actionWithStrategy(elementName: string, pageName: string, options?: StepOptions): ElementAction {
        const action = this.on(elementName, pageName);
        if (!options?.strategy || options.strategy === 'first') return action;
        switch (options.strategy) {
            case 'random':
                return action.random();
            case 'index':
                return action.nth(options.index ?? 0);
            case 'text':
                return action.byText(options.text ?? options.value ?? '');
            case 'attribute':
                return action.byAttribute(options.attribute ?? '', options.value ?? '');
            default:
                return action;
        }
    }

    /**
     * Returns a fluent builder for performing actions on a repository element.
     * Chain a strategy selector (optional) and terminate with an action.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @returns An `ElementAction` builder.
     *
     * @example
     * ```ts
     * await steps.on('mainNavItems', 'HomePage').first().hover();
     * await steps.on('subcategoryItems', 'HomePage').random().click({ withoutScrolling: true });
     * await steps.on('productCards', 'CollectionsPage').verifyPresence();
     * const price = await steps.on('price', 'ProductPage').nth(0).getText();
     * ```
     */
    on(elementName: string, pageName: string): ElementAction {
        const interactions = new ElementInteractions(this.page, { timeout: this.timeout, interceptionRetry: this.interceptionRetry });
        return new ElementAction(this.repo, elementName, pageName, interactions, this.timeout);
    }

    // ==========================================
    // NAVIGATION STEPS
    // ==========================================

    /**
     * Navigates the browser to the specified URL.
     * Optionally appends query parameters and/or chooses the lifecycle state to
     * wait for.
     * @param url - The URL or path to navigate to (e.g. `'/dashboard'` or `'https://example.com'`).
     * @param options - Optional settings. `query` is a key-value map appended as
     *   query parameters. `waitUntil` chooses the page lifecycle state to wait
     *   for (default `'load'`); pass `'domcontentloaded'` for SPA navigations
     *   that stall a cold WebKit/Safari on the full `load` event.
     */
    async navigateTo(url: string, options?: { query?: Record<string, string>; waitUntil?: WaitUntilState }): Promise<void> {
        let targetUrl = url;
        if (options?.query) {
            const params = new URLSearchParams(options.query).toString();
            // Insert the query *before* any hash fragment and preserve the
            // fragment — appending after it (`/path#a?x=y`) would fold the query
            // into the fragment and break SPA routing.
            const hashIndex = url.indexOf('#');
            const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
            const fragment = hashIndex >= 0 ? url.slice(hashIndex) : '';
            targetUrl = `${base}${base.includes('?') ? '&' : '?'}${params}${fragment}`;
        }
        log.navigate('Navigating to URL: "%s"', targetUrl);
        await this.navigate.toUrl(targetUrl, options?.waitUntil);
    }

    /**
     * Returns the current page URL (the full href). The value-returning
     * companion to {@link verifyUrlContains} — use it when a test needs the live
     * URL to compute a path, diff against a start URL, or build a pattern.
     */
    getUrl(): string {
        log.navigate('Getting current URL');
        return this.navigate.getUrl();
    }

    /**
     * Returns the `pathname` of the current page URL (no origin, query, or hash).
     * Convenience over `new URL(steps.getUrl()).pathname`.
     */
    getCurrentPath(): string {
        log.navigate('Getting current path');
        return this.navigate.getCurrentPath();
    }

    /**
     * Waits until the page URL matches `url`. A string is a glob pattern, a
     * RegExp is a contains-style match, and a predicate receives the live `URL`.
     *
     * Pass `action` to arm the wait **before** the navigation-triggering action
     * runs (issued concurrently via `Promise.all`) so a fast client-side route
     * change cannot complete in the gap between acting and waiting — the
     * race-safe form for rapid navigations.
     *
     * @param url - Glob string, RegExp, or `(url: URL) => boolean` predicate.
     * @param action - Optional navigation-triggering action, run concurrently.
     * @param options - Optional `{ timeout, waitUntil }`.
     */
    async waitForUrl(
        url: string | RegExp | ((url: URL) => boolean),
        action?: () => Promise<void>,
        options?: { timeout?: number; waitUntil?: WaitUntilState },
    ): Promise<void> {
        log.wait('Waiting for URL to match');
        await this.navigate.waitForUrl(url, action, options);
    }

    /**
     * Refreshes (reloads) the current page.
     */
    async refresh(): Promise<void> {
        log.navigate('Refreshing the current page');
        await this.navigate.reload();
    }

    /**
     * Navigates the browser history backwards or forwards.
     * @param direction - The direction to navigate: `'back'` or `'forward'`.
     */
    async backOrForward(direction: 'back' | 'forward'): Promise<void> {
        log.navigate('Navigating browser: "%s"', direction);
        await this.navigate.backOrForward(direction);
    }

    /**
     * Sets the browser viewport to the specified dimensions.
     * @param width - The viewport width in pixels.
     * @param height - The viewport height in pixels.
     */
    async setViewport(width: number, height: number): Promise<void> {
        log.navigate('Setting viewport to %dx%d', width, height);
        await this.navigate.setViewport(width, height);
    }

    /**
     * Executes an action that opens a new browser tab/window, waits for it to load,
     * and returns the new Page object.
     * @param action - An async function that triggers the new tab (e.g. a click).
     * @returns The newly opened Page object.
     */
    async switchToNewTab(action: () => Promise<void>): Promise<Page> {
        log.navigate('Switching to new tab...');
        return await this.navigate.switchToNewTab(action);
    }

    /**
     * Closes the specified tab (or the current page's tab) and returns the remaining page.
     * @param targetPage - The page to close. Defaults to the current page.
     * @returns The page that received focus after closing.
     */
    async closeTab(targetPage?: Page): Promise<Page> {
        log.navigate('Closing tab...');
        return await this.navigate.closeTab(targetPage);
    }

    /**
     * Returns the number of open tabs/pages in the current browser context.
     * @returns The count of open pages.
     */
    getTabCount(): number {
        log.navigate('Getting tab count');
        return this.navigate.getTabCount();
    }

    // ==========================================
    // INTERACTION STEPS
    // ==========================================

    /**
     * Clicks on an element identified by page and element name from the repository.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution and click modifiers.
     */
    async click(elementName: string, pageName: string, options?: StepOptions): Promise<boolean | void> {
        log.interact('Clicking on "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.interact.click(element, {
            withoutScrolling: options?.withoutScrolling,
            ifPresent: options?.ifPresent,
            force: options?.force,
            subject: `${pageName}.${elementName}`,
        });
    }

    /**
     * Clicks a random visible element from a group of elements matching the locator.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options.
     * @throws Error if no visible element is found for the given locator.
     */
    async clickRandom(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Clicking a random element from "%s" in "%s"', elementName, pageName);
        const element = await this.repo.getRandom(elementName, pageName);
        if (!element) throw new Error(`No visible element found for "${elementName}" in "${pageName}"`);
        await this.interact.click(element as WebElement, {
            withoutScrolling: options?.withoutScrolling,
            subject: `${pageName}.${elementName}`,
        });
    }

    /**
     * Clicks on an element only if it is present in the DOM.
     * Does nothing and returns false if the element is not found.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async clickIfPresent(elementName: string, pageName: string, options?: StepOptions): Promise<boolean> {
        log.interact('Clicking on "%s" in "%s" (if present)', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.interact.click(element, { ifPresent: true, subject: `${pageName}.${elementName}` }) as boolean;
    }

    /**
     * Right-clicks on an element identified by page and element name from the repository.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async rightClick(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Right-clicking on "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.rightClick(element);
    }

    /**
     * Double-clicks on an element identified by page and element name from the repository.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async doubleClick(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Double-clicking on "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.doubleClick(element);
    }

    /**
     * Checks a checkbox or radio button. Idempotent.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async check(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Checking "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.check(element);
    }

    /**
     * Unchecks a checkbox. Idempotent.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async uncheck(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Unchecking "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.uncheck(element);
    }

    /**
     * Hovers over an element, triggering any hover-based UI effects.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async hover(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Hovering over "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.hover(element);
    }

    /**
     * Scrolls the specified element into the visible viewport.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async scrollIntoView(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Scrolling "%s" in "%s" into view', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.scrollIntoView(element);
    }

    /**
     * Clears the input field and fills it with the specified text.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param text - The text to fill into the input field.
     * @param options - Optional step options for element resolution.
     */
    async fill(elementName: string, pageName: string, text: string, options?: StepOptions): Promise<void> {
        log.interact('Filling "%s" in "%s" with text: "%s"', elementName, pageName, text);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.fill(element, text);
    }

    /**
     * Uploads one or more files to a file input element.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param filePath - Path to the file, or an array of paths for multi-file inputs.
     * @param options - Optional step options for element resolution.
     */
    async uploadFile(elementName: string, pageName: string, filePath: string | string[], options?: StepOptions): Promise<void> {
        const label = Array.isArray(filePath) ? filePath.join(', ') : filePath;
        log.interact('Uploading file "%s" to "%s" in "%s"', label, elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.uploadFile(element, filePath);
    }

    /**
     * Simulates dropping files onto a drop-zone element by dispatching
     * `dragenter`, `dragover`, and `drop` events with a populated `DataTransfer`.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param filenames - File name(s) to include in the drop (basename only; no real file is read).
     * @param options - Optional `mimeType` (default `'application/octet-stream'`) and step options.
     */
    async dropFiles(
        elementName: string,
        pageName: string,
        filenames: string[],
        options?: { mimeType?: string } & StepOptions,
    ): Promise<void> {
        log.interact('Dropping files "%s" onto "%s" in "%s"', filenames.join(', '), elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.dropFiles(element, filenames, { mimeType: options?.mimeType });
    }

    /**
     * Selects an option from a `<select>` dropdown element.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param dropdownOptions - Optional selection strategy (random, by value, or by index).
     * @param options - Optional step options for element resolution.
     * @returns The value of the selected option.
     */
    async selectDropdown(
        elementName: string,
        pageName: string,
        dropdownOptions?: DropdownSelectOptions,
        options?: StepOptions
    ): Promise<string> {
        log.interact('Selecting dropdown option for "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.interact.selectDropdown(element, dropdownOptions);
    }

    /**
     * Performs a drag-and-drop action on an element.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param dragOptions - Drag target: either `{ target: Element }` or `{ xOffset, yOffset }`.
     * @param options - Optional step options for element resolution.
     */
    async dragAndDrop(elementName: string, pageName: string, dragOptions: DragAndDropOptions, options?: StepOptions): Promise<void> {
        log.interact('Dragging and dropping "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.dragAndDrop(element, dragOptions);
    }

    /**
     * Performs a drag-and-drop action on a specific element within a list,
     * identified by its visible text content.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementText - The visible text of the specific list item to drag.
     * @param dragOptions - Drag target: either `{ target: Element }` or `{ xOffset, yOffset }`.
     * @throws Error if no element with the specified text is found.
     */
    async dragAndDropListedElement(elementName: string, pageName: string, elementText: string, dragOptions: DragAndDropOptions): Promise<void> {
        log.interact('Dragging and dropping "%s" in "%s"', elementText, pageName);
        const element = await this.repo.getByText(elementName, pageName, elementText);
        if (!element) throw new Error(`No element with text "${elementText}" found for "${elementName}" in "${pageName}"`);
        await this.interact.dragAndDrop(element as WebElement, dragOptions);
    }

    /**
     * Sets the value of a range/slider input element.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param value - The numeric value to set on the slider.
     * @param options - Optional step options for element resolution.
     */
    async setSliderValue(elementName: string, pageName: string, value: number, options?: StepOptions): Promise<void> {
        log.interact('Setting slider "%s" in "%s" to value: %d', elementName, pageName, value);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.setSliderValue(element, value);
    }

    /**
     * Presses a keyboard key at the page level (not bound to a specific element).
     * @param key - The key to press (e.g. `'Escape'`, `'Enter'`, `'Tab'`, `'Control+A'`).
     */
    async pressKey(key: string): Promise<void> {
        log.interact('Pressing key: "%s"', key);
        await this.interact.pressKey(key);
    }

    /**
     * Presses a multi-key chord at the page level. Parts are joined with `+`, so
     * `['Control', 'A']` presses `Control+A`. The intent-revealing companion to
     * {@link pressKey} for shortcuts where listing the modifiers reads clearer.
     * @param keys - The keys to press together, e.g. `['Meta', 'K']` or `['Control', 'Shift', 'P']`.
     */
    async pressKeys(keys: string[]): Promise<void> {
        // Enforce the contract before logging so an empty chord never produces a
        // misleading `Pressing keys: ""` line ahead of the throw.
        if (keys.length === 0) {
            throw new Error('pressKeys(keys) requires at least one key');
        }
        log.interact('Pressing keys: "%s"', keys.join('+'));
        await this.interact.pressKeys(keys);
    }

    /**
     * Dispatches a synthetic DOM event on a named element, optionally with an
     * `eventInit` payload. Drives event handlers directly WITHOUT actionability
     * checks — reach for it only when a real interaction can't express the case
     * (custom events, firing `input`/`change` on a widget that swallows
     * synthetic typing). Prefer `click` / `fill` / `pressKey` for real user input.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param type - The DOM event type, e.g. `'click'`, `'input'`, `'focus'`.
     * @param eventInit - Optional event properties, e.g. `{ key: 'Enter', bubbles: true }`.
     * @param options - Optional step options for element resolution.
     */
    async dispatchEvent(
        elementName: string,
        pageName: string,
        type: string,
        eventInit?: Record<string, unknown>,
        options?: StepOptions,
    ): Promise<void> {
        log.interact('Dispatching "%s" event on "%s" in "%s"', type, elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.dispatchEvent(element, type, eventInit);
    }

    /**
     * Types text into an input field one character at a time with a delay between keystrokes.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param text - The text to type character by character.
     * @param delay - The delay in milliseconds between each keystroke. Defaults to `100`.
     * @param options - Optional step options for element resolution.
     */
    async typeSequentially(
        elementName: string,
        pageName: string,
        text: string,
        delay: number = 100,
        options?: StepOptions
    ): Promise<void> {
        log.interact('Typing "%s" sequentially into "%s" in "%s" (delay: %dms)', text, elementName, pageName, delay);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.typeSequentially(element, text, delay);
    }

    /**
     * Clears the value of an input or textarea element without filling it with new text.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async clearInput(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Clearing input "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.clearInput(element);
    }

    /**
     * Selects multiple options from a `<select multiple>` element by their `value` attributes.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param values - An array of `value` attribute strings to select simultaneously.
     * @param options - Optional step options for element resolution.
     * @returns An array of the actually selected `value` strings.
     */
    async selectMultiple(elementName: string, pageName: string, values: string[], options?: StepOptions): Promise<string[]> {
        log.interact('Selecting multiple values on "%s" in "%s": %O', elementName, pageName, values);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.interact.selectMultiple(element, values);
    }

    // ==========================================
    // DATA EXTRACTION STEPS
    // ==========================================

    /**
     * Retrieves the visible text content of an element.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     * @returns The text content of the element, or `null` if unavailable.
     */
    async getText(elementName: string, pageName: string, options?: StepOptions): Promise<string | null> {
        log.extract('Getting text from "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.extract.getText(element);
    }

    /**
     * Retrieves the value of a specific HTML attribute from an element.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param attributeName - The name of the attribute to retrieve.
     * @param options - Optional step options for element resolution.
     * @returns The attribute value, or `null` if the attribute does not exist.
     */
    async getAttribute(elementName: string, pageName: string, attributeName: string, options?: StepOptions): Promise<string | null> {
        log.extract('Getting attribute "%s" from "%s" in "%s"', attributeName, elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.extract.getAttribute(element, attributeName);
    }

    /**
     * Returns the number of DOM elements matching the locator.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     * @returns The count of matching elements.
     */
    async getCount(elementName: string, pageName: string, options?: StepOptions): Promise<number> {
        log.extract('Getting count of "%s" in "%s"', elementName, pageName);
        const element = await this.getAllWebElement(elementName, pageName, options);
        return await this.extract.getCount(element);
    }

    /**
     * Retrieves the current value of an input, textarea, or select element.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     * @returns The current value of the input.
     */
    async getInputValue(elementName: string, pageName: string, options?: StepOptions): Promise<string> {
        log.extract('Getting input value of "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.extract.getInputValue(element);
    }

    /**
     * Retrieves a computed CSS property value from an element.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param property - The CSS property name.
     * @param options - Optional step options for element resolution.
     * @returns The computed value as a string.
     */
    async getCssProperty(elementName: string, pageName: string, property: string, options?: StepOptions): Promise<string> {
        log.extract('Getting CSS "%s" from "%s" in "%s"', property, elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.extract.getCssProperty(element, property);
    }

    /**
     * Returns the element's bounding box (`{ x, y, width, height }` in CSS
     * pixels, relative to the main frame) or `null` when it is not rendered.
     * Use for geometry the DOM doesn't surface: overlap, off-screen placement,
     * collapsed (`0×0`) regions.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async getBoundingBox(
        elementName: string,
        pageName: string,
        options?: StepOptions,
    ): Promise<{ x: number; y: number; width: number; height: number } | null> {
        log.extract('Getting bounding box of "%s" in "%s"', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.extract.getBoundingBox(element);
    }

    /**
     * Retrieves the raw HTML of an element. Defaults to `innerHTML`; pass
     * `{ outer: true }` to get the element's `outerHTML` (the tag itself plus its subtree).
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - `outer` switches between innerHTML/outerHTML; other fields control strategy.
     */
    async getHtml(elementName: string, pageName: string, options?: StepOptions & { outer?: boolean }): Promise<string> {
        log.extract('Getting %s HTML of "%s" in "%s"', options?.outer ? 'outer' : 'inner', elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        return await this.extract.getHtml(element, { outer: options?.outer });
    }

    /**
     * Retrieves the HTML of the current page. Defaults to `document.body.innerHTML`;
     * pass `{ outer: true }` to get the full `<html>` document outerHTML (including `<head>`).
     *
     * Use this for page-level scans where no single element is the natural scope —
     * e.g. confirming an injected payload was HTML-escaped anywhere on the page.
     */
    async getPageHtml(options?: { outer?: boolean }): Promise<string> {
        log.extract('Getting page %s HTML', options?.outer ? 'outer' : 'inner');
        return await this.extract.getPageHtml(options);
    }

    /**
     * Reads a value from the browser's `window.localStorage`. Returns `null`
     * when the key is absent — same contract as the native `getItem`.
     *
     * Use for state the framework cannot reach through the DOM: persisted
     * theme preference, dismissed-banner flag, feature toggle, auth tokens, etc.
     *
     * @example
     * ```ts
     * await steps.click('themeToggle', 'NavBar');
     * expect(await steps.getLocalStorage('theme')).toBe('dark');
     * ```
     */
    async getLocalStorage(key: string): Promise<string | null> {
        log.extract('Getting localStorage[%s]', JSON.stringify(key));
        return await this.extract.getLocalStorage(key);
    }

    /**
     * Reads a value from the browser's `window.sessionStorage`. Returns `null`
     * when the key is absent — same contract as the native `getItem`.
     */
    async getSessionStorage(key: string): Promise<string | null> {
        log.extract('Getting sessionStorage[%s]', JSON.stringify(key));
        return await this.extract.getSessionStorage(key);
    }

    /**
     * Writes a value to the browser's `window.localStorage` — the mutating
     * companion to {@link getLocalStorage}. Use to seed persisted state a test
     * depends on, or to drive resilience checks with deliberately malformed
     * values (e.g. corrupt JSON the app must tolerate).
     *
     * @example
     * ```ts
     * await steps.setLocalStorage('wishlist', 'not-json-{[bogus');
     * await steps.refresh();
     * await steps.verifyPresence('wishlistEmptyState', 'WishlistPage');
     * ```
     */
    async setLocalStorage(key: string, value: string): Promise<void> {
        log.extract('Setting localStorage[%s]', JSON.stringify(key));
        await this.extract.setLocalStorage(key, value);
    }

    /**
     * Writes a value to the browser's `window.sessionStorage` — the mutating
     * companion to {@link getSessionStorage}.
     */
    async setSessionStorage(key: string, value: string): Promise<void> {
        log.extract('Setting sessionStorage[%s]', JSON.stringify(key));
        await this.extract.setSessionStorage(key, value);
    }

    /**
     * Removes a single key from `window.localStorage` (no-op when absent —
     * native `removeItem` contract). Use to clear one piece of persisted state
     * without disturbing the rest.
     */
    async removeLocalStorage(key: string): Promise<void> {
        log.extract('Removing localStorage[%s]', JSON.stringify(key));
        await this.extract.removeLocalStorage(key);
    }

    /**
     * Removes a single key from `window.sessionStorage` (no-op when absent —
     * native `removeItem` contract).
     */
    async removeSessionStorage(key: string): Promise<void> {
        log.extract('Removing sessionStorage[%s]', JSON.stringify(key));
        await this.extract.removeSessionStorage(key);
    }

    /**
     * Removes every key from `window.localStorage` (native `clear` contract).
     * Use to reset persisted state between phases of a test.
     */
    async clearLocalStorage(): Promise<void> {
        log.extract('Clearing localStorage');
        await this.extract.clearLocalStorage();
    }

    /**
     * Removes every key from `window.sessionStorage` (native `clear` contract).
     */
    async clearSessionStorage(): Promise<void> {
        log.extract('Clearing sessionStorage');
        await this.extract.clearSessionStorage();
    }

    /**
     * Extracts text content or attribute values from all elements matching the locator.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param getAllOptions - Optional extraction configuration.
     * @param options - Optional step options for element resolution.
     * @returns An array of extracted strings.
     */
    async getAll(elementName: string, pageName: string, getAllOptions?: GetAllOptions, options?: StepOptions): Promise<string[]> {
        log.extract('Extracting all from "%s" in "%s"', elementName, pageName);
        // `locateChild` widens the return type back to Element, so keep the
        // local as Element and narrow at the extract boundary.
        let element: Element = await this.getAllWebElement(elementName, pageName, options);

        if (getAllOptions?.child) {
            if (typeof getAllOptions.child === 'string') {
                element = element.locateChild(getAllOptions.child);
            } else {
                const childSelector = this.repo.getSelector(getAllOptions.child.elementName, getAllOptions.child.pageName);
                element = element.locateChild(childSelector);
            }
        }

        if (getAllOptions?.extractAttribute) {
            const elements = await element.all();
            const values = await Promise.all(elements.map(el => el.getAttribute(getAllOptions.extractAttribute!)));
            return values.filter((v): v is string => v !== null);
        }

        return await this.extract.getAllTexts(element as WebElement);
    }

    // ==========================================
    // VERIFICATION STEPS
    // ==========================================

    /**
     * Asserts that the element is present and visible in the DOM.
     *
     * Equivalent to the fluent form `steps.on(elementName, pageName).verifyPresence()` —
     * both share the same underlying implementation (the matcher tree). Use whichever
     * form is more readable in the call site.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async verifyPresence(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying presence of "%s" in "%s"', elementName, pageName);
        await this.actionWithStrategy(elementName, pageName, options).verifyPresence();
    }

    /**
     * Asserts that every element in the list is visible in the DOM, running all
     * checks concurrently. Equivalent to calling `verifyPresence` for each entry
     * inside a `Promise.all`, but with a single log line and no boilerplate.
     *
     * Use this when a test needs to assert the presence of many independent
     * elements on the same already-loaded page — the parallel resolution
     * removes the per-step serial overhead without changing the underlying
     * assertion semantics.
     *
     * @param targets - Array of `{ elementName, pageName, options? }` descriptors.
     * @example
     * await steps.verifyAllPresent([
     *   { elementName: 'productTitle', pageName: 'ProductDetailsPage' },
     *   { elementName: 'productPrice', pageName: 'ProductDetailsPage' },
     *   { elementName: 'addToCart',    pageName: 'ProductDetailsPage' },
     * ]);
     */
    async verifyAllPresent(targets: Array<{ elementName: string; pageName: string; options?: StepOptions }>): Promise<void> {
        log.verify('Verifying presence of %d elements in parallel', targets.length);
        await Promise.all(
            targets.map(({ elementName, pageName, options }) =>
                this.actionWithStrategy(elementName, pageName, options).verifyPresence(),
            ),
        );
    }

    /**
     * Checks whether an element is currently present and visible in the DOM.
     * Returns a boolean instead of throwing.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     * @returns `true` if the element is visible, `false` otherwise.
     */
    async isPresent(elementName: string, pageName: string, options?: StepOptions): Promise<boolean> {
        log.verify('Checking presence of "%s" in "%s"', elementName, pageName);
        try {
            const element = await this.getWebElement(elementName, pageName, options);
            return await element.isVisible();
        } catch {
            return false;
        }
    }

    /**
     * Unified visibility entry point. Returns a `VisibleChain` that is both:
     *
     * - **awaitable as `Promise<boolean>`** — the probe, never throws. Backwards
     *   compatible with the old `isVisible(): Promise<boolean>` signature —
     *   `await steps.isVisible('banner', 'Page', { timeout: 500 })` still
     *   resolves to a boolean at runtime.
     * - **chainable with action methods and the matcher tree** — the gate,
     *   silently skips when the element is hidden. Replaces `steps.on(...).ifVisible()`.
     *
     * Every probe and gate decision is logged under `tester:visible` with a
     * `[probe]` or `[gate]` tag so silently-skipped actions stay debuggable.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - `{ timeout?: 2000, containsText?: string }`.
     *
     * @example
     * ```ts
     * // Probe — returns boolean
     * const ok = await steps.isVisible('banner', 'Page', { timeout: 500 });
     *
     * // Gate — skips when hidden
     * await steps.isVisible('cookieBanner', 'Page').click();
     *
     * // Gate + containsText
     * await steps.isVisible('promo', 'Page', { containsText: '50% off' }).click();
     *
     * // Matcher tree — silently skipped when hidden
     * await steps.isVisible('banner', 'Page').text.toBe('Hello');
     * ```
     */
    isVisible(elementName: string, pageName: string, options?: IsVisibleOptions) {
        const timeout = options?.timeout ?? 2000;
        log.verify('Probing visibility of "%s" in "%s" (timeout: %dms)', elementName, pageName, timeout);
        return this.on(elementName, pageName).isVisible(options);
    }

    /**
     * Asserts that the element is not present in the DOM.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options (strategy not applicable for absence checks).
     */
    async verifyAbsence(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying absence of "%s" in "%s"', elementName, pageName);
        await this.actionWithStrategy(elementName, pageName, options).verifyAbsence();
    }

    /**
     * Asserts that an element's text content matches the expected value.
     *
     * Call with no `expectedText` to assert the element has any non-empty text:
     * `await steps.verifyText('status', 'Page');`
     *
     * Equivalent to the fluent form `steps.on(elementName, pageName).verifyText(expectedText)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param expectedText - The exact text to match against. Omit to assert "not empty".
     * @param verifyOptions - Optional verification options. Passing `{ notEmpty: true }`
     *   is redundant — omit `expectedText` to get the same behavior. The `notEmpty`
     *   flag on `TextVerifyOptions` is itself deprecated.
     * @param options - Optional step options for element resolution.
     */
    async verifyText(elementName: string, pageName: string, expectedText?: string, verifyOptions?: TextVerifyOptions, options?: StepOptions): Promise<void> {
        if (verifyOptions?.notEmpty !== undefined) {
            log.verify('[DEPRECATED] verifyText: the `notEmpty` option is redundant — call verifyText("%s", "%s") with no expectedText to assert "not empty".', elementName, pageName);
        }
        log.verify('Verifying text of "%s" in "%s"%s', elementName, pageName, expectedText === undefined ? ' is not empty' : ` matches: "${expectedText}"`);
        await this.actionWithStrategy(elementName, pageName, options).verifyText(expectedText, verifyOptions);
    }

    /**
     * Asserts the number of elements matching the locator satisfies the given condition.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyCount(countOptions)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param countOptions - Count condition.
     * @param options - Optional step options for element resolution.
     */
    async verifyCount(elementName: string, pageName: string, countOptions: CountVerifyOptions, options?: StepOptions): Promise<void> {
        log.verify('Verifying count for "%s" in "%s" with options: %O', elementName, pageName, countOptions);
        await this.actionWithStrategy(elementName, pageName, options).verifyCount(countOptions);
    }

    /**
     * Asserts that all image elements matching the locator have loaded successfully.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyImages(scroll, options)`.
     *
     * By default checks visibility, `src` attribute, and non-zero `naturalWidth`.
     * Pass `{ verifyDecoded: true }` to also run `Image.decode()` per image —
     * this adds a CDP round-trip per image and is most useful for thoroughness testing
     * rather than smoke checks.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param scroll - Whether to scroll each image into view before checking. Defaults to `true`.
     * @param options - Step options for element resolution, plus `verifyDecoded` to run `Image.decode()` per image.
     */
    async verifyImages(elementName: string, pageName: string, scroll: boolean = true, options?: StepOptions & { verifyDecoded?: boolean }): Promise<void> {
        log.verify('Verifying images for "%s" in "%s" (scroll: %s)', elementName, pageName, scroll);
        const { verifyDecoded, ...stepOptions } = options ?? {};
        await this.actionWithStrategy(elementName, pageName, stepOptions).verifyImages(scroll, { verifyDecoded });
    }

    /**
     * Asserts that an element's text content contains the specified substring.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyTextContains(expectedText)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param expectedText - The substring expected to be found within the element's text.
     * @param options - Optional step options for element resolution.
     */
    async verifyTextContains(elementName: string, pageName: string, expectedText: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying "%s" in "%s" contains text: "%s"', elementName, pageName, expectedText);
        await this.actionWithStrategy(elementName, pageName, options).verifyTextContains(expectedText);
    }

    /**
     * Asserts that an element is in the specified state.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyState(state)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param state - The expected state.
     * @param timeout - Optional timeout in milliseconds. When omitted, the fixture default is used.
     */
    async verifyState(
        elementName: string,
        pageName: string,
        state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport',
        timeout?: number
    ): Promise<void> {
        log.verify('Verifying "%s" in "%s" is %s', elementName, pageName, state);
        const action = this.on(elementName, pageName);
        if (timeout !== undefined) action.timeout(timeout);
        await action.verifyState(state);
    }

    /**
     * Asserts that an element has a specific HTML attribute with the expected value.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyAttribute(attributeName, expectedValue)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param attributeName - The name of the HTML attribute to check.
     * @param expectedValue - The expected value of the attribute.
     * @param options - Optional step options for element resolution.
     */
    async verifyAttribute(elementName: string, pageName: string, attributeName: string, expectedValue: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying "%s" in "%s" has attribute "%s" = "%s"', elementName, pageName, attributeName, expectedValue);
        await this.actionWithStrategy(elementName, pageName, options).verifyAttribute(attributeName, expectedValue);
    }

    /**
     * Asserts that an element's HTML equals the expected string exactly.
     * Defaults to `innerHTML`; pass `{ outer: true }` for `outerHTML`.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyHtml(expected, htmlOptions)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param expected - The expected HTML string.
     * @param htmlOptions - `outer` switches between innerHTML/outerHTML.
     * @param options - Optional step options for element resolution.
     */
    async verifyHtml(elementName: string, pageName: string, expected: string, htmlOptions?: { outer?: boolean }, options?: StepOptions): Promise<void> {
        log.verify('Verifying %s HTML of "%s" in "%s" matches exactly', htmlOptions?.outer ? 'outer' : 'inner', elementName, pageName);
        await this.actionWithStrategy(elementName, pageName, options).verifyHtml(expected, htmlOptions);
    }

    /**
     * Asserts that an element's HTML contains the specified substring.
     * Defaults to `innerHTML`; pass `{ outer: true }` for `outerHTML`.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyHtmlContains(substring, htmlOptions)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param substring - The substring expected to appear in the element's HTML.
     * @param htmlOptions - `outer` switches between innerHTML/outerHTML.
     * @param options - Optional step options for element resolution.
     */
    async verifyHtmlContains(elementName: string, pageName: string, substring: string, htmlOptions?: { outer?: boolean }, options?: StepOptions): Promise<void> {
        log.verify('Verifying %s HTML of "%s" in "%s" contains: "%s"', htmlOptions?.outer ? 'outer' : 'inner', elementName, pageName, substring);
        await this.actionWithStrategy(elementName, pageName, options).verifyHtmlContains(substring, htmlOptions);
    }

    /**
     * Asserts that an element's HTML matches a regular expression.
     * Defaults to `innerHTML`; pass `{ outer: true }` for `outerHTML`.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyHtmlMatches(regex, htmlOptions)`.
     */
    async verifyHtmlMatches(elementName: string, pageName: string, regex: RegExp, htmlOptions?: { outer?: boolean }, options?: StepOptions): Promise<void> {
        log.verify('Verifying %s HTML of "%s" in "%s" matches regex %s', htmlOptions?.outer ? 'outer' : 'inner', elementName, pageName, regex);
        await this.actionWithStrategy(elementName, pageName, options).verifyHtmlMatches(regex, htmlOptions);
    }

    /**
     * Asserts that the page-level HTML equals the expected string exactly.
     * Defaults to `document.body.innerHTML`; pass `{ outer: true }` for the full
     * `<html>` document outerHTML.
     *
     * @param expected - The expected HTML string.
     * @param options - `outer` switches between body.innerHTML / documentElement.outerHTML;
     *   `negated` flips the assertion; `timeout` overrides the default; `errorMessage` adds a header.
     */
    async verifyPageHtml(expected: string, options?: { outer?: boolean; negated?: boolean; timeout?: number; errorMessage?: string }): Promise<void> {
        log.verify('Verifying page %s HTML matches exactly', options?.outer ? 'outer' : 'inner');
        await this.verify.pageHtml(expected, options);
    }

    /**
     * Asserts that the page-level HTML contains the specified substring.
     * Defaults to `document.body.innerHTML`; pass `{ outer: true }` for the full document outerHTML.
     *
     * Use this to confirm an injected payload appears unescaped (`negated: false`)
     * or was correctly escaped (`negated: true`) anywhere on the rendered page.
     *
     * @example
     * ```ts
     * // XSS probe — payload must NOT appear raw in rendered HTML
     * await steps.verifyPageHtmlContains('<img src=x onerror=alert(1)>', { negated: true });
     * ```
     */
    async verifyPageHtmlContains(substring: string, options?: { outer?: boolean; negated?: boolean; timeout?: number; errorMessage?: string }): Promise<void> {
        log.verify('Verifying page %s HTML contains: "%s"', options?.outer ? 'outer' : 'inner', substring);
        await this.verify.pageHtmlContains(substring, options);
    }

    /**
     * Asserts that the page-level HTML matches a regular expression.
     * Defaults to `document.body.innerHTML`; pass `{ outer: true }` for the full document outerHTML.
     */
    async verifyPageHtmlMatches(regex: RegExp, options?: { outer?: boolean; negated?: boolean; timeout?: number; errorMessage?: string }): Promise<void> {
        log.verify('Verifying page %s HTML matches regex %s', options?.outer ? 'outer' : 'inner', regex);
        await this.verify.pageHtmlMatches(regex, options);
    }

    /**
     * Asserts a property of `localStorage[key]`. Pick one matcher: `equals`
     * (exact match), `contains` (substring), `matches` (regex), or `present`
     * (existence). The chosen matcher is enforced at the type level by the
     * `StorageVerifyOptions` discriminated union — passing two is a type error.
     *
     * Polls until the predicate holds or the timeout expires, so this survives
     * the race between a UI action firing and its persistence side-effect.
     *
     * @example
     * ```ts
     * await steps.verifyLocalStorage('theme', { equals: 'dark' });
     * await steps.verifyLocalStorage('flag', { contains: 'enabled' });
     * await steps.verifyLocalStorage('build', { matches: /^v\d+$/ });
     * await steps.verifyLocalStorage('seen', { present: true });
     * await steps.verifyLocalStorage('seen', { present: false });          // absence
     * await steps.verifyLocalStorage('seen', { present: true, negated: true });  // same
     * ```
     */
    async verifyLocalStorage(key: string, options: StorageVerifyOptions): Promise<void> {
        await this.verifyStorage('local', key, options);
    }

    /** See `verifyLocalStorage` — same matcher shape, against `window.sessionStorage`. */
    async verifySessionStorage(key: string, options: StorageVerifyOptions): Promise<void> {
        await this.verifyStorage('session', key, options);
    }

    /** Single dispatcher for `verifyLocalStorage` / `verifySessionStorage`. */
    private async verifyStorage(type: 'local' | 'session', key: string, options: StorageVerifyOptions): Promise<void> {
        const label = type === 'local' ? 'localStorage' : 'sessionStorage';
        const modifiers = { negated: options.negated, timeout: options.timeout, errorMessage: options.errorMessage };
        if ('equals' in options && options.equals !== undefined) {
            log.verify('Verifying %s[%s] is %s', label, JSON.stringify(key), JSON.stringify(options.equals));
            await (type === 'local' ? this.verify.localStorage(key, options.equals, modifiers) : this.verify.sessionStorage(key, options.equals, modifiers));
            return;
        }
        if ('contains' in options && options.contains !== undefined) {
            log.verify('Verifying %s[%s] contains %s', label, JSON.stringify(key), JSON.stringify(options.contains));
            await (type === 'local' ? this.verify.localStorageContains(key, options.contains, modifiers) : this.verify.sessionStorageContains(key, options.contains, modifiers));
            return;
        }
        if ('matches' in options && options.matches !== undefined) {
            log.verify('Verifying %s[%s] matches %s', label, JSON.stringify(key), options.matches);
            await (type === 'local' ? this.verify.localStorageMatches(key, options.matches, modifiers) : this.verify.sessionStorageMatches(key, options.matches, modifiers));
            return;
        }
        // 'present' branch. The underlying `localStoragePresent` assertion only
        // knows "is present" — we flip it (`negated: true`) to assert absence.
        // `present: false` is an absence check; an explicit `negated: true`
        // flips again. Two flips cancel: underlyingNegated holds when wantPresent
        // and userNegated are both true OR both false (i.e. they agree).
        const wantPresent = options.present !== false;
        const userNegated = modifiers.negated ?? false;
        const negated = wantPresent === userNegated;
        log.verify('Verifying %s[%s] is %spresent', label, JSON.stringify(key), negated ? 'not ' : '');
        const presentOptions = { ...modifiers, negated };
        if (type === 'local') {
            await this.verify.localStoragePresent(key, presentOptions);
        } else {
            await this.verify.sessionStoragePresent(key, presentOptions);
        }
    }

    /**
     * Asserts that the current page URL contains the specified substring.
     * @param text - The substring expected to be found in the current URL.
     */
    async verifyUrlContains(text: string): Promise<void> {
        log.verify('Verifying current URL contains: "%s"', text);
        await this.verify.urlContains(text);
    }

    /**
     * Asserts that an input, textarea, or select element has the expected value.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyInputValue(expectedValue)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param expectedValue - The expected value of the input.
     * @param options - Optional step options for element resolution.
     */
    async verifyInputValue(elementName: string, pageName: string, expectedValue: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying input value of "%s" in "%s" matches: "%s"', elementName, pageName, expectedValue);
        await this.actionWithStrategy(elementName, pageName, options).verifyInputValue(expectedValue);
    }

    /**
     * Asserts the number of open browser tabs/pages matches the expected count.
     * @param expectedCount - The expected number of open tabs.
     */
    async verifyTabCount(expectedCount: number): Promise<void> {
        log.verify('Verifying tab count is %d', expectedCount);
        await this.verify.tabCount(expectedCount);
    }

    /**
     * Entry point for the matcher tree. Resolves the named element and returns
     * an `ExpectBuilder` that exposes field-scoped matchers (`.text`, `.value`,
     * `.attributes`, `.count`, `.visible`, `.enabled`, `.css(prop)`, `.not`)
     * plus the predicate escape hatch `.satisfy(predicate)` for assertions the
     * matcher tree doesn't cover.
     *
     * @example
     * // Matcher tree
     * await steps.expect('price', 'ProductPage').text.toBe('$19.99');
     * await steps.expect('items', 'ListPage').count.toBeGreaterThan(3);
     * await steps.expect('link', 'Page').attributes.get('href').toBe('/x');
     * await steps.expect('error', 'Page').not.text.toContain('crash');
     *
     * // Predicate chain — assertion executes when awaited
     * await steps.expect('price', 'ProductPage')
     *   .satisfy(el => parseFloat(el.text.slice(1)) > 10)
     *   .throws('price must be above $10');
     */
    expect(elementName: string, pageName: string): ExpectBuilder {
        const interactions = new ElementInteractions(this.page, { timeout: this.timeout, interceptionRetry: this.interceptionRetry });
        const action = new ElementAction(this.repo, elementName, pageName, interactions, this.timeout);
        log.verify('Building matcher tree for "%s" in "%s"', elementName, pageName);
        return new ExpectBuilder(action.buildExpectContext());
    }

    /**
     * Asserts that the text contents of all elements matching the locator appear
     * in the exact order specified.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyOrder(expectedTexts)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param expectedTexts - The expected text values in their expected order.
     * @param options - Optional step options for element resolution.
     */
    async verifyOrder(elementName: string, pageName: string, expectedTexts: string[], options?: StepOptions): Promise<void> {
        log.verify('Verifying order of "%s" in "%s": %O', elementName, pageName, expectedTexts);
        await this.actionWithStrategy(elementName, pageName, options).verifyOrder(expectedTexts);
    }

    /**
     * Asserts that a computed CSS property of an element matches the expected value.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyCssProperty(property, expectedValue)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param property - The CSS property name.
     * @param expectedValue - The expected computed value.
     * @param options - Optional step options for element resolution.
     */
    async verifyCssProperty(elementName: string, pageName: string, property: string, expectedValue: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying CSS "%s" of "%s" in "%s" = "%s"', property, elementName, pageName, expectedValue);
        await this.actionWithStrategy(elementName, pageName, options).verifyCssProperty(property, expectedValue);
    }

    /**
     * Asserts that the text contents of all elements matching the locator are sorted
     * in the specified direction.
     *
     * Equivalent to `steps.on(elementName, pageName).verifyListOrder(direction)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param direction - `'asc'` for ascending or `'desc'` for descending.
     * @param options - Optional step options for element resolution.
     */
    async verifyListOrder(elementName: string, pageName: string, direction: 'asc' | 'desc', options?: StepOptions): Promise<void> {
        log.verify('Verifying "%s" in "%s" is sorted %s', elementName, pageName, direction);
        await this.actionWithStrategy(elementName, pageName, options).verifyListOrder(direction);
    }

    // ==========================================
    // LISTED ELEMENT STEPS
    // ==========================================

    /**
     * Clicks a specific element within a list identified by its visible text or an HTML attribute.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Match criteria.
     */
    async clickListedElement(elementName: string, pageName: string, options: ListedElementMatch): Promise<void> {
        log.interact('Clicking listed element in "%s" > "%s" with options: %O', pageName, elementName, options);
        const baseElement = await this.getAllWebElement(elementName, pageName);
        const target = await this.interact.getListedElement(baseElement, options, this.repo);
        await this.interact.click(target, { subject: `${pageName}.${elementName}` });
    }

    /**
     * Verifies a specific element within a list.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Match and assertion criteria.
     */
    async verifyListedElement(elementName: string, pageName: string, options: VerifyListedOptions): Promise<void> {
        log.verify('Verifying listed element in "%s" > "%s" with options: %O', pageName, elementName, options);
        const baseElement = await this.getAllWebElement(elementName, pageName);
        const target = await this.interact.getListedElement(baseElement, options, this.repo);

        if (options.expectedText !== undefined) {
            await this.verify.text(target, options.expectedText);
            return;
        }

        if (options.expected) {
            const { name, value } = options.expected;
            if (typeof value === 'string') {
                await this.verify.attribute(target, name, value);
            } else {
                await this.verify.attributeMatches(target, name, new RegExp(value.regex, value.flags));
            }
            return;
        }

        await this.verify.presence(target);
    }

    /**
     * Extracts data from a specific element within a list.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Match and extraction criteria.
     * @returns The extracted text content or attribute value, or `null`.
     */
    async getListedElementData(elementName: string, pageName: string, options: GetListedDataOptions): Promise<string | null> {
        log.extract('Extracting data from listed element in "%s" > "%s" with options: %O', pageName, elementName, options);
        const baseElement = await this.getAllWebElement(elementName, pageName);
        const target = await this.interact.getListedElement(baseElement, options, this.repo);

        if (options.extractAttribute) {
            return await this.extract.getAttribute(target, options.extractAttribute);
        }

        return await this.extract.getText(target);
    }

    // ==========================================
    // WAIT STEPS
    // ==========================================

    /**
     * Waits for an element to reach the specified state before proceeding.
     * Throws on timeout as of 0.3.7; pass `{ optional: true }` to probe
     * without failing (resolves `false` instead).
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param state - The desired state to wait for.
     * @param options - Optional step options: element resolution, `timeout` (per-call override), `optional` (soft probe).
     * @returns `true` when the state was reached; `false` only when `optional` and the wait timed out.
     */
    async waitForState(
        elementName: string,
        pageName: string,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible',
        options?: StepOptions
    ): Promise<boolean> {
        log.wait('Waiting for "%s" in "%s" to be "%s"', elementName, pageName, state);
        const element = await this.getWebElement(elementName, pageName, options);
        const timeout = options?.timeout ?? this.timeout;
        try {
            await element.waitFor({ state, timeout });
            return true;
        } catch (error) {
            if (options?.optional) {
                log.wait("Element '%s.%s' did not reach state '%s' within %dms (optional wait — continuing)", pageName, elementName, state, timeout);
                return false;
            }
            const causeMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`waitForState: '${pageName}.${elementName}' did not reach state '${state}' within ${timeout}ms. ${causeMsg}`);
        }
    }

    /**
     * Waits for an element to reach a specific state, then clicks it.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param state - The state to wait for before clicking. Defaults to `'visible'`.
     * @param options - Optional step options for element resolution.
     */
    async waitAndClick(
        elementName: string,
        pageName: string,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible',
        options?: StepOptions
    ): Promise<void> {
        log.interact('Waiting for "%s" in "%s" to be "%s", then clicking', elementName, pageName, state);
        const element = await this.getWebElement(elementName, pageName, options);
        // Deliberately NOT forwarding `options.optional`: a wait-then-click on a
        // missing element must throw — soft-skipping the wait would just defer
        // the failure to the click with a less precise error.
        await this.utils.waitForState(element, state, options?.timeout);
        await this.interact.click(element, { subject: `${pageName}.${elementName}` });
    }

    /**
     * Clicks the element at a specific zero-based index from all elements matching the locator.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param index - The zero-based index of the element to click.
     * @throws Error if no element exists at the specified index.
     */
    async clickNth(elementName: string, pageName: string, index: number): Promise<void> {
        log.interact('Clicking element at index %d of "%s" in "%s"', index, elementName, pageName);
        const element = await this.repo.getByIndex(elementName, pageName, index);
        if (!element) throw new Error(`No element at index ${index} for "${elementName}" in "${pageName}"`);
        await this.interact.click(element as WebElement, { subject: `${pageName}.${elementName}` });
    }

    // ==========================================
    // COMPOSITE / WORKFLOW STEPS
    // ==========================================

    /**
     * Fills multiple form fields on the same page in a single call.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param fields - A map of `elementName` to value.
     */
    async fillForm(pageName: string, fields: Record<string, FillFormValue>): Promise<void> {
        log.interact('Filling form on "%s" with %d fields', pageName, Object.keys(fields).length);
        for (const [elementName, value] of Object.entries(fields)) {
            if (typeof value === 'string') {
                await this.fill(elementName, pageName, value);
            } else {
                await this.selectDropdown(elementName, pageName, value);
            }
        }
    }

    /**
     * Waits until there are no in-flight network requests for at least 500ms.
     * @param options - Optional `{ timeout, optional }`. `timeout` bounds the
     *   wait; `optional: true` resolves quietly on timeout instead of throwing
     *   (best-effort settling). With no options, behaviour is unchanged.
     */
    async waitForNetworkIdle(options?: WaitForNetworkIdleOptions): Promise<void> {
        log.wait('Waiting for network idle');
        await this.navigate.waitForNetworkIdle(options);
    }

    /**
     * Deliberate pause for `ms` milliseconds. Named `pace` — NOT `wait` — to
     * signal intentional timing control (settling a debounce, spacing
     * rapid-fire actions), never a substitute for a wait-for-state. Whenever you
     * are actually waiting for the app to reach a condition, prefer
     * {@link waitForState}, {@link waitForUrl}, or a web-first assertion.
     * @param ms - Pause duration in milliseconds (non-negative).
     */
    async pace(ms: number): Promise<void> {
        log.wait('Pacing for %dms', ms);
        await this.utils.pace(ms);
    }

    /**
     * Runs `action` `times` times in sequence, passing the zero-based index, and
     * returns each result in order. With `intervalMs`, paces BETWEEN iterations
     * (never before the first or after the last). The intent-revealing form of a
     * hand-rolled "do X rapidly N times" loop — repeated swatch clicks,
     * double-submit probes, hammering a flaky toggle.
     *
     * @example
     * ```ts
     * await steps.repeat(i => steps.on('swatch', 'PDP').nth(i).click(), 3, { intervalMs: 120 });
     * ```
     * @param action - Callback run per iteration; receives the zero-based index.
     * @param times - Number of iterations (non-negative integer).
     * @param options - Optional `{ intervalMs }` pacing between iterations.
     * @returns The array of every iteration's resolved result, in order.
     */
    async repeat<T>(
        action: (index: number) => Promise<T> | T,
        times: number,
        options?: { intervalMs?: number },
    ): Promise<T[]> {
        log.wait('Repeating action %d time(s)%s', times, options?.intervalMs ? ` (every ${options.intervalMs}ms)` : '');
        return await this.utils.repeat(action, times, options);
    }

    /**
     * Executes an action and waits for a matching network response to complete.
     * @param urlPattern - A string substring or RegExp to match against the response URL.
     * @param action - An async function that triggers the network request.
     * @returns The captured Playwright Response object.
     */
    async waitForResponse(urlPattern: string | RegExp, action: () => Promise<void>): Promise<Response> {
        log.wait('Waiting for response matching "%s"', urlPattern);
        return await this.navigate.waitForResponse(urlPattern, action);
    }

    /**
     * Asserts that **no** network request matching `urlPattern` fires while
     * `action` runs (and for an observation window afterwards). Negative
     * companion to {@link waitForResponse}.
     *
     * Use to prove a client-side block — HTML5 `required`, native `type=email`
     * validation, custom JS guards — short-circuits before any XHR is issued.
     * URL-unchanged and cookie-unset surrogates prove the outcome; this
     * asserts the mechanism.
     *
     * Matching delegates to Playwright's own URL matcher (via `page.route`),
     * so strings are interpreted as **glob patterns** — same as
     * {@link waitForResponse}, not naive substrings. Reach for a RegExp when
     * you want a contains-style match.
     *
     * If `action` throws, the route handler is removed and the action's error
     * is propagated; the observation window is skipped and any matches
     * captured before the throw are discarded.
     *
     * **Secret-leak surface**: on failure, the offender URL is embedded
     * verbatim in the thrown error — which flows into runner output, reporter
     * artifacts, and Playwright traces (often uploaded as CI artifacts). If
     * your URLs carry secrets in query parameters, pass `{ redactQuery: true }`.
     *
     * @param urlPattern - Playwright glob string or RegExp matched against the request URL.
     * @param action - The action whose absence-of-request is being asserted.
     * @param options - `timeout` is the observation window after `action`
     *   resolves (default 1000ms). `methods` restricts to specific HTTP
     *   methods (e.g. `['POST']`) so a permitted GET preflight doesn't trip
     *   the assertion. `redactQuery` scrubs query strings from the failure
     *   message when offender URLs may carry secrets.
     *
     * @example
     * ```ts
     * // HTML5 required blocks submission — no XHR fires.
     * await steps.expectNoRequest(/\/api\/auth\/signup/, async () => {
     *   await steps.click('submitButton', 'SignupPage');
     * });
     *
     * // Restrict to POST so a permitted GET preflight doesn't trip.
     * await steps.expectNoRequest('**\/api/users', async () => {
     *   await steps.click('saveButton', 'ProfilePage');
     * }, { methods: ['POST'], timeout: 500 });
     *
     * // Scrub query strings from the failure message when URLs may
     * // carry tokens or API keys.
     * await steps.expectNoRequest('**\/api/signed', async () => {
     *   await steps.click('downloadButton', 'ReportsPage');
     * }, { redactQuery: true });
     * ```
     */
    async expectNoRequest(
        urlPattern: string | RegExp,
        action: () => Promise<void>,
        options?: ExpectNoRequestOptions,
    ): Promise<void> {
        log.verify('Expecting no request matching "%s" during action (window %dms)', urlPattern, options?.timeout ?? 1000);
        await this.navigate.expectNoRequest(urlPattern, action, options);
    }

    /**
     * Retries an action until a verification passes, or until the maximum number of
     * attempts is reached.
     * @param action - An async function performing the interaction.
     * @param verification - An async function performing the assertion. Must throw on failure.
     * @param maxRetries - Maximum number of retry attempts. Defaults to `3`.
     * @param delayMs - Milliseconds to wait between retry attempts. Defaults to `1000`.
     */
    async retryUntil(
        action: () => Promise<void>,
        verification: () => Promise<void>,
        maxRetries: number = 3,
        delayMs: number = 1000
    ): Promise<void> {
        log.interact('Retrying action up to %d times (delay: %dms)', maxRetries, delayMs);
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            await action();
            try {
                await verification();
                return;
            } catch (e) {
                lastError = e as Error;
                if (attempt < maxRetries) {
                    await this.page.waitForTimeout(delayMs);
                }
            }
        }

        throw lastError;
    }

    // ==========================================
    // SCREENSHOT
    // ==========================================

    /**
     * Captures a screenshot of the full page or a specific element.
     * @param elementNameOrOptions - Either an element name string or `ScreenshotOptions`.
     * @param pageName - The page name (required when first arg is an element name).
     * @param options - Optional screenshot configuration.
     * @returns The screenshot image as a Buffer.
     */
    async screenshot(elementNameOrOptions?: string | ScreenshotOptions, pageName?: string, options?: ScreenshotOptions): Promise<Buffer> {
        if (typeof elementNameOrOptions === 'string' && pageName) {
            log.extract('Taking screenshot of "%s" in "%s"', elementNameOrOptions, pageName);
            const element = await this.getWebElement(elementNameOrOptions, pageName);
            return await this.extract.screenshot(element, options);
        }

        const opts = typeof elementNameOrOptions === 'object' ? elementNameOrOptions : options;
        log.extract('Taking page screenshot');
        return await this.extract.screenshot(undefined, opts);
    }

    // ==========================================
    // VISUAL REGRESSION
    // ==========================================

    /**
     * Asserts the current page (or a named element) matches its stored
     * baseline screenshot. Dynamic regions — clocks, generated ids, live
     * counters, "updated N minutes ago" badges, avatars — can be masked
     * by name so the pixel diff stays stable across runs.
     *
     * Two call shapes:
     *
     *   // page-level
     *   await steps.verifyVisualMatch('dashboard.png', {
     *     mask: [
     *       { elementName: 'currentTime',   pageName: 'dashboard' },
     *       { elementName: 'transactionId', pageName: 'dashboard' },
     *     ],
     *   });
     *
     *   // element-level (scope = the named element)
     *   await steps.verifyVisualMatch('header.png', {
     *     elementName: 'header',
     *     pageName:    'dashboard',
     *     mask: [{ elementName: 'liveCounter', pageName: 'dashboard' }],
     *   });
     *
     * Mask entries may also use a raw selector when the masked region
     * isn't worth a ElementRepository entry:
     *
     *   mask: [{ selector: '[data-testid="current-time"]' }]
     *
     * Behaviour notes (inherited from Playwright's `toHaveScreenshot`):
     *   • CSS animations are disabled during the snapshot — no need to
     *     freeze them manually.
     *   • The first run writes the baseline; subsequent runs diff.
     *   • Masked regions are painted with a solid colour (pink by
     *     default) BEFORE the pixel diff, so dynamic content there
     *     doesn't fail the comparison.
     *
     * @param snapshotName  — baseline file name (e.g. `dashboard.png`).
     *                        Playwright derives OS/browser sub-paths.
     * @param options       — see {@link VisualMatchOptions}; the
     *                        `elementName`/`pageName` pair below is the
     *                        step-level extension over the lower-level
     *                        Verifications shape (which only knows
     *                        page vs element via its argument).
     */
    async verifyVisualMatch(
        snapshotName: string,
        options?: VisualMatchOptions & { elementName?: string; pageName?: string },
    ): Promise<void> {
        // 1. Pick the assertion target — element vs page.
        const target =
            options?.elementName && options?.pageName
                ? await this.getWebElement(options.elementName, options.pageName)
                : this.page;

        // 2. Resolve mask targets to Playwright Locators via the
        //    ElementRepository fixture (for elementName entries) or
        //    page.locator (for selector entries).
        const maskLocators = options?.mask
            ? await this.resolveVisualMaskLocators(options.mask)
            : [];

        // 3. Hand off to the assertion layer.
        if (options?.elementName && options?.pageName) {
            log.verify('Visual-match "%s" of "%s" in "%s" (mask=%d)',
                snapshotName, options.elementName, options.pageName, maskLocators.length);
        } else {
            log.verify('Visual-match "%s" of full page (mask=%d)', snapshotName, maskLocators.length);
        }

        await this.verify.visuallyMatches(target, snapshotName, {
            mask: maskLocators,
            maskColor: options?.maskColor,
            fullPage: options?.fullPage,
            maxDiffPixelRatio: options?.maxDiffPixelRatio,
            maxDiffPixels: options?.maxDiffPixels,
            timeout: options?.timeout,
            errorMessage: options?.errorMessage,
        });
    }

    /**
     * Resolve {@link VisualMaskTarget} entries to Playwright Locators.
     * `{ elementName, pageName }` entries are looked up through the
     * ElementRepository (the canonical, page-aware path); `{ selector }`
     * entries are passed straight to `page.locator`.
     */
    private async resolveVisualMaskLocators(mask: VisualMaskTarget[]): Promise<Locator[]> {
        const locators: Locator[] = [];
        for (const m of mask) {
            if ('selector' in m) {
                locators.push(this.page.locator(m.selector));
                continue;
            }
            const el = await this.getWebElement(m.elementName, m.pageName);
            locators.push(el.locator);
        }
        return locators;
    }

    // ==========================================
    // EMAIL STEPS
    // ==========================================

    /**
     * Sends an email using the configured SMTP credentials.
     * @param options - The email configuration.
     */
    async sendEmail(options: EmailSendOptions): Promise<void> {
        if (!this.email) {
            throw new Error('Email client is not configured. Pass emailCredentials to baseFixture() options when setting up your test fixture.');
        }

        log.email('Sending email to "%s" with subject "%s"', options.to, options.subject);
        await this.email.send(options);
    }

    /**
     * Polls the inbox and returns the latest email matching the provided filters.
     * @param options - The receive options, including mandatory filters.
     * @returns The matched email.
     */
    async receiveEmail(options: EmailReceiveOptions): Promise<ReceivedEmail> {
        if (!this.email) {
            throw new Error('Email client is not configured. Pass emailCredentials to baseFixture() options when setting up your test fixture.');
        }

        log.email('Receiving email with %d filter(s)', options.filters.length);
        return await this.email.receive(options);
    }

    /**
     * Polls the inbox and returns all emails matching the provided filters.
     * @param options - The receive options, including mandatory filters.
     * @returns An array of matched emails.
     */
    async receiveAllEmails(options: EmailReceiveOptions): Promise<ReceivedEmail[]> {
        if (!this.email) {
            throw new Error('Email client is not configured. Pass emailCredentials to baseFixture() options when setting up your test fixture.');
        }

        log.email('Receiving all matching emails with %d filter(s)', options.filters.length);
        return await this.email.receiveAll(options);
    }

    /**
     * Deletes emails from the inbox.
     * @param options - Optional receive options containing filters to target specific emails.
     */
    async cleanEmails(options?: EmailReceiveOptions): Promise<number> {
        if (!this.email) {
            throw new Error('Email client is not configured. Pass emailCredentials to baseFixture() options when setting up your test fixture.');
        }

        const filterCount = options?.filters?.length ?? 0;
        if (filterCount > 0) {
            log.email('Cleaning specific emails matching %d filter(s)', filterCount);
        } else {
            log.email('Cleaning ALL emails from the inbox');
        }
        return await this.email.clean(options);
    }

    /**
     * Marks emails in the mailbox with a specific action.
     * @param action - The marking action to apply.
     * @param options - Optional options to target specific emails with filters.
     * @returns The number of emails successfully marked.
     */
    async markEmail(
        action: EmailMarkAction | string[],
        options?: { filters?: EmailFilter[]; folder?: string; archiveFolder?: string }
    ): Promise<number> {
        if (!this.email) {
            throw new Error('Email client is not configured. Pass emailCredentials to baseFixture() options when setting up your test fixture.');
        }

        const markOptions: EmailMarkOptions = {
            action,
            filters: options?.filters,
            folder: options?.folder,
            archiveFolder: options?.archiveFolder,
        };

        log.email('Marking emails with action "%s"', Array.isArray(action) ? action.join(',') : action);
        const result = await this.email.mark(markOptions);
        log.email('Successfully marked %d email(s)', result);
        return result;
    }

    // ==========================================
    // API INTERACTION STEPS
    // ==========================================

    /**
     * Resolves the named `WasapiClient` from the internal registry. Defaults to
     * the `'default'` client (configured via `apiBaseUrl`). Named providers come
     * from `apiProviders` on the fixture options.
     */
    private getApiClient(name?: string): WasapiClient {
        const clientName = name ?? 'default';
        const client = this.apiClients.get(clientName);
        if (!client) {
            if (clientName === 'default') {
                throw new Error('API client is not configured. Pass apiBaseUrl to baseFixture() options when setting up your test fixture.');
            }
            throw new Error(`API provider "${clientName}" is not configured. Pass it in apiProviders to baseFixture() options. Available: ${[...this.apiClients.keys()].join(', ')}`);
        }
        return client;
    }

    /**
     * Issues an HTTP GET against the default API client, or the named provider
     * when the first argument matches a key in `apiProviders`.
     *
     * @example
     * ```ts
     * const res = await steps.apiGet<User>('/users/42');
     * const res = await steps.apiGet<User[]>('billing', '/users', { query: { active: 'true' } });
     * ```
     */
    async apiGet<T>(pathOrProvider: string, pathOrOptions?: string | { query?: Record<string, string>; headers?: Record<string, string> }, maybeOptions?: { query?: Record<string, string>; headers?: Record<string, string> }): Promise<ApiResponse<T>> {
        const { client, path, options } = this.resolveApiArgs(pathOrProvider, pathOrOptions, maybeOptions);
        log.api('GET %s', path);
        return await client.execute<T>({
            method: 'GET',
            path,
            queryParams: options?.query,
            headers: options?.headers,
        });
    }

    /**
     * Issues an HTTP POST with an optional JSON body against the default API
     * client, or the named provider when the first argument matches a key in
     * `apiProviders`.
     */
    async apiPost<T>(pathOrProvider: string, bodyOrPath?: unknown, optionsOrBody?: unknown, maybeOptions?: { pathParams?: Record<string, string>; query?: Record<string, string>; headers?: Record<string, string> }): Promise<ApiResponse<T>> {
        const { client, path, body, options } = this.resolveApiArgsWithBody(pathOrProvider, bodyOrPath, optionsOrBody, maybeOptions);
        log.api('POST %s', path);
        return await client.execute<T>({
            method: 'POST',
            path,
            body,
            pathParams: options?.pathParams,
            queryParams: options?.query,
            headers: options?.headers,
        });
    }

    /**
     * Issues an HTTP PUT with an optional JSON body against the default API
     * client, or the named provider when the first argument matches a key in
     * `apiProviders`.
     */
    async apiPut<T>(pathOrProvider: string, bodyOrPath?: unknown, optionsOrBody?: unknown, maybeOptions?: { pathParams?: Record<string, string>; headers?: Record<string, string> }): Promise<ApiResponse<T>> {
        const { client, path, body, options } = this.resolveApiArgsWithBody(pathOrProvider, bodyOrPath, optionsOrBody, maybeOptions);
        log.api('PUT %s', path);
        return await client.execute<T>({
            method: 'PUT',
            path,
            body,
            pathParams: options?.pathParams,
            headers: options?.headers,
        });
    }

    /**
     * Issues an HTTP DELETE against the default API client, or the named
     * provider when the first argument matches a key in `apiProviders`.
     */
    async apiDelete<T>(pathOrProvider: string, pathOrOptions?: string | { pathParams?: Record<string, string>; headers?: Record<string, string> }, maybeOptions?: { pathParams?: Record<string, string>; headers?: Record<string, string> }): Promise<ApiResponse<T>> {
        const { client, path, options } = this.resolveApiArgs(pathOrProvider, pathOrOptions, maybeOptions);
        log.api('DELETE %s', path);
        return await client.execute<T>({
            method: 'DELETE',
            path,
            pathParams: options?.pathParams,
            headers: options?.headers,
        });
    }

    /**
     * Issues an HTTP PATCH with an optional JSON body against the default API
     * client, or the named provider when the first argument matches a key in
     * `apiProviders`.
     */
    async apiPatch<T>(pathOrProvider: string, bodyOrPath?: unknown, optionsOrBody?: unknown, maybeOptions?: { pathParams?: Record<string, string>; headers?: Record<string, string> }): Promise<ApiResponse<T>> {
        const { client, path, body, options } = this.resolveApiArgsWithBody(pathOrProvider, bodyOrPath, optionsOrBody, maybeOptions);
        log.api('PATCH %s', path);
        return await client.execute<T>({
            method: 'PATCH',
            path,
            body,
            pathParams: options?.pathParams,
            headers: options?.headers,
        });
    }

    /**
     * Issues an HTTP HEAD and returns the response headers as a flat record.
     */
    async apiHead(pathOrProvider: string, maybePath?: string): Promise<Record<string, string>> {
        let client: WasapiClient;
        let path: string;
        if (maybePath !== undefined) {
            client = this.getApiClient(pathOrProvider);
            path = maybePath;
        } else {
            client = this.getApiClient();
            path = pathOrProvider;
        }
        log.api('HEAD %s', path);
        const response = await client.execute<unknown>({ method: 'HEAD', path });
        return response.headers;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private resolveApiArgs(pathOrProvider: string, pathOrOptions?: any, maybeOptions?: any): { client: WasapiClient; path: string; options?: any } {
        if (typeof pathOrOptions === 'string') {
            return { client: this.getApiClient(pathOrProvider), path: pathOrOptions, options: maybeOptions };
        }
        return { client: this.getApiClient(), path: pathOrProvider, options: pathOrOptions };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private resolveApiArgsWithBody(pathOrProvider: string, bodyOrPath?: any, optionsOrBody?: any, maybeOptions?: any): { client: WasapiClient; path: string; body?: unknown; options?: any } {
        if (typeof bodyOrPath === 'string') {
            return { client: this.getApiClient(pathOrProvider), path: bodyOrPath, body: optionsOrBody, options: maybeOptions };
        }
        return { client: this.getApiClient(), path: pathOrProvider, body: bodyOrPath, options: optionsOrBody };
    }

    /**
     * Asserts that an `ApiResponse` returned the expected HTTP status code.
     * Throws with the response body embedded on failure.
     */
    async verifyApiStatus(response: ApiResponse<unknown>, expectedStatus: number): Promise<void> {
        log.verify('Verifying API response status is %d (actual: %d)', expectedStatus, response.status);
        if (response.status !== expectedStatus) {
            throw new Error(`Expected API status ${expectedStatus} but got ${response.status}. Body: ${response.rawBody}`);
        }
    }

    /**
     * Asserts that an `ApiResponse` contains the given header (case-insensitive),
     * and optionally matches the expected value exactly.
     */
    async verifyApiHeader(response: ApiResponse<unknown>, headerName: string, expectedValue?: string): Promise<void> {
        const lowerName = headerName.toLowerCase();
        const actual = Object.entries(response.headers).find(([k]) => k.toLowerCase() === lowerName);

        if (!actual) {
            throw new Error(`Expected API response to contain header "${headerName}" but it was not found. Headers: ${JSON.stringify(response.headers)}`);
        }

        log.verify('Verifying API header "%s" is present (value: "%s")', headerName, actual[1]);

        if (expectedValue !== undefined && actual[1] !== expectedValue) {
            throw new Error(`Expected header "${headerName}" to be "${expectedValue}" but got "${actual[1]}"`);
        }
    }

    /**
     * Resolves the named `SqlClient` from the internal registry. Defaults to the
     * `'default'` client (configured via `dbUrl`). Named connections come from
     * `dbProviders` on the fixture options.
     */
    private getDbClient(name?: string): SqlClient {
        const clientName = name ?? 'default';
        const cached = this.dbClients.get(clientName);
        if (cached) return cached;

        const connectionString = this.dbConfigs.get(clientName);
        if (!connectionString) {
            if (clientName === 'default') {
                throw new Error('SQL client is not configured. Pass dbUrl to baseFixture() options when setting up your test fixture.');
            }
            throw new Error(`SQL provider "${clientName}" is not configured. Pass it in dbProviders to baseFixture() options. Available: ${[...this.dbConfigs.keys()].join(', ')}`);
        }

        // Built lazily on first use. element-interactions does not bundle SQL engine
        // drivers (pg/mysql2/better-sqlite3/mssql/oracledb) — the agent/project must
        // install the one for the engine it targets. Surface that as an actionable
        // error at the first DB step rather than an opaque MODULE_NOT_FOUND.
        let client: SqlClient;
        try {
            client = new SqlClient({ connectionString, connectTimeoutMs: this.dbConnectTimeoutMs });
        } catch (err) {
            if (err instanceof UnsupportedEngineException) {
                throw new UnsupportedEngineException(
                    `SQL steps need a database driver that is not installed. ${err.message} ` +
                    `element-interactions does not bundle SQL drivers — install the one for your engine and re-run.`
                );
            }
            throw err;
        }
        this.dbClients.set(clientName, client);
        return client;
    }

    /**
     * Splits `(sqlOrProvider, sql?, params?)` into a resolved client + sql + params.
     * If the second arg is a string, the first is treated as a provider name.
     */
    private resolveSqlArgs(sqlOrProvider: string, sql?: string | unknown[], params?: unknown[]): { client: SqlClient; sql: string; params: unknown[] } {
        if (typeof sql === 'string') {
            return { client: this.getDbClient(sqlOrProvider), sql, params: params ?? [] };
        }
        return { client: this.getDbClient(), sql: sqlOrProvider, params: (sql as unknown[]) ?? [] };
    }

    /**
     * Runs a parametrised read query (SELECT) against the default SQL client, or
     * the named provider when the first argument matches a key in `dbProviders`.
     *
     * @example
     * ```ts
     * const res = await steps.sqlQuery<{ title: string }>('SELECT title FROM books WHERE genre = $1', ['Fiction']);
     * const res = await steps.sqlQuery('analytics', 'SELECT count(*) FROM orders');
     * ```
     */
    async sqlQuery<T = Record<string, unknown>>(sqlOrProvider: string, sql?: string | unknown[], params?: unknown[]): Promise<SqlResult<T>> {
        const resolved = this.resolveSqlArgs(sqlOrProvider, sql, params);
        log.sql('QUERY %s %o', resolved.sql, resolved.params);
        return await resolved.client.query<T>(resolved.sql, resolved.params);
    }

    /**
     * Runs a parametrised write statement (INSERT/UPDATE/DELETE) and returns the
     * affected `rowCount`. Same provider-overload as {@link sqlQuery}.
     */
    async sqlExecute(sqlOrProvider: string, sql?: string | unknown[], params?: unknown[]): Promise<SqlResult> {
        const resolved = this.resolveSqlArgs(sqlOrProvider, sql, params);
        log.sql('EXECUTE %s %o', resolved.sql, resolved.params);
        return await resolved.client.execute(resolved.sql, resolved.params);
    }

    /**
     * Runs `fn` inside a transaction (BEGIN/COMMIT, auto-ROLLBACK on throw).
     * Pass a provider name as the first argument to target a named connection:
     * `steps.sqlTransaction('analytics', async (tx) => { ... })`.
     */
    async sqlTransaction<R>(fnOrProvider: string | ((tx: import('@civitas-cerebrum/sql-client').SqlTransaction) => Promise<R>), fn?: (tx: import('@civitas-cerebrum/sql-client').SqlTransaction) => Promise<R>): Promise<R> {
        if (typeof fnOrProvider === 'string') {
            log.sql('TRANSACTION (provider=%s)', fnOrProvider);
            return await this.getDbClient(fnOrProvider).transaction(fn!);
        }
        log.sql('TRANSACTION (default)');
        return await this.getDbClient().transaction(fnOrProvider);
    }

    /**
     * Connectivity probe against the default (or named) SQL client — runs the
     * engine-correct `SELECT 1` and throws if the database is unreachable. Use in
     * a Playwright `globalSetup` so a misconfigured `dbUrl` fails the run up front
     * with a clear error instead of a hung first query.
     */
    async sqlPing(provider?: string): Promise<void> {
        log.sql('PING (provider=%s)', provider ?? 'default');
        await this.getDbClient(provider).ping();
    }

    /**
     * Execute a multi-statement SQL script (schema/seed file) against the default
     * or named client. The script is split with the engine's rules (Oracle `/`,
     * SQL Server `GO`, comment/quote aware) and each statement runs in order.
     * Provider-overloaded like {@link sqlQuery}:
     * `steps.sqlScript(readFileSync('seed.sql','utf8'))` or
     * `steps.sqlScript('analytics', schemaSql)`.
     */
    async sqlScript(sqlTextOrProvider: string, maybeSqlText?: string): Promise<void> {
        const usingProvider = typeof maybeSqlText === 'string';
        const client = usingProvider ? this.getDbClient(sqlTextOrProvider) : this.getDbClient();
        const sqlText = usingProvider ? maybeSqlText : sqlTextOrProvider;
        log.sql('SCRIPT (provider=%s, %d chars)', usingProvider ? sqlTextOrProvider : 'default', sqlText.length);
        await client.runScript(sqlText);
    }

    /** Begin a fluent SELECT builder pre-bound to the default (or named) client. */
    sqlSelect(table: string, provider?: string): QueryBuilder & { run<T = Record<string, unknown>>(): Promise<SqlResult<T>> } {
        return this.bindBuilder(QueryBuilder.select(table), provider);
    }
    /** Begin a fluent INSERT builder. Call `.values({...}).run()`. */
    sqlInsert(table: string, provider?: string): QueryBuilder & { run<T = Record<string, unknown>>(): Promise<SqlResult<T>> } {
        return this.bindBuilder(QueryBuilder.insert(table), provider);
    }
    /** Begin a fluent UPDATE builder. Call `.set({...}).where(...).run()`. */
    sqlUpdate(table: string, provider?: string): QueryBuilder & { run<T = Record<string, unknown>>(): Promise<SqlResult<T>> } {
        return this.bindBuilder(QueryBuilder.update(table), provider);
    }
    /** Begin a fluent DELETE builder. Call `.where(...).run()`. */
    sqlDelete(table: string, provider?: string): QueryBuilder & { run<T = Record<string, unknown>>(): Promise<SqlResult<T>> } {
        return this.bindBuilder(QueryBuilder.delete(table), provider);
    }

    /**
     * Rebinds a builder's `.run()` so the test author needs no client argument:
     * `.run()` dispatches through the resolved SqlClient.
     */
    private bindBuilder(builder: QueryBuilder, provider?: string): QueryBuilder & { run<T = Record<string, unknown>>(): Promise<SqlResult<T>> } {
        const client = this.getDbClient(provider);
        const bound = builder as QueryBuilder & { run<T = Record<string, unknown>>(): Promise<SqlResult<T>> };
        bound.run = (<T = Record<string, unknown>>() => {
            const { text, values } = builder.toSql(client.dialect);
            log.sql('BUILD %s %o', text, values);
            // QueryBuilder only emits plain SELECT/INSERT/UPDATE/DELETE; a leading SELECT → read path.
            // If the builder ever gains CTEs (WITH ... SELECT) or RETURNING, revisit this dispatch.
            return /^\s*select/i.test(text) ? client.query<T>(text, values) : (client.execute(text, values) as Promise<SqlResult<T>>);
        }) as QueryBuilder['run'] & (<T>() => Promise<SqlResult<T>>);
        return bound;
    }

    /** Closes all open SQL connection pools. Called by the fixture in teardown. Safe to call more than once. */
    async closeDbConnections(): Promise<void> {
        const clients = [...this.dbClients.values()];
        this.dbClients.clear();
        for (const client of clients) {
            await client.end();
        }
    }

    /** Asserts the result row count equals `expected`, or falls within `{min,max}`. */
    async verifySqlRowCount(result: SqlResult<unknown>, expected: number | { min?: number; max?: number }): Promise<void> {
        const actual = result.rowCount;
        if (typeof expected === 'number') {
            log.sql('verify rowCount === %d (actual %d)', expected, actual);
            if (actual !== expected) throw new Error(`Expected SQL row count ${expected} but got ${actual}.`);
            return;
        }
        if (expected.min !== undefined && actual < expected.min) throw new Error(`Expected SQL row count >= ${expected.min} but got ${actual}.`);
        if (expected.max !== undefined && actual > expected.max) throw new Error(`Expected SQL row count <= ${expected.max} but got ${actual}.`);
    }

    /** Asserts a single cell at `rowIndex`/`column` equals `expected` (loose `==` after String()). */
    async verifySqlValue(result: SqlResult<Record<string, unknown>>, rowIndex: number, column: string, expected: unknown): Promise<void> {
        const row = result.rows[rowIndex];
        if (!row) throw new Error(`Expected a row at index ${rowIndex} but the result has ${result.rows.length} row(s).`);
        const actual = row[column];
        log.sql('verify row[%d].%s === %o (actual %o)', rowIndex, column, expected, actual);
        if (String(actual) !== String(expected)) {
            throw new Error(`Expected row[${rowIndex}].${column} to be "${expected}" but got "${actual}".`);
        }
    }

    /** Asserts at least one row matches every column/value pair in `partialRow`. */
    async verifySqlContains(result: SqlResult<Record<string, unknown>>, partialRow: Record<string, unknown>): Promise<void> {
        const entries = Object.entries(partialRow);
        const found = result.rows.some((row) => entries.every(([k, v]) => String(row[k]) === String(v)));
        log.sql('verify contains %o (found=%s)', partialRow, found);
        if (!found) {
            throw new Error(`Expected a row matching ${JSON.stringify(partialRow)} but none of the ${result.rows.length} row(s) did.`);
        }
    }

    /** Asserts the ordered values of `column` across all rows equal `expected`. */
    async verifySqlColumn(result: SqlResult<Record<string, unknown>>, column: string, expected: unknown[]): Promise<void> {
        const actual = result.rows.map((r) => r[column]);
        log.sql('verify column %s order %o (actual %o)', column, expected, actual);
        if (actual.length !== expected.length || actual.some((v, i) => String(v) !== String(expected[i]))) {
            throw new Error(`Expected column "${column}" to be [${expected.join(', ')}] but got [${actual.join(', ')}].`);
        }
    }

    /** Asserts the result has zero rows. */
    async verifySqlEmpty(result: SqlResult<unknown>): Promise<void> {
        log.sql('verify empty (actual %d)', result.rowCount);
        if (result.rowCount !== 0 || result.rows.length !== 0) {
            throw new Error(`Expected an empty SQL result but got ${result.rowCount} row(s).`);
        }
    }

    /** Asserts the result has at least one row. */
    async verifySqlNotEmpty(result: SqlResult<unknown>): Promise<void> {
        log.sql('verify not empty (actual %d)', result.rowCount);
        if (result.rows.length === 0) {
            throw new Error('Expected a non-empty SQL result but got 0 rows.');
        }
    }
}
