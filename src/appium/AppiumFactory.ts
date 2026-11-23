import { familyOf, type Platform } from '@civitas-cerebrum/element-repository';
import type { IInteractionFactory } from '../interfaces/IInteractionFactory';
import type { AppiumDriver, PlatformStrategy } from './platform/PlatformStrategy';
import { appIdFromCapabilities, strategyFor } from './platform';
import { notImplementedError } from './platform/notImplemented';
import { AppiumInteractions } from './AppiumInteractions';
import { AppiumVerifications } from './AppiumVerifications';
import { AppiumExtractions } from './AppiumExtractions';
import { AppiumNavigation } from './AppiumNavigation';
import { Utils } from '../utils/ElementUtilities';
import { AppiumGestures } from './AppiumGestures';
import { AppiumDevice } from './AppiumDevice';

export interface AppiumFactoryOptions {
    /** Default element timeout in ms (30000 when omitted). */
    timeout?: number;
    /**
     * The app under test (Android package / iOS bundle id), the default for
     * every optional `appId`. When omitted it is read from the driver's
     * capabilities, see {@link appIdFromSession}.
     */
    appId?: string;
}

/**
 * The app under test named by a live session's capabilities. The
 * capabilities-file forms come first (`appium:<key>` at the top level, or
 * `<key>` inside `appium:options`, as `appIdFromCapabilities` reads them);
 * then the UNPREFIXED `<key>` (`appPackage` / `bundleId`), because Appium
 * returns a session's capabilities with the vendor prefix stripped, so the
 * `driver.capabilities` of a real session carries no `appium:` keys.
 */
export function appIdFromSession(platform: Platform, capabilities: Record<string, unknown> | undefined): string | undefined {
    const fromFile = appIdFromCapabilities(platform, capabilities);
    if (fromFile !== undefined || !capabilities) return fromFile;
    const bare = capabilities[strategyFor(platform).appIdCapability.replace(/^appium:/, '')];
    return typeof bare === 'string' && bare.length > 0 ? bare : undefined;
}

/**
 * Builds the Appium family for one WebdriverIO session on one platform.
 * Everything hangs off this instance (no global or static state): two
 * factories for different sessions or platforms can live side by side. Each
 * `create*` returns a new instance.
 *
 * @throws for `web` (Playwright family) and for a declared-but-unimplemented
 *         platform (`macos`, `windows`).
 */
export class AppiumFactory implements IInteractionFactory {
    readonly family = 'appium' as const;
    readonly strategy: PlatformStrategy;
    readonly appId: string | undefined;
    private readonly timeout: number;

    constructor(
        private readonly driver: AppiumDriver,
        readonly platform: Platform,
        options: AppiumFactoryOptions = {},
    ) {
        if (familyOf(platform) !== 'appium') {
            throw new Error(`AppiumFactory: platform "${platform}" is not in the Appium family. Use PlaywrightFactory for web.`);
        }
        this.strategy = strategyFor(platform);
        if (!this.strategy.implemented) throw notImplementedError(platform);
        this.timeout = options.timeout ?? 30000;
        this.appId = options.appId
            ?? appIdFromSession(platform, driver.capabilities as Record<string, unknown> | undefined);
    }

    createInteractions(): AppiumInteractions {
        return new AppiumInteractions(this.driver, this.platform, this.timeout);
    }

    createVerifications(): AppiumVerifications {
        return new AppiumVerifications(this.driver, this.strategy, this.timeout);
    }

    createExtractions(): AppiumExtractions {
        return new AppiumExtractions(this.driver, this.platform, this.timeout);
    }

    createNavigation(): AppiumNavigation {
        return new AppiumNavigation(this.platform);
    }

    /** The driver-neutral `Utils`: every wait goes through the element's own `waitFor` primitive. */
    createUtils(): Utils {
        return new Utils(this.timeout);
    }

    createGestures(): AppiumGestures {
        return new AppiumGestures(this.driver, this.strategy, this.timeout);
    }

    createDevice(): AppiumDevice {
        return new AppiumDevice(this.driver, this.strategy, this.appId, this.timeout);
    }
}
