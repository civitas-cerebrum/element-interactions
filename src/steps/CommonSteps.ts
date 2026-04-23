import { Page, Response } from '@playwright/test';
import { ElementRepository, Element, WebElement, ElementResolutionOptions, SelectionStrategy } from '@civitas-cerebrum/element-repository';
import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { Utils } from '../utils/ElementUtilities';
import { EmailClientConfig, EmailSendOptions, EmailReceiveOptions, ReceivedEmail, EmailMarkOptions, EmailMarkAction, EmailFilter } from '@civitas-cerebrum/email-client';
import { WasapiClient, ApiResponse } from '@civitas-cerebrum/wasapi';
import { StepOptions, DropdownSelectOptions, TextVerifyOptions, CountVerifyOptions, DragAndDropOptions, ListedElementOptions, ListedElementMatch, VerifyListedOptions, GetListedDataOptions, FillFormValue, GetAllOptions, ScreenshotOptions, IsVisibleOptions } from '../enum/Options';
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
    private timeout?: number;

    /**
     * Initializes the Steps class with the element repository.
     * The Playwright Page is obtained from the repository's driver.
     * @param repo - An initialized instance of `ElementRepository` containing your locators and the bound driver.
     * @param options - Optional configuration: emailCredentials, timeout, apiBaseUrl, and/or apiProviders.
     */
    constructor(
        private repo: ElementRepository,
        options?: {
            emailCredentials?: EmailClientConfig;
            timeout?: number;
            apiBaseUrl?: string;
            apiProviders?: Record<string, string>;
        }
    ) {
        this.page = repo.driver;
        const { emailCredentials, timeout, apiBaseUrl, apiProviders } = options ?? {};
        const interactions = new ElementInteractions(this.page, { emailCredentials, timeout });
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
        const interactions = new ElementInteractions(this.page, { timeout: this.timeout });
        return new ElementAction(this.repo, elementName, pageName, interactions, this.timeout);
    }

    // ==========================================
    // NAVIGATION STEPS
    // ==========================================

    /**
     * Navigates the browser to the specified URL.
     * Optionally appends query parameters from an options object.
     * @param url - The URL or path to navigate to (e.g. `'/dashboard'` or `'https://example.com'`).
     * @param options - Optional settings. `query` is a key-value map appended as query parameters.
     */
    async navigateTo(url: string, options?: { query?: Record<string, string> }): Promise<void> {
        let targetUrl = url;
        if (options?.query) {
            const params = new URLSearchParams(options.query).toString();
            targetUrl = `${url}${url.includes('?') ? '&' : '?'}${params}`;
        }
        log.navigate('Navigating to URL: "%s"', targetUrl);
        await this.navigate.toUrl(targetUrl);
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
        return await this.interact.click(element, { ifPresent: true }) as boolean;
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
     * Uploads a file to a file input element.
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param filePath - The path to the file to upload.
     * @param options - Optional step options for element resolution.
     */
    async uploadFile(elementName: string, pageName: string, filePath: string, options?: StepOptions): Promise<void> {
        log.interact('Uploading file "%s" to "%s" in "%s"', filePath, elementName, pageName);
        const element = await this.getWebElement(elementName, pageName, options);
        await this.interact.uploadFile(element, filePath);
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
     * Equivalent to `steps.on(elementName, pageName).verifyImages(scroll)`.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param scroll - Whether to scroll each image into view before checking. Defaults to `true`.
     * @param options - Optional step options for element resolution.
     */
    async verifyImages(elementName: string, pageName: string, scroll: boolean = true, options?: StepOptions): Promise<void> {
        log.verify('Verifying images for "%s" in "%s" (scroll: %s)', elementName, pageName, scroll);
        await this.actionWithStrategy(elementName, pageName, options).verifyImages(scroll);
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
        const interactions = new ElementInteractions(this.page, { timeout: this.timeout });
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
        await this.interact.click(target);
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
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param state - The desired state to wait for.
     * @param options - Optional step options for element resolution.
     */
    async waitForState(
        elementName: string,
        pageName: string,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible',
        options?: StepOptions
    ): Promise<void> {
        log.wait('Waiting for "%s" in "%s" to be "%s"', elementName, pageName, state);
        const element = await this.getWebElement(elementName, pageName, options);
        try {
            await element.waitFor({ state, timeout: this.timeout });
        } catch {
            log.wait('Element failed to reach state \'%s\' within %dms...', state, this.timeout ?? 30000);
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
        await this.utils.waitForState(element, state);
        await this.interact.click(element);
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
        await this.interact.click(element as WebElement);
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
     */
    async waitForNetworkIdle(): Promise<void> {
        log.wait('Waiting for network idle');
        await this.navigate.waitForNetworkIdle();
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
}
