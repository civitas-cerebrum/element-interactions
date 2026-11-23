/** Options for {@link pollUntil}. */
export interface PollOptions {
    /** Deadline in ms, measured from the call. At least one probe always runs, even with `0`. */
    timeout: number;
    /** Pause between probes in ms (default {@link DEFAULT_POLL_INTERVAL}). Never sleeps past the deadline. */
    interval?: number;
    /** What was being waited for; leads the timeout error message. */
    message?: string | (() => string);
}

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
 * - Probes run every `interval` ms (100 by default); the last sleep is cut
 *   short at the deadline, and one final probe runs at the deadline.
 * - A single probe is bounded too: it is raced against the time left (never
 *   less than one `interval`, so a probe at the deadline or with timeout `0`
 *   still gets a chance to answer). A probe that has not answered by then is
 *   abandoned and recorded as the last error, so a call ends at most about
 *   `timeout + interval` ms after it started, however slow the driver is.
 * - On timeout it throws {@link PollTimeoutError}, whose message names what
 *   was awaited, the timeout, the last observed value and the last error.
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

    for (;;) {
        try {
            const value = await boundedProbe(probe, Math.max(deadline - Date.now(), interval));
            hasValue = true;
            lastValue = value;
            lastError = undefined;
            if (check(value) !== false) return value;
        } catch (error) {
            lastError = error;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(interval, remaining)));
    }

    const what = typeof options.message === 'function' ? options.message() : options.message;
    const parts = [`${what ?? 'Condition not met'}: timed out after ${timeout} ms.`];
    parts.push(`Last value: ${hasValue ? describeValue(lastValue) : '(no value; every probe failed)'}.`);
    if (lastError !== undefined) parts.push(`Last error: ${errorText(lastError)}`);
    throw new PollTimeoutError(parts.join(' '), timeout, lastValue, lastError);
}
