import { Locator } from '@playwright/test';
import { ElementRepository, Element, WebElement, ElementResolutionOptions, SelectionStrategy } from '@civitas-cerebrum/element-repository';
import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { DropdownSelectOptions, TextVerifyOptions, CountVerifyOptions, DragAndDropOptions, ScreenshotOptions, IsVisibleOptions } from '../enum/Options';
import {
    ElementSnapshot,
    ExpectBuilder,
    ExpectContext,
    BooleanMatcher,
} from './ExpectMatchers';
import { VisibleChain } from './VisibleChain';

/**
 * The shape returned by the `ElementAction.visible` getter: it is BOTH the
 * matcher-tree boolean field (`.visible.toBeTrue()`, `.visible.not.toBe(false)`)
 * AND callable as the visible-selection strategy (`.visible().click()`). The
 * matcher form is property access; the strategy form is a call. This dual shape
 * exists because `.visible` was already the established matcher-tree getter when
 * the visible-selection strategy was added — overloading the single name keeps
 * both call sites working without a breaking rename.
 *
 * The members are spelled out (rather than `BooleanMatcher & callable`) so the
 * type matches the runtime exactly: `timeout` and `not` step OFF the callable
 * and onto a plain `BooleanMatcher` — mirroring the implementation, which
 * returns the underlying matcher there. Modelling them as a callable
 * `VisibleField` would let `.visible.timeout(500)()` typecheck and then throw at
 * runtime (the matcher is not callable).
 */
export type VisibleField = (() => ElementAction) & {
    /** Assert the resolved boolean equals `expected`. */
    toBe(expected: boolean): ExpectBuilder;
    /** Assert the element is visible. */
    toBeTrue(): ExpectBuilder;
    /** Assert the element is not visible. */
    toBeFalse(): ExpectBuilder;
    /** Apply a per-assertion timeout; resolves to a plain `BooleanMatcher` (no longer the strategy callable). */
    timeout(ms: number): BooleanMatcher;
    /** Negate the assertion; a plain `BooleanMatcher` (no longer the strategy callable). */
    readonly not: BooleanMatcher;
};

/**
 * Floor and cap for the attach slice, per `fallback` chain node, that
 * `verifyAbsence` gives the repository. See
 * {@link ElementAction.absenceAttachSlice} for how the slice is derived.
 *
 * The floor is what it takes to reliably see a node that is ALREADY attached,
 * so a visible primary is never walked past to an absent fallback (a false
 * PASS): a 1ms wait missed a present node in 17 of 20 trials and walked past a
 * visible primary 20/20; 50ms still did 2/20 on a loaded machine; 250ms held
 * 20/20.
 *
 * The cap bounds what a genuinely absent entry pays. A present node returns as
 * soon as it is seen, so only an absent entry pays the slice at all —
 * ~(2N-1) x slice for an N-node chain, one slice without a fallback — and
 * never the repository's resolution default, which is the whole point of
 * slicing rather than deferring to `repo.get`'s own budget.
 */
const ABSENCE_ATTACH_SLICE_FLOOR_MS = 250;
const ABSENCE_ATTACH_SLICE_CAP_MS = 1000;

/**
 * How many times `verifyAbsence` resolves the entry before it blames a
 * divergence between the default and `ALL` resolutions on a multi-match
 * selector. One extra attempt is enough: a multi-match selector diverges on
 * every attempt, whereas a node that attached while the two walks were in
 * flight agrees on the retry.
 */
const ABSENCE_RESOLVE_ATTEMPTS = 2;

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
    private visibleStrategy: boolean = false;
    /**
     * When set, this chain queries WITHIN a parent element instead of resolving
     * `elementName`/`pageName` against the repository. The factory takes the
     * resolved parent `Locator` and returns the un-narrowed child `Locator`
     * (e.g. `parent.getByRole(...)`). Seeded by `findByRole` / `findByText` /
     * `findBySelector`; `resolve()` / `resolveAll()` apply the chain's strategy
     * selectors to the returned locator so every existing terminal composes.
     */
    private scopedChild?: () => Promise<Locator>;

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
        this.visibleStrategy = false;
        return this;
    }

    /**
     * Strategy selector: among duplicate matches, select the *visible* one, then
     * compose with any terminal action / verification — exactly like `.first()`,
     * but skipping hidden matches. Resolves via the repository's `getVisible(...)`
     * with `strict: true`, so it throws when no visible match exists — consistent
     * with every other strategy selector.
     *
     * Distinct from {@link ifVisible} / {@link isVisible}, which *conditionally
     * skip* when the element is hidden — this *selects* the visible duplicate and
     * proceeds. Use it to disambiguate responsive duplicate elements (e.g. a
     * desktop/mobile pair where only one is rendered at the current viewport).
     *
     * Reached as `steps.on(el, page).visible()`. Note `steps.on(el, page).visible`
     * (no call) is the matcher-tree boolean field — `.visible.toBeTrue()`; calling
     * it (`.visible()`) switches the chain into visible-selection mode.
     *
     * @example
     * ```ts
     * await steps.on('navMenu', 'HomePage').visible().click();
     * await steps.on('cta', 'HomePage').visible().verifyState('visible');
     * ```
     */
    private selectVisible(): this {
        this.visibleStrategy = true;
        this.resolutionOptions = {};
        return this;
    }

    /** Select a random matching element. */
    random(): this {
        this.resolutionOptions = { strategy: SelectionStrategy.RANDOM };
        this.visibleStrategy = false;
        return this;
    }

    /** Select the element at the given zero-based index. */
    nth(index: number): this {
        this.resolutionOptions = { strategy: SelectionStrategy.INDEX, index };
        this.visibleStrategy = false;
        return this;
    }

    /** Select the first element matching the given text content. */
    byText(text: string): this {
        this.resolutionOptions = { strategy: SelectionStrategy.TEXT, value: text };
        this.visibleStrategy = false;
        return this;
    }

    /** Select the first element matching the given attribute name-value pair. */
    byAttribute(name: string, value: string): this {
        this.resolutionOptions = { strategy: SelectionStrategy.ATTRIBUTE, attribute: name, value };
        this.visibleStrategy = false;
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

    private async resolve(): Promise<WebElement> {
        // Scoped chains never resolve via the repository — the stamped scoped
        // name has no repo entry. `narrowScoped` honours `visibleStrategy`, so
        // the check order here does not lose `.visible()` on scoped chains.
        if (this.scopedChild) {
            return new WebElement(this.narrowScoped(await this.scopedChild()));
        }
        if (this.visibleStrategy) {
            // strict: true → throws when no visible match exists, matching the
            // throw-on-miss contract of every other strategy selector.
            return (await this.repo.getVisible(this.elementName, this.pageName, true)) as WebElement;
        }
        return (await this.repo.get(this.elementName, this.pageName, this.resolutionOptions)) as WebElement;
    }

    private async resolveAll(): Promise<WebElement> {
        if (this.scopedChild) {
            // Collection-level: ignore any .first()/.nth() narrowing, return the
            // whole child set so count / order / image terminals see every match.
            return new WebElement(await this.scopedChild());
        }
        return (await this.repo.get(this.elementName, this.pageName, { strategy: SelectionStrategy.ALL })) as WebElement;
    }

    /**
     * Target for visibility probes (`VisibleChain`). Scoped chains resolve
     * through `scopedChild` — the repository has no entry for the stamped
     * scoped name. Repository chains resolve through `repo.get(...)`, the same
     * resolution every action and `verify*` uses, so role+name, regex-text,
     * fallback and frame-scoped entries are probed exactly as they would be
     * acted on. The probe's own `timeout` is passed as the per-call attach
     * budget, so a missing element never pays the repository's default
     * resolution wait before the probe reports false.
     *
     * Never builds a locator from `repo.getSelector(...)`: that returns the
     * first plain-string strategy only — it drops an accessible `name`, cannot
     * express a regex, and ignores the page's `frame` — so a probe built on it
     * answers for a different element than the one the entry describes.
     *
     * The chain's strategy selector is forwarded too, so `.nth(i)`,
     * `.byText(...)` and `.byAttribute(...)` probe the element they narrow to.
     * Without it the probe answered for the FIRST match while the gated action
     * went on to resolve the narrowed one — `.nth(1).isVisible().click()` on a
     * list whose first row is hidden reported false and skipped a click on a
     * perfectly visible second row.
     *
     * Note the scoped path resolves the PARENT via the repository first, so a
     * missing parent pays that resolution wait before the probe reports false.
     *
     * @param timeout - Per-node attach budget in ms for the repository
     *   resolution — NOT the probe's whole budget. The repository spends it
     *   once per missing `fallback` chain node, so a caller that wants its
     *   overall deadline respected must bound the number of nodes it is willing
     *   to pay for (see `VisibleChain.probe`), not hand its whole budget over.
     *   Defaults to the chain's visibility timeout. Clamped to at least 1ms,
     *   because a Playwright timeout of 0 means "wait forever".
     */
    async probeTarget(timeout?: number): Promise<WebElement> {
        if (this.scopedChild) {
            return new WebElement(this.narrowScoped(await this.scopedChild()));
        }
        const budget = Math.max(1, timeout ?? this.visibilityTimeout);
        return (await this.repo.get(this.elementName, this.pageName, { ...this.resolutionOptions, timeout: budget })) as WebElement;
    }

    /**
     * Apply this chain's strategy selectors to a scoped child locator. `.nth(i)`
     * narrows by index, the collection strategy returns the whole set,
     * `.visible()` filters to the visible match, and the default / `.first()`
     * resolves the first match. RANDOM / TEXT / ATTRIBUTE are rejected: a
     * scoped `findBy*` query already carries its own role/text/selector filter,
     * so layering a second repo-style strategy on top is ambiguous — we fail
     * fast rather than silently behave like `.first()`.
     * Use `.nth(i)` (or a more specific `findBy*` query) to disambiguate.
     */
    private narrowScoped(child: Locator): Locator {
        const opts = this.resolutionOptions;
        if (opts.strategy === SelectionStrategy.INDEX && opts.index !== undefined) {
            return child.nth(opts.index);
        }
        if (opts.strategy === SelectionStrategy.ALL) {
            return child;
        }
        if (opts.strategy) {
            throw new Error(
                `Strategy '${opts.strategy}' is not supported on a scoped findBy*() chain — ` +
                `the scoped query already filters by role/text/selector. ` +
                `Use .first() / .nth(i), or a more specific findBy*() query, to disambiguate.`,
            );
        }
        if (this.visibleStrategy) {
            // `.visible()` on a scoped chain: keep the only-visible contract by
            // filtering the child set. The scoped name has no repo entry, so
            // `repo.getVisible` cannot serve here; the terminal's own web-first
            // wait surfaces the no-visible-match case loudly (timeout) instead
            // of getVisible's immediate throw.
            return child.filter({ visible: true }).first();
        }
        return child.first();
    }

    /**
     * Spawn a fresh `ElementAction` that queries WITHIN this element. The new
     * chain reuses the same repo / interactions / timeout but resolves through
     * the given child-locator factory instead of the repository, so it composes
     * with every existing terminal (`.count`, `.verifyState`, `.click`,
     * `.getText`, `.first()` / `.nth()`, the matcher tree, …).
     */
    private spawnScoped(label: string, childFactory: (parent: Locator) => Locator): ElementAction {
        // Stamp a descriptive name so logs / click subjects / matcher failures point
        // at the scoped query (e.g. "cookieDialog › findByRole(button)"), not the
        // parent. Safe: scoped chains resolve via `scopedChild`, never `repo.get`.
        const scopedName = `${this.elementName} › ${label}`;
        const scoped = new ElementAction(this.repo, scopedName, this.pageName, this.interactions, this._timeout);
        scoped.scopedChild = async () => {
            const parent = await this.resolve();
            return childFactory(parent.locator);
        };
        return scoped;
    }

    // -- Scoped child queries --
    //
    // "X within a named element" without ever exposing the parent Locator to the
    // test. Each resolves the parent (`steps.on(name, page)`) and returns a NEW
    // scoped `ElementAction` querying inside it. They mirror Playwright's
    // `getByRole` / `getByText` / `locator`, but as an explicit within-parent
    // sub-query distinguished from top-level repository resolution.

    /**
     * Query by ARIA role WITHIN this element. Scopes `parent.getByRole(role, options)`.
     * @example
     * await steps.on('cookieDialog', 'CookieBanner').findByRole('button').count.toBe(2);
     * await steps.on('table', 'TablePage').findByRole('cell', { name: 'Alice Martin' }).getText();
     */
    findByRole(role: Parameters<Locator['getByRole']>[0], options?: { name?: string | RegExp; exact?: boolean }): ElementAction {
        const label = options?.name !== undefined ? `findByRole(${role}, name=${String(options.name)})` : `findByRole(${role})`;
        return this.spawnScoped(label, parent => parent.getByRole(role, options));
    }

    /**
     * Query by text content WITHIN this element. Scopes `parent.getByText(text, options)`.
     * @example
     * await steps.on('cartPanel', 'CartPage').findByText('Your cart is empty').verifyState('visible');
     */
    findByText(text: string | RegExp, options?: { exact?: boolean }): ElementAction {
        return this.spawnScoped(`findByText(${String(text)})`, parent => parent.getByText(text, options));
    }

    /**
     * Query by raw CSS selector WITHIN this element. Scopes `parent.locator(css)`.
     * @example
     * await steps.on('panel', 'Page').findBySelector("input[name='email']").fill('a@b.com');
     */
    findBySelector(css: string): ElementAction {
        return this.spawnScoped(`findBySelector(${css})`, parent => parent.locator(css));
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
            subject: `${this._pageName}.${this._elementName}`,
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
                subject: `${this._pageName}.${this._elementName}`,
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

    /** Upload one or more files to a file input. Pass a string array for multi-file inputs. */
    async uploadFile(filePath: string | string[]): Promise<void> {
        const element = await this.resolve();
        await this.interactions.interact.uploadFile(element, filePath, { timeout: this._timeout });
    }

    /** Simulate dropping files onto a drop-zone element via DataTransfer drag events. */
    async dropFiles(filenames: string[], mimeType?: string): Promise<void> {
        const element = await this.resolve();
        await this.interactions.interact.dropFiles(element, filenames, { mimeType, timeout: this._timeout });
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
     * `expect(locator).toBeHidden()` on the first VISIBLE match of the entry's
     * full match set (so it holds for every match, never a strict-mode
     * violation on a multi-match entry), resolved through `repo.get(...)` with a
     * short attach slice per `fallback` chain node — the full selector
     * (role+name, regex text, frame scope) is honoured, and the 15s
     * repo-resolution wait is never paid waiting for an element to become
     * attached, which is the opposite of what we want when asserting absence.
     *
     * Never asserts on `repo.getSelector(...)`: for a role+name entry that
     * selector matches every element of the role (a false failure while any
     * sibling is shown), for a regex-text entry it matches nothing, and for a
     * frame-scoped page it looks in the wrong document (both a silent pass).
     *
     * A `fallback` entry is asserted on the variant the repository resolves —
     * the first chain node that exists — so a primary that exists but is
     * hidden is absent even when the fallback is visible, and a primary that
     * takes longer than the attach slice to attach is treated as missing. The
     * slice is derived from this chain's effective timeout
     * ({@link absenceAttachSlice}), so `.timeout(ms)` and the `StepOptions`
     * timeout buy a slow-hydrating primary more room instead of being ignored
     * in favour of a hard-coded constant. A resolved node that matches several
     * elements throws (see body).
     *
     * Scoped `findBy*` chains assert on the child locator itself (the stamped
     * scoped name has no repository entry). Resolving the PARENT still waits
     * for it: asserting "child absent" requires the parent to exist.
     */
    async verifyAbsence(): Promise<void> {
        if (this.scopedChild) {
            await this.interactions.verify.absence(
                new WebElement(this.narrowScoped(await this.scopedChild())),
                { timeout: this._timeout },
            );
            return;
        }
        const slice = this.absenceAttachSlice();
        let element!: WebElement;
        let divergence: Error | undefined;
        for (let attempt = 1; attempt <= ABSENCE_RESOLVE_ATTEMPTS; attempt++) {
            const lastAttempt = attempt === ABSENCE_RESOLVE_ATTEMPTS;
            divergence = undefined;
            // A `fallback` entry is asserted on the variant the repository
            // resolves: the first chain node that exists, exactly as an action
            // would target. The default (first-match) resolution walks the
            // chain correctly. The ALL resolution does not when a node matches
            // several elements: the repository's attach wait on that match set
            // is strict, throws, and walks on to the next node — which, for an
            // absent fallback, would be a false PASS. So resolve both and
            // refuse to assert when they diverge.
            //
            // The two resolutions run CONCURRENTLY, and a divergence is
            // confirmed by a second round before it is blamed on a multi-match
            // selector. Run back to back they were two walks over two different
            // moments in the page's life, so a perfectly ordinary single-match
            // primary that attached between them made the walks land on
            // different nodes — and the mismatch was reported to the user as
            // "a fallback entry whose resolved selector matches several
            // elements", a diagnosis with nothing to do with the real cause.
            const [resolved, all] = (await Promise.all([
                this.repo.get(this.elementName, this.pageName, { timeout: slice }),
                this.repo.get(this.elementName, this.pageName, { strategy: SelectionStrategy.ALL, timeout: slice }),
            ])) as [WebElement, WebElement];
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
                `verifyAbsence: "${this.elementName}" on "${this.pageName}" is a fallback entry whose resolved selector matches several elements; ` +
                `the repository cannot resolve that node's full match set, so absence cannot be asserted reliably. ` +
                `Make the selector match a single element.`,
            );
        }
        if (divergence) throw divergence;
        // `toBeHidden()` is strict: on the ALL match set it throws "resolved to
        // N elements" as soon as two nodes match, even when every one is hidden.
        // Assert on the first VISIBLE match instead — hidden (passes) when every
        // match is hidden or none exists, visible (fails) when any match shows.
        await this.interactions.verify.absence(
            new WebElement(element.locator.filter({ visible: true }).first()),
            { timeout: this._timeout },
        );
    }

    /**
     * Attach slice, per `fallback` chain node, that {@link verifyAbsence} gives
     * the repository.
     *
     * Derived from this chain's effective timeout — the `Steps` instance
     * timeout, overridden by `.timeout(ms)` or the `StepOptions` timeout —
     * rather than being a fixed constant, so a project that raised its element
     * timeout because its pages hydrate slowly also buys its slow primaries
     * more time to attach before the walk steps over them. An eighth of the
     * budget leaves the bulk of it to `toBeHidden`, which is the part that
     * actually decides the assertion.
     *
     * Clamped at both ends: below {@link ABSENCE_ATTACH_SLICE_FLOOR_MS} the
     * walk starts stepping over nodes that are already in the DOM, and above
     * {@link ABSENCE_ATTACH_SLICE_CAP_MS} a genuinely absent chain spends
     * longer proving it than any absence assertion is worth.
     */
    private absenceAttachSlice(): number {
        return Math.max(
            ABSENCE_ATTACH_SLICE_FLOOR_MS,
            Math.min(ABSENCE_ATTACH_SLICE_CAP_MS, Math.floor(this._timeout / 8)),
        );
    }

    /**
     * Assert the element's text content. Call with no argument to assert "not empty".
     *
     * @param expected - Expected exact text. Omit to assert the element has any non-empty text.
     * @param options - Optional verification options. Passing `{ notEmpty: true }`
     *   is redundant — omit `expected` to get the same behavior. The `notEmpty`
     *   flag on `TextVerifyOptions` is itself deprecated.
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
    async verifyImages(scroll: boolean = true, options?: { verifyDecoded?: boolean }): Promise<void> {
        const element = await this.resolveAll();
        await this.interactions.verify.images(element, scroll, options);
    }

    /** Assert element state. */
    async verifyState(state: 'enabled' | 'disabled' | 'editable' | 'checked' | 'focused' | 'visible' | 'hidden' | 'attached' | 'inViewport'): Promise<void> {
        const element = await this.resolve();
        await this.interactions.verify.state(element, state);
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
        const element = await this.resolveAll();
        await this.interactions.verify.order(element, expectedTexts);
    }

    /**
     * Assert all matched elements are sorted in the given direction.
     *
     * Collection-level — resolves with `SelectionStrategy.ALL` regardless of any
     * strategy selector on the chain.
     */
    async verifyListOrder(direction: 'asc' | 'desc'): Promise<void> {
        const element = await this.resolveAll();
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

    /**
     * Get the raw HTML of the resolved element. Defaults to `innerHTML`;
     * pass `{ outer: true }` to get `outerHTML` (the element tag + subtree).
     */
    async getHtml(options?: { outer?: boolean }): Promise<string> {
        const element = await this.resolve();
        return await this.interactions.extract.getHtml(element, options);
    }

    /** Assert the element's HTML equals the expected string exactly. Delegates to the matcher tree's `.html.toBe(...)` (or `.outerHtml.toBe(...)` when `outer`). */
    async verifyHtml(expected: string, options?: { outer?: boolean }): Promise<void> {
        await (options?.outer ? this.expectBuilder().outerHtml : this.expectBuilder().html).toBe(expected);
    }

    /** Assert the element's HTML contains a substring. Delegates to the matcher tree's `.html.toContain(...)`. */
    async verifyHtmlContains(substring: string, options?: { outer?: boolean }): Promise<void> {
        await (options?.outer ? this.expectBuilder().outerHtml : this.expectBuilder().html).toContain(substring);
    }

    /** Assert the element's HTML matches a regex. Delegates to the matcher tree's `.html.toMatch(...)`. */
    async verifyHtmlMatches(regex: RegExp, options?: { outer?: boolean }): Promise<void> {
        await (options?.outer ? this.expectBuilder().outerHtml : this.expectBuilder().html).toMatch(regex);
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
        const allElement = await this.resolveAll();
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
            resolveAll: () => this.resolveAll(),
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
    /**
     * Dual-purpose: the matcher-tree boolean field AND the visible-selection
     * strategy. As property access (`.visible.toBeTrue()`) it is the
     * `BooleanMatcher`. Called (`.visible().click()`) it switches the chain into
     * visible-selection mode (see {@link selectVisible}) and returns `this` so
     * terminal actions/verifications compose like `.first()`.
     */
    get visible(): VisibleField {
        const matcher = this.expectBuilder().visible;
        const select = (): ElementAction => this.selectVisible();
        // Merge the matcher's FULL surface onto the callable so both the
        // assertion form and the strategy-call form resolve. `timeout` and `not`
        // return the underlying matcher (not the callable), so chaining past them
        // (`.visible.timeout(100).toBeTrue()`, `.visible.not.toBe(false)`) lands
        // on a real `BooleanMatcher` — matching what the `VisibleField` type
        // promises. `not` stays a lazy getter so it never freezes a pre-timeout
        // matcher instance.
        return Object.assign(select, {
            toBe: matcher.toBe.bind(matcher),
            toBeTrue: matcher.toBeTrue.bind(matcher),
            toBeFalse: matcher.toBeFalse.bind(matcher),
            timeout: (ms: number) => matcher.timeout(ms),
            get not() { return matcher.not; },
        }) as VisibleField;
    }
    get enabled() { return this.expectBuilder().enabled; }
    get attributes() { return this.expectBuilder().attributes; }
    get html() { return this.expectBuilder().html; }
    get outerHtml() { return this.expectBuilder().outerHtml; }
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
