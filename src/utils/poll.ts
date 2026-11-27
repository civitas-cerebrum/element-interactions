import { isFatalDriverError } from '@civitas-cerebrum/element-repository';

/** Options for {@link pollUntil}. */
export interface PollOptions {
    /** Deadline in ms, measured from the call. At least one probe always runs, even with `0`. */
    timeout: number;
    /** Pause between probes in ms (default {@link DEFAULT_POLL_INTERVAL}). Never sleeps past the deadline. */
    interval?: number;
    /** What was being waited for; leads the timeout error message. */
    message?: string | (() => string);
    /**
     * What the last answered value means, as a sentence (e.g. "The element was
     * still displayed on the last answered poll"). When it returns a sentence,
     * the timeout message states it ahead of the value:
     * `<sentence> (Last value: <value>).` Returning `undefined` (or leaving
     * the option out) keeps `Last value: <value>.`. Never used when no probe
     * answered.
     */
    lastValueMeaning?: (value: unknown) => string | undefined;
    /**
     * A sentence the caller adds when no probe answered at all (each one ran
     * out of its share of the timeout), after the cause-neutral no-answer
     * text; e.g. what makes this kind of check slow and how to give it room.
     * Never used when a probe answered, with a value or an error.
     */
    noAnswerHint?: string;
}

/** Leads the timeout message of a poll in which no probe answered at all. */
export const NO_ANSWER_LEAD = 'No answer was obtained';

/** Default pause between two probes, in ms. */
export const DEFAULT_POLL_INTERVAL = 100;

/** Thrown by {@link pollUntil} when the deadline passes before the check succeeds. */
export class PollTimeoutError extends Error {
    /** The value the last successful probe returned (`undefined` when no probe succeeded). */
    readonly lastValue: unknown;
    /** The last error a probe or check raised, if any. */
    readonly lastError: unknown;
    /** The timeout that expired, in ms. */
    readonly timeout: number;

    constructor(message: string, timeout: number, lastValue: unknown, lastError: unknown) {
        super(message);
        this.name = 'PollTimeoutError';
        this.timeout = timeout;
        this.lastValue = lastValue;
        this.lastError = lastError;
    }
}

/** Renders a probed value for an error message. */
export function describeValue(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return JSON.stringify(value);
    if (value instanceof RegExp) return String(value);
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Thrown into `lastError` when a probe does not answer within its share of the timeout. */
export class ProbeTimeoutError extends Error {
    constructor(readonly budget: number) {
        super(`the probe did not answer within ${budget} ms`);
        this.name = 'ProbeTimeoutError';
    }
}

/**
 * Runs one probe, raced against `budget` ms. The timer is always cleared, so
 * nothing keeps the process alive; an abandoned probe's late rejection is
 * swallowed (it has already been replaced by a {@link ProbeTimeoutError}).
 */
async function boundedProbe<T>(probe: () => Promise<T> | T, budget: number): Promise<T> {
    const running = Promise.resolve().then(probe);
    running.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeoutError(budget)), budget);
    });
    try {
        return await Promise.race([running, expired]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Runs `probe` until `check` accepts its value or `timeout` ms pass.
 *
 * - `check` accepts by returning `true` or nothing (`undefined`, assertion
 *   style), and rejects by returning `false` or throwing.
 * - A throwing `probe` (stale element, element not found yet) is retried,
 *   not thrown, until the deadline.
 * - A FATAL driver error from the probe (dead session, invalid selector, lost
 *   connection) is rethrown at once, unwrapped, as element-repository's own
 *   polling lookups do: no amount of polling fixes it.
 * - Probes run every `interval` ms (100 by default); the last sleep is cut
 *   short at the deadline, and one final probe runs at the deadline.
 * - A single probe is bounded too: it is raced against the time left (never
 *   less than one `interval`, nor less than 1 ms, so a probe at the deadline
 *   or with timeout `0` still gets a chance to answer). A probe that has not
 *   answered by then is abandoned and recorded as the last error, so a call
 *   ends at most about `timeout + interval` ms after it started, however slow
 *   the driver is.
 * - Probes must be read-only (a state getter, a text read): an abandoned
 *   probe is NOT cancelled. Its driver command keeps running in the
 *   background and may still complete after `pollUntil` moved on or returned,
 *   so a probe that changes the app (a click, a swipe) could act twice or late.
 * - On timeout it throws {@link PollTimeoutError}, whose message names what
 *   was awaited, the timeout, the last observed value and the last error.
 *   When a probe answered and the probes after it only ran out of time, the
 *   last value leads and the unanswered probe is a note after it, not the
 *   last error (the error's `lastError` still holds the
 *   {@link ProbeTimeoutError}). When no probe answered at all (each one ran
 *   out of its share, none answered even with an error), the message says no
 *   check finished within the timeout, how long the probe was given, and
 *   what may have caused it (a slow driver call or lookup pass, or a driver
 *   that stopped answering), then the caller's `noAnswerHint`; it never reads
 *   as a failed check.
 *
 * @returns the accepted value.
 */
export async function pollUntil<T>(
    probe: () => Promise<T> | T,
    check: (value: T) => boolean | void,
    options: PollOptions,
): Promise<T> {
    const timeout = options.timeout;
    if (!Number.isFinite(timeout) || timeout < 0) {
        throw new Error(`pollUntil: timeout must be a non-negative, finite number of ms, got ${timeout}`);
    }
    const interval = options.interval ?? DEFAULT_POLL_INTERVAL;
    if (!Number.isFinite(interval) || interval < 0) {
        throw new Error(`pollUntil: interval must be a non-negative, finite number of ms, got ${interval}`);
    }

    const deadline = Date.now() + timeout;
    let hasValue = false;
    let lastValue: T | undefined;
    let lastError: unknown;
    // A probe that did not answer after an earlier attempt failed for a real
    // reason: that reason stays the last error, this notes the timeout.
    let unansweredBudget: number | undefined;
    // The longest share of the timeout a probe was given and ran out of.
    let longestUnanswered = 0;

    for (;;) {
        let probed = false;
        try {
            // Never a zero budget, even with `interval: 0` at the deadline.
            const value = await boundedProbe(probe, Math.max(deadline - Date.now(), interval, 1));
            probed = true;
            hasValue = true;
            lastValue = value;
            lastError = undefined;
            unansweredBudget = undefined;
            if (check(value) !== false) return value;
        } catch (error) {
            if (!probed && isFatalDriverError(error)) throw error;
            if (error instanceof ProbeTimeoutError) longestUnanswered = Math.max(longestUnanswered, error.budget);
            if (error instanceof ProbeTimeoutError && lastError !== undefined && !(lastError instanceof ProbeTimeoutError)) {
                unansweredBudget = error.budget;
            } else {
                lastError = error;
                unansweredBudget = undefined;
            }
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(interval, remaining)));
    }

    const what = typeof options.message === 'function' ? options.message() : options.message;
    const parts = [`${what ?? 'Condition not met'}: timed out after ${timeout} ms.`];
    if (!hasValue && lastError instanceof ProbeTimeoutError) {
        // No probe answered at all, not even with an error: every one ran out
        // of its share. That is no answer, never a failed check.
        parts.push(
            `${NO_ANSWER_LEAD}: no check finished within the timeout. `
            + `The probe was still running when its ${longestUnanswered} ms ran out: one check (a driver call or a lookup pass) `
            + `takes longer than the ${timeout} ms timeout, or the driver stopped answering. Allow more time with a longer timeout.`,
        );
        if (options.noAnswerHint) parts.push(options.noAnswerHint);
        throw new PollTimeoutError(parts.join(' '), timeout, lastValue, lastError);
    }
    if (!hasValue) {
        parts.push('Last value: (no value; every probe failed).');
    } else {
        const meaning = options.lastValueMeaning?.(lastValue);
        const value = meaning ? `${meaning} (Last value: ${describeValue(lastValue)})` : `Last value: ${describeValue(lastValue)}`;
        // The probes after the last answered one merely ran out of time: the
        // value is the answer, the timeout only a note after it.
        if (lastError instanceof ProbeTimeoutError) {
            parts.push(`${value}; the last probe did not answer within ${lastError.budget} ms.`);
            throw new PollTimeoutError(parts.join(' '), timeout, lastValue, lastError);
        }
        parts.push(`${value}.`);
    }
    if (lastError !== undefined) {
        const note = unansweredBudget === undefined ? '' : `; the last probe did not answer within ${unansweredBudget} ms`;
        parts.push(`Last error: ${errorText(lastError)}${note}`);
    }
    throw new PollTimeoutError(parts.join(' '), timeout, lastValue, lastError);
}

/**
 * Runs `read`; a transient failure answers `fallback`, a fatal driver error
 * (element-repository's `isFatalDriverError`: dead session, invalid selector,
 * lost connection) is rethrown. A fatal error must never be read as "not
 * displayed" or "not there": that would turn a dead session into a passing
 * absence check or a silently skipped gate.
 */
export async function softRead<T>(read: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isFatalDriverError(err)) throw err;
        return fallback;
    }
}
