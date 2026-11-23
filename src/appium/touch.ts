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

/** Finger travel time of a swipe, in ms. */
export const SWIPE_DURATION_MS = 300;
/** How long a screen tap holds the finger down, in ms. */
export const TAP_HOLD_MS = 50;

const move = (p: Point, duration = 0): PointerStep =>
    ({ type: 'pointerMove', duration, x: Math.round(p.x), y: Math.round(p.y), origin: 'viewport' });

/** Finger down at `from`, travel to `to` over `duration` ms, finger up. */
export function swipeSteps(from: Point, to: Point, duration: number = SWIPE_DURATION_MS): PointerStep[] {
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
export async function windowSize(driver: AppiumDriver): Promise<{ width: number; height: number }> {
    const { width, height } = await driver.getWindowSize();
    return { width, height };
}

/**
 * End point of a finger moving `distance` px from `from` in `direction`,
 * clamped to stay inside the window.
 */
export function travel(from: Point, direction: Direction, distance: number, win: { width: number; height: number }): Point {
    const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max - 1);
    switch (direction) {
        case 'up': return { x: from.x, y: clamp(from.y - distance, win.height) };
        case 'down': return { x: from.x, y: clamp(from.y + distance, win.height) };
        case 'left': return { x: clamp(from.x - distance, win.width), y: from.y };
        case 'right': return { x: clamp(from.x + distance, win.width), y: from.y };
    }
}
