import { Page, Locator, Response } from '@playwright/test';
import { ElementRepository, Element, WebElement } from '@civitas-cerebrum/element-repository';
import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { Utils } from '../utils/ElementUtilities';
import { EmailCredentials, EmailClientConfig, EmailSendOptions, EmailReceiveOptions, ReceivedEmail, EmailMarkOptions, EmailMarkAction, EmailFilter } from '@civitas-cerebrum/email-client';
import { DropdownSelectOptions, TextVerifyOptions, CountVerifyOptions, DragAndDropOptions, ListedElementOptions, ListedElementMatch, VerifyListedOptions, GetListedDataOptions, FillFormValue, GetAllOptions, ScreenshotOptions } from '../enum/Options';
import { logger } from '../logger/Logger';

/**
 * Extracts the underlying Playwright Locator from an Element wrapper.
 * This bridges the platform-agnostic Element interface from element-repository
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
    private interact;
    private navigate;
    private extract;
    private verify;
    private utils;
    private email;

    /**
     * Initializes the Steps class with the required Playwright page and element repository.
     * @param page - The current Playwright Page object.
     * @param repo - An initialized instance of `ElementRepository` containing your locators.
     * @param emailCredentials - Optional email credentials to enable the email sub-API.
     * @param timeout - Optional global timeout override (in milliseconds).
     */
    constructor(
        private page: Page,
        private repo: ElementRepository,
        emailCredentials?: EmailCredentials | EmailClientConfig,
        timeout?: number
    ) {
        const interactions = new ElementInteractions(page, emailCredentials, timeout);
        this.interact = interactions.interact;
        this.navigate = interactions.navigate;
        this.extract = interactions.extract;
        this.verify = interactions.verify;
        this.utils = new Utils(timeout);
        this.email = interactions.email;
    }

    // ==========================================
    // 🧭 NAVIGATION STEPS
    // ==========================================

    /**
     * Navigates the browser to the specified URL.
     * @param url - The URL or path to navigate to (e.g. `'/dashboard'` or `'https://example.com'`).
     */
    async navigateTo(url: string): Promise<void> {
        log.navigate('Navigating to URL: "%s"', url);
        await this.navigate.toUrl(url);
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
    // 🖱️ INTERACTION STEPS
    // ==========================================

    /**
     * Clicks on an element identified by page and element name from the repository.
     * The element is scrolled into view before clicking.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async click(pageName: string, elementName: string): Promise<void> {
        log.interact('Clicking on "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.click(locator);
    }

    /**
     * Clicks on an element without scrolling it into view first.
     * Useful for elements in fixed or sticky positions (e.g. headers, floating buttons).
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async clickWithoutScrolling(pageName: string, elementName: string): Promise<void> {
        log.interact('Clicking (no scroll) on "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.clickWithoutScrolling(locator);
    }

    /**
     * Clicks a random visible element from a group of elements matching the locator.
     * Useful for lists, grids, or repeated components where any item is acceptable.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @throws Error if no visible element is found for the given locator.
     */
    async clickRandom(pageName: string, elementName: string): Promise<void> {
        log.interact('Clicking a random element from "%s" in "%s"', elementName, pageName);
        const element = await this.repo.getRandom(this.page, pageName, elementName);
        if (!element) throw new Error(`No visible element found for "${elementName}" in "${pageName}"`);
        await this.interact.click(toLocator(element));
    }

    /**
     * Clicks on an element only if it is present in the DOM.
     * Does nothing if the element is not found — no error is thrown.
     * Useful for dismissing optional modals, banners, or cookie notices.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async clickIfPresent(pageName: string, elementName: string): Promise<boolean> {
        log.interact('Clicking on "%s" in "%s" (if present)', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        return this.interact.clickIfPresent(locator);
    }

    /**
     * Right-clicks on an element identified by page and element name from the repository.
     * Triggers the browser's context menu event on the element.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async rightClick(pageName: string, elementName: string): Promise<void> {
        log.interact('Right-clicking on "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.rightClick(locator);
    }

    /**
     * Double-clicks on an element identified by page and element name from the repository.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async doubleClick(pageName: string, elementName: string): Promise<void> {
        log.interact('Double-clicking on "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.doubleClick(locator);
    }

    /**
     * Checks a checkbox or radio button. Idempotent — does nothing if already checked.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async check(pageName: string, elementName: string): Promise<void> {
        log.interact('Checking "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.check(locator);
    }

    /**
     * Unchecks a checkbox. Idempotent — does nothing if already unchecked.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async uncheck(pageName: string, elementName: string): Promise<void> {
        log.interact('Unchecking "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.uncheck(locator);
    }

    /**
     * Hovers over an element, triggering any hover-based UI effects (tooltips, menus, etc.).
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async hover(pageName: string, elementName: string): Promise<void> {
        log.interact('Hovering over "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.hover(locator);
    }

    /**
     * Scrolls the specified element into the visible viewport.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async scrollIntoView(pageName: string, elementName: string): Promise<void> {
        log.interact('Scrolling "%s" in "%s" into view', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.scrollIntoView(locator);
    }

    /**
     * Clears the input field and fills it with the specified text.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param text - The text to fill into the input field.
     */
    async fill(pageName: string, elementName: string, text: string): Promise<void> {
        log.interact('Filling "%s" in "%s" with text: "%s"', elementName, pageName, text);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.fill(locator, text);
    }

    /**
     * Uploads a file to a file input element.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param filePath - The path to the file to upload (e.g. `'tests/fixtures/file.pdf'`).
     */
    async uploadFile(pageName: string, elementName: string, filePath: string): Promise<void> {
        log.interact('Uploading file "%s" to "%s" in "%s"', filePath, elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.uploadFile(locator, filePath);
    }

    /**
     * Selects an option from a `<select>` dropdown element.
     * By default, a random option is selected. Use the `options` parameter
     * to select by value, index, or explicitly random.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param options - Optional selection strategy (random, by value, or by index).
     * @returns The value of the selected option.
     */
    async selectDropdown(
        pageName: string,
        elementName: string,
        options?: DropdownSelectOptions
    ): Promise<string> {
        log.interact('Selecting dropdown option for "%s" in "%s" using options: %O', elementName, pageName, options ?? 'default (random)');
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        return await this.interact.selectDropdown(locator, options);
    }

    /**
     * Performs a drag-and-drop action on an element.
     * The target can be specified as another locator or as x/y pixel offsets.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param options - Drag target: either `{ target: Locator }` or `{ xOffset, yOffset }`.
     */
    async dragAndDrop(pageName: string, elementName: string, options: DragAndDropOptions): Promise<void> {
        log.interact('Dragging and dropping "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.dragAndDrop(locator, options);
    }

    /**
     * Performs a drag-and-drop action on a specific element within a list,
     * identified by its visible text content.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param elementText - The visible text of the specific list item to drag.
     * @param options - Drag target: either `{ target: Locator }` or `{ xOffset, yOffset }`.
     * @throws Error if no element with the specified text is found.
     */
    async dragAndDropListedElement(pageName: string, elementName: string, elementText: string, options: DragAndDropOptions): Promise<void> {
        log.interact('Dragging and dropping "%s" in "%s"', elementText, pageName);
        const element = await this.repo.getByText(this.page, pageName, elementName, elementText);
        if (!element) throw new Error(`No element with text "${elementText}" found for "${elementName}" in "${pageName}"`);
        await this.interact.dragAndDrop(toLocator(element), options);
    }

    /**
     * Sets the value of a range/slider input element.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param value - The numeric value to set on the slider.
     */
    async setSliderValue(pageName: string, elementName: string, value: number): Promise<void> {
        log.interact('Setting slider "%s" in "%s" to value: %d', elementName, pageName, value);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.setSliderValue(locator, value);
    }

    /**
     * Presses a keyboard key at the page level (not bound to a specific element).
     * Useful for keyboard shortcuts like Escape, Enter, Tab, or combos like 'Control+A'.
     * @param key - The key to press (e.g. `'Escape'`, `'Enter'`, `'Tab'`, `'Control+A'`).
     */
    async pressKey(key: string): Promise<void> {
        log.interact('Pressing key: "%s"', key);
        await this.interact.pressKey(key);
    }

    // ==========================================
    // 📊 DATA EXTRACTION STEPS
    // ==========================================

    /**
     * Retrieves the visible text content of an element.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @returns The text content of the element, or `null` if unavailable.
     */
    async getText(pageName: string, elementName: string): Promise<string | null> {
        log.extract('Getting text from "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        return await this.extract.getText(locator);
    }

    /**
     * Retrieves the value of a specific HTML attribute from an element.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param attributeName - The name of the attribute to retrieve (e.g. `'href'`, `'src'`, `'data-id'`).
     * @returns The attribute value, or `null` if the attribute does not exist.
     */
    async getAttribute(pageName: string, elementName: string, attributeName: string): Promise<string | null> {
        log.extract('Getting attribute "%s" from "%s" in "%s"', attributeName, elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        return await this.extract.getAttribute(locator, attributeName);
    }

    // ==========================================
    // ✅ VERIFICATION STEPS
    // ==========================================

    /**
     * Asserts that the element is present and visible in the DOM.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async verifyPresence(pageName: string, elementName: string): Promise<void> {
        log.verify('Verifying presence of "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.presence(locator);
    }

    /**
     * Asserts that the element is not present in the DOM.
     * Uses the raw selector string rather than a locator to avoid waiting for an element that should not exist.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async verifyAbsence(pageName: string, elementName: string): Promise<void> {
        log.verify('Verifying absence of "%s" in "%s"', elementName, pageName);
        const selector = await this.repo.getSelector(pageName, elementName);
        await this.verify.absence(selector);
    }

    /**
     * Asserts that an element's text content matches the expected value.
     * Can also verify that the text is simply not empty.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param expectedText - The exact text to match against. Omit when using `{ notEmpty: true }`.
     * @param options - Optional verification options (e.g. `{ notEmpty: true }` to only check non-emptiness).
     */
    async verifyText(pageName: string, elementName: string, expectedText?: string, options?: TextVerifyOptions): Promise<void> {
        const logDetail = options?.notEmpty ? 'is not empty' : `matches: "${expectedText}"`;
        log.verify('Verifying text of "%s" in "%s" %s', elementName, pageName, logDetail);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.text(locator, expectedText, options);
    }

    /**
     * Asserts the number of elements matching the locator satisfies the given condition.
     * Supports exact count, greaterThan, and lessThan comparisons.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param options - Count condition: `{ exact: number }`, `{ greaterThan: number }`, or `{ lessThan: number }`.
     */
    async verifyCount(pageName: string, elementName: string, options: CountVerifyOptions): Promise<void> {
        log.verify('Verifying count for "%s" in "%s" with options: %O', elementName, pageName, options);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.count(locator, options);
    }

    /**
     * Asserts that all image elements matching the locator have loaded successfully
     * (i.e. their `naturalWidth` is greater than 0).
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param scroll - Whether to scroll each image into view before checking. Defaults to `true`.
     */
    async verifyImages(pageName: string, elementName: string, scroll: boolean = true): Promise<void> {
        log.verify('Verifying images for "%s" in "%s" (scroll: %s)', elementName, pageName, scroll);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.images(locator, scroll);
    }

    /**
     * Asserts that an element's text content contains the specified substring.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param expectedText - The substring expected to be found within the element's text.
     */
    async verifyTextContains(pageName: string, elementName: string, expectedText: string): Promise<void> {
        log.verify('Verifying "%s" in "%s" contains text: "%s"', elementName, pageName, expectedText);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.textContains(locator, expectedText);
    }

    /**
     * Asserts that an element is in the specified state.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param state - The expected state: `'enabled'`, `'disabled'`, `'editable'`, `'checked'`,
     *   `'focused'`, `'visible'`, `'hidden'`, `'attached'`, or `'inViewport'`.
     * @param timeout - Optional timeout in milliseconds, overrides the default ELEMENT_TIMEOUT.
     */
    async verifyState(
        pageName: string,
        elementName: string,
        state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport',
        timeout?: number
    ): Promise<void> {
        log.verify('Verifying "%s" in "%s" is %s', elementName, pageName, state);
        const locatorString = await this.repo.getSelector(pageName, elementName);
        await this.verify.state(locatorString, state, timeout);
    }

    /**
     * Asserts that an element has a specific HTML attribute with the expected value.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param attributeName - The name of the HTML attribute to check (e.g. `'class'`, `'href'`, `'data-status'`).
     * @param expectedValue - The expected value of the attribute.
     */
    async verifyAttribute(pageName: string, elementName: string, attributeName: string, expectedValue: string): Promise<void> {
        log.verify('Verifying "%s" in "%s" has attribute "%s" = "%s"', elementName, pageName, attributeName, expectedValue);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.attribute(locator, attributeName, expectedValue);
    }

    /**
     * Asserts that the current page URL contains the specified substring.
     * Useful for verifying navigation outcomes without matching the full URL.
     * @param text - The substring expected to be found in the current URL (e.g. `'/dashboard'`).
     */
    async verifyUrlContains(text: string): Promise<void> {
        log.verify('Verifying current URL contains: "%s"', text);
        await this.verify.urlContains(text);
    }

    /**
     * Asserts that an input, textarea, or select element has the expected value.
     * Unlike `verifyText` which checks `textContent`, this checks the `value` property.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param expectedValue - The expected value of the input.
     */
    async verifyInputValue(pageName: string, elementName: string, expectedValue: string): Promise<void> {
        log.verify('Verifying input value of "%s" in "%s" matches: "%s"', elementName, pageName, expectedValue);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.inputValue(locator, expectedValue);
    }

    /**
     * Asserts the number of open browser tabs/pages matches the expected count.
     * @param expectedCount - The expected number of open tabs.
     */
    async verifyTabCount(expectedCount: number): Promise<void> {
        log.verify('Verifying tab count is %d', expectedCount);
        await this.verify.tabCount(expectedCount);
    }

    // ==========================================
    // 📋 LISTED ELEMENT STEPS
    // ==========================================

    /**
     * Clicks a specific element within a list (e.g. a table row, card, or list item)
     * identified by its visible text or an HTML attribute. Optionally drills into a
     * child element before clicking.
     *
     * The base locator is resolved from the repository using `pageName` and `elementName`,
     * then filtered using the criteria in `options` to find the exact match.
     *
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page (should resolve to a list of elements).
     * @param options - Match criteria: provide `text` to match by visible text, or `attribute` to match by an HTML
     *   attribute name-value pair. Optionally include `child` (a CSS selector string or a `{ pageName, elementName }`
     *   page-repository reference) to target a sub-element within the matched item.
     * @throws Error if neither `text` nor `attribute` is provided, or if no matching element is found.
     */
    async clickListedElement(pageName: string, elementName: string, options: ListedElementMatch): Promise<void> {
        log.interact('Clicking listed element in "%s" > "%s" with options: %O', pageName, elementName, options);
        const baseLocator = toLocator(await this.repo.get(this.page, pageName, elementName));
        const target = await this.interact.getListedElement(baseLocator, options, this.repo);
        await this.interact.click(target);
    }

    /**
     * Verifies a specific element within a list by checking its text content or an HTML attribute.
     * The element is first located by matching visible text or an attribute from the list,
     * then the assertion is performed on the resolved (and optionally child-targeted) element.
     *
     * Verification behavior is determined by the `options` fields:
     * - `expectedText` — asserts that the resolved element's text content matches this value.
     * - `expected` — asserts that the resolved element has the specified attribute name-value pair.
     * - If neither is provided, the method asserts that the matched element is visible.
     *
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page (should resolve to a list of elements).
     * @param options - Match and assertion criteria. Must include `text` or `attribute` for identification.
     *   Optionally include `child` to drill into a sub-element, and `expectedText` or `expected` for the assertion.
     * @throws Error if neither `text` nor `attribute` is provided, if the element is not found,
     *   or if the assertion fails.
     */
    async verifyListedElement(pageName: string, elementName: string, options: VerifyListedOptions): Promise<void> {
        log.verify('Verifying listed element in "%s" > "%s" with options: %O', pageName, elementName, options);
        const baseLocator = toLocator(await this.repo.get(this.page, pageName, elementName));
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
     * Extracts data from a specific element within a list — either its text content
     * or the value of a specified HTML attribute.
     *
     * The element is first located by matching visible text or an attribute from the list,
     * then data is extracted from the resolved (and optionally child-targeted) element.
     *
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page (should resolve to a list of elements).
     * @param options - Match and extraction criteria. Must include `text` or `attribute` for identification.
     *   Optionally include `child` to drill into a sub-element. If `extractAttribute` is set, that attribute's
     *   value is returned; otherwise the element's text content is returned.
     * @returns The extracted text content or attribute value, or `null` if unavailable.
     * @throws Error if neither `text` nor `attribute` is provided, or if the element is not found.
     */
    async getListedElementData(pageName: string, elementName: string, options: GetListedDataOptions): Promise<string | null> {
        log.extract('Extracting data from listed element in "%s" > "%s" with options: %O', pageName, elementName, options);
        const baseLocator = toLocator(await this.repo.get(this.page, pageName, elementName));
        const target = await this.interact.getListedElement(baseLocator, options, this.repo);

        if (options.extractAttribute) {
            return await this.extract.getAttribute(target, options.extractAttribute);
        }

        return await this.extract.getText(target);
    }

    // ==========================================
    // ⏳ WAIT STEPS
    // ==========================================

    /**
     * Waits for an element to reach the specified state before proceeding.
     * Useful for synchronizing tests with dynamic page content.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param state - The desired state to wait for: `'visible'` (default), `'attached'`, `'hidden'`, or `'detached'`.
     */
    async waitForState(
        pageName: string,
        elementName: string,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible'
    ): Promise<void> {
        log.wait('Waiting for "%s" in "%s" to be "%s"', elementName, pageName, state);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.utils.waitForState(locator, state);
    }

    /**
     * Types text into an input field one character at a time with a delay between keystrokes.
     * Useful for inputs with debounced search, autocomplete, or real-time validation
     * that require realistic keystroke timing.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param text - The text to type character by character.
     * @param delay - The delay in milliseconds between each keystroke. Defaults to `100`.
     */
    async typeSequentially(
        pageName: string,
        elementName: string,
        text: string,
        delay: number = 100
    ): Promise<void> {
        log.interact('Typing "%s" sequentially into "%s" in "%s" (delay: %dms)', text, elementName, pageName, delay);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.typeSequentially(locator, text, delay);
    }

    // ==========================================
    // 🧩 COMPOSITE / WORKFLOW STEPS
    // ==========================================

    /**
     * Fills multiple form fields on the same page in a single call.
     * Each key in the `fields` map is an `elementName` from the repository.
     * String values are filled into text inputs; `DropdownSelectOptions` values
     * trigger a dropdown selection.
     *
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param fields - A map of `elementName` → value. Use a string for text inputs
     *   or a `DropdownSelectOptions` object for `<select>` elements.
     *
     * @example
     * ```ts
     * await steps.fillForm('FormsPage', {
     *   nameInput: 'John Doe',
     *   emailInput: 'john@example.com',
     *   genderDropdown: { type: DropdownSelectType.VALUE, value: 'male' }
     * });
     * ```
     */
    async fillForm(pageName: string, fields: Record<string, FillFormValue>): Promise<void> {
        log.interact('Filling form on "%s" with %d fields', pageName, Object.keys(fields).length);
        for (const [elementName, value] of Object.entries(fields)) {
            if (typeof value === 'string') {
                await this.fill(pageName, elementName, value);
            } else {
                await this.selectDropdown(pageName, elementName, value);
            }
        }
    }

    /**
     * Waits until there are no in-flight network requests for at least 500ms.
     * Useful after actions that trigger background API calls, lazy loading, or analytics.
     */
    async waitForNetworkIdle(): Promise<void> {
        log.wait('Waiting for network idle');
        await this.navigate.waitForNetworkIdle();
    }

    /**
     * Executes an action and waits for a matching network response to complete.
     * The response is captured concurrently with the action to avoid race conditions.
     * @param urlPattern - A string substring or RegExp to match against the response URL.
     * @param action - An async function that triggers the network request (e.g. a form submit or click).
     * @returns The captured Playwright Response object.
     */
    async waitForResponse(urlPattern: string | RegExp, action: () => Promise<void>): Promise<Response> {
        log.wait('Waiting for response matching "%s"', urlPattern);
        return await this.navigate.waitForResponse(urlPattern, action);
    }

    /**
     * Retries an action until a verification passes, or until the maximum number of
     * attempts is reached. Useful for interactions with elements that may take multiple
     * attempts to succeed (e.g. flaky modals, race conditions with animations).
     *
     * @param action - An async function performing the interaction (e.g. a click).
     * @param verification - An async function performing the assertion. Must throw on failure.
     * @param maxRetries - Maximum number of retry attempts. Defaults to `3`.
     * @param delayMs - Milliseconds to wait between retry attempts. Defaults to `1000`.
     * @throws The last verification error if all retries are exhausted.
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

    /**
     * Clears the value of an input or textarea element without filling it with new text.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async clearInput(pageName: string, elementName: string): Promise<void> {
        log.interact('Clearing input "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.interact.clearInput(locator);
    }

    /**
     * Selects multiple options from a `<select multiple>` element by their `value` attributes.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param values - An array of `value` attribute strings to select simultaneously.
     * @returns An array of the actually selected `value` strings.
     */
    async selectMultiple(pageName: string, elementName: string, values: string[]): Promise<string[]> {
        log.interact('Selecting multiple values on "%s" in "%s": %O', elementName, pageName, values);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        return await this.interact.selectMultiple(locator, values);
    }

    /**
     * Waits for an element to reach a specific state, then clicks it.
     * Useful when an element exists in the DOM but is not yet interactive
     * (e.g. waiting for `'attached'` before clicking a lazily rendered button).
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param state - The state to wait for before clicking. Defaults to `'visible'`.
     */
    async waitAndClick(
        pageName: string,
        elementName: string,
        state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible'
    ): Promise<void> {
        log.interact('Waiting for "%s" in "%s" to be "%s", then clicking', elementName, pageName, state);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.utils.waitForState(locator, state);
        await this.interact.click(locator);
    }

    /**
     * Clicks the element at a specific zero-based index from all elements matching the locator.
     * Use this when elements cannot be distinguished by text or attributes and index is
     * the only reliable identifier.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param index - The zero-based index of the element to click.
     * @throws Error if no element exists at the specified index.
     */
    async clickNth(pageName: string, elementName: string, index: number): Promise<void> {
        log.interact('Clicking element at index %d of "%s" in "%s"', index, elementName, pageName);
        const element = await this.repo.getByIndex(this.page, pageName, elementName, index);
        if (!element) throw new Error(`No element at index ${index} for "${elementName}" in "${pageName}"`);
        await this.interact.click(toLocator(element));
    }

    // ==========================================
    // 📊 ADDITIONAL DATA EXTRACTION STEPS
    // ==========================================

    /**
     * Extracts text content or attribute values from all elements matching the locator.
     * Optionally drills into a child element within each match before extracting.
     *
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param options - Optional extraction configuration. Use `child` to drill into a sub-element,
     *   and `extractAttribute` to extract an attribute instead of text content.
     * @returns An array of extracted strings. Null attribute values are filtered out.
     *
     * @example
     * ```ts
     * // Get all name-column texts from table rows
     * const names = await steps.getAll('TablePage', 'rows', { child: 'td:nth-child(2)' });
     *
     * // Get all href attributes from links
     * const hrefs = await steps.getAll('LinksPage', 'links', { extractAttribute: 'href' });
     * ```
     */
    async getAll(pageName: string, elementName: string, options?: GetAllOptions): Promise<string[]> {
        log.extract('Extracting all from "%s" in "%s" with options: %O', elementName, pageName, options ?? 'text');
        let locator = toLocator(await this.repo.get(this.page, pageName, elementName));

        if (options?.child) {
            if (typeof options.child === 'string') {
                locator = locator.locator(options.child);
            } else {
                const childSelector = this.repo.getSelector(options.child.pageName, options.child.elementName);
                locator = locator.locator(childSelector);
            }
        }

        if (options?.extractAttribute) {
            const elements = await locator.all();
            const values = await Promise.all(elements.map(el => el.getAttribute(options.extractAttribute!)));
            return values.filter((v): v is string => v !== null);
        }

        return await this.extract.getAllTexts(locator);
    }

    /**
     * Returns the number of DOM elements matching the locator.
     * Unlike `verifyCount` which asserts, this returns the count for use in test logic.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @returns The count of matching elements.
     */
    async getCount(pageName: string, elementName: string): Promise<number> {
        log.extract('Getting count of "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        return await this.extract.getCount(locator);
    }

    /**
     * Retrieves the current value of an input, textarea, or select element.
     * Unlike `getText` which reads `textContent`, this reads the `value` property.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @returns The current value of the input.
     */
    async getInputValue(pageName: string, elementName: string): Promise<string> {
        log.extract('Getting input value of "%s" in "%s"', elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        return await this.extract.getInputValue(locator);
    }

    /**
     * Retrieves a computed CSS property value from an element.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param property - The CSS property name (e.g. `'color'`, `'font-size'`, `'display'`).
     * @returns The computed value as a string (e.g. `'rgb(255, 0, 0)'`, `'16px'`, `'block'`).
     */
    async getCssProperty(pageName: string, elementName: string, property: string): Promise<string> {
        log.extract('Getting CSS "%s" from "%s" in "%s"', property, elementName, pageName);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        return await this.extract.getCssProperty(locator, property);
    }

    // ==========================================
    // ✅ ADDITIONAL VERIFICATION STEPS
    // ==========================================

    /**
     * Asserts that the text contents of all elements matching the locator appear
     * in the exact order specified. Each element's text is compared against the
     * corresponding entry in the array.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param expectedTexts - The expected text values in their expected order.
     */
    async verifyOrder(pageName: string, elementName: string, expectedTexts: string[]): Promise<void> {
        log.verify('Verifying order of "%s" in "%s": %O', elementName, pageName, expectedTexts);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.order(locator, expectedTexts);
    }

    /**
     * Asserts that a computed CSS property of an element matches the expected value.
     * Values are in their computed form (e.g. `'rgb(255, 0, 0)'` not `'red'`).
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param property - The CSS property name (e.g. `'color'`, `'font-size'`, `'display'`).
     * @param expectedValue - The expected computed value.
     */
    async verifyCssProperty(pageName: string, elementName: string, property: string, expectedValue: string): Promise<void> {
        log.verify('Verifying CSS "%s" of "%s" in "%s" = "%s"', property, elementName, pageName, expectedValue);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.cssProperty(locator, property, expectedValue);
    }


    /**
     * Asserts that the text contents of all elements matching the locator are sorted
     * in the specified direction using locale-aware string comparison.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param direction - `'asc'` for ascending (A→Z) or `'desc'` for descending (Z→A).
     */
    async verifyListOrder(pageName: string, elementName: string, direction: 'asc' | 'desc'): Promise<void> {
        log.verify('Verifying "%s" in "%s" is sorted %s', elementName, pageName, direction);
        const locator = toLocator(await this.repo.get(this.page, pageName, elementName));
        await this.verify.listOrder(locator, direction);
    }

    // ==========================================
    // 📸 SCREENSHOT
    // ==========================================

    /**
     * Captures a screenshot of the full page or a specific element.
     *
     * @param pageNameOrOptions - Either a page name string (for element screenshots)
     *   or `ScreenshotOptions` (for page screenshots), or omitted entirely for a default page screenshot.
     * @param elementName - The element name (required when first arg is a page name).
     * @param options - Optional screenshot configuration.
     * @returns The screenshot image as a Buffer.
     *
     * @example
     * ```ts
     * // Full page screenshot
     * await steps.screenshot();
     * await steps.screenshot({ fullPage: true, path: 'full-page.png' });
     *
     * // Element screenshot
     * await steps.screenshot('PageName', 'elementName');
     * await steps.screenshot('PageName', 'elementName', { path: 'element.png' });
     * ```
     */
    async screenshot(pageNameOrOptions?: string | ScreenshotOptions, elementName?: string, options?: ScreenshotOptions): Promise<Buffer> {
        if (typeof pageNameOrOptions === 'string' && elementName) {
            log.extract('Taking screenshot of "%s" in "%s"', elementName, pageNameOrOptions);
            const locator = toLocator(await this.repo.get(this.page, pageNameOrOptions, elementName));
            return await this.extract.screenshot(locator, options);
        }

        const opts = typeof pageNameOrOptions === 'object' ? pageNameOrOptions : options;
        log.extract('Taking page screenshot');
        return await this.extract.screenshot(undefined, opts);
    }

    // ==========================================
    // 📧 EMAIL STEPS
    // ==========================================

    /**
     * Sends an email using the configured SMTP credentials.
     * @param options - The email configuration (to, subject, text, html, or htmlFile).
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
     * @returns The matched email, including its downloaded file path and content.
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
     * Deletes emails from the inbox. If filters are provided, only matching emails are deleted.
     * Otherwise, the entire inbox is cleared.
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
     * Marks emails in the mailbox with a specific action (READ, UNREAD, FLAGGED, UNFLAGGED, or ARCHIVED).
     * @param action - The marking action to apply (e.g., EmailMarkAction.READ, EmailMarkAction.FLAGGED, etc.).
     * @param options - Optional options to target specific emails with filters.
     * @returns The number of emails successfully marked.
     *
     * @example
     * ```ts
     * // Mark all OTP emails as read
     * await steps.markEmail('markEmailsAsRead', EmailMarkAction.READ, {
     *   filters: [{ type: EmailFilterType.SUBJECT, value: 'OTP' }]
     * });
     *
     * // Mark all emails as unread
     * await steps.markEmail('markEmailsAsUnread', EmailMarkAction.UNREAD);
     *
     * // Mark specific emails as flagged
     * await steps.markEmail('flagImportantEmails', EmailMarkAction.FLAGGED, {
     *   filters: [{ type: EmailFilterType.FROM, value: 'noreply@example.com' }]
     * });
     *
     * // Archive emails matching a filter
     * await steps.markEmail('archiveEmails', EmailMarkAction.ARCHIVED, {
     *   filters: [{ type: EmailFilterType.SUBJECT, value: 'Report' }]
     * });
     * ```
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