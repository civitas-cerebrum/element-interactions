import type { IDevice, Orientation, PermissionState } from '../interfaces/IDevice';
import { PlatformNotSupportedError } from '@civitas-cerebrum/element-repository';

function unsupported(method: string): never {
    throw new PlatformNotSupportedError(method, 'web');
}

/**
 * Device and app operations for the Playwright family (`web`). A browser has
 * no app lifecycle, system back, keyboard, orientation, native alerts,
 * permissions or contexts in this sense, so every method throws
 * `PlatformNotSupportedError(method, 'web')`.
 */
export class PlaywrightDevice implements IDevice {
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
    async hideKeyboard(): Promise<void> { unsupported('hideKeyboard'); }
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
}
