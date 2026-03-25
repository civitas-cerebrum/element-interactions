import { Page, Locator } from '@playwright/test';
import { Utils } from '../utils/ElementUtilities';
import { ScreenshotOptions } from '../enum/Options';

export class Extractions {
    private ELEMENT_TIMEOUT : number;
    private utils: Utils;

    /**
     * Initializes the Extractions class.
     * @param page - The current Playwright Page object.
     * @param timeout - Optional override for the default element timeout.
     */
    constructor(private page: Page, timeout: number = 30000) { 
        this.ELEMENT_TIMEOUT = timeout;
        this.utils = new Utils(this.ELEMENT_TIMEOUT);
    }

    /**
     * Safely retrieves and trims the text content of an element.
     * @param locator - The Playwright Locator pointing to the target element.
     * @returns The trimmed string, or an empty string if null.
     */
    async getText(locator: Locator): Promise<string | null> {
        await this.utils.waitForState(locator, 'attached');
        const text = await locator.textContent({ timeout: this.ELEMENT_TIMEOUT });
        return text?.trim() ?? null;
    }

    /**
     * Retrieves the value of a specified attribute (e.g., 'href', 'aria-pressed').
     * @param locator - The Playwright Locator pointing to the target element.
     * @param attributeName - The name of the attribute to retrieve.
     * @returns The attribute value as a string, or null if it doesn't exist.
     */
    async getAttribute(locator: Locator, attributeName: string): Promise<string | null> {
        await this.utils.waitForState(locator, 'attached');
        return await locator.getAttribute(attributeName, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Retrieves the trimmed text content of every element matching the locator.
     * @param locator - The Playwright Locator pointing to the target elements.
     * @returns An array of trimmed text strings, one per matching element.
     */
    async getAllTexts(locator: Locator): Promise<string[]> {
        const rawTexts = await locator.allTextContents();
        return rawTexts.map(t => t.trim());
    }

    /**
     * Retrieves the current value of an input, textarea, or select element.
     * Unlike `getText` which reads `textContent`, this reads the `value` property.
     * @param locator - The Playwright Locator pointing to the input element.
     * @returns The current value of the input.
     */
    async getInputValue(locator: Locator): Promise<string> {
        await this.utils.waitForState(locator, 'attached');
        return await locator.inputValue({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Returns the number of DOM elements matching the locator.
     * @param locator - The Playwright Locator pointing to the target elements.
     * @returns The count of matching elements.
     */
    async getCount(locator: Locator): Promise<number> {
        return await locator.count();
    }

    /**
     * Retrieves a computed CSS property value from an element via `getComputedStyle`.
     * @param locator - The Playwright Locator pointing to the target element.
     * @param property - The CSS property name (e.g. `'color'`, `'font-size'`, `'display'`).
     * @returns The computed value of the CSS property as a string.
     */
    async getCssProperty(locator: Locator, property: string): Promise<string> {
        await this.utils.waitForState(locator, 'attached');
        return await locator.evaluate(
            (el, prop) => window.getComputedStyle(el).getPropertyValue(prop),
            property
        );
    }

    /**
     * Captures a screenshot of the full page or a specific element.
     * @param locator - If provided, screenshots only this element. If omitted, screenshots the full page.
     * @param options - Optional configuration: `fullPage` for scrollable capture, `path` to save to disk.
     * @returns The screenshot image as a Buffer.
     */
    async screenshot(locator?: Locator, options?: ScreenshotOptions): Promise<Buffer> {
        if (locator) {
            return await locator.screenshot({ path: options?.path }) as Buffer;
        }
        return await this.page.screenshot({
            fullPage: options?.fullPage,
            path: options?.path,
        }) as Buffer;
    }
}