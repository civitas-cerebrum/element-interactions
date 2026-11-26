import { Page, expect, Locator } from '@playwright/test';
import type { IVerifications } from '../interfaces/IVerifications';
type LocatorAssertions = ReturnType<typeof expect<Locator>>;
import { CountVerifyOptions, TextVerifyOptions } from '../enum/Options';
import type { VerifyOptions, VisualMatchPrimitiveOptions } from '../enum/Options';
export type { VerifyOptions, VisualMatchPrimitiveOptions } from '../enum/Options';
import { Element, WebElement } from '@civitas-cerebrum/element-repository';
import type { EntryTarget } from '../interfaces/IEntryTarget';
import { requireWebElement } from './requireWebElement';
import { countMismatch, describeCountOptions, validateCountOptions } from '../utils/countRange';

/**
 * Attach slice the visibility probe gives the repository per ATTEMPT (see
 * {@link Verifications.probeVisible}), and the cap on each attempt's
 * visibility wait.
 *
 * Deliberately a fixed duration rather than a fraction of the probe budget.
 * The repository walks a `fallback` chain by attach-waiting every missing node
 * (two waits per non-terminal node, one for the node the walk lands on), so a
 * slice expressed as `budget / k` makes the walk's cost scale with the budget
 * and blow it on any chain longer than `k / 2` nodes — which is how a five-node
 * chain came to leave the node it landed on a 1ms visibility wait and report a
 * plainly visible element hidden. With a fixed slice the walk costs the same
 * `(2N-1) x 250ms` whatever the budget, and the attempt loop simply stops
 * starting attempts once the budget is spent.
 *
 * 250ms is the floor at which a node that is ALREADY attached is seen
 * reliably; shorter deadlines routinely expire before Playwright's first poll,
 * which makes the walk step over a node that is sitting in the DOM.
 */
const PROBE_SLICE_MS = 250;

/**
 * How many times `entryAbsence` resolves the entry before it reports a
 * divergence between the default and `ALL` resolutions. One extra attempt is
 * enough: a node that attached while the two walks were in flight agrees on
 * the retry, and a divergence that persists is a real disagreement about which
 * chain node exists.
 */
const ABSENCE_RESOLVE_ATTEMPTS = 2;

/** Reach the Playwright Locator under a WebElement — used for Playwright's `expect(locator)` assertions. */
function resolveLocator(target: WebElement): Locator {
    return target.locator;
}

/**
 * The `Verifications` class provides a unified wrapper around Playwright's `expect` assertions.
 * It standardizes timeouts and includes advanced custom, robust verifications
 * (like image decoding) to keep your test assertions clean and reliable.
 */
export class Verifications implements IVerifications {
    /** The standard timeout applied to all verifications in this class. */
    private ELEMENT_TIMEOUT: number;

    /**
     * Initializes the Verifications class.
     * @param page - The current Playwright Page object.
     * @param timeout - Optional override for the default element timeout.
     */
    constructor(private page: Page, timeout: number = 30000) {
        this.ELEMENT_TIMEOUT = timeout;
    }

    // ── Repository entries (fluent chains) ──

    /** Resolves the entry once: a Playwright locator re-queries on every read. */
    async pollTarget(entry: EntryTarget, collection: boolean = false): Promise<Element> {
        return collection ? entry.resolveAll() : entry.resolve();
    }

    /** Resolves the entry once and waits up to `timeout` for it to be visible; any failure answers `false`. */
    async visibleWithin(entry: EntryTarget, timeout: number): Promise<boolean> {
        try {
            const element = await entry.resolve();
            await element.waitFor({ state: 'visible', timeout });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Runs the visibility check (and optional `containsText` filter) without
     * throwing. Resolves the probe target through `entry.probe()`, so scoped
     * `findBy*` chains probe their child locator (the stamped scoped name has
     * no repository entry) while repository chains resolve the entry's FULL
     * selector through the repository — role+name, regex text, fallback and
     * frame scope — exactly as an action on the same entry would. `timeout`
     * is the probe's whole budget, so the 15s repository-resolution default
     * is never imposed on a probe.
     *
     * The probe RE-RESOLVES on every attempt instead of resolving once and then
     * waiting. A repository resolution is a point-in-time answer: the walk
     * commits to the first `fallback` node that is attached *while the walk is
     * running* and the caller is then stuck with that node. So an entry whose
     * primary hydrates a second into the probe used to be answered on the
     * fallback the walk had already settled on — reporting `false` for an
     * element that the very action being gated goes on to find, and silently
     * skipping a click on a visible element. Re-resolving means a late primary
     * is picked up by a later attempt; the loop just stops starting attempts
     * once the budget is spent.
     *
     * Each attempt is bounded by {@link PROBE_SLICE_MS}, both for the
     * repository's per-node attach wait and for that attempt's visibility wait.
     * A chain walk is not interruptible, so an entry with a long `fallback`
     * chain can overrun the nominal budget by at most the cost of the final
     * walk — a correct answer slightly late, rather than a wrong answer on time.
     */
    async probeVisible(entry: EntryTarget, timeout: number, containsText?: string): Promise<boolean> {
        // `Math.max(1, …)`: a Playwright timeout of 0 means "wait forever", and
        // a 0ms budget must still buy one attempt rather than no answer at all.
        const deadline = Date.now() + Math.max(1, timeout);

        for (;;) {
            const slice = Math.max(1, Math.min(PROBE_SLICE_MS, deadline - Date.now()));
            const element = await entry.probe(slice).catch(() => null);
            if (element) {
                // Look at the resolved node with no wait at all before waiting
                // on it. The walk may have spent the entire budget and still
                // landed on a node that is visible *right now*; a residual
                // `waitFor({ timeout: 1 })` is not a substitute, because a 1ms
                // deadline routinely expires before Playwright's first poll and
                // reports an attached, visible node as hidden.
                let visible = await element.isVisible().catch(() => false);
                if (!visible) {
                    const left = Math.min(deadline - Date.now(), slice);
                    if (left > 0) {
                        visible = await element
                            .waitFor({ state: 'visible', timeout: left })
                            .then(() => true, () => false);
                    }
                }
                if (visible) {
                    if (containsText) {
                        const text = await element.textContent().catch(() => null);
                        return text !== null && text.includes(containsText);
                    }
                    return true;
                }
            }
            if (Date.now() >= deadline) return false;
        }
    }

    /** At least one match of the collection becomes visible within `timeout`. */
    async listPresence(entry: EntryTarget, timeout: number): Promise<void> {
        const all = await entry.resolveAll();
        requireWebElement('ElementAction.verifyPresence', all);
        try {
            await all.locator.filter({ visible: true }).first().waitFor({ state: 'visible', timeout });
        } catch {
            const count = await all.locator.count();
            throw new Error(
                `verifyPresence: '${entry.pageName}.${entry.elementName}' is a list entry ("list": true) — ` +
                `expected at least one visible match within ${timeout}ms, found ${count} match(es) and none visible.`,
            );
        }
    }

    /**
     * Asserts the entry hidden or detached with `toBeHidden()` on the first
     * VISIBLE match of the entry's full match set (so it holds for every match,
     * never a strict-mode violation on a multi-match entry), resolved through
     * the entry's default and whole-collection resolvers (`resolveDefault` /
     * `resolveAll`) with `attachSlice` per `fallback` chain node.
     *
     * A `fallback` entry is asserted on the variant the repository resolves:
     * the first chain node that exists, exactly as an action would target. The
     * assertion needs that node's FULL match set, so it reads the ALL
     * resolution — and cross-checks it against the default one, refusing to
     * assert when they land on different nodes: asserting on a node the action
     * would not target (for an absent fallback, a false PASS) is worse than
     * failing loudly. element-repository 0.3.4 and later probe a node by its
     * first match under every strategy, so the two agree on a multi-match node;
     * before that, ALL walked past it.
     *
     * The two resolutions run CONCURRENTLY, and a divergence is confirmed by a
     * second round before it is reported. Run back to back they were two walks
     * over two different moments in the page's life, so a perfectly ordinary
     * single-match primary that attached between them made the walks land on
     * different nodes.
     */
    async entryAbsence(entry: EntryTarget, options: { timeout: number; attachSlice: number }): Promise<void> {
        const slice = options.attachSlice;
        let element!: WebElement;
        let divergence: Error | undefined;
        for (let attempt = 1; attempt <= ABSENCE_RESOLVE_ATTEMPTS; attempt++) {
            const lastAttempt = attempt === ABSENCE_RESOLVE_ATTEMPTS;
            divergence = undefined;
            const [resolved, all] = await Promise.all([
                entry.resolveDefault(slice),
                entry.resolveAll(slice),
            ]);
            requireWebElement('ElementAction.verifyAbsence', resolved);
            requireWebElement('ElementAction.verifyAbsence', all);
            element = all;
            const handle = await resolved.locator.elementHandle({ timeout: slice }).catch(() => null);
            if (!handle) break;
            let inMatchSet: boolean;
            try {
                inMatchSet = await all.locator.evaluateAll((els, target) => (els as unknown[]).includes(target), handle);
            } catch (error) {
                // The membership check runs against a live handle, so it can
                // fail for reasons that have nothing to do with the assertion
                // (the node detached mid-evaluation, a navigation tore the
                // execution context down). Retry rather than report a failure
                // the page's own churn caused; on the final attempt let it
                // surface — loudly wrong beats quietly passing.
                if (lastAttempt) throw error;
                continue;
            } finally {
                // `dispose()` must run on the throwing path too, or every failed
                // membership check leaks a handle into the browser process for
                // the lifetime of the page.
                await handle.dispose().catch(() => undefined);
            }
            if (inMatchSet) break;
            divergence = new Error(
                `verifyAbsence: "${entry.elementName}" on "${entry.pageName}" is a fallback entry whose default and ALL resolutions ` +
                `landed on different chain nodes on ${ABSENCE_RESOLVE_ATTEMPTS} consecutive attempts, so absence cannot be asserted reliably. ` +
                `Check that @civitas-cerebrum/element-repository is 0.3.4 or later.`,
            );
        }
        if (divergence) throw divergence;
        // `toBeHidden()` is strict: on the ALL match set it throws "resolved to
        // N elements" as soon as two nodes match, even when every one is hidden.
        // Assert on the first VISIBLE match instead — hidden (passes) when every
        // match is hidden or none exists, visible (fails) when any match shows.
        await this.absence(
            new WebElement(element.locator.filter({ visible: true }).first()),
            { timeout: options.timeout },
        );
    }

    /** Pick `expect(locator)` vs `expect(locator).not` based on options, with the right timeout and custom error message. */
    private prepare(locator: Locator, options?: VerifyOptions): { matcher: LocatorAssertions; timeout: number; message?: string } {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        const base = options?.errorMessage ? expect(locator, options.errorMessage) : expect(locator);
        const matcher = options?.negated ? base.not : base;
        return { matcher, timeout, message: options?.errorMessage };
    }

    // ==========================================
    // Standard Assertions
    // ==========================================

    /**
     * Asserts the text content of an element.
     * Can verify exact text matches or simply check that the element contains some text.
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @param expectedText - The exact text string expected (optional if checking 'notEmpty').
     * @param options - Configuration to alter the verification behavior.
     */
    async text(target: Element, expectedText?: string, options?: TextVerifyOptions & VerifyOptions): Promise<void> {
        requireWebElement('Verifications.text', target);
        const locator = resolveLocator(target);
        const { matcher, timeout } = this.prepare(locator, options);
        if (options?.notEmpty) {
            await matcher.not.toBeEmpty({ timeout });
            return;
        }
        if (expectedText === undefined) {
            throw new Error(`You must provide either an 'expectedText' string or set '{ notEmpty: true }' in options.`);
        }
        await matcher.toHaveText(expectedText, { timeout });
    }

    /**
     * Asserts that the specified element contains the expected substring.
     */
    async textContains(target: Element, expectedText: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.textContains', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toContainText(expectedText, { timeout });
    }

    /** Asserts the element's text matches a regular expression. */
    async textMatches(target: Element, regex: RegExp, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.textMatches', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveText(regex, { timeout });
    }

    /** Asserts the element's text starts with the given prefix. */
    async textStartsWith(target: Element, prefix: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.textStartsWith', target);
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.textMatches(target, new RegExp('^' + escaped), options);
    }

    /** Asserts the element's text ends with the given suffix. */
    async textEndsWith(target: Element, suffix: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.textEndsWith', target);
        const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.textMatches(target, new RegExp(escaped + '$'), options);
    }

    /**
     * Asserts that the specified element is attached to the DOM and is visible.
     * @param target - A Playwright Locator or Element pointing to the target element.
     */
    async presence(target: Element, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.presence', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toBeVisible({ timeout });
    }

    /**
     * Asserts that the specified element is either hidden or completely detached from the DOM.
     * Accepts a Target or a raw selector string to prevent unnecessary repository waits.
     * @param selectorOrTarget - A Playwright Locator, Element, or raw selector string.
     * @param options - Standard verification options. Honouring `timeout` here
     *   is what makes `steps.on(el, page).timeout(ms).verifyAbsence()` mean
     *   anything: without it the caller's timeout reached the resolution but
     *   not `toBeHidden`, which is the wait that decides the assertion.
     */
    async absence(selectorOrTarget: Element | string, options?: VerifyOptions): Promise<void> {
        if (typeof selectorOrTarget !== 'string') requireWebElement('Verifications.absence', selectorOrTarget);
        const locator = typeof selectorOrTarget === 'string'
            ? this.page.locator(selectorOrTarget)
            : resolveLocator(selectorOrTarget);

        const { matcher, timeout } = this.prepare(locator, options);
        await matcher.toBeHidden({ timeout });
    }

    /**
  * Asserts the state of an element using Playwright's built-in locator assertions.
  * @param target - A Playwright Locator or Element pointing to the target element.
  * @param state - The expected state to verify.
  */
    async state(target: Element, state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport', options?: VerifyOptions): Promise<void>;

    /**
     * Asserts the state of an element using Playwright's built-in locator assertions.
     * @param locator - A CSS/XPath selector string to locate the target element.
     * @param state - The expected state to verify.
     * @param timeout - Optional timeout in milliseconds, overrides the default ELEMENT_TIMEOUT.
     */
    async state(locator: string, state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport', timeout?: number): Promise<void>;

    async state(
        locator: Element | string,
        state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport',
        timeoutOrOptions?: number | VerifyOptions,
    ): Promise<void> {
        if (typeof locator !== 'string') requireWebElement('Verifications.state', locator);
        const resolvedLocator: Locator = typeof locator === 'string' ? this.page.locator(locator) : resolveLocator(locator);
        const options: VerifyOptions = typeof timeoutOrOptions === 'number'
            ? { timeout: timeoutOrOptions }
            : (timeoutOrOptions ?? {});
        const { matcher, timeout } = this.prepare(resolvedLocator, options);

        switch (state) {
            case 'enabled': await matcher.toBeEnabled({ timeout }); break;
            case 'disabled': await matcher.toBeDisabled({ timeout }); break;
            case 'editable': await matcher.toBeEditable({ timeout }); break;
            case 'checked': await matcher.toBeChecked({ timeout }); break;
            case 'focused': await matcher.toBeFocused({ timeout }); break;
            case 'visible': await matcher.toBeVisible({ timeout }); break;
            case 'hidden': await matcher.toBeHidden({ timeout }); break;
            case 'attached': await matcher.toBeAttached({ timeout }); break;
            case 'inViewport': await matcher.toBeInViewport({ timeout }); break;
        }
    }

    /**
     * Asserts that the current browser URL contains the expected substring.
     * Evaluates using a case-insensitive regular expression.
     * @param text - The substring expected to be present within the active URL.
     */
    async urlContains(text: string): Promise<void> {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await expect(this.page).toHaveURL(new RegExp(escaped, 'i'), { timeout: this.ELEMENT_TIMEOUT });
    }

    // ==========================================
    // Page-level Assertions
    // ==========================================
    //
    // Document-scoped mirrors of the element verification family. They target
    // the whole page rather than a single repository element, so they live as
    // direct Playwright `expect(page|locator)` assertions here (no Element
    // resolution) — the single implementation behind `steps.verifyPage*`.

    /**
     * Asserts the document body contains the given text (substring or RegExp).
     * Web-first: retries until the body text matches or the timeout expires.
     * @param text - Substring or RegExp expected somewhere in the rendered body text.
     */
    async pageContainsText(text: string | RegExp, options?: VerifyOptions): Promise<void> {
        const { matcher, timeout } = this.prepare(this.page.locator('body'), options);
        await matcher.toContainText(text, { timeout });
    }

    /**
     * Asserts the document body does NOT contain the given text — the negated
     * companion to {@link pageContainsText}. Use for "not a 404" / no-error-copy
     * checks. Text-level only: raw markup never appears in rendered text — for
     * markup-level assertions use `pageHtmlContains` with `{ negated: true }`.
     * @param text - Substring or RegExp expected to be absent from the body text.
     */
    async pageNotContainsText(text: string | RegExp, options?: VerifyOptions): Promise<void> {
        await this.pageContainsText(text, { ...options, negated: !(options?.negated ?? false) });
    }

    /**
     * Asserts the page `<title>` equals the given string or matches the RegExp.
     * Wraps Playwright's `expect(page).toHaveTitle`.
     * @param title - Exact title string or a RegExp the title must match.
     */
    async pageTitle(title: string | RegExp, options?: VerifyOptions): Promise<void> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        const base = options?.errorMessage ? expect(this.page, options.errorMessage) : expect(this.page);
        const matcher = options?.negated ? base.not : base;
        await matcher.toHaveTitle(title, { timeout });
    }

    // ==========================================
    // HTML Assertions
    // ==========================================
    //
    // Playwright has no built-in `toHaveHTML` matcher, so the html family is
    // implemented on top of `expect.poll` to retain the same retry semantics
    // as the rest of the verification surface (web-first, custom timeout,
    // negation, error message). Each method shares one polling helper so the
    // exact-match / contains / regex / starts-with / ends-with branches stay
    // a single line of dispatch.

    /** Read innerHTML / outerHTML for an element-scoped html assertion. Locator-only — caller resolves the WebElement. */
    private readElementHtml(locator: Locator, outer: boolean): Promise<string> {
        const target = locator.first();
        return outer
            ? target.evaluate((el: globalThis.Element) => el.outerHTML)
            : target.innerHTML();
    }

    /** Read the page-level HTML — body innerHTML by default, full document outerHTML when `outer`. */
    private readPageHtml(outer: boolean): Promise<string> {
        return outer
            ? this.page.evaluate(() => document.documentElement.outerHTML)
            : this.page.evaluate(() => document.body.innerHTML);
    }

    /**
     * Polls a string predicate against an HTML source until it satisfies the
     * predicate (or its negation) or the timeout expires. Single source of
     * truth for every html / pageHtml assertion variant.
     */
    private async pollHtml(
        readHtml: () => Promise<string>,
        predicate: (html: string) => boolean,
        describe: string,
        scope: string,
        options?: VerifyOptions,
    ): Promise<void> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        const negated = options?.negated ?? false;
        const neg = negated ? 'not ' : '';
        const header = options?.errorMessage ?? `expected ${scope} html ${neg}${describe}`;

        let lastHtml: string | null = null;
        try {
            await expect.poll(async () => {
                try {
                    const html = await readHtml();
                    lastHtml = html;
                    return predicate(html) !== negated;
                } catch {
                    return false;
                }
            }, { timeout, message: header }).toBe(true);
        } catch {
            // expect.poll rethrows with its own "Timeout … while waiting on the
            // predicate" message and drops the `message` option from the thrown
            // Error string (it only surfaces in the report). Repackage so the
            // assertion header always shows up in the thrown message — same UX
            // as `expect(locator).toHaveText(..., { timeout })` in the rest of
            // the verification surface.
            const actual: string = lastHtml ?? '<unavailable>';
            const truncated = actual.length > 200 ? `${actual.slice(0, 200)}…` : actual;
            throw new Error(`${header}\n  actual: "${truncated}"`);
        }
    }

    /** Asserts the element's `innerHTML` (or `outerHTML` with `{ outer: true }`) equals the expected string exactly. */
    async html(target: Element, expected: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        requireWebElement('Verifications.html', target);
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => html === expected,
            `to be "${expected}"`,
            `element`,
            options,
        );
    }

    /** Asserts the element's HTML contains the given substring. */
    async htmlContains(target: Element, substring: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        requireWebElement('Verifications.htmlContains', target);
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => html.includes(substring),
            `to contain "${substring}"`,
            `element`,
            options,
        );
    }

    /** Asserts the element's HTML matches a regular expression. */
    async htmlMatches(target: Element, regex: RegExp, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        requireWebElement('Verifications.htmlMatches', target);
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => regex.test(html),
            `to match ${regex}`,
            `element`,
            options,
        );
    }

    /** Asserts the element's HTML starts with the given prefix. */
    async htmlStartsWith(target: Element, prefix: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        requireWebElement('Verifications.htmlStartsWith', target);
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => html.startsWith(prefix),
            `to start with "${prefix}"`,
            `element`,
            options,
        );
    }

    /** Asserts the element's HTML ends with the given suffix. */
    async htmlEndsWith(target: Element, suffix: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        requireWebElement('Verifications.htmlEndsWith', target);
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readElementHtml(resolveLocator(target), outer),
            html => html.endsWith(suffix),
            `to end with "${suffix}"`,
            `element`,
            options,
        );
    }

    /** Asserts the page-level HTML equals the expected string exactly. Defaults to `document.body.innerHTML`; pass `{ outer: true }` for the full document outerHTML. */
    async pageHtml(expected: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => html === expected,
            `to be "${expected}"`,
            outer ? 'document' : 'body',
            options,
        );
    }

    /** Asserts the page-level HTML contains the given substring. */
    async pageHtmlContains(substring: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => html.includes(substring),
            `to contain "${substring}"`,
            outer ? 'document' : 'body',
            options,
        );
    }

    /** Asserts the page-level HTML matches a regular expression. */
    async pageHtmlMatches(regex: RegExp, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => regex.test(html),
            `to match ${regex}`,
            outer ? 'document' : 'body',
            options,
        );
    }

    /** Asserts the page-level HTML starts with the given prefix. */
    async pageHtmlStartsWith(prefix: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => html.startsWith(prefix),
            `to start with "${prefix}"`,
            outer ? 'document' : 'body',
            options,
        );
    }

    /** Asserts the page-level HTML ends with the given suffix. */
    async pageHtmlEndsWith(suffix: string, options?: VerifyOptions & { outer?: boolean }): Promise<void> {
        const outer = options?.outer ?? false;
        await this.pollHtml(
            () => this.readPageHtml(outer),
            html => html.endsWith(suffix),
            `to end with "${suffix}"`,
            outer ? 'document' : 'body',
            options,
        );
    }

    // ==========================================
    // Browser Storage (localStorage / sessionStorage)
    // ==========================================
    //
    // Storage assertions follow the same retry-on-poll pattern as html: a
    // private `pollStorage` method is the single source of truth, and the
    // exact-match / contains / regex / starts-with / ends-with / present /
    // absent variants are one-line dispatches over it.

    /** Read a value from `window.localStorage`. */
    private readLocalStorage(key: string): Promise<string | null> {
        return this.page.evaluate((k) => window.localStorage.getItem(k), key);
    }

    /** Read a value from `window.sessionStorage`. */
    private readSessionStorage(key: string): Promise<string | null> {
        return this.page.evaluate((k) => window.sessionStorage.getItem(k), key);
    }

    /**
     * Polls a `string | null` predicate against a storage source until it
     * satisfies the predicate (or its negation) or the timeout expires.
     * Single source of truth for every localStorage / sessionStorage variant.
     */
    private async pollStorage(
        readValue: () => Promise<string | null>,
        predicate: (value: string | null) => boolean,
        describe: string,
        storageType: 'localStorage' | 'sessionStorage',
        key: string,
        options?: VerifyOptions,
    ): Promise<void> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        const negated = options?.negated ?? false;
        const neg = negated ? 'not ' : '';
        const header = options?.errorMessage ?? `expected ${storageType}[${JSON.stringify(key)}] ${neg}${describe}`;

        let lastValue: string | null = null;
        let captured = false;
        try {
            await expect.poll(async () => {
                try {
                    const value = await readValue();
                    lastValue = value;
                    captured = true;
                    return predicate(value) !== negated;
                } catch {
                    return false;
                }
            }, { timeout, message: header }).toBe(true);
        } catch {
            const actual = !captured ? '<unavailable>' : lastValue === null ? 'null' : JSON.stringify(lastValue);
            throw new Error(`${header}\n  actual: ${actual}`);
        }
    }

    /** Asserts that `localStorage[key]` equals the expected string exactly. */
    async localStorage(key: string, expected: string, options?: VerifyOptions): Promise<void> {
        await this.pollStorage(
            () => this.readLocalStorage(key),
            v => v === expected,
            `to be ${JSON.stringify(expected)}`,
            'localStorage', key, options,
        );
    }

    /** Asserts that `localStorage[key]` contains the given substring. Fails if the key is absent. */
    async localStorageContains(key: string, substring: string, options?: VerifyOptions): Promise<void> {
        await this.pollStorage(
            () => this.readLocalStorage(key),
            v => v !== null && v.includes(substring),
            `to contain ${JSON.stringify(substring)}`,
            'localStorage', key, options,
        );
    }

    /** Asserts that `localStorage[key]` matches a regular expression. Fails if the key is absent. */
    async localStorageMatches(key: string, regex: RegExp, options?: VerifyOptions): Promise<void> {
        await this.pollStorage(
            () => this.readLocalStorage(key),
            v => v !== null && regex.test(v),
            `to match ${regex}`,
            'localStorage', key, options,
        );
    }

    /** Asserts that the `localStorage` key is present (any non-null value). Use `{ negated: true }` to assert absence. */
    async localStoragePresent(key: string, options?: VerifyOptions): Promise<void> {
        await this.pollStorage(
            () => this.readLocalStorage(key),
            v => v !== null,
            'to be present',
            'localStorage', key, options,
        );
    }

    /** Asserts that `sessionStorage[key]` equals the expected string exactly. */
    async sessionStorage(key: string, expected: string, options?: VerifyOptions): Promise<void> {
        await this.pollStorage(
            () => this.readSessionStorage(key),
            v => v === expected,
            `to be ${JSON.stringify(expected)}`,
            'sessionStorage', key, options,
        );
    }

    /** Asserts that `sessionStorage[key]` contains the given substring. Fails if the key is absent. */
    async sessionStorageContains(key: string, substring: string, options?: VerifyOptions): Promise<void> {
        await this.pollStorage(
            () => this.readSessionStorage(key),
            v => v !== null && v.includes(substring),
            `to contain ${JSON.stringify(substring)}`,
            'sessionStorage', key, options,
        );
    }

    /** Asserts that `sessionStorage[key]` matches a regular expression. Fails if the key is absent. */
    async sessionStorageMatches(key: string, regex: RegExp, options?: VerifyOptions): Promise<void> {
        await this.pollStorage(
            () => this.readSessionStorage(key),
            v => v !== null && regex.test(v),
            `to match ${regex}`,
            'sessionStorage', key, options,
        );
    }

    /** Asserts that the `sessionStorage` key is present (any non-null value). Use `{ negated: true }` to assert absence. */
    async sessionStoragePresent(key: string, options?: VerifyOptions): Promise<void> {
        await this.pollStorage(
            () => this.readSessionStorage(key),
            v => v !== null,
            'to be present',
            'sessionStorage', key, options,
        );
    }

    // ==========================================
    // Window property (window-level JS state)
    // ==========================================
    //
    // Mirrors the storage poll: read the dotted-path window value on each tick,
    // run the caller's predicate, and retry until it holds (or its negation) or
    // the timeout expires. The matcher selection (equals/contains/.../lessThan)
    // is resolved on the Steps side into a single predicate passed in here.

    /**
     * Polls a `window` value (read by dotted path) against a predicate until it
     * holds (or its negation) or the timeout expires. The single source of
     * truth behind `steps.verifyWindowProperty`. The `describe` string is the
     * human-readable tail of the failure header (e.g. `to be greater than 0`).
     */
    async windowProperty(
        path: string,
        predicate: (value: unknown) => boolean,
        describe: string,
        options?: VerifyOptions,
    ): Promise<void> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        const negated = options?.negated ?? false;
        const neg = negated ? 'not ' : '';
        const header = options?.errorMessage ?? `expected window.${path} ${neg}${describe}`;

        let lastValue: unknown;
        let captured = false;
        try {
            await expect.poll(async () => {
                try {
                    const value = await this.page.evaluate(
                        (p) => {
                            const v = p.split('.').reduce((o: unknown, k: string) => (o == null ? o : (o as Record<string, unknown>)[k]), window as unknown);
                            // Functions/symbols serialize to undefined across the
                            // evaluate boundary, which would false-negative
                            // presence/truthiness checks — send a marker instead.
                            return (typeof v === 'function' || typeof v === 'symbol') ? `[non-serializable: ${typeof v}]` : v;
                        },
                        path,
                    );
                    lastValue = value;
                    captured = true;
                    return predicate(value) !== negated;
                } catch {
                    return false;
                }
            }, { timeout, message: header }).toBe(true);
        } catch {
            const actual = !captured ? '<unavailable>' : (() => {
                try { return JSON.stringify(lastValue); } catch { return String(lastValue); }
            })();
            throw new Error(`${header}\n  actual: ${actual}`);
        }
    }

    /**
     * Asserts that an element has a specific HTML attribute with an exact value.
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @param attributeName - The name of the HTML attribute to check (e.g., 'href', 'class', 'alt').
     * @param expectedValue - The exact expected value of the attribute.
     */
    async attribute(target: Element, attributeName: string, expectedValue: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.attribute', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveAttribute(attributeName, expectedValue, { timeout });
    }

    /** Asserts that a given HTML attribute contains the substring. */
    async attributeContains(target: Element, attributeName: string, substring: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.attributeContains', target);
        const escaped = substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.attributeMatches(target, attributeName, new RegExp(escaped), options);
    }

    /** Asserts that a given HTML attribute matches a regular expression. */
    async attributeMatches(target: Element, attributeName: string, regex: RegExp, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.attributeMatches', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveAttribute(attributeName, regex, { timeout });
    }

    /** Asserts that the element has a given HTML attribute present (regardless of value). */
    async hasAttribute(target: Element, attributeName: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.hasAttribute', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveAttribute(attributeName, /[\s\S]*/, { timeout });
    }

    /**
     * Performs a multi-step verification on one or more images.
     *
     * By default checks visibility, a non-empty `src` attribute, and a non-zero
     * `naturalWidth`. Pass `{ verifyDecoded: true }` to additionally run the
     * browser-native `Image.decode()` round-trip, which confirms the image is
     * fully rendered and not a broken link but adds a CDP round-trip per image.
     *
     * @param imagesTarget - A Playwright Locator or Element pointing to the image element(s).
     * @param scroll - Whether to scroll the image(s) into the viewport before verifying (default: true).
     * @param options - `verifyDecoded`: run `Image.decode()` per image (default: false); `timeout`: each check's wait (default: the family timeout).
     * @throws Will throw an error if no images are found or any image fails verification.
     */
    async images(imagesTarget: Element, scroll: boolean = true, options?: { verifyDecoded?: boolean; timeout?: number }): Promise<void> {
        requireWebElement('Verifications.images', imagesTarget);
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        const imagesLocator = resolveLocator(imagesTarget);
        const productImages = await imagesLocator.all();

        if (productImages.length === 0) {
            throw new Error(`No images found for '${imagesLocator.toString()}'.`);
        }

        for (let i = 0; i < productImages.length; i++) {
            const productImage = productImages[i];

            if (scroll) {
                await productImage.scrollIntoViewIfNeeded().catch(() => { });
            }

            await expect(productImage).toBeVisible({ timeout });
            await expect(productImage).toHaveAttribute('src', /.+/, { timeout });
            await expect(productImage).not.toHaveJSProperty('naturalWidth', 0, { timeout });

            if (options?.verifyDecoded) {
                const isDecoded = await productImage.evaluate(async (img: HTMLImageElement) => {
                    if (!img.src) return false;
                    try {
                        await img.decode();
                        return true;
                    } catch {
                        return false;
                    }
                });
                expect(isDecoded, `Image ${i + 1} failed to decode for ${imagesLocator.toString()}`).toBe(true);
            }
        }
    }

    /**
     * Asserts that an input, textarea, or select element has the expected value.
     * Unlike `text()` which checks `textContent`, this checks the `value` property.
     * @param target - A Playwright Locator or Element pointing to the input element.
     * @param expectedValue - The expected value of the input.
     */
    async inputValue(target: Element, expectedValue: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.inputValue', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveValue(expectedValue, { timeout });
    }

    /** Asserts the input value contains the given substring. */
    async inputValueContains(target: Element, substring: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.inputValueContains', target);
        const escaped = substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.inputValueMatches(target, new RegExp(escaped), options);
    }

    /** Asserts the input value matches a regular expression. */
    async inputValueMatches(target: Element, regex: RegExp, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.inputValueMatches', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveValue(regex, { timeout });
    }

    /** Asserts the input value starts with the given prefix. */
    async inputValueStartsWith(target: Element, prefix: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.inputValueStartsWith', target);
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.inputValueMatches(target, new RegExp('^' + escaped), options);
    }

    /** Asserts the input value ends with the given suffix. */
    async inputValueEndsWith(target: Element, suffix: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.inputValueEndsWith', target);
        const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.inputValueMatches(target, new RegExp(escaped + '$'), options);
    }

    /**
     * Asserts the number of open browser tabs/pages matches the expected count.
     * @param expectedCount - The expected number of open tabs.
     */
    async tabCount(expectedCount: number): Promise<void> {
        await expect.poll(
            () => this.page.context().pages().length,
            { timeout: this.ELEMENT_TIMEOUT, message: `Expected ${expectedCount} tabs` }
        ).toBe(expectedCount);
    }

    /**
     * Asserts that two values are strictly equal.
     * Typically used to compare two values captured from the page via getText() or getInputValue().
     * Both parameters accept null to support values that may not be present in the DOM.
     *
     * @param actual - The value captured from the page.
     * @param expected - The value to compare against. Can be another captured value or a literal string.
     */
    expectEqual(actual: string | null, expected: string | null): void {
        expect(actual, `Expected values to be equal.\n  Actual:   "${actual}"\n  Expected: "${expected}"`).toBe(expected);
    }

    /**
     * Asserts that two values are not equal.
     * Typically used to confirm that two values captured from the page differ from each other.
     * Both parameters accept null to support values that may not be present in the DOM.
     *
     * @param actual - The value captured from the page.
     * @param notExpected - The value that actual must differ from.
     */
    expectNotEqual(actual: string | null, notExpected: string | null): void {
        expect(actual, `Expected values to differ, but both were: "${actual}"`).not.toBe(notExpected);
    }

    /**
     * Asserts that the text contents of all elements matching the locator appear in the exact
     * order specified by `expectedTexts`. Each element's trimmed `textContent` is compared
     * against the corresponding entry in the array.
     * @param target - A Playwright Locator or Element resolving to the list of elements.
     * @param expectedTexts - The expected text values in order.
     */
    async order(target: Element, expectedTexts: string[], options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.order', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveText(expectedTexts, { timeout });
    }

    /**
     * Asserts that a computed CSS property of an element matches the expected value.
     * Uses `getComputedStyle` under the hood, so values are in their resolved form
     * (e.g. `'rgb(255, 0, 0)'` instead of `'red'`).
     * @param target - A Playwright Locator or Element pointing to the target element.
     * @param property - The CSS property name (e.g. `'color'`, `'font-size'`, `'display'`).
     * @param expectedValue - The expected computed value.
     */
    async cssProperty(target: Element, property: string, expectedValue: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.cssProperty', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveCSS(property, expectedValue, { timeout });
    }

    /** Asserts a computed CSS property value contains the given substring. */
    async cssPropertyContains(target: Element, property: string, substring: string, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.cssPropertyContains', target);
        const escaped = substring.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await this.cssPropertyMatches(target, property, new RegExp(escaped), options);
    }

    /** Asserts a computed CSS property value matches a regular expression. */
    async cssPropertyMatches(target: Element, property: string, regex: RegExp, options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.cssPropertyMatches', target);
        const { matcher, timeout } = this.prepare(resolveLocator(target), options);
        await matcher.toHaveCSS(property, regex, { timeout });
    }

    /**
     * Asserts that the text contents of all elements matching the locator are sorted
     * in the specified direction. Each element's trimmed `textContent` is compared
     * using locale-aware string comparison.
     * @param target - A Playwright Locator or Element resolving to the list of elements.
     * The list is re-read every 100 ms until it is sorted or `options.timeout`
     * (default: the configured element timeout) runs out. A list of fewer than
     * two items (an empty list included) passes at once, as on a device.
     * @param direction - `'asc'` for ascending (A-Z) or `'desc'` for descending (Z-A).
     * @param options - Optional `{ timeout? }` override.
     */
    async listOrder(target: Element, direction: 'asc' | 'desc', options?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.listOrder', target);
        const locator = resolveLocator(target);
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        const deadline = Date.now() + timeout;

        for (;;) {
            const texts = (await locator.allTextContents()).map(t => t.trim());
            if (texts.length < 2) return;

            const sorted = [...texts].sort((a, b) =>
                direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
            );
            if (texts.every((t, i) => t === sorted[i])) return;

            if (Date.now() >= deadline) {
                expect(texts, `Expected list to be sorted ${direction}ending`).toEqual(sorted);
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))));
        }
    }


    /**
     * Asserts the number of elements matching the locator based on the provided conditions:
     * `exactly`, or a range of at most one lower bound (`greaterThan` / `greaterThanOrEqual`)
     * and at most one upper bound (`lessThan` / `lessThanOrEqual`), every given bound holding.
     * @param target - A Playwright Locator or Element pointing to the target elements.
     * @param options - Configuration specifying which comparator to apply and the expected count.
     * @param verifyOptions - Optional `{ negated?, timeout?, errorMessage? }` override.
     * @throws Error at once when `options` is empty, negative or contradictory (no count can
     *   satisfy it); an assertion error naming the failed bound when the count does not match.
     */
    async count(target: Element, options: CountVerifyOptions, verifyOptions?: VerifyOptions): Promise<void> {
        requireWebElement('Verifications.count', target);
        validateCountOptions(options);
        const locator = resolveLocator(target);
        const timeout = verifyOptions?.timeout ?? this.ELEMENT_TIMEOUT;
        const { matcher } = this.prepare(locator, verifyOptions);

        if (options.exactly !== undefined) {
            await matcher.toHaveCount(options.exactly, { timeout });
            return;
        }

        // Polls a verdict instead of a boolean, so the failure names the bound
        // the last count broke: Expected "count > 1 and < 3", Received "6 is not < 3".
        const negated = verifyOptions?.negated === true;
        const expected = `count ${negated ? 'not ' : ''}${describeCountOptions(options)}`;
        const lead = `Expected ${expected}`;
        await expect.poll(async () => countMismatch(options, await target.count(), negated) ?? expected, {
            timeout,
            message: verifyOptions?.errorMessage ? `${verifyOptions.errorMessage} (${lead})` : lead,
        }).toBe(expected);
    }

    // ==========================================
    // Visual Regression
    // ==========================================
    //
    // Thin facade over Playwright's `toHaveScreenshot` matcher with two
    // additions:
    //   1. A `mask` shape that accepts ElementRepository entries
    //      ({ elementName, pageName }) alongside raw selectors, so tests
    //      keep using the framework's locator vocabulary instead of
    //      dropping into raw Playwright locators.
    //   2. A page-level vs element-level path under one method —
    //      target = the Page instance for page screenshots, or a
    //      WebElement for element screenshots.
    //
    // Behaviour notes Playwright already gives you (and we inherit):
    //   - Animations are disabled by default (`animations: 'disabled'`).
    //     No need to freeze CSS yourself.
    //   - The first run writes the baseline; subsequent runs diff.
    //   - `mask` regions are painted with a solid colour (pink default)
    //     BEFORE the pixel diff, so dynamic data in those regions
    //     doesn't fail the comparison.

    /**
     * Assert that the current page or a specific element matches its
     * stored baseline screenshot, optionally masking regions of dynamic
     * data.
     *
     * @param target           — pass the framework's `WebElement` for an
     *                           element snapshot, or the framework's
     *                           page object via `this.page` semantics
     *                           (handled by the higher-level step).
     * @param snapshotName     — file name for the baseline (e.g.
     *                           `dashboard.png`). Playwright derives
     *                           OS- / browser-specific directories
     *                           automatically.
     * @param options          — see {@link VisualMatchOptions}. Use
     *                           `mask` for any region whose content
     *                           changes between runs (clocks, ids,
     *                           live counters, "updated N minutes ago"
     *                           badges, user avatars, etc.).
     */
    async visuallyMatches(
        target: Element | Page,
        snapshotName?: string,
        options?: VisualMatchPrimitiveOptions,
    ): Promise<void> {
        if (!this.isPage(target)) requireWebElement('Verifications.visuallyMatches', target);
        const targetForMatcher = this.isPage(target)
            ? target
            : resolveLocator(target);

        const base = options?.errorMessage
            ? expect(targetForMatcher, options.errorMessage)
            : expect(targetForMatcher);

        const shotOptions: Record<string, unknown> = {
            timeout: options?.timeout ?? this.ELEMENT_TIMEOUT,
        };
        if (options?.mask && options.mask.length > 0) shotOptions.mask = options.mask;
        if (options?.maskColor !== undefined) shotOptions.maskColor = options.maskColor;
        if (options?.maxDiffPixelRatio !== undefined) shotOptions.maxDiffPixelRatio = options.maxDiffPixelRatio;
        if (options?.maxDiffPixels !== undefined) shotOptions.maxDiffPixels = options.maxDiffPixels;
        if (options?.fullPage !== undefined && this.isPage(target)) {
            shotOptions.fullPage = options.fullPage;
        }

        if (snapshotName) {
            await base.toHaveScreenshot(snapshotName, shotOptions);
        } else {
            await base.toHaveScreenshot(shotOptions);
        }
    }

    /** Type guard — distinguishes a Playwright Page from a framework WebElement. */
    private isPage(target: Element | Page): target is Page {
        return typeof (target as Page).goto === 'function';
    }
}
