import type { Element } from '@civitas-cerebrum/element-repository';
import type { ScreenshotOptions } from '../enum/Options';

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
