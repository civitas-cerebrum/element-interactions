import { SWIPE_SETTLE_MS } from '@civitas-cerebrum/element-repository';
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
import type { IGestures, ScreenSwipeOptions } from '../interfaces/IGestures';
import type { AppiumDriver, PlatformStrategy } from './platform/PlatformStrategy';
import { notImplementedError } from './platform/notImplemented';
import { MIN_SWIPE_DISTANCE, touchTap, windowSize, type Point } from './touch';

/**
 * Touch gestures for the Appium family.
 *
 * Element-level gestures delegate to element-repository's primitives
 * (`swipe`, `scrollIntoView`, `longPress`, `tapAt`, `pinch`, `zoom`) with the
 * timeout filled in, and resolve to the element. `scrollUntilFound` is
 * `scrollIntoView` with the timeout always given, so its sweep is bounded by
 * time as well as by its swipe limit. Screen swipes (`swipeScreen` and the
 * steps of `centerElement`) go through the platform strategy's
 * `swipeScreen`, which sends element-repository's own touch swipe
 * (`performTouchSwipe`) on every Appium platform; the strategy only picks
 * the safe area. `tapAt(x, y)` is a W3C touch tap built with
 * element-repository's `touchPointers` / `performTouchActions`.
 *
 * Direction meanings follow element-repository: in `swipe` / `swipeScreen`
 * `direction` is where the finger moves (`'up'` reveals content below); in
 * `scrollIntoView` / `scrollUntilFound` it is where the target lies (`'down'`
 * swipes the finger up).
 */
export class AppiumGestures implements IGestures {
    /** A centred element may sit this many px off the screen centre. */
    static readonly CENTERING_TOLERANCE = 50;
    /** Below this movement (px) between two corrections the container is taken as stuck. */
    static readonly STALE_POSITION_THRESHOLD = 5;
    /** Pause after a swipe so the content settles before the next read, in ms (element-repository's `SWIPE_SETTLE_MS`). */
    static readonly SETTLE_MS = SWIPE_SETTLE_MS;

    constructor(
        private readonly driver: AppiumDriver,
        private readonly strategy: PlatformStrategy,
        private readonly timeout: number = 30000,
    ) {}

    private requireImplemented(): void {
        if (!this.strategy.implemented) throw notImplementedError(this.strategy.platform);
    }

    private async settle(): Promise<void> {
        await new Promise<void>(resolve => setTimeout(resolve, AppiumGestures.SETTLE_MS));
    }

    async swipe(element: Element, direction: SwipeDirection, options?: SwipeOptions): Promise<Element> {
        this.requireImplemented();
        return element.swipe(direction, { ...options, timeout: options?.timeout ?? this.timeout });
    }

    /**
     * Swipes across the screen: the finger moves in `direction` through the
     * screen centre, `distance` px (default half the window along that axis),
     * shortened to the platform's safe area (the window minus the system
     * gesture zones). A `distance` below {@link MIN_SWIPE_DISTANCE} px (it
     * would register as a tap) or not a finite number is refused. Like
     * `centerElement`, it pauses {@link SETTLE_MS} after the swipe so the next
     * read sees settled content.
     */
    async swipeScreen(direction: SwipeDirection, options?: ScreenSwipeOptions): Promise<void> {
        this.requireImplemented();
        const distance = options?.distance;
        if (distance !== undefined && !(Number.isFinite(distance) && distance >= MIN_SWIPE_DISTANCE)) {
            throw new Error(`swipeScreen: distance must be a number of px of at least ${MIN_SWIPE_DISTANCE} (a shorter swipe registers as a tap), got ${distance}`);
        }
        await this.strategy.swipeScreen(this.driver, direction, distance);
        await this.settle();
    }

    /**
     * `direction` names where the element lies relative to the current view
     * (default `'down'`). The timeout (`options.timeout`, else the instance
     * timeout) is always passed, so the sweep stops at whichever comes first:
     * the timeout or `maxSwipes` swipes (default 20).
     */
    async scrollIntoView(element: Element, options?: ScrollIntoViewOptions): Promise<Element> {
        this.requireImplemented();
        return element.scrollIntoView({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    /**
     * Sweeps toward `direction` (where the element lies; default `'down'`)
     * until the element is displayed: element-repository's
     * `scrollIntoView({ direction, timeout, maxSwipes })` with the timeout
     * (`options.timeout`, else the instance timeout) always given. Throws when
     * the timeout expires or `maxSwipes` swipes (default 20) were made first.
     *
     * The timeout bounds when a new swipe may START: a swipe in flight always
     * finishes, so the call may run up to one swipe longer than the timeout
     * (the first gesture of a fresh iOS session can take tens of seconds).
     */
    async scrollUntilFound(element: Element, options?: ScrollIntoViewOptions): Promise<Element> {
        this.requireImplemented();
        return element.scrollIntoView({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    /**
     * Scrolls vertically until the element's centre is within
     * {@link CENTERING_TOLERANCE} px of the screen centre (vertically): one
     * swipe per step, at most a third of the screen each, through the
     * platform's screen swipe, re-reading the element's bounds from its
     * `boundingBox` primitive. Stops when centred, when the content no longer
     * moves (scroll boundary or non-scrollable container), or when `timeout`
     * expires. Exact centring is best effort, but whichever way it stops the
     * element must be on screen (its centre inside the window, both axes):
     * otherwise it throws, as it does for an element without bounds.
     *
     * `timeout` bounds when a new swipe may START: a swipe in flight always
     * finishes and the element is re-read after it, so the call may run up to
     * one swipe longer than `timeout` (the first gesture of a fresh iOS
     * session can take tens of seconds).
     */
    async centerElement(element: Element, options?: { timeout?: number }): Promise<Element> {
        this.requireImplemented();
        const timeout = options?.timeout ?? this.timeout;
        const deadline = Date.now() + timeout;
        const win = await windowSize(this.driver);
        const centre: Point = { x: win.width / 2, y: win.height / 2 };
        const maxStep = win.height / 3;
        let previous = Number.POSITIVE_INFINITY;
        let swipes = 0;
        for (;;) {
            const box = await element.boundingBox();
            if (!box) throw new Error('centerElement: the element has no bounds (is it in the UI tree?).');
            const mid: Point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
            const offset = mid.y - centre.y;
            const centred = Math.abs(offset) <= AppiumGestures.CENTERING_TOLERANCE;
            const stuck = Math.abs(offset - previous) < AppiumGestures.STALE_POSITION_THRESHOLD;
            if (centred || stuck || Date.now() >= deadline) {
                // Every way out requires the element's centre inside the window,
                // including a vertically centred element that is off screen sideways.
                if (mid.x >= 0 && mid.x < win.width && mid.y >= 0 && mid.y < win.height) return element;
                const reason = centred
                    ? 'it is vertically centred, but this scrolls only vertically'
                    : stuck ? 'the content stopped moving' : `timed out after ${timeout} ms`;
                throw new Error(
                    `centerElement: element${element.selector ? ` "${element.selector}"` : ''} is not on screen ` +
                    `(centre at (${Math.round(mid.x)}, ${Math.round(mid.y)}) outside the ${win.width}x${win.height} window) ` +
                    `after ${swipes} swipe(s): ${reason}.`,
                );
            }
            previous = offset;
            // Element below the centre (offset > 0): the finger moves up by the offset.
            const distance = Math.min(Math.abs(offset), maxStep);
            await this.strategy.swipeScreen(this.driver, offset > 0 ? 'up' : 'down', distance);
            swipes++;
            await this.settle();
        }
    }

    async longPress(element: Element, options?: LongPressOptions): Promise<Element> {
        this.requireImplemented();
        return element.longPress({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    /** Taps the screen at (`x`, `y`) in native-context viewport coordinates. */
    async tapAt(x: number, y: number): Promise<void> {
        this.requireImplemented();
        const win = await windowSize(this.driver);
        if (!(x >= 0 && x < win.width && y >= 0 && y < win.height)) {
            throw new Error(`tapAt: point (${x}, ${y}) is outside the ${win.width}x${win.height} window.`);
        }
        await touchTap(this.driver, { x, y });
    }

    async tapAtElement(element: Element, offset: TapOffset, options?: TapAtOptions): Promise<Element> {
        this.requireImplemented();
        return element.tapAt(offset, { ...options, timeout: options?.timeout ?? this.timeout });
    }

    async pinch(element: Element, options?: PinchOptions): Promise<Element> {
        this.requireImplemented();
        return element.pinch({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    async zoom(element: Element, options?: ZoomOptions): Promise<Element> {
        this.requireImplemented();
        return element.zoom({ ...options, timeout: options?.timeout ?? this.timeout });
    }
}
