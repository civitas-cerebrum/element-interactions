import { test, expect } from '@playwright/test';
import { format } from 'util';
import {
    attachSetupEvidence,
    isAppLaunchTimeout,
    relaunchApp,
    startSession,
    startTimeoutMargin,
} from '../src/fixture/BaseFixture';
import { prepareSession, resolveStartTimeout, START_TIMEOUT_MS } from '../src/session/prepareSession';
import { AppNotInForegroundError } from '../src/appium/AppiumDevice';
import { log } from '../src/logger/Logger';
import { mockDriver } from './appium/mocks';
import type { SessionStartContext } from '../src/session/types';

/** WebDriverAgent's answer when XCTest gave up launching the app (as WebdriverIO surfaces it). */
const WDA_LAUNCH_TIMEOUT = 'An unknown server-side error occurred while processing the command. Original error: '
    + 'Error Domain=XCTDaemonErrorDomain Code=5 "Timed out attempting to launch app." UserInfo={NSLocalizedDescription=Timed out attempting to launch app.}';

/**
 * A mock driver whose `mobile: activateApp` answers from `activations` in
 * order (an Error rejects, `'hang'` never settles, anything else resolves)
 * and whose `mobile: queryAppState` answers 4 (foreground) unless `state` says otherwise.
 */
function relaunchDriver(activations: Array<Error | 'ok' | 'hang'>, state: () => number = () => 4) {
    const mock = mockDriver({ capabilities: { platformName: 'iOS', 'appium:bundleId': 'com.example.app' } });
    const commands: string[] = [];
    let activation = 0;
    (mock.driver as unknown as { execute: unknown }).execute = async (script: string) => {
        commands.push(script);
        if (script === 'mobile: activateApp') {
            const next = activations[activation++] ?? 'ok';
            if (next === 'hang') return new Promise(() => undefined);
            if (next instanceof Error) throw next;
            return undefined;
        }
        if (script === 'mobile: queryAppState') return state();
        return undefined;
    };
    return { driver: mock.driver, commands };
}

/** Captures `log.warn` lines while `body` runs. */
async function warnings(body: () => Promise<unknown>): Promise<{ lines: string[]; error: unknown }> {
    const lines: string[] = [];
    const { log: original, enabled } = log.warn;
    log.warn.enabled = true;
    log.warn.log = (...args: unknown[]) => { lines.push(format(...args)); };
    let error: unknown;
    try {
        await body();
    } catch (e) {
        error = e;
    } finally {
        log.warn.log = original;
        log.warn.enabled = enabled;
    }
    return { lines, error };
}

/** The error `pending` rejects with; fails the test when it resolves. */
async function failure(pending: Promise<unknown>): Promise<Error> {
    try {
        await pending;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a rejection');
}

const SESSION = { appId: 'com.example.app', relaunchTimeout: 2000 };
const activations = (commands: string[]) => commands.filter(c => c === 'mobile: activateApp').length;

test.describe('the launch-timeout match', () => {
    test("matches WebDriverAgent's launch timeout on ios only", () => {
        expect(isAppLaunchTimeout('ios', new Error(WDA_LAUNCH_TIMEOUT))).toBe(true);
        expect(isAppLaunchTimeout('ios', new Error('Timed out attempting to launch app.'))).toBe(true);
        expect(isAppLaunchTimeout('ios', 'Timed out attempting to launch app.')).toBe(true);
        expect(isAppLaunchTimeout('android', new Error(WDA_LAUNCH_TIMEOUT))).toBe(false);
        expect(isAppLaunchTimeout('ios', new Error('A session is either terminated or not started'))).toBe(false);
        // The error domain and code alone are not taken as a launch timeout.
        expect(isAppLaunchTimeout('ios', new Error('Error Domain=XCTDaemonErrorDomain Code=5'))).toBe(false);
        expect(isAppLaunchTimeout('ios', undefined)).toBe(false);
    });
});

test.describe("the fixture's relaunch retries a launch timeout once", () => {
    test('a launch timeout then a successful activation: the setup passes with one warning naming app, platform and error', async () => {
        const { driver, commands } = relaunchDriver([new Error(WDA_LAUNCH_TIMEOUT), 'ok']);
        const { lines, error } = await warnings(() => relaunchApp(driver, 'ios', SESSION));
        expect(error).toBeUndefined();
        expect(commands.slice(0, 3)).toEqual(['mobile: terminateApp', 'mobile: activateApp', 'mobile: activateApp']);
        expect(commands).toContain('mobile: queryAppState');
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('com.example.app');
        expect(lines[0]).toContain('"ios"');
        expect(lines[0]).toContain('Timed out attempting to launch app');
    });

    test('a launch timeout twice: the setup fails with the error of the retried activation', async () => {
        const { driver, commands } = relaunchDriver([new Error(WDA_LAUNCH_TIMEOUT), new Error(WDA_LAUNCH_TIMEOUT)]);
        const { lines, error } = await warnings(() => relaunchApp(driver, 'ios', SESSION));
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('Timed out attempting to launch app');
        expect(message).toContain('activate');
        expect(message).toContain('retried once');
        expect(message).toContain('"com.example.app"');
        expect(message).toContain('"ios"');
        expect(message).toContain('2000 ms');
        expect(activations(commands)).toBe(2);
        expect(commands).not.toContain('mobile: queryAppState');
        expect(lines).toHaveLength(1);
    });

    test('any other activation error is never retried: the setup fails at once', async () => {
        const { driver, commands } = relaunchDriver([new Error('An unknown server-side error occurred: app is not installed')]);
        const { lines, error } = await warnings(() => relaunchApp(driver, 'ios', SESSION));
        expect((error as Error).message).toContain('app is not installed');
        expect((error as Error).message).toContain('phase "activate"');
        expect(activations(commands)).toBe(1);
        expect(lines).toEqual([]);
    });

    test('the launch-timeout text on android is not retried', async () => {
        const { driver, commands } = relaunchDriver([new Error(WDA_LAUNCH_TIMEOUT)]);
        const { error } = await warnings(() => relaunchApp(driver, 'android', SESSION));
        expect(error).toBeInstanceOf(Error);
        expect(activations(commands)).toBe(1);
    });

    test('the retried activation and the foreground wait together stay inside session.relaunchTimeout', async () => {
        // The retried activation never answers: it is given up at the budget.
        const hang = relaunchDriver([new Error(WDA_LAUNCH_TIMEOUT), 'hang']);
        let started = Date.now();
        const hung = await warnings(() => relaunchApp(hang.driver, 'ios', { ...SESSION, relaunchTimeout: 300 }));
        let elapsed = Date.now() - started;
        expect((hung.error as Error).message).toContain('did not answer within 300 ms');
        expect(elapsed).toBeGreaterThanOrEqual(290);
        expect(elapsed).toBeLessThan(1500);

        // The retried activation answers, the app stays in the background: the wait gets only what is left.
        const background = relaunchDriver([new Error(WDA_LAUNCH_TIMEOUT), 'ok'], () => 3);
        started = Date.now();
        const waited = await warnings(() => relaunchApp(background.driver, 'ios', { ...SESSION, relaunchTimeout: 400 }));
        elapsed = Date.now() - started;
        expect((waited.error as Error).message).toContain('is not in the foreground');
        expect((waited.error as Error).message).toContain('activation retried once after a launch timeout');
        // The retried path reports the relaunch budget, not the remainder left for the wait.
        expect((waited.error as Error).message).toContain('within session.relaunchTimeout 400 ms');
        expect((waited.error as Error).message).not.toContain('ms after it was terminated and activated');
        expect(elapsed).toBeLessThan(400 + 600);
    });

    test('a terminate failure names its phase, the app, the platform and the budget', async () => {
        const mock = mockDriver();
        (mock.driver as unknown as { execute: unknown }).execute = async (script: string) => {
            if (script === 'mobile: terminateApp') throw new Error('terminate refused');
            return 4;
        };
        const error = await failure(relaunchApp(mock.driver, 'android', SESSION));
        expect(error.message).toContain('phase "terminate"');
        expect(error.message).toContain('"com.example.app"');
        expect(error.message).toContain('"android"');
        expect(error.message).toContain('terminate refused');
        expect(error.message).toContain('2000 ms');
    });

    test('a driver error during the foreground wait names the foreground-wait phase', async () => {
        const { driver } = relaunchDriver(['ok'], () => {
            const dead = new Error('A session is either terminated or not started');
            dead.name = 'invalid session id';
            throw dead;
        });
        const error = await failure(relaunchApp(driver, 'ios', SESSION));
        expect(error.message).toContain('phase "foreground wait"');
        expect(error.message).toContain('A session is either terminated or not started');
    });
});

test.describe('setup evidence', () => {
    function attachments() {
        const attached: Array<{ name: string; contentType: string; body: string }> = [];
        return {
            attached,
            info: { attach: async (name: string, options: { body?: string | Buffer; contentType?: string }) => {
                attached.push({ name, contentType: options.contentType ?? '', body: String(options.body) });
            } },
        };
    }

    test('the error text and the last app state from a foreground timeout, then the screenshot and page source', async () => {
        const mock = mockDriver({ pageSource: '<AppiumAUT/>' });
        const { attached, info } = attachments();
        const error = new Error('setup failed', { cause: new AppNotInForegroundError('com.example.app', 'ios', 500, 3) });
        await attachSetupEvidence(mock.driver, info, error, 'ios', 'com.example.app', true, 200);
        expect(attached.map(a => `${a.name} ${a.contentType}`)).toEqual(['setup-error text/plain', 'failure-screenshot image/png', 'page-source text/xml']);
        expect(attached[0].body).toContain('setup failed');
        expect(attached[0].body).toContain('last app state: 3, running in background');
    });

    test('without a known state the app state is queried once, time-boxed', async () => {
        const mock = mockDriver();
        mock.executeResults['mobile: queryAppState'] = 1;
        const { attached, info } = attachments();
        await attachSetupEvidence(mock.driver, info, new Error('activate failed'), 'ios', 'com.example.app', false, 200);
        expect(attached.map(a => a.name)).toEqual(['setup-error', 'page-source']);
        expect(attached[0].body).toContain('last app state: 1, not running');

        const hanging = mockDriver();
        (hanging.driver as unknown as { execute: unknown }).execute = () => new Promise(() => undefined);
        (hanging.driver as unknown as { getPageSource: unknown }).getPageSource = () => new Promise(() => undefined);
        const second = attachments();
        const started = Date.now();
        await attachSetupEvidence(hanging.driver, second.info, 'plain failure', 'ios', 'com.example.app', false, 100);
        expect(Date.now() - started).toBeLessThan(1500);
        expect(second.attached.map(a => a.name)).toEqual(['setup-error']);
        expect(second.attached[0].body).toContain('plain failure');
        expect(second.attached[0].body).toContain('app state could not be read');
    });

    test('with no app id the state is unknown; a failing attach never throws', async () => {
        const mock = mockDriver();
        const { attached, info } = attachments();
        await attachSetupEvidence(mock.driver, info, new Error('hook failed'), 'ios', undefined, false, 200);
        expect(attached[0].body).toContain('app state unknown');
        const broken = { attach: async () => { throw new Error('attach failed'); } };
        await expect(attachSetupEvidence(mock.driver, broken, new Error('x'), 'ios', 'com.example.app', true, 100)).resolves.toBeUndefined();
    });
});

test.describe('session start budget', () => {
    const context: SessionStartContext = {
        platform: 'ios',
        capabilities: { platformName: 'iOS' },
        server: { protocol: 'https', hostname: 'appium.invalid', port: 443, path: '/wd/hub', user: 'someone', key: 'secret-key' },
    };

    test('session.startTimeout: default, validation, and the margin left before the fixture timeout', () => {
        expect(START_TIMEOUT_MS).toBe(600_000);
        expect(resolveStartTimeout(undefined)).toBe(START_TIMEOUT_MS);
        expect(resolveStartTimeout(1234)).toBe(1234);
        for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5' as unknown as number]) {
            expect(() => resolveStartTimeout(bad)).toThrow('session.startTimeout must be a positive, finite number of ms');
        }
        const prepared = prepareSession('ios', { capabilities: 'tests/capabilities/ios.example.json', startTimeout: 9000 }, {});
        expect(prepared.startTimeout).toBe(9000);
        expect(() => prepareSession('ios', { capabilities: 'tests/capabilities/ios.example.json', startTimeout: -5 }, {}))
            .toThrow('session.startTimeout');
        expect(startTimeoutMargin(600_000)).toBe(5000);
        expect(startTimeoutMargin(1000)).toBe(100);
    });

    test('a start that never answers fails with our error before the budget, naming server (no credentials), platform and budget', async () => {
        const started = Date.now();
        const error = await failure(startSession({ start: () => new Promise<never>(() => undefined), stop: async () => undefined }, context, 500)
            );
        const elapsed = Date.now() - started;
        expect(elapsed).toBeGreaterThanOrEqual(440);
        expect(elapsed).toBeLessThan(500);
        expect(error.message).toContain('https://appium.invalid:443/wd/hub');
        expect(error.message).toContain('"ios"');
        expect(error.message).toContain('session.startTimeout');
        expect(error.message).toContain('500 ms');
        expect(error.message).toContain('raise session.startTimeout (default 600000 ms)');
        expect(error.message).not.toContain('someone');
        expect(error.message).not.toContain('secret-key');
    });

    test('a session that arrives after the budget is closed', async () => {
        const fakeDriver = mockDriver().driver;
        const stopped: unknown[] = [];
        const provider = {
            start: () => new Promise<WebdriverIO.Browser>(resolve => setTimeout(() => resolve(fakeDriver), 250)),
            stop: async (d: WebdriverIO.Browser) => { stopped.push(d); },
        };
        await expect(startSession(provider, context, 100)).rejects.toThrow('session.startTimeout');
        await new Promise(resolve => setTimeout(resolve, 400));
        expect(stopped).toEqual([fakeDriver]);
    });

    test('a start error is rethrown naming server and platform, keeping the original text', async () => {
        const error = await failure(startSession({ start: async () => { throw new Error('ECONNREFUSED'); }, stop: async () => undefined }, context, 1000)
            );
        expect(error.message).toContain('ECONNREFUSED');
        expect(error.message).toContain('https://appium.invalid:443/wd/hub');
        expect(error.message).toContain('"ios"');
        expect(error.message).not.toContain('secret-key');
    });

    test('a start that answers in time returns its driver', async () => {
        const fakeDriver = mockDriver().driver;
        await expect(startSession({ start: async () => fakeDriver, stop: async () => undefined }, context, 1000)).resolves.toBe(fakeDriver);
    });
});
