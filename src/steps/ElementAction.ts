import { Locator } from '@playwright/test';
import { ElementRepository, Element, WebElement, ElementResolutionOptions, SelectionStrategy } from '@civitas-cerebrum/element-repository';
import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { DropdownSelectOptions, TextVerifyOptions, CountVerifyOptions, DragAndDropOptions, ScreenshotOptions, IsVisibleOptions } from '../enum/Options';

function toLocator(element: Element): Locator {
    return (element as WebElement).locator;
}

/**
 * Fluent builder for performing actions on a repository element.
 *
 * Usage:
 * ```ts
 * await steps.on('submitButton', 'LoginPage').click();
 * await steps.on('navItems', 'HomePage').random().hover();
 * await steps.on('productCards', 'CollectionsPage').nth(2).getText();
 * ```
 */
export class ElementAction {
    private resolutionOptions: ElementResolutionOptions = {};
    private timeout: number;
    private conditionalVisible: boolean = false;
    private visibilityTimeout: number = 2000;

    constructor(
        private repo: ElementRepository,
        private elementName: string,
        private pageName: string,
        private interactions: ElementInteractions,
        private timeoutMs?: number,
    ) {
        this.timeout = timeoutMs ?? 30000;
    }

    // -- Strategy selectors --

    /** Select the first matching element (default behavior). */
    first(): this {
        this.resolutionOptions = {};
        return this;
    }

    /** Select a random matching element. */
    random(): this {
        this.resolutionOptions = { strategy: SelectionStrategy.RANDOM };
        return this;
    }

    /** Select the element at the given zero-based index. */
    nth(index: number): this {
        this.resolutionOptions = { strategy: SelectionStrategy.INDEX, index };
        return this;
    }

    /** Select the first element matching the given text content. */
    byText(text: string): this {
        this.resolutionOptions = { strategy: SelectionStrategy.TEXT, value: text };
        return this;
    }

    /** Select the first element matching the given attribute name-value pair. */
    byAttribute(name: string, value: string): this {
        this.resolutionOptions = { strategy: SelectionStrategy.ATTRIBUTE, attribute: name, value };
        return this;
    }

    /**
     * Makes all subsequent actions conditional on visibility.
     * If the element is not visible within the timeout, actions silently skip
     * instead of throwing. Returns `this` for chaining.
     *
     * @param timeout - Max wait in ms to check visibility. Defaults to `2000`.
     *
     * @example
     * ```ts
     * await steps.on('cookieBanner', 'Page').ifVisible().click();
     * await steps.on('promoPopup', 'Page').ifVisible(500).click();
     * ```
     */
    ifVisible(timeout?: number): this {
        this.conditionalVisible = true;
        if (timeout !== undefined) this.visibilityTimeout = timeout;
        return this;
    }

    // -- Internal helpers --

    /**
     * Checks the ifVisible condition. Returns `true` if the action should proceed,
     * `false` if it should be skipped.
     */
    private async shouldProceed(): Promise<boolean> {
        if (!this.conditionalVisible) return true;
        try {
            const locator = await this.resolveLocator();
            await locator.waitFor({ state: 'visible', timeout: this.visibilityTimeout });
            return true;
        } catch {
            return false;
        }
    }

    private async resolve(): Promise<Element> {
        return this.repo.get(this.elementName, this.pageName, this.resolutionOptions);
    }

    private async resolveLocator(): Promise<Locator> {
        return toLocator(await this.resolve());
    }

    // -- Terminal actions: interactions --

    /** Click the resolved element. Skips silently if `ifVisible()` was set and element is hidden. */
    async click(options?: { withoutScrolling?: boolean; force?: boolean }): Promise<void> {
        if (!await this.shouldProceed()) return;
        const locator = toLocator(await this.resolve());
        await this.interactions.interact.click(locator, {
            withoutScrolling: options?.withoutScrolling,
            force: options?.force,
        });
    }

    /** Click the resolved element if present. Returns `true` if clicked, `false` if skipped. */
    async clickIfPresent(options?: { withoutScrolling?: boolean; force?: boolean }): Promise<boolean> {
        const element = await this.resolve();
        if (await element.isVisible()) {
            const locator = toLocator(element);
            await this.interactions.interact.click(locator, {
                withoutScrolling: options?.withoutScrolling,
                ifPresent: true,
                force: options?.force,
            });
            return true;
        }
        return false;
    }

    /** Hover over the resolved element. Skips silently if `ifVisible()` was set and element is hidden. */
    async hover(): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this.timeout).hover();
    }

    /** Clear and fill the resolved element with text. Skips silently if `ifVisible()` was set and element is hidden. */
    async fill(text: string): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this.timeout).fill(text);
    }

    /** Scroll the resolved element into view. Skips silently if `ifVisible()` was set and element is hidden. */
    async scrollIntoView(): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this.timeout).scrollIntoView();
    }

    /** Select a dropdown option. */
    async selectDropdown(options?: DropdownSelectOptions): Promise<string> {
        const locator = await this.resolveLocator();
        return await this.interactions.interact.selectDropdown(locator, options);
    }

    /** Check a checkbox or radio button. Skips silently if `ifVisible()` was set and element is hidden. */
    async check(): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this.timeout).check();
    }

    /** Uncheck a checkbox. Skips silently if `ifVisible()` was set and element is hidden. */
    async uncheck(): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this.timeout).uncheck();
    }

    /** Double-click the resolved element. */
    async doubleClick(): Promise<void> {
        const element = await this.resolve();
        await element.action(this.timeout).doubleClick();
    }

    /** Right-click the resolved element. */
    async rightClick(): Promise<void> {
        const element = await this.resolve();
        await this.interactions.interact.rightClick(element);
    }

    /** Type text character by character. */
    async typeSequentially(text: string, delay?: number): Promise<void> {
        const element = await this.resolve();
        await element.action(this.timeout).pressSequentially(text, delay);
    }

    /** Upload a file to a file input. */
    async uploadFile(filePath: string): Promise<void> {
        const locator = await this.resolveLocator();
        await this.interactions.interact.uploadFile(locator, filePath);
    }

    /** Drag and drop the resolved element. */
    async dragAndDrop(options: DragAndDropOptions): Promise<void> {
        const locator = await this.resolveLocator();
        await this.interactions.interact.dragAndDrop(locator, options);
    }

    /** Clear the input value. */
    async clearInput(): Promise<void> {
        const element = await this.resolve();
        await element.action(this.timeout).clear();
    }

    /** Set slider value. */
    async setSliderValue(value: number): Promise<void> {
        const locator = await this.resolveLocator();
        await this.interactions.interact.setSliderValue(locator, value);
    }

    /** Select multiple options from a multi-select. */
    async selectMultiple(values: string[]): Promise<string[]> {
        const locator = await this.resolveLocator();
        return await this.interactions.interact.selectMultiple(locator, values);
    }

    // -- Terminal actions: verifications --

    /** Assert the element is visible. */
    async verifyPresence(): Promise<void> {
        const element = await this.resolve();
        await element.action(this.timeout).verifyPresence();
    }

    /** Assert the element is hidden or detached. */
    async verifyAbsence(): Promise<void> {
        const element = await this.resolve();
        await element.action(this.timeout).verifyAbsence();
    }

    /** Assert the element's text content. If no expected text is given, asserts the element is not empty. */
    async verifyText(expected?: string, options?: TextVerifyOptions): Promise<void> {
        const notEmpty = options?.notEmpty || expected === undefined;
        const locator = await this.resolveLocator();
        await this.interactions.verify.text(locator, expected, notEmpty ? { notEmpty: true } : options);
    }

    /** Assert text contains a substring. */
    async verifyTextContains(expected: string): Promise<void> {
        const element = await this.resolve();
        await element.action(this.timeout).verifyTextContains(expected);
    }

    /** Assert the element count. */
    async verifyCount(options: CountVerifyOptions): Promise<void> {
        const element = await this.resolve();
        await element.action(this.timeout).verifyCount(options);
    }

    /** Check if element is visible (boolean, no assertion). */
    async isPresent(): Promise<boolean> {
        try {
            const element = await this.resolve();
            return await element.action(this.timeout).isPresent();
        } catch {
            return false;
        }
    }

    /**
     * Non-throwing visibility probe with optional text filtering and custom timeout.
     * Returns `true` if the element is visible (and matches text if specified), `false` otherwise.
     */
    async isVisible(options?: IsVisibleOptions): Promise<boolean> {
        const timeout = options?.timeout ?? 2000;
        try {
            const locator = await this.resolveLocator();
            await locator.waitFor({ state: 'visible', timeout });
            if (options?.containsText) {
                const text = await locator.textContent({ timeout }).catch(() => null);
                return text !== null && text.includes(options.containsText);
            }
            return true;
        } catch {
            return false;
        }
    }

    /** Assert an attribute value. */
    async verifyAttribute(attributeName: string, expectedValue: string): Promise<void> {
        const element = await this.resolve();
        await element.action(this.timeout).verifyAttribute(attributeName, expectedValue);
    }

    /** Assert input value. */
    async verifyInputValue(expectedValue: string): Promise<void> {
        const locator = await this.resolveLocator();
        await this.interactions.verify.inputValue(locator, expectedValue);
    }

    /** Verify images loaded correctly. */
    async verifyImages(scroll: boolean = true): Promise<void> {
        const locator = await this.resolveLocator();
        await this.interactions.verify.images(locator, scroll);
    }

    /** Assert element state. */
    async verifyState(state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport'): Promise<void> {
        const selector = this.repo.getSelector(this.elementName, this.pageName);
        await this.interactions.verify.state(selector, state);
    }

    /** Assert CSS property value. */
    async verifyCssProperty(property: string, expectedValue: string): Promise<void> {
        const locator = await this.resolveLocator();
        await this.interactions.verify.cssProperty(locator, property, expectedValue);
    }

    /** Assert elements are in the expected text order. */
    async verifyOrder(expectedTexts: string[]): Promise<void> {
        const locator = await this.resolveLocator();
        await this.interactions.verify.order(locator, expectedTexts);
    }

    /** Assert list is sorted. */
    async verifyListOrder(direction: 'asc' | 'desc'): Promise<void> {
        const locator = await this.resolveLocator();
        await this.interactions.verify.listOrder(locator, direction);
    }

    // -- Terminal actions: extractions --

    /** Get the text content of the resolved element. */
    async getText(): Promise<string | null> {
        const element = await this.resolve();
        return element.action(this.timeout).getText();
    }

    /** Get an attribute value. */
    async getAttribute(name: string): Promise<string | null> {
        const element = await this.resolve();
        return element.action(this.timeout).getAttribute(name);
    }

    /** Get the count of matching elements. */
    async getCount(): Promise<number> {
        const element = await this.resolve();
        return element.action(this.timeout).getCount();
    }

    /** Get all text contents from matching elements. */
    async getAllTexts(): Promise<string[]> {
        const locator = await this.resolveLocator();
        return await this.interactions.extract.getAllTexts(locator);
    }

    /** Get input value. */
    async getInputValue(): Promise<string> {
        const element = await this.resolve();
        return element.action(this.timeout).getInputValue();
    }

    /** Get computed CSS property value. */
    async getCssProperty(property: string): Promise<string> {
        const element = await this.resolve();
        return await this.interactions.extract.getCssProperty(element, property);
    }

    /** Take a screenshot of the element. */
    async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
        const locator = await this.resolveLocator();
        return await this.interactions.extract.screenshot(locator, options);
    }

    // -- Terminal actions: waiting --

    /** Wait for the element to reach the specified state. */
    async waitForState(state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible'): Promise<void> {
        const element = await this.resolve();
        await element.action(this.timeout).waitForState(state);
    }
}
