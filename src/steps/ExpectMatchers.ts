import { Locator } from '@playwright/test';

/**
 * Snapshot of an element's state at a single point in time.
 *
 * Passed to predicates in `steps.expect(el, page, predicate)` and
 * `steps.on(el, page).expect(predicate)`. All fields are primitives or
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

async function readCssProperty(locator: Locator, property: string): Promise<string> {
    return locator.evaluate(
        (el, prop) => window.getComputedStyle(el as Element).getPropertyValue(prop),
        property,
    );
}

abstract class BaseMatcher {
    constructor(protected ctx: ExpectContext, protected negated: boolean = false) {}

    protected async assertSnapshot(
        predicate: (snap: ElementSnapshot) => boolean,
        describe: (snap: ElementSnapshot, negated: boolean) => string,
    ): Promise<void> {
        if (this.ctx.conditionalVisible) {
            try {
                const locator = await this.ctx.resolveLocator();
                await locator.waitFor({ state: 'visible', timeout: this.ctx.visibilityTimeout });
            } catch {
                return;
            }
        }

        const deadline = Date.now() + this.ctx.timeout;
        const pollMs = 100;
        let lastSnapshot: ElementSnapshot | null = null;
        let lastError: unknown = null;

        while (Date.now() < deadline) {
            try {
                lastSnapshot = await this.ctx.captureSnapshot();
                const rawResult = predicate(lastSnapshot);
                if (rawResult !== this.negated) return;
            } catch (err) {
                lastError = err;
            }
            await new Promise(resolve => setTimeout(resolve, pollMs));
        }

        if (!lastSnapshot) {
            const reason = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown');
            throw new Error(
                `expect() failed on ${this.ctx.pageName}.${this.ctx.elementName}: could not resolve element within ${this.ctx.timeout}ms — ${reason}`,
            );
        }
        throw new Error(describe(lastSnapshot, this.negated));
    }

    protected async assertCustom(
        evaluate: () => Promise<boolean>,
        describe: (negated: boolean) => string,
    ): Promise<void> {
        if (this.ctx.conditionalVisible) {
            try {
                const locator = await this.ctx.resolveLocator();
                await locator.waitFor({ state: 'visible', timeout: this.ctx.visibilityTimeout });
            } catch {
                return;
            }
        }

        const deadline = Date.now() + this.ctx.timeout;
        const pollMs = 100;

        while (Date.now() < deadline) {
            try {
                const rawResult = await evaluate();
                if (rawResult !== this.negated) return;
            } catch {
                // swallow and retry
            }
            await new Promise(resolve => setTimeout(resolve, pollMs));
        }

        throw new Error(describe(this.negated));
    }
}

export class TextMatcher extends BaseMatcher {
    get not(): TextMatcher {
        return new TextMatcher(this.ctx, !this.negated);
    }

    async toBe(expected: string): Promise<void> {
        await this.assertSnapshot(
            s => s.text === expected,
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} text ${n ? 'not ' : ''}to be "${expected}", got "${s.text}"`,
        );
    }

    async toContain(expected: string): Promise<void> {
        await this.assertSnapshot(
            s => s.text.includes(expected),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} text ${n ? 'not ' : ''}to contain "${expected}", got "${s.text}"`,
        );
    }

    async toMatch(re: RegExp): Promise<void> {
        await this.assertSnapshot(
            s => re.test(s.text),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} text ${n ? 'not ' : ''}to match ${re}, got "${s.text}"`,
        );
    }

    async toStartWith(prefix: string): Promise<void> {
        await this.assertSnapshot(
            s => s.text.startsWith(prefix),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} text ${n ? 'not ' : ''}to start with "${prefix}", got "${s.text}"`,
        );
    }

    async toEndWith(suffix: string): Promise<void> {
        await this.assertSnapshot(
            s => s.text.endsWith(suffix),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} text ${n ? 'not ' : ''}to end with "${suffix}", got "${s.text}"`,
        );
    }
}

export class ValueMatcher extends BaseMatcher {
    get not(): ValueMatcher {
        return new ValueMatcher(this.ctx, !this.negated);
    }

    async toBe(expected: string): Promise<void> {
        await this.assertSnapshot(
            s => s.value === expected,
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} value ${n ? 'not ' : ''}to be "${expected}", got "${s.value}"`,
        );
    }

    async toContain(expected: string): Promise<void> {
        await this.assertSnapshot(
            s => s.value.includes(expected),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} value ${n ? 'not ' : ''}to contain "${expected}", got "${s.value}"`,
        );
    }

    async toMatch(re: RegExp): Promise<void> {
        await this.assertSnapshot(
            s => re.test(s.value),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} value ${n ? 'not ' : ''}to match ${re}, got "${s.value}"`,
        );
    }

    async toStartWith(prefix: string): Promise<void> {
        await this.assertSnapshot(
            s => s.value.startsWith(prefix),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} value ${n ? 'not ' : ''}to start with "${prefix}", got "${s.value}"`,
        );
    }

    async toEndWith(suffix: string): Promise<void> {
        await this.assertSnapshot(
            s => s.value.endsWith(suffix),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} value ${n ? 'not ' : ''}to end with "${suffix}", got "${s.value}"`,
        );
    }
}

export class CountMatcher extends BaseMatcher {
    get not(): CountMatcher {
        return new CountMatcher(this.ctx, !this.negated);
    }

    async toBe(expected: number): Promise<void> {
        await this.assertSnapshot(
            s => s.count === expected,
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} count ${n ? 'not ' : ''}to be ${expected}, got ${s.count}`,
        );
    }

    async toBeGreaterThan(n: number): Promise<void> {
        await this.assertSnapshot(
            s => s.count > n,
            (s, neg) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} count ${neg ? 'not ' : ''}to be greater than ${n}, got ${s.count}`,
        );
    }

    async toBeLessThan(n: number): Promise<void> {
        await this.assertSnapshot(
            s => s.count < n,
            (s, neg) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} count ${neg ? 'not ' : ''}to be less than ${n}, got ${s.count}`,
        );
    }

    async toBeGreaterThanOrEqual(n: number): Promise<void> {
        await this.assertSnapshot(
            s => s.count >= n,
            (s, neg) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} count ${neg ? 'not ' : ''}to be greater than or equal to ${n}, got ${s.count}`,
        );
    }

    async toBeLessThanOrEqual(n: number): Promise<void> {
        await this.assertSnapshot(
            s => s.count <= n,
            (s, neg) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} count ${neg ? 'not ' : ''}to be less than or equal to ${n}, got ${s.count}`,
        );
    }
}

type BooleanField = 'visible' | 'enabled';

export class BooleanMatcher extends BaseMatcher {
    constructor(ctx: ExpectContext, private field: BooleanField, negated: boolean = false) {
        super(ctx, negated);
    }

    get not(): BooleanMatcher {
        return new BooleanMatcher(this.ctx, this.field, !this.negated);
    }

    async toBe(expected: boolean): Promise<void> {
        await this.assertSnapshot(
            s => s[this.field] === expected,
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} ${this.field} ${n ? 'not ' : ''}to be ${expected}, got ${s[this.field]}`,
        );
    }

    async toBeTrue(): Promise<void> {
        await this.toBe(true);
    }

    async toBeFalse(): Promise<void> {
        await this.toBe(false);
    }
}

export class AttributeMatcher extends BaseMatcher {
    constructor(ctx: ExpectContext, private attrName: string, negated: boolean = false) {
        super(ctx, negated);
    }

    get not(): AttributeMatcher {
        return new AttributeMatcher(this.ctx, this.attrName, !this.negated);
    }

    async toBe(expected: string): Promise<void> {
        await this.assertSnapshot(
            s => s.attributes[this.attrName] === expected,
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} attribute "${this.attrName}" ${n ? 'not ' : ''}to be "${expected}", got "${s.attributes[this.attrName] ?? '<missing>'}"`,
        );
    }

    async toContain(expected: string): Promise<void> {
        await this.assertSnapshot(
            s => (s.attributes[this.attrName] ?? '').includes(expected),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} attribute "${this.attrName}" ${n ? 'not ' : ''}to contain "${expected}", got "${s.attributes[this.attrName] ?? '<missing>'}"`,
        );
    }

    async toMatch(re: RegExp): Promise<void> {
        await this.assertSnapshot(
            s => re.test(s.attributes[this.attrName] ?? ''),
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} attribute "${this.attrName}" ${n ? 'not ' : ''}to match ${re}, got "${s.attributes[this.attrName] ?? '<missing>'}"`,
        );
    }
}

export class AttributesMatcher extends BaseMatcher {
    get not(): AttributesMatcher {
        return new AttributesMatcher(this.ctx, !this.negated);
    }

    get(name: string): AttributeMatcher {
        return new AttributeMatcher(this.ctx, name, this.negated);
    }

    async toHaveKey(name: string): Promise<void> {
        await this.assertSnapshot(
            s => name in s.attributes,
            (s, n) =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} attributes ${n ? 'not ' : ''}to have key "${name}", present keys: [${Object.keys(s.attributes).join(', ')}]`,
        );
    }
}

export class CssMatcher extends BaseMatcher {
    constructor(ctx: ExpectContext, private property: string, negated: boolean = false) {
        super(ctx, negated);
    }

    get not(): CssMatcher {
        return new CssMatcher(this.ctx, this.property, !this.negated);
    }

    async toBe(expected: string): Promise<void> {
        let lastValue = '';
        await this.assertCustom(
            async () => {
                const locator = await this.ctx.resolveLocator();
                lastValue = await readCssProperty(locator, this.property);
                return lastValue === expected;
            },
            n =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} css "${this.property}" ${n ? 'not ' : ''}to be "${expected}", got "${lastValue}"`,
        );
    }

    async toContain(expected: string): Promise<void> {
        let lastValue = '';
        await this.assertCustom(
            async () => {
                const locator = await this.ctx.resolveLocator();
                lastValue = await readCssProperty(locator, this.property);
                return lastValue.includes(expected);
            },
            n =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} css "${this.property}" ${n ? 'not ' : ''}to contain "${expected}", got "${lastValue}"`,
        );
    }

    async toMatch(re: RegExp): Promise<void> {
        let lastValue = '';
        await this.assertCustom(
            async () => {
                const locator = await this.ctx.resolveLocator();
                lastValue = await readCssProperty(locator, this.property);
                return re.test(lastValue);
            },
            n =>
                `expected ${this.ctx.pageName}.${this.ctx.elementName} css "${this.property}" ${n ? 'not ' : ''}to match ${re}, got "${lastValue}"`,
        );
    }
}

/**
 * Root of the matcher tree. Returned by `steps.expect(el, page)` and exposed
 * via `.not` on `ElementAction`. Every matcher reached from here carries the
 * negated flag inherited from this root.
 */
export class ExpectBuilder {
    constructor(private ctx: ExpectContext, private negated: boolean = false) {}

    get not(): ExpectBuilder {
        return new ExpectBuilder(this.ctx, !this.negated);
    }

    get text(): TextMatcher {
        return new TextMatcher(this.ctx, this.negated);
    }

    get value(): ValueMatcher {
        return new ValueMatcher(this.ctx, this.negated);
    }

    get count(): CountMatcher {
        return new CountMatcher(this.ctx, this.negated);
    }

    get visible(): BooleanMatcher {
        return new BooleanMatcher(this.ctx, 'visible', this.negated);
    }

    get enabled(): BooleanMatcher {
        return new BooleanMatcher(this.ctx, 'enabled', this.negated);
    }

    get attributes(): AttributesMatcher {
        return new AttributesMatcher(this.ctx, this.negated);
    }

    css(property: string): CssMatcher {
        return new CssMatcher(this.ctx, property, this.negated);
    }
}
