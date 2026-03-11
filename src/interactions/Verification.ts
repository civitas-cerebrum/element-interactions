import { Page, expect, Locator } from '@playwright/test';

/**
 * The `Verifications` class provides a unified wrapper around Playwright's `expect` assertions.
 * It standardizes timeouts, adds helpful logging, and includes advanced custom verifications 
 * (like image decoding) to keep your test assertions clean and reliable.
 */
export class Verifications {
    /** The standard timeout applied to all verifications in this class. */
    private readonly ELEMENT_TIMEOUT = 10000;

    /**
     * Initializes the Verifications class.
     * @param page - The current Playwright Page object.
     */
    constructor(private page: Page) {}

    /**
     * Asserts that the specified element's text exactly matches the expected text.
     * @param locator - The Playwright Locator pointing to the target element.
     * @param expectedText - The exact text string expected to be inside the element.
     */
    async text(locator: Locator, expectedText: string): Promise<void> {
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
        console.log(`[Verify] -> Asserting absence of "${locator}"`);
        await expect(locator).toBeHidden({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts the interactive state of an element (whether it is enabled or disabled).
     * Useful for checking buttons or input fields.
     * @param locator - The Playwright Locator pointing to the target element.
     * @param state - The expected state: either 'enabled' or 'disabled'.
     */
    async state(locator: Locator, state: 'enabled' | 'disabled'): Promise<void> {
        console.log(`[Verify] -> Asserting state of "${locator}" is: "${state}"`);
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
        console.log(`[Verify] -> Asserting current URL contains: "${text}"`);
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
     * * @param imagesLocator - The Playwright Locator pointing to the image element(s).
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
                await productImage.scrollIntoViewIfNeeded().catch(() => {});
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

        console.log(`[Verify] -> Successfully verified ${productImages.length} images for "${imagesLocator}"`);
    }
}