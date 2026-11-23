import type { Element, WebElement } from '@civitas-cerebrum/element-repository';
import type { Direction, IGestures } from '../interfaces/IGestures';
import { PlatformNotSupportedError } from '../compat/elementRepository';

/**
 * Calls an element primitive that element-repository 0.4.0 adds to `Element`
 * (`longPress`, `tapAt`). With an older element-repository the primitive is
 * missing, and the gesture fails naming it; it is never re-implemented here.
 */
function primitive<K extends string>(element: Element, name: K): (...args: unknown[]) => Promise<unknown> {
    const fn = (element as unknown as Record<string, unknown>)[name];
    if (typeof fn !== 'function') {
        throw new Error(
            `Element primitive "${name}" is not available in the installed @civitas-cerebrum/element-repository ` +
            `(it is added in 0.4.0). Upgrade element-repository to use this gesture.`,
        );
    }
    return (fn as (...args: unknown[]) => Promise<unknown>).bind(element);
}

/**
 * Gestures for the Playwright family (`web`). Implements what has a browser
 * meaning by delegating to the element's own primitives, and throws
 * `PlatformNotSupportedError(method, 'web')` for screen-level and
 * multi-touch gestures.
 */
export class PlaywrightGestures implements IGestures {
    constructor(private readonly timeout: number = 30000) {}

    async swipe(element: Element, direction: Direction, options?: { distance?: number; timeout?: number }): Promise<void> {
        await element.swipe(direction, { ...options, timeout: options?.timeout ?? this.timeout });
    }

    async swipeScreen(_direction: Direction, _options?: { distance?: number }): Promise<void> {
        throw new PlatformNotSupportedError('swipeScreen', 'web');
    }

    /** The browser scrolls whichever way is needed; `direction` is accepted for symmetry. */
    async scrollIntoView(element: Element, options?: { direction?: Direction; timeout?: number }): Promise<void> {
        await element.scrollIntoView({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    /**
     * In a browser the element is reachable without stepwise scrolling, so this
     * is `scrollIntoView` bounded by `timeout`; it throws if the element never
     * attaches.
     */
    async scrollUntilFound(element: Element, options?: { direction?: Direction; timeout?: number }): Promise<void> {
        await element.scrollIntoView({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    async centerElement(element: Element, options?: { timeout?: number }): Promise<void> {
        const timeout = options?.timeout ?? this.timeout;
        await element.scrollIntoView({ timeout });
        await (element as WebElement).locator.evaluate(
            (node) => node.scrollIntoView({ block: 'center', inline: 'center' }),
            undefined,
            { timeout },
        );
    }

    async longPress(element: Element, options?: { duration?: number; timeout?: number }): Promise<void> {
        await primitive(element, 'longPress')({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    async tapAt(_x: number, _y: number): Promise<void> {
        throw new PlatformNotSupportedError('tapAt', 'web');
    }

    async tapAtElement(element: Element, offset: { x: number; y: number }, options?: { timeout?: number }): Promise<void> {
        await primitive(element, 'tapAt')(offset, { ...options, timeout: options?.timeout ?? this.timeout });
    }

    async pinch(_element: Element, _options?: { scale?: number; timeout?: number }): Promise<void> {
        throw new PlatformNotSupportedError('pinch', 'web');
    }

    async zoom(_element: Element, _options?: { scale?: number; timeout?: number }): Promise<void> {
        throw new PlatformNotSupportedError('zoom', 'web');
    }
}
