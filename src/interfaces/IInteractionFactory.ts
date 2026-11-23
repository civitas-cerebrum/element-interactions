import type { DriverFamily, Platform } from '../compat/elementRepository';
import type { IInteractions } from './IInteractions';
import type { IVerifications } from './IVerifications';
import type { IExtractions } from './IExtractions';
import type { INavigation } from './INavigation';
import type { IUtils } from './IUtils';
import type { IGestures } from './IGestures';
import type { IDevice } from './IDevice';

/**
 * Builds one driver family's implementations for one platform. The Steps layer
 * takes a factory instead of a raw driver, so no platform state is global or
 * static: two factories for different platforms can live side by side.
 */
export interface IInteractionFactory {
    readonly platform: Platform;
    readonly family: DriverFamily;
    createInteractions(): IInteractions;
    createVerifications(): IVerifications;
    createExtractions(): IExtractions;
    createNavigation(): INavigation;
    createUtils(): IUtils;
    createGestures(): IGestures;
    createDevice(): IDevice;
}
