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

/**
 * Runs `probe` until `check` accepts its value or `timeout` ms pass.
 *
 * - `check` accepts by returning `true` or nothing (`undefined`, assertion
 *   style), and rejects by returning `false` or throwing.
 * - A throwing `probe` (stale element, element not found yet) is retried,
 *   not thrown, until the deadline.
 * - Probes run every `interval` ms (100 by default); the last sleep is cut
 *   short at the deadline, and one final probe runs at the deadline.
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
            const value = await probe();
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
