import { Page, expect, Locator } from '@playwright/test';
import { CountVerifyOptions, TextVerifyOptions } from '../enum/Options';
import { Element, WebElement } from '@civitas-cerebrum/element-repository';

type Target = Locator | Element;

function resolveLocator(target: Target): Locator {
    if ('_type' in target) {
        return (target as unknown as WebElement).locator;
    }
    return target as Locator;
}

function toElement(target: Target): Element {
    if ('_type' in target) return target as Element;
    return new WebElement(target as Locator);
}

/**
 * The `Verifications` class provides a unified wrapper around Playwright's `expect` assertions.
 * It standardizes timeouts and includes advanced custom, robust verifications
 * (like image decoding) to keep your test assertions clean and reliable.
 */
export class Verifications {
    /** The standard timeout applied to all verifications in this class. */
    private ELEMENT_TIMEOUT: number;

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
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @param expectedText - The exact text string expected (optional if checking 'notEmpty').
     * @param options - Configuration to alter the verification behavior.
     */
    async text(target: Target, expectedText?: string, options?: TextVerifyOptions): Promise<void> {
        const locator = resolveLocator(target);
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
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @param expectedText - The substring expected to be present within the element's text.
     */
    async textContains(target: Target, expectedText: string): Promise<void> {
        const locator = resolveLocator(target);
        await expect(locator).toContainText(expectedText, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts that the specified element is attached to the DOM and is visible.
     * @param target - A Playwright Locator or Element pointing to the target element.
     */
    async presence(target: Target): Promise<void> {
        const locator = resolveLocator(target);
        await expect(locator).toBeVisible({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts that the specified element is either hidden or completely detached from the DOM.
     * Accepts a Target or a raw selector string to prevent unnecessary repository waits.
     * @param selectorOrTarget - A Playwright Locator, Element, or raw selector string.
     */
    async absence(selectorOrTarget: Target | string): Promise<void> {
        const locator = typeof selectorOrTarget === 'string'
            ? this.page.locator(selectorOrTarget)
            : resolveLocator(selectorOrTarget);

        await expect(locator).toBeHidden({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
  * Asserts the state of an element using Playwright's built-in locator assertions.
  * @param target - A Playwright Locator or Element pointing to the target element.
  * @param state - The expected state to verify.
  */
    async state(target: Target, state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport'): Promise<void>;

    /**
     * Asserts the state of an element using Playwright's built-in locator assertions.
     * @param locator - A CSS/XPath selector string to locate the target element.
     * @param state - The expected state to verify.
     * @param timeout - Optional timeout in milliseconds, overrides the default ELEMENT_TIMEOUT.
     */
    async state(locator: string, state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport', timeout?: number): Promise<void>;

    async state(
        locator: Target | string,
        state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport',
        timeout?: number
    ): Promise<void> {
        const resolvedLocator: Locator = typeof locator === 'string' ? this.page.locator(locator) : resolveLocator(locator);
        const resolvedTimeout = timeout ?? this.ELEMENT_TIMEOUT;

        switch (state) {
            case 'enabled': await expect(resolvedLocator).toBeEnabled({ timeout: resolvedTimeout }); break;
            case 'disabled': await expect(resolvedLocator).toBeDisabled({ timeout: resolvedTimeout }); break;
            case 'editable': await expect(resolvedLocator).toBeEditable({ timeout: resolvedTimeout }); break;
            case 'checked': await expect(resolvedLocator).toBeChecked({ timeout: resolvedTimeout }); break;
            case 'focused': await expect(resolvedLocator).toBeFocused({ timeout: resolvedTimeout }); break;
            case 'visible': await expect(resolvedLocator).toBeVisible({ timeout: resolvedTimeout }); break;
            case 'hidden': await expect(resolvedLocator).toBeHidden({ timeout: resolvedTimeout }); break;
            case 'attached': await expect(resolvedLocator).toBeAttached({ timeout: resolvedTimeout }); break;
            case 'inViewport': await expect(resolvedLocator).toBeInViewport({ timeout: resolvedTimeout }); break;
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
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @param attributeName - The name of the HTML attribute to check (e.g., 'href', 'class', 'alt').
     * @param expectedValue - The exact expected value of the attribute.
     */
    async attribute(target: Target, attributeName: string, expectedValue: string): Promise<void> {
        const locator = resolveLocator(target);
        await expect(locator).toHaveAttribute(attributeName, expectedValue, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Performs a rigorous, multi-step verification on one or more images.
     * It checks for visibility, ensures a valid 'src' attribute exists, confirms the
     * 'naturalWidth' is greater than 0, and evaluates the browser's native `decode()`
     * promise to guarantee the image is fully rendered and not a broken link.
     * @param imagesTarget - A Playwright Locator or Element pointing to the image element(s).
     * @param scroll - Whether to smoothly scroll the image(s) into the viewport before verifying (default: true).
     * @throws Will throw an error if no images are found matching the locator or if any image fails to decode.
     */
    async images(imagesTarget: Target, scroll: boolean = true): Promise<void> {
        const imagesLocator = resolveLocator(imagesTarget);
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
     * Asserts that an input, textarea, or select element has the expected value.
     * Unlike `text()` which checks `textContent`, this checks the `value` property.
     * @param target - A Playwright Locator or Element pointing to the input element.
     * @param expectedValue - The expected value of the input.
     */
    async inputValue(target: Target, expectedValue: string): Promise<void> {
        const locator = resolveLocator(target);
        await expect(locator).toHaveValue(expectedValue, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts the number of open browser tabs/pages matches the expected count.
     * @param expectedCount - The expected number of open tabs.
     */
    async tabCount(expectedCount: number): Promise<void> {
        await expect.poll(
            () => this.page.context().pages().length,
            { timeout: this.ELEMENT_TIMEOUT, message: `Expected ${expectedCount} tabs` }
        ).toBe(expectedCount);
    }

    /**
     * Asserts that two values are strictly equal.
     * Typically used to compare two values captured from the page via getText() or getInputValue().
     * Both parameters accept null to support values that may not be present in the DOM.
     *
     * @param actual - The value captured from the page.
     * @param expected - The value to compare against. Can be another captured value or a literal string.
     */
    expectEqual(actual: string | null, expected: string | null): void {
        expect(actual, `Expected values to be equal.\n  Actual:   "${actual}"\n  Expected: "${expected}"`).toBe(expected);
    }

    /**
     * Asserts that two values are not equal.
     * Typically used to confirm that two values captured from the page differ from each other.
     * Both parameters accept null to support values that may not be present in the DOM.
     *
     * @param actual - The value captured from the page.
     * @param notExpected - The value that actual must differ from.
     */
    expectNotEqual(actual: string | null, notExpected: string | null): void {
        expect(actual, `Expected values to differ, but both were: "${actual}"`).not.toBe(notExpected);
    }

    /**
    * Asserts the number of elements matching the locator based on the provided conditions.
    * @param target - A Playwright Locator or Element pointing to the target elements.
    * @param options - Configuration specifying 'exact', 'greaterThan', or 'lessThan' logic.
    */
    /**
     * Asserts that the text contents of all elements matching the locator appear in the exact
     * order specified by `expectedTexts`. Each element's trimmed `textContent` is compared
     * against the corresponding entry in the array.
     * @param target - A Playwright Locator or Element resolving to the list of elements.
     * @param expectedTexts - The expected text values in order.
     */
    async order(target: Target, expectedTexts: string[]): Promise<void> {
        const locator = resolveLocator(target);
        await expect(locator).toHaveText(expectedTexts, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts that a computed CSS property of an element matches the expected value.
     * Uses `getComputedStyle` under the hood, so values are in their resolved form
     * (e.g. `'rgb(255, 0, 0)'` instead of `'red'`).
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @param property - The CSS property name (e.g. `'color'`, `'font-size'`, `'display'`).
     * @param expectedValue - The expected computed value.
     */
    async cssProperty(target: Target, property: string, expectedValue: string): Promise<void> {
        const locator = resolveLocator(target);
        await expect(locator).toHaveCSS(property, expectedValue, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Asserts that the text contents of all elements matching the locator are sorted
     * in the specified direction. Each element's trimmed `textContent` is compared
     * using locale-aware string comparison.
     * @param target - A Playwright Locator or Element resolving to the list of elements.
     * @param direction - `'asc'` for ascending (A-Z) or `'desc'` for descending (Z-A).
     */
    async listOrder(target: Target, direction: 'asc' | 'desc'): Promise<void> {
        const locator = resolveLocator(target);
        const texts = (await locator.allTextContents()).map(t => t.trim());

        if (texts.length < 2) return;

        const sorted = [...texts].sort((a, b) =>
            direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
        );

        expect(texts, `Expected list to be sorted ${direction}ending`).toEqual(sorted);
    }


    async count(target: Target, options: CountVerifyOptions): Promise<void> {
        const locator = resolveLocator(target);
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

        const element = toElement(target);
        await expect.poll(async () => {
            const actualCount = await element.count();
            if (options.greaterThan !== undefined && actualCount <= options.greaterThan) return false;
            if (options.lessThan !== undefined && actualCount >= options.lessThan) return false;
            return true;
        }, { timeout: this.ELEMENT_TIMEOUT, message: `Expected count${options.greaterThan !== undefined ? ` > ${options.greaterThan}` : ''}${options.lessThan !== undefined ? ` < ${options.lessThan}` : ''}` }).toBe(true);
    }
}
