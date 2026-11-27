import type { Page } from '@playwright/test';
import { PlatformElement, PlatformNotSupportedError, type Element, type Platform } from '@civitas-cerebrum/element-repository';
import type { IVerifications, VerifiableState } from '../interfaces/IVerifications';
import type { EntryTarget } from '../interfaces/IEntryTarget';
import type { CountVerifyOptions, TextVerifyOptions, VerifyOptions, VisualMatchPrimitiveOptions } from '../enum/Options';
import type { AppiumDriver, PlatformStrategy } from './platform/PlatformStrategy';
import { describeValue, pollUntil, PollTimeoutError, softRead } from '../utils/poll';
import { webOnly } from './unsupported';
import { ReResolvingElement } from './ReResolvingElement';
import { DEVICE_POLL_ATTACH_MS, entryLabel, probeVisibleOnDevice } from './entry';
import { countMismatch, describeCountOptions, validateCountOptions } from '../utils/countRange';

type HtmlOptions = VerifyOptions & { outer?: boolean };

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * element-repository's text strategy (`.byText()`) "not found" from a clean
 * lookup: every pass read every match and none had the text. A lookup that
 * met a transient driver error (a failed `$$`, a stale text read) ends its
 * message with `(last driver error: <name>: <message>)` instead, so it does
 * not end with `not found.`.
 *
 * Matched by message: element-repository 0.4.0 throws a plain `Error` here,
 * with no error class or code to tell a clean miss from a pass cut short.
 * The wording is element-repository's own, the same as `getByText`'s:
 * `Element '<name>' on '<page>' with text "<text>" not found.`
 */
const CLEAN_TEXT_NOT_FOUND = /^Element '[\s\S]*' on '[\s\S]*' with text "[\s\S]*" not found\.$/;

function isCleanTextNotFound(err: unknown): boolean {
    return err instanceof Error && CLEAN_TEXT_NOT_FOUND.test(err.message);
}

/**
 * The visibility of the match a selecting (`.byText()`) chain picks:
 * `false` when it is hidden or when a clean pass matches nothing
 * ({@link isCleanTextNotFound}). Every other error is thrown, a transient
 * one too, so a partial read never answers "not displayed": a poll tries
 * again and keeps it as its last error, and a fatal one fails the poll.
 */
async function selectionVisible(read: () => Promise<boolean>): Promise<boolean> {
    try {
        return await read();
    } catch (err) {
        if (isCleanTextNotFound(err)) return false;
        throw err;
    }
}

/** The "not visible" read of a polled target: {@link selectionVisible} for a selecting chain, else a soft read. */
function notVisibleRead(target: Element): () => Promise<boolean> {
    if (target instanceof ReResolvingElement && target.selecting) return () => selectionVisible(() => target.isVisible());
    return () => softRead(() => target.isVisible(), false);
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
        return async () => (await target.textContent()) ?? '';
    }

    // ── Repository entries (fluent chains) ──

    /**
     * A {@link ReResolvingElement} that resolves the entry afresh (one
     * existence check per `fallback` node) on every read, so a poll never
     * keeps reading a node the repository picked earlier; with `collection`,
     * the whole collection. A `.byText()` chain gets the same budget:
     * element-repository's text strategy reads every candidate of a pass it
     * has started, so one poll still finds a later item.
     */
    async pollTarget(entry: EntryTarget, collection: boolean = false): Promise<Element> {
        return new ReResolvingElement(() => collection
            ? entry.resolveAll(DEVICE_POLL_ATTACH_MS)
            : entry.resolve(DEVICE_POLL_ATTACH_MS), entryLabel(entry), !collection && entry.selecting === true);
    }

    /** The re-resolving visibility probe; a fatal driver error is thrown, never read as hidden. */
    async visibleWithin(entry: EntryTarget, timeout: number): Promise<boolean> {
        return probeVisibleOnDevice(entry, timeout);
    }

    /** The re-resolving visibility probe; with `containsText`, the platform's visible text must contain it. */
    async probeVisible(entry: EntryTarget, timeout: number, containsText?: string): Promise<boolean> {
        return probeVisibleOnDevice(entry, timeout, containsText);
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
                { cause: err },
            );
        }
    }

    /**
     * The entry is resolved once through its whole-collection resolver (the
     * repository's `ALL` strategy) with `attachSlice` per `fallback` node, so
     * a `fallback` entry is asserted on the node the repository resolves (the
     * first chain node that exists, exactly as an action would target; the
     * terminal node when none does),
     * and absence means every match of that node is hidden or gone, polled
     * until `timeout`.
     *
     * A chain that picks one match by its text (`.byText()`;
     * {@link EntryTarget.selecting}) is asserted on its selection instead,
     * re-resolved on every poll: absent when the match the selection picks is
     * hidden or when a clean pass of the selection matches nothing (the
     * strategy's "not found" with no driver error), as on web. A pass cut
     * short by a transient driver error is not an answer: the poll tries
     * again. A fatal driver error still fails at once, and a resolution that
     * does not answer is never read as an answer.
     *
     * The web cross-check (default vs `ALL` resolution landing on different
     * nodes) has no device counterpart: there is no element handle to
     * compare, and both resolutions probe a node with the same first-match
     * attach wait, so they walk the chain identically.
     */
    async entryAbsence(entry: EntryTarget, options: { timeout: number; attachSlice: number }): Promise<void> {
        if (entry.selecting) {
            await this.expectEventually(
                () => this.selectionDisplayed(entry),
                visible => !visible,
                'element to be absent (not displayed)',
                { timeout: options.timeout },
            );
            return;
        }
        const all = await entry.resolveAll(options.attachSlice);
        await this.absence(all, { timeout: options.timeout });
    }

    /**
     * Whether the match a selecting chain picks is displayed now
     * ({@link selectionVisible}): not displayed when it is hidden or when a
     * clean pass of the selection matches nothing. Any other error, a
     * transient one included, is thrown, so the poll tries again and keeps it
     * as its last error.
     */
    private async selectionDisplayed(entry: EntryTarget): Promise<boolean> {
        return selectionVisible(async () => (await entry.resolve(DEVICE_POLL_ATTACH_MS)).isVisible());
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
     * first visible match of a set. A lookup that finds nothing is not
     * displayed. A lookup that fails (a failed `$$`) or a read of a match
     * that fails (a stale handle of a list redrawn while shown) did not see
     * the matches, so it is not an answer: its error is thrown, and the poll
     * tries again and keeps it as its last error. A match that really left
     * the tree is not in the next poll's lookup. A fatal driver error (dead
     * session, invalid selector) fails the poll at once, so it can never
     * pass as "absent".
     */
    private async anyDisplayed(target: Element): Promise<boolean> {
        const matches = await target.all();
        for (const match of matches) {
            if (await match.isVisible()) return true;
        }
        return false;
    }

    /**
     * Passes once no match of the element is displayed (hidden or not in the
     * UI tree). A string is an Appium selector, resolved as a platform
     * element. A failed lookup or a failed read of a match is retried, never
     * read as absent; a fatal driver error fails the assertion.
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
                // Negated, an element no lookup finds (a selection that matches
                // nothing, a node not in the tree) is not visible, as web's
                // `not.toBeVisible()`; a fatal driver error still fails, and a
                // probe that does not answer is never read as an answer. A
                // selecting chain is not visible only on a clean "not found":
                // a selection pass cut short by a transient driver error is
                // retried, never read as not visible.
                // Not negated, the lookup's own reason stays the last error.
                if (options.negated) {
                    return this.expectEventually(notVisibleRead(target), v => v, 'element to be visible', options);
                }
                return this.expectEventually(() => target.isVisible(), v => v, 'element to be visible', options);
            case 'inViewport':
                return this.expectEventually(() => target.isVisible(), v => v, 'element to be inViewport', options);
            case 'hidden':
                // One element (a pick of `nth` / TEXT / ATTRIBUTE answers
                // `all()` with every match of its selector, so not `anyDisplayed`).
                // A selecting chain reads as the negated `visible` above.
                return this.expectEventually(notVisibleRead(target), v => !v, 'element to be hidden', options);
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
            return Promise.all(all.map(async e => (await e.textContent()) ?? ''));
        };
    }

    async order(target: Element, expectedTexts: string[], options?: VerifyOptions): Promise<void> {
        await this.expectEventually(this.allTexts(target),
            texts => texts.length === expectedTexts.length && texts.every((t, i) => t === expectedTexts[i]),
            `texts in order ${describeValue(expectedTexts)}`, options);
    }

    async listOrder(target: Element, direction: 'asc' | 'desc', options?: VerifyOptions): Promise<void> {
        await this.expectEventually(this.allTexts(target), texts => {
            const sorted = [...texts].sort((a, b) => direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a));
            return texts.every((t, i) => t === sorted[i]);
        }, `list to be sorted ${direction}ending`, options);
    }

    async count(target: Element, options: CountVerifyOptions, verifyOptions?: VerifyOptions): Promise<void> {
        validateCountOptions(options);
        const negated = verifyOptions?.negated === true;
        // Worded as on web: "Expected count not > 1".
        const expectation = `Expected count ${negated ? 'not ' : ''}${describeCountOptions(options)}`;
        const lead = verifyOptions?.errorMessage ? `${verifyOptions.errorMessage} (${expectation})` : expectation;
        let last: number | undefined;
        await pollUntil(async () => (last = await target.count()), n => countMismatch(options, n, negated) === undefined, {
            timeout: verifyOptions?.timeout ?? this.timeout,
            // Names the bound the last count broke: "... (Expected count > 1 and < 3); 6 is not < 3".
            message: () => {
                const why = last === undefined ? undefined : countMismatch(options, last, negated);
                return why === undefined ? lead : `${lead}; ${why}`;
            },
        });
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
    async images(_imagesTarget: Element, _scroll?: boolean, _options?: { verifyDecoded?: boolean; timeout?: number }): Promise<void> { webOnly('images', this.platform); }
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
