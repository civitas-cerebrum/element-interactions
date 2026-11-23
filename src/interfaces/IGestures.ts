import type { Element } from '@civitas-cerebrum/element-repository';

/** A gesture or scroll direction. */
export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Touch and scroll gestures: the full contract every driver family implements.
 *
 * Element-level gestures delegate to element-repository's `Element`
 * primitives (`swipe`, `scrollIntoView`, `longPress`, `tapAt`, `pinch`,
 * `zoom`); this layer adds only composition and waiting. Screen-level gestures
 * (`swipeScreen`, `tapAt`) act on the device screen and have no element.
 *
 * The Playwright family (`web`) implements what has a browser meaning
 * (`scrollIntoView`, `scrollUntilFound`, `centerElement`, element `swipe`,
 * and `longPress` / `tapAtElement` through the element primitive) and throws
 * `PlatformNotSupportedError(method, 'web')` for `swipeScreen`, `tapAt`,
 * `pinch` and `zoom`.
 */
export interface IGestures {
    /** Swipes on the element in `direction`; `distance` in px (family default when omitted). */
    swipe(element: Element, direction: Direction, options?: { distance?: number; timeout?: number }): Promise<void>;
    /** Swipes across the screen from its centre in `direction`; `distance` in px. Device platforms only. */
    swipeScreen(direction: Direction, options?: { distance?: number }): Promise<void>;
    /** Scrolls the element into view; `direction` is the scroll direction on device platforms. */
    scrollIntoView(element: Element, options?: { direction?: Direction; timeout?: number }): Promise<void>;
    /** Scrolls in `direction` until the element is displayed or `timeout` (ms) expires, then throws. */
    scrollUntilFound(element: Element, options?: { direction?: Direction; timeout?: number }): Promise<void>;
    /** Scrolls so the element sits in the middle of the viewport / screen. */
    centerElement(element: Element, options?: { timeout?: number }): Promise<void>;
    /** Presses and holds the element; `duration` in ms (default 1000). */
    longPress(element: Element, options?: { duration?: number; timeout?: number }): Promise<void>;
    /** Taps at screen coordinates (px). Device platforms only. */
    tapAt(x: number, y: number): Promise<void>;
    /** Taps at `offset` px from the element's top-left corner. */
    tapAtElement(element: Element, offset: { x: number; y: number }, options?: { timeout?: number }): Promise<void>;
    /** Two-finger pinch on the element; `scale` in (0,1), default 0.5. Device platforms only. */
    pinch(element: Element, options?: { scale?: number; timeout?: number }): Promise<void>;
    /** Two-finger zoom (spread) on the element; `scale` > 1, default 2. Device platforms only. */
    zoom(element: Element, options?: { scale?: number; timeout?: number }): Promise<void>;
}
