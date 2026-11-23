import type { Platform } from '@civitas-cerebrum/element-repository';
import type { PlatformStrategy } from './PlatformStrategy';

/** The error every operation of a declared-but-unimplemented platform throws. */
export function notImplementedError(platform: Platform): Error {
    return new Error(`Platform "${platform}" is declared but not implemented yet.`);
}

/** The strategy methods, each of which throws for a declared-but-unimplemented platform. */
export const STRATEGY_METHODS = [
    'readText',
    'launchApp', 'activateApp', 'terminateApp', 'resetApp', 'backgroundApp', 'installApp', 'removeApp',
    'isAppInForeground', 'openDeepLink', 'pressBack', 'hideKeyboard', 'isKeyboardShown', 'swipeScreen',
    'acceptAlert', 'dismissAlert', 'setPermission',
] as const satisfies readonly (keyof PlatformStrategy)[];

/**
 * A strategy for a platform that is part of the vocabulary but has no
 * implementation yet (`macos`, `windows`). Its descriptive fields are real;
 * every method throws `Platform "<p>" is declared but not implemented yet.`
 * The returned object is frozen.
 */
export function notImplementedStrategy(platform: Platform, appIdCapability: string): PlatformStrategy {
    const fail = async (): Promise<never> => { throw notImplementedError(platform); };
    const methods = Object.fromEntries(STRATEGY_METHODS.map(name => [name, fail])) as
        Record<(typeof STRATEGY_METHODS)[number], () => Promise<never>>;
    return Object.freeze({
        platform,
        implemented: false,
        appIdCapability,
        focusedAttribute: null,
        unsupported: Object.freeze([]) as readonly string[],
        ...methods,
    });
}
