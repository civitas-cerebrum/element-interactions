import type { Element } from '@civitas-cerebrum/element-repository';

/** A gesture or scroll direction. */
export type Direction = 'up' | 'down' | 'left' | 'right';

// The gesture option types, kept in this one place.

/** Options of an element swipe. */
export interface SwipeOptions {
    /** Finger travel in px; the platform default when omitted. */
    distance?: number;
    /** Timeout in ms for the element to be ready. */
    timeout?: number;
}

/** Options of a screen swipe. */
export interface ScreenSwipeOptions {
    /** Finger travel in px; half the screen along that axis when omitted. */
    distance?: number;
}

/** Options of `scrollIntoView` and `scrollUntilFound`. */
export interface ScrollIntoViewOptions {
    /** Where the element lies relative to the current view on a device (default `'down'`). */
    direction?: Direction;
    /** Timeout in ms. */
    timeout?: number;
}

/** Options of a long press. */
export interface LongPressOptions {
    /** Hold time in ms (default 1000). */
    duration?: number;
    /** Timeout in ms for the element to be ready. */
    timeout?: number;
}

/** Options of a two-finger pinch or zoom. */
export interface PinchOptions {
    /** Pinch: in (0, 1), default 0.5. Zoom: above 1, default 2. */
    scale?: number;
    /** Timeout in ms for the element to be ready. */
    timeout?: number;
}

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
    swipe(element: Element, direction: Direction, options?: SwipeOptions): Promise<void>;
    /**
     * Swipes across the screen: the finger moves in `direction` through the screen centre; `distance` in px,
     * platform default when omitted (at least 10 px). Device platforms only.
     */
    swipeScreen(direction: Direction, options?: ScreenSwipeOptions): Promise<void>;
    /** Scrolls the element into view; `direction`: where the target lies relative to the view (device platforms). */
    scrollIntoView(element: Element, options?: ScrollIntoViewOptions): Promise<void>;
    /**
     * Scrolls until the element is displayed or `timeout` (ms) expires, then throws; `direction`: where the
     * target lies relative to the view. On a device, `timeout` bounds when a new swipe may start: a swipe in
     * flight always finishes and the element is re-read after it, so the call may run up to one swipe longer
     * (the first gesture of a fresh iOS session can take tens of seconds).
     */
    scrollUntilFound(element: Element, options?: ScrollIntoViewOptions): Promise<void>;
    /**
     * Scrolls so the element sits in the middle of the viewport / screen. On a device, `timeout` bounds when a
     * new swipe may start: a swipe in flight always finishes and the element is re-read after it, so the call
     * may run up to one swipe longer (the first gesture of a fresh iOS session can take tens of seconds).
     */
    centerElement(element: Element, options?: { timeout?: number }): Promise<void>;
    /** Presses and holds the element; `duration` in ms (default 1000). */
    longPress(element: Element, options?: LongPressOptions): Promise<void>;
    /** Taps at screen coordinates (px). Device platforms only. */
    tapAt(x: number, y: number): Promise<void>;
    /** Taps at `offset` px from the element's top-left corner. */
    tapAtElement(element: Element, offset: { x: number; y: number }, options?: { timeout?: number }): Promise<void>;
    /** Two-finger pinch on the element; `scale` in (0,1), default 0.5. Device platforms only. */
    pinch(element: Element, options?: PinchOptions): Promise<void>;
    /** Two-finger zoom (spread) on the element; `scale` > 1, default 2. Device platforms only. */
    zoom(element: Element, options?: PinchOptions): Promise<void>;
}
