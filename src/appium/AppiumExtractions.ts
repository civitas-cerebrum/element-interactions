import { writeFile } from 'fs/promises';
import type { Element, Platform } from '@civitas-cerebrum/element-repository';
import type { IExtractions } from '../interfaces/IExtractions';
import type { ScreenshotOptions } from '../enum/Options';
import type { AppiumDriver } from './platform/PlatformStrategy';
import { AppiumUtils } from './AppiumUtils';
import { webOnly } from './unsupported';

/**
 * Value extraction for the Appium family. Element reads delegate to the
 * element's primitives (`textContent`, `getAttribute`, `inputValue`, `count`,
 * `boundingBox`, `screenshot`). Web-only reads (CSS, HTML, page text,
 * storage, window properties, scripts) throw `PlatformNotSupportedError`.
 * The device's page source is `IDevice.getPageSource()`.
 */
export class AppiumExtractions implements IExtractions {
    private readonly utils: AppiumUtils;

    constructor(
        private readonly driver: AppiumDriver,
        private readonly platform: Platform,
        timeout: number = 30000,
    ) {
        this.utils = new AppiumUtils(timeout);
    }

    async getText(target: Element): Promise<string | null> {
        await this.utils.softProbe(target, 'attached');
        const text = await target.textContent();
        return text?.trim() ?? null;
    }

    async getAttribute(target: Element, attributeName: string): Promise<string | null> {
        await this.utils.softProbe(target, 'attached');
        return target.getAttribute(attributeName);
    }

    async getAllTexts(target: Element): Promise<string[]> {
        const all = await target.all();
        const texts = await Promise.all(all.map(e => e.textContent()));
        return texts.map(t => (t ?? '').trim());
    }

    async getInputValue(target: Element): Promise<string> {
        await this.utils.softProbe(target, 'attached');
        return target.inputValue();
    }

    async getCount(target: Element): Promise<number> {
        return target.count();
    }

    /** `null` when the element is not in the UI tree. */
    async getBoundingBox(target: Element): Promise<{ x: number; y: number; width: number; height: number } | null> {
        await this.utils.softProbe(target, 'attached');
        if (!(await target.exists())) return null;
        return target.boundingBox();
    }

    /** Element screenshot when `target` is given, otherwise the whole screen. `fullPage` has no meaning on a device. */
    async screenshot(target?: Element, options?: ScreenshotOptions): Promise<Buffer> {
        if (target) {
            return target.screenshot({ path: options?.path });
        }
        const buffer = Buffer.from(await this.driver.takeScreenshot(), 'base64');
        if (options?.path) await writeFile(options.path, buffer);
        return buffer;
    }

    // ── Web only ──

    async getCssProperty(_target: Element, _property: string): Promise<string> { return webOnly('getCssProperty', this.platform); }
    async getHtml(_target: Element, _options?: { outer?: boolean }): Promise<string> { return webOnly('getHtml', this.platform); }
    async getPageHtml(_options?: { outer?: boolean }): Promise<string> { return webOnly('getPageHtml', this.platform); }
    async getPageText(): Promise<string> { return webOnly('getPageText', this.platform); }
    async getLocalStorageKeys(): Promise<string[]> { return webOnly('getLocalStorageKeys', this.platform); }
    async getSessionStorageKeys(): Promise<string[]> { return webOnly('getSessionStorageKeys', this.platform); }
    async getLocalStorage(_key: string): Promise<string | null> { return webOnly('getLocalStorage', this.platform); }
    async getSessionStorage(_key: string): Promise<string | null> { return webOnly('getSessionStorage', this.platform); }
    async setLocalStorage(_key: string, _value: string): Promise<void> { webOnly('setLocalStorage', this.platform); }
    async setSessionStorage(_key: string, _value: string): Promise<void> { webOnly('setSessionStorage', this.platform); }
    async removeLocalStorage(_key: string): Promise<void> { webOnly('removeLocalStorage', this.platform); }
    async removeSessionStorage(_key: string): Promise<void> { webOnly('removeSessionStorage', this.platform); }
    async clearLocalStorage(): Promise<void> { webOnly('clearLocalStorage', this.platform); }
    async clearSessionStorage(): Promise<void> { webOnly('clearSessionStorage', this.platform); }
    async getWindowProperty<T = unknown>(_path: string): Promise<T | undefined> { return webOnly('getWindowProperty', this.platform); }
    async setWindowProperty(_path: string, _value: unknown): Promise<void> { webOnly('setWindowProperty', this.platform); }
    async evaluateScript<T = unknown>(_fn: (arg?: unknown) => T | Promise<T>, _arg?: unknown): Promise<T> { return webOnly('evaluateScript', this.platform); }
}
