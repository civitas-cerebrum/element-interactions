import { familyOf, type Platform } from '@civitas-cerebrum/element-repository';
import { appIdFromCapabilities, strategyFor } from '../appium/platform';
import { notImplementedError } from '../appium/platform/notImplemented';
import { loadCapabilities } from './capabilities';
import { resolveServer } from './server';
import type { SessionOptions, SessionStartContext } from './types';

/** Everything needed to open the session of a platform run, resolved before any connection is made. */
export interface PreparedSession {
    context: SessionStartContext;
    /** The capabilities file as given (option or `E2E_CAPABILITIES`). */
    capabilitiesFile: string;
    /** The app under test read from the file; `undefined` when the file names none. */
    appId: string | undefined;
    reset: 'relaunch' | 'none';
    /** With `reset: 'relaunch'`: how long the app may take to reach the foreground, in ms. */
    relaunchTimeout: number;
    /** How long the worker's session start (provider start plus `onSessionStarted`) may take, in ms. */
    startTimeout: number;
}

/** Default of `session.relaunchTimeout`, in ms. */
export const RELAUNCH_TIMEOUT_MS = 15_000;

/**
 * Default of `session.startTimeout`, in ms: ten minutes. A cold start on a
 * real device can build and sign WebDriverAgent (iOS) or install the
 * UiAutomator2 server (Android) before the session exists, which takes
 * several minutes and more than a usual test timeout.
 */
export const START_TIMEOUT_MS = 600_000;

/**
 * `session.startTimeout` as given, else {@link START_TIMEOUT_MS}. Throws
 * unless it is a positive, finite number of ms.
 */
export function resolveStartTimeout(startTimeout: number | undefined): number {
    const value = startTimeout ?? START_TIMEOUT_MS;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`session.startTimeout must be a positive, finite number of ms, got ${String(value)}.`);
    }
    return value;
}

/**
 * Resolves `session` options for `platform` without opening anything: checks
 * the platform is an implemented Appium-family one, reads the capabilities
 * file (exact content, `platformName` checked), resolves the server, and
 * reads the app id. Every problem throws here, before a session exists.
 *
 * A file with `browserName` must also set `"wdio:enforceWebDriverClassic": true`:
 * without it WebdriverIO adds BiDi keys to the session request, and the
 * library sends exactly the file.
 */
export function prepareSession(platform: Platform, options: SessionOptions = {}, env: NodeJS.ProcessEnv = process.env): PreparedSession {
    if (familyOf(platform) !== 'appium') {
        throw new Error(`Platform "${platform}" runs on Playwright; it has no Appium session.`);
    }
    if (!strategyFor(platform).implemented) throw notImplementedError(platform);

    const reset = options.reset ?? 'relaunch';
    if (reset !== 'relaunch' && reset !== 'none') {
        throw new Error(`session.reset must be 'relaunch' or 'none', got "${String(reset)}".`);
    }
    const relaunchTimeout = options.relaunchTimeout ?? RELAUNCH_TIMEOUT_MS;
    if (typeof relaunchTimeout !== 'number' || !Number.isFinite(relaunchTimeout) || relaunchTimeout < 0) {
        throw new Error(`session.relaunchTimeout must be a non-negative, finite number of ms, got ${String(relaunchTimeout)}.`);
    }
    const startTimeout = resolveStartTimeout(options.startTimeout);
    const { file, capabilities } = loadCapabilities(options.capabilities, platform, env);
    if (capabilities.browserName !== undefined && capabilities['wdio:enforceWebDriverClassic'] !== true) {
        throw new Error(
            `Capabilities file "${file}" sets "browserName" but not "wdio:enforceWebDriverClassic": true. `
            + 'For a session with "browserName", WebdriverIO adds WebDriver BiDi keys (webSocketUrl, unhandledPromptBehavior, '
            + 'appium:chromedriverForwardBiDi) to the capabilities it sends, so the session would not get exactly the file. '
            + 'Add "wdio:enforceWebDriverClassic": true to the file: it stops WebdriverIO adding those keys.',
        );
    }
    const appId = appIdFromCapabilities(platform, capabilities);
    if (reset === 'relaunch' && appId === undefined) {
        const key = strategyFor(platform).appIdCapability;
        const nested = `"appium:options": { "${key.replace(/^appium:/, '')}": ... }`;
        throw new Error(
            `Capabilities file "${file}" has no "${key}" (nor ${nested}): session.reset 'relaunch' relaunches the app under test `
            + `between tests and needs it. Add "${key}" to the file, or set session.reset to 'none'.`,
        );
    }
    const server = resolveServer(options.server, env);
    return { context: { platform, capabilities, server }, capabilitiesFile: file, appId, reset, relaunchTimeout, startTimeout };
}
