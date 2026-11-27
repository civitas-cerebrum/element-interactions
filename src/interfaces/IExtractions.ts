import type { Element } from '@civitas-cerebrum/element-repository';
import type { ScreenshotOptions } from '../enum/Options';
import type { ElementSnapshot, EntryTarget } from './IEntryTarget';

/**
 * Value extraction: the full contract every driver family implements.
 *
 * Web-only on the Appium family (throws `PlatformNotSupportedError`):
 * `getCssProperty`, `getHtml`, `getPageHtml`, `getPageText`, every
 * `*LocalStorage*` / `*SessionStorage*`, `getWindowProperty`,
 * `setWindowProperty`, `evaluateScript`. The device page source is
 * `IDevice.getPageSource()`.
 */
export interface IExtractions {
    getText(target: Element): Promise<string | null>;
    /**
     * The element's text, trimmed, read once it is attached (waiting up to
     * `timeout` ms; a missing element is then read as is). The fluent chain's
     * `getText()`. On a device, the platform's visible text.
     */
    readText(target: Element, timeout: number): Promise<string | null>;
    /**
     * Every value `steps.getAll` returns for `target` (already resolved with
     * the step's strategy): each match's trimmed text, or with `attribute`
     * the attribute's value (matches without it are left out). With `child`
     * (a selector), the children matching it inside every match, in order.
     * `picked`: `target` is ONE match a narrowing strategy chose, so it is the
     * whole list.
     */
    getAllValues(target: Element, options?: { child?: string; attribute?: string; picked?: boolean }): Promise<string[]>;
    /**
     * The state of the entry's element at this moment, for `satisfy()`
     * predicates and the matcher tree. `count` is the whole collection's;
     * the other fields read the chain's element. `attributes` holds every
     * attribute on web and the attributes the platform's driver documents on
     * a device.
     */
    captureSnapshot(entry: EntryTarget): Promise<ElementSnapshot>;
    getAttribute(target: Element, attributeName: string): Promise<string | null>;
    getAllTexts(target: Element): Promise<string[]>;
    getInputValue(target: Element): Promise<string>;
    getCount(target: Element): Promise<number>;
    /** Web only. */
    getCssProperty(target: Element, property: string): Promise<string>;
    getBoundingBox(target: Element): Promise<{ x: number; y: number; width: number; height: number } | null>;
    /** Web only. */
    getHtml(target: Element, options?: { outer?: boolean }): Promise<string>;
    /** Web only. */
    getPageHtml(options?: { outer?: boolean }): Promise<string>;
    /** Web only. */
    getPageText(): Promise<string>;
    /** Web only. */
    getLocalStorageKeys(): Promise<string[]>;
    /** Web only. */
    getSessionStorageKeys(): Promise<string[]>;
    /** Web only. */
    getLocalStorage(key: string): Promise<string | null>;
    /** Web only. */
    getSessionStorage(key: string): Promise<string | null>;
    /** Web only. */
    setLocalStorage(key: string, value: string): Promise<void>;
    /** Web only. */
    setSessionStorage(key: string, value: string): Promise<void>;
    /** Web only. */
    removeLocalStorage(key: string): Promise<void>;
    /** Web only. */
    removeSessionStorage(key: string): Promise<void>;
    /** Web only. */
    clearLocalStorage(): Promise<void>;
    /** Web only. */
    clearSessionStorage(): Promise<void>;
    /** Web only. */
    getWindowProperty<T = unknown>(path: string): Promise<T | undefined>;
    /** Web only. */
    setWindowProperty(path: string, value: unknown): Promise<void>;
    /** Web only. */
    evaluateScript<T = unknown>(fn: (arg?: unknown) => T | Promise<T>, arg?: unknown): Promise<T>;
    /** Element screenshot when `target` is given, otherwise the whole screen / page. */
    screenshot(target?: Element, options?: ScreenshotOptions): Promise<Buffer>;
}
