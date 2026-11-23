import type { Page } from '@playwright/test';
import type { IInteractionFactory } from '../interfaces/IInteractionFactory';
import { Interactions } from './PlaywrightInteractions';
import { Verifications } from './PlaywrightVerifications';
import { Extractions } from './PlaywrightExtractions';
import { Navigation } from './PlaywrightNavigation';
import { PlaywrightGestures } from './PlaywrightGestures';
import { PlaywrightDevice } from './PlaywrightDevice';
import { Utils } from '../utils/ElementUtilities';

export interface PlaywrightFactoryOptions {
    /** Default element timeout in ms (the classes' own default, 30000, when omitted). */
    timeout?: number;
    /** Intercepted clicks fall back to a dispatched DOM click (default `true`). */
    interceptionRetry?: boolean;
}

/** Builds the Playwright family (`web`) on one Playwright `Page`. Each `create*` returns a new instance. */
export class PlaywrightFactory implements IInteractionFactory {
    readonly platform = 'web' as const;
    readonly family = 'playwright' as const;

    constructor(private readonly page: Page, private readonly options: PlaywrightFactoryOptions = {}) {}

    createInteractions(): Interactions {
        return new Interactions(this.page, this.options.timeout, this.options.interceptionRetry);
    }

    createVerifications(): Verifications {
        return new Verifications(this.page, this.options.timeout);
    }

    createExtractions(): Extractions {
        return new Extractions(this.page, this.options.timeout);
    }

    createNavigation(): Navigation {
        return new Navigation(this.page);
    }

    createUtils(): Utils {
        return new Utils(this.options.timeout);
    }

    createGestures(): PlaywrightGestures {
        return new PlaywrightGestures(this.options.timeout);
    }

    createDevice(): PlaywrightDevice {
        return new PlaywrightDevice();
    }
}
