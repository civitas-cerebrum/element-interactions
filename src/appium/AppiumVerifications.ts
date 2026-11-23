import type { Page } from '@playwright/test';
import { PlatformElement, PlatformNotSupportedError, type Element, type Platform } from '@civitas-cerebrum/element-repository';
import type { IVerifications, VerifiableState } from '../interfaces/IVerifications';
import type { EntryTarget } from '../interfaces/IEntryTarget';
import type { CountVerifyOptions, TextVerifyOptions, VerifyOptions, VisualMatchPrimitiveOptions } from '../enum/Options';
import type { AppiumDriver, PlatformStrategy } from './platform/PlatformStrategy';
import { describeValue, pollUntil, PollTimeoutError } from '../utils/poll';
import { webOnly } from './unsupported';
import { softRead } from '../utils/driverErrors';
import { ReResolvingElement } from './ReResolvingElement';
import { DEVICE_POLL_ATTACH_MS, entryLabel, probeVisibleOnDevice } from './entry';

type HtmlOptions = VerifyOptions & { outer?: boolean };

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Retrying assertions for the Appium family. Every element assertion polls
 * the element's primitives with {@link pollUntil} (100 ms interval) until
 * its timeout (`options.timeout`, else the instance timeout) and then throws
 * with the last observed value. `negated` inverts the condition;
 * `errorMessage` leads the failure message. Web-only assertions throw
 * `PlatformNotSupportedError(method, platform)`.
 */
export class AppiumVerifications implements IVerifications {
    constructor(
        private readonly driver: AppiumDriver,
        private readonly strategy: PlatformStrategy,
        private readonly timeout: number = 30000,
    ) {}

    private get platform(): Platform {
        return this.strategy.platform;
    }

    /**
     * Polls `probe` until `passes(value)` (inverted when `negated`) holds.
     * `describe` says what was expected, without the negation.
     */
    private async expectEventually<T>(
        probe: () => Promise<T>,
        passes: (value: T) => boolean,
        describe: string,
        options?: VerifyOptions,
    ): Promise<void> {
        const negated = options?.negated === true;
        const expectation = negated ? `Expected NOT ${describe}` : `Expected ${describe}`;
        await pollUntil(probe, value => passes(value) !== negated, {
            timeout: options?.timeout ?? this.timeout,
            message: options?.errorMessage ? `${options.errorMessage} (${expectation})` : expectation,
        });
    }

    private readText(target: Element): () => Promise<string> {
        return async () => (await this.strategy.readText(target)).trim();
    }

    // ── Repository entries (fluent chains) ──

    /**
     * A {@link ReResolvingElement} that resolves the entry afresh (one
     * existence check per `fallback` node) on every read, so a poll never
     * keeps reading a node the repository picked earlier; with `collection`,
     * the whole collection.
     */
    async pollTarget(entry: EntryTarget, collection: boolean = false): Promise<Element> {
        return new ReResolvingElement(() => collection
            ? entry.resolveAll(DEVICE_POLL_ATTACH_MS)
            : entry.resolve(DEVICE_POLL_ATTACH_MS), entryLabel(entry));
    }

    /** The re-resolving visibility probe; a fatal driver error is thrown, never read as hidden. */
    async visibleWithin(entry: EntryTarget, timeout: number): Promise<boolean> {
        return probeVisibleOnDevice(entry, timeout, element => this.strategy.readText(element));
    }

    /** The re-resolving visibility probe; with `containsText`, the platform's visible text must contain it. */
    async probeVisible(entry: EntryTarget, timeout: number, containsText?: string): Promise<boolean> {
        return probeVisibleOnDevice(entry, timeout, element => this.strategy.readText(element), containsText);
    }

    /**
     * At least one match of the collection is displayed within `timeout`,
     * polled with the whole collection re-resolved on every poll. A fatal
     * driver error is never read as "not displayed".
     */
    async listPresence(entry: EntryTarget, timeout: number): Promise<void> {
        let lastCount = 0;
        try {
            await pollUntil(async () => {
                const matches = await (await entry.resolveAll(DEVICE_POLL_ATTACH_MS)).all();
                lastCount = matches.length;
                for (const match of matches) {
                    if (await softRead(() => match.isVisible(), false)) return true;
                }
                return false;
            }, visible => visible, { timeout });
        } catch (err) {
            if (!(err instanceof PollTimeoutError)) throw err;
            const cause = err.lastError instanceof Error ? ` Last error: ${err.lastError.message}` : '';
            throw new Error(
                `verifyPresence: ${entryLabel(entry)} is a list entry ("list": true) — ` +
                `expected at least one visible match within ${timeout}ms, found ${lastCount} match(es) and none visible.${cause}`,
            );
        }
    }

    /**
     * The entry is resolved once through its whole-collection resolver (the
     * repository's `ALL` strategy) with `attachSlice` per `fallback` node, so a `fallback` entry is asserted on
     * the node the repository resolves (the first chain node that exists,
     * exactly as an action would target; the terminal node when none does),
     * and absence means every match of that node is hidden or gone, polled
     * until `timeout`. A strategy selector does not narrow it (as on web).
     *
     * The web cross-check (default vs `ALL` resolution landing on different
     * nodes) has no device counterpart: there is no element handle to
     * compare, and both resolutions probe a node with the same first-match
     * attach wait, so they walk the chain identically.
     */
    async entryAbsence(entry: EntryTarget, options: { timeout: number; attachSlice: number }): Promise<void> {
        const all = await entry.resolveAll(options.attachSlice);
        await this.absence(all, { timeout: options.timeout });
    }

    // ── Text ──

    async text(target: Element, expectedText?: string, options?: TextVerifyOptions & VerifyOptions): Promise<void> {
        if (options?.notEmpty) {
            await this.expectEventually(this.readText(target), t => t.length > 0, 'element text to be non-empty', options);
            return;
        }
        if (expectedText === undefined) {
            throw new Error(`You must provide either an 'expectedText' string or set '{ notEmpty: true }' in options.`);
        }
        await this.expectEventually(this.readText(target), t => t === expectedText, `text ${describeValue(expectedText)}`, options);
    }

    async textContains(target: Element, expectedText: string, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(this.readText(target), t => t.includes(expectedText), `text to contain ${describeValue(expectedText)}`, options);
    }

    async textMatches(target: Element, regex: RegExp, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(this.readText(target), t => new RegExp(regex.source, regex.flags).test(t), `text to match ${regex}`, options);
    }

    async textStartsWith(target: Element, prefix: string, options?: VerifyOptions): Promise<void> {
        await this.textMatches(target, new RegExp('^' + escapeRegex(prefix)), options);
    }

    async textEndsWith(target: Element, suffix: string, options?: VerifyOptions): Promise<void> {
        await this.textMatches(target, new RegExp(escapeRegex(suffix) + '$'), options);
    }

    // ── Presence and state ──

    async presence(target: Element, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(() => target.isVisible(), v => v, 'element to be displayed', options);
    }

    /**
     * Whether ANY match of `target` is displayed now: every match from
     * `all()` (one at most for an element narrowed by `first()` / `nth()`,
     * the whole collection for an un-narrowed one or for an element picked
     * from a set, whose `all()` re-queries its selector), so absence holds only
     * when every match is hidden or gone, as the web family's absence on the
     * first visible match of a set. A lookup or read that fails transiently
     * (no such element, stale element) counts as not displayed; a fatal
     * driver error (dead session, invalid selector) is rethrown, so it can
     * never pass as "absent".
     */
    private async anyDisplayed(target: Element): Promise<boolean> {
        const matches = await softRead(() => target.all(), [] as Element[]);
        for (const match of matches) {
            if (await softRead(() => match.isVisible(), false)) return true;
        }
        return false;
    }

    /**
     * Passes once no match of the element is displayed (hidden or not in the
     * UI tree). A string is an Appium selector, resolved as a platform
     * element. A transient lookup failure counts as absent; a fatal driver
     * error fails the assertion.
     */
    async absence(selectorOrTarget: Element | string, options?: VerifyOptions): Promise<void> {
        const target = typeof selectorOrTarget === 'string'
            ? new PlatformElement(this.driver, selectorOrTarget, undefined, options?.timeout ?? this.timeout, { platform: this.platform })
            : selectorOrTarget;
        await this.expectEventually(
            () => this.anyDisplayed(target),
            visible => !visible,
            'element to be absent (not displayed)',
            options,
        );
    }

    async state(target: Element, state: VerifiableState, options?: VerifyOptions): Promise<void>;
    async state(locator: string, state: VerifiableState, timeout?: number): Promise<void>;
    /**
     * `editable` is enabled on a device (no read-only flag across drivers);
     * `inViewport` is displayed. `focused` reads the strategy's focus
     * attribute and throws `PlatformNotSupportedError` where there is none.
     * A raw selector string is the web overload and throws.
     */
    async state(target: Element | string, state: VerifiableState, timeoutOrOptions?: number | VerifyOptions): Promise<void> {
        if (typeof target === 'string') webOnly('state', this.platform);
        const options: VerifyOptions = typeof timeoutOrOptions === 'number' ? { timeout: timeoutOrOptions } : (timeoutOrOptions ?? {});
        switch (state) {
            case 'enabled':
            case 'editable':
                return this.expectEventually(() => target.isEnabled(), v => v, `element to be ${state}`, options);
            case 'disabled':
                return this.expectEventually(() => target.isEnabled(), v => !v, 'element to be disabled', options);
            case 'checked':
                return this.expectEventually(() => target.isChecked(), v => v, 'element to be checked', options);
            case 'visible':
            case 'inViewport':
                return this.expectEventually(() => target.isVisible(), v => v, `element to be ${state}`, options);
            case 'hidden':
                // One element (a pick of `nth` / TEXT / ATTRIBUTE answers
                // `all()` with every match of its selector, so not `anyDisplayed`).
                return this.expectEventually(() => softRead(() => target.isVisible(), false), v => !v, 'element to be hidden', options);
            case 'attached':
                return this.expectEventually(() => target.exists(), v => v, 'element to be attached', options);
            case 'focused': {
                const attribute = this.strategy.focusedAttribute;
                if (!attribute) throw new PlatformNotSupportedError("state('focused')", this.platform);
                return this.expectEventually(
                    async () => target.getAttribute(attribute),
                    v => v === 'true',
                    'element to be focused',
                    options,
                );
            }
            default:
                throw new Error(`Unknown state "${state as string}".`);
        }
    }

    // ── Attributes ──

    async attribute(target: Element, attributeName: string, expectedValue: string, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(() => target.getAttribute(attributeName), v => v === expectedValue,
            `attribute "${attributeName}" to be ${describeValue(expectedValue)}`, options);
    }

    async attributeContains(target: Element, attributeName: string, substring: string, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(() => target.getAttribute(attributeName), v => v !== null && v.includes(substring),
            `attribute "${attributeName}" to contain ${describeValue(substring)}`, options);
    }

    async attributeMatches(target: Element, attributeName: string, regex: RegExp, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(() => target.getAttribute(attributeName),
            v => v !== null && new RegExp(regex.source, regex.flags).test(v),
            `attribute "${attributeName}" to match ${regex}`, options);
    }

    async hasAttribute(target: Element, attributeName: string, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(() => target.getAttribute(attributeName), v => v !== null,
            `attribute "${attributeName}" to be present`, options);
    }

    // ── Input values ──

    async inputValue(target: Element, expectedValue: string, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(() => target.inputValue(), v => v === expectedValue, `input value ${describeValue(expectedValue)}`, options);
    }

    async inputValueContains(target: Element, substring: string, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(() => target.inputValue(), v => v.includes(substring), `input value to contain ${describeValue(substring)}`, options);
    }

    async inputValueMatches(target: Element, regex: RegExp, options?: VerifyOptions): Promise<void> {
        await this.expectEventually(() => target.inputValue(), v => new RegExp(regex.source, regex.flags).test(v), `input value to match ${regex}`, options);
    }

    async inputValueStartsWith(target: Element, prefix: string, options?: VerifyOptions): Promise<void> {
        await this.inputValueMatches(target, new RegExp('^' + escapeRegex(prefix)), options);
    }

    async inputValueEndsWith(target: Element, suffix: string, options?: VerifyOptions): Promise<void> {
        await this.inputValueMatches(target, new RegExp(escapeRegex(suffix) + '$'), options);
    }

    // ── Lists and counts ──

    private allTexts(target: Element): () => Promise<string[]> {
        return async () => {
            const all = await target.all();
            return Promise.all(all.map(async e => (await this.strategy.readText(e)).trim()));
        };
    }

    async order(target: Element, expectedTexts: string[]): Promise<void> {
        await this.expectEventually(this.allTexts(target),
            texts => texts.length === expectedTexts.length && texts.every((t, i) => t === expectedTexts[i]),
            `texts in order ${describeValue(expectedTexts)}`);
    }

    async listOrder(target: Element, direction: 'asc' | 'desc'): Promise<void> {
        await this.expectEventually(this.allTexts(target), texts => {
            const sorted = [...texts].sort((a, b) => direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a));
            return texts.every((t, i) => t === sorted[i]);
        }, `list to be sorted ${direction}ending`);
    }

    async count(target: Element, options: CountVerifyOptions, verifyOptions?: VerifyOptions): Promise<void> {
        if (options.exactly !== undefined && options.exactly < 0) throw new Error(`'exact' count cannot be negative.`);
        if (options.greaterThan !== undefined && options.greaterThan < 0) throw new Error(`'greaterThan' count cannot be negative.`);
        if (options.lessThan !== undefined && options.lessThan <= 0) {
            throw new Error(`'lessThan' must be greater than 0. Element counts cannot be negative.`);
        }
        if (options.greaterThanOrEqual !== undefined && options.greaterThanOrEqual < 0) throw new Error(`'greaterThanOrEqual' count cannot be negative.`);
        if (options.lessThanOrEqual !== undefined && options.lessThanOrEqual < 0) throw new Error(`'lessThanOrEqual' count cannot be negative.`);
        if (
            options.exactly === undefined && options.greaterThan === undefined && options.lessThan === undefined
            && options.greaterThanOrEqual === undefined && options.lessThanOrEqual === undefined
        ) {
            throw new Error(`You must provide 'exact', 'greaterThan', 'lessThan', 'greaterThanOrEqual', or 'lessThanOrEqual' in CountVerifyOptions.`);
        }
        const describe = [
            options.exactly !== undefined ? `exactly ${options.exactly}` : null,
            options.greaterThan !== undefined ? `> ${options.greaterThan}` : null,
            options.lessThan !== undefined ? `< ${options.lessThan}` : null,
            options.greaterThanOrEqual !== undefined ? `>= ${options.greaterThanOrEqual}` : null,
            options.lessThanOrEqual !== undefined ? `<= ${options.lessThanOrEqual}` : null,
        ].filter(Boolean).join(' and ');
        await this.expectEventually(() => target.count(), n =>
            (options.exactly === undefined || n === options.exactly) &&
            (options.greaterThan === undefined || n > options.greaterThan) &&
            (options.lessThan === undefined || n < options.lessThan) &&
            (options.greaterThanOrEqual === undefined || n >= options.greaterThanOrEqual) &&
            (options.lessThanOrEqual === undefined || n <= options.lessThanOrEqual),
        `count ${describe}`, verifyOptions);
    }

    // ── Captured values (no polling: both values are already in hand) ──

    expectEqual(actual: string | null, expected: string | null): void {
        if (actual !== expected) {
            throw new Error(`Expected values to be equal.\n  Actual:   "${actual}"\n  Expected: "${expected}"`);
        }
    }

    expectNotEqual(actual: string | null, notExpected: string | null): void {
        if (actual === notExpected) {
            throw new Error(`Expected values to differ, but both were: "${actual}"`);
        }
    }

    // ── Web only ──

    async urlContains(_text: string): Promise<void> { webOnly('urlContains', this.platform); }
    async pageContainsText(_text: string | RegExp, _options?: VerifyOptions): Promise<void> { webOnly('pageContainsText', this.platform); }
    async pageNotContainsText(_text: string | RegExp, _options?: VerifyOptions): Promise<void> { webOnly('pageNotContainsText', this.platform); }
    async pageTitle(_title: string | RegExp, _options?: VerifyOptions): Promise<void> { webOnly('pageTitle', this.platform); }
    async html(_target: Element, _expected: string, _options?: HtmlOptions): Promise<void> { webOnly('html', this.platform); }
    async htmlContains(_target: Element, _substring: string, _options?: HtmlOptions): Promise<void> { webOnly('htmlContains', this.platform); }
    async htmlMatches(_target: Element, _regex: RegExp, _options?: HtmlOptions): Promise<void> { webOnly('htmlMatches', this.platform); }
    async htmlStartsWith(_target: Element, _prefix: string, _options?: HtmlOptions): Promise<void> { webOnly('htmlStartsWith', this.platform); }
    async htmlEndsWith(_target: Element, _suffix: string, _options?: HtmlOptions): Promise<void> { webOnly('htmlEndsWith', this.platform); }
    async pageHtml(_expected: string, _options?: HtmlOptions): Promise<void> { webOnly('pageHtml', this.platform); }
    async pageHtmlContains(_substring: string, _options?: HtmlOptions): Promise<void> { webOnly('pageHtmlContains', this.platform); }
    async pageHtmlMatches(_regex: RegExp, _options?: HtmlOptions): Promise<void> { webOnly('pageHtmlMatches', this.platform); }
    async pageHtmlStartsWith(_prefix: string, _options?: HtmlOptions): Promise<void> { webOnly('pageHtmlStartsWith', this.platform); }
    async pageHtmlEndsWith(_suffix: string, _options?: HtmlOptions): Promise<void> { webOnly('pageHtmlEndsWith', this.platform); }
    async localStorage(_key: string, _expected: string, _options?: VerifyOptions): Promise<void> { webOnly('localStorage', this.platform); }
    async localStorageContains(_key: string, _substring: string, _options?: VerifyOptions): Promise<void> { webOnly('localStorageContains', this.platform); }
    async localStorageMatches(_key: string, _regex: RegExp, _options?: VerifyOptions): Promise<void> { webOnly('localStorageMatches', this.platform); }
    async localStoragePresent(_key: string, _options?: VerifyOptions): Promise<void> { webOnly('localStoragePresent', this.platform); }
    async sessionStorage(_key: string, _expected: string, _options?: VerifyOptions): Promise<void> { webOnly('sessionStorage', this.platform); }
    async sessionStorageContains(_key: string, _substring: string, _options?: VerifyOptions): Promise<void> { webOnly('sessionStorageContains', this.platform); }
    async sessionStorageMatches(_key: string, _regex: RegExp, _options?: VerifyOptions): Promise<void> { webOnly('sessionStorageMatches', this.platform); }
    async sessionStoragePresent(_key: string, _options?: VerifyOptions): Promise<void> { webOnly('sessionStoragePresent', this.platform); }
    async windowProperty(_path: string, _predicate: (value: unknown) => boolean, _describe: string, _options?: VerifyOptions): Promise<void> {
        webOnly('windowProperty', this.platform);
    }
    async images(_imagesTarget: Element, _scroll?: boolean, _options?: { verifyDecoded?: boolean }): Promise<void> { webOnly('images', this.platform); }
    async tabCount(_expectedCount: number): Promise<void> { webOnly('tabCount', this.platform); }
    async cssProperty(_target: Element, _property: string, _expectedValue: string, _options?: VerifyOptions): Promise<void> { webOnly('cssProperty', this.platform); }
    async cssPropertyContains(_target: Element, _property: string, _substring: string, _options?: VerifyOptions): Promise<void> {
        webOnly('cssPropertyContains', this.platform);
    }
    async cssPropertyMatches(_target: Element, _property: string, _regex: RegExp, _options?: VerifyOptions): Promise<void> {
        webOnly('cssPropertyMatches', this.platform);
    }
    async visuallyMatches(_target: Element | Page, _snapshotName?: string, _options?: VisualMatchPrimitiveOptions): Promise<void> {
        webOnly('visuallyMatches', this.platform);
    }
}
