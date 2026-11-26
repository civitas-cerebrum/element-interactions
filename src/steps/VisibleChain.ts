import { ElementAction } from './ElementAction';
import { IsVisibleOptions, ClickOptions, DropdownSelectOptions, DragAndDropOptions } from '../enum/Options';
import { createLogger } from '../logger/Logger';
import { requireWebPlatform } from './platformGuard';
import type { ScrollIntoViewOptions } from '@civitas-cerebrum/element-repository';

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
 *    the deprecated `ifVisible(...)` modifier. A web-only terminal (`hover`,
 *    `rightClick`, `uploadFile`, `selectDropdown`, `setSliderValue`,
 *    `selectMultiple`) or matcher (`css`) on a device throws
 *    `PlatformNotSupportedError(step, platform)` first, before the probe, as
 *    the ungated step does: it is never skipped as "not visible".
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
     * throwing: the family's probe (`IVerifications.probeVisible`) through the
     * action, which re-resolves the entry on every attempt so a primary that
     * appears late is picked up. `timeout` is the probe's whole budget, so the
     * repository's resolution default is never imposed on a probe.
     */
    private async probe(): Promise<boolean> {
        const { elementName: el, pageName: pg } = this.action;
        const timeout = this.options.timeout ?? 2000;
        const containsText = this.options.containsText;
        const ok = await this.action.probeVisible(timeout, containsText);
        log('[probe] "%s" @ "%s" (timeout=%dms%s) → %s', el, pg, timeout,
            containsText === undefined ? '' : `, containsText="${containsText}"`, ok);
        return ok;
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

    /** Hover — gated. Web only: on a device it throws `PlatformNotSupportedError('hover', platform)` before the probe. */
    async hover(): Promise<void> {
        await this.webOnlyGate('hover', () => this.action.hover());
    }

    /** Fill — gated. */
    async fill(text: string): Promise<void> {
        await this.gate('fill', () => this.action.fill(text));
    }

    /** Scroll into view — gated. Same options as {@link ElementAction.scrollIntoView}. */
    async scrollIntoView(options?: ScrollIntoViewOptions): Promise<void> {
        await this.gate('scrollIntoView', () => this.action.scrollIntoView(options));
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

    /** Right-click — gated. Web only (refused on a device before the probe). */
    async rightClick(): Promise<void> {
        await this.webOnlyGate('rightClick', () => this.action.rightClick());
    }

    /** Type sequentially — gated. */
    async typeSequentially(text: string, delay?: number): Promise<void> {
        await this.gate('typeSequentially', () => this.action.typeSequentially(text, delay));
    }

    /** Upload file — gated. Web only (refused on a device before the probe). */
    async uploadFile(filePath: string): Promise<void> {
        await this.webOnlyGate('uploadFile', () => this.action.uploadFile(filePath));
    }

    /** Clear input — gated. */
    async clearInput(): Promise<void> {
        await this.gate('clearInput', () => this.action.clearInput());
    }

    /** Select dropdown — gated. Returns the selected value, or empty string when skipped. Web only (refused on a device before the probe). */
    async selectDropdown(options?: DropdownSelectOptions): Promise<string> {
        this.requireWeb('selectDropdown');
        return this.gateReturning('selectDropdown', '', () => this.action.selectDropdown(options));
    }

    /** Set slider value — gated. Web only (refused on a device before the probe). */
    async setSliderValue(value: number): Promise<void> {
        await this.webOnlyGate('setSliderValue', () => this.action.setSliderValue(value));
    }

    /** Select multiple — gated. Returns the selected values, or empty array when skipped. Web only (refused on a device before the probe). */
    async selectMultiple(values: string[]): Promise<string[]> {
        this.requireWeb('selectMultiple');
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

    /**
     * The web-only guard of a gated terminal: throws
     * `PlatformNotSupportedError(name, platform)` off the Playwright family.
     * Called before the probe, so a device never sends a visibility check for
     * a step it cannot perform, and a hidden element never turns the refusal
     * into a silent skip.
     */
    private requireWeb(name: string): void {
        requireWebPlatform(name, this.action.platform);
    }

    /** {@link gate} for a web-only terminal: refused off the Playwright family before the probe. */
    private async webOnlyGate(name: string, exec: () => Promise<unknown>): Promise<void> {
        this.requireWeb(name);
        await this.gate(name, exec);
    }

    private async gate(name: string, exec: () => Promise<unknown>): Promise<void> {
        const { elementName: el, pageName: pg } = this.action;
        if (!(await this.probe())) {
            log('[gate] skipping %s() on "%s" @ "%s" — not visible', name, el, pg);
            return;
        }
        log('[gate] executing %s() on "%s" @ "%s" — visible', name, el, pg);
        await exec();
    }

    private async gateReturning<T>(name: string, fallback: T, exec: () => Promise<T>): Promise<T> {
        const { elementName: el, pageName: pg } = this.action;
        if (!(await this.probe())) {
            log('[gate] skipping %s() on "%s" @ "%s" — not visible (returning fallback)', name, el, pg);
            return fallback;
        }
        log('[gate] executing %s() on "%s" @ "%s" — visible', name, el, pg);
        return exec();
    }
}
