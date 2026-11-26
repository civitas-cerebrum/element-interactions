import type { CountVerifyOptions } from '../enum/Options';

/**
 * The count conditions of {@link CountVerifyOptions}, shared by `verifyCount`
 * and both families' `Verifications.count`: one validation, one description
 * and one evaluation, so the steps layer and the families can never disagree
 * about which combinations are accepted or what a count must satisfy.
 *
 * Accepted: `exactly` alone, or a range of at most one lower bound
 * (`greaterThan` or `greaterThanOrEqual`) and at most one upper bound
 * (`lessThan` or `lessThanOrEqual`). Every given bound must hold.
 */

type Bound = 'exactly' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';

const BOUNDS: readonly Bound[] = ['exactly', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual'];

const LABEL: Record<Bound, (n: number) => string> = {
    exactly: n => `exactly ${n}`,
    greaterThan: n => `> ${n}`,
    greaterThanOrEqual: n => `>= ${n}`,
    lessThan: n => `< ${n}`,
    lessThanOrEqual: n => `<= ${n}`,
};

const HOLDS: Record<Bound, (count: number, n: number) => boolean> = {
    exactly: (count, n) => count === n,
    greaterThan: (count, n) => count > n,
    greaterThanOrEqual: (count, n) => count >= n,
    lessThan: (count, n) => count < n,
    lessThanOrEqual: (count, n) => count <= n,
};

/** The bounds given in `options`, in a fixed order (exact, lower, upper). */
function given(options: CountVerifyOptions): Array<[Bound, number]> {
    const record = options as Partial<Record<Bound, number>>;
    return BOUNDS.filter(b => record[b] !== undefined).map(b => [b, record[b] as number]);
}

/**
 * Throws a usage error, before anything is resolved or polled, when `options`
 * names no bound, a bound that is not a finite number or is negative, `exactly`
 * together with a range, two lower or two upper bounds, or a range no element
 * count can satisfy (`{ greaterThan: 3, lessThan: 4 }`).
 */
export function validateCountOptions(options: CountVerifyOptions): void {
    if (options === null || typeof options !== 'object') {
        throw new Error(`CountVerifyOptions must be an object, got ${String(options)}.`);
    }
    const bounds = given(options);
    if (bounds.length === 0) {
        throw new Error(`You must provide 'exactly', 'greaterThan', 'lessThan', 'greaterThanOrEqual', or 'lessThanOrEqual' in CountVerifyOptions.`);
    }
    for (const [bound, n] of bounds) {
        if (typeof n !== 'number' || !Number.isFinite(n)) {
            throw new Error(`'${bound}' must be a finite number, got ${String(n)}.`);
        }
    }
    const o = options as Partial<Record<Bound, number>>;
    if (o.exactly !== undefined && o.exactly < 0) throw new Error(`'exactly' count cannot be negative.`);
    if (o.greaterThan !== undefined && o.greaterThan < 0) throw new Error(`'greaterThan' count cannot be negative.`);
    if (o.lessThan !== undefined && o.lessThan <= 0) {
        throw new Error(`'lessThan' must be greater than 0. Element counts cannot be negative.`);
    }
    if (o.greaterThanOrEqual !== undefined && o.greaterThanOrEqual < 0) throw new Error(`'greaterThanOrEqual' count cannot be negative.`);
    if (o.lessThanOrEqual !== undefined && o.lessThanOrEqual < 0) throw new Error(`'lessThanOrEqual' count cannot be negative.`);
    if (o.exactly !== undefined && bounds.length > 1) {
        const others = bounds.filter(([b]) => b !== 'exactly').map(([b]) => `'${b}'`).join(', ');
        throw new Error(`'exactly' cannot be combined with ${others} in CountVerifyOptions: give an exact count or a range, not both.`);
    }
    if (o.greaterThan !== undefined && o.greaterThanOrEqual !== undefined) {
        throw new Error(`CountVerifyOptions takes one lower bound: 'greaterThan' or 'greaterThanOrEqual', not both.`);
    }
    if (o.lessThan !== undefined && o.lessThanOrEqual !== undefined) {
        throw new Error(`CountVerifyOptions takes one upper bound: 'lessThan' or 'lessThanOrEqual', not both.`);
    }
    // The smallest and largest whole count the bounds allow.
    const lowest = o.exactly !== undefined ? Math.ceil(o.exactly)
        : o.greaterThan !== undefined ? Math.floor(o.greaterThan) + 1
            : o.greaterThanOrEqual !== undefined ? Math.ceil(o.greaterThanOrEqual) : 0;
    const highest = o.exactly !== undefined ? Math.floor(o.exactly)
        : o.lessThan !== undefined ? Math.ceil(o.lessThan) - 1
            : o.lessThanOrEqual !== undefined ? Math.floor(o.lessThanOrEqual) : Number.POSITIVE_INFINITY;
    if (lowest > highest) {
        throw new Error(`No element count is ${describeCountOptions(options)}: the CountVerifyOptions range is empty.`);
    }
}

/** The condition `options` states, e.g. `exactly 3`, `> 1 and < 3`, `>= 6`. */
export function describeCountOptions(options: CountVerifyOptions): string {
    return given(options).map(([bound, n]) => LABEL[bound](n)).join(' and ');
}

/** The bounds of `options` that `count` breaks (described as in {@link describeCountOptions}); empty when it satisfies them all. */
export function failedCountBounds(options: CountVerifyOptions, count: number): string[] {
    return given(options).filter(([bound, n]) => !HOLDS[bound](count, n)).map(([bound, n]) => LABEL[bound](n));
}

/**
 * Why `count` fails the (possibly `negated`) condition, for a failure
 * message: `6 is not < 3`, or negated `2 is > 1 and < 3`. `undefined` when it
 * passes.
 */
export function countMismatch(options: CountVerifyOptions, count: number, negated: boolean = false): string | undefined {
    const failed = failedCountBounds(options, count);
    if (negated) return failed.length === 0 ? `${count} is ${describeCountOptions(options)}` : undefined;
    return failed.length === 0 ? undefined : `${count} is not ${failed.join(' and ')}`;
}
