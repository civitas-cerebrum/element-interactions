/**
 * The rule element-repository applies to driver errors during a polling
 * lookup, mirrored here because the package does not export it. An error is
 * FATAL when the query itself is wrong (invalid selector, invalid argument),
 * the driver cannot do it (unknown command, unsupported operation) or the
 * session, window or connection is gone. No amount of polling fixes a fatal
 * error, and a fatal error must never be read as "not displayed" or "not
 * there": that would turn a dead session into a passing absence check or a
 * silently skipped gate. Every other error (`no such element`, `stale element
 * reference`, a not-found message) is a transient miss.
 */
const FATAL_DRIVER_ERROR_NAMES = new Set([
    'invalid selector', 'InvalidSelectorError',
    'invalid session id', 'InvalidSessionIdError',
    'session not created', 'SessionNotCreatedError',
    'invalid argument', 'unknown command', 'unsupported operation', 'no such window',
]);

const FATAL_DRIVER_ERROR_MESSAGES = [
    /invalid selector/i,
    /invalid session id/i,
    /session not created/i,
    /session is either terminated or not started/i,
    /ECONNREFUSED/,
    /ECONNRESET|ENOTFOUND|EPIPE/,
    /InvalidSelector(Strategy|Match)/,
    /selector needs to be typeof/,
    /instrumentation process is not running/i,
];

/** `true` when `err` is a driver error no amount of polling can fix (see the module comment). */
export function isFatalDriverError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const { name, message } = err as { name?: unknown; message?: unknown };
    if (typeof name === 'string' && FATAL_DRIVER_ERROR_NAMES.has(name)) return true;
    return typeof message === 'string' && FATAL_DRIVER_ERROR_MESSAGES.some(re => re.test(message));
}

/** Runs `read`; a transient failure answers `fallback`, a fatal driver error is rethrown. */
export async function softRead<T>(read: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isFatalDriverError(err)) throw err;
        return fallback;
    }
}
