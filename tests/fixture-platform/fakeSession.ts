import * as fs from 'fs';
import { mockDriver, type Call } from '../appium/mocks';
import type { SessionProvider, SessionStartContext } from '../../src/session';

/** Text the fake device shows per accessibility id. */
const TEXTS: Record<string, string> = { '~login-title': 'Sign in', '~login-submit': 'Continue' };

/**
 * A raw WebdriverIO element stand-in: answers what PlatformElement asks of it
 * (existence, display, text, click) and records each command in `calls`.
 */
function rawElement(selector: string, calls: Call[]) {
    const record = (name: string, result?: unknown) => async (...args: unknown[]) => {
        calls.push([`el.${name}`, selector, ...args]);
        return result;
    };
    return {
        selector,
        elementId: `id-${selector}`,
        isExisting: record('isExisting', true),
        isDisplayed: record('isDisplayed', true),
        isEnabled: record('isEnabled', true),
        waitForExist: record('waitForExist', true),
        waitForDisplayed: record('waitForDisplayed', true),
        getText: record('getText', TEXTS[selector] ?? ''),
        // XCUITest reports the element type as the tag name; iOS keeps visible
        // text in `label` (element-repository's iOS text read).
        getTagName: record('getTagName', 'XCUIElementTypeStaticText'),
        getAttribute: async (name: string) => {
            calls.push(['el.getAttribute', selector, name]);
            return name === 'label' ? TEXTS[selector] ?? null : null;
        },
        click: record('click'),
        clearValue: record('clearValue'),
        setValue: record('setValue'),
    };
}

/** The page source the fake device shows while the app under test is in the foreground. */
export const APP_SOURCE = '<AppiumAUT><XCUIElementTypeApplication name="Example"/></AppiumAUT>';
/** The page source the fake device shows while the app is not in the foreground (the home screen). */
export const LAUNCHER_SOURCE = '<hierarchy><node package="com.example.launcher"/></hierarchy>';

/** How the fake app reaches the foreground after `mobile: activateApp`. */
export interface FakeAppOptions {
    /**
     * How many `mobile: queryAppState` queries after an activation still see
     * the app in the background (state 3) before it is in the foreground
     * (state 4). Default 0: in the foreground at once. `Infinity`: never.
     */
    backgroundQueries?: number;
    /** Every `mobile: queryAppState` fails with a dead-session driver error. */
    deadSession?: boolean;
}

export interface FakeSession {
    provider: SessionProvider;
    /** Every command the fake driver received (driver-level and element-level). */
    calls: Call[];
    starts: SessionStartContext[];
    stops: number;
    driver: WebdriverIO.Browser;
    /** Make the next evidence collection fail. */
    failEvidence: boolean;
}

/**
 * A SessionProvider whose `start` returns a mock driver (tests/appium/mocks)
 * extended with `$` / `$$` and `deleteSession`. When `logFile` is given, each
 * lifecycle event is appended to it as one line (`start`, `stop`, ...), so a
 * parent process can count them after the worker is gone. With `label`, each
 * line is prefixed with it (`<label> start`), so several sessions can share a log.
 */
export function fakeSession(logFile?: string, label?: string, app: FakeAppOptions = {}): FakeSession {
    const mock = mockDriver({
        capabilities: { platformName: 'iOS', 'appium:bundleId': 'com.example.app' },
        pageSource: APP_SOURCE,
    });
    const event = (line: string) => { if (logFile) fs.appendFileSync(logFile, `${label ? `${label} ` : ''}${line}\n`); };
    const driver = mock.driver as unknown as Record<string, unknown>;
    const originalExecute = driver.execute as (script: string, args: unknown) => Promise<unknown>;
    const state: FakeSession = {
        provider: undefined as unknown as SessionProvider,
        calls: mock.calls,
        starts: [],
        stops: 0,
        driver: mock.driver,
        failEvidence: false,
    };
    driver.$ = async (selector: string) => rawElement(selector, mock.calls);
    driver.$$ = async (selector: string) => [rawElement(selector, mock.calls)];
    // The app under test: in the foreground (4) when the session opens, not
    // running (1) after terminateApp, and in the background (3) for
    // `backgroundQueries` queries after activateApp.
    let appState = 4;
    let pendingBackground = 0;
    driver.execute = async (script: string, args: unknown) => {
        event(`execute ${script}`);
        const result = await originalExecute(script, args);
        if (script === 'mobile: terminateApp') appState = 1;
        if (script === 'mobile: activateApp') {
            pendingBackground = app.backgroundQueries ?? 0;
            appState = pendingBackground > 0 ? 3 : 4;
        }
        if (script === 'mobile: queryAppState') {
            if (app.deadSession) {
                const error = new Error('A session is either terminated or not started');
                error.name = 'invalid session id';
                throw error;
            }
            if (pendingBackground > 0) pendingBackground--;
            else if (appState === 3) appState = 4;
            event(`appState ${appState}`);
            return appState;
        }
        return result;
    };
    const takeScreenshot = driver.takeScreenshot as () => Promise<string>;
    const getPageSource = driver.getPageSource as () => Promise<string>;
    driver.takeScreenshot = async () => {
        if (state.failEvidence) throw new Error('screenshot unavailable');
        return takeScreenshot();
    };
    driver.getPageSource = async () => {
        if (state.failEvidence) throw new Error('page source unavailable');
        const source = await getPageSource();
        return appState === 4 ? source : LAUNCHER_SOURCE;
    };
    driver.deleteSession = async () => { mock.calls.push(['deleteSession']); };

    state.provider = {
        async start(context) {
            state.starts.push(context);
            event('start');
            return mock.driver;
        },
        async stop(d) {
            if (d !== mock.driver) throw new Error('stop() got a different driver');
            state.stops++;
            event('stop');
        },
    };
    return state;
}

/** How often the app was terminated / activated through `mobile:` commands. */
export function appCommands(calls: Call[]): string[] {
    return calls.filter(c => c[0] === 'execute').map(c => String(c[1]));
}
