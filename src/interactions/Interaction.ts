import { Page, Locator } from '@playwright/test';
import { ClickOptions, DropdownSelectOptions, DropdownSelectType, DragAndDropOptions, ListedElementMatch } from '../enum/Options';
import { Utils } from '../utils/ElementUtilities';
import { Element, WebElement } from '@civitas-cerebrum/element-repository';

/** A Playwright Locator or an Element wrapper from the repository. */
export type Target = Locator | Element;

/** Resolves a Target to a Playwright Locator. */
function resolveLocator(target: Target): Locator {
    if ('_type' in target) {
        return (target as unknown as WebElement).locator;
    }
    return target as Locator;
}

/**
 * The `Interactions` class provides a robust set of methods for interacting
 * with DOM elements via Playwright Locators. It abstracts away common boilerplate
 * and handles edge cases like overlapping elements or optional UI components.
 */
export class Interactions {
    private ELEMENT_TIMEOUT : number;
    private utils: Utils;

    /**
     * Initializes the Interactions class.
     * @param page - The current Playwright Page object.
     * @param timeout - Optional override for the default element timeout.
     */
    constructor(private page: Page, timeout: number = 30000) {
        this.ELEMENT_TIMEOUT = timeout;
        this.utils = new Utils(this.ELEMENT_TIMEOUT);
    }

    /**
     * Performs a standard Playwright click on the given target.
     * Automatically waits for the element to be attached, visible, stable, and actionable.
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @param options - Optional click modifiers.
     */
    async click(target: Target, options?: ClickOptions): Promise<boolean | void> {
        const locator = resolveLocator(target);
        const useDispatch = options?.force || options?.withoutScrolling;

        if (options?.ifPresent) {
            if (await locator.isVisible()) {
                if (useDispatch) {
                    await this.dispatchClick(locator);
                } else {
                    await this.clickWithInterceptionRetry(locator);
                }
                return true;
            }
            return false;
        }

        if (useDispatch) {
            await this.dispatchClick(locator);
            return;
        }

        await this.utils.waitForState(locator, 'visible');
        await this.clickWithInterceptionRetry(locator);
    }

    /**
     * Dispatches a native 'click' event directly on the element, bypassing
     * Playwright's actionability checks and pointer-interception guards.
     * Used by both `force` and `withoutScrolling` options.
     */
    private async dispatchClick(locator: Locator): Promise<void> {
        await this.utils.waitForState(locator, 'attached');
        await locator.dispatchEvent('click');
    }

    /**
     * Attempts a standard click. If the click fails because another element
     * intercepts pointer events, automatically retries by dispatching a native
     * click event directly on the element (bypassing the overlay).
     *
     * Uses a short initial timeout (5s) for the first attempt so that
     * interception retries don't add 30s+ of dead wait time.
     */
    private async clickWithInterceptionRetry(locator: Locator): Promise<void> {
        try {
            await locator.click({ timeout: Math.min(this.ELEMENT_TIMEOUT, 5000) });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('intercepts pointer events')) {
                await locator.dispatchEvent('click');
            } else {
                // Retry with full timeout in case the short attempt failed for
                // a timing reason (element wasn't ready yet)
                await locator.click({ timeout: this.ELEMENT_TIMEOUT });
            }
        }
    }

    /**
     * Dispatches a native 'click' event directly to the element.
     * This bypasses Playwright's default scrolling and intersection observer checks.
     * Highly useful for clicking elements that might be artificially obscured by sticky headers or transparent overlays.
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @deprecated Use `click(target, { withoutScrolling: true })` instead.
     */
    async clickWithoutScrolling(target: Target): Promise<void> {
        await this.click(target, { withoutScrolling: true });
    }

    /**
     * Checks if an element is visible before attempting to click it.
     * If the element is hidden or not in the DOM, it safely skips the action
     * without failing the test. Great for optional elements like cookie banners or promotional pop-ups.
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @returns `true` if the element was visible and clicked, `false` if it was skipped.
     * @deprecated Use `click(target, { ifPresent: true })` instead.
     */
    async clickIfPresent(target: Target): Promise<boolean> {
        return await this.click(target, { ifPresent: true }) as boolean;
    }

    /**
     * Clears any existing value in the target input field and types the provided text.
     * @param target - A Playwright Locator or Element pointing to the input element.
     * @param text - The string to type into the input field.
     */
    async fill(target: Target, text: string): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        await locator.fill(text, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Uploads a local file to an `<input type="file">` element.
     * @param target - A Playwright Locator or Element pointing to the file input element.
     * @param filePath - The local file system path to the file you want to upload.
     */
    async uploadFile(target: Target, filePath: string): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'attached');
        await locator.setInputFiles(filePath, { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Unified method to interact with `<select>` dropdown elements based on the specified `DropdownSelectType`.
     * If no options are provided, it safely defaults to randomly selecting an enabled, non-empty option.
     * @param target - A Playwright Locator or Element pointing to the `<select>` element.
     * @param options - Configuration specifying whether to select by 'random', 'index', or 'value'.
     * @returns A promise that resolves to the exact 'value' attribute of the newly selected option.
     * @throws Error if 'value' or 'index' is missing when their respective types are chosen, or if no enabled options exist.
     */
    async selectDropdown(
        target: Target,
        options: DropdownSelectOptions = { type: DropdownSelectType.RANDOM }
    ): Promise<string> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        const type = options.type ?? DropdownSelectType.RANDOM;

        if (type === DropdownSelectType.VALUE) {
            if (options.value === undefined) {
                throw new Error('[Action] Error -> "value" must be provided when using DropdownSelectType.VALUE.');
            }
            const selected = await locator.selectOption({ value: options.value }, { timeout: this.ELEMENT_TIMEOUT });
            return selected[0];
        }

        if (type === DropdownSelectType.INDEX) {
            if (options.index === undefined) {
                throw new Error('[Action] Error -> "index" must be provided when using DropdownSelectType.INDEX.');
            }
            const selected = await locator.selectOption({ index: options.index }, { timeout: this.ELEMENT_TIMEOUT });
            return selected[0];
        }

        const enabledOptions = locator.locator('option:not([disabled]):not([value=""])');

        await this.utils.waitForState(enabledOptions.first(), 'attached').catch(() => { });

        const count = await enabledOptions.count();

        if (count === 0) {
            throw new Error('[Action] Error -> No enabled options found to select!');
        }

        const randomIndex = Math.floor(Math.random() * count);
        const valueToSelect = await enabledOptions.nth(randomIndex).getAttribute('value', { timeout: this.ELEMENT_TIMEOUT });

        if (valueToSelect === null) {
            throw new Error(`[Action] Error -> Option at index ${randomIndex} is missing a "value" attribute.`);
        }

        const selected = await locator.selectOption({ value: valueToSelect }, { timeout: this.ELEMENT_TIMEOUT });

        return selected[0];
    }

    /**
     * Hovers over the specified element. Useful for triggering dropdowns or tooltips.
     * @param target - A Playwright Locator or Element pointing to the target element.
     */
    async hover(target: Target): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        await locator.hover({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Scrolls the element into view if it is not already visible in the viewport.
     * @param target - A Playwright Locator or Element pointing to the target element.
     */
    async scrollIntoView(target: Target): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'attached');
        await locator.scrollIntoViewIfNeeded({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
    * Drags an element either to a specified target element, a target element with an offset, or by a coordinate offset.
    * @param target - A Playwright Locator or Element pointing to the element to drag.
    * @param options - Configuration specifying a 'targetLocator', offsets, or both.
    */
    async dragAndDrop(target: Target, options: DragAndDropOptions): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');

        if (options.target) {
            const dropTarget = resolveLocator(options.target);
            await this.utils.waitForState(dropTarget, 'visible');

            if (options.xOffset !== undefined && options.yOffset !== undefined) {
                const targetBox = await dropTarget.boundingBox();
                if (!targetBox) {
                    throw new Error(`[Action] Error -> Unable to get bounding box for target element.`);
                }

                const targetPosition = {
                    x: (targetBox.width / 2) + options.xOffset,
                    y: (targetBox.height / 2) + options.yOffset
                };

                await locator.dragTo(dropTarget, {
                    targetPosition,
                    timeout: this.ELEMENT_TIMEOUT
                });
                return;
            }

            await locator.dragTo(dropTarget, { timeout: this.ELEMENT_TIMEOUT });
            return;
        }

        if (options.xOffset !== undefined && options.yOffset !== undefined) {
            const box = await locator.boundingBox();
            if (!box) {
                throw new Error(`[Action] Error -> Unable to get bounding box for element to perform drag action.`);
            }

            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;

            await this.page.mouse.move(startX, startY);
            await this.page.mouse.down();

            await this.page.mouse.move(startX + options.xOffset, startY + options.yOffset, { steps: 10 });
            await this.page.mouse.up();
            return;
        }

        throw new Error(`[Action] Error -> You must provide either 'targetLocator', or both 'xOffset' and 'yOffset' in DragAndDropOptions.`);
    }

    /**
       * Filters a locator list and returns the first element that contains the specified text.
       * If the element is not found, it prints the available text contents of the base locator for debugging.
       * @param baseTarget The base Playwright Locator or Element.
       * @param desiredText The string of text to search for within the elements.
       * @param strict If true, throws an error if the element is not found. Defaults to false.
       * @returns A promise that resolves to the matched Playwright Locator, or null if not found.
       */
    public async getByText(
        baseTarget: Target,
        desiredText: string,
        strict: boolean = false
    ): Promise<ReturnType<Page['locator']> | null> {
        const baseLocator = resolveLocator(baseTarget);
        // Try case-sensitive match first
        const caseSensitive = baseLocator.filter({ hasText: desiredText }).first();

        if ((await caseSensitive.count()) > 0) {
            return caseSensitive;
        }

        // Fall back to case-insensitive match
        const escaped = desiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const caseInsensitive = baseLocator.filter({ hasText: new RegExp(escaped, 'i') }).first();

        if ((await caseInsensitive.count()) > 0) {
            return caseInsensitive;
        }

        const rawTexts = await baseLocator.allInnerTexts();

        const availableTexts = rawTexts
            .map((text: string) => text.trim())
            .filter((text: string) => text.length > 0);

        const msg = `getByText: element with text "${desiredText}" not found.\nAvailable texts: ${availableTexts.length > 0 ? `\n- ${availableTexts.join('\n- ')}` : 'None'}`;

        if (strict) throw new Error(msg);
        return null;
    }

    /**
     * Types into the target element character by character with a specified delay.
     * Use this for OTP inputs, search-as-you-type fields, or when `fill()`
     * doesn't trigger necessary keyboard events (like 'keyup' or 'keydown').
     * @param target - A Playwright Locator or Element pointing to the input element.
     * @param text - The string of text to type sequentially.
     * @param delay - Time in milliseconds to wait between key presses. Defaults to 100ms.
     */
    async typeSequentially(target: Target, text: string, delay: number = 100): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        await locator.pressSequentially(text, {
            delay,
            timeout: this.ELEMENT_TIMEOUT
        });
    }

    /**
     * Performs a right-click (context menu) on the given target.
     * @param target - A Playwright Locator or Element pointing to the target element.
     */
    async rightClick(target: Target): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        await locator.click({ button: 'right', timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Performs a double-click on the given target.
     * @param target - A Playwright Locator or Element pointing to the target element.
     */
    async doubleClick(target: Target): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        await locator.dblclick({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Checks a checkbox or radio button. This is idempotent — if already checked, it does nothing.
     * @param target - A Playwright Locator or Element pointing to the checkbox/radio element.
     */
    async check(target: Target): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        await locator.check({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Unchecks a checkbox. This is idempotent — if already unchecked, it does nothing.
     * @param target - A Playwright Locator or Element pointing to the checkbox element.
     */
    async uncheck(target: Target): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        await locator.uncheck({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Sets the value of a range/slider input element.
     * @param target - A Playwright Locator or Element pointing to the range input element.
     * @param value - The numeric value to set.
     */
    async setSliderValue(target: Target, value: number): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        await locator.fill(String(value), { timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Presses a keyboard key at the page level.
     * Useful for shortcuts like Escape, Enter, Tab, or modifier combos like 'Control+A'.
     * @param key - The key to press (e.g. 'Escape', 'Enter', 'Tab', 'Control+A').
     */
    async pressKey(key: string): Promise<void> {
        await this.page.keyboard.press(key);
    }

    /**
     * Clears the value of an input or textarea element without filling it with new text.
     * @param target - A Playwright Locator or Element pointing to the input element.
     */
    async clearInput(target: Target): Promise<void> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        await locator.clear({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Selects multiple options from a `<select multiple>` element by their `value` attributes.
     * @param target - A Playwright Locator or Element pointing to the multi-select element.
     * @param values - An array of `value` attribute strings to select.
     * @returns An array of the actually selected `value` strings.
     */
    async selectMultiple(target: Target, values: string[]): Promise<string[]> {
        const locator = resolveLocator(target);
        await this.utils.waitForState(locator, 'visible');
        return await locator.selectOption(
            values.map(v => ({ value: v })),
            { timeout: this.ELEMENT_TIMEOUT }
        );
    }

    /**
     * Resolves a specific element from a list by matching its visible text or an HTML attribute.
     * Optionally drills into a child element within the matched item.
     *
     * This is the core utility behind `clickListedElement`, `verifyListedElement`,
     * and `getListedElementData` in the Steps API.
     *
     * @param baseTarget - A Playwright Locator or Element that resolves to the list of elements (e.g. table rows, list items).
     * @param options - Match criteria and optional child targeting. Must include either `text` or `attribute`.
     * @param repo - Optional ElementRepository instance, required when `options.child` is a page-repo reference.
     * @returns The resolved Playwright Locator for the matched (and optionally child-targeted) element.
     * @throws Error if neither `text` nor `attribute` is specified, or if no matching element is found.
     */
    async getListedElement(
        baseTarget: Target,
        options: ListedElementMatch,
        repo?: { getSelector(elementName: string, pageName: string): string }
    ): Promise<Locator> {
        const baseLocator = resolveLocator(baseTarget);
        let matched: Locator;

        if (options.text) {
            // Try case-sensitive match first, fall back to case-insensitive
            const caseSensitive = baseLocator.filter({ hasText: options.text }).first();
            if ((await caseSensitive.count()) > 0) {
                matched = caseSensitive;
            } else {
                const escaped = options.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                matched = baseLocator.filter({ hasText: new RegExp(escaped, 'i') }).first();
            }
        } else if (options.attribute) {
            matched = baseLocator.and(
                this.page.locator(`[${options.attribute.name}="${options.attribute.value}"]`)
            ).first();
        } else {
            throw new Error('ListedElementOptions requires either "text" or "attribute" to identify the element.');
        }

        await this.utils.waitForState(matched, 'visible');

        if (!options.child) {
            return matched;
        }

        if (typeof options.child === 'string') {
            return matched.locator(options.child);
        }

        if (!repo) {
            throw new Error('An ElementRepository instance is required when "child" is a page-repository reference.');
        }
        const childSelector = repo.getSelector(options.child.elementName, options.child.pageName);
        return matched.locator(childSelector);
    }
}
