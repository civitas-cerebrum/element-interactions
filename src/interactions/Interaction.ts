import { Page, Locator } from '@playwright/test';
import { ClickOptions, DropdownSelectOptions, DropdownSelectType, DragAndDropOptions, ListedElementMatch, ActionTimeoutOptions } from '../enum/Options';
import { Utils } from '../utils/ElementUtilities';
import { Element, WebElement } from '@civitas-cerebrum/element-repository';

/** A Playwright Locator or an Element wrapper from the repository. */
export type Target = Locator | Element;

/** Normalizes a `Target` into an `Element`. All internal interactions route through element-repository. */
function toElement(target: Target): Element {
    if ('_type' in target) return target as Element;
    return new WebElement(target as Locator);
}

/**
 * The `Interactions` class provides a robust set of methods for interacting
 * with DOM elements. All operations route through element-repository's
 * `Element` interface, keeping this class framework-agnostic.
 */
export class Interactions {
    private ELEMENT_TIMEOUT: number;
    private utils: Utils;

    constructor(private page: Page, timeout: number = 30000) {
        this.ELEMENT_TIMEOUT = timeout;
        this.utils = new Utils(this.ELEMENT_TIMEOUT);
    }

    /**
     * Performs a standard click on the given target.
     * Automatically waits for the element to be attached, visible, stable, and actionable.
     */
    async click(target: Target, options?: ClickOptions): Promise<boolean | void> {
        const element = toElement(target);
        const useDispatch = options?.force || options?.withoutScrolling;
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;

        if (options?.ifPresent) {
            if (await element.isVisible()) {
                if (useDispatch) {
                    await this.dispatchClick(element, timeout);
                } else {
                    await this.clickWithInterceptionRetry(element, timeout);
                }
                return true;
            }
            return false;
        }

        if (useDispatch) {
            await this.dispatchClick(element, timeout);
            return;
        }

        await this.utils.waitForState(element, 'visible', timeout);
        await this.clickWithInterceptionRetry(element, timeout);
    }

    /**
     * Dispatches a native 'click' event directly on the element, bypassing
     * actionability checks. Used for both `force` and `withoutScrolling`.
     */
    private async dispatchClick(element: Element, timeout: number): Promise<void> {
        await this.utils.waitForState(element, 'attached', timeout);
        await element.dispatchEvent('click');
    }

    /**
     * Attempts a standard click. If interception is reported, retries by
     * dispatching a native click event on the element instead.
     */
    private async clickWithInterceptionRetry(element: Element, timeout: number): Promise<void> {
        try {
            await element.click({ timeout: Math.min(timeout, 5000) });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('intercepts pointer events')) {
                await element.dispatchEvent('click');
            } else {
                await element.click({ timeout });
            }
        }
    }

    /**
     * Clicks only if the element is present and visible. Returns true if clicked,
     * false if the element was absent — does not throw.
     */
    async clickIfPresent(target: Target, options?: ActionTimeoutOptions): Promise<boolean> {
        return await this.click(target, { ifPresent: true, timeout: options?.timeout }) as boolean;
    }

    async fill(target: Target, text: string): Promise<void> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'visible');
        await element.fill(text, { timeout: this.ELEMENT_TIMEOUT });
    }

    async uploadFile(target: Target, filePath: string, options?: ActionTimeoutOptions): Promise<void> {
        const element = toElement(target);
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        await this.utils.waitForState(element, 'attached', timeout);
        await element.setInputFiles(filePath, { timeout });
    }

    /**
     * Unified method to interact with `<select>` dropdown elements based on the specified `DropdownSelectType`.
     * If no options are provided, safely defaults to randomly selecting an enabled, non-empty option.
     */
    async selectDropdown(
        target: Target,
        options: DropdownSelectOptions = { type: DropdownSelectType.RANDOM }
    ): Promise<string> {
        // selectOption is a web-only method (HTML `<select>`); narrow to WebElement.
        const element = toElement(target) as WebElement;
        const timeout = options.timeout ?? this.ELEMENT_TIMEOUT;
        await this.utils.waitForState(element, 'visible', timeout);
        const type = options.type ?? DropdownSelectType.RANDOM;

        if (type === DropdownSelectType.VALUE) {
            if (options.value === undefined) {
                throw new Error('[Action] Error -> "value" must be provided when using DropdownSelectType.VALUE.');
            }
            const selected = await element.selectOption({ value: options.value }, { timeout });
            return selected[0];
        }

        if (type === DropdownSelectType.INDEX) {
            if (options.index === undefined) {
                throw new Error('[Action] Error -> "index" must be provided when using DropdownSelectType.INDEX.');
            }
            const selected = await element.selectOption({ index: options.index }, { timeout });
            return selected[0];
        }

        // Random path — look for enabled, non-empty <option> descendants.
        // `locateChild` composes a CSS selector underneath the current element;
        // this is part of the Element contract, not a raw locator call.
        const enabledOptions = element.locateChild('option:not([disabled]):not([value=""])');

        await this.utils.waitForState(enabledOptions.first(), 'attached', timeout).catch(() => { });

        const count = await enabledOptions.count();
        if (count === 0) {
            throw new Error('[Action] Error -> No enabled options found to select!');
        }

        const randomIndex = Math.floor(Math.random() * count);
        const valueToSelect = await enabledOptions.nth(randomIndex).getAttribute('value');

        if (valueToSelect === null) {
            throw new Error(`[Action] Error -> Option at index ${randomIndex} is missing a "value" attribute.`);
        }

        const selected = await element.selectOption({ value: valueToSelect }, { timeout });
        return selected[0];
    }

    async hover(target: Target): Promise<void> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'visible');
        await element.hover({ timeout: this.ELEMENT_TIMEOUT });
    }

    async scrollIntoView(target: Target): Promise<void> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'attached');
        await element.scrollIntoView({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Drags an element to a target element or by a coordinate offset.
     * Absolute-offset drags use the page's mouse API (no Element equivalent
     * exists today); all other paths route through `Element.dragTo`.
     */
    async dragAndDrop(target: Target, options: DragAndDropOptions): Promise<void> {
        const element = toElement(target);
        const timeout = options.timeout ?? this.ELEMENT_TIMEOUT;
        await this.utils.waitForState(element, 'visible', timeout);

        if (options.target) {
            const dropElement = toElement(options.target);
            await this.utils.waitForState(dropElement, 'visible', timeout);

            if (options.xOffset !== undefined && options.yOffset !== undefined) {
                const targetBox = await dropElement.boundingBox();
                if (!targetBox) {
                    throw new Error('[Action] Error -> Unable to get bounding box for target element.');
                }

                const targetPosition = {
                    x: (targetBox.width / 2) + options.xOffset,
                    y: (targetBox.height / 2) + options.yOffset,
                };

                await element.dragTo(dropElement, {
                    targetPosition,
                    timeout,
                });
                return;
            }

            await element.dragTo(dropElement, { timeout });
            return;
        }

        if (options.xOffset !== undefined && options.yOffset !== undefined) {
            // The mouse-drag path has no action method with a built-in timeout,
            // so enforce `timeout` here by requiring the element to actually be
            // visible before reading its bounding box. `Utils.waitForState` only
            // log-warns; this throws, keeping elapsed time bounded.
            await element.waitFor({ state: 'visible', timeout });
            const box = await element.boundingBox();
            if (!box) {
                throw new Error('[Action] Error -> Unable to get bounding box for element to perform drag action.');
            }

            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;

            // Mouse-level drag — no Element equivalent; page.mouse is the documented path.
            await this.page.mouse.move(startX, startY);
            await this.page.mouse.down();
            await this.page.mouse.move(startX + options.xOffset, startY + options.yOffset, { steps: 10 });
            await this.page.mouse.up();
            return;
        }

        throw new Error(`[Action] Error -> You must provide either 'targetLocator', or both 'xOffset' and 'yOffset' in DragAndDropOptions.`);
    }

    /**
     * Filters a locator list and returns the first element matching the given text.
     * Uses Element.filter composition (which delegates to Playwright's filter under the hood).
     */
    public async getByText(
        baseTarget: Target,
        desiredText: string,
        strict: boolean = false,
    ): Promise<Locator | null> {
        const base = toElement(baseTarget);

        const caseSensitive = base.filter({ hasText: desiredText }).first();
        if ((await caseSensitive.count()) > 0) {
            return (caseSensitive as WebElement).locator;
        }

        const escaped = desiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const caseInsensitive = base.filter({ hasText: new RegExp(escaped, 'i') }).first();
        if ((await caseInsensitive.count()) > 0) {
            return (caseInsensitive as WebElement).locator;
        }

        const all = await base.all();
        const rawTexts = await Promise.all(all.map(e => e.textContent()));
        const availableTexts = rawTexts.map(t => (t ?? '').trim()).filter(t => t.length > 0);

        const msg = `getByText: element with text "${desiredText}" not found.\nAvailable texts: ${availableTexts.length > 0 ? `\n- ${availableTexts.join('\n- ')}` : 'None'}`;
        if (strict) throw new Error(msg);
        return null;
    }

    async typeSequentially(target: Target, text: string, delay: number = 100): Promise<void> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'visible');
        await element.pressSequentially(text, delay, { timeout: this.ELEMENT_TIMEOUT });
    }

    /** Right-click (context menu) on the given target. Web-only. */
    async rightClick(target: Target, options?: ActionTimeoutOptions): Promise<void> {
        const element = toElement(target) as WebElement;
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        await this.utils.waitForState(element, 'visible', timeout);
        await element.rightClick({ timeout });
    }

    async doubleClick(target: Target): Promise<void> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'visible');
        await element.doubleClick({ timeout: this.ELEMENT_TIMEOUT });
    }

    async check(target: Target): Promise<void> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'visible');
        await element.check({ timeout: this.ELEMENT_TIMEOUT });
    }

    async uncheck(target: Target): Promise<void> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'visible');
        await element.uncheck({ timeout: this.ELEMENT_TIMEOUT });
    }

    async setSliderValue(target: Target, value: number, options?: ActionTimeoutOptions): Promise<void> {
        const element = toElement(target);
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        await this.utils.waitForState(element, 'visible', timeout);
        await element.fill(String(value), { timeout });
    }

    async pressKey(key: string): Promise<void> {
        await this.page.keyboard.press(key);
    }

    async clearInput(target: Target): Promise<void> {
        const element = toElement(target);
        await this.utils.waitForState(element, 'visible');
        await element.clear({ timeout: this.ELEMENT_TIMEOUT });
    }

    async selectMultiple(target: Target, values: string[], options?: ActionTimeoutOptions): Promise<string[]> {
        // selectOption is web-only; narrow to WebElement.
        const element = toElement(target) as WebElement;
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        await this.utils.waitForState(element, 'visible', timeout);
        return element.selectOption(values.map(v => ({ value: v })), { timeout });
    }

    /**
     * Resolves a specific element from a list by matching visible text or an attribute,
     * with optional child-element drill-down.
     *
     * Returns a Playwright `Locator` because callers downstream need it for
     * `expect(locator).X()` assertions and child-selector composition that
     * doesn't fit the Element abstraction (e.g. `.and()`). Internally, match
     * discovery uses Element methods where possible.
     */
    async getListedElement(
        baseTarget: Target,
        options: ListedElementMatch,
        repo?: { getSelector(elementName: string, pageName: string): string },
    ): Promise<Locator> {
        const baseElement = toElement(baseTarget);
        let matched: Element;

        if (options.text) {
            const caseSensitive = baseElement.filter({ hasText: options.text }).first();
            if ((await caseSensitive.count()) > 0) {
                matched = caseSensitive;
            } else {
                const escaped = options.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                matched = baseElement.filter({ hasText: new RegExp(escaped, 'i') }).first();
            }
        } else if (options.attribute) {
            // Locator.and() composition has no Element equivalent today — drop to Locator.
            const baseLocator = (baseElement as WebElement).locator;
            matched = new WebElement(
                baseLocator
                    .and(this.page.locator(`[${options.attribute.name}="${options.attribute.value}"]`))
                    .first(),
            );
        } else {
            throw new Error('ListedElementOptions requires either "text" or "attribute" to identify the element.');
        }

        await this.utils.waitForState(matched, 'visible');

        if (!options.child) {
            return (matched as WebElement).locator;
        }

        if (typeof options.child === 'string') {
            return (matched.locateChild(options.child) as WebElement).locator;
        }

        if (!repo) {
            throw new Error('An ElementRepository instance is required when "child" is a page-repository reference.');
        }
        const childSelector = repo.getSelector(options.child.elementName, options.child.pageName);
        return (matched.locateChild(childSelector) as WebElement).locator;
    }
}
