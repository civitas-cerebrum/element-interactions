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

    /**
     * Reads a value from the `window` object by dotted path — e.g.
     * `'__XSS_FIRED'`, `'dataLayer.length'`, `'document.title'`. Walks the path
     * key-by-key, returning `undefined` the moment any intermediate segment is
     * `null`/`undefined` (so a missing path is `undefined`, never a thrown error).
     *
     * Use for asserting window-level JS state the DOM doesn't surface: analytics
     * layers, injected flags, feature toggles, XSS-fired sentinels, etc.
     */
    async getWindowProperty<T = unknown>(path: string): Promise<T | undefined> {
        return await this.page.evaluate(
            (p) => p.split('.').reduce((o: unknown, k: string) => (o == null ? o : (o as Record<string, unknown>)[k]), window as unknown),
            path,
        ) as T | undefined;
    }

    /**
     * Writes a value onto the `window` object by dotted path, creating any
     * missing intermediate objects along the way — e.g.
     * `setWindowProperty('__test.flag', true)` ensures `window.__test` exists
     * then sets `.flag`. The mutating companion to {@link getWindowProperty};
     * use to seed window-level state a test depends on.
     */
    async setWindowProperty(path: string, value: unknown): Promise<void> {
        await this.page.evaluate(
            ({ p, v }) => {
                const keys = p.split('.');
                const last = keys.pop() as string;
                let obj = window as unknown as Record<string, unknown>;
                for (const k of keys) {
                    if (obj[k] == null || typeof obj[k] !== 'object') {
                        obj[k] = {};
                    }
                    obj = obj[k] as Record<string, unknown>;
                }
                obj[last] = v;
            },
            { p: path, v: value },
        );
    }

    /**
     * The single typed escape hatch for arbitrary in-page JavaScript:
     * `page.evaluate(fn, arg)`. This raw interaction does NOT log — the logged
     * wrapper is `Steps.evaluateScript`; prefer it (and the targeted steps
     * `getWindowProperty`, `verifyWindowProperty`, the matcher tree, scoped
     * queries) which stay named, retrying, and grep-able. Reach here only when
     * no targeted step expresses the read. `fn` may be sync or `async`.
     *
     * @param fn  A function serialised and run in the browser context.
     * @param arg An optional, serialisable argument passed to `fn`.
     */
    async evaluateScript<T = unknown>(fn: (arg?: unknown) => T | Promise<T>, arg?: unknown): Promise<T> {
        return await this.page.evaluate(fn, arg);
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
