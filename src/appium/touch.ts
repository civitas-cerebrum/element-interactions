import { performTouchActions, performTouchSwipe, touchPointers } from '@civitas-cerebrum/element-repository';
import type { SwipeDirection, TouchPoint } from '@civitas-cerebrum/element-repository';
import type { AppiumDriver } from './platform/PlatformStrategy';

/**
 * Screen-level touch gestures of the Appium family. The W3C action sequences
 * of a swipe, their timings and the always-release rule are
 * element-repository's (`performTouchSwipe`, `performTouchActions`,
 * `touchPointers`); this module adds only what element-repository does not
 * own: the window geometry of a screen swipe (the safe-area inset each
 * platform strategy chooses), the screen tap (composed with the same
 * helpers) and the offset drag (a `performTouchSwipe` with no hold).
 */

/** A point in native-context viewport coordinates. */
export type Point = TouchPoint;

/** A window size in native-context viewport coordinates. */
export interface WindowSize { width: number; height: number }

/**
 * The shortest screen swipe, in px. A shorter finger movement stays inside
 * the platforms' touch slop and registers as a tap, not a scroll.
 */
export const MIN_SWIPE_DISTANCE = 10;
/**
 * How long a screen tap holds the finger down, in ms: the hold of
 * element-repository's `PlatformElement.tapAt`, which keeps that value
 * private; a unit test fails if the two drift apart.
 */
export const TAP_HOLD_MS = 50;

/**
 * Taps the screen at `at` (rounded): finger down, a {@link TAP_HOLD_MS} hold,
 * finger up, the action sequence of `PlatformElement.tapAt`; the actions are
 * always released.
 */
export async function touchTap(driver: AppiumDriver, at: Point): Promise<void> {
    await performTouchActions(driver, touchPointers([[
        { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(at.x), y: Math.round(at.y) },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: TAP_HOLD_MS },
        { type: 'pointerUp', button: 0 },
    ]]));
}

/**
 * Drags one finger from `from` to `to` over `duration` ms with no hold first
 * (an offset drag, unlike a swipe's press-and-hold start): element-repository's
 * `performTouchSwipe` with a zero hold, so the actions are always released.
 */
export async function touchDrag(driver: AppiumDriver, from: Point, to: Point, duration: number): Promise<void> {
    await performTouchSwipe(driver, from, to, { holdMs: 0, moveMs: duration });
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
 * Sends one swipe from `from` to `to` with element-repository's
 * `performTouchSwipe` (the action sequence and timings of
 * `PlatformElement.swipe` / `scrollIntoView`, actions always released). Both
 * points are rounded and clamped inside the window (element-repository clamps
 * its swipe end point the same way); a swipe that would not move the finger
 * at least {@link MIN_SWIPE_DISTANCE} px after that is refused instead of
 * being sent as a tap.
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
    await performTouchSwipe(driver, start, end);
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
export function screenSwipeGeometry(win: WindowSize, direction: SwipeDirection, inset: SwipeInset, distance?: number): { from: Point; to: Point } {
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
export async function swipeScreenW3C(driver: AppiumDriver, direction: SwipeDirection, inset: SwipeInset, distance?: number): Promise<void> {
    const win = await windowSize(driver);
    const { from, to } = screenSwipeGeometry(win, direction, inset, distance);
    await touchSwipe(driver, from, to, win);
}
