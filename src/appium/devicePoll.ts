import { pollUntil, type PollOptions, type PollProbe } from '../utils/poll';

/** The options of {@link devicePoll}: {@link PollOptions} without `scope`, which is its own argument. */
export type DevicePollOptions = Omit<PollOptions, 'scope'>;

/**
 * The one way the Appium family polls: `pollUntil` with the session's
 * `driver` as the scope, so a probe the poll gives up on is recorded under
 * the driver and the platform fixture stops and waits for it
 * (`drainAbandonedProbes`) before the evidence and the next relaunch.
 *
 * The scope is a required argument, not an option that can be left out. The
 * probe gets the poll's abort signal ({@link PollProbe}): a probe that makes
 * a repository lookup passes it on, and a probe of several driver calls
 * checks it between them (`stopIfAborted`). A probe of one driver call has
 * nothing to stop: that call, once started, finishes. Every poll under
 * `src/appium` goes through here; a source scan in the tests holds that.
 *
 * @param driver - The device session's driver: the scope abandoned probes are recorded under.
 * @param probe - One read-only check; gets the poll's abort signal.
 * @param check - Accepts the probe's value (see `pollUntil`).
 * @param options - `pollUntil`'s options, `scope` excepted.
 * @returns the accepted value.
 */
export function devicePoll<T>(
    driver: object,
    probe: PollProbe<T>,
    check: (value: T) => boolean | void,
    options: DevicePollOptions,
): Promise<T> {
    return pollUntil(probe, check, { ...options, scope: driver });
}
