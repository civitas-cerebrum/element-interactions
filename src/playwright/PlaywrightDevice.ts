import type { DeviceVerifyOptions, IDevice, Orientation, PermissionState } from '../interfaces/IDevice';
import { PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';

function unsupported(method: string): never {
    throw new PlatformNotSupportedError(method, 'web');
}

/**
 * Device and app operations for the Playwright family (`web`). A browser has
 * no app lifecycle, system back, keyboard, orientation, native alerts,
 * permissions or contexts in this sense, so every method throws
 * `PlatformNotSupportedError(method, 'web')`, except the two queries:
 * `supports` answers `false` and `resolveAppId` `undefined`.
 */
export class PlaywrightDevice implements IDevice {
    /** A browser performs no device step. */
    supports(_step: string): boolean { return false; }
    /** A browser has no app under test. */
    resolveAppId(_step: string, _appId?: string): string | undefined { return undefined; }
    async launchApp(_appId?: string): Promise<void> { unsupported('launchApp'); }
    async activateApp(_appId?: string): Promise<void> { unsupported('activateApp'); }
    async terminateApp(_appId?: string): Promise<void> { unsupported('terminateApp'); }
    async backgroundApp(_seconds: number): Promise<void> { unsupported('backgroundApp'); }
    async resetApp(): Promise<void> { unsupported('resetApp'); }
    async installApp(_appPath: string): Promise<void> { unsupported('installApp'); }
    async removeApp(_appId: string): Promise<void> { unsupported('removeApp'); }
    async openDeepLink(_url: string, _appId?: string): Promise<void> { unsupported('openDeepLink'); }
    async isAppInForeground(_appId?: string): Promise<boolean> { return unsupported('isAppInForeground'); }
    async pressBack(): Promise<void> { unsupported('pressBack'); }
    async hideKeyboard(): Promise<boolean> { unsupported('hideKeyboard'); }
    async isKeyboardShown(): Promise<boolean> { return unsupported('isKeyboardShown'); }
    async getOrientation(): Promise<Orientation> { return unsupported('getOrientation'); }
    async setOrientation(_orientation: Orientation): Promise<void> { unsupported('setOrientation'); }
    async acceptAlert(): Promise<void> { unsupported('acceptAlert'); }
    async dismissAlert(): Promise<void> { unsupported('dismissAlert'); }
    async setPermission(_permission: string, _state: PermissionState): Promise<void> { unsupported('setPermission'); }
    async getContexts(): Promise<string[]> { return unsupported('getContexts'); }
    async getContext(): Promise<string> { return unsupported('getContext'); }
    async switchContext(_name: string): Promise<void> { unsupported('switchContext'); }
    async getPageSource(): Promise<string> { return unsupported('getPageSource'); }
    async verifyAppInForeground(_appId?: string, _options?: DeviceVerifyOptions): Promise<void> { unsupported('verifyAppInForeground'); }
    async verifyOrientation(_orientation: Orientation, _options?: DeviceVerifyOptions): Promise<void> { unsupported('verifyOrientation'); }
    async verifyKeyboardShown(_options?: DeviceVerifyOptions & { negated?: boolean }): Promise<void> { unsupported('verifyKeyboardShown'); }
    async verifyContext(_name: string, _options?: DeviceVerifyOptions): Promise<void> { unsupported('verifyContext'); }
}
