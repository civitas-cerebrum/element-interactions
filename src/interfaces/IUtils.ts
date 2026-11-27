import type { Element } from '@civitas-cerebrum/element-repository';

/** Element waiting and pacing helpers: the full contract every driver family implements. */
export interface IUtils {
    /** The default timeout (ms) this instance applies. */
    getTimeout(): number;
    /** Best-effort, short wait for a state; never throws. */
    softProbe(element: Element, state?: 'visible' | 'attached', timeout?: number): Promise<void>;
    /** Waits for a state; throws on timeout unless `optional`, then resolves `false`. */
    waitForState(
        element: Element,
        state?: 'visible' | 'attached' | 'hidden' | 'detached',
        timeout?: number,
        optional?: boolean,
    ): Promise<boolean>;
    pace(ms: number): Promise<void>;
    repeat<T>(fn: (index: number) => Promise<T> | T, times: number, options?: { intervalMs?: number }): Promise<T[]>;
}
