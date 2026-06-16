import { Page, test } from '@playwright/test';
import { ClickOptions, DropdownSelectOptions, DropdownSelectType, DragAndDropOptions, ListedElementMatch, ActionTimeoutOptions, TextMatcher } from '../enum/Options';
import { Utils } from '../utils/ElementUtilities';
import { Element, WebElement } from '@civitas-cerebrum/element-repository';
import { log } from '../logger/Logger';

/**
 * Normalizes a `TextMatcher` into a string (for substring matching) or
 * RegExp (for pattern matching). `undefined` passes through so callers can
 * easily check "was a matcher provided?".
 */
function compileTextMatcher(matcher: TextMatcher): string | RegExp;
function compileTextMatcher(matcher: TextMatcher | undefined): string | RegExp | undefined;
function compileTextMatcher(matcher: TextMatcher | undefined): string | RegExp | undefined {
    if (matcher === undefined) return undefined;
    if (typeof matcher === 'string') return matcher;
    return new RegExp(matcher.regex, matcher.flags);
}

/**
 * Escapes regex metacharacters in a string so it can be embedded as a literal
 * pattern. Used for the case-insensitive fallback when a plain `text: string`
 * matcher needs to be re-tried as a regex.
 */
function escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


/**
 * The `Interactions` class provides a robust set of methods for interacting
 * with DOM elements. All operations route through element-repository's
 * `Element` interface, keeping this class framework-agnostic.
 *
 * Every method takes an `Element` from the repository. Wrap raw Playwright
 * Locators via `new WebElement(locator)` at the call site if you need to bridge.
 */
export class Interactions {
    private ELEMENT_TIMEOUT: number;
    private utils: Utils;

    constructor(private page: Page, timeout: number = 30000, private interceptionRetry: boolean = true) {
        this.ELEMENT_TIMEOUT = timeout;
        this.utils = new Utils(this.ELEMENT_TIMEOUT);
    }

    private async softProbe(element: WebElement, state: 'visible' | 'attached', timeout?: number): Promise<void> {
        await this.utils.softProbe(element, state, timeout);
    }

    /**
     * Performs a standard click on the given element.
     * Automatically waits for the element to be attached, visible, stable, and actionable.
     */
    async click(element: WebElement, options?: ClickOptions): Promise<boolean | void> {
        const useDispatch = options?.force || options?.withoutScrolling;
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;

        if (options?.ifPresent) {
            if (await element.isVisible()) {
                if (useDispatch) {
                    await this.dispatchClick(element, timeout);
                } else {
                    await this.clickWithInterceptionRetry(element, timeout, options?.subject);
                }
                return true;
            }
            return false;
        }

        if (useDispatch) {
            await this.dispatchClick(element, timeout);
            return;
        }

        await this.utils.waitForState(element, 'visible', timeout);
        await this.clickWithInterceptionRetry(element, timeout, options?.subject);
    }

    /**
     * Dispatches a native 'click' event directly on the element, bypassing
     * actionability checks. Used for both `force` and `withoutScrolling`.
     */
    private async dispatchClick(element: WebElement, timeout: number): Promise<void> {
        await this.softProbe(element, 'attached', timeout);
        await element.dispatchEvent('click');
    }

    /**
     * Attempts a standard click. If interception is reported and
     * `interceptionRetry` is enabled (default), retries by dispatching a
     * native click event on the element instead — and surfaces the fallback
     * via a `log.warn` line plus a report-visible Playwright test annotation
     * (`interception-fallback`). When `interceptionRetry` is `false`, the
     * original interception error is rethrown so genuine overlay bugs
     * (stuck modals, cookie walls) fail the click.
     *
     * @param subject - Optional element identity (`PageName.elementName`)
     *   threaded down from the Steps/ElementAction layer, which is where the
     *   names are known. Included in the log line and the annotation.
     */
    private async clickWithInterceptionRetry(element: WebElement, timeout: number, subject?: string): Promise<void> {
        try {
            await element.click({ timeout: Math.min(timeout, 5000) });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('intercepts pointer events')) {
                if (!this.interceptionRetry) throw error;
                const lines = message.split('\n');
                const interceptLine = lines.find(l => l.includes('intercepts pointer events'))?.trim();
                const detail = `click on ${subject ?? 'element'} intercepted by another element — fell back to dispatchEvent('click'). `
                    + `${lines[0]}${interceptLine ? ` — ${interceptLine}` : ''}`;
                log.warn(detail);
                this.annotate('interception-fallback', detail);
                await element.dispatchEvent('click');
            } else {
                await element.click({ timeout });
            }
        }
    }

    /**
     * Pushes a report-visible annotation when running inside a Playwright
     * test. No-ops outside a test-runner context (library consumers driving
     * a raw Page), where the `log.warn` line is the only signal.
     */
    private annotate(type: string, description: string): void {
        try {
            // test.info() throws when no test is running; the try/catch is the
            // guard that makes this a no-op for library consumers.
            test.info().annotations.push({ type, description });
        } catch {
            /* not in a test context — the log.warn above is the only signal */
        }
    }

    /**
     * Clicks only if the element is present and visible. Returns true if clicked,
     * false if the element was absent — does not throw.
     */
    async clickIfPresent(element: WebElement, options?: ActionTimeoutOptions): Promise<boolean> {
        return await this.click(element, { ifPresent: true, timeout: options?.timeout }) as boolean;
    }

    async fill(element: WebElement, text: string): Promise<void> {
        await this.softProbe(element, 'visible');
        await element.fill(text, { timeout: this.ELEMENT_TIMEOUT });
    }

    async uploadFile(element: WebElement, filePath: string | string[], options?: ActionTimeoutOptions): Promise<void> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        await this.softProbe(element, 'attached', timeout);
        // TODO: remove cast when element-repository ships widened setInputFiles(string | string[]) type (companion PR #47)
        await (element as any).setInputFiles(filePath, { timeout });
    }

    async dropFiles(
        element: WebElement,
        filenames: string[],
        options?: { mimeType?: string } & ActionTimeoutOptions,
    ): Promise<void> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        await this.softProbe(element, 'attached', timeout);
        // TODO: remove cast when element-repository ships WebElement.dropFiles (companion PR #47)
        await (element as any).dropFiles(filenames, { mimeType: options?.mimeType, timeout });

    /**
     * Unified method to interact with `<select>` dropdown elements based on the specified `DropdownSelectType`.
     * If no options are provided, safely defaults to randomly selecting an enabled, non-empty option.
     */
    async selectDropdown(
        element: WebElement,
        options: DropdownSelectOptions = { type: DropdownSelectType.RANDOM }
    ): Promise<string> {
        const timeout = options.timeout ?? this.ELEMENT_TIMEOUT;
        await this.softProbe(element, 'visible', timeout);
        const type = options.type ?? DropdownSelectType.RANDOM;

        if (type === DropdownSelectType.VALUE) {
            if (options.value === undefined) {
                throw new Error('[Action] Error -> "value" must be provided when using DropdownSelectType.VALUE.');
            }
            const selected = await element.selectOption({ value: options.value }, { timeout });
            return selected[0];
        }

        if (type === DropdownSelectType.INDEX) {
            if (options.index === undefined) {
                throw new Error('[Action] Error -> "index" must be provided when using DropdownSelectType.INDEX.');
            }
            const selected = await element.selectOption({ index: options.index }, { timeout });
            return selected[0];
        }

        // Random path — look for enabled, non-empty <option> descendants.
        const enabledOptions = element.locateChild('option:not([disabled]):not([value=""])');

        // Optional probe: absence of enabled options is handled by the explicit
        // count check below, which produces the clearer domain error.
        await this.utils.waitForState(enabledOptions.first() as WebElement, 'attached', timeout, true);

        const count = await enabledOptions.count();
        if (count === 0) {
            throw new Error('[Action] Error -> No enabled options found to select!');
        }

        const randomIndex = Math.floor(Math.random() * count);
        const valueToSelect = await enabledOptions.nth(randomIndex).getAttribute('value');

        if (valueToSelect === null) {
            throw new Error(`[Action] Error -> Option at index ${randomIndex} is missing a "value" attribute.`);
        }

        const selected = await element.selectOption({ value: valueToSelect }, { timeout });
        return selected[0];
    }

    async hover(element: WebElement): Promise<void> {
        await this.softProbe(element, 'visible');
        await element.hover({ timeout: this.ELEMENT_TIMEOUT });
    }

    async scrollIntoView(element: WebElement): Promise<void> {
        await this.softProbe(element, 'attached');
        await element.scrollIntoView({ timeout: this.ELEMENT_TIMEOUT });
    }

    /**
     * Drags an element to a target element or by a coordinate offset.
     * Absolute-offset drags use the page's mouse API (no Element equivalent
     * exists today); all other paths route through `Element.dragTo`.
     */
    async dragAndDrop(element: WebElement, options: DragAndDropOptions): Promise<void> {
        const timeout = options.timeout ?? this.ELEMENT_TIMEOUT;
        // Hard waits: both drag paths read boundingBox / drive page.mouse,
        // which need the elements actually visible and elapsed time bounded.
        await this.utils.waitForState(element, 'visible', timeout);

        if (options.target) {
            const dropElement = options.target;
            await this.utils.waitForState(dropElement, 'visible', timeout);

            if (options.xOffset !== undefined && options.yOffset !== undefined) {
                const targetBox = await dropElement.boundingBox();
                if (!targetBox) {
                    throw new Error('[Action] Error -> Unable to get bounding box for target element.');
                }

                const targetPosition = {
                    x: (targetBox.width / 2) + options.xOffset,
                    y: (targetBox.height / 2) + options.yOffset,
                };

                await element.dragTo(dropElement, {
                    targetPosition,
                    timeout,
                });
                return;
            }

            await element.dragTo(dropElement, { timeout });
            return;
        }

        if (options.xOffset !== undefined && options.yOffset !== undefined) {
            // The `waitForState('visible')` above throws on timeout (0.3.7), so
            // the element is guaranteed visible here and elapsed time is bounded.
            const box = await element.boundingBox();
            if (!box) {
                throw new Error('[Action] Error -> Unable to get bounding box for element to perform drag action.');
            }

            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;

            // Mouse-level drag — no Element equivalent; page.mouse is the documented path.
            await this.page.mouse.move(startX, startY);
            await this.page.mouse.down();
            await this.page.mouse.move(startX + options.xOffset, startY + options.yOffset, { steps: 10 });
            await this.page.mouse.up();
            return;
        }

        throw new Error(`[Action] Error -> You must provide either 'targetLocator', or both 'xOffset' and 'yOffset' in DragAndDropOptions.`);
    }

    /**
     * Filters an element list and returns the first match for the given text.
     * Uses Element.filter composition.
     */
    public async getByText(
        base: Element,
        desiredText: string,
        strict: boolean = false,
    ): Promise<Element | null> {
        const caseSensitive = base.filter({ hasText: desiredText }).first();
        if ((await caseSensitive.count()) > 0) {
            return caseSensitive;
        }

        const escaped = desiredText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const caseInsensitive = base.filter({ hasText: new RegExp(escaped, 'i') }).first();
        if ((await caseInsensitive.count()) > 0) {
            return caseInsensitive;
        }

        const all = await base.all();
        const rawTexts = await Promise.all(all.map(e => e.textContent()));
        const availableTexts = rawTexts.map(t => (t ?? '').trim()).filter(t => t.length > 0);

        const msg = `getByText: element with text "${desiredText}" not found.\nAvailable texts: ${availableTexts.length > 0 ? `\n- ${availableTexts.join('\n- ')}` : 'None'}`;
        if (strict) throw new Error(msg);
        return null;
    }

    async typeSequentially(element: WebElement, text: string, delay: number = 100): Promise<void> {
        await this.softProbe(element, 'visible');
        await element.pressSequentially(text, delay, { timeout: this.ELEMENT_TIMEOUT });
    }

    /** Right-click (context menu) on the given element. Web-only. */
    async rightClick(element: WebElement, options?: ActionTimeoutOptions): Promise<void> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        await this.softProbe(element, 'visible', timeout);
        await element.rightClick({ timeout });
    }

    async doubleClick(element: WebElement): Promise<void> {
        await this.softProbe(element, 'visible');
        await element.doubleClick({ timeout: this.ELEMENT_TIMEOUT });
    }

    async check(element: WebElement): Promise<void> {
        await this.softProbe(element, 'visible');
        await element.check({ timeout: this.ELEMENT_TIMEOUT });
    }

    async uncheck(element: WebElement): Promise<void> {
        await this.softProbe(element, 'visible');
        await element.uncheck({ timeout: this.ELEMENT_TIMEOUT });
    }

    async setSliderValue(element: WebElement, value: number, options?: ActionTimeoutOptions): Promise<void> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        await this.softProbe(element, 'visible', timeout);
        await element.fill(String(value), { timeout });
    }

    async pressKey(key: string): Promise<void> {
        await this.page.keyboard.press(key);
    }

    async clearInput(element: WebElement): Promise<void> {
        await this.softProbe(element, 'visible');
        await element.clear({ timeout: this.ELEMENT_TIMEOUT });
    }

    async selectMultiple(element: WebElement, values: string[], options?: ActionTimeoutOptions): Promise<string[]> {
        const timeout = options?.timeout ?? this.ELEMENT_TIMEOUT;
        await this.softProbe(element, 'visible', timeout);
        return element.selectOption(values.map(v => ({ value: v })), { timeout });
    }

    /**
     * Resolves a specific element from a list by matching visible text or an attribute,
     * with optional child-element drill-down.
     *
     * Returns an `Element` — pass it into any `interact`/`verify`/`extract` method,
     * or cast to `WebElement` to reach the raw Playwright `Locator` for Playwright-specific
     * composition (e.g. `.and()`, `.or()`).
     */
    async getListedElement(
        base: WebElement,
        options: ListedElementMatch,
        repo?: { getSelector(elementName: string, pageName: string): string },
    ): Promise<WebElement> {
        if (!options.text && !options.attribute && !options.withDescendant) {
            throw new Error('ListedElementOptions requires "text", "attribute", or "withDescendant" to identify the element.');
        }

        // Stage 1 — narrow by `text` OR `attribute` (whichever is provided).
        // A regex `text` matches directly; a plain string retries case-insensitively
        // if the exact substring misses (back-compat with v0.2.5 behavior).
        let narrowed: Element = base;

        if (options.text !== undefined) {
            const compiled = compileTextMatcher(options.text);
            if (compiled instanceof RegExp) {
                narrowed = narrowed.filter({ hasText: compiled });
            } else {
                const caseSensitive = narrowed.filter({ hasText: compiled });
                if ((await caseSensitive.count()) > 0) {
                    narrowed = caseSensitive;
                } else {
                    narrowed = narrowed.filter({ hasText: new RegExp(escapeRegex(compiled), 'i') });
                }
            }
        }

        if (options.attribute !== undefined) {
            const { name, value } = options.attribute;
            // `locator.and()` composes attribute narrowing on the base locator.
            // No Element equivalent today — drop to Locator internally.
            const current = (narrowed as WebElement).locator;

            if (typeof value === 'string') {
                // Exact-string attribute match via CSS selector composition.
                narrowed = new WebElement(current.and(this.page.locator(`[${name}="${value}"]`)));
            } else {
                // Regex attribute match — CSS attribute selectors don't express regex,
                // so narrow to candidates with the attribute present, then test each
                // attribute value against the pattern in JS.
                const pattern = compileTextMatcher(value) as RegExp;
                const candidates = current.and(this.page.locator(`[${name}]`));
                const all = await candidates.all();
                let picked: (typeof all)[number] | null = null;
                for (const candidate of all) {
                    const actual = await candidate.getAttribute(name);
                    if (actual !== null && pattern.test(actual)) {
                        picked = candidate;
                        break;
                    }
                }
                if (!picked) {
                    throw new Error(`No listed element found with attribute "${name}" matching ${pattern}.`);
                }
                narrowed = new WebElement(picked);
            }
        }

        // Stage 2 — optionally filter further by descendant presence / text.
        if (options.withDescendant) {
            const desc = options.withDescendant;
            const childSelector = typeof desc.child === 'string'
                ? desc.child
                : (repo
                    ? repo.getSelector(desc.child.elementName, desc.child.pageName)
                    : (() => { throw new Error('An ElementRepository instance is required when `withDescendant.child` is a page-repository reference.'); })());
            const current = (narrowed as WebElement).locator;
            const descendantLocator = this.page.locator(childSelector);
            const textMatcher = compileTextMatcher(desc.text);
            const filterOpts = textMatcher !== undefined
                ? { has: descendantLocator.filter({ hasText: textMatcher }) }
                : { has: descendantLocator };
            narrowed = new WebElement(current.filter(filterOpts));
        }

        // Always take the first match after all filters compose.
        const matched = narrowed.first() as WebElement;

        // Hard wait (0.3.7): a non-matching listed element must fail here with
        // a clear wait error, not hand back a locator that points to nothing.
        await this.utils.waitForState(matched, 'visible');

        // Stage 3 — optionally drill into a child for the returned locator.
        if (!options.child) {
            return matched;
        }

        if (typeof options.child === 'string') {
            return matched.locateChild(options.child) as WebElement;
        }

        if (!repo) {
            throw new Error('An ElementRepository instance is required when "child" is a page-repository reference.');
        }
        const childSelector = repo.getSelector(options.child.elementName, options.child.pageName);
        return matched.locateChild(childSelector) as WebElement;
    }
}
