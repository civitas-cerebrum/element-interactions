import { Element } from '@civitas-cerebrum/element-repository';

/**
 * Snapshot of an element's state at a single point in time.
 *
 * Passed to predicates in `steps.on(el, page).toBe(predicate)` and
 * `steps.expect(el, page).toBe(predicate)`. All fields are primitives or
 * plain data — no async methods, no Playwright types.
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
    resolveElement(): Promise<Element>;
    captureSnapshot(): Promise<ElementSnapshot>;
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

// ─── Shared helpers ──────────────────────────────────────────────────

const POLL_MS = 100;

function describeFailure(
    ctx: ExpectContext,
    field: string,
    verb: string,
    expected: unknown,
    actual: unknown,
    negated: boolean,
): string {
    const quote = (v: unknown) => (typeof v === 'string' ? `"${v}"` : String(v));
    const neg = negated ? 'not ' : '';
    return `expected ${ctx.pageName}.${ctx.elementName} ${field} ${neg}${verb} ${quote(expected)}, got ${quote(actual)}`;
}

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

/** Retry-and-assert against a captured snapshot. Honors `ifVisible` gate. */
async function assertWithSnapshot(
    ctx: ExpectContext,
    negated: boolean,
    predicate: (snap: ElementSnapshot) => boolean,
    describe: (snap: ElementSnapshot, negated: boolean) => string,
    messageOverride?: string,
): Promise<void> {
    if (!(await honorIfVisibleGate(ctx))) return;

    const deadline = Date.now() + ctx.timeout;
    let lastSnapshot: ElementSnapshot | null = null;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
        try {
            lastSnapshot = await ctx.captureSnapshot();
            if (predicate(lastSnapshot) !== negated) return;
        } catch (err) {
            lastError = err;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }

    if (!lastSnapshot) {
        const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
        throw new Error(
            `expect() failed on ${ctx.pageName}.${ctx.elementName}: could not resolve element within ${ctx.timeout}ms — ${reason}`,
        );
    }
    throw new Error(messageOverride ?? describe(lastSnapshot, negated));
}

/** Retry-and-assert against a live-read boolean evaluation. Honors `ifVisible` gate. */
async function assertWithLiveRead(
    ctx: ExpectContext,
    negated: boolean,
    evaluate: () => Promise<boolean>,
    describe: (negated: boolean) => string,
    messageOverride?: string,
): Promise<void> {
    if (!(await honorIfVisibleGate(ctx))) return;

    const deadline = Date.now() + ctx.timeout;

    while (Date.now() < deadline) {
        try {
            if ((await evaluate()) !== negated) return;
        } catch {
            // swallow and retry
        }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }

    throw new Error(messageOverride ?? describe(negated));
}

/** Predicate-specific failure path — prints the captured snapshot for debugging. */
async function assertPredicate(
    ctx: ExpectContext,
    negated: boolean,
    predicate: (el: ElementSnapshot) => boolean,
    messageOverride?: string,
): Promise<void> {
    if (!(await honorIfVisibleGate(ctx))) return;

    const deadline = Date.now() + ctx.timeout;
    let lastSnapshot: ElementSnapshot | null = null;
    let lastError: unknown = null;

    while (Date.now() < deadline) {
        try {
            lastSnapshot = await ctx.captureSnapshot();
            if (predicate(lastSnapshot) !== negated) return;
        } catch (err) {
            lastError = err;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }

    const header = messageOverride
        ?? `expect().toBe(predicate) failed on ${ctx.pageName}.${ctx.elementName} after ${ctx.timeout}ms`;
    if (!lastSnapshot) {
        const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
        throw new Error(`${header}\n  element could not be resolved: ${reason}`);
    }
    const snapshotJson = JSON.stringify(lastSnapshot, null, 2).replace(/^/gm, '    ');
    throw new Error(`${header}\n  snapshot at timeout:\n${snapshotJson}`);
}

// ─── Matcher base class ──────────────────────────────────────────────

/**
 * Shared shape for all field matchers. Concrete subclasses provide:
 *   - `withCtx(ctx)`  → clone with replaced context (used by `timeout(ms)`)
 *   - `withNegated(n)` → clone with flipped negation (used by `get not()`)
 *
 * `timeout(ms)` and `get not()` then live on this base, not duplicated across
 * every concrete matcher.
 */
abstract class BaseMatcher {
    constructor(
        protected builder: ExpectBuilder,
        protected ctx: ExpectContext,
        protected negated: boolean,
    ) {}

    protected abstract withCtx(ctx: ExpectContext): this;
    protected abstract withNegated(negated: boolean): this;

    /** Override the retry timeout for this matcher only. */
    timeout(ms: number): this {
        return this.withCtx({ ...this.ctx, timeout: ms });
    }

    /** Flip the expected outcome of this matcher. */
    get not(): this {
        return this.withNegated(!this.negated);
    }
}

/** Shared string-matcher surface: text / value / attribute / (css uses its own live-read). */
abstract class StringMatcher extends BaseMatcher {
    protected abstract fieldLabel(): string;
    protected abstract read(snap: ElementSnapshot): string;

    toBe(expected: string): ExpectBuilder {
        return this.enqueue(
            s => this.read(s) === expected,
            (s, n) => describeFailure(this.ctx, this.fieldLabel(), 'to be', expected, this.read(s), n),
        );
    }
    toContain(expected: string): ExpectBuilder {
        return this.enqueue(
            s => this.read(s).includes(expected),
            (s, n) => describeFailure(this.ctx, this.fieldLabel(), 'to contain', expected, this.read(s), n),
        );
    }
    toMatch(re: RegExp): ExpectBuilder {
        return this.enqueue(
            s => re.test(this.read(s)),
            (s, n) => describeFailure(this.ctx, this.fieldLabel(), 'to match', re, this.read(s), n),
        );
    }
    toStartWith(prefix: string): ExpectBuilder {
        return this.enqueue(
            s => this.read(s).startsWith(prefix),
            (s, n) => describeFailure(this.ctx, this.fieldLabel(), 'to start with', prefix, this.read(s), n),
        );
    }
    toEndWith(suffix: string): ExpectBuilder {
        return this.enqueue(
            s => this.read(s).endsWith(suffix),
            (s, n) => describeFailure(this.ctx, this.fieldLabel(), 'to end with', suffix, this.read(s), n),
        );
    }

    private enqueue(
        predicate: (snap: ElementSnapshot) => boolean,
        describe: (snap: ElementSnapshot, negated: boolean) => string,
    ): ExpectBuilder {
        const negated = this.negated;
        return this.builder.enqueue(this.ctx, (entry) =>
            assertWithSnapshot(entry.ctx, negated, predicate, describe, entry.messageOverride),
        );
    }
}

// ─── Concrete field matchers ─────────────────────────────────────────

export class TextMatcher extends StringMatcher {
    protected withCtx(ctx: ExpectContext): this { return new TextMatcher(this.builder, ctx, this.negated) as this; }
    protected withNegated(negated: boolean): this { return new TextMatcher(this.builder, this.ctx, negated) as this; }
    protected fieldLabel(): string { return 'text'; }
    protected read(snap: ElementSnapshot): string { return snap.text; }
}

export class ValueMatcher extends StringMatcher {
    protected withCtx(ctx: ExpectContext): this { return new ValueMatcher(this.builder, ctx, this.negated) as this; }
    protected withNegated(negated: boolean): this { return new ValueMatcher(this.builder, this.ctx, negated) as this; }
    protected fieldLabel(): string { return 'value'; }
    protected read(snap: ElementSnapshot): string { return snap.value; }
}

export class AttributeMatcher extends StringMatcher {
    constructor(builder: ExpectBuilder, ctx: ExpectContext, private attrName: string, negated: boolean) {
        super(builder, ctx, negated);
    }
    protected withCtx(ctx: ExpectContext): this { return new AttributeMatcher(this.builder, ctx, this.attrName, this.negated) as this; }
    protected withNegated(negated: boolean): this { return new AttributeMatcher(this.builder, this.ctx, this.attrName, negated) as this; }
    protected fieldLabel(): string { return `attribute "${this.attrName}"`; }
    protected read(snap: ElementSnapshot): string { return snap.attributes[this.attrName] ?? ''; }
}

export class CountMatcher extends BaseMatcher {
    protected withCtx(ctx: ExpectContext): this { return new CountMatcher(this.builder, ctx, this.negated) as this; }
    protected withNegated(negated: boolean): this { return new CountMatcher(this.builder, this.ctx, negated) as this; }

    toBe(expected: number): ExpectBuilder {
        return this.enqueue(s => s.count === expected, 'to be', expected);
    }
    toBeGreaterThan(n: number): ExpectBuilder {
        return this.enqueue(s => s.count > n, 'to be greater than', n);
    }
    toBeLessThan(n: number): ExpectBuilder {
        return this.enqueue(s => s.count < n, 'to be less than', n);
    }
    toBeGreaterThanOrEqual(n: number): ExpectBuilder {
        return this.enqueue(s => s.count >= n, 'to be greater than or equal to', n);
    }
    toBeLessThanOrEqual(n: number): ExpectBuilder {
        return this.enqueue(s => s.count <= n, 'to be less than or equal to', n);
    }

    private enqueue(predicate: (s: ElementSnapshot) => boolean, verb: string, expected: number): ExpectBuilder {
        const negated = this.negated;
        return this.builder.enqueue(this.ctx, (entry) =>
            assertWithSnapshot(
                entry.ctx, negated, predicate,
                (s, n) => describeFailure(entry.ctx, 'count', verb, expected, s.count, n),
                entry.messageOverride,
            ));
    }
}

type BooleanField = 'visible' | 'enabled';

export class BooleanMatcher extends BaseMatcher {
    constructor(builder: ExpectBuilder, ctx: ExpectContext, private field: BooleanField, negated: boolean) {
        super(builder, ctx, negated);
    }
    protected withCtx(ctx: ExpectContext): this { return new BooleanMatcher(this.builder, ctx, this.field, this.negated) as this; }
    protected withNegated(negated: boolean): this { return new BooleanMatcher(this.builder, this.ctx, this.field, negated) as this; }

    toBe(expected: boolean): ExpectBuilder {
        const negated = this.negated;
        const field = this.field;
        return this.builder.enqueue(this.ctx, (entry) =>
            assertWithSnapshot(
                entry.ctx, negated,
                s => s[field] === expected,
                (s, n) => describeFailure(entry.ctx, field, 'to be', expected, s[field], n),
                entry.messageOverride,
            ));
    }
    toBeTrue(): ExpectBuilder { return this.toBe(true); }
    toBeFalse(): ExpectBuilder { return this.toBe(false); }
}

export class AttributesMatcher extends BaseMatcher {
    protected withCtx(ctx: ExpectContext): this { return new AttributesMatcher(this.builder, ctx, this.negated) as this; }
    protected withNegated(negated: boolean): this { return new AttributesMatcher(this.builder, this.ctx, negated) as this; }

    /** Navigate into a specific attribute. The resulting matcher supports the full string-matcher surface. */
    get(name: string): AttributeMatcher {
        return new AttributeMatcher(this.builder, this.ctx, name, this.negated);
    }

    toHaveKey(name: string): ExpectBuilder {
        const negated = this.negated;
        return this.builder.enqueue(this.ctx, (entry) =>
            assertWithSnapshot(
                entry.ctx, negated,
                s => name in s.attributes,
                (s, n) =>
                    `expected ${entry.ctx.pageName}.${entry.ctx.elementName} attributes ${n ? 'not ' : ''}to have key "${name}", present keys: [${Object.keys(s.attributes).join(', ')}]`,
                entry.messageOverride,
            ));
    }
}

export class CssMatcher extends BaseMatcher {
    constructor(builder: ExpectBuilder, ctx: ExpectContext, private property: string, negated: boolean) {
        super(builder, ctx, negated);
    }
    protected withCtx(ctx: ExpectContext): this { return new CssMatcher(this.builder, ctx, this.property, this.negated) as this; }
    protected withNegated(negated: boolean): this { return new CssMatcher(this.builder, this.ctx, this.property, negated) as this; }

    toBe(expected: string): ExpectBuilder { return this.enqueue(v => v === expected, 'to be', expected); }
    toContain(expected: string): ExpectBuilder { return this.enqueue(v => v.includes(expected), 'to contain', expected); }
    toMatch(re: RegExp): ExpectBuilder { return this.enqueue(v => re.test(v), 'to match', re); }

    private enqueue(test: (value: string) => boolean, verb: string, expected: unknown): ExpectBuilder {
        const negated = this.negated;
        const property = this.property;
        return this.builder.enqueue(this.ctx, (entry) => {
            let lastValue = '';
            return assertWithLiveRead(
                entry.ctx, negated,
                async () => {
                    const element = await entry.ctx.resolveElement();
                    lastValue = await element.getCssProperty(property);
                    return test(lastValue);
                },
                n => describeFailure(entry.ctx, `css "${property}"`, verb, expected, lastValue, n),
                entry.messageOverride,
            );
        });
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
 * Semantics:
 *   - `.not` toggles negation for the *next* matcher only (one-shot).
 *   - `.throws(message)` replaces the failure message of the most recently
 *     queued assertion.
 *   - `.timeout(ms)` mutates the forward context AND retroactively updates
 *     the most recently queued assertion. Per-matcher `.timeout(ms)`
 *     (e.g. `.text.timeout(500).toBe(...)`) scopes to that matcher only.
 *   - Awaiting executes every queued assertion sequentially; the first
 *     failure throws and subsequent assertions do not run.
 */
export class ExpectBuilder implements PromiseLike<void> {
    private ctx: ExpectContext;
    private queue: QueuedAssertion[] = [];
    private pendingNot: boolean;

    constructor(ctx: ExpectContext, initialNegated: boolean = false) {
        this.ctx = ctx;
        this.pendingNot = initialNegated;
    }

    /** One-shot negation for the next matcher reached from this builder. */
    get not(): this {
        this.pendingNot = !this.pendingNot;
        return this;
    }

    /**
     * Override the retry timeout. Mutates the forward context so every matcher
     * queued after this call uses the new timeout; retroactively updates the
     * most recently queued assertion so trailing `.toBe(pred).timeout(ms)`
     * scopes to that predicate.
     */
    timeout(ms: number): this {
        this.ctx = { ...this.ctx, timeout: ms };
        const last = this.queue[this.queue.length - 1];
        if (last) last.ctx = { ...last.ctx, timeout: ms };
        return this;
    }

    get text(): TextMatcher { return new TextMatcher(this, this.ctx, this.consumeNot()); }
    get value(): ValueMatcher { return new ValueMatcher(this, this.ctx, this.consumeNot()); }
    get count(): CountMatcher { return new CountMatcher(this, this.ctx, this.consumeNot()); }
    get visible(): BooleanMatcher { return new BooleanMatcher(this, this.ctx, 'visible', this.consumeNot()); }
    get enabled(): BooleanMatcher { return new BooleanMatcher(this, this.ctx, 'enabled', this.consumeNot()); }
    get attributes(): AttributesMatcher { return new AttributesMatcher(this, this.ctx, this.consumeNot()); }
    css(property: string): CssMatcher { return new CssMatcher(this, this.ctx, property, this.consumeNot()); }

    /**
     * Predicate escape hatch. Queues a custom predicate assertion on this
     * builder. Chain further matchers or finish with `.throws(message)` to
     * override the failure message.
     */
    toBe(predicate: (el: ElementSnapshot) => boolean): this {
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

    then<TResult1 = void, TResult2 = never>(
        onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null | undefined,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
    ): PromiseLike<TResult1 | TResult2> {
        return this.flush().then(onfulfilled, onrejected);
    }

    // ─── internals used by matchers ─────────────────────────────────

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
