import type { Page } from '@playwright/test';
import type { Element } from '@civitas-cerebrum/element-repository';
import type { CountVerifyOptions, TextVerifyOptions, VerifyOptions, VisualMatchPrimitiveOptions } from '../enum/Options';

/** The element states `state()` can assert. */
export type VerifiableState =
    | 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused'
    | 'visible' | 'hidden' | 'attached' | 'inViewport';

type HtmlOptions = VerifyOptions & { outer?: boolean };

/**
 * Retrying assertions: the full contract every driver family implements.
 * Every element assertion polls until its timeout in both families.
 *
 * Web-only on the Appium family (throws `PlatformNotSupportedError`):
 * `urlContains`, `pageContainsText`, `pageNotContainsText`, `pageTitle`,
 * every `html*` / `pageHtml*`, every `localStorage*` / `sessionStorage*`,
 * `windowProperty`, `images`, `tabCount`, every `cssProperty*`,
 * `visuallyMatches` (takes a Playwright `Page` and `Locator` masks), and
 * `state(selector: string, ...)` (a raw Playwright selector string).
 */
export interface IVerifications {
    text(target: Element, expectedText?: string, options?: TextVerifyOptions & VerifyOptions): Promise<void>;
    textContains(target: Element, expectedText: string, options?: VerifyOptions): Promise<void>;
    textMatches(target: Element, regex: RegExp, options?: VerifyOptions): Promise<void>;
    textStartsWith(target: Element, prefix: string, options?: VerifyOptions): Promise<void>;
    textEndsWith(target: Element, suffix: string, options?: VerifyOptions): Promise<void>;
    presence(target: Element, options?: VerifyOptions): Promise<void>;
    absence(selectorOrTarget: Element | string, options?: VerifyOptions): Promise<void>;
    state(target: Element, state: VerifiableState, options?: VerifyOptions): Promise<void>;
    /** Web only (raw Playwright selector). */
    state(locator: string, state: VerifiableState, timeout?: number): Promise<void>;
    /** Web only. */
    urlContains(text: string): Promise<void>;
    /** Web only. */
    pageContainsText(text: string | RegExp, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    pageNotContainsText(text: string | RegExp, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    pageTitle(title: string | RegExp, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    html(target: Element, expected: string, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    htmlContains(target: Element, substring: string, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    htmlMatches(target: Element, regex: RegExp, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    htmlStartsWith(target: Element, prefix: string, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    htmlEndsWith(target: Element, suffix: string, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    pageHtml(expected: string, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    pageHtmlContains(substring: string, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    pageHtmlMatches(regex: RegExp, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    pageHtmlStartsWith(prefix: string, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    pageHtmlEndsWith(suffix: string, options?: HtmlOptions): Promise<void>;
    /** Web only. */
    localStorage(key: string, expected: string, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    localStorageContains(key: string, substring: string, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    localStorageMatches(key: string, regex: RegExp, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    localStoragePresent(key: string, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    sessionStorage(key: string, expected: string, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    sessionStorageContains(key: string, substring: string, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    sessionStorageMatches(key: string, regex: RegExp, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    sessionStoragePresent(key: string, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    windowProperty(path: string, predicate: (value: unknown) => boolean, describe: string, options?: VerifyOptions): Promise<void>;
    attribute(target: Element, attributeName: string, expectedValue: string, options?: VerifyOptions): Promise<void>;
    attributeContains(target: Element, attributeName: string, substring: string, options?: VerifyOptions): Promise<void>;
    attributeMatches(target: Element, attributeName: string, regex: RegExp, options?: VerifyOptions): Promise<void>;
    hasAttribute(target: Element, attributeName: string, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    images(imagesTarget: Element, scroll?: boolean, options?: { verifyDecoded?: boolean }): Promise<void>;
    inputValue(target: Element, expectedValue: string, options?: VerifyOptions): Promise<void>;
    inputValueContains(target: Element, substring: string, options?: VerifyOptions): Promise<void>;
    inputValueMatches(target: Element, regex: RegExp, options?: VerifyOptions): Promise<void>;
    inputValueStartsWith(target: Element, prefix: string, options?: VerifyOptions): Promise<void>;
    inputValueEndsWith(target: Element, suffix: string, options?: VerifyOptions): Promise<void>;
    /** Web only (browser tabs). */
    tabCount(expectedCount: number): Promise<void>;
    expectEqual(actual: string | null, expected: string | null): void;
    expectNotEqual(actual: string | null, notExpected: string | null): void;
    order(target: Element, expectedTexts: string[]): Promise<void>;
    /** Web only. */
    cssProperty(target: Element, property: string, expectedValue: string, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    cssPropertyContains(target: Element, property: string, substring: string, options?: VerifyOptions): Promise<void>;
    /** Web only. */
    cssPropertyMatches(target: Element, property: string, regex: RegExp, options?: VerifyOptions): Promise<void>;
    listOrder(target: Element, direction: 'asc' | 'desc'): Promise<void>;
    count(target: Element, options: CountVerifyOptions, verifyOptions?: VerifyOptions): Promise<void>;
    /** Web only (Playwright `Page` target and `Locator` masks). */
    visuallyMatches(target: Element | Page, snapshotName?: string, options?: VisualMatchPrimitiveOptions): Promise<void>;
}
