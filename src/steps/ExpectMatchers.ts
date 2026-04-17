import { Locator } from '@playwright/test';

/**
 * Snapshot of an element's state at a single point in time.
 *
 * Passed to predicates in `steps.expect(el, page).toBe(predicate)` and
 * `steps.on(el, page).toBe(predicate)`. All fields are primitives or plain
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
 * Minimal surface the matcher tree needs from its host (typically an
 * `ElementAction`). Decouples matchers from `ElementAction` so the matcher
 * tree can be constructed from either the fluent builder or a top-level
 * `Steps.expect()` call.
 */
export interface ExpectContext {
    readonly elementName: string;
    readonly pageName: string;
    readonly timeout: number;
    readonly conditionalVisible: boolean;
    readonly visibilityTimeout: number;
    resolveLocator(): Promise<Locator>;
    captureSnapshot(): Promise<ElementSnapshot>;
}

/** One assertion queued on an `ExpectBuilder`. Executes when the builder is awaited. */
interface QueuedAssertion {
    /** The ctx snapshot captured when this assertion was queued. */
    ctx: ExpectContext;
    /** Executes the assertion; may throw on failure. */
    run(): Promise<void>;
    /** Optional message that replaces the default failure header. */
    messageOverride?: string;
}

async function readCssProperty(locator: Locator, property: string): Promise<string> {
    return locator.evaluate(
        (el, prop) => window.getComputedStyle(el as Element).getPropertyValue(prop),
        property,
    );
}

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
        const locator = await ctx.resolveLocator();
        await locator.waitFor({ state: 'visible', timeout: ctx.visibilityTimeout });
        return true;
    } catch {
        return false;
    }
}

async function assertWithSnapshot(
    ctx: ExpectContext,
    negated: boolean,
    predicate: (snap: ElementSnapshot) => boolean,
    describe: (snap: ElementSnapshot, negated: boolean) => string,
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

    if (!lastSnapshot) {
        const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
        throw new Error(
            `expect() failed on ${ctx.pageName}.${ctx.elementName}: could not resolve element within ${ctx.timeout}ms — ${reason}`,
        );
    }
    throw new Error(messageOverride ?? describe(lastSnapshot, negated));
}

async function assertWithLiveRead(
    ctx: ExpectContext,
    negated: boolean,
    evaluate: () => Promise<boolean>,
    describe: (negated: boolean) => string,
    messageOverride?: string,
): Promise<void> {
    if (!(await honorIfVisibleGate(ctx))) return;

    const deadline = Date.now() + ctx.timeout;
    const pollMs = 100;

    while (Date.now() < deadline) {
        try {
            if ((await evaluate()) !== negated) return;
        } catch {
            // swallow and retry
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }

    throw new Error(messageOverride ?? describe(negated));
}

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
        ?? `expect().toBe(predicate) failed on ${ctx.pageName}.${ctx.elementName} after ${ctx.timeout}ms`;
    if (!lastSnapshot) {
        const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
        throw new Error(`${header}\n  element could not be resolved: ${reason}`);
    }
    const snapshotJson = JSON.stringify(lastSnapshot, null, 2).replace(/^/gm, '    ');
    throw new Error(`${header}\n  snapshot at timeout:\n${snapshotJson}`);
}

// ─── Matcher adapters ────────────────────────────────────────────────
//
// These are lightweight wrappers exposed via getters on `ExpectBuilder`.
// Each terminal method captures the builder's context + negation at the time
// of the call, enqueues the assertion onto the builder, and returns the
// builder so the chain can continue.

abstract class StringMatcher {
    constructor(
        protected builder: ExpectBuilder,
        protected ctx: ExpectContext,
        protected negated: boolean,
    ) {}

    /** Override the retry timeout for this matcher only. */
    timeout(ms: number): this {
        const cloned = Object.create(Object.getPrototypeOf(this)) as StringMatcher;
        Object.assign(cloned, this);
        cloned.ctx = { ...this.ctx, timeout: ms };
        return cloned as this;
    }

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
        return this.builder.enqueue({ ctx: this.ctx, run: () => undefined as unknown as Promise<void> },
            entry => assertWithSnapshot(entry.ctx, negated, predicate, describe, entry.messageOverride));
    }
}

export class TextMatcher extends StringMatcher {
    get not(): TextMatcher { return new TextMatcher(this.builder, this.ctx, !this.negated); }
    protected fieldLabel(): string { return 'text'; }
    protected read(snap: ElementSnapshot): string { return snap.text; }
}

export class ValueMatcher extends StringMatcher {
    get not(): ValueMatcher { return new ValueMatcher(this.builder, this.ctx, !this.negated); }
    protected fieldLabel(): string { return 'value'; }
    protected read(snap: ElementSnapshot): string { return snap.value; }
}

export class AttributeMatcher extends StringMatcher {
    constructor(builder: ExpectBuilder, ctx: ExpectContext, private attrName: string, negated: boolean) {
        super(builder, ctx, negated);
    }
    get not(): AttributeMatcher { return new AttributeMatcher(this.builder, this.ctx, this.attrName, !this.negated); }
    protected fieldLabel(): string { return `attribute "${this.attrName}"`; }
    protected read(snap: ElementSnapshot): string { return snap.attributes[this.attrName] ?? ''; }
}

export class CountMatcher {
    constructor(
        private builder: ExpectBuilder,
        private ctx: ExpectContext,
        private negated: boolean,
    ) {}

    get not(): CountMatcher {
        return new CountMatcher(this.builder, this.ctx, !this.negated);
    }

    timeout(ms: number): CountMatcher {
        return new CountMatcher(this.builder, { ...this.ctx, timeout: ms }, this.negated);
    }

    toBe(expected: number): ExpectBuilder {
        return this.enqueue(
            s => s.count === expected,
            (s, n) => describeFailure(this.ctx, 'count', 'to be', expected, s.count, n),
        );
    }

    toBeGreaterThan(n: number): ExpectBuilder {
        return this.enqueue(
            s => s.count > n,
            (s, neg) => describeFailure(this.ctx, 'count', 'to be greater than', n, s.count, neg),
        );
    }

    toBeLessThan(n: number): ExpectBuilder {
        return this.enqueue(
            s => s.count < n,
            (s, neg) => describeFailure(this.ctx, 'count', 'to be less than', n, s.count, neg),
        );
    }

    toBeGreaterThanOrEqual(n: number): ExpectBuilder {
        return this.enqueue(
            s => s.count >= n,
            (s, neg) => describeFailure(this.ctx, 'count', 'to be greater than or equal to', n, s.count, neg),
        );
    }

    toBeLessThanOrEqual(n: number): ExpectBuilder {
        return this.enqueue(
            s => s.count <= n,
            (s, neg) => describeFailure(this.ctx, 'count', 'to be less than or equal to', n, s.count, neg),
        );
    }

    private enqueue(
        predicate: (snap: ElementSnapshot) => boolean,
        describe: (snap: ElementSnapshot, negated: boolean) => string,
    ): ExpectBuilder {
        const negated = this.negated;
        return this.builder.enqueue({ ctx: this.ctx, run: () => undefined as unknown as Promise<void> },
            entry => assertWithSnapshot(entry.ctx, negated, predicate, describe, entry.messageOverride));
    }
}

type BooleanField = 'visible' | 'enabled';

export class BooleanMatcher {
    constructor(
        private builder: ExpectBuilder,
        private ctx: ExpectContext,
        private field: BooleanField,
        private negated: boolean,
    ) {}

    get not(): BooleanMatcher {
        return new BooleanMatcher(this.builder, this.ctx, this.field, !this.negated);
    }

    timeout(ms: number): BooleanMatcher {
        return new BooleanMatcher(this.builder, { ...this.ctx, timeout: ms }, this.field, this.negated);
    }

    toBe(expected: boolean): ExpectBuilder {
        const negated = this.negated;
        const field = this.field;
        return this.builder.enqueue({ ctx: this.ctx, run: () => undefined as unknown as Promise<void> },
            entry => assertWithSnapshot(
                entry.ctx, negated,
                s => s[field] === expected,
                (s, n) => describeFailure(entry.ctx, field, 'to be', expected, s[field], n),
                entry.messageOverride,
            ));
    }

    toBeTrue(): ExpectBuilder { return this.toBe(true); }
    toBeFalse(): ExpectBuilder { return this.toBe(false); }
}

export class AttributesMatcher {
    constructor(
        private builder: ExpectBuilder,
        private ctx: ExpectContext,
        private negated: boolean,
    ) {}

    get not(): AttributesMatcher {
        return new AttributesMatcher(this.builder, this.ctx, !this.negated);
    }

    timeout(ms: number): AttributesMatcher {
        return new AttributesMatcher(this.builder, { ...this.ctx, timeout: ms }, this.negated);
    }

    get(name: string): AttributeMatcher {
        return new AttributeMatcher(this.builder, this.ctx, name, this.negated);
    }

    toHaveKey(name: string): ExpectBuilder {
        const negated = this.negated;
        return this.builder.enqueue({ ctx: this.ctx, run: () => undefined as unknown as Promise<void> },
            entry => assertWithSnapshot(
                entry.ctx, negated,
                s => name in s.attributes,
                (s, n) =>
                    `expected ${entry.ctx.pageName}.${entry.ctx.elementName} attributes ${n ? 'not ' : ''}to have key "${name}", present keys: [${Object.keys(s.attributes).join(', ')}]`,
                entry.messageOverride,
            ));
    }
}

export class CssMatcher {
    constructor(
        private builder: ExpectBuilder,
        private ctx: ExpectContext,
        private property: string,
        private negated: boolean,
    ) {}

    get not(): CssMatcher {
        return new CssMatcher(this.builder, this.ctx, this.property, !this.negated);
    }

    timeout(ms: number): CssMatcher {
        return new CssMatcher(this.builder, { ...this.ctx, timeout: ms }, this.property, this.negated);
    }

    toBe(expected: string): ExpectBuilder { return this.enqueue(v => v === expected, 'to be', expected); }
    toContain(expected: string): ExpectBuilder { return this.enqueue(v => v.includes(expected), 'to contain', expected); }
    toMatch(re: RegExp): ExpectBuilder { return this.enqueue(v => re.test(v), 'to match', re); }

    private enqueue(test: (value: string) => boolean, verb: string, expected: unknown): ExpectBuilder {
        const negated = this.negated;
        const property = this.property;
        return this.builder.enqueue({ ctx: this.ctx, run: () => undefined as unknown as Promise<void> },
            entry => {
                let lastValue = '';
                return assertWithLiveRead(
                    entry.ctx, negated,
                    async () => {
                        const locator = await entry.ctx.resolveLocator();
                        lastValue = await readCssProperty(locator, property);
                        return test(lastValue);
                    },
                    n => describeFailure(entry.ctx, `css "${property}"`, verb, expected, lastValue, n),
                    entry.messageOverride,
                );
            });
    }
}

/**
 * Root of the matcher tree and the queue-backed chain builder.
 *
 * Every matcher call enqueues an assertion and returns this builder, so you
 * can chain multiple verifications in one expression:
 *
 * ```ts
 * await steps.on('submitBtn', 'CheckoutPage')
 *   .text.toBe('Place Order')
 *   .enabled.toBeTrue()
 *   .attributes.get('data-variant').toBe('primary')
 *   .visible.toBeTrue();
 * ```
 *
 * The builder is a `PromiseLike<void>` — awaiting it executes every queued
 * assertion in the order they were added, short-circuiting on the first
 * failure (the await throws, subsequent queued assertions do not run).
 *
 * - `.not` toggles negation for the *next* matcher only (one-shot).
 * - `.throws(message)` overrides the failure message of the most recently
 *   queued assertion.
 * - `.timeout(ms)` mutates the builder's ctx, affecting every matcher that
 *   runs after it. Per-matcher `.timeout(ms)` applies only to that matcher.
 */
export class ExpectBuilder implements PromiseLike<void> {
    private ctx: ExpectContext;
    private queue: QueuedAssertion[] = [];
    private pendingNot: boolean;

    constructor(ctx: ExpectContext, initialNegated: boolean = false) {
        this.ctx = ctx;
        this.pendingNot = initialNegated;
    }

    /** One-shot negation. Flips the expected outcome of the *next* matcher only. */
    get not(): this {
        this.pendingNot = !this.pendingNot;
        return this;
    }

    private consumeNegation(): boolean {
        const n = this.pendingNot;
        this.pendingNot = false;
        return n;
    }

    /**
     * Override the retry timeout. Mutates the builder's context so every
     * matcher queued after this point runs with the new timeout, and also
     * updates the most recently queued assertion so positioning like
     * `.toBe(pred).timeout(500)` still scopes to that predicate.
     *
     * Per-matcher `.timeout(ms)` (e.g. `.text.timeout(500).toBe(...)`) remains
     * the right choice when you want the override to apply only to the next
     * matcher without leaking to assertions queued after it.
     */
    timeout(ms: number): this {
        this.ctx = { ...this.ctx, timeout: ms };
        const last = this.queue[this.queue.length - 1];
        if (last) last.ctx = { ...last.ctx, timeout: ms };
        return this;
    }

    // Field matcher getters — each consumes a pending .not and carries it
    // into the matcher that is about to be constructed.
    get text(): TextMatcher { return new TextMatcher(this, this.ctx, this.consumeNegation()); }
    get value(): ValueMatcher { return new ValueMatcher(this, this.ctx, this.consumeNegation()); }
    get count(): CountMatcher { return new CountMatcher(this, this.ctx, this.consumeNegation()); }
    get visible(): BooleanMatcher { return new BooleanMatcher(this, this.ctx, 'visible', this.consumeNegation()); }
    get enabled(): BooleanMatcher { return new BooleanMatcher(this, this.ctx, 'enabled', this.consumeNegation()); }
    get attributes(): AttributesMatcher { return new AttributesMatcher(this, this.ctx, this.consumeNegation()); }
    css(property: string): CssMatcher { return new CssMatcher(this, this.ctx, property, this.consumeNegation()); }

    /**
     * Predicate escape hatch. Queues a custom predicate assertion on this
     * builder. Chain further matchers or end with `.throws(message)` to
     * override the failure message.
     */
    toBe(predicate: (el: ElementSnapshot) => boolean): this {
        const negated = this.consumeNegation();
        this.enqueue({ ctx: this.ctx, run: () => undefined as unknown as Promise<void> },
            entry => assertPredicate(entry.ctx, negated, predicate, entry.messageOverride));
        return this;
    }

    /** Replace the failure message of the most recently queued assertion. */
    throws(message: string): this {
        const last = this.queue[this.queue.length - 1];
        if (last) last.messageOverride = message;
        return this;
    }

    /**
     * Add an assertion to the queue. Matchers call this to push their
     * terminal check. The `run` field is patched in place with the matcher's
     * executor so the matcher can reference `entry.messageOverride` (set later
     * by `.throws()`) without capturing a stale value.
     */
    enqueue(entry: QueuedAssertion, runFactory: (entry: QueuedAssertion) => Promise<void>): this {
        entry.run = () => runFactory(entry);
        this.queue.push(entry);
        return this;
    }

    then<TResult1 = void, TResult2 = never>(
        onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null | undefined,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
    ): PromiseLike<TResult1 | TResult2> {
        return this.flush().then(onfulfilled, onrejected);
    }

    private async flush(): Promise<void> {
        while (this.queue.length > 0) {
            const assertion = this.queue.shift()!;
            await assertion.run();
        }
    }
}
