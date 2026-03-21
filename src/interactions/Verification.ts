import { Page, expect, Locator } from '@playwright/test';
import { CountVerifyOptions, TextVerifyOptions } from '../enum/Options';

/**
 * The `Verifications` class provides a unified wrapper around Playwright's `expect` assertions.
 * It standardizes timeouts and includes advanced custom, robust verifications 
 * (like image decoding) to keep your test assertions clean and reliable.
 */
export class Verifications {
    /** The standard timeout applied to all verifications in this class. */
    private ELEMENT_TIMEOUT : number;

    /**
     * Initializes the Verifications class.
     * @param page - The current Playwright Page object.
     * @param timeout - Optional override for the default element timeout.
     */
    constructor(private page: Page, timeout: number = 30000) { 
        this.ELEMENT_TIMEOUT = timeout;
    }

    // ==========================================
    // Standard Assertions
    // ==========================================

    /**
     * Asserts the text content of an element.
     * Can verify exact text matches or simply check that the element contains some text.
     * @param locator - The Playwright Locator pointing to the target element.
     * @param expectedText - The exact text string expected (optional if checking 'notEmpty').
     * @param options - Configuration to alter the verification behavior.
     */
    async text(locator: Locator, expectedText?: string, options?: TextVerifyOptions): Promise<void> {
        if (options?.notEmpty) {
            await expect(locator).not.toBeEmpty({ timeout: this.ELEMENT_TIMEOUT });
            return;
        }

        if (expectedText === undefined) {
            throw new Error(`You must provide either an 'expectedText' string or set '{ notEmpty: true }' in options.`);
        }

        await expect(locator).toHaveText(expectedText, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts that the specified element contains the expected substring.
     * @param locator - The Playwright Locator pointing to the target element.
     * @param expectedText - The substring expected to be present within the element's text.
     */
    async textContains(locator: Locator, expectedText: string): Promise<void> {
        await expect(locator).toContainText(expectedText, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts that the specified element is attached to the DOM and is visible.
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async presence(locator: Locator): Promise<void> {
        await expect(locator).toBeVisible({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts that the specified element is either hidden or completely detached from the DOM.
     * Accepts a Locator or a raw selector string to prevent unnecessary repository waits.
     * @param selectorOrLocator - The Playwright Locator or raw selector string.
     */
    async absence(selectorOrLocator: Locator | string): Promise<void> {
        const locator = typeof selectorOrLocator === 'string'
            ? this.page.locator(selectorOrLocator)
            : selectorOrLocator;

        await expect(locator).toBeHidden({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts the state of an element using Playwright's built-in locator assertions.
     * @param locator - The Playwright Locator pointing to the target element.
     * @param state - The expected state to verify.
     */
    async state(locator: Locator, state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport'): Promise<void> {
        const timeout = this.ELEMENT_TIMEOUT;
        switch (state) {
            case 'enabled':    await expect(locator).toBeEnabled({ timeout }); break;
            case 'disabled':   await expect(locator).toBeDisabled({ timeout }); break;
            case 'editable':   await expect(locator).toBeEditable({ timeout }); break;
            case 'checked':    await expect(locator).toBeChecked({ timeout }); break;
            case 'focused':    await expect(locator).toBeFocused({ timeout }); break;
            case 'visible':    await expect(locator).toBeVisible({ timeout }); break;
            case 'hidden':     await expect(locator).toBeHidden({ timeout }); break;
            case 'attached':   await expect(locator).toBeAttached({ timeout }); break;
            case 'inViewport': await expect(locator).toBeInViewport({ timeout }); break;
        }
    }

    /**
     * Asserts that the current browser URL contains the expected substring.
     * Evaluates using a case-insensitive regular expression.
     * @param text - The substring expected to be present within the active URL.
     */
    async urlContains(text: string): Promise<void> {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await expect(this.page).toHaveURL(new RegExp(escaped, 'i'), { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts that an element has a specific HTML attribute with an exact value.
     * @param locator - The Playwright Locator pointing to the target element.
     * @param attributeName - The name of the HTML attribute to check (e.g., 'href', 'class', 'alt').
     * @param expectedValue - The exact expected value of the attribute.
     */
    async attribute(locator: Locator, attributeName: string, expectedValue: string): Promise<void> {
        await expect(locator).toHaveAttribute(attributeName, expectedValue, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Performs a rigorous, multi-step verification on one or more images.
     * It checks for visibility, ensures a valid 'src' attribute exists, confirms the 
     * 'naturalWidth' is greater than 0, and evaluates the browser's native `decode()` 
     * promise to guarantee the image is fully rendered and not a broken link.
     * @param imagesLocator - The Playwright Locator pointing to the image element(s).
     * @param scroll - Whether to smoothly scroll the image(s) into the viewport before verifying (default: true).
     * @throws Will throw an error if no images are found matching the locator or if any image fails to decode.
     */
    async images(imagesLocator: Locator, scroll: boolean = true): Promise<void> {
        const productImages = await imagesLocator.all();

        if (productImages.length === 0) {
            throw new Error(`No images found for '${imagesLocator}'.`);
        }

        for (let i = 0; i < productImages.length; i++) {
            const productImage = productImages[i];

            if (scroll) {
                await productImage.scrollIntoViewIfNeeded().catch(() => { });
            }

            await expect(productImage).toBeVisible({ timeout: this.ELEMENT_TIMEOUT });
            await expect(productImage).toHaveAttribute('src', /.+/, { timeout: this.ELEMENT_TIMEOUT });
            await expect(productImage).not.toHaveJSProperty('naturalWidth', 0, { timeout: this.ELEMENT_TIMEOUT });

            const isDecoded = await productImage.evaluate(async (img: HTMLImageElement) => {
                if (!img.src) return false;
                try {
                    await img.decode();
                    return true;
                } catch {
                    return false;
                }
            });

            expect(isDecoded, `Image ${i + 1} failed to decode for ${imagesLocator}`).toBe(true);
        }
    }

    /**
    * Asserts the number of elements matching the locator based on the provided conditions.
    * @param locator - The Playwright Locator pointing to the target elements.
    * @param options - Configuration specifying 'exact', 'greaterThan', or 'lessThan' logic.
    */
    async count(locator: Locator, options: CountVerifyOptions): Promise<void> {
        if (options.exactly !== undefined && options.exactly < 0) {
            throw new Error(`'exact' count cannot be negative.`);
        }
        if (options.greaterThan !== undefined && options.greaterThan < 0) {
            throw new Error(`'greaterThan' count cannot be negative.`);
        }
        if (options.lessThan !== undefined && options.lessThan <= 0) {
            throw new Error(`'lessThan' must be greater than 0. Element counts cannot be negative.`);
        }

        if (options.exactly !== undefined) {
            await expect(locator).toHaveCount(options.exactly, { timeout: this.ELEMENT_TIMEOUT });
            return;
        }

        if (options.greaterThan === undefined && options.lessThan === undefined) {
            throw new Error(`You must provide 'exact', 'greaterThan', or 'lessThan' in CountVerifyOptions.`);
        }

        await expect.poll(async () => {
            const actualCount = await locator.count();
            if (options.greaterThan !== undefined && actualCount <= options.greaterThan) return false;
            if (options.lessThan !== undefined && actualCount >= options.lessThan) return false;
            return true;
        }, { timeout: this.ELEMENT_TIMEOUT, message: `Expected count${options.greaterThan !== undefined ? ` > ${options.greaterThan}` : ''}${options.lessThan !== undefined ? ` < ${options.lessThan}` : ''}` }).toBe(true);
    }
}