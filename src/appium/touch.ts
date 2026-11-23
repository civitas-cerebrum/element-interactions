import type { AppiumDriver } from './platform/PlatformStrategy';
import type { Direction } from '../interfaces/IGestures';

/** One step of a W3C pointer action sequence. */
export type PointerStep =
    | { type: 'pointerMove'; duration: number; x: number; y: number; origin: 'viewport' }
    | { type: 'pointerDown'; button: 0 }
    | { type: 'pointerUp'; button: 0 }
    | { type: 'pause'; duration: number };

/** A point in native-context viewport coordinates. */
export interface Point { x: number; y: number }

/** A window size in native-context viewport coordinates. */
export interface WindowSize { width: number; height: number }

/**
 * Finger hold after `pointerDown` before a swipe moves, in ms: long enough
 * that the press registers as a drag start rather than a flick, far below a
 * long press. The same value as element-repository's
 * `PlatformElement.SWIPE_HOLD_MS`.
 */
export const SWIPE_HOLD_MS = 100;
/**
 * Duration of a swipe's travel from start to end point, in ms: slow enough
 * that the content follows the finger without a fling. The same value as
 * element-repository's `PlatformElement.SWIPE_MOVE_MS`.
 */
export const SWIPE_MOVE_MS = 600;
/**
 * The shortest screen swipe, in px. A shorter finger movement stays inside
 * the platforms' touch slop and registers as a tap, not a scroll.
 */
export const MIN_SWIPE_DISTANCE = 10;
/** How long a screen tap holds the finger down, in ms. */
export const TAP_HOLD_MS = 50;

const move = (p: Point, duration = 0): PointerStep =>
    ({ type: 'pointerMove', duration, x: Math.round(p.x), y: Math.round(p.y), origin: 'viewport' });

/**
 * One-finger swipe, the shape element-repository's `PlatformElement`
 * sends for `swipe` / `scrollIntoView` (live-verified on iOS): an instant move
 * to `from`, finger down, a {@link SWIPE_HOLD_MS} hold, a
 * {@link SWIPE_MOVE_MS} move to `to`, finger up.
 */
export function swipeSteps(from: Point, to: Point): PointerStep[] {
    return [
        move(from),
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: SWIPE_HOLD_MS },
        move(to, SWIPE_MOVE_MS),
        { type: 'pointerUp', button: 0 },
    ];
}

/** Finger down at `from`, travel to `to` over `duration` ms without a hold, finger up (an offset drag). */
export function dragSteps(from: Point, to: Point, duration: number): PointerStep[] {
    return [move(from), { type: 'pointerDown', button: 0 }, move(to, duration), { type: 'pointerUp', button: 0 }];
}

/** Finger down at `at`, hold briefly, finger up. */
export function tapSteps(at: Point): PointerStep[] {
    return [move(at), { type: 'pointerDown', button: 0 }, { type: 'pause', duration: TAP_HOLD_MS }, { type: 'pointerUp', button: 0 }];
}

/**
 * Sends touch pointer sequences (one per finger) with the W3C
 * `performActions` command and always releases them afterwards, as
 * element-repository's `PlatformElement` does. A release error never masks
 * the gesture's own error; when the gesture succeeded, it is thrown.
 */
export async function performTouch(driver: AppiumDriver, sources: PointerStep[][]): Promise<void> {
    const actions = sources.map((steps, i) => ({
        type: 'pointer' as const,
        id: `finger${i + 1}`,
        parameters: { pointerType: 'touch' as const },
        actions: steps,
    }));
    let failed = false;
    try {
        await driver.performActions(actions);
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        try {
            await driver.releaseActions();
        } catch (releaseError) {
            if (!failed) throw releaseError;
        }
    }
}

/** The window size in native-context viewport coordinates. */
export async function windowSize(driver: AppiumDriver): Promise<WindowSize> {
    const { width, height } = await driver.getWindowSize();
    return { width, height };
}

/** `p` rounded and clamped inside the window (`0 <= x < width`, `0 <= y < height`). */
export function clampToWindow(p: Point, win: WindowSize): Point {
    const clamp = (v: number, size: number) => Math.min(Math.max(Math.round(v), 0), size - 1);
    return { x: clamp(p.x, win.width), y: clamp(p.y, win.height) };
}

/**
 * Sends one swipe from `from` to `to` with {@link swipeSteps} through
 * {@link performTouch}. Both points are rounded and clamped inside the window
 * (element-repository clamps its swipe end point the same way); a swipe that
 * would not move the finger at least {@link MIN_SWIPE_DISTANCE} px after
 * that is refused instead of being sent as a tap.
 */
export async function touchSwipe(driver: AppiumDriver, from: Point, to: Point, win: WindowSize): Promise<void> {
    const start = clampToWindow(from, win);
    const end = clampToWindow(to, win);
    const travelled = Math.hypot(end.x - start.x, end.y - start.y);
    if (travelled < MIN_SWIPE_DISTANCE) {
        throw new Error(
            `swipe: the finger would move only ${Math.round(travelled)} px from (${start.x}, ${start.y}) to (${end.x}, ${end.y}) ` +
            `inside the ${win.width}x${win.height} window; a swipe needs at least ${MIN_SWIPE_DISTANCE} px.`,
        );
    }
    await performTouch(driver, [swipeSteps(start, end)]);
}

/**
 * The share of the window a screen swipe keeps clear on each side (x: left
 * and right, y: top and bottom), chosen per platform by its strategy.
 */
export interface SwipeInset { readonly x: number; readonly y: number }

/**
 * Geometry of a screen swipe: the finger moves `distance` px in `direction`
 * (default half the window along that axis) on the line through the window
 * centre, the swipe centred on that centre and kept inside the safe area (the
 * window minus `inset` on each side). A distance longer than the safe area is
 * shortened to it. Coordinates are integers; the finger travels exactly the
 * (shortened, rounded) distance. A distance that rounds below
 * {@link MIN_SWIPE_DISTANCE} is refused.
 */
export function screenSwipeGeometry(win: WindowSize, direction: Direction, inset: SwipeInset, distance?: number): { from: Point; to: Point } {
    const horizontal = direction === 'left' || direction === 'right';
    const size = horizontal ? win.width : win.height;
    const lo = Math.round(size * (horizontal ? inset.x : inset.y));
    const hi = size - 1 - lo;
    const travel = Math.round(Math.min(distance ?? size / 2, hi - lo));
    if (!(travel >= MIN_SWIPE_DISTANCE)) {
        throw new Error(
            `swipeScreen: a screen swipe must move at least ${MIN_SWIPE_DISTANCE} px ` +
            `(asked ${distance ?? 'the default'} px, ${travel} px fit the ${win.width}x${win.height} window's safe area).`,
        );
    }
    // The low end of the swipe line: centred on the window centre, kept inside [lo, hi].
    const a = Math.min(Math.max(Math.round(size / 2 - travel / 2), lo), hi - travel);
    const b = a + travel;
    // The finger moves toward smaller coordinates for up / left.
    const [start, end] = direction === 'up' || direction === 'left' ? [b, a] : [a, b];
    const cross = Math.round((horizontal ? win.height : win.width) / 2);
    return horizontal
        ? { from: { x: start, y: cross }, to: { x: end, y: cross } }
        : { from: { x: cross, y: start }, to: { x: cross, y: end } };
}

/**
 * A screen swipe with W3C touch actions over the strategy's safe area
 * ({@link screenSwipeGeometry}), sent through {@link touchSwipe}. Every
 * Appium-family strategy's `swipeScreen` calls this; the strategy only
 * chooses `inset`.
 */
export async function swipeScreenW3C(driver: AppiumDriver, direction: Direction, inset: SwipeInset, distance?: number): Promise<void> {
    const win = await windowSize(driver);
    const { from, to } = screenSwipeGeometry(win, direction, inset, distance);
    await touchSwipe(driver, from, to, win);
}
