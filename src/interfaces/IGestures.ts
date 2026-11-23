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
 * The Playwright family (`web`) delegates every element-level gesture to the
 * element primitive (`scrollIntoView`, `scrollUntilFound`, `swipe`,
 * `longPress`, `tapAtElement`, `pinch`, `zoom`; a web element's `pinch` /
 * `zoom` throw `PlatformNotSupportedError` in element-repository), centres web
 * elements with `centerElement` (any other element kind throws), and throws
 * `PlatformNotSupportedError(method, 'web')` for the screen-level
 * `swipeScreen` and `tapAt`.
 */
export interface IGestures {
    /** Swipes on the element: the finger moves in `direction`; `distance` in px, platform default when omitted. */
    swipe(element: Element, direction: Direction, options?: { distance?: number; timeout?: number }): Promise<void>;
    /**
     * Swipes across the screen: the finger moves in `direction` through the screen centre; `distance` in px,
     * platform default when omitted (at least 10 px). Device platforms only.
     */
    swipeScreen(direction: Direction, options?: { distance?: number }): Promise<void>;
    /** Scrolls the element into view; `direction`: where the target lies relative to the view (device platforms). */
    scrollIntoView(element: Element, options?: { direction?: Direction; timeout?: number }): Promise<void>;
    /**
     * Scrolls until the element is displayed or `timeout` (ms) expires, then throws; `direction`: where the
     * target lies relative to the view.
     */
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
