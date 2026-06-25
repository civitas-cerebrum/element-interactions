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

    private async softProbe(element: WebElement): Promise<void> {
        await this.utils.softProbe(element, 'attached', this.ELEMENT_TIMEOUT);
    }

    /** Safely retrieves and trims the text content of an element. */
    async getText(target: WebElement): Promise<string | null> {
        await this.softProbe(target);
        const text = await target.locator.textContent({ timeout: this.ELEMENT_TIMEOUT });
        return text?.trim() ?? null;
    }

    /** Retrieves the value of a specified attribute. */
    async getAttribute(target: WebElement, attributeName: string): Promise<string | null> {
        await this.softProbe(target);
        return target.locator.getAttribute(attributeName, { timeout: this.ELEMENT_TIMEOUT });
    }

    /** Retrieves the trimmed text content of every element matching the locator. */
    async getAllTexts(target: WebElement): Promise<string[]> {
        const all = await target.all();
        const texts = await Promise.all(
            all.map(e => (e as WebElement).locator.textContent({ timeout: this.ELEMENT_TIMEOUT })),
        );
        return texts.map(t => (t ?? '').trim());
    }

    /** Retrieves the current value of an input, textarea, or select element. */
    async getInputValue(target: WebElement): Promise<string> {
        await this.softProbe(target);
        return target.locator.inputValue({ timeout: this.ELEMENT_TIMEOUT });
    }

    /** Returns the number of DOM elements matching the target. */
    async getCount(target: WebElement): Promise<number> {
        return target.count();
    }

    /** Retrieves a computed CSS property value from an element. */
    async getCssProperty(target: WebElement, property: string): Promise<string> {
        await this.softProbe(target);
        return target.locator.evaluate(
            (el: Element, prop: string) => window.getComputedStyle(el).getPropertyValue(prop),
            property,
        );
    }

    /**
     * Returns the element's bounding box (`{ x, y, width, height }` in CSS
     * pixels relative to the main frame), or `null` when the element is not
     * rendered. Use for layout/geometry assertions the DOM doesn't otherwise
     * surface: overlap, off-screen positioning, collapsed (`0×0`) regions.
     */
    async getBoundingBox(target: WebElement): Promise<{ x: number; y: number; width: number; height: number } | null> {
        // Soft attach-probe so a present element is measured promptly; if it is
        // not in the DOM at all, short-circuit to `null` rather than letting
        // `boundingBox()` block on its own (much longer) auto-wait.
        await this.softProbe(target);
        if ((await target.count()) === 0) {
            return null;
        }
        return target.boundingBox();
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
        await this.softProbe(target);
        const locator = target.locator.first();
        if (options?.outer) {
            return await locator.evaluate((el: Element) => el.outerHTML);
        }
        return await locator.innerHTML({ timeout: this.ELEMENT_TIMEOUT });
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

    /**
     * Reads a value from the browser's `window.localStorage`. Returns `null` if
     * the key is missing — matches the native `localStorage.getItem` contract.
     *
     * Use for reading persisted UI state the framework cannot reach through
     * the DOM (theme preference, dismissed-banner flag, feature toggle, etc.).
     */
    async getLocalStorage(key: string): Promise<string | null> {
        return await this.page.evaluate((k) => window.localStorage.getItem(k), key);
    }

    /**
     * Reads a value from the browser's `window.sessionStorage`. Returns `null` if
     * the key is missing — matches the native `sessionStorage.getItem` contract.
     */
    async getSessionStorage(key: string): Promise<string | null> {
        return await this.page.evaluate((k) => window.sessionStorage.getItem(k), key);
    }

    /**
     * Writes a value to the browser's `window.localStorage` — the mutating
     * companion to {@link getLocalStorage}. Use to seed persisted state a test
     * depends on (a feature toggle, a dismissed-banner flag) or to drive
     * resilience checks with deliberately malformed values (e.g. corrupt JSON).
     * Matches the native `localStorage.setItem` contract (value coerced to string).
     */
    async setLocalStorage(key: string, value: string): Promise<void> {
        await this.page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [key, value]);
    }

    /**
     * Writes a value to the browser's `window.sessionStorage` — the mutating
     * companion to {@link getSessionStorage}. Matches the native
     * `sessionStorage.setItem` contract (value coerced to string).
     */
    async setSessionStorage(key: string, value: string): Promise<void> {
        await this.page.evaluate(([k, v]) => window.sessionStorage.setItem(k, v), [key, value]);
    }

    /**
     * Removes a single key from `window.localStorage`. No-op when the key is
     * absent — matches the native `localStorage.removeItem` contract.
     */
    async removeLocalStorage(key: string): Promise<void> {
        await this.page.evaluate((k) => window.localStorage.removeItem(k), key);
    }

    /**
     * Removes a single key from `window.sessionStorage`. No-op when the key is
     * absent — matches the native `sessionStorage.removeItem` contract.
     */
    async removeSessionStorage(key: string): Promise<void> {
        await this.page.evaluate((k) => window.sessionStorage.removeItem(k), key);
    }

    /**
     * Removes every key from `window.localStorage`. Matches the native
     * `localStorage.clear` contract.
     */
    async clearLocalStorage(): Promise<void> {
        await this.page.evaluate(() => window.localStorage.clear());
    }

    /**
     * Removes every key from `window.sessionStorage`. Matches the native
     * `sessionStorage.clear` contract.
     */
    async clearSessionStorage(): Promise<void> {
        await this.page.evaluate(() => window.sessionStorage.clear());
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
