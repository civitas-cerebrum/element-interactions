import { Locator } from '@playwright/test';
import { Element, WebElement } from '@civitas-cerebrum/element-repository';
import { Verifications } from '../interactions/Verification';

/**
 * Snapshot of an element's state at a single point in time.
 *
 * Passed to predicates in `steps.expect(el, page).satisfy(predicate)` and
 * `steps.on(el, page).satisfy(predicate)`. All fields are primitives or plain
 * data — no async methods, no Playwright types.
 */
export interface ElementSnapshot {
    readonly text: string;
    readonly value: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly visible: boolean;
    readonly enabled: boolean;
    readonly count: number;
}

/**
 * Surface the matcher tree needs from its host (typically an `ElementAction`).
 * Decouples matchers from `ElementAction` so the builder can be constructed
 * from either the fluent entry or the top-level `Steps.expect()` call.
 */
export interface ExpectContext {
    readonly elementName: string;
    readonly pageName: string;
    readonly timeout: number;
    readonly conditionalVisible: boolean;
    readonly visibilityTimeout: number;
    /** Resolves the element with the current strategy (may be `.first()`-narrowed). */
    resolveElement(): Promise<WebElement>;
    /** Resolves the element with the ALL strategy — no narrowing, used by count matchers. */
    resolveAll(): Promise<WebElement>;
    captureSnapshot(): Promise<ElementSnapshot>;
    /** The shared Verifications facade — the single implementation source for all matcher assertions. */
    readonly verify: Verifications;
}

/** One assertion queued on an `ExpectBuilder`. Executes when the builder is awaited. */
interface QueuedAssertion {
    /** Ctx captured when enqueued; mutable so `.timeout()` / `.throws()` can retroactively update it. */
    ctx: ExpectContext;
    /** Runs the assertion; may throw on failure. Replaced with a concrete executor at enqueue time. */
    run(): Promise<void>;
    /** Optional custom message that replaces the default failure header. */
    messageOverride?: string;
}

// ─── Helpers — only retained for the ifVisible gate + predicate path ─

async function honorIfVisibleGate(ctx: ExpectContext): Promise<boolean> {
    if (!ctx.conditionalVisible) return true;
    try {
        const element = await ctx.resolveElement();
        await element.waitFor({ state: 'visible', timeout: ctx.visibilityTimeout });
        return true;
    } catch {
        return false;
    }
}

/** Wraps a delegation into `Verifications` with the ifVisible gate and optional custom error header. */
async function runViaVerify(
    ctx: ExpectContext,
    action: () => Promise<void>,
    messageOverride?: string,
): Promise<void> {
    if (!(await honorIfVisibleGate(ctx))) return;
    try {
        await action();
    } catch (err) {
        if (!messageOverride) throw err;
        const original = err instanceof Error ? err.message : String(err);
        throw new Error(`${messageOverride}\n  ${original}`);
    }
}

/** Runs a matcher body that needs a resolved element. Applies the ifVisible gate first so resolve errors on absent elements are silently skipped when conditional. */
async function runWithElement(
    ctx: ExpectContext,
    body: (el: WebElement) => Promise<void>,
    messageOverride: string | undefined,
    resolve: (ctx: ExpectContext) => Promise<WebElement> = c => c.resolveElement(),
): Promise<void> {
    await runViaVerify(ctx, async () => {
        const el = await resolve(ctx);
        await body(el);
    }, messageOverride);
}

/** Predicate-specific failure path — runs a snapshot loop, prints the captured snapshot on failure. */
async function assertPredicate(
    ctx: ExpectContext,
    negated: boolean,
    predicate: (el: ElementSnapshot) => boolean,
    messageOverride?: string,
): Promise<void> {
    if (!(await honorIfVisibleGate(ctx))) return;

    const deadline = Date.now() + ctx.timeout;
    const pollMs = 100;
    let lastSnapshot: ElementSnapshot | null = null;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
        try {
            lastSnapshot = await ctx.captureSnapshot();
            if (predicate(lastSnapshot) !== negated) return;
        } catch (err) {
            lastError = err;
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    const header = messageOverride
        ?? `expect().satisfy(predicate) failed on ${ctx.pageName}.${ctx.elementName} after ${ctx.timeout}ms`;
    if (!lastSnapshot) {
        const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
        throw new Error(`${header}\n  element could not be resolved: ${reason}`);
    }
    const snapshotJson = JSON.stringify(lastSnapshot, null, 2).replace(/^/gm, '    ');
    throw new Error(`${header}\n  snapshot at timeout:\n${snapshotJson}`);
}

// ─── Matcher adapters ────────────────────────────────────────────────
//
// Every matcher method is a 2-line dispatch into `Verifications`. The
// Verifications class is the single source of truth for assertion
// implementation — retry mechanics, web-first assertion, error formatting,
// negation — all live there. The matcher tree is a presentation-layer
// wrapper that composes `Verifications` calls through a chainable builder.

abstract class BaseMatcher {
    constructor(
        protected builder: ExpectBuilder,
        protected ctx: ExpectContext,
        protected negated: boolean,
    ) {}

    /**
     * Override the chain-level timeout. Mutates the matcher AND propagates to
     * the parent builder so subsequent matchers on the same chain see the new
     * value. Does NOT retroactively patch already-queued assertions — use
     * `builder.timeout()` (e.g. `.satisfy(pred).timeout(ms)`) for that.
     */
    timeout(ms: number): this {
        this.ctx = { ...this.ctx, timeout: ms };
        this.builder._setCtxTimeout(ms);
        return this;
    }

    /** Shortcut: build the options object that Verifications methods accept. */
    protected opts() {
        return { negated: this.negated, timeout: this.ctx.timeout };
    }

    /**
     * Build the standard failure message + VerifyOptions for a given verb + expected value.
     * Accepts the execution-time ctx so trailing `.timeout()` updates flow through.
     */
    protected msgOpts(ctx: ExpectContext, field: string, verb: string, expected: unknown) {
        const neg = this.negated ? 'not ' : '';
        const quote = (v: unknown) => (typeof v === 'string' ? `"${v}"` : String(v));
        return {
            negated: this.negated,
            timeout: ctx.timeout,
            errorMessage: `expected ${ctx.pageName}.${ctx.elementName} ${field} ${neg}${verb} ${quote(expected)}`,
        };
    }
}

// ─── Field matchers — each method is a one-line delegate ─────────────

abstract class StringMatcher extends BaseMatcher {
    protected abstract fieldLabel(): string;
    /** Subclasses identify which Verifications family handles their field. */
    protected abstract verifyEq(target: WebElement, expected: string, opts: VerifyOpts): Promise<void>;
    protected abstract verifyContains(target: WebElement, expected: string, opts: VerifyOpts): Promise<void>;
    protected abstract verifyMatches(target: WebElement, re: RegExp, opts: VerifyOpts): Promise<void>;
    protected abstract verifyStartsWith(target: WebElement, prefix: string, opts: VerifyOpts): Promise<void>;
    protected abstract verifyEndsWith(target: WebElement, suffix: string, opts: VerifyOpts): Promise<void>;

    toBe(expected: string): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => this.verifyEq(el, expected, this.msgOpts(entry.ctx, this.fieldLabel(), 'to be', expected)), entry.messageOverride));
    }

    toContain(expected: string): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => this.verifyContains(el, expected, this.msgOpts(entry.ctx, this.fieldLabel(), 'to contain', expected)), entry.messageOverride));
    }

    toMatch(re: RegExp): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => this.verifyMatches(el, re, this.msgOpts(entry.ctx, this.fieldLabel(), 'to match', re)), entry.messageOverride));
    }

    toStartWith(prefix: string): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => this.verifyStartsWith(el, prefix, this.msgOpts(entry.ctx, this.fieldLabel(), 'to start with', prefix)), entry.messageOverride));
    }

    toEndWith(suffix: string): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => this.verifyEndsWith(el, suffix, this.msgOpts(entry.ctx, this.fieldLabel(), 'to end with', suffix)), entry.messageOverride));
    }
}

/** Short alias for the opts shape Verifications methods accept. */
type VerifyOpts = { negated?: boolean; timeout?: number; errorMessage?: string };

/** Asserts on the visible text content of the resolved element. Reached via `.text` on `ExpectBuilder` or `ElementAction`. Supports `.toBe`, `.toContain`, `.toMatch`, `.toStartWith`, `.toEndWith`. */
export class TextMatcher extends StringMatcher {
    get not(): TextMatcher { return new TextMatcher(this.builder, this.ctx, !this.negated); }
    protected fieldLabel() { return 'text'; }
    protected verifyEq(t: WebElement, v: string, o: VerifyOpts) { return this.ctx.verify.text(t, v, o); }
    protected verifyContains(t: WebElement, v: string, o: VerifyOpts) { return this.ctx.verify.textContains(t, v, o); }
    protected verifyMatches(t: WebElement, re: RegExp, o: VerifyOpts) { return this.ctx.verify.textMatches(t, re, o); }
    protected verifyStartsWith(t: WebElement, p: string, o: VerifyOpts) { return this.ctx.verify.textStartsWith(t, p, o); }
    protected verifyEndsWith(t: WebElement, s: string, o: VerifyOpts) { return this.ctx.verify.textEndsWith(t, s, o); }
}

/** Asserts on the `value` of an input-like element. Reached via `.value`. Supports `.toBe`, `.toContain`, `.toMatch`, `.toStartWith`, `.toEndWith`. */
export class ValueMatcher extends StringMatcher {
    get not(): ValueMatcher { return new ValueMatcher(this.builder, this.ctx, !this.negated); }
    protected fieldLabel() { return 'value'; }
    protected verifyEq(t: WebElement, v: string, o: VerifyOpts) { return this.ctx.verify.inputValue(t, v, o); }
    protected verifyContains(t: WebElement, v: string, o: VerifyOpts) { return this.ctx.verify.inputValueContains(t, v, o); }
    protected verifyMatches(t: WebElement, re: RegExp, o: VerifyOpts) { return this.ctx.verify.inputValueMatches(t, re, o); }
    protected verifyStartsWith(t: WebElement, p: string, o: VerifyOpts) { return this.ctx.verify.inputValueStartsWith(t, p, o); }
    protected verifyEndsWith(t: WebElement, s: string, o: VerifyOpts) { return this.ctx.verify.inputValueEndsWith(t, s, o); }
}

/** Asserts on a specific HTML attribute. Reached via `.attributes.get(name)`. Supports `.toBe`, `.toContain`, `.toMatch`, `.toStartWith`, `.toEndWith`. */
export class AttributeMatcher extends StringMatcher {
    constructor(builder: ExpectBuilder, ctx: ExpectContext, private attrName: string, negated: boolean) {
        super(builder, ctx, negated);
    }
    get not(): AttributeMatcher { return new AttributeMatcher(this.builder, this.ctx, this.attrName, !this.negated); }
    protected fieldLabel() { return `attribute "${this.attrName}"`; }
    protected verifyEq(t: WebElement, v: string, o: VerifyOpts) { return this.ctx.verify.attribute(t, this.attrName, v, o); }
    protected verifyContains(t: WebElement, v: string, o: VerifyOpts) { return this.ctx.verify.attributeContains(t, this.attrName, v, o); }
    protected verifyMatches(t: WebElement, re: RegExp, o: VerifyOpts) { return this.ctx.verify.attributeMatches(t, this.attrName, re, o); }
    protected verifyStartsWith(t: WebElement, p: string, o: VerifyOpts) {
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return this.ctx.verify.attributeMatches(t, this.attrName, new RegExp('^' + escaped), o);
    }
    protected verifyEndsWith(t: WebElement, s: string, o: VerifyOpts) {
        const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return this.ctx.verify.attributeMatches(t, this.attrName, new RegExp(escaped + '$'), o);
    }
}

/** Asserts on how many elements match the locator. Reached via `.count`. Always uses the un-narrowed element, so `.first().count.toBe(5)` still counts all matches. Supports `.toBe`, `.toBeGreaterThan`, `.toBeLessThan`, and the `OrEqual` variants. */
export class CountMatcher extends BaseMatcher {
    get not(): CountMatcher { return new CountMatcher(this.builder, this.ctx, !this.negated); }

    private delegate(
        opts: { exactly?: number; greaterThan?: number; lessThan?: number; greaterThanOrEqual?: number; lessThanOrEqual?: number },
        verb: string,
        expected: number,
    ): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(
                entry.ctx,
                // Count always uses the un-narrowed element — otherwise `.first()`
                // narrowing reduces count to 1 regardless of how many elements match.
                el => entry.ctx.verify.count(el, opts as never, this.msgOpts(entry.ctx, 'count', verb, expected)),
                entry.messageOverride,
                c => c.resolveAll(),
            ));
    }

    toBe(expected: number): ExpectBuilder { return this.delegate({ exactly: expected }, 'to be', expected); }
    toBeGreaterThan(n: number): ExpectBuilder { return this.delegate({ greaterThan: n }, 'to be greater than', n); }
    toBeLessThan(n: number): ExpectBuilder { return this.delegate({ lessThan: n }, 'to be less than', n); }
    toBeGreaterThanOrEqual(n: number): ExpectBuilder { return this.delegate({ greaterThanOrEqual: n }, 'to be greater than or equal to', n); }
    toBeLessThanOrEqual(n: number): ExpectBuilder { return this.delegate({ lessThanOrEqual: n }, 'to be less than or equal to', n); }
}

type BooleanField = 'visible' | 'enabled';

/** Asserts on a boolean element state (`visible` or `enabled`). Reached via `.visible` / `.enabled`. Supports `.toBe(true|false)`, `.toBeTrue`, `.toBeFalse`. */
export class BooleanMatcher extends BaseMatcher {
    constructor(builder: ExpectBuilder, ctx: ExpectContext, private field: BooleanField, negated: boolean) {
        super(builder, ctx, negated);
    }
    get not(): BooleanMatcher { return new BooleanMatcher(this.builder, this.ctx, this.field, !this.negated); }

    toBe(expected: boolean): ExpectBuilder {
        // True for visible/enabled; false flips the Playwright state accordingly.
        const state = this.field === 'visible'
            ? (expected ? 'visible' : 'hidden')
            : (expected ? 'enabled' : 'disabled');
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => entry.ctx.verify.state(el, state, this.msgOpts(entry.ctx, this.field, 'to be', expected)), entry.messageOverride));
    }
    toBeTrue(): ExpectBuilder { return this.toBe(true); }
    toBeFalse(): ExpectBuilder { return this.toBe(false); }
}

/** Asserts on the element's attribute map. Reached via `.attributes`. Use `.get(name)` to drill into a specific attribute or `.toHaveKey(name)` to assert presence. */
export class AttributesMatcher extends BaseMatcher {
    get not(): AttributesMatcher { return new AttributesMatcher(this.builder, this.ctx, !this.negated); }

    /** Navigate into a specific attribute. Returns a StringMatcher scoped to that attribute. */
    get(name: string): AttributeMatcher {
        return new AttributeMatcher(this.builder, this.ctx, name, this.negated);
    }

    toHaveKey(name: string): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => entry.ctx.verify.hasAttribute(el, name, this.msgOpts(entry.ctx, 'attributes', 'to have key', name)), entry.messageOverride));
    }
}

/**
 * Asserts on the element's HTML — `innerHTML` by default, `outerHTML` when
 * constructed with `outer: true`. Reached via `.html` / `.outerHtml` on either
 * `ExpectBuilder` or `ElementAction`. Supports the full `StringMatcher` surface
 * (`toBe`, `toContain`, `toMatch`, `toStartWith`, `toEndWith`) plus `.not`.
 *
 * Useful for security probes (escape verification), template scaffolding
 * assertions, and any case where text content alone misses tag/attribute
 * structure.
 */
export class HtmlMatcher extends StringMatcher {
    constructor(builder: ExpectBuilder, ctx: ExpectContext, private outer: boolean, negated: boolean) {
        super(builder, ctx, negated);
    }
    get not(): HtmlMatcher { return new HtmlMatcher(this.builder, this.ctx, this.outer, !this.negated); }
    protected fieldLabel() { return this.outer ? 'outerHtml' : 'html'; }
    protected verifyEq(t: WebElement, v: string, o: VerifyOpts) { return this.ctx.verify.html(t, v, { ...o, outer: this.outer }); }
    protected verifyContains(t: WebElement, v: string, o: VerifyOpts) { return this.ctx.verify.htmlContains(t, v, { ...o, outer: this.outer }); }
    protected verifyMatches(t: WebElement, re: RegExp, o: VerifyOpts) { return this.ctx.verify.htmlMatches(t, re, { ...o, outer: this.outer }); }
    protected verifyStartsWith(t: WebElement, p: string, o: VerifyOpts) { return this.ctx.verify.htmlStartsWith(t, p, { ...o, outer: this.outer }); }
    protected verifyEndsWith(t: WebElement, s: string, o: VerifyOpts) { return this.ctx.verify.htmlEndsWith(t, s, { ...o, outer: this.outer }); }
}

/** Asserts on a computed CSS property value. Reached via `.css(propertyName)`. Supports `.toBe`, `.toContain`, `.toMatch`. */
export class CssMatcher extends BaseMatcher {
    constructor(builder: ExpectBuilder, ctx: ExpectContext, private property: string, negated: boolean) {
        super(builder, ctx, negated);
    }
    get not(): CssMatcher { return new CssMatcher(this.builder, this.ctx, this.property, !this.negated); }

    private label() { return `css "${this.property}"`; }
    toBe(expected: string): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => entry.ctx.verify.cssProperty(el, this.property, expected, this.msgOpts(entry.ctx, this.label(), 'to be', expected)), entry.messageOverride));
    }
    toContain(expected: string): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => entry.ctx.verify.cssPropertyContains(el, this.property, expected, this.msgOpts(entry.ctx, this.label(), 'to contain', expected)), entry.messageOverride));
    }
    toMatch(re: RegExp): ExpectBuilder {
        return this.builder.enqueue(this.ctx, (entry) =>
            runWithElement(entry.ctx, el => entry.ctx.verify.cssPropertyMatches(el, this.property, re, this.msgOpts(entry.ctx, this.label(), 'to match', re)), entry.messageOverride));
    }
}

// ─── The builder ─────────────────────────────────────────────────────

/**
 * Root of the matcher tree and the queue-backed chain builder.
 *
 * Every matcher call enqueues an assertion and returns the builder so chains
 * of multiple verifications are expressed in one await-able expression:
 *
 * ```ts
 * await steps.on('submitBtn', 'CheckoutPage')
 *   .text.toBe('Place Order')
 *   .enabled.toBeTrue()
 *   .attributes.get('data-variant').toBe('primary')
 *   .visible.toBeTrue();
 * ```
 *
 * Under the hood each matcher call delegates to `Verifications` — the single
 * source of truth for assertion implementation (retry mechanics, web-first
 * behavior, error formatting, negation). The matcher tree is presentation
 * only. The predicate escape hatch (`satisfy(predicate)`) is the exception — it
 * uses a snapshot-based poll so user lambdas can access plain data.
 */
export class ExpectBuilder implements PromiseLike<void> {
    private ctx: ExpectContext;
    private queue: QueuedAssertion[] = [];
    private pendingNot: boolean;

    constructor(ctx: ExpectContext, initialNegated: boolean = false) {
        this.ctx = ctx;
        this.pendingNot = initialNegated;
    }

    get not(): this {
        this.pendingNot = !this.pendingNot;
        return this;
    }

    /**
     * Override the chain-level timeout. Mutates the builder AND retroactively
     * patches the most-recently queued assertion, so
     * `.satisfy(pred).timeout(500)` applies 500ms to that predicate even though
     * `.timeout()` was called after it. Subsequent matchers also pick up the
     * new value.
     */
    timeout(ms: number): this {
        this._setCtxTimeout(ms);
        const last = this.queue[this.queue.length - 1];
        if (last) last.ctx = { ...last.ctx, timeout: ms };
        return this;
    }

    /**
     * Internal: replace the chain-level timeout for subsequent matchers without
     * touching queued entries. Called by matcher-level `.timeout()` so
     * `.count.timeout(500)` doesn't retroactively rewrite a prior matcher's
     * queued entry.
     */
    _setCtxTimeout(ms: number): void {
        this.ctx = { ...this.ctx, timeout: ms };
    }

    get text(): TextMatcher { return new TextMatcher(this, this.ctx, this.consumeNot()); }
    get value(): ValueMatcher { return new ValueMatcher(this, this.ctx, this.consumeNot()); }
    get count(): CountMatcher { return new CountMatcher(this, this.ctx, this.consumeNot()); }
    get visible(): BooleanMatcher { return new BooleanMatcher(this, this.ctx, 'visible', this.consumeNot()); }
    get enabled(): BooleanMatcher { return new BooleanMatcher(this, this.ctx, 'enabled', this.consumeNot()); }
    get attributes(): AttributesMatcher { return new AttributesMatcher(this, this.ctx, this.consumeNot()); }
    get html(): HtmlMatcher { return new HtmlMatcher(this, this.ctx, false, this.consumeNot()); }
    get outerHtml(): HtmlMatcher { return new HtmlMatcher(this, this.ctx, true, this.consumeNot()); }
    css(property: string): CssMatcher { return new CssMatcher(this, this.ctx, property, this.consumeNot()); }

    /**
     * Predicate escape hatch. Queues a custom predicate assertion on this
     * builder. Chain further matchers or finish with `.throws(message)` to
     * override the failure message.
     *
     * Named `satisfy` (not `toBe`) to avoid overloading the matcher-tree
     * equality verb — `.text.toBe('x')` asserts equality on a field, while
     * `.satisfy(predicate)` asserts a user-supplied boolean expression.
     */
    satisfy(predicate: (el: ElementSnapshot) => boolean): this {
        const negated = this.consumeNot();
        this.enqueue(this.ctx, (entry) =>
            assertPredicate(entry.ctx, negated, predicate, entry.messageOverride),
        );
        return this;
    }

    /** Replace the failure message of the most recently queued assertion. */
    throws(message: string): this {
        const last = this.queue[this.queue.length - 1];
        if (last) last.messageOverride = message;
        return this;
    }

    /**
     * Enqueue an assertion. Matchers call this with the context they captured
     * at matcher-creation time and a runner that reads `entry.ctx` and
     * `entry.messageOverride` at run time so later modifications by
     * `.timeout()` / `.throws()` flow through.
     */
    enqueue(ctx: ExpectContext, run: (entry: QueuedAssertion) => Promise<void>): this {
        const entry: QueuedAssertion = { ctx, run: async () => {} };
        entry.run = () => run(entry);
        this.queue.push(entry);
        return this;
    }

    then<TResult1 = void, TResult2 = never>(
        onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null | undefined,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
    ): PromiseLike<TResult1 | TResult2> {
        return this.flush().then(onfulfilled, onrejected);
    }

    private consumeNot(): boolean {
        const n = this.pendingNot;
        this.pendingNot = false;
        return n;
    }

    private async flush(): Promise<void> {
        while (this.queue.length > 0) {
            const assertion = this.queue.shift()!;
            await assertion.run();
        }
    }
}
