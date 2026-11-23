import { isWeb, PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';
import type { Element, WebElement } from '@civitas-cerebrum/element-repository';
import type { Direction, IGestures } from '../interfaces/IGestures';

/**
 * Gestures for the Playwright family (`web`). Element-level gestures delegate
 * to the element's own primitives (`swipe`, `scrollIntoView`, `longPress`,
 * `tapAt`, `pinch`, `zoom`); a web element's `pinch` / `zoom` throw
 * `PlatformNotSupportedError` from element-repository. The screen-level
 * gestures (`swipeScreen`, `tapAt`) have no element and throw
 * `PlatformNotSupportedError(method, 'web')` here.
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

    /** Web elements only: centres the element in the viewport. Throws for any other element kind. */
    async centerElement(element: Element, options?: { timeout?: number }): Promise<void> {
        if (!isWeb(element)) {
            throw new Error(
                'PlaywrightGestures.centerElement needs a web (Playwright) element; ' +
                'the element given is a platform (Appium) element. Use the Appium family for device elements.',
            );
        }
        const timeout = options?.timeout ?? this.timeout;
        await element.scrollIntoView({ timeout });
        // `isWeb` is a plain boolean check in element-repository, not a type guard.
        await (element as WebElement).locator.evaluate(
            (node) => node.scrollIntoView({ block: 'center', inline: 'center' }),
            undefined,
            { timeout },
        );
    }

    async longPress(element: Element, options?: { duration?: number; timeout?: number }): Promise<void> {
        await element.longPress({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    async tapAt(_x: number, _y: number): Promise<void> {
        throw new PlatformNotSupportedError('tapAt', 'web');
    }

    async tapAtElement(element: Element, offset: { x: number; y: number }, options?: { timeout?: number }): Promise<void> {
        await element.tapAt(offset, { ...options, timeout: options?.timeout ?? this.timeout });
    }

    /** Delegates to `Element.pinch`; a web element throws `PlatformNotSupportedError('pinch', 'web')`. */
    async pinch(element: Element, options?: { scale?: number; timeout?: number }): Promise<void> {
        await element.pinch({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    /** Delegates to `Element.zoom`; a web element throws `PlatformNotSupportedError('zoom', 'web')`. */
    async zoom(element: Element, options?: { scale?: number; timeout?: number }): Promise<void> {
        await element.zoom({ ...options, timeout: options?.timeout ?? this.timeout });
    }
}
