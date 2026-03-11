import { Page, Locator } from '@playwright/test';

/**
 * Defines the strategy for selecting an option from a dropdown element.
 */
export enum DropdownSelectType {
    /** Selects a completely random, non-disabled option with a valid value. */
    RANDOM = 'random',
    /** Selects an option based on its zero-based index in the dropdown. */
    INDEX = 'index',
    /** Selects an option based on its exact 'value' attribute. */
    VALUE = 'value'
}

/**
 * Configuration options for the `selectDropdown` method.
 */
export interface DropdownSelectOptions {
    /** The selection strategy to use. Defaults to RANDOM. */
    type?: DropdownSelectType;
    /** The specific value attribute to select (Required if type is VALUE). */
    value?: string;
    /** The index of the option to select (Required if type is INDEX). */
    index?: number;
}

/**
 * The `Interactions` class provides a robust set of methods for interacting 
 * with DOM elements via Playwright Locators. It abstracts away common boilerplate 
 * and handles edge cases like overlapping elements or optional UI components.
 */
export class Interactions {
    
    /**
     * Initializes the Interactions class.
     * @param page - The current Playwright Page object.
     */
    constructor(private page: Page) {}

    /**
     * Performs a standard Playwright click on the given locator.
     * Automatically waits for the element to be attached, visible, stable, and actionable.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async click(locator: Locator): Promise<void> {
        await locator.click();
    }

    /**
     * Dispatches a native 'click' event directly to the element.
     * This bypasses Playwright's default scrolling and intersection observer checks.
     * Highly useful for clicking elements that might be artificially obscured by sticky headers or transparent overlays.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async clickWithoutScrolling(locator: Locator): Promise<void> {
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
            await locator.click();
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
        await locator.fill(text);
    }

    /**
     * Uploads a local file to an `<input type="file">` element.
     * @param locator - The Playwright Locator pointing to the file input element.
     * @param filePath - The local file system path to the file you want to upload.
     */
    async uploadFile(locator: Locator, filePath: string): Promise<void> {
        console.log(`[Action] -> Uploading file from path "${filePath}"`);
        await locator.setInputFiles(filePath);
    }

    /**
     * Unified method to interact with `<select>` dropdown elements based on the specified `DropdownSelectType`.
     * If no options are provided, it safely defaults to randomly selecting an enabled, non-empty option.
     * * @param locator - The Playwright Locator pointing to the `<select>` element.
     * @param options - Configuration specifying whether to select by 'random', 'index', or 'value'.
     * @returns A promise that resolves to the exact 'value' attribute of the newly selected option.
     * @throws Error if 'value' or 'index' is missing when their respective types are chosen, or if no enabled options exist.
     */
    async selectDropdown(
        locator: Locator, 
        options: DropdownSelectOptions = { type: DropdownSelectType.RANDOM }
    ): Promise<string> {
        const type = options.type ?? DropdownSelectType.RANDOM;

        if (type === DropdownSelectType.VALUE) {
            if (options.value === undefined) {
                throw new Error('[Action] Error -> "value" must be provided when using DropdownSelectType.VALUE.');
            }
            const selected = await locator.selectOption({ value: options.value });
            return selected[0];
        }

        if (type === DropdownSelectType.INDEX) {
            if (options.index === undefined) {
                throw new Error('[Action] Error -> "index" must be provided when using DropdownSelectType.INDEX.');
            }
            const selected = await locator.selectOption({ index: options.index });
            return selected[0];
        }

        const enabledOptions = locator.locator('option:not([disabled]):not([value=""])');
        const count = await enabledOptions.count();

        if (count === 0) {
            throw new Error('[Action] Error -> No enabled options found to select!');
        }

        const randomIndex = Math.floor(Math.random() * count);
        const valueToSelect = await enabledOptions.nth(randomIndex).getAttribute('value');

        if (valueToSelect === null) {
            throw new Error(`[Action] Error -> Option at index ${randomIndex} is missing a "value" attribute.`);
        }

        const selected = await locator.selectOption({ value: valueToSelect });
        
        return selected[0];
    }
}