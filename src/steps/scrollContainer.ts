import type { ElementRepository, ScrollIntoViewOptions } from '@civitas-cerebrum/element-repository';
import type { ScrollStepOptions } from '../interfaces/IGestures';

/**
 * Turns the scroll steps' options into element-repository's
 * `ScrollIntoViewOptions`: a `container` element name is resolved on
 * `pageName` through the repository (the active platform's entry) and passed
 * on as the container `Element`. The other options are copied as given,
 * `undefined` values left out (`undefined` when none is left), so a step
 * without a container sends exactly what it sent before.
 *
 * A container the page does not define fails here, before the scroll starts:
 * `<step>: container "<name>" on page "<page>" could not be resolved: <cause>`.
 */
export async function toScrollIntoViewOptions(
    repo: ElementRepository,
    step: string,
    pageName: string,
    options: ScrollStepOptions | undefined,
    timeout: number | undefined,
): Promise<ScrollIntoViewOptions | undefined> {
    const out: ScrollIntoViewOptions = {};
    if (options?.direction !== undefined) out.direction = options.direction;
    if (options?.maxSwipes !== undefined) out.maxSwipes = options.maxSwipes;
    if (options?.container !== undefined) {
        const name = options.container;
        try {
            out.container = await repo.get(name, pageName);
        } catch (err) {
            const cause = err instanceof Error ? err.message : String(err);
            throw new Error(`${step}: container "${name}" on page "${pageName}" could not be resolved: ${cause}`, { cause: err });
        }
    }
    if (timeout !== undefined) out.timeout = timeout;
    return Object.keys(out).length > 0 ? out : undefined;
}
