import { Page, expect, Locator } from '@playwright/test';
type LocatorAssertions = ReturnType<typeof expect<Locator>>;
import { CountVerifyOptions, TextVerifyOptions } from '../enum/Options';
import { Element, WebElement } from '@civitas-cerebrum/element-repository';

/** Shared options every Verifications method accepts. */
export interface VerifyOptions {
    /** When `true`, flips the assertion — passes when the underlying condition fails. */
    negated?: boolean;
    /** Override the class-level timeout for this single assertion. */
    timeout?: number;
    /** Custom message prepended to Playwright's error on failure. */
    errorMessage?: string;
}

/** Reach the Playwright Locator under a WebElement — used for Playwright's `expect(locator)` assertions. */
function resolveLocator(target: WebElement): Locator {
    return target.locator;
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

    /** Pick `expect(locator)` vs `expect(locator).not` based on options, with the right timeout and custom error message. */
    private prepare(locator: Locator, options?: VerifyOptions): { matcher: LocatorAssertions; timeout: number; message?: string } {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        const base = options?.errorMessage ? expect(locator, options.errorMessage) : expect(locator);
        const matcher = options?.negated ? base.not : base;
        return { matcher, timeout, message: options?.errorMessage };
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
    async text(target: WebElement, expectedText?: string, options?: TextVerifyOptions & VerifyOptions): Promise<void> {
        const locator = resolveLocator(target);
        const { matcher, timeout } = this.prepare(locator, options);
        if (options?.notEmpty) {
            await matcher.not.toBeEmpty({ timeout });
            return;
        }
        if (expectedText === undefined) {
            throw new Error(`You must provide either an 'expectedText' string or set '{ notEmpty: true }' in options.`);
        }
        await matcher.toHaveText(expectedText, { timeout });
    }

    /**
     * Asserts that the specified element contains the expected substring.
     */
    async textContains(target: WebElement, expectedText: string, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toContainText(expectedText, { timeout });
    }

    /** Asserts the element's text matches a regular expression. */
    async textMatches(target: WebElement, regex: RegExp, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveText(regex, { timeout });
    }

    /** Asserts the element's text starts with the given prefix. */
    async textStartsWith(target: WebElement, prefix: string, options?: VerifyOptions): Promise<void> {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.textMatches(target, new RegExp('^' + escaped), options);
    }

    /** Asserts the element's text ends with the given suffix. */
    async textEndsWith(target: WebElement, suffix: string, options?: VerifyOptions): Promise<void> {
        const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.textMatches(target, new RegExp(escaped + '$'), options);
    }

    /**
     * Asserts that the specified element is attached to the DOM and is visible.
     * @param target - A Playwright Locator or Element pointing to the target element.
     */
    async presence(target: WebElement, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toBeVisible({ timeout });
    }

    /**
     * Asserts that the specified element is either hidden or completely detached from the DOM.
     * Accepts a Target or a raw selector string to prevent unnecessary repository waits.
     * @param selectorOrTarget - A Playwright Locator, Element, or raw selector string.
     */
    async absence(selectorOrTarget: WebElement | string): Promise<void> {
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
    async state(target: WebElement, state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport', options?: VerifyOptions): Promise<void>;

    /**
     * Asserts the state of an element using Playwright's built-in locator assertions.
     * @param locator - A CSS/XPath selector string to locate the target element.
     * @param state - The expected state to verify.
     * @param timeout - Optional timeout in milliseconds, overrides the default ELEMENT_TIMEOUT.
     */
    async state(locator: string, state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport', timeout?: number): Promise<void>;

    async state(
        locator: WebElement | string,
        state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport',
        timeoutOrOptions?: number | VerifyOptions,
    ): Promise<void> {
        const resolvedLocator: Locator = typeof locator === 'string' ? this.page.locator(locator) : resolveLocator(locator);
        const options: VerifyOptions = typeof timeoutOrOptions === 'number'
            ? { timeout: timeoutOrOptions }
            : (timeoutOrOptions ?? {});
        const { matcher, timeout } = this.prepare(resolvedLocator, options);

        switch (state) {
            case 'enabled': await matcher.toBeEnabled({ timeout }); break;
            case 'disabled': await matcher.toBeDisabled({ timeout }); break;
            case 'editable': await matcher.toBeEditable({ timeout }); break;
            case 'checked': await matcher.toBeChecked({ timeout }); break;
            case 'focused': await matcher.toBeFocused({ timeout }); break;
            case 'visible': await matcher.toBeVisible({ timeout }); break;
            case 'hidden': await matcher.toBeHidden({ timeout }); break;
            case 'attached': await matcher.toBeAttached({ timeout }); break;
            case 'inViewport': await matcher.toBeInViewport({ timeout }); break;
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

    // ==========================================
    // HTML Assertions
    // ==========================================
    //
    // Playwright has no built-in `toHaveHTML` matcher, so the html family is
    // implemented on top of `expect.poll` to retain the same retry semantics
    // as the rest of the verification surface (web-first, custom timeout,
    // negation, error message). Each method shares one polling helper so the
    // exact-match / contains / regex / starts-with / ends-with branches stay
    // a single line of dispatch.

    /** Read innerHTML / outerHTML for an element-scoped html assertion. Locator-only — caller resolves the WebElement. */
    private readElementHtml(locator: Locator, outer: boolean): Promise<string> {
        const target = locator.first();
        return outer
            ? target.evaluate((el: globalThis.Element) => el.outerHTML)
            : target.innerHTML();
    }

    /** Read the page-level HTML — body innerHTML by default, full document outerHTML when `outer`. */
    private readPageHtml(outer: boolean): Promise<string> {
        return outer
            ? this.page.evaluate(() => document.documentElement.outerHTML)
            : this.page.evaluate(() => document.body.innerHTML);
    }

    /**
     * Polls a string predicate against an HTML source until it satisfies the
     * predicate (or its negation) or the timeout expires. Single source of
     * truth for every html / pageHtml assertion variant.
     */
    private async pollHtml(
        readHtml: () => Promise<string>,
        predicate: (html: string) => boolean,
        describe: string,
        scope: string,
        options?: VerifyOptions,
    ): Promise<void> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        const negated = options?.negated ?? false;
        const neg = negated ? 'not ' : '';
        const header = options?.errorMessage ?? `expected ${scope} html ${neg}${describe}`;

        let lastHtml: string | null = null;
        try {
            await expect.poll(async () => {
                try {
                    const html = await readHtml();
                    lastHtml = html;
                    return predicate(html) !== negated;
                } catch {
                    return false;
                }
            }, { timeout, message: header }).toBe(true);
        } catch {
            // expect.poll rethrows with its own "Timeout … while waiting on the
            // predicate" message and drops the `message` option from the thrown
            // Error string (it only surfaces in the report). Repackage so the
            // assertion header always shows up in the thrown message — same UX
            // as `expect(locator).toHaveText(..., { timeout })` in the rest of
            // the verification surface.
            const actual: string = lastHtml ?? '<unavailable>';
            const truncated = actual.length > 200 ? `${actual.slice(0, 200)}…` : actual;
            throw new Error(`${header}\n  actual: "${truncated}"`);
        }
    }

    /** Asserts the element's `innerHTML` (or `outerHTML` with `{ outer: true }`) equals the expected string exactly. */
    async html(target: WebElement, expected: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => html === expected,
            `to be "${expected}"`,
            `element`,
            options,
        );
    }

    /** Asserts the element's HTML contains the given substring. */
    async htmlContains(target: WebElement, substring: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => html.includes(substring),
            `to contain "${substring}"`,
            `element`,
            options,
        );
    }

    /** Asserts the element's HTML matches a regular expression. */
    async htmlMatches(target: WebElement, regex: RegExp, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => regex.test(html),
            `to match ${regex}`,
            `element`,
            options,
        );
    }

    /** Asserts the element's HTML starts with the given prefix. */
    async htmlStartsWith(target: WebElement, prefix: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => html.startsWith(prefix),
            `to start with "${prefix}"`,
            `element`,
            options,
        );
    }

    /** Asserts the element's HTML ends with the given suffix. */
    async htmlEndsWith(target: WebElement, suffix: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => html.endsWith(suffix),
            `to end with "${suffix}"`,
            `element`,
            options,
        );
    }

    /** Asserts the page-level HTML equals the expected string exactly. Defaults to `document.body.innerHTML`; pass `{ outer: true }` for the full document outerHTML. */
    async pageHtml(expected: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => html === expected,
            `to be "${expected}"`,
            outer ? 'document' : 'body',
            options,
        );
    }

    /** Asserts the page-level HTML contains the given substring. */
    async pageHtmlContains(substring: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => html.includes(substring),
            `to contain "${substring}"`,
            outer ? 'document' : 'body',
            options,
        );
    }

    /** Asserts the page-level HTML matches a regular expression. */
    async pageHtmlMatches(regex: RegExp, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => regex.test(html),
            `to match ${regex}`,
            outer ? 'document' : 'body',
            options,
        );
    }

    /** Asserts the page-level HTML starts with the given prefix. */
    async pageHtmlStartsWith(prefix: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => html.startsWith(prefix),
            `to start with "${prefix}"`,
            outer ? 'document' : 'body',
            options,
        );
    }

    /** Asserts the page-level HTML ends with the given suffix. */
    async pageHtmlEndsWith(suffix: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => html.endsWith(suffix),
            `to end with "${suffix}"`,
            outer ? 'document' : 'body',
            options,
        );
    }

    /**
     * Asserts that an element has a specific HTML attribute with an exact value.
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @param attributeName - The name of the HTML attribute to check (e.g., 'href', 'class', 'alt').
     * @param expectedValue - The exact expected value of the attribute.
     */
    async attribute(target: WebElement, attributeName: string, expectedValue: string, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveAttribute(attributeName, expectedValue, { timeout });
    }

    /** Asserts that a given HTML attribute contains the substring. */
    async attributeContains(target: WebElement, attributeName: string, substring: string, options?: VerifyOptions): Promise<void> {
        const escaped = substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.attributeMatches(target, attributeName, new RegExp(escaped), options);
    }

    /** Asserts that a given HTML attribute matches a regular expression. */
    async attributeMatches(target: WebElement, attributeName: string, regex: RegExp, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveAttribute(attributeName, regex, { timeout });
    }

    /** Asserts that the element has a given HTML attribute present (regardless of value). */
    async hasAttribute(target: WebElement, attributeName: string, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveAttribute(attributeName, /[\s\S]*/, { timeout });
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
    async images(imagesTarget: WebElement, scroll: boolean = true): Promise<void> {
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
    async inputValue(target: WebElement, expectedValue: string, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveValue(expectedValue, { timeout });
    }

    /** Asserts the input value contains the given substring. */
    async inputValueContains(target: WebElement, substring: string, options?: VerifyOptions): Promise<void> {
        const escaped = substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.inputValueMatches(target, new RegExp(escaped), options);
    }

    /** Asserts the input value matches a regular expression. */
    async inputValueMatches(target: WebElement, regex: RegExp, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveValue(regex, { timeout });
    }

    /** Asserts the input value starts with the given prefix. */
    async inputValueStartsWith(target: WebElement, prefix: string, options?: VerifyOptions): Promise<void> {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.inputValueMatches(target, new RegExp('^' + escaped), options);
    }

    /** Asserts the input value ends with the given suffix. */
    async inputValueEndsWith(target: WebElement, suffix: string, options?: VerifyOptions): Promise<void> {
        const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.inputValueMatches(target, new RegExp(escaped + '$'), options);
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
     * Asserts that the text contents of all elements matching the locator appear in the exact
     * order specified by `expectedTexts`. Each element's trimmed `textContent` is compared
     * against the corresponding entry in the array.
     * @param target - A Playwright Locator or Element resolving to the list of elements.
     * @param expectedTexts - The expected text values in order.
     */
    async order(target: WebElement, expectedTexts: string[]): Promise<void> {
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
    async cssProperty(target: WebElement, property: string, expectedValue: string, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveCSS(property, expectedValue, { timeout });
    }

    /** Asserts a computed CSS property value contains the given substring. */
    async cssPropertyContains(target: WebElement, property: string, substring: string, options?: VerifyOptions): Promise<void> {
        const escaped = substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.cssPropertyMatches(target, property, new RegExp(escaped), options);
    }

    /** Asserts a computed CSS property value matches a regular expression. */
    async cssPropertyMatches(target: WebElement, property: string, regex: RegExp, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveCSS(property, regex, { timeout });
    }

    /**
     * Asserts that the text contents of all elements matching the locator are sorted
     * in the specified direction. Each element's trimmed `textContent` is compared
     * using locale-aware string comparison.
     * @param target - A Playwright Locator or Element resolving to the list of elements.
     * @param direction - `'asc'` for ascending (A-Z) or `'desc'` for descending (Z-A).
     */
    async listOrder(target: WebElement, direction: 'asc' | 'desc'): Promise<void> {
        const locator = resolveLocator(target);
        const texts = (await locator.allTextContents()).map(t => t.trim());

        if (texts.length < 2) return;

        const sorted = [...texts].sort((a, b) =>
            direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
        );

        expect(texts, `Expected list to be sorted ${direction}ending`).toEqual(sorted);
    }


    /**
     * Asserts the number of elements matching the locator based on the provided conditions.
     * Exactly one of `exactly`, `greaterThan`, `lessThan`, `greaterThanOrEqual`, or
     * `lessThanOrEqual` must be set on `options`.
     * @param target - A Playwright Locator or Element pointing to the target elements.
     * @param options - Configuration specifying which comparator to apply and the expected count.
     * @param verifyOptions - Optional `{ negated?, timeout?, errorMessage? }` override.
     * @throws Error if any count in `options` is negative, or if the count does not match.
     */
    async count(target: WebElement, options: CountVerifyOptions, verifyOptions?: VerifyOptions): Promise<void> {
        const locator = resolveLocator(target);
        const timeout = verifyOptions?.timeout ?? this.ELEMENT_TIMEOUT;
        const { matcher } = this.prepare(locator, verifyOptions);

        if (options.exactly !== undefined && options.exactly < 0) {
            throw new Error(`'exact' count cannot be negative.`);
        }
        if (options.greaterThan !== undefined && options.greaterThan < 0) {
            throw new Error(`'greaterThan' count cannot be negative.`);
        }
        if (options.lessThan !== undefined && options.lessThan <= 0) {
            throw new Error(`'lessThan' must be greater than 0. Element counts cannot be negative.`);
        }
        if (options.greaterThanOrEqual !== undefined && options.greaterThanOrEqual < 0) {
            throw new Error(`'greaterThanOrEqual' count cannot be negative.`);
        }
        if (options.lessThanOrEqual !== undefined && options.lessThanOrEqual < 0) {
            throw new Error(`'lessThanOrEqual' count cannot be negative.`);
        }

        if (options.exactly !== undefined) {
            await matcher.toHaveCount(options.exactly, { timeout });
            return;
        }

        if (
            options.greaterThan === undefined && options.lessThan === undefined
            && options.greaterThanOrEqual === undefined && options.lessThanOrEqual === undefined
        ) {
            throw new Error(`You must provide 'exact', 'greaterThan', 'lessThan', 'greaterThanOrEqual', or 'lessThanOrEqual' in CountVerifyOptions.`);
        }

        const describe = [
            options.greaterThan !== undefined ? `> ${options.greaterThan}` : null,
            options.lessThan !== undefined ? `< ${options.lessThan}` : null,
            options.greaterThanOrEqual !== undefined ? `>= ${options.greaterThanOrEqual}` : null,
            options.lessThanOrEqual !== undefined ? `<= ${options.lessThanOrEqual}` : null,
        ].filter(Boolean).join(' and ');
        const negatedSuffix = verifyOptions?.negated ? ' (negated)' : '';

        await expect.poll(async () => {
            const actualCount = await target.count();
            const passes =
                (options.greaterThan === undefined || actualCount > options.greaterThan) &&
                (options.lessThan === undefined || actualCount < options.lessThan) &&
                (options.greaterThanOrEqual === undefined || actualCount >= options.greaterThanOrEqual) &&
                (options.lessThanOrEqual === undefined || actualCount <= options.lessThanOrEqual);
            return verifyOptions?.negated ? !passes : passes;
        }, { timeout, message: `Expected count ${describe}${negatedSuffix}` }).toBe(true);
    }
}
