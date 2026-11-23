import { familyOf, PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';
import type { Platform } from '@civitas-cerebrum/element-repository';
import type { IExtractions } from '../interfaces/IExtractions';
import type { IGestures } from '../interfaces/IGestures';
import type { IInteractionFactory } from '../interfaces/IInteractionFactory';
import type { IInteractions } from '../interfaces/IInteractions';
import type { IVerifications } from '../interfaces/IVerifications';

/**
 * The family members an {@link ElementAction} chain (and the matcher tree it
 * builds) acts through. The Playwright `ElementInteractions` facade satisfies
 * it as is (no `platform`: web); `Steps` builds it from its
 * `IInteractionFactory`, so every chain carries the factory's platform.
 */
export interface ElementActionFamily {
    readonly interact: IInteractions;
    readonly verify: IVerifications;
    readonly extract: IExtractions;
    /** The gestures behind the chain's gesture terminals (`swipe`, `longPress`, ...). Omitted: they throw. */
    readonly gestures?: IGestures;
    /** The platform these members act on. Omitted means `'web'`. */
    readonly platform?: Platform;
}

/** Builds the members an `ElementAction` needs from a factory (fresh instances, as `ElementInteractions` did). */
export function actionFamilyOf(factory: IInteractionFactory): ElementActionFamily {
    return {
        interact: factory.createInteractions(),
        verify: factory.createVerifications(),
        extract: factory.createExtractions(),
        gestures: factory.createGestures(),
        platform: factory.platform,
    };
}

/**
 * The single web-only guard of the Steps layer: throws
 * `PlatformNotSupportedError(stepName, platform)` unless `platform` belongs to
 * the Playwright family. Called first by every web-only step, before anything
 * is resolved or acted on, so nothing warns-and-continues.
 */
export function requireWebPlatform(stepName: string, platform: Platform): void {
    if (familyOf(platform) !== 'playwright') {
        throw new PlatformNotSupportedError(stepName, platform);
    }
}

/**
 * Throws unless the factory's `family` is the family its `platform` belongs
 * to. `Steps` asserts this once at construction, so its guards (which read
 * `factory.platform` through {@link requireWebPlatform}) and the members the
 * factory builds can never disagree about which family is acting.
 */
export function assertFactoryFamily(factory: IInteractionFactory): void {
    const expected = familyOf(factory.platform);
    if (factory.family !== expected) {
        throw new Error(
            `Steps: the factory reports family "${factory.family}" for platform "${factory.platform}", `
            + `but "${factory.platform}" belongs to the "${expected}" family.`,
        );
    }
}

/**
 * The single platform-only guard of the Steps layer, the mirror of
 * {@link requireWebPlatform}: throws `PlatformNotSupportedError(stepName,
 * platform)` when `platform` belongs to the Playwright family (`web`). Called
 * first by every platform-only step (app lifecycle, device, contexts, device
 * assertions, page source, screen-level gestures), before anything is
 * resolved or acted on, so the error names the STEP, never an internal
 * family method.
 */
export function requireDevicePlatform(stepName: string, platform: Platform): void {
    if (familyOf(platform) === 'playwright') {
        throw new PlatformNotSupportedError(stepName, platform);
    }
}
