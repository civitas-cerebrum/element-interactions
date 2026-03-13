import { Page, Locator } from '@playwright/test';
import { DropdownSelectOptions, DropdownSelectType } from '../enum/Dropdown';

/**
 * The `Interactions` class provides a robust set of methods for interacting 
 * with DOM elements via Playwright Locators. It abstracts away common boilerplate 
 * and handles edge cases like overlapping elements or optional UI components.
 */
export class Interactions {
    private readonly ELEMENT_TIMEOUT = 30000;

    /**
     * Initializes the Interactions class.
     * @param page - The current Playwright Page object.
     */
    constructor(private page: Page) { }

    /**
     * Performs a standard Playwright click on the given locator.
     * Automatically waits for the element to be attached, visible, stable, and actionable.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async click(locator: Locator): Promise<void> {
        await locator.waitFor({ state: 'visible', timeout: this.ELEMENT_TIMEOUT });
        await locator.click({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Dispatches a native 'click' event directly to the element.
     * This bypasses Playwright's default scrolling and intersection observer checks.
     * Highly useful for clicking elements that might be artificially obscured by sticky headers or transparent overlays.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async clickWithoutScrolling(locator: Locator): Promise<void> {
        await locator.waitFor({ state: 'attached', timeout: this.ELEMENT_TIMEOUT });
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
            console.log(`[Action] -> Locator was not visible. Skipping click.`);
        }
    }

    /**
     * Clears any existing value in the target input field and types the provided text.
     * @param locator - The Playwright Locator pointing to the input element.
     * @param text - The string to type into the input field.
     */
    async fill(locator: Locator, text: string): Promise<void> {
        await locator.waitFor({ state: 'visible', timeout: this.ELEMENT_TIMEOUT });
        await locator.fill(text, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Uploads a local file to an `<input type="file">` element.
     * @param locator - The Playwright Locator pointing to the file input element.
     * @param filePath - The local file system path to the file you want to upload.
     */
    async uploadFile(locator: Locator, filePath: string): Promise<void> {
        await locator.waitFor({ state: 'attached', timeout: this.ELEMENT_TIMEOUT });
        console.log(`[Action] -> Uploading file from path "${filePath}"`);
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
        await locator.waitFor({ state: 'visible', timeout: this.ELEMENT_TIMEOUT });
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

        await enabledOptions.first().waitFor({ state: 'attached', timeout: this.ELEMENT_TIMEOUT }).catch(() => { });

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
        await locator.waitFor({ state: 'visible', timeout: this.ELEMENT_TIMEOUT });
        await locator.hover({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Scrolls the element into view if it is not already visible in the viewport.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async scrollIntoView(locator: Locator): Promise<void> {
        await locator.waitFor({ state: 'attached', timeout: this.ELEMENT_TIMEOUT });
        await locator.scrollIntoViewIfNeeded({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Safely retrieves and trims the text content of an element.
     * @param locator - The Playwright Locator pointing to the target element.
     * @returns The trimmed string, or an empty string if null.
     */
    async getText(locator: Locator): Promise<string> {
        await locator.waitFor({ state: 'attached', timeout: this.ELEMENT_TIMEOUT });
        const text = await locator.textContent({ timeout: this.ELEMENT_TIMEOUT });
        return text?.trim() ?? '';
    }

    /**
     * Retrieves the value of a specified attribute (e.g., 'href', 'aria-pressed').
     * @param locator - The Playwright Locator pointing to the target element.
     * @param attributeName - The name of the attribute to retrieve.
     * @returns The attribute value as a string, or null if it doesn't exist.
     */
    async getAttribute(locator: Locator, attributeName: string): Promise<string | null> {
        await locator.waitFor({ state: 'attached', timeout: this.ELEMENT_TIMEOUT });
        return await locator.getAttribute(attributeName, { timeout: this.ELEMENT_TIMEOUT });
    }
}