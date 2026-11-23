import { PlatformNotSupportedError, type Platform } from '@civitas-cerebrum/element-repository';

/** Throws `PlatformNotSupportedError(method, platform)` for a web-only method called on an Appium platform. */
export function webOnly(method: string, platform: Platform): never {
    throw new PlatformNotSupportedError(method, platform);
}
