import { ElementRepository, Element, WebElement, ElementResolutionOptions, SelectionStrategy } from '@civitas-cerebrum/element-repository';
import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { DropdownSelectOptions, TextVerifyOptions, CountVerifyOptions, DragAndDropOptions, ScreenshotOptions, IsVisibleOptions } from '../enum/Options';
import {
    ElementSnapshot,
    ExpectBuilder,
    ExpectContext,
} from './ExpectMatchers';
import { VisibleChain } from './VisibleChain';

/**
 * Fluent builder for performing actions on a repository element.
 *
 * Usage:
 * ```ts
 * await steps.on('submitButton', 'LoginPage').click();
 * await steps.on('navItems', 'HomePage').random().hover();
 * await steps.on('productCards', 'CollectionsPage').nth(2).getText();
 * ```
 */
export class ElementAction {
    private resolutionOptions: ElementResolutionOptions = {};
    private _timeout: number;
    private conditionalVisible: boolean = false;
    private visibilityTimeout: number = 2000;

    constructor(
        private _repo: ElementRepository,
        private _elementName: string,
        private _pageName: string,
        private interactions: ElementInteractions,
        private timeoutMs?: number,
    ) {
        this._timeout = timeoutMs ?? 30000;
    }

    /** Repository this chain resolves elements against. Readonly — set at construction. */
    get repo(): ElementRepository { return this._repo; }

    /** Element name on the target page. Readonly — set at construction. */
    get elementName(): string { return this._elementName; }

    /** Page name in the repository. Readonly — set at construction. */
    get pageName(): string { return this._pageName; }

    /**
     * Override the retry timeout for any subsequent matcher or predicate call
     * on this chain. Mutates self and returns `this` for fluent chaining —
     * consistent with strategy selectors like `.first()` and `.nth()`.
     *
     * @example
     * await steps.on('slowWidget', 'Page').timeout(5000).text.toBe('Ready');
     * await steps.on('btn', 'Page').nth(2).timeout(1000).visible.toBeTrue();
     */
    timeout(ms: number): this {
        this._timeout = ms;
        return this;
    }

    // -- Strategy selectors --

    /** Select the first matching element (default behavior). */
    first(): this {
        this.resolutionOptions = {};
        return this;
    }

    /** Select a random matching element. */
    random(): this {
        this.resolutionOptions = { strategy: SelectionStrategy.RANDOM };
        return this;
    }

    /** Select the element at the given zero-based index. */
    nth(index: number): this {
        this.resolutionOptions = { strategy: SelectionStrategy.INDEX, index };
        return this;
    }

    /** Select the first element matching the given text content. */
    byText(text: string): this {
        this.resolutionOptions = { strategy: SelectionStrategy.TEXT, value: text };
        return this;
    }

    /** Select the first element matching the given attribute name-value pair. */
    byAttribute(name: string, value: string): this {
        this.resolutionOptions = { strategy: SelectionStrategy.ATTRIBUTE, attribute: name, value };
        return this;
    }

    /**
     * Makes all subsequent actions conditional on visibility.
     * If the element is not visible within the timeout, actions silently skip
     * instead of throwing. Returns `this` for chaining.
     *
     * @param timeout - Max wait in ms to check visibility. Defaults to `2000`.
     *
     * @example
     * ```ts
     * await steps.on('cookieBanner', 'Page').ifVisible().click();
     * await steps.on('promoPopup', 'Page').ifVisible(500).click();
     * ```
     *
     * @deprecated Prefer `await steps.on(el, page).isVisible({ timeout }).click()`.
     * `isVisible()` is the unified replacement for both `ifVisible()` (modifier)
     * and the old boolean `isVisible()` probe. Will be removed in a future major release.
     */
    ifVisible(timeout?: number): this {
        this.conditionalVisible = true;
        if (timeout !== undefined) this.visibilityTimeout = timeout;
        return this;
    }

    // -- Internal helpers --

    /**
     * Checks the ifVisible condition. Returns `true` if the action should proceed,
     * `false` if it should be skipped.
     */
    private async shouldProceed(): Promise<boolean> {
        if (!this.conditionalVisible) return true;
        try {
            const element = await this.resolve();
            await element.waitFor({ state: 'visible', timeout: this.visibilityTimeout });
            return true;
        } catch {
            return false;
        }
    }

    private async resolve(): Promise<Element> {
        return this.repo.get(this.elementName, this.pageName, this.resolutionOptions);
    }

    // -- Terminal actions: interactions --

    /** Click the resolved element. Skips silently if `ifVisible()` was set and element is hidden. */
    async click(options?: { withoutScrolling?: boolean; force?: boolean }): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await this.interactions.interact.click(element, {
            withoutScrolling: options?.withoutScrolling,
            force: options?.force,
            timeout: this._timeout,
        });
    }

    /** Click the resolved element if present. Returns `true` if clicked, `false` if skipped. */
    async clickIfPresent(options?: { withoutScrolling?: boolean; force?: boolean }): Promise<boolean> {
        const element = await this.resolve();
        if (await element.isVisible()) {
            await this.interactions.interact.click(element, {
                withoutScrolling: options?.withoutScrolling,
                ifPresent: true,
                force: options?.force,
                timeout: this._timeout,
            });
            return true;
        }
        return false;
    }

    /** Hover over the resolved element. Skips silently if `ifVisible()` was set and element is hidden. */
    async hover(): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this._timeout).hover();
    }

    /** Clear and fill the resolved element with text. Skips silently if `ifVisible()` was set and element is hidden. */
    async fill(text: string): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this._timeout).fill(text);
    }

    /** Scroll the resolved element into view. Skips silently if `ifVisible()` was set and element is hidden. */
    async scrollIntoView(): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this._timeout).scrollIntoView();
    }

    /** Select a dropdown option. */
    async selectDropdown(options?: DropdownSelectOptions): Promise<string> {
        const element = await this.resolve();
        return await this.interactions.interact.selectDropdown(element, {
            ...options,
            timeout: options?.timeout ?? this._timeout,
        });
    }

    /** Check a checkbox or radio button. Skips silently if `ifVisible()` was set and element is hidden. */
    async check(): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this._timeout).check();
    }

    /** Uncheck a checkbox. Skips silently if `ifVisible()` was set and element is hidden. */
    async uncheck(): Promise<void> {
        if (!await this.shouldProceed()) return;
        const element = await this.resolve();
        await element.action(this._timeout).uncheck();
    }

    /** Double-click the resolved element. */
    async doubleClick(): Promise<void> {
        const element = await this.resolve();
        await element.action(this._timeout).doubleClick();
    }

    /** Right-click the resolved element. */
    async rightClick(): Promise<void> {
        const element = await this.resolve();
        await this.interactions.interact.rightClick(element, { timeout: this._timeout });
    }

    /** Type text character by character. */
    async typeSequentially(text: string, delay?: number): Promise<void> {
        const element = await this.resolve();
        await element.action(this._timeout).pressSequentially(text, delay);
    }

    /** Upload a file to a file input. */
    async uploadFile(filePath: string): Promise<void> {
        const element = await this.resolve();
        await this.interactions.interact.uploadFile(element, filePath, { timeout: this._timeout });
    }

    /** Drag and drop the resolved element. */
    async dragAndDrop(options: DragAndDropOptions): Promise<void> {
        const element = await this.resolve();
        await this.interactions.interact.dragAndDrop(element, {
            ...options,
            timeout: options.timeout ?? this._timeout,
        });
    }

    /** Clear the input value. */
    async clearInput(): Promise<void> {
        const element = await this.resolve();
        await element.action(this._timeout).clear();
    }

    /** Set slider value. */
    async setSliderValue(value: number): Promise<void> {
        const element = await this.resolve();
        await this.interactions.interact.setSliderValue(element, value, { timeout: this._timeout });
    }

    /** Select multiple options from a multi-select. */
    async selectMultiple(values: string[]): Promise<string[]> {
        const element = await this.resolve();
        return await this.interactions.interact.selectMultiple(element, values, { timeout: this._timeout });
    }

    // -- Terminal actions: verifications --
    //
    // `verify*` is the canonical fluent form. The top-level `Steps.verifyX(el, page, ...)`
    // methods are thin wrappers that route through these — one implementation, two
    // entry points. Internally each delegates to the matcher tree (which is the single
    // source of truth for retry/timeout/negation mechanics) or to the raw verification
    // layer when a specialized fast path exists (e.g. `verifyAbsence` via `toBeHidden`).

    /** Assert the element is visible. Delegates to the matcher tree's `.visible.toBeTrue()`. */
    async verifyPresence(): Promise<void> {
        await this.expectBuilder().visible.toBeTrue();
    }

    /**
     * Assert the element is hidden or detached. Uses Playwright's
     * `expect(locator).toBeHidden()` on the raw selector — never calls
     * `repo.get(...)` because that would pay the 15s repo-resolution wait
     * waiting for the element to become attached, which is the opposite of
     * what we want when asserting absence.
     */
    async verifyAbsence(): Promise<void> {
        const selector = this.repo.getSelector(this.elementName, this.pageName);
        await this.interactions.verify.absence(selector);
    }

    /**
     * Assert the element's text content. Call with no argument to assert "not empty".
     *
     * @param expected - Expected exact text. Omit to assert the element has any non-empty text.
     * @param options - Optional verification options.
     *   @deprecated Passing `{ notEmpty: true }` is redundant — omit `expected` instead.
     */
    async verifyText(expected?: string, options?: TextVerifyOptions): Promise<void> {
        if (options?.notEmpty !== undefined) {
            // eslint-disable-next-line no-console
            console.warn('[DEPRECATED] verifyText: the `notEmpty` option is redundant — call .verifyText() with no argument to assert "not empty".');
        }
        const builder = this.expectBuilder();
        const notEmpty = options?.notEmpty || expected === undefined;
        if (notEmpty) await builder.text.not.toBe('');
        else await builder.text.toBe(expected!);
    }

    /** Assert text contains a substring. Delegates to the matcher tree's `.text.toContain(...)`. */
    async verifyTextContains(expected: string): Promise<void> {
        await this.expectBuilder().text.toContain(expected);
    }

    /** Assert the element count. Delegates to the matcher tree's count matchers. */
    async verifyCount(options: CountVerifyOptions): Promise<void> {
        const builder = this.expectBuilder();
        if (options.exactly !== undefined) await builder.count.toBe(options.exactly);
        else if (options.greaterThan !== undefined) await builder.count.toBeGreaterThan(options.greaterThan);
        else if (options.lessThan !== undefined) await builder.count.toBeLessThan(options.lessThan);
        else throw new Error("verifyCount requires 'exactly', 'greaterThan', or 'lessThan' in CountVerifyOptions.");
    }

    /** Check if element is visible (boolean, no assertion). */
    async isPresent(): Promise<boolean> {
        try {
            const element = await this.resolve();
            return await element.action(this._timeout).isPresent();
        } catch {
            return false;
        }
    }

    /**
     * Unified visibility entry point. Returns a `VisibleChain` that is both:
     *
     * - **awaitable as `Promise<boolean>`** — the probe, never throws. Backwards
     *   compatible with the old `isVisible(): Promise<boolean>` signature —
     *   `await steps.on(el, page).isVisible({ timeout: 500 })` still resolves
     *   to a boolean at runtime.
     * - **chainable with action methods and the matcher tree** — the gate,
     *   silently skips when the element is hidden. Replaces `ifVisible()`.
     *
     * Every probe and gate decision is logged under `tester:visible` with a
     * `[probe]` or `[gate]` tag so silently-skipped actions stay debuggable.
     *
     * @param options - `{ timeout?: 2000, containsText?: string }`. When
     *   `containsText` is provided, the probe is `true` only if the element is
     *   visible AND its text contains the given substring. Note: matcher-tree
     *   gates (`.isVisible().text.toBe(...)`) only honor the visibility check —
     *   `containsText` applies to probe + action-gate paths.
     *
     * @example
     * ```ts
     * // Probe
     * if (await steps.on('banner', 'Page').isVisible({ timeout: 500 })) { … }
     *
     * // Gate
     * await steps.on('cookieBanner', 'Page').isVisible().click();
     * await steps.on('promo', 'Page').isVisible({ timeout: 500 }).text.toBe('Promo');
     * ```
     */
    isVisible(options?: IsVisibleOptions): VisibleChain {
        return new VisibleChain(this, options);
    }

    /** Assert an attribute value. Delegates to the matcher tree's `.attributes.get(name).toBe(value)`. */
    async verifyAttribute(attributeName: string, expectedValue: string): Promise<void> {
        await this.expectBuilder().attributes.get(attributeName).toBe(expectedValue);
    }

    /** Assert input value. Delegates to the matcher tree's `.value.toBe(expectedValue)`. */
    async verifyInputValue(expectedValue: string): Promise<void> {
        await this.expectBuilder().value.toBe(expectedValue);
    }

    /**
     * Assert every matched image has a real `src`, non-zero `naturalWidth`, and
     * decodes successfully. Collection-level — resolves with
     * `SelectionStrategy.ALL` regardless of any strategy selector.
     */
    async verifyImages(scroll: boolean = true): Promise<void> {
        const element = await this.repo.get(this.elementName, this.pageName, { strategy: SelectionStrategy.ALL });
        await this.interactions.verify.images(element, scroll);
    }

    /** Assert element state. */
    async verifyState(state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport'): Promise<void> {
        const selector = this.repo.getSelector(this.elementName, this.pageName);
        await this.interactions.verify.state(selector, state);
    }

    /** Assert CSS property value. Delegates to the matcher tree's `.css(property).toBe(value)`. */
    async verifyCssProperty(property: string, expectedValue: string): Promise<void> {
        await this.expectBuilder().css(property).toBe(expectedValue);
    }

    /**
     * Assert all matched elements appear in the exact text order specified.
     *
     * Collection-level — ignores any `.first()` / `.nth()` / `.random()` strategy
     * on the chain and resolves with `SelectionStrategy.ALL` so the full list is
     * compared against `expectedTexts`.
     */
    async verifyOrder(expectedTexts: string[]): Promise<void> {
        const element = await this.repo.get(this.elementName, this.pageName, { strategy: SelectionStrategy.ALL });
        await this.interactions.verify.order(element, expectedTexts);
    }

    /**
     * Assert all matched elements are sorted in the given direction.
     *
     * Collection-level — resolves with `SelectionStrategy.ALL` regardless of any
     * strategy selector on the chain.
     */
    async verifyListOrder(direction: 'asc' | 'desc'): Promise<void> {
        const element = await this.repo.get(this.elementName, this.pageName, { strategy: SelectionStrategy.ALL });
        await this.interactions.verify.listOrder(element, direction);
    }

    // -- Terminal actions: extractions --

    /** Get the text content of the resolved element. */
    async getText(): Promise<string | null> {
        const element = await this.resolve();
        return element.action(this._timeout).getText();
    }

    /** Get an attribute value. */
    async getAttribute(name: string): Promise<string | null> {
        const element = await this.resolve();
        return element.action(this._timeout).getAttribute(name);
    }

    /** Get the count of matching elements. */
    async getCount(): Promise<number> {
        const element = await this.resolve();
        return element.action(this._timeout).getCount();
    }

    /** Get all text contents from matching elements. */
    async getAllTexts(): Promise<string[]> {
        const element = await this.resolve();
        return await this.interactions.extract.getAllTexts(element);
    }

    /** Get input value. */
    async getInputValue(): Promise<string> {
        const element = await this.resolve();
        return element.action(this._timeout).getInputValue();
    }

    /** Get computed CSS property value. */
    async getCssProperty(property: string): Promise<string> {
        const element = await this.resolve();
        return await this.interactions.extract.getCssProperty(element, property);
    }

    /** Take a screenshot of the element. */
    async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
        const element = await this.resolve();
        return await this.interactions.extract.screenshot(element, options);
    }

    // -- Expect matcher tree + predicate escape hatch --

    /**
     * Captures a snapshot of the element's state at the current moment. Used
     * by the matcher tree (`.text.toBe(...)`, `.count.toBeGreaterThan(...)`,
     * etc.) and by the predicate form of `expect(...)`.
     *
     * Snapshot fields are all primitives — no async access needed in predicates.
     */
    async captureSnapshot(): Promise<ElementSnapshot> {
        const element = await this.resolve();
        const first = element.first();
        // Count is always the un-narrowed match count so count-based matchers
        // work even when the default `.first()` narrowing has been applied.
        // Other fields use the narrowed element so strategy selectors
        // (nth / byText / byAttribute) still scope to the chosen element.
        const allElement = await this.repo.get(this.elementName, this.pageName, { strategy: SelectionStrategy.ALL });
        // getAllAttributes is web-only (DOM iteration); narrow for that one read.
        const firstAsWeb = first as WebElement;

        const [count, rawText, value, attributes, visible, enabled] = await Promise.all([
            allElement.count().catch(() => 0),
            first.textContent().catch(() => null),
            first.inputValue().catch(() => ''),
            firstAsWeb.getAllAttributes().catch(() => ({} as Record<string, string>)),
            first.isVisible().catch(() => false),
            first.isEnabled().catch(() => false),
        ]);

        return { text: (rawText ?? '').trim(), value, attributes, visible, enabled, count };
    }

    /** Build the context object consumed by the matcher tree classes. */
    buildExpectContext(): ExpectContext {
        return {
            elementName: this.elementName,
            pageName: this.pageName,
            timeout: this._timeout,
            conditionalVisible: this.conditionalVisible,
            visibilityTimeout: this.visibilityTimeout,
            resolveElement: () => this.resolve(),
            resolveAll: () => this.repo.get(this.elementName, this.pageName, { strategy: SelectionStrategy.ALL }),
            captureSnapshot: () => this.captureSnapshot(),
            verify: this.interactions.verify,
        };
    }

    /**
     * Matcher tree rooted at this element. All field matchers (`text`, `value`,
     * `count`, `visible`, `enabled`, `attributes`, `css(...)`) and the
     * predicate form (`satisfy(pred)`) are exposed via an internal `ExpectBuilder`
     * so the surface stays consistent between `steps.on()` and `steps.expect()`.
     */
    private expectBuilder(negated: boolean = false): ExpectBuilder {
        return new ExpectBuilder(this.buildExpectContext(), negated);
    }

    get text() { return this.expectBuilder().text; }
    get value() { return this.expectBuilder().value; }
    get count() { return this.expectBuilder().count; }
    get visible() { return this.expectBuilder().visible; }
    get enabled() { return this.expectBuilder().enabled; }
    get attributes() { return this.expectBuilder().attributes; }
    css(property: string) { return this.expectBuilder().css(property); }

    /**
     * Returns a negated matcher tree. Flip the expected outcome of any matcher
     * reached from this object.
     *
     * @example
     * await steps.on('error', 'Page').not.text.toContain('Error');
     * await steps.on('submitBtn', 'Page').not.enabled.toBe(false);
     */
    get not(): ExpectBuilder {
        return this.expectBuilder(true);
    }

    /**
     * Predicate escape hatch. Queues a custom predicate assertion and returns
     * the chain builder so more matchers can follow. End the chain with
     * `.throws(message)` to override the failure message.
     *
     * Named `satisfy` to avoid overlap with field-matcher `.text.toBe('x')`
     * which asserts value equality on a specific field.
     *
     * @example
     * await steps.on('price', 'ProductPage')
     *   .satisfy(el => parseFloat(el.text.slice(1)) > 10)
     *   .throws('price must be above $10');
     */
    satisfy(predicate: (el: ElementSnapshot) => boolean): ExpectBuilder {
        return this.expectBuilder().satisfy(predicate);
    }

    // -- Terminal actions: waiting --

    /** Wait for the element to reach the specified state. */
    async waitForState(state: 'visible' | 'attached' | 'hidden' | 'detached' = 'visible'): Promise<void> {
        const element = await this.resolve();
        await element.action(this._timeout).waitForState(state);
    }
}
