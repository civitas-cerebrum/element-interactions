import { Page, Locator } from '@playwright/test';

export interface DropdownSelectOptions {
    type?: 'random' | 'index' | 'value';
    value?: string;
    index?: number;
}

export class Interactions {
    constructor(private page: Page) {}

    async click(locator: Locator): Promise<void> {
        await locator.click();
    }

    async clickWithoutScrolling(locator: Locator): Promise<void> {
        await locator.dispatchEvent('click');
    }

    async clickIfPresent(locator: Locator): Promise<void> {
        if (await locator.isVisible()) {
            await locator.click();
        } else {
            console.log(`[Action] -> Locator was not visible. Skipping click.`);
        }
    }

    async fill(locator: Locator, text: string): Promise<void> {
        await locator.fill(text);
    }

    async uploadFile(locator: Locator, filePath: string): Promise<void> {
        console.log(`[Action] -> Uploading file from path "${filePath}"`);
        await locator.setInputFiles(filePath);
    }

    // --- Unified Dropdown Interaction ---

    /**
     * Selects an option from a dropdown based on the specified type: 'random', 'index', or 'value'.
     * Defaults to 'random' if no options are provided.
     * Returns the selected value.
     */
    async selectDropdown(
        locator: Locator, 
        options: DropdownSelectOptions = { type: 'random' }
    ): Promise<string> {
        const type = options.type || 'random';

        if (type === 'value') {
            if (options.value === undefined) {
                throw new Error('[Action] Error -> "value" must be provided when type is "value".');
            }
            console.log(`[Action] -> Selecting option by value: "${options.value}"`);
            const selected = await locator.selectOption({ value: options.value });
            return selected[0];
        }

        if (type === 'index') {
            if (options.index === undefined) {
                throw new Error('[Action] Error -> "index" must be provided when type is "index".');
            }
            console.log(`[Action] -> Selecting option by index: ${options.index}`);
            const selected = await locator.selectOption({ index: options.index });
            return selected[0];
        }

        // Fallback to 'random' logic
        console.log(`[Action] -> Fetching enabled options for random selection...`);
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

        console.log(`[Action] -> Picked random option index ${randomIndex} with value: "${valueToSelect}"`);
        const selected = await locator.selectOption({ value: valueToSelect });
        
        return selected[0];
    }
}