import { Page, Locator } from '@playwright/test';
import { DropdownSelectOptions, DropdownSelectType, DragAndDropOptions } from '../enum/Options';
import { Utils } from '../utils/ElementUtilities';
import { createLogger } from '../logger/Logger';

const log = createLogger('interactions');

/**
 * The `Interactions` class provides a robust set of methods for interacting 
 * with DOM elements via Playwright Locators. It abstracts away common boilerplate 
 * and handles edge cases like overlapping elements or optional UI components.
 */
export class Interactions {
    private ELEMENT_TIMEOUT : number;
    private utils: Utils;

    /**
     * Initializes the Interactions class.
     * @param page - The current Playwright Page object.
     * @param timeout - Optional override for the default element timeout.
     */
    constructor(private page: Page, timeout: number = 30000) { 
        this.ELEMENT_TIMEOUT = timeout;
        this.utils = new Utils(this.ELEMENT_TIMEOUT);
    }

    /**
     * Performs a standard Playwright click on the given locator.
     * Automatically waits for the element to be attached, visible, stable, and actionable.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async click(locator: Locator): Promise<void> {
        await this.utils.waitForState(locator, 'visible');
        await locator.click({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Dispatches a native 'click' event directly to the element.
     * This bypasses Playwright's default scrolling and intersection observer checks.
     * Highly useful for clicking elements that might be artificially obscured by sticky headers or transparent overlays.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async clickWithoutScrolling(locator: Locator): Promise<void> {
        await this.utils.waitForState(locator, 'attached');
        await locator.dispatchEvent('click');
    }

    /**
     * Checks if an element is visible before attempting to click it.
     * If the element is hidden or not in the DOM, it safely skips the action and logs a message 
     * without failing the test. Great for optional elements like cookie banners or promotional pop-ups.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async clickIfPresent(locator: Locator): Promise<void> {
        if (await locator.isVisible()) {
            await locator.click({ timeout: this.ELEMENT_TIMEOUT });
        } else {
            log('Locator was not visible, skipping click');
        }
    }

    /**
     * Clears any existing value in the target input field and types the provided text.
     * @param locator - The Playwright Locator pointing to the input element.
     * @param text - The string to type into the input field.
     */
    async fill(locator: Locator, text: string): Promise<void> {
        await this.utils.waitForState(locator, 'visible');
        await locator.fill(text, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Uploads a local file to an `<input type="file">` element.
     * @param locator - The Playwright Locator pointing to the file input element.
     * @param filePath - The local file system path to the file you want to upload.
     */
    async uploadFile(locator: Locator, filePath: string): Promise<void> {
        await this.utils.waitForState(locator, 'attached');
        log('Uploading file from path "%s"', filePath);
        await locator.setInputFiles(filePath, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Unified method to interact with `<select>` dropdown elements based on the specified `DropdownSelectType`.
     * If no options are provided, it safely defaults to randomly selecting an enabled, non-empty option.
     * @param locator - The Playwright Locator pointing to the `<select>` element.
     * @param options - Configuration specifying whether to select by 'random', 'index', or 'value'.
     * @returns A promise that resolves to the exact 'value' attribute of the newly selected option.
     * @throws Error if 'value' or 'index' is missing when their respective types are chosen, or if no enabled options exist.
     */
    async selectDropdown(
        locator: Locator,
        options: DropdownSelectOptions = { type: DropdownSelectType.RANDOM }
    ): Promise<string> {
        await this.utils.waitForState(locator, 'visible');
        const type = options.type ?? DropdownSelectType.RANDOM;

        if (type === DropdownSelectType.VALUE) {
            if (options.value === undefined) {
                throw new Error('[Action] Error -> "value" must be provided when using DropdownSelectType.VALUE.');
            }
            const selected = await locator.selectOption({ value: options.value }, { timeout: this.ELEMENT_TIMEOUT });
            return selected[0];
        }

        if (type === DropdownSelectType.INDEX) {
            if (options.index === undefined) {
                throw new Error('[Action] Error -> "index" must be provided when using DropdownSelectType.INDEX.');
            }
            const selected = await locator.selectOption({ index: options.index }, { timeout: this.ELEMENT_TIMEOUT });
            return selected[0];
        }

        const enabledOptions = locator.locator('option:not([disabled]):not([value=""])');

        await this.utils.waitForState(enabledOptions.first(), 'attached').catch(() => { });

        const count = await enabledOptions.count();

        if (count === 0) {
            throw new Error('[Action] Error -> No enabled options found to select!');
        }

        const randomIndex = Math.floor(Math.random() * count);
        const valueToSelect = await enabledOptions.nth(randomIndex).getAttribute('value', { timeout: this.ELEMENT_TIMEOUT });

        if (valueToSelect === null) {
            throw new Error(`[Action] Error -> Option at index ${randomIndex} is missing a "value" attribute.`);
        }

        const selected = await locator.selectOption({ value: valueToSelect }, { timeout: this.ELEMENT_TIMEOUT });

        return selected[0];
    }

    /**
     * Hovers over the specified element. Useful for triggering dropdowns or tooltips.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async hover(locator: Locator): Promise<void> {
        await this.utils.waitForState(locator, 'visible');
        await locator.hover({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Scrolls the element into view if it is not already visible in the viewport.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async scrollIntoView(locator: Locator): Promise<void> {
        await this.utils.waitForState(locator, 'attached');
        await locator.scrollIntoViewIfNeeded({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
    * Drags an element either to a specified target element, a target element with an offset, or by a coordinate offset.
    * @param locator - The Playwright Locator pointing to the element to drag.
    * @param options - Configuration specifying a 'targetLocator', offsets, or both.
    */
    async dragAndDrop(locator: Locator, options: DragAndDropOptions): Promise<void> {
        await this.utils.waitForState(locator, 'visible');

        if (options.target) {
            await this.utils.waitForState(options.target, 'visible');

            if (options.xOffset !== undefined && options.yOffset !== undefined) {
                const targetBox = await options.target.boundingBox();
                if (!targetBox) {
                    throw new Error(`[Action] Error -> Unable to get bounding box for target element.`);
                }

                const targetPosition = {
                    x: (targetBox.width / 2) + options.xOffset,
                    y: (targetBox.height / 2) + options.yOffset
                };

                await locator.dragTo(options.target, {
                    targetPosition,
                    timeout: this.ELEMENT_TIMEOUT
                });
                return;
            }

            await locator.dragTo(options.target, { timeout: this.ELEMENT_TIMEOUT });
            return;
        }

        if (options.xOffset !== undefined && options.yOffset !== undefined) {
            const box = await locator.boundingBox();
            if (!box) {
                throw new Error(`[Action] Error -> Unable to get bounding box for element to perform drag action.`);
            }

            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;

            await this.page.mouse.move(startX, startY);
            await this.page.mouse.down();

            await this.page.mouse.move(startX + options.xOffset, startY + options.yOffset, { steps: 10 });
            await this.page.mouse.up();
            return;
        }

        throw new Error(`[Action] Error -> You must provide either 'targetLocator', or both 'xOffset' and 'yOffset' in DragAndDropOptions.`);
    }

    /**
       * Filters a locator list and returns the first element that contains the specified text.
       * If the element is not found, it prints the available text contents of the base locator for debugging.
       * @param baseLocator The base Playwright Locator.
       * @param pageName The name of the page block in the JSON repository.
       * @param elementName The specific element name to look up.
       * @param desiredText The string of text to search for within the elements.
       * @param strict If true, throws an error if the element is not found. Defaults to false.
       * @returns A promise that resolves to the matched Playwright Locator, or null if not found.
       */
    public async getByText(
        baseLocator: Locator,
        pageName: string,
        elementName: string,
        desiredText: string,
        strict: boolean = false
    ): Promise<ReturnType<Page['locator']> | null> {
        const locator = baseLocator.filter({ hasText: desiredText }).first();

        if ((await locator.count()) === 0) {
            const rawTexts = await baseLocator.allInnerTexts();

            const availableTexts = rawTexts
                .map((text: string) => text.trim())
                .filter((text: string) => text.length > 0);

            const msg = `Element '${elementName}' on '${pageName}' with text "${desiredText}" not found.\nAvailable texts found in locator: ${availableTexts.length > 0 ? `\n- ${availableTexts.join('\n- ')}` : 'None (Base locator found no elements or elements had no text)'}`;

            if (strict) throw new Error(msg);
            log('⚠ %s', msg);
            return null;
        }

        return locator;
    }

    /**
     * Types into the target element character by character with a specified delay.
     * Use this for OTP inputs, search-as-you-type fields, or when `fill()` 
     * doesn't trigger necessary keyboard events (like 'keyup' or 'keydown').
     * @param locator - The Playwright Locator pointing to the input element.
     * @param text - The string of text to type sequentially.
     * @param delay - Time in milliseconds to wait between key presses. Defaults to 100ms.
     */
    async typeSequentially(locator: Locator, text: string, delay: number = 100): Promise<void> {
        await this.utils.waitForState(locator, 'visible');
        await locator.pressSequentially(text, { 
            delay, 
            timeout: this.ELEMENT_TIMEOUT 
        });
    }
}