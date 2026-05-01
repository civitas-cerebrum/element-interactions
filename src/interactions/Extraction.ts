import { Page } from '@playwright/test';
import { Utils } from '../utils/ElementUtilities';
import { ScreenshotOptions } from '../enum/Options';
import { WebElement } from '@civitas-cerebrum/element-repository';

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
    async getText(target: WebElement): Promise<string | null> {
        await this.utils.waitForState(target, 'attached');
        const text = await target.textContent();
        return text?.trim() ?? null;
    }

    /** Retrieves the value of a specified attribute. */
    async getAttribute(target: WebElement, attributeName: string): Promise<string | null> {
        await this.utils.waitForState(target, 'attached');
        return target.getAttribute(attributeName);
    }

    /** Retrieves the trimmed text content of every element matching the locator. */
    async getAllTexts(target: WebElement): Promise<string[]> {
        const all = await target.all();
        const texts = await Promise.all(all.map(e => e.textContent()));
        return texts.map(t => (t ?? '').trim());
    }

    /** Retrieves the current value of an input, textarea, or select element. */
    async getInputValue(target: WebElement): Promise<string> {
        await this.utils.waitForState(target, 'attached');
        return target.inputValue();
    }

    /** Returns the number of DOM elements matching the target. */
    async getCount(target: WebElement): Promise<number> {
        return target.count();
    }

    /** Retrieves a computed CSS property value from an element. */
    async getCssProperty(target: WebElement, property: string): Promise<string> {
        await this.utils.waitForState(target, 'attached');
        return target.getCssProperty(property);
    }

    /**
     * Retrieves the raw HTML of an element. Defaults to `innerHTML`; set
     * `{ outer: true }` for `outerHTML` (the element tag plus its subtree).
     *
     * Reads after waiting for `attached` so the element exists in the DOM,
     * but does NOT wait for visibility — HTML inspection is a lower-level
     * read than the standard verification family.
     */
    async getHtml(target: WebElement, options?: { outer?: boolean }): Promise<string> {
        await this.utils.waitForState(target, 'attached');
        const locator = target.locator.first();
        if (options?.outer) {
            return await locator.evaluate((el: Element) => el.outerHTML);
        }
        return await locator.innerHTML();
    }

    /**
     * Retrieves the HTML of the current page. Defaults to `document.body.innerHTML`;
     * set `{ outer: true }` for `document.documentElement.outerHTML` (the full
     * `<html>...</html>` document, including `<head>`).
     *
     * Use this for page-level scans where no single element is the natural
     * scope — e.g. confirming an injected payload was HTML-escaped anywhere
     * in the rendered page.
     */
    async getPageHtml(options?: { outer?: boolean }): Promise<string> {
        if (options?.outer) {
            return await this.page.evaluate(() => document.documentElement.outerHTML);
        }
        return await this.page.evaluate(() => document.body.innerHTML);
    }

    /** Captures a screenshot of the full page or a specific element. */
    async screenshot(target?: WebElement, options?: ScreenshotOptions): Promise<Buffer> {
        if (target) {
            return target.screenshot({ path: options?.path });
        }
        return await this.page.screenshot({
            fullPage: options?.fullPage,
            path: options?.path,
        }) as Buffer;
    }
}
