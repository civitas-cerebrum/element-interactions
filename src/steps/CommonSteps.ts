import { Page } from '@playwright/test';
import { ElementRepository } from 'pw-element-repository';
import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { DropdownSelectOptions, TextVerifyOptions, CountVerifyOptions, DragAndDropOptions } from '../enum/Options';
import { logger } from '../logger/Logger';

const log = {
  navigate: logger('navigate'),
  interact: logger('interact'),
  extract:  logger('extract'),
  verify:   logger('verify'),
  wait:     logger('wait'),
};

/**
 * The `Steps` class serves as a unified Facade for test orchestration.
 * It combines element acquisition (via `pw-element-repository`) with
 * Playwright interactions, navigation, and verifications to keep test files clean,
 * readable, and free of raw locators.
 */
export class Steps {
    private interact;
    private navigate;
    private extract;
    private verify;
    private utils;

    /**
     * Initializes the Steps class with the required Playwright page and element repository.
     * @param page - The current Playwright Page object.
     * @param repo - An initialized instance of `ElementRepository` containing your locators.
     * @param timeout - Optional global timeout override (in milliseconds).
     */
    constructor(
        private page: Page,
        private repo: ElementRepository,
        timeout?: number
    ) {
        const interactions = new ElementInteractions(page, timeout);
        this.interact = interactions.interact;
        this.navigate = interactions.navigate;
        this.extract = interactions.extract;
        this.verify = interactions.verify;
        this.utils = interactions.utils;
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
     * @param direction - The direction to navigate: `'BACKWARDS'` or `'FORWARDS'`.
     */
    async backOrForward(direction: 'BACKWARDS' | 'FORWARDS'): Promise<void> {
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.getRandom(this.page, pageName, elementName);
        if (!locator) throw new Error(`No visible element found for "${elementName}" in "${pageName}"`);
        await this.interact.click(locator);
    }

    /**
     * Clicks on an element only if it is present in the DOM.
     * Does nothing if the element is not found — no error is thrown.
     * Useful for dismissing optional modals, banners, or cookie notices.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async clickIfPresent(pageName: string, elementName: string): Promise<void> {
        log.interact('Clicking on "%s" in "%s" (if present)', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.clickIfPresent(locator);
    }

    /**
     * Hovers over an element, triggering any hover-based UI effects (tooltips, menus, etc.).
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async hover(pageName: string, elementName: string): Promise<void> {
        log.interact('Hovering over "%s" in "%s"', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.hover(locator);
    }

    /**
     * Scrolls the specified element into the visible viewport.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     */
    async scrollIntoView(pageName: string, elementName: string): Promise<void> {
        log.interact('Scrolling "%s" in "%s" into view', elementName, pageName);
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.getByText(this.page, pageName, elementName, elementText);
        if (!locator) throw new Error(`No element with text "${elementText}" found for "${elementName}" in "${pageName}"`);
        await this.interact.dragAndDrop(locator, options);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.textContains(locator, expectedText);
    }

    /**
     * Asserts that an element is in the specified state.
     * @param pageName - The page name as defined in `page-repository.json`.
     * @param elementName - The element name as defined under the given page.
     * @param state - The expected state: `'enabled'`, `'disabled'`, `'editable'`, `'checked'`,
     *   `'focused'`, `'visible'`, `'hidden'`, `'attached'`, or `'inViewport'`.
     */
    async verifyState(pageName: string, elementName: string, state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport'): Promise<void> {
        log.verify('Verifying "%s" in "%s" is %s', elementName, pageName, state);
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.verify.state(locator, state);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
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
        const locator = await this.repo.get(this.page, pageName, elementName);
        await this.interact.typeSequentially(locator, text, delay);
    }
}