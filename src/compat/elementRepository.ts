/**
 * Local stand-in for the platform vocabulary and error that
 * `@civitas-cerebrum/element-repository` 0.4.0 owns.
 *
 * DELETE ON INTEGRATION WITH element-repository 0.4.0: replace this whole file
 * with
 *
 *   export type { Platform, DriverFamily } from '@civitas-cerebrum/element-repository';
 *   export { PLATFORMS, isPlatformName, familyOf, PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';
 *
 * Every module in this package imports these names from here, so that swap is
 * the only edit needed, and `instanceof PlatformNotSupportedError` then works
 * across both packages. The shapes below are identical to the repository's.
 */

/** Every platform a test can run on. `web` is the Playwright family; the rest are the Appium family. */
export type Platform = 'web' | 'android' | 'ios' | 'macos' | 'windows';

/** The driver family that runs a platform. */
export type DriverFamily = 'playwright' | 'appium';

/** All platform names, in declaration order. */
export const PLATFORMS: readonly Platform[] = Object.freeze(['web', 'android', 'ios', 'macos', 'windows'] as const);

/** True when `value` is one of {@link PLATFORMS}. */
export function isPlatformName(value: unknown): value is Platform {
    return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

/** `web` runs on Playwright; every other platform runs on Appium. */
export function familyOf(platform: Platform): DriverFamily {
    return platform === 'web' ? 'playwright' : 'appium';
}

/**
 * Thrown when a step or interaction has no meaning on the active platform
 * (a web-only step on a device, a device-only step on web, or a step one
 * device platform cannot perform). Nothing in either family warns and continues
 * instead.
 */
export class PlatformNotSupportedError extends Error {
    readonly method: string;
    readonly platform: Platform;

    constructor(method: string, platform: Platform) {
        super(`"${method}" is not supported on platform "${platform}".`);
        this.name = 'PlatformNotSupportedError';
        this.method = method;
        this.platform = platform;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
