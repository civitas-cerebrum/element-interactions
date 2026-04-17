import { Page, Locator, Response } from '@playwright/test';
import { ElementRepository, Element, WebElement, ElementResolutionOptions, SelectionStrategy } from '@civitas-cerebrum/element-repository';
import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { Utils } from '../utils/ElementUtilities';
import { EmailClientConfig, EmailSendOptions, EmailReceiveOptions, ReceivedEmail, EmailMarkOptions, EmailMarkAction, EmailFilter } from '@civitas-cerebrum/email-client';
import { StepOptions, DropdownSelectOptions, TextVerifyOptions, CountVerifyOptions, DragAndDropOptions, ListedElementOptions, ListedElementMatch, VerifyListedOptions, GetListedDataOptions, FillFormValue, GetAllOptions, ScreenshotOptions, IsVisibleOptions } from '../enum/Options';
import { logger } from '../logger/Logger';
import { ElementAction } from './ElementAction';
import { ExpectBuilder } from './ExpectMatchers';

/**
 * Extracts the underlying Playwright Locator from an Element wrapper.
 * This bridges the Element interface from element-repository
 * with the Playwright-specific interaction/verification/extraction classes.
 */
function toLocator(element: Element): Locator {
    return (element as WebElement).locator;
}

const log = {
    navigate: logger('navigate'),
    interact: logger('interact'),
    extract: logger('extract'),
    verify: logger('verify'),
    email: logger('email'),
    wait: logger('wait'),
};

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
    private timeout?: number;

    /**
     * Initializes the Steps class with the element repository.
     * The Playwright Page is obtained from the repository's driver.
     * @param repo - An initialized instance of `ElementRepository` containing your locators and the bound driver.
     * @param options - Optional configuration: emailCredentials and/or timeout.
     */
    constructor(
        private repo: ElementRepository,
        options?: { emailCredentials?: EmailClientConfig; timeout?: number }
    ) {
        this.page = repo.driver;
        const { emailCredentials, timeout } = options ?? {};
        const interactions = new ElementInteractions(this.page, { emailCredentials, timeout });
        this.interact = interactions.interact;
        this.navigate = interactions.navigate;
        this.extract = interactions.extract;
        this.verify = interactions.verify;
        this.timeout = timeout;
        this.utils = new Utils(timeout);
        this.email = interactions.email;
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
     * Clicks on an element identified by page and element name from the repository.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution and click modifiers.
     */
    async click(elementName: string, pageName: string, options?: StepOptions): Promise<boolean | void> {
        log.interact('Clicking on "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        return await this.interact.click(element, {
            withoutScrolling: options?.withoutScrolling,
            ifPresent: options?.ifPresent,
            force: options?.force,
        });
    }

    /**
     * Clicks on an element without scrolling it into view first.
     * Useful for elements in fixed or sticky positions (e.g. headers, floating buttons).     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async clickWithoutScrolling(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Clicking (no scroll) on "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.click(element, { withoutScrolling: true });
    }

    /**
     * Clicks a random visible element from a group of elements matching the locator.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options.
     * @throws Error if no visible element is found for the given locator.
     */
    async clickRandom(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Clicking a random element from "%s" in "%s"', elementName, pageName);
        const element = await this.repo.getRandom(elementName, pageName);
        if (!element) throw new Error(`No visible element found for "${elementName}" in "${pageName}"`);
        await this.interact.click(element, {
            withoutScrolling: options?.withoutScrolling,
        });
    }

    /**
     * Clicks on an element only if it is present in the DOM.
     * Does nothing if the element is not found.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async clickIfPresent(elementName: string, pageName: string, options?: StepOptions): Promise<boolean> {
        log.interact('Clicking on "%s" in "%s" (if present)', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        return await this.interact.click(element, { ifPresent: true }) as boolean;
    }

    /**
     * Right-clicks on an element identified by page and element name from the repository.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async rightClick(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Right-clicking on "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.rightClick(element);
    }

    /**
     * Double-clicks on an element identified by page and element name from the repository.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async doubleClick(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Double-clicking on "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.doubleClick(element);
    }

    /**
     * Checks a checkbox or radio button. Idempotent.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async check(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Checking "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.check(element);
    }

    /**
     * Unchecks a checkbox. Idempotent.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async uncheck(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Unchecking "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.uncheck(element);
    }

    /**
     * Hovers over an element, triggering any hover-based UI effects.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async hover(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Hovering over "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.hover(element);
    }

    /**
     * Scrolls the specified element into the visible viewport.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async scrollIntoView(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Scrolling "%s" in "%s" into view', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.scrollIntoView(element);
    }

    /**
     * Clears the input field and fills it with the specified text.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param text - The text to fill into the input field.
     * @param options - Optional step options for element resolution.
     */
    async fill(elementName: string, pageName: string, text: string, options?: StepOptions): Promise<void> {
        log.interact('Filling "%s" in "%s" with text: "%s"', elementName, pageName, text);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.fill(element, text);
    }

    /**
     * Uploads a file to a file input element.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param filePath - The path to the file to upload.
     * @param options - Optional step options for element resolution.
     */
    async uploadFile(elementName: string, pageName: string, filePath: string, options?: StepOptions): Promise<void> {
        log.interact('Uploading file "%s" to "%s" in "%s"', filePath, elementName, pageName);
        const locator = toLocator(await this.repo.get(elementName, pageName, this.toResolutionOptions(options)));
        await this.interact.uploadFile(locator, filePath);
    }

    /**
     * Selects an option from a `<select>` dropdown element.     * @param elementName - The element name as defined under the given page.

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
        const locator = toLocator(await this.repo.get(elementName, pageName, this.toResolutionOptions(options)));
        return await this.interact.selectDropdown(locator, dropdownOptions);
    }

    /**
     * Performs a drag-and-drop action on an element.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param dragOptions - Drag target: either `{ target: Locator }` or `{ xOffset, yOffset }`.
     * @param options - Optional step options for element resolution.
     */
    async dragAndDrop(elementName: string, pageName: string, dragOptions: DragAndDropOptions, options?: StepOptions): Promise<void> {
        log.interact('Dragging and dropping "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(elementName, pageName, this.toResolutionOptions(options)));
        await this.interact.dragAndDrop(locator, dragOptions);
    }

    /**
     * Performs a drag-and-drop action on a specific element within a list,
     * identified by its visible text content.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementText - The visible text of the specific list item to drag.
     * @param dragOptions - Drag target: either `{ target: Locator }` or `{ xOffset, yOffset }`.
     * @throws Error if no element with the specified text is found.
     */
    async dragAndDropListedElement(elementName: string, pageName: string, elementText: string, dragOptions: DragAndDropOptions): Promise<void> {
        log.interact('Dragging and dropping "%s" in "%s"', elementText, pageName);
        const element = await this.repo.getByText(elementName, pageName, elementText);
        if (!element) throw new Error(`No element with text "${elementText}" found for "${elementName}" in "${pageName}"`);
        await this.interact.dragAndDrop(toLocator(element), dragOptions);
    }

    /**
     * Sets the value of a range/slider input element.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param value - The numeric value to set on the slider.
     * @param options - Optional step options for element resolution.
     */
    async setSliderValue(elementName: string, pageName: string, value: number, options?: StepOptions): Promise<void> {
        log.interact('Setting slider "%s" in "%s" to value: %d', elementName, pageName, value);
        const locator = toLocator(await this.repo.get(elementName, pageName, this.toResolutionOptions(options)));
        await this.interact.setSliderValue(locator, value);
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
     * Types text into an input field one character at a time with a delay between keystrokes.     * @param elementName - The element name as defined under the given page.

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
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.typeSequentially(element, text, delay);
    }

    /**
     * Clears the value of an input or textarea element without filling it with new text.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async clearInput(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.interact('Clearing input "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.interact.clearInput(element);
    }

    /**
     * Selects multiple options from a `<select multiple>` element by their `value` attributes.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param values - An array of `value` attribute strings to select simultaneously.
     * @param options - Optional step options for element resolution.
     * @returns An array of the actually selected `value` strings.
     */
    async selectMultiple(elementName: string, pageName: string, values: string[], options?: StepOptions): Promise<string[]> {
        log.interact('Selecting multiple values on "%s" in "%s": %O', elementName, pageName, values);
        const locator = toLocator(await this.repo.get(elementName, pageName, this.toResolutionOptions(options)));
        return await this.interact.selectMultiple(locator, values);
    }

    // ==========================================
    // DATA EXTRACTION STEPS
    // ==========================================

    /**
     * Retrieves the visible text content of an element.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     * @returns The text content of the element, or `null` if unavailable.
     */
    async getText(elementName: string, pageName: string, options?: StepOptions): Promise<string | null> {
        log.extract('Getting text from "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        return await this.extract.getText(element);
    }

    /**
     * Retrieves the value of a specific HTML attribute from an element.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param attributeName - The name of the attribute to retrieve.
     * @param options - Optional step options for element resolution.
     * @returns The attribute value, or `null` if the attribute does not exist.
     */
    async getAttribute(elementName: string, pageName: string, attributeName: string, options?: StepOptions): Promise<string | null> {
        log.extract('Getting attribute "%s" from "%s" in "%s"', attributeName, elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        return await this.extract.getAttribute(element, attributeName);
    }

    /**
     * Returns the number of DOM elements matching the locator.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     * @returns The count of matching elements.
     */
    async getCount(elementName: string, pageName: string, options?: StepOptions): Promise<number> {
        log.extract('Getting count of "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toAllResolutionOptions(options));
        return await this.extract.getCount(element);
    }

    /**
     * Retrieves the current value of an input, textarea, or select element.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     * @returns The current value of the input.
     */
    async getInputValue(elementName: string, pageName: string, options?: StepOptions): Promise<string> {
        log.extract('Getting input value of "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        return await this.extract.getInputValue(element);
    }

    /**
     * Retrieves a computed CSS property value from an element.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param property - The CSS property name.
     * @param options - Optional step options for element resolution.
     * @returns The computed value as a string.
     */
    async getCssProperty(elementName: string, pageName: string, property: string, options?: StepOptions): Promise<string> {
        log.extract('Getting CSS "%s" from "%s" in "%s"', property, elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        return await this.extract.getCssProperty(element, property);
    }

    /**
     * Extracts text content or attribute values from all elements matching the locator.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param getAllOptions - Optional extraction configuration.
     * @param options - Optional step options for element resolution.
     * @returns An array of extracted strings.
     */
    async getAll(elementName: string, pageName: string, getAllOptions?: GetAllOptions, options?: StepOptions): Promise<string[]> {
        log.extract('Extracting all from "%s" in "%s"', elementName, pageName);
        let locator = toLocator(await this.repo.get(elementName, pageName, this.toAllResolutionOptions(options)));

        if (getAllOptions?.child) {
            if (typeof getAllOptions.child === 'string') {
                locator = locator.locator(getAllOptions.child);
            } else {
                const childSelector = this.repo.getSelector(getAllOptions.child.elementName, getAllOptions.child.pageName);
                locator = locator.locator(childSelector);
            }
        }

        if (getAllOptions?.extractAttribute) {
            const elements = await locator.all();
            const values = await Promise.all(elements.map(el => el.getAttribute(getAllOptions.extractAttribute!)));
            return values.filter((v): v is string => v !== null);
        }

        return await this.extract.getAllTexts(locator);
    }

    // ==========================================
    // VERIFICATION STEPS
    // ==========================================

    /**
     * Asserts that the element is present and visible in the DOM.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     */
    async verifyPresence(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying presence of "%s" in "%s"', elementName, pageName);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.verify.presence(element);
    }

    /**
     * Checks whether an element is currently present and visible in the DOM.
     * Returns a boolean instead of throwing.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options for element resolution.
     * @returns `true` if the element is visible, `false` otherwise.
     */
    async isPresent(elementName: string, pageName: string, options?: StepOptions): Promise<boolean> {
        log.verify('Checking presence of "%s" in "%s"', elementName, pageName);
        try {
            const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
            return await element.isVisible();
        } catch {
            return false;
        }
    }

    /**
     * Non-throwing visibility probe. Returns `true` if the element is visible
     * within the given timeout, `false` otherwise. Optionally filters by text content.
     *
     * Unlike `isPresent`, this method supports a custom timeout (default 2000ms)
     * and an optional `containsText` filter that requires the element's text to
     * include the given substring.
     *
     * @param elementName - The element name as defined under the given page.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional probe settings.
     * @returns `true` if the element is visible (and matches text, if specified), `false` otherwise.
     */
    async isVisible(elementName: string, pageName: string, options?: IsVisibleOptions): Promise<boolean> {
        const timeout = options?.timeout ?? 2000;
        log.verify('Probing visibility of "%s" in "%s" (timeout: %dms)', elementName, pageName, timeout);
        try {
            // Use getSelector + construct a WebElement directly so the caller-supplied
            // timeout is the only wait in play — repo.get() would block on its own
            // repository resolution timeout (15s default) before our waitFor runs.
            const selector = this.repo.getSelector(elementName, pageName);
            const element = new WebElement(this.page.locator(selector).first());
            await element.waitFor({ state: 'visible', timeout });
            if (options?.containsText) {
                const text = await element.textContent().catch(() => null);
                return text !== null && text.includes(options.containsText);
            }
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Asserts that the element is not present in the DOM.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Optional step options (strategy not applicable for absence checks).
     */
    async verifyAbsence(elementName: string, pageName: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying absence of "%s" in "%s"', elementName, pageName);
        const selector = this.repo.getSelector(elementName, pageName);
        await this.verify.absence(selector);
    }

    /**
     * Asserts that an element's text content matches the expected value.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param expectedText - The exact text to match against.
     * @param verifyOptions - Optional verification options (e.g. `{ notEmpty: true }`).
     * @param options - Optional step options for element resolution.
     */
    async verifyText(elementName: string, pageName: string, expectedText?: string, verifyOptions?: TextVerifyOptions, options?: StepOptions): Promise<void> {
        const notEmpty = verifyOptions?.notEmpty || expectedText === undefined;
        const logDetail = notEmpty ? 'is not empty' : `matches: "${expectedText}"`;
        log.verify('Verifying text of "%s" in "%s" %s', elementName, pageName, logDetail);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.verify.text(element, expectedText, notEmpty ? { notEmpty: true } : verifyOptions);
    }

    /**
     * Asserts the number of elements matching the locator satisfies the given condition.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param countOptions - Count condition.
     * @param options - Optional step options for element resolution.
     */
    async verifyCount(elementName: string, pageName: string, countOptions: CountVerifyOptions, options?: StepOptions): Promise<void> {
        log.verify('Verifying count for "%s" in "%s" with options: %O', elementName, pageName, countOptions);
        const element = await this.repo.get(elementName, pageName, this.toAllResolutionOptions(options));
        await this.verify.count(element, countOptions);
    }

    /**
     * Asserts that all image elements matching the locator have loaded successfully.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param scroll - Whether to scroll each image into view before checking. Defaults to `true`.
     * @param options - Optional step options for element resolution.
     */
    async verifyImages(elementName: string, pageName: string, scroll: boolean = true, options?: StepOptions): Promise<void> {
        log.verify('Verifying images for "%s" in "%s" (scroll: %s)', elementName, pageName, scroll);
        const locator = toLocator(await this.repo.get(elementName, pageName, this.toAllResolutionOptions(options)));
        await this.verify.images(locator, scroll);
    }

    /**
     * Asserts that an element's text content contains the specified substring.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param expectedText - The substring expected to be found within the element's text.
     * @param options - Optional step options for element resolution.
     */
    async verifyTextContains(elementName: string, pageName: string, expectedText: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying "%s" in "%s" contains text: "%s"', elementName, pageName, expectedText);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.verify.textContains(element, expectedText);
    }

    /**
     * Asserts that an element is in the specified state.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param state - The expected state.
     * @param timeout - Optional timeout in milliseconds.
     */
    async verifyState(
        elementName: string,
        pageName: string,
        state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport',
        timeout?: number
    ): Promise<void> {
        log.verify('Verifying "%s" in "%s" is %s', elementName, pageName, state);
        const locatorString = this.repo.getSelector(elementName, pageName);
        await this.verify.state(locatorString, state, timeout);
    }

    /**
     * Asserts that an element has a specific HTML attribute with the expected value.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param attributeName - The name of the HTML attribute to check.
     * @param expectedValue - The expected value of the attribute.
     * @param options - Optional step options for element resolution.
     */
    async verifyAttribute(elementName: string, pageName: string, attributeName: string, expectedValue: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying "%s" in "%s" has attribute "%s" = "%s"', elementName, pageName, attributeName, expectedValue);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.verify.attribute(element, attributeName, expectedValue);
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
     * Asserts that an input, textarea, or select element has the expected value.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param expectedValue - The expected value of the input.
     * @param options - Optional step options for element resolution.
     */
    async verifyInputValue(elementName: string, pageName: string, expectedValue: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying input value of "%s" in "%s" matches: "%s"', elementName, pageName, expectedValue);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.verify.inputValue(element, expectedValue);
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
     * plus the predicate escape hatch `.toBe(predicate)` for assertions the
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
     *   .toBe(el => parseFloat(el.text.slice(1)) > 10)
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
     * in the exact order specified.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param expectedTexts - The expected text values in their expected order.
     * @param options - Optional step options for element resolution.
     */
    async verifyOrder(elementName: string, pageName: string, expectedTexts: string[], options?: StepOptions): Promise<void> {
        log.verify('Verifying order of "%s" in "%s": %O', elementName, pageName, expectedTexts);
        const element = await this.repo.get(elementName, pageName, this.toAllResolutionOptions(options));
        await this.verify.order(element, expectedTexts);
    }

    /**
     * Asserts that a computed CSS property of an element matches the expected value.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param property - The CSS property name.
     * @param expectedValue - The expected computed value.
     * @param options - Optional step options for element resolution.
     */
    async verifyCssProperty(elementName: string, pageName: string, property: string, expectedValue: string, options?: StepOptions): Promise<void> {
        log.verify('Verifying CSS "%s" of "%s" in "%s" = "%s"', property, elementName, pageName, expectedValue);
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        await this.verify.cssProperty(element, property, expectedValue);
    }

    /**
     * Asserts that the text contents of all elements matching the locator are sorted
     * in the specified direction.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param direction - `'asc'` for ascending or `'desc'` for descending.
     * @param options - Optional step options for element resolution.
     */
    async verifyListOrder(elementName: string, pageName: string, direction: 'asc' | 'desc', options?: StepOptions): Promise<void> {
        log.verify('Verifying "%s" in "%s" is sorted %s', elementName, pageName, direction);
        const element = await this.repo.get(elementName, pageName, this.toAllResolutionOptions(options));
        await this.verify.listOrder(element, direction);
    }

    // ==========================================
    // LISTED ELEMENT STEPS
    // ==========================================

    /**
     * Clicks a specific element within a list identified by its visible text or an HTML attribute.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Match criteria.
     */
    async clickListedElement(elementName: string, pageName: string, options: ListedElementMatch): Promise<void> {
        log.interact('Clicking listed element in "%s" > "%s" with options: %O', pageName, elementName, options);
        const baseLocator = toLocator(await this.repo.get(elementName, pageName, { strategy: SelectionStrategy.ALL }));
        const target = await this.interact.getListedElement(baseLocator, options, this.repo);
        await this.interact.click(target);
    }

    /**
     * Verifies a specific element within a list.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Match and assertion criteria.
     */
    async verifyListedElement(elementName: string, pageName: string, options: VerifyListedOptions): Promise<void> {
        log.verify('Verifying listed element in "%s" > "%s" with options: %O', pageName, elementName, options);
        const baseLocator = toLocator(await this.repo.get(elementName, pageName, { strategy: SelectionStrategy.ALL }));
        const target = await this.interact.getListedElement(baseLocator, options, this.repo);

        if (options.expectedText !== undefined) {
            await this.verify.text(target, options.expectedText);
            return;
        }

        if (options.expected) {
            await this.verify.attribute(target, options.expected.name, options.expected.value);
            return;
        }

        await this.verify.presence(target);
    }

    /**
     * Extracts data from a specific element within a list.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param options - Match and extraction criteria.
     * @returns The extracted text content or attribute value, or `null`.
     */
    async getListedElementData(elementName: string, pageName: string, options: GetListedDataOptions): Promise<string | null> {
        log.extract('Extracting data from listed element in "%s" > "%s" with options: %O', pageName, elementName, options);
        const baseLocator = toLocator(await this.repo.get(elementName, pageName, { strategy: SelectionStrategy.ALL }));
        const target = await this.interact.getListedElement(baseLocator, options, this.repo);

        if (options.extractAttribute) {
            return await this.extract.getAttribute(target, options.extractAttribute);
        }

        return await this.extract.getText(target);
    }

    // ==========================================
    // WAIT STEPS
    // ==========================================

    /**
     * Waits for an element to reach the specified state before proceeding.     * @param elementName - The element name as defined under the given page.

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
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        try {
            await element.waitFor({ state, timeout: this.timeout });
        } catch {
            log.wait('Element failed to reach state \'%s\' within %dms...', state, this.timeout ?? 30000);
        }
    }

    /**
     * Waits for an element to reach a specific state, then clicks it.     * @param elementName - The element name as defined under the given page.

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
        const element = await this.repo.get(elementName, pageName, this.toResolutionOptions(options));
        const locator = toLocator(element);
        await this.utils.waitForState(locator, state);
        await this.interact.click(element);
    }

    /**
     * Clicks the element at a specific zero-based index from all elements matching the locator.     * @param elementName - The element name as defined under the given page.

     * @param pageName - The page name as defined in `page-repository.json`.
     * @param index - The zero-based index of the element to click.
     * @throws Error if no element exists at the specified index.
     */
    async clickNth(elementName: string, pageName: string, index: number): Promise<void> {
        log.interact('Clicking element at index %d of "%s" in "%s"', index, elementName, pageName);
        const element = await this.repo.getByIndex(elementName, pageName, index);
        if (!element) throw new Error(`No element at index ${index} for "${elementName}" in "${pageName}"`);
        await this.interact.click(element);
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
            const locator = toLocator(await this.repo.get(elementNameOrOptions, pageName));
            return await this.extract.screenshot(locator, options);
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
}
