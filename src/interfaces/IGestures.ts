import type {
    Element,
    LongPressOptions,
    PinchOptions,
    ScrollIntoViewOptions,
    SwipeDirection,
    SwipeOptions,
    TapAtOptions,
    TapOffset,
    ZoomOptions,
} from '@civitas-cerebrum/element-repository';

// The direction and option types of the gestures are element-repository's,
// so the element primitives and the steps share one vocabulary.
export type {
    LongPressOptions,
    PinchOptions,
    ScrollIntoViewOptions,
    SwipeDirection,
    SwipeOptions,
    TapAtOptions,
    TapOffset,
    ZoomOptions,
} from '@civitas-cerebrum/element-repository';

/**
 * A gesture or scroll direction: `'up' | 'down' | 'left' | 'right'`. An alias
 * of element-repository's `SwipeDirection`, kept under this name because the
 * package has exported `Direction` since the platform steps were introduced.
 */
export type Direction = SwipeDirection;

/**
 * Options of a screen swipe: element-repository's `SwipeOptions` without the
 * element wait, since a screen swipe has no element. `distance` is the finger
 * travel in px; half the screen along that axis when omitted.
 */
export type ScreenSwipeOptions = Pick<SwipeOptions, 'distance'>;

/**
 * Options of the scroll steps (`steps.scrollIntoView`, `steps.scrollUntilFound`
 * and the fluent `.scrollIntoView()` / `.scrollUntilFound()`):
 * element-repository's `ScrollIntoViewOptions` with `container` given as an
 * element NAME on the same page instead of an `Element`.
 *
 * `container` names the scrollable ancestor of the target (a carousel, a
 * horizontal list). The step resolves it through the repository, so it
 * follows the active platform's entry, and hands the element to
 * `Element.scrollIntoView({ container })`: on a device the sweep then swipes
 * inside the container's rect (a paging-safe drag) instead of across the
 * window, which a carousel that does not cross the window centre needs. A
 * name the page does not define fails before anything is sent, naming the
 * container. On web the browser scrolls the target into view itself and
 * Playwright ignores the container (it is still resolved, so a misspelt name
 * fails there too).
 */
export type ScrollStepOptions = Omit<ScrollIntoViewOptions, 'container'> & {
    /** The element name (on the target's page) of the scrollable ancestor to sweep inside. */
    container?: string;
};

/**
 * Touch and scroll gestures: the full contract every driver family implements.
 *
 * Element-level gestures delegate to element-repository's `Element`
 * primitives (`swipe`, `scrollIntoView`, `longPress`, `tapAt`, `pinch`,
 * `zoom`) and resolve to the element, as those primitives do; this layer adds
 * only composition and waiting. Screen-level gestures (`swipeScreen`,
 * `tapAt`) act on the device screen, have no element and resolve to nothing.
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
    swipe(element: Element, direction: SwipeDirection, options?: SwipeOptions): Promise<Element>;
    /**
     * Swipes across the screen: the finger moves in `direction` through the screen centre; `distance` in px,
     * platform default when omitted (at least 10 px). Device platforms only.
     */
    swipeScreen(direction: SwipeDirection, options?: ScreenSwipeOptions): Promise<void>;
    /**
     * Scrolls the element into view; `direction`: where the target lies relative to the view (device
     * platforms); `maxSwipes`: the most swipes a device sweep makes (default 20).
     */
    scrollIntoView(element: Element, options?: ScrollIntoViewOptions): Promise<Element>;
    /**
     * Scrolls until the element is displayed, then resolves; throws when `timeout` (ms) expires or the swipe
     * limit (`maxSwipes`, default 20) is reached first. `direction`: where the target lies relative to the
     * view. On a device it is element-repository's `scrollIntoView` with the timeout always given, so the
     * sweep is bounded by time as well as by swipes: no new swipe starts after the deadline, so the call may
     * run up to one swipe longer (the first gesture of a fresh iOS session can take tens of seconds).
     */
    scrollUntilFound(element: Element, options?: ScrollIntoViewOptions): Promise<Element>;
    /**
     * Scrolls so the element sits in the middle of the viewport / screen. On a device, `timeout` bounds when a
     * new swipe may start: a swipe in flight always finishes and the element is re-read after it, so the call
     * may run up to one swipe longer (the first gesture of a fresh iOS session can take tens of seconds).
     */
    centerElement(element: Element, options?: { timeout?: number }): Promise<Element>;
    /** Presses and holds the element; `duration` in ms (default 1000). */
    longPress(element: Element, options?: LongPressOptions): Promise<Element>;
    /** Taps at screen coordinates (px). Device platforms only. */
    tapAt(x: number, y: number): Promise<void>;
    /** Taps at `offset` px from the element's top-left corner (on web a mouse click at that point). */
    tapAtElement(element: Element, offset: TapOffset, options?: TapAtOptions): Promise<Element>;
    /** Two-finger pinch on the element; `scale` in (0,1), default 0.5. Device platforms only. */
    pinch(element: Element, options?: PinchOptions): Promise<Element>;
    /** Two-finger zoom (spread) on the element; `scale` > 1, default 2. Device platforms only. */
    zoom(element: Element, options?: ZoomOptions): Promise<Element>;
}
