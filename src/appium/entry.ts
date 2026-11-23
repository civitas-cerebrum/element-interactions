import { isFatalDriverError, type Element } from '@civitas-cerebrum/element-repository';
import type { EntryTarget } from '../interfaces/IEntryTarget';
import { softRead } from '../utils/poll';

/**
 * Attach budget, per `fallback` chain node, of one attempt of the visibility
 * probe ({@link probeVisibleOnDevice}). The web probe's slice, for the same
 * reason: a fixed slice keeps the cost of a chain walk independent of the
 * overall budget, and the probe simply stops starting attempts once that
 * budget is spent.
 */
export const DEVICE_RESOLVE_SLICE_MS = 250;

/**
 * Attach budget, per `fallback` chain node, of a POLL-DRIVEN re-resolution:
 * one poll of a matcher, of list presence, of a `satisfy()` snapshot. One
 * existence check per node and no waiting: the poll loop does the waiting, so
 * a missing node costs one driver lookup per poll instead of an attach slice,
 * and a short matcher timeout (a `.timeout(200)` on a missing element) still
 * gets its polls in. 1 ms, never 0: a zero timeout means "the default" to
 * some drivers.
 */
export const DEVICE_POLL_ATTACH_MS = 1;

/** Pause between two attempts of the visibility probe, in ms (the Appium family's poll interval). */
export const DEVICE_PROBE_INTERVAL_MS = 100;

/** `'Page.element'`, quoted, for error messages. */
export function entryLabel(entry: EntryTarget): string {
    return `'${entry.pageName}.${entry.elementName}'`;
}

/**
 * The visibility probe on a device platform: it RE-RESOLVES the entry on
 * every attempt (a short attach slice per `fallback` node, so a primary that
 * appears late is picked up by a later attempt) and asks the element whether
 * it is displayed, until `timeout` ms pass. With `containsText`, a displayed
 * element answers whether its text (`textContent`) contains it, at
 * once, as on web.
 *
 * Unlike web, it never answers `false` for a fatal driver error (dead
 * session, invalid selector): that error is thrown, so a gate on a dead
 * device fails loudly instead of skipping its action. A transient miss (no
 * match yet, a stale element, an eager strategy that found nothing) is "not
 * visible yet" and the probe keeps trying.
 *
 * One attempt is not bounded, as on web: the probe stops STARTING attempts at
 * `timeout`, but an attempt in flight (a fallback walk of
 * {@link DEVICE_RESOLVE_SLICE_MS} per missing node, then a displayed read on
 * a slow driver) runs to its end, so the call can return up to one attempt
 * after `timeout`.
 */
export async function probeVisibleOnDevice(
    entry: EntryTarget,
    timeout: number,
    containsText?: string,
): Promise<boolean> {
    const deadline = Date.now() + Math.max(1, timeout);
    for (;;) {
        const slice = Math.max(1, Math.min(DEVICE_RESOLVE_SLICE_MS, deadline - Date.now()));
        let visible = false;
        let element: Element | undefined;
        try {
            element = await entry.probe(slice);
            visible = await element.isVisible();
        } catch (err) {
            if (isFatalDriverError(err)) throw err;
        }
        if (visible && element) {
            if (containsText === undefined) return true;
            const target = element;
            const text = await softRead(() => target.textContent(), null);
            return text !== null && text.includes(containsText);
        }
        const left = deadline - Date.now();
        if (left <= 0) return false;
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(DEVICE_PROBE_INTERVAL_MS, left)));
    }
}
