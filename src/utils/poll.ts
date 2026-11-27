import { isFatalDriverError, LookupAbortedError } from '@civitas-cerebrum/element-repository';

/**
 * One probe of {@link pollUntil}. It gets an `AbortSignal` of its own, which
 * the poll aborts once it no longer needs the probe: when the probe runs out
 * of its share of the timeout, and when the poll is done with it (answered,
 * failed, or the poll ended). A probe passes the signal to every repository
 * lookup it makes (element-repository's `LookupOptions.signal`) and checks it
 * between its own driver calls, so that once aborted it starts no new
 * driver call. A driver call already running is not stopped: it finishes,
 * and its result is dropped.
 */
export type PollProbe<T> = (signal: AbortSignal) => Promise<T> | T;

/**
 * Throws element-repository's `LookupAbortedError` (naming `operation`) when
 * `signal` is aborted. A probe calls it between its own driver calls: a read
 * on an element a lookup already returned does not carry the lookup's
 * signal, so the probe stops itself before the next one.
 */
export function stopIfAborted(signal: AbortSignal | undefined, operation: string): void {
    if (signal?.aborted) throw new LookupAbortedError({ operation, reason: signal.reason });
}

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
    /**
     * What the probes run on (the device session's driver). A probe this poll
     * abandons is recorded under it, with its abort controller, until it
     * settles, so whoever owns the session can stop and wait for it with
     * {@link drainAbandonedProbes} before the app is relaunched or the
     * session is closed. Without a scope nothing is recorded.
     */
    scope?: object;
}

/** A probe a poll gave up on, still running. */
interface AbandonedProbe {
    /** When it was abandoned (epoch ms). */
    readonly since: number;
    /** Settles (never rejects) when the probe does. */
    readonly settled: Promise<void>;
    /** Aborts the probe's signal. */
    readonly controller: AbortController;
}

/** The abandoned probes still running, per scope. */
const abandoned = new WeakMap<object, Set<AbandonedProbe>>();

function recordAbandoned(scope: object, running: Promise<unknown>, controller: AbortController): void {
    let set = abandoned.get(scope);
    if (!set) {
        set = new Set();
        abandoned.set(scope, set);
    }
    const owner = set;
    const entry: AbandonedProbe = {
        since: Date.now(),
        controller,
        settled: running.then(() => undefined, () => undefined).then(() => { owner.delete(entry); }),
    };
    owner.add(entry);
}

/** How many probes abandoned under `scope` are still running. */
export function abandonedProbeCount(scope: object): number {
    return abandoned.get(scope)?.size ?? 0;
}

/** What {@link drainAbandonedProbes} found. */
export interface DrainResult {
    /** Abandoned probes that settled while the drain waited. */
    drained: number;
    /** Abandoned probes still running when the drain gave up at its cap. */
    stillRunning: number;
    /** How long the drain waited, in ms (0 when nothing was running). */
    waitedMs: number;
    /** How long the oldest probe still running has been running since it was abandoned, in ms (0 when none is). */
    longestRunningMs: number;
}

/** The abort reason the drain gives a probe it stops. */
export const DRAIN_ABORT_REASON = 'the session is being drained of abandoned probes';

/**
 * First aborts the signal of every probe abandoned under `scope` (the poll
 * already aborted it when it gave up on the probe; this makes sure), then
 * waits until each has settled, or `capMs` passes. A probe that passes its
 * signal to its lookups and checks it between its driver calls settles once
 * the driver call it is in finishes, so the wait is normally about one
 * driver call. A call already running is not stopped. Never throws. A probe
 * still running at the cap keeps running and stays recorded.
 */
export async function drainAbandonedProbes(scope: object, capMs: number): Promise<DrainResult> {
    const set = abandoned.get(scope);
    if (!set || set.size === 0) return { drained: 0, stillRunning: 0, waitedMs: 0, longestRunningMs: 0 };
    const started = Date.now();
    const stop = started + Math.max(0, capMs);
    const seen = new Set<AbandonedProbe>();
    // A probe abandoned while the drain waits is stopped and waited for too.
    while (set.size > 0) {
        const left = stop - Date.now();
        if (left <= 0) break;
        const batch = [...set];
        batch.forEach(p => p.controller.abort(new Error(DRAIN_ABORT_REASON)));
        batch.forEach(p => seen.add(p));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const capped = new Promise<'cap'>(resolve => { timer = setTimeout(() => resolve('cap'), left); });
        const outcome = await Promise.race([Promise.all(batch.map(p => p.settled)).then(() => 'done' as const), capped]);
        clearTimeout(timer);
        if (outcome === 'cap') break;
    }
    const now = Date.now();
    const running = [...set];
    return {
        drained: [...seen].filter(p => !set.has(p)).length,
        stillRunning: running.length,
        waitedMs: now - started,
        longestRunningMs: running.length === 0 ? 0 : now - Math.min(...running.map(p => p.since)),
    };
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

/** The abort reason of a probe the poll is done with (it answered, failed, or the poll ended). */
export const PROBE_DONE_REASON = 'the poll no longer needs this probe';

/**
 * Runs one probe, raced against `budget` ms, with an abort signal of its
 * own. The timer is always cleared, so nothing keeps the process alive; an
 * abandoned probe's late rejection is swallowed (it has already been
 * replaced by a {@link ProbeTimeoutError}). A probe that runs out of time has
 * its signal aborted (the reason is the {@link ProbeTimeoutError}) before the
 * poll goes on, and, with a `scope`, is recorded under it until it settles.
 * Every probe's signal is aborted once the poll is done with it.
 */
async function boundedProbe<T>(probe: PollProbe<T>, budget: number, scope: object | undefined): Promise<T> {
    const controller = new AbortController();
    const running = Promise.resolve().then(() => probe(controller.signal));
    running.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProbeTimeoutError(budget)), budget);
    });
    try {
        return await Promise.race([running, expired]);
    } catch (error) {
        if (error instanceof ProbeTimeoutError) {
            controller.abort(error);
            if (scope) recordAbandoned(scope, running, controller);
        }
        throw error;
    } finally {
        clearTimeout(timer);
        controller.abort(new Error(PROBE_DONE_REASON));
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
 * - One probe at a time: the next probe starts only once the previous one
 *   answered. A probe that ran out of time ends the poll there and then
 *   (it was given all the time left), so a poll never runs two probes at
 *   once and starts none after an abandoned one.
 * - Every probe gets an abort signal of its own ({@link PollProbe}). The
 *   signal of a probe that ran out of time is aborted (its reason is the
 *   {@link ProbeTimeoutError}) before the poll moves on, and every probe's
 *   signal is aborted once the poll is done with it. A probe that passes it
 *   to its repository lookups and checks it between its own driver calls
 *   ({@link stopIfAborted}) starts no driver call after that. A driver call
 *   already running is NOT stopped: it finishes in the background, after
 *   `pollUntil` moved on or returned. So probes must be read-only (a state
 *   getter, a text read): a probe that changes the app (a click, a swipe)
 *   could act late. With `options.scope` (the device polls pass their
 *   driver) the abandoned probe is recorded under it, and
 *   {@link drainAbandonedProbes} stops and waits for it: the platform fixture drains
 *   the session's driver after each test, before the failure evidence and
 *   the next relaunch, so that last call ends on the app launch it started on.
 * - The poll's own aborts never reach its verdict: it aborts a probe only
 *   once it stopped waiting for it. A `LookupAbortedError` from a probe
 *   (a lookup cancelled by some other signal) is rethrown at once, like a
 *   fatal error: never retried, never the last error, never an answer.
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
    probe: PollProbe<T>,
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
            const value = await boundedProbe(probe, Math.max(deadline - Date.now(), interval, 1), options.scope);
            probed = true;
            hasValue = true;
            lastValue = value;
            lastError = undefined;
            unansweredBudget = undefined;
            if (check(value) !== false) return value;
        } catch (error) {
            // A lookup aborted by a signal other than this poll's (the poll
            // aborts a probe only once it stopped waiting for it, so its own
            // aborts never get here) is the caller's cancel: never a last
            // error, never retried, never an answer.
            if (!probed && (isFatalDriverError(error) || error instanceof LookupAbortedError)) throw error;
            if (error instanceof ProbeTimeoutError) longestUnanswered = Math.max(longestUnanswered, error.budget);
            if (error instanceof ProbeTimeoutError && lastError !== undefined && !(lastError instanceof ProbeTimeoutError)) {
                unansweredBudget = error.budget;
            } else {
                lastError = error;
                unansweredBudget = undefined;
            }
            // A probe that ran out of time is still running: it was given all
            // the time left, so the poll ends now rather than starting another
            // probe beside it (a timer may fire a moment before the clock
            // reads the deadline, which would otherwise leave a sliver).
            if (error instanceof ProbeTimeoutError) break;
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
 * lost connection) and an aborted lookup (`LookupAbortedError`) are
 * rethrown. Neither must ever be read as "not displayed" or "not there":
 * that would turn a dead session into a passing absence check or a silently
 * skipped gate, and a cancelled read into an answer.
 */
export async function softRead<T>(read: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isFatalDriverError(err) || err instanceof LookupAbortedError) throw err;
        return fallback;
    }
}
