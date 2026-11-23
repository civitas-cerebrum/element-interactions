import { familyOf, PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';
import type { Platform } from '@civitas-cerebrum/element-repository';
import type { IExtractions } from '../interfaces/IExtractions';
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
    /** The platform these members act on. Omitted means `'web'`. */
    readonly platform?: Platform;
}

/** Builds the members an `ElementAction` needs from a factory (fresh instances, as `ElementInteractions` did). */
export function actionFamilyOf(factory: IInteractionFactory): ElementActionFamily {
    return {
        interact: factory.createInteractions(),
        verify: factory.createVerifications(),
        extract: factory.createExtractions(),
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
 * Thrown by a shared feature whose device-platform implementation is not built
 * yet (list entries, `verifyAbsence`, visibility probes and gates, predicate
 * snapshots). Distinct from `PlatformNotSupportedError`: the feature is meant
 * to work on the platform, it just has no implementation in this build. It is
 * always thrown, never swallowed, so such a step can never silently pass.
 */
export class PlatformPathPendingError extends Error {
    readonly feature: string;
    readonly platform: Platform;

    constructor(feature: string, platform: Platform) {
        super(`"${feature}" has no implementation for platform "${platform}" yet; it works on "web" only in this build.`);
        this.name = 'PlatformPathPendingError';
        this.feature = feature;
        this.platform = platform;
    }
}

/** Throws {@link PlatformPathPendingError} unless `platform` belongs to the Playwright family. */
export function requireBuiltPath(feature: string, platform: Platform): void {
    if (familyOf(platform) !== 'playwright') {
        throw new PlatformPathPendingError(feature, platform);
    }
}
