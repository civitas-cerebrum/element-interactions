import { familyOf, type Platform } from '@civitas-cerebrum/element-repository';
import type { IInteractionFactory } from '../interfaces/IInteractionFactory';
import type { AppiumDriver, PlatformStrategy } from './platform/PlatformStrategy';
import { appIdFromCapabilities, strategyFor } from './platform';
import { notImplementedError } from './platform/notImplemented';
import { AppiumInteractions } from './AppiumInteractions';
import { AppiumVerifications } from './AppiumVerifications';
import { AppiumExtractions } from './AppiumExtractions';
import { AppiumNavigation } from './AppiumNavigation';
import { AppiumUtils } from './AppiumUtils';
import { AppiumGestures } from './AppiumGestures';
import { AppiumDevice } from './AppiumDevice';

export interface AppiumFactoryOptions {
    /** Default element timeout in ms (30000 when omitted). */
    timeout?: number;
    /**
     * The app under test (Android package / iOS bundle id), the default for
     * every optional `appId`. When omitted it is read from the driver's
     * capabilities under the platform's key (CONTRACT B1).
     */
    appId?: string;
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
            ?? appIdFromCapabilities(platform, driver.capabilities as Record<string, unknown> | undefined);
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

    createUtils(): AppiumUtils {
        return new AppiumUtils(this.timeout);
    }

    createGestures(): AppiumGestures {
        return new AppiumGestures(this.driver, this.strategy, this.timeout);
    }

    createDevice(): AppiumDevice {
        return new AppiumDevice(this.driver, this.strategy, this.appId);
    }
}
