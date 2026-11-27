import { writeFile } from 'fs/promises';
import { isFatalDriverError, type Element, type Platform } from '@civitas-cerebrum/element-repository';
import type { IExtractions } from '../interfaces/IExtractions';
import type { ElementSnapshot, EntryTarget } from '../interfaces/IEntryTarget';
import type { ScreenshotOptions } from '../enum/Options';
import type { AppiumDriver, PlatformStrategy } from './platform/PlatformStrategy';
import { strategyFor } from './platform';
import { Utils } from '../utils/ElementUtilities';
import { webOnly } from './unsupported';
import { DEVICE_POLL_ATTACH_MS } from './entry';
import { readOr } from '../utils/visibility';

/**
 * Value extraction for the Appium family. Element reads delegate to the
 * element's primitives (`getAttribute`, `inputValue`, `count`,
 * `boundingBox`, `screenshot`); text is the element's `textContent`
 * (trimmed; on iOS the label, falling back to the value; on Android a
 * container with empty own text reads its descendants' text joined with
 * spaces). Web-only reads (CSS, HTML, page text,
 * storage, window properties, scripts) throw `PlatformNotSupportedError`.
 * The device's page source is `IDevice.getPageSource()`.
 */
export class AppiumExtractions implements IExtractions {
    private readonly utils: Utils;

    constructor(
        private readonly driver: AppiumDriver,
        private readonly platform: Platform,
        timeout: number = 30000,
    ) {
        this.utils = new Utils(timeout);
    }

    private get strategy(): PlatformStrategy {
        return strategyFor(this.platform);
    }

    async getText(target: Element): Promise<string | null> {
        await this.utils.softProbe(target, 'attached');
        return (await target.textContent()) ?? '';
    }

    /**
     * The platform's visible text, trimmed, once the element is attached
     * (waiting up to `timeout`; a transient miss is then read as is, a fatal
     * driver error is thrown).
     */
    async readText(target: Element, timeout: number): Promise<string | null> {
        await target.waitFor({ state: 'attached', timeout }).catch(err => {
            if (isFatalDriverError(err)) throw err;
        });
        return (await target.textContent()) ?? '';
    }

    /**
     * `steps.getAll` on a device. A `picked` target (one match a narrowing
     * strategy chose) is the whole list: `all()` on it would answer every
     * match of its selector again. A `child` is scoped to ONE parent match
     * (element-repository's `locateChild` searches inside the parent's
     * match), so the children of the whole collection are gathered match by
     * match, in order: what the web locator `parent >> child` returns across
     * every parent match.
     */
    async getAllValues(target: Element, options?: { child?: string; attribute?: string; picked?: boolean }): Promise<string[]> {
        const matches = options?.picked ? [target] : await target.all();
        const child = options?.child;
        const items = child === undefined
            ? matches
            : (await Promise.all(matches.map(p => p.locateChild(child).all()))).flat();
        const attribute = options?.attribute;
        if (attribute) {
            const values = await Promise.all(items.map(el => el.getAttribute(attribute)));
            return values.filter((v): v is string => v !== null);
        }
        return await Promise.all(items.map(async el => (await el.textContent()) ?? ''));
    }

    /**
     * Resolves the entry afresh (each `satisfy()` poll calls it again, so
     * every poll re-resolves) and reads the snapshot fields; `attributes`
     * holds the platform strategy's `snapshotAttributes`. A missing element
     * reads as the web defaults (no text, hidden, count 0), but a fatal
     * driver error is thrown, never folded into a snapshot that a predicate
     * such as `el => !el.visible` could pass on. No field is read softly:
     * only a no-match answer gives a field its default (no text, an empty
     * value, no attribute, hidden, disabled, count 0); any other error (a
     * stale reference, an `unknown error`) fails the snapshot, and the
     * `satisfy()` loop retries it, reporting the last error at the timeout,
     * so a predicate such as `el => el.count === 0` or `el => !el.enabled`
     * never passes on a read that failed.
     */
    async captureSnapshot(entry: EntryTarget): Promise<ElementSnapshot> {
        const [element, allElement] = await Promise.all([
            entry.resolve(DEVICE_POLL_ATTACH_MS),
            entry.resolveAll(DEVICE_POLL_ATTACH_MS),
        ]);
        const first = element.first();
        const names = this.strategy.snapshotAttributes;
        const readAttributes = async (): Promise<Record<string, string>> => {
            const values = await Promise.all(names.map(name => readOr(() => first.getAttribute(name), null)));
            const out: Record<string, string> = {};
            names.forEach((name, i) => {
                const v = values[i];
                if (v !== null && v !== undefined) out[name] = v;
            });
            return out;
        };
        const [count, rawText, value, attributes, visible, enabled] = await Promise.all([
            readOr(() => allElement.count(), 0),
            readOr(() => first.textContent(), null),
            readOr(() => first.inputValue(), ''),
            readAttributes(),
            readOr(() => first.isVisible(), false),
            readOr(() => first.isEnabled(), false),
        ]);
        return { text: (rawText ?? '').trim(), value, attributes, visible, enabled, count };
    }

    async getAttribute(target: Element, attributeName: string): Promise<string | null> {
        await this.utils.softProbe(target, 'attached');
        return target.getAttribute(attributeName);
    }

    async getAllTexts(target: Element): Promise<string[]> {
        const all = await target.all();
        return Promise.all(all.map(async e => (await e.textContent()) ?? ''));
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
