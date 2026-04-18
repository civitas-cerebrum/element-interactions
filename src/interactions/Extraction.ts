import { Page } from '@playwright/test';
import { Utils } from '../utils/ElementUtilities';
import { ScreenshotOptions } from '../enum/Options';
import { Element } from '@civitas-cerebrum/element-repository';

/**
 * Read-only accessors for element data: text, attributes, CSS, counts, and
 * screenshots. Pairs with `Interactions` (writes) and `Verifications`
 * (assertions) as the raw low-level layer. Users typically reach these through
 * `ElementInteractions.extract` or via `Steps.get*` / `ElementAction.get*`.
 *
 * Every method takes an `Element` from the repository. Wrap raw Playwright
 * Locators via `new WebElement(locator)` at the call site if you need to bridge.
 */
export class Extractions {
    private ELEMENT_TIMEOUT: number;
    private utils: Utils;

    constructor(private page: Page, timeout: number = 30000) {
        this.ELEMENT_TIMEOUT = timeout;
        this.utils = new Utils(this.ELEMENT_TIMEOUT);
    }

    /** Safely retrieves and trims the text content of an element. */
    async getText(target: Element): Promise<string | null> {
        await this.utils.waitForState(target, 'attached');
        const text = await target.textContent();
        return text?.trim() ?? null;
    }

    /** Retrieves the value of a specified attribute. */
    async getAttribute(target: Element, attributeName: string): Promise<string | null> {
        await this.utils.waitForState(target, 'attached');
        return target.getAttribute(attributeName);
    }

    /** Retrieves the trimmed text content of every element matching the locator. */
    async getAllTexts(target: Element): Promise<string[]> {
        const all = await target.all();
        const texts = await Promise.all(all.map(e => e.textContent()));
        return texts.map(t => (t ?? '').trim());
    }

    /** Retrieves the current value of an input, textarea, or select element. */
    async getInputValue(target: Element): Promise<string> {
        await this.utils.waitForState(target, 'attached');
        return target.inputValue();
    }

    /** Returns the number of DOM elements matching the target. */
    async getCount(target: Element): Promise<number> {
        return target.count();
    }

    /** Retrieves a computed CSS property value from an element. */
    async getCssProperty(target: Element, property: string): Promise<string> {
        await this.utils.waitForState(target, 'attached');
        return target.getCssProperty(property);
    }

    /** Captures a screenshot of the full page or a specific element. */
    async screenshot(target?: Element, options?: ScreenshotOptions): Promise<Buffer> {
        if (target) {
            return target.screenshot({ path: options?.path });
        }
        return await this.page.screenshot({
            fullPage: options?.fullPage,
            path: options?.path,
        }) as Buffer;
    }
}
