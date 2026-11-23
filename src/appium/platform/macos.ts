import { notImplementedStrategy } from './notImplemented';

/**
 * macOS (Mac2 driver): declared, not implemented yet. Every method throws
 * `Platform "macos" is declared but not implemented yet.`
 */
export const macosStrategy = notImplementedStrategy('macos', 'appium:bundleId');
