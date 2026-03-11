import { Page, expect, Locator } from '@playwright/test';

export class Verifications {
    private readonly ELEMENT_TIMEOUT = 10000;

    constructor(private page: Page) {}

    async text(locator: Locator, expectedText: string): Promise<void> {
        await expect(locator).toHaveText(expectedText, { timeout: this.ELEMENT_TIMEOUT });
    }

    async textContains(locator: Locator, expectedText: string): Promise<void> {
        await expect(locator).toContainText(expectedText, { timeout: this.ELEMENT_TIMEOUT });
    }

    async presence(locator: Locator): Promise<void> {
        await expect(locator).toBeVisible({ timeout: this.ELEMENT_TIMEOUT });
    }

    async absence(locator: Locator): Promise<void> {
        console.log(`[Verify] -> Asserting absence of "${locator}"`);
        await expect(locator).toBeHidden({ timeout: this.ELEMENT_TIMEOUT });
    }

    async state(locator: Locator, state: 'enabled' | 'disabled'): Promise<void> {
        console.log(`[Verify] -> Asserting state of "${locator}" is: "${state}"`);
        if (state === 'enabled') {
            await expect(locator).toBeEnabled({ timeout: this.ELEMENT_TIMEOUT });
        } else {
            await expect(locator).toBeDisabled({ timeout: this.ELEMENT_TIMEOUT });
        }
    }

    async urlContains(text: string): Promise<void> {
        console.log(`[Verify] -> Asserting current URL contains: "${text}"`);
        await expect(this.page).toHaveURL(new RegExp(text, 'i'), { timeout: this.ELEMENT_TIMEOUT });
    }

    async attribute(locator: Locator, attributeName: string, expectedValue: string): Promise<void> {
        await expect(locator).toHaveAttribute(attributeName, expectedValue, { timeout: this.ELEMENT_TIMEOUT });
    }

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