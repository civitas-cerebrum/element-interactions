import { Page, expect, Locator } from '@playwright/test';
import { CountVerifyOptions, TextVerifyOptions } from '../enum/Options';

/**
 * The `Verifications` class provides a unified wrapper around Playwright's `expect` assertions.
 * It standardizes timeouts and includes advanced custom, robust verifications 
 * (like image decoding) to keep your test assertions clean and reliable.
 */
export class Verifications {
    /** The standard timeout applied to all verifications in this class. */
    private readonly ELEMENT_TIMEOUT = 30000;

    /**
     * Initializes the Verifications class.
     * @param page - The current Playwright Page object.
     */
    constructor(private page: Page) { }

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
            throw new Error(`[Verify] -> You must provide either an 'expectedText' string or set '{ notEmpty: true }' in options.`);
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
     * @param locator - The Playwright Locator pointing to the target element.
     */
    async absence(locator: Locator): Promise<void> {
        await expect(locator).toBeHidden({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts the interactive state of an element (whether it is enabled or disabled).
     * Useful for checking buttons or input fields.
     * @param locator - The Playwright Locator pointing to the target element.
     * @param state - The expected state: either 'enabled' or 'disabled'.
     */
    async state(locator: Locator, state: 'enabled' | 'disabled'): Promise<void> {
        if (state === 'enabled') {
            await expect(locator).toBeEnabled({ timeout: this.ELEMENT_TIMEOUT });
        } else {
            await expect(locator).toBeDisabled({ timeout: this.ELEMENT_TIMEOUT });
        }
    }

    /**
     * Asserts that the current browser URL contains the expected substring.
     * Evaluates using a case-insensitive regular expression.
     * @param text - The substring expected to be present within the active URL.
     */
    async urlContains(text: string): Promise<void> {
        await expect(this.page).toHaveURL(new RegExp(text, 'i'), { timeout: this.ELEMENT_TIMEOUT });
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
            throw new Error(`[Verify] -> No images found for '${imagesLocator}'.`);
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
        if (options.exact !== undefined && options.exact < 0) {
            throw new Error(`[Verify] -> 'exact' count cannot be negative.`);
        }
        if (options.greaterThan !== undefined && options.greaterThan < 0) {
            throw new Error(`[Verify] -> 'greaterThan' count cannot be negative.`);
        }
        if (options.lessThan !== undefined && options.lessThan <= 0) {
            throw new Error(`[Verify] -> 'lessThan' must be greater than 0. Element counts cannot be negative.`);
        }

        if (options.exact !== undefined) {
            await expect(locator).toHaveCount(options.exact, { timeout: this.ELEMENT_TIMEOUT });
            return;
        }

        if (options.greaterThan === undefined && options.lessThan === undefined) {
            throw new Error(`[Verify] -> You must provide 'exact', 'greaterThan', or 'lessThan' in CountVerifyOptions.`);
        }

        await locator.first().waitFor({ state: 'attached', timeout: this.ELEMENT_TIMEOUT }).catch(() => { });
        const actualCount = await locator.count();

        if (options.greaterThan !== undefined) {
            expect(actualCount, `Expected count > ${options.greaterThan}, but got ${actualCount}`).toBeGreaterThan(options.greaterThan);
        }

        if (options.lessThan !== undefined) {
            expect(actualCount, `Expected count < ${options.lessThan}, but got ${actualCount}`).toBeLessThan(options.lessThan);
        }
    }
}