import { notImplementedStrategy } from './notImplemented';

/**
 * Windows: declared, not implemented yet. Every method throws
 * `Platform "windows" is declared but not implemented yet.`
 */
export const windowsStrategy = notImplementedStrategy('windows', 'appium:app');
