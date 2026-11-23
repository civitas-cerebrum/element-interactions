import { familyOf, type Platform } from '@civitas-cerebrum/element-repository';
import type { PlatformStrategy } from './PlatformStrategy';
import { androidStrategy } from './android';
import { iosStrategy } from './ios';
import { macosStrategy } from './macos';
import { windowsStrategy } from './windows';

export type { PlatformStrategy, AppiumDriver } from './PlatformStrategy';
export { APP_STATE_FOREGROUND } from './PlatformStrategy';
export { androidStrategy } from './android';
export { iosStrategy } from './ios';
export { macosStrategy } from './macos';
export { windowsStrategy } from './windows';
export { notImplementedError } from './notImplemented';

const STRATEGIES: Record<Exclude<Platform, 'web'>, PlatformStrategy> = {
    android: androidStrategy,
    ios: iosStrategy,
    macos: macosStrategy,
    windows: windowsStrategy,
};

/**
 * The platform strategy for an Appium-family platform. Throws for `web`
 * (Playwright family) and for any value that is not a platform.
 */
export function strategyFor(platform: Platform): PlatformStrategy {
    if (familyOf(platform) !== 'appium') {
        throw new Error(`Platform "${platform}" is not in the Appium family; it has no Appium platform strategy.`);
    }
    return STRATEGIES[platform as Exclude<Platform, 'web'>];
}

/**
 * The app under test named in a capabilities object (CONTRACT B1): the
 * platform's key (`appium:bundleId` on ios / macos, `appium:appPackage` on
 * android, `appium:app` on windows). The unprefixed form that Appium echoes
 * back in a session's capabilities is accepted too. `undefined` when absent.
 */
export function appIdFromCapabilities(platform: Platform, capabilities: Record<string, unknown> | undefined): string | undefined {
    if (!capabilities) return undefined;
    const key = strategyFor(platform).appIdCapability;
    const value = capabilities[key] ?? capabilities[key.replace(/^appium:/, '')];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
