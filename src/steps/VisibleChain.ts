import { WebElement } from '@civitas-cerebrum/element-repository';
import { ElementAction } from './ElementAction';
import { IsVisibleOptions, ClickOptions, DropdownSelectOptions, DragAndDropOptions } from '../enum/Options';
import { createLogger } from '../logger/Logger';

const log = createLogger('visible');

/**
 * Dual-behavior chain returned by `steps.on(el, page).visible(options?)` and
 * `steps.visible(el, page, options?)`. Consolidates the old `isVisible()`
 * probe and `ifVisible()` modifier into one entry point.
 *
 * Two modes of use:
 *
 * **1. Probe (`await chain`)** — resolves to `boolean`, never throws.
 *    Replaces the deprecated `isVisible(...)` probe.
 *
 *    ```ts
 *    const ok = await steps.on('banner', 'Page').visible({ timeout: 500 });
 *    if (ok) { … }
 *    ```
 *
 * **2. Gate (`chain.click()` / `.fill(...)` / matcher tree)** — runs the same
 *    probe, then either executes the action or silently skips it. Replaces
 *    the deprecated `ifVisible(...)` modifier.
 *
 *    ```ts
 *    await steps.on('cookieBanner', 'Page').visible().click();
 *    await steps.on('promo', 'Page').visible({ timeout: 500 }).text.toBe('Promo');
 *    ```
 *
 * Every probe and gate decision is logged under `tester:visible` with a
 * `[probe]` or `[gate]` tag so test failures that end in a silently-skipped
 * action remain traceable without sprinkling `console.log` through user code:
 *
 *    tester:visible [probe] "banner" @ "HomePage" (timeout=500ms) → true
 *    tester:visible [gate] skipping click() on "cookieBanner" @ "HomePage" — not visible
 *    tester:visible [gate] executing fill() on "searchInput" @ "SearchPage" — visible
 */
export class VisibleChain implements PromiseLike<boolean> {
    constructor(
        private action: ElementAction,
        private options: IsVisibleOptions = {},
    ) {
        // Wire the `ifVisible()` gate on the underlying ElementAction so the
        // matcher-tree access (`.visible().text.toBe(...)`) inherits the skip
        // semantics for free via `ExpectContext.conditionalVisible`.
        this.action.ifVisible(options.timeout);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Probe path — `await chain` resolves to boolean.
    // ──────────────────────────────────────────────────────────────────────

    then<TResult1 = boolean, TResult2 = never>(
        onfulfilled?: ((value: boolean) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
        return this.probe().then(onfulfilled as any, onrejected as any);
    }

    /**
     * Runs the visibility check (and optional `containsText` filter) without
     * throwing. Constructs a `WebElement` directly from the raw selector so
     * the caller-supplied `timeout` is the only wait — avoids the 15s
     * repository-resolution default that `repo.get(...)` would impose.
     */
    private async probe(): Promise<boolean> {
        const el = this.action['elementName'] as string;
        const pg = this.action['pageName'] as string;
        const repo = this.action['repo'] as { getSelector: (e: string, p: string) => string; driver: { locator: (s: string) => { first: () => import('@playwright/test').Locator } } };
        const timeout = this.options.timeout ?? 2000;
        const containsText = this.options.containsText;
        try {
            const selector = repo.getSelector(el, pg);
            const element = new WebElement(repo.driver.locator(selector).first());
            await element.waitFor({ state: 'visible', timeout });
            if (containsText) {
                const text = await element.textContent().catch(() => null);
                const ok = text !== null && text.includes(containsText);
                log('[probe] "%s" @ "%s" (timeout=%dms, containsText="%s") → %s', el, pg, timeout, containsText, ok);
                return ok;
            }
            log('[probe] "%s" @ "%s" (timeout=%dms) → true', el, pg, timeout);
            return true;
        } catch {
            log('[probe] "%s" @ "%s" (timeout=%dms) → false', el, pg, timeout);
            return false;
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Gate path — action methods probe first, then execute or skip.
    // ──────────────────────────────────────────────────────────────────────

    /** Click — gated on visibility. Silently skips if hidden. */
    async click(options?: ClickOptions): Promise<void> {
        await this.gate('click', () => this.action.click(options));
    }

    /** `clickIfPresent` gated on visibility. Returns `false` when the gate skips. */
    async clickIfPresent(options?: ClickOptions): Promise<boolean> {
        return this.gateReturning('clickIfPresent', false, () => this.action.clickIfPresent(options));
    }

    /** Hover — gated. */
    async hover(): Promise<void> {
        await this.gate('hover', () => this.action.hover());
    }

    /** Fill — gated. */
    async fill(text: string): Promise<void> {
        await this.gate('fill', () => this.action.fill(text));
    }

    /** Scroll into view — gated. */
    async scrollIntoView(): Promise<void> {
        await this.gate('scrollIntoView', () => this.action.scrollIntoView());
    }

    /** Check — gated. */
    async check(): Promise<void> {
        await this.gate('check', () => this.action.check());
    }

    /** Uncheck — gated. */
    async uncheck(): Promise<void> {
        await this.gate('uncheck', () => this.action.uncheck());
    }

    /** Double-click — gated. */
    async doubleClick(): Promise<void> {
        await this.gate('doubleClick', () => this.action.doubleClick());
    }

    /** Right-click — gated. */
    async rightClick(): Promise<void> {
        await this.gate('rightClick', () => this.action.rightClick());
    }

    /** Type sequentially — gated. */
    async typeSequentially(text: string, delay?: number): Promise<void> {
        await this.gate('typeSequentially', () => this.action.typeSequentially(text, delay));
    }

    /** Upload file — gated. */
    async uploadFile(filePath: string): Promise<void> {
        await this.gate('uploadFile', () => this.action.uploadFile(filePath));
    }

    /** Clear input — gated. */
    async clearInput(): Promise<void> {
        await this.gate('clearInput', () => this.action.clearInput());
    }

    /** Select dropdown — gated. Returns the selected value, or empty string when skipped. */
    async selectDropdown(options?: DropdownSelectOptions): Promise<string> {
        return this.gateReturning('selectDropdown', '', () => this.action.selectDropdown(options));
    }

    /** Set slider value — gated. */
    async setSliderValue(value: number): Promise<void> {
        await this.gate('setSliderValue', () => this.action.setSliderValue(value));
    }

    /** Select multiple — gated. Returns the selected values, or empty array when skipped. */
    async selectMultiple(values: string[]): Promise<string[]> {
        return this.gateReturning('selectMultiple', [] as string[], () => this.action.selectMultiple(values));
    }

    /** Drag and drop — gated. */
    async dragAndDrop(options: DragAndDropOptions): Promise<void> {
        await this.gate('dragAndDrop', () => this.action.dragAndDrop(options));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Matcher tree — gated via `ExpectContext.conditionalVisible`.
    //
    // The matcher tree accessors forward to the underlying ElementAction.
    // `ifVisible()` was already invoked in the constructor, so a hidden
    // element short-circuits the matcher without throwing. The
    // `containsText` filter is NOT honored by matcher-tree gates — it only
    // applies to probe + action-gate paths. For content-filtered assertions,
    // use `.text.toContain(...)` directly or combine with `satisfy(...)`.
    // ──────────────────────────────────────────────────────────────────────

    get text() { return this.action.text; }
    get value() { return this.action.value; }
    get count() { return this.action.count; }
    get enabled() { return this.action.enabled; }
    get visible() { return this.action.visible; }
    get attributes() { return this.action.attributes; }
    css(property: string) { return this.action.css(property); }
    satisfy(predicate: Parameters<ElementAction['satisfy']>[0]) { return this.action.satisfy(predicate); }
    get not() { return this.action.not; }

    // ──────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────────

    private async gate(name: string, exec: () => Promise<unknown>): Promise<void> {
        const el = this.action['elementName'] as string;
        const pg = this.action['pageName'] as string;
        if (!(await this.probe())) {
            log('[gate] skipping %s() on "%s" @ "%s" — not visible', name, el, pg);
            return;
        }
        log('[gate] executing %s() on "%s" @ "%s" — visible', name, el, pg);
        await exec();
    }

    private async gateReturning<T>(name: string, fallback: T, exec: () => Promise<T>): Promise<T> {
        const el = this.action['elementName'] as string;
        const pg = this.action['pageName'] as string;
        if (!(await this.probe())) {
            log('[gate] skipping %s() on "%s" @ "%s" — not visible (returning fallback)', name, el, pg);
            return fallback;
        }
        log('[gate] executing %s() on "%s" @ "%s" — visible', name, el, pg);
        return exec();
    }
}
