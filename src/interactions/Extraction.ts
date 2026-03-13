import { Page, Locator } from '@playwright/test';
import { Utils } from '../utils/ElementUtilities';

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
}