import { ElementAction } from './ElementAction';
import { IsVisibleOptions, ClickOptions, DropdownSelectOptions, DragAndDropOptions } from '../enum/Options';
import { createLogger } from '../logger/Logger';

const log = createLogger('visible');

/**
 * Attach slice the probe gives the repository per ATTEMPT (see
 * {@link VisibleChain.probe}), and the cap on each attempt's visibility wait.
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
     * throwing. Resolves the probe target through the action's `probeTarget()`
     * so scoped `findBy*` chains probe their child locator (the stamped scoped
     * name has no repository entry) while repository chains resolve the entry's
     * FULL selector through the repository — role+name, regex text, fallback
     * and frame scope — exactly as an action on the same entry would. `timeout`
     * is the probe's whole budget, so the 15s repository-resolution default is
     * never imposed on a probe.
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
    private async probe(): Promise<boolean> {
        const { elementName: el, pageName: pg } = this.action;
        const timeout = this.options.timeout ?? 2000;
        const containsText = this.options.containsText;
        // `Math.max(1, …)`: a Playwright timeout of 0 means "wait forever", and
        // a 0ms budget must still buy one attempt rather than no answer at all.
        const deadline = Date.now() + Math.max(1, timeout);

        for (;;) {
            const slice = Math.max(1, Math.min(PROBE_SLICE_MS, deadline - Date.now()));
            const element = await this.action.probeTarget(slice).catch(() => null);
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
                        const ok = text !== null && text.includes(containsText);
                        log('[probe] "%s" @ "%s" (timeout=%dms, containsText="%s") → %s', el, pg, timeout, containsText, ok);
                        return ok;
                    }
                    log('[probe] "%s" @ "%s" (timeout=%dms) → true', el, pg, timeout);
                    return true;
                }
            }
            if (Date.now() >= deadline) {
                log('[probe] "%s" @ "%s" (timeout=%dms) → false', el, pg, timeout);
                return false;
            }
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
