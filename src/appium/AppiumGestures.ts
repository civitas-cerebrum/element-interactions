import type { Element } from '@civitas-cerebrum/element-repository';
import type { Direction, IGestures } from '../interfaces/IGestures';
import type { AppiumDriver, PlatformStrategy } from './platform/PlatformStrategy';
import { notImplementedError } from './platform/notImplemented';
import { softRead } from '../utils/driverErrors';
import { MIN_SWIPE_DISTANCE, performTouch, tapSteps, windowSize, type Point } from './touch';

/** The finger direction that reveals content lying in `direction` (content below -> finger moves up). */
const REVEAL: Record<Direction, Direction> = { down: 'up', up: 'down', right: 'left', left: 'right' };

/**
 * Touch gestures for the Appium family.
 *
 * Element-level gestures delegate to element-repository's primitives
 * (`swipe`, `scrollIntoView`, `longPress`, `tapAt`, `pinch`, `zoom`) with the
 * timeout filled in. Screen swipes (`swipeScreen` and the steps of the
 * compositions `scrollUntilFound` and `centerElement`) go through the
 * platform strategy's `swipeScreen`, which sends the same explicit W3C touch
 * swipe as element-repository's `PlatformElement.swipe` (finger down, 100 ms
 * hold, 600 ms move, finger up, actions released) on every Appium platform;
 * the strategy only picks the safe area. `tapAt(x, y)` uses a W3C touch
 * pointer action too.
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
    /** Pause after a swipe so the content settles before the next read, in ms. */
    static readonly SETTLE_MS = 200;

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

    async swipe(element: Element, direction: Direction, options?: { distance?: number; timeout?: number }): Promise<void> {
        this.requireImplemented();
        await element.swipe(direction, { ...options, timeout: options?.timeout ?? this.timeout });
    }

    /**
     * Swipes across the screen: the finger moves in `direction` through the
     * screen centre, `distance` px (default half the window along that axis),
     * shortened to the platform's safe area (the window minus the system
     * gesture zones). A `distance` below {@link MIN_SWIPE_DISTANCE} px (it
     * would register as a tap) or not a finite number is refused. Like the
     * compositions, it pauses {@link SETTLE_MS} after the swipe so the next
     * read sees settled content.
     */
    async swipeScreen(direction: Direction, options?: { distance?: number }): Promise<void> {
        this.requireImplemented();
        const distance = options?.distance;
        if (distance !== undefined && !(Number.isFinite(distance) && distance >= MIN_SWIPE_DISTANCE)) {
            throw new Error(`swipeScreen: distance must be a number of px of at least ${MIN_SWIPE_DISTANCE} (a shorter swipe registers as a tap), got ${distance}`);
        }
        await this.strategy.swipeScreen(this.driver, direction, distance);
        await this.settle();
    }

    /** `direction` names where the element lies relative to the current view (default `'down'`). */
    async scrollIntoView(element: Element, options?: { direction?: Direction; timeout?: number }): Promise<void> {
        this.requireImplemented();
        await element.scrollIntoView({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    /**
     * Swipes a third of the screen at a time toward `direction` (where the
     * element lies; default `'down'`) until the element is displayed, re-reading
     * it after every swipe. Throws when `timeout` (ms) expires first.
     *
     * `timeout` bounds when a new swipe may START: a swipe in flight always
     * finishes and the element is re-read after it, so the call may run up to
     * one swipe longer than `timeout` (the first gesture of a fresh iOS
     * session can take tens of seconds).
     */
    async scrollUntilFound(element: Element, options?: { direction?: Direction; timeout?: number }): Promise<void> {
        this.requireImplemented();
        const direction = options?.direction ?? 'down';
        const timeout = options?.timeout ?? this.timeout;
        const deadline = Date.now() + timeout;
        const win = await windowSize(this.driver);
        const finger = REVEAL[direction];
        const step = (finger === 'left' || finger === 'right' ? win.width : win.height) / 3;
        let swipes = 0;
        for (;;) {
            // A transient miss is "not displayed yet"; a fatal driver error
            // (dead session) is thrown instead of swiping on until the timeout.
            if (await softRead(() => element.isVisible(), false)) return;
            if (Date.now() >= deadline) break;
            await this.strategy.swipeScreen(this.driver, finger, step);
            swipes++;
            await this.settle();
        }
        throw new Error(
            `scrollUntilFound: element${element.selector ? ` "${element.selector}"` : ''} not displayed ` +
            `after ${swipes} swipe(s) scrolling ${direction} within ${timeout} ms.`,
        );
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
    async centerElement(element: Element, options?: { timeout?: number }): Promise<void> {
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
                if (mid.x >= 0 && mid.x < win.width && mid.y >= 0 && mid.y < win.height) return;
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

    async longPress(element: Element, options?: { duration?: number; timeout?: number }): Promise<void> {
        this.requireImplemented();
        await element.longPress({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    /** Taps the screen at (`x`, `y`) in native-context viewport coordinates. */
    async tapAt(x: number, y: number): Promise<void> {
        this.requireImplemented();
        const win = await windowSize(this.driver);
        if (!(x >= 0 && x < win.width && y >= 0 && y < win.height)) {
            throw new Error(`tapAt: point (${x}, ${y}) is outside the ${win.width}x${win.height} window.`);
        }
        await performTouch(this.driver, [tapSteps({ x, y })]);
    }

    async tapAtElement(element: Element, offset: { x: number; y: number }, options?: { timeout?: number }): Promise<void> {
        this.requireImplemented();
        await element.tapAt(offset, { ...options, timeout: options?.timeout ?? this.timeout });
    }

    async pinch(element: Element, options?: { scale?: number; timeout?: number }): Promise<void> {
        this.requireImplemented();
        await element.pinch({ ...options, timeout: options?.timeout ?? this.timeout });
    }

    async zoom(element: Element, options?: { scale?: number; timeout?: number }): Promise<void> {
        this.requireImplemented();
        await element.zoom({ ...options, timeout: options?.timeout ?? this.timeout });
    }
}
