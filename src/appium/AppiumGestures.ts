import type { Element } from '@civitas-cerebrum/element-repository';
import type { Direction, IGestures } from '../interfaces/IGestures';
import type { AppiumDriver, PlatformStrategy } from './platform/PlatformStrategy';
import { notImplementedError } from './platform/notImplemented';
import { performTouch, swipeSteps, tapSteps, travel, windowSize, type Point } from './touch';

/** The finger direction that reveals content lying in `direction` (content below -> finger moves up). */
const REVEAL: Record<Direction, Direction> = { down: 'up', up: 'down', right: 'left', left: 'right' };

/**
 * Touch gestures for the Appium family.
 *
 * Element-level gestures delegate to element-repository's primitives
 * (`swipe`, `scrollIntoView`, `longPress`, `tapAt`, `pinch`, `zoom`) with the
 * timeout filled in. Screen-level gestures with no element (`swipeScreen`,
 * `tapAt(x, y)`) and the compositions `scrollUntilFound` and `centerElement`
 * use W3C pointer actions on the driver.
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
     * Swipes from the screen centre: the finger moves `distance` px in
     * `direction` (default half the screen along that axis), clamped to the window.
     */
    async swipeScreen(direction: Direction, options?: { distance?: number }): Promise<void> {
        this.requireImplemented();
        const win = await windowSize(this.driver);
        const from: Point = { x: win.width / 2, y: win.height / 2 };
        const horizontal = direction === 'left' || direction === 'right';
        const distance = options?.distance ?? (horizontal ? win.width : win.height) / 2;
        if (!Number.isFinite(distance) || distance <= 0) {
            throw new Error(`swipeScreen: distance must be a positive number of px, got ${distance}`);
        }
        await performTouch(this.driver, [swipeSteps(from, travel(from, direction, distance, win))]);
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
     */
    async scrollUntilFound(element: Element, options?: { direction?: Direction; timeout?: number }): Promise<void> {
        this.requireImplemented();
        const direction = options?.direction ?? 'down';
        const timeout = options?.timeout ?? this.timeout;
        const deadline = Date.now() + timeout;
        const win = await windowSize(this.driver);
        const finger = REVEAL[direction];
        const step = (finger === 'left' || finger === 'right' ? win.width : win.height) / 3;
        const centre: Point = { x: win.width / 2, y: win.height / 2 };
        let swipes = 0;
        for (;;) {
            if (await element.isVisible().catch(() => false)) return;
            if (Date.now() >= deadline) break;
            await performTouch(this.driver, [swipeSteps(centre, travel(centre, finger, step, win))]);
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
     * {@link CENTERING_TOLERANCE} px of the screen centre: one swipe per step,
     * at most a third of the screen each, re-reading the element's bounds
     * from its `boundingBox` primitive. Stops when centred, when the content
     * no longer moves (scroll boundary or non-scrollable container), or when
     * `timeout` expires. Best effort: it does not throw when it cannot centre,
     * but an element without bounds throws.
     */
    async centerElement(element: Element, options?: { timeout?: number }): Promise<void> {
        this.requireImplemented();
        const timeout = options?.timeout ?? this.timeout;
        const deadline = Date.now() + timeout;
        const win = await windowSize(this.driver);
        const centre: Point = { x: win.width / 2, y: win.height / 2 };
        const maxStep = win.height / 3;
        let previous = Number.POSITIVE_INFINITY;
        for (;;) {
            const box = await element.boundingBox();
            if (!box) throw new Error('centerElement: the element has no bounds (is it in the UI tree?).');
            const offset = box.y + box.height / 2 - centre.y;
            if (Math.abs(offset) <= AppiumGestures.CENTERING_TOLERANCE) return;
            if (Math.abs(offset - previous) < AppiumGestures.STALE_POSITION_THRESHOLD) return;
            if (Date.now() >= deadline) return;
            previous = offset;
            // Element below the centre (offset > 0): the finger moves up by the offset.
            const distance = Math.min(Math.abs(offset), maxStep);
            await performTouch(this.driver, [swipeSteps(centre, travel(centre, offset > 0 ? 'up' : 'down', distance, win))]);
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
