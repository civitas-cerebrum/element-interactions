import { test, expect } from '@playwright/test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Runs tests/fixture-platform/*.pw.ts in a child Playwright process and reads
 * the JSON report: what only a whole run shows (worker teardown closes the
 * session, failure evidence attachments, fixture errors for page / context /
 * driver) is asserted here.
 */

interface JsonResult { status: string; duration: number; error?: { message?: string }; attachments: Array<{ name: string; contentType: string; body?: string }> }
interface JsonTest { expectedStatus: string; status: string; results: JsonResult[] }
interface JsonSpec { title: string; tests: JsonTest[] }
interface JsonSuite { specs?: JsonSpec[]; suites?: JsonSuite[] }

function specs(suite: JsonSuite): JsonSpec[] {
    return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
}

const ROOT = path.resolve(__dirname, '..');
let bySpec: Map<string, JsonResult>;
let outcome: Map<string, string>;
let events: string[];
let exitCode: number | null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ei-fixture-run-'));
    const log = path.join(dir, 'session.log');
    const report = path.join(dir, 'report.json');
    const env: NodeJS.ProcessEnv = { ...process.env, EI_FAKE_SESSION_LOG: log, PLAYWRIGHT_JSON_OUTPUT_NAME: report, TESTER_DEBUG: 'false' };
    for (const key of ['E2E_PLATFORM', 'E2E_CAPABILITIES', 'APPIUM_URL', 'APPIUM_USER', 'APPIUM_KEY', 'TEST_WORKER_INDEX', 'TEST_PARALLEL_INDEX']) delete env[key];
    const run = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '-c', 'tests/fixture-platform/playwright.config.ts'], {
        cwd: ROOT, env, encoding: 'utf-8', timeout: 240_000,
    });
    exitCode = run.status;
    if (!fs.existsSync(report)) throw new Error(`nested run wrote no report (exit ${run.status}):\n${run.stdout}\n${run.stderr}`);
    const json = JSON.parse(fs.readFileSync(report, 'utf-8')) as { suites: JsonSuite[] };
    bySpec = new Map(json.suites.flatMap(specs).map(s => [s.title, s.tests[0].results[0]]));
    outcome = new Map(json.suites.flatMap(specs).map(s => [s.title, s.tests[0].status]));
    events = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n') : [];
    fs.rmSync(dir, { recursive: true, force: true });
});

/** The evidence attachments (Playwright's own `error-context` and the like left out). */
const names = (r: JsonResult | undefined) => (r?.attachments ?? [])
    .filter(a => a.name === 'failure-screenshot' || a.name === 'page-source')
    .map(a => `${a.name} ${a.contentType}`).sort();

/** The tests the nested run is built to end unexpectedly (so it exits 1); every other one ends as expected. */
const MAIN_UNEXPECTED = ['evidence errors never mask the failure', 'fails and gets evidence', 'unexpected pass under test.fail() gets evidence'];
const DRAIN_FAILING = 'drain: a failing test keeps its own error, and its lookup ends before the evidence';
/** Their teardown is built to run out of Playwright's own teardown slot, to pin its length. */
const SLOT_PIN_BELOW = 'teardown slot pin: a test timeout below the project timeout gets the project timeout';
const SLOT_PIN_ABOVE = 'teardown slot pin: a test timeout above the project timeout gets the test timeout';
const UNEXPECTED = [...MAIN_UNEXPECTED, DRAIN_FAILING, SLOT_PIN_BELOW, SLOT_PIN_ABOVE].sort();

test('the nested run ends unexpectedly exactly where it is built to', () => {
    expect(bySpec.size).toBe(27);
    expect([...outcome].filter(([, status]) => status !== 'expected').map(([title]) => title).sort()).toEqual(UNEXPECTED);
    expect([...outcome].filter(([, status]) => status === 'unexpected').map(([title]) => title).sort()).toEqual(UNEXPECTED);
    expect(exitCode).toBe(1);
});

/** Lifecycle events of the main ios session (the labelled sessions of other files left out). */
const mainEvents = () => events.filter(e => !/^(hook-throws|stop-throws|macos|foreground|foreground-never|foreground-dead|reset-none|relaunch-retry|setup-evidence|setup-evidence-dead|start-timeout|drain|drain-timeout|drain-teardown) /.test(e));

test('one session per worker: started once, stopped once at worker teardown, relaunch before every test', () => {
    const main = mainEvents();
    // Playwright replaces the worker after each unexpected outcome: one worker
    // for the first tests, then one more after each of the three unexpected ones.
    const lifecycle = main.filter(e => e === 'start' || e === 'stop');
    expect(lifecycle).toEqual(Array.from({ length: 1 + MAIN_UNEXPECTED.length }, () => ['start', 'stop']).flat());
    expect(main.at(-1)).toBe('stop');
    // Eight platform tests, each preceded by terminate + activate.
    expect(main.filter(e => e === 'execute mobile: terminateApp')).toHaveLength(8);
    expect(main.filter(e => e === 'execute mobile: activateApp')).toHaveLength(8);
});

/** The events of the session labelled `label`, label removed. */
const labelled = (label: string) => events.filter(e => e.startsWith(`${label} `)).map(e => e.slice(label.length + 1));

/** Playwright's error text without colour codes. */
// eslint-disable-next-line no-control-regex
const plain = (r: JsonResult | undefined) => (r?.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '');

test("relaunch: the body starts only once the app is in the foreground, so a non-polling first read sees the app", () => {
    for (const title of ['the body starts with the app in the foreground: its first read sees the app',
        'the next test waits for the foreground again after its own relaunch']) {
        expect(bySpec.get(title)!.status, title).toBe('passed');
    }
    const perTest = [
        'execute mobile: terminateApp', 'execute mobile: activateApp',
        'execute mobile: queryAppState', 'appState 3',
        'execute mobile: queryAppState', 'appState 3',
        'execute mobile: queryAppState', 'appState 3',
        'execute mobile: queryAppState', 'appState 4',
        'body',
    ];
    expect(labelled('foreground').filter(e => e !== 'start' && e !== 'stop')).toEqual([...perTest, ...perTest]);
});

test('relaunch: an app that never reaches the foreground fails the setup within the bound, naming app, platform and last state', () => {
    const r = bySpec.get('an app that never reaches the foreground fails the setup within the bound')!;
    expect(r.status).toBe('failed');
    expect(outcome.get('an app that never reaches the foreground fails the setup within the bound')).toBe('expected');
    expect(plain(r)).toContain(
        `session.reset 'relaunch': app "com.example.app" is not in the foreground on platform "android" 500 ms after it was `
        + 'terminated and activated (last app state: 3, running in background). The test did not start. If the app needs '
        + 'longer to come up, raise session.relaunchTimeout (default 15000 ms).',
    );
    expect(r.duration).toBeLessThan(5000);
    const seen = labelled('foreground-never');
    expect(seen).not.toContain('body');
    expect(seen.filter(e => e === 'execute mobile: queryAppState').length).toBeGreaterThan(1);
    expect(seen.filter(e => e.startsWith('appState ')).every(e => e === 'appState 3')).toBe(true);
});

test('relaunch: a dead session during the foreground wait fails the setup at once with the driver error', () => {
    const r = bySpec.get('a dead session during the foreground wait fails the setup at once')!;
    expect(r.status).toBe('failed');
    expect(plain(r)).toContain('A session is either terminated or not started');
    expect(plain(r)).not.toContain('is not in the foreground');
    // relaunchTimeout is 20000 ms: failing at once is well below it.
    expect(r.duration).toBeLessThan(5000);
    const seen = labelled('foreground-dead');
    // One query in the foreground wait, one more for the setup evidence's app state.
    expect(seen.filter(e => e === 'execute mobile: queryAppState')).toHaveLength(2);
    expect(seen).not.toContain('body');
    expect(plain(r)).toContain('phase "foreground wait"');
    expect(setupError(r)!.text).toContain('app state could not be read: A session is either terminated or not started');
});

test("reset 'none': no relaunch and no foreground query before the test", () => {
    expect(bySpec.get("reset 'none' neither relaunches the app nor waits for it")!.status).toBe('passed');
    expect(labelled('reset-none')).toEqual(['start', 'body', 'stop']);
});

test('onSessionStarted throwing still stops the session, and its error fails the test', () => {
    // Between start and stop: the setup evidence's app-state query.
    expect(events.filter(e => e.startsWith('hook-throws '))).toEqual([
        'hook-throws start', 'hook-throws execute mobile: queryAppState', 'hook-throws appState 4', 'hook-throws stop',
    ]);
    const r = bySpec.get('onSessionStarted throws')!;
    expect(r.status).toBe('failed');
    expect(r.error?.message).toContain('onSessionStarted failed on purpose');
});

test('a throwing provider.stop() at worker teardown is logged and never masks the onSessionStarted error', () => {
    expect(events.filter(e => e.startsWith('stop-throws '))).toEqual([
        'stop-throws start', 'stop-throws execute mobile: queryAppState', 'stop-throws appState 4', 'stop-throws stop',
    ]);
    const r = bySpec.get('onSessionStarted error survives a throwing stop')!;
    expect(r.status).toBe('failed');
    expect(r.error?.message).toContain('onSessionStarted failed before a failing stop');
    expect(r.error?.message ?? '').not.toContain('stop failed on purpose');
    expect(outcome.get('onSessionStarted error survives a throwing stop')).toBe('expected');
});

test('macos through the fixture: the session start refuses it with the exact message, nothing is opened', () => {
    const r = bySpec.get('macos is refused at session start')!;
    expect(r.status).toBe('failed');
    expect(r.error?.message).toContain('Platform "macos" is declared but not implemented yet.');
    expect(events.filter(e => e.startsWith('macos '))).toEqual([]);
});

test('an unexpected failure gets failure-screenshot (image/png) and page-source (text/xml)', () => {
    const failed = bySpec.get('fails and gets evidence')!;
    expect(failed.status).toBe('failed');
    expect(names(failed)).toEqual(['failure-screenshot image/png', 'page-source text/xml']);
    const source = failed.attachments.find(a => a.name === 'page-source')!;
    expect(Buffer.from(source.body!, 'base64').toString()).toContain('<AppiumAUT>');
    const png = failed.attachments.find(a => a.name === 'failure-screenshot')!;
    expect(Buffer.from(png.body!, 'base64').toString()).toBe('png-bytes');
});

test('evidence follows the web trigger: an expected failure under test.fail() gets none, an unexpected pass gets it', () => {
    const expectedFailure = bySpec.get('expected failure under test.fail() gets no evidence')!;
    expect(expectedFailure.status).toBe('failed');
    expect(names(expectedFailure)).toEqual([]);
    const unexpectedPass = bySpec.get('unexpected pass under test.fail() gets evidence')!;
    expect(unexpectedPass.status).toBe('passed');
    expect(names(unexpectedPass)).toEqual(['failure-screenshot image/png', 'page-source text/xml']);
});

test('passing tests get no evidence', () => {
    expect(bySpec.get('passes')!.status).toBe('passed');
    expect(names(bySpec.get('passes'))).toEqual([]);
    expect(names(bySpec.get('passes again, no evidence'))).toEqual([]);
});

test('evidence that cannot be collected is skipped and never masks the test failure', () => {
    const r = bySpec.get('evidence errors never mask the failure')!;
    expect(r.status).toBe('failed');
    // eslint-disable-next-line no-control-regex
    const message = (r.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '');
    expect(message).toContain('Received: "own failure"');
    expect(message).not.toContain('unavailable');
    expect(names(r)).toEqual([]);
});

test('page and context throw PlatformNotSupportedError on a platform run (no browser started)', () => {
    expect(bySpec.get('page is refused')!.error?.message).toContain('"page" is not supported on platform "ios".');
    expect(bySpec.get('context is refused')!.error?.message).toContain('"context" is not supported on platform "ios".');
});

test('driver throws PlatformNotSupportedError on web', () => {
    expect(bySpec.get('driver is refused on web')!.error?.message).toContain('"driver" is not supported on platform "web".');
});

/** The decoded body of the `setup-error` attachment, or undefined. */
const setupError = (r: JsonResult | undefined) => {
    const a = (r?.attachments ?? []).find(x => x.name === 'setup-error');
    return a ? { contentType: a.contentType, text: Buffer.from(a.body ?? '', 'base64').toString() } : undefined;
};

test('relaunch: a launch timeout on ios is retried once, and the test then runs', () => {
    expect(bySpec.get('a launch timeout on the relaunch is retried once and the test runs')!.status).toBe('passed');
    expect(labelled('relaunch-retry').filter(e => e !== 'start' && e !== 'stop')).toEqual([
        'execute mobile: terminateApp', 'execute mobile: activateApp', 'activate launch timeout',
        'execute mobile: activateApp',
        'execute mobile: queryAppState', 'appState 4',
        'body',
    ]);
});

test('a failed relaunch attaches setup-error (error text and last app state), failure-screenshot and page-source', () => {
    const r = bySpec.get('a failed relaunch attaches the setup error, the screenshot and the page source')!;
    expect(r.status).toBe('failed');
    expect(outcome.get('a failed relaunch attaches the setup error, the screenshot and the page source')).toBe('expected');
    expect(names(r)).toEqual(['failure-screenshot image/png', 'page-source text/xml']);
    const attached = setupError(r)!;
    expect(attached.contentType).toBe('text/plain');
    expect(attached.text).toContain(`session.reset 'relaunch': app "com.example.app" is not in the foreground on platform "ios"`);
    expect(attached.text).toContain('last app state: 3, running in background');
});

test('setup evidence that cannot be collected is skipped and the setup error still fails the test', () => {
    const r = bySpec.get('setup evidence that cannot be collected never masks the setup error')!;
    expect(r.status).toBe('failed');
    expect(plain(r)).toContain('is not in the foreground on platform "ios"');
    expect(plain(r)).not.toContain('unavailable');
    expect(names(r)).toEqual([]);
    expect(setupError(r)!.text).toContain('is not in the foreground');
});

test('onSessionStarted failing attaches setup-error and the device evidence', () => {
    const r = bySpec.get('onSessionStarted throws')!;
    expect(setupError(r)!.text).toContain('onSessionStarted failed on purpose');
    expect(setupError(r)!.text).toContain('last app state: 4, running in foreground');
    expect(names(r)).toEqual(['failure-screenshot image/png', 'page-source text/xml']);
});

test('a session start that never answers fails with our error before the fixture timeout, credentials left out', () => {
    const r = bySpec.get('a session start that never answers fails with the start budget')!;
    expect(r.status).toBe('failed');
    expect(outcome.get('a session start that never answers fails with the start budget')).toBe('expected');
    const message = plain(r);
    expect(message).toContain('session start on https://appium.invalid:443/wd/hub for platform "ios": no session within 900 ms');
    expect(message).toContain('session.startTimeout 1000 ms');
    expect(message).toContain('raise session.startTimeout (default 600000 ms)');
    expect(message).not.toContain('secret-key');
    expect(message).not.toContain('someone');
    expect(message).not.toContain('timeout of 1000ms exceeded');
    expect(labelled('start-timeout')).toEqual(['start']);
});

test('drain: a lookup a check abandoned ends before the next relaunch and before the evidence; the test keeps its own error', () => {
    const passing = 'drain: a passing test that left a lookup running lets it end before the next relaunch';
    expect(outcome.get(passing)).toBe('expected');
    expect(outcome.get(DRAIN_FAILING)).toBe('unexpected');
    // The failing test's own poll error, not anything from the drain.
    expect(plain(bySpec.get(DRAIN_FAILING))).toContain('drain check lookup 2: timed out after 20 ms.');
    expect(names(bySpec.get(DRAIN_FAILING))).toEqual(['failure-screenshot image/png', 'page-source text/xml']);
    // Only the order matters: the queries of the foreground wait are left out.
    const seen = labelled('drain').filter(e => /^(start|stop|body \d|lookup \d end|screenshot|execute mobile: (terminate|activate)App)$/.test(e));
    expect(seen).toEqual([
        'start',
        'execute mobile: terminateApp', 'execute mobile: activateApp',
        'body 1', 'lookup 1 end',
        'execute mobile: terminateApp', 'execute mobile: activateApp',
        'body 2', 'lookup 2 end', 'screenshot',
        'stop',
    ]);
});

test('drain: the wait for an abandoned lookup never makes a passing test run out of its own timeout', () => {
    // Project and test timeout 600 ms; the wait takes about 1000 ms: the fixture extended the timeout by its cap.
    const title = 'drain: the wait never makes a passing test run out of its own timeout';
    expect(outcome.get(title)).toBe('expected');
    expect(bySpec.get(title)!.status).toBe('passed');
    expect(labelled('drain-timeout').filter(e => /^(start|stop|body|lookup end)$/.test(e))).toEqual(['start', 'body', 'lookup end', 'stop']);
});

/** The `drain-teardown` events of the test whose body logged the `n`-th `body` (from 0), each with its time in ms. */
function teardownEvents(n: number): Array<{ line: string; at: number }> {
    const all = labelled('drain-teardown').map(e => /^(.*) @(\d+)$/.exec(e)).filter((m): m is RegExpExecArray => m !== null)
        .map(m => ({ line: m[1], at: Number(m[2]) }));
    const bodies = all.map((e, i) => (e.line === 'body' ? i : -1)).filter(i => i >= 0);
    return all.slice(bodies[n], bodies[n + 1] ?? all.length);
}

test('drain: a later teardown fixture runs inside the slot the drain extended (project and test timeout 600 ms)', () => {
    // The drain waits 1000 ms for a call it cannot abort, then a later
    // teardown fixture sleeps 1500 ms: 2500 ms in a 600 ms slot, which only
    // the drain's extension (600 + its 10000 ms cap) holds.
    const title = 'teardown slot: a later teardown fixture runs inside the slot the drain extended';
    expect(outcome.get(title)).toBe('expected');
    expect(bySpec.get(title)!.status).toBe('passed');
    const seen = teardownEvents(0);
    expect(seen.map(e => e.line)).toEqual(['body', 'lookup end', 'later start', 'later end']);
    const at = (line: string) => seen.find(e => e.line === line)!.at;
    expect(at('later start') - at('lookup end'), 'the later fixture is torn down after the drain').toBeGreaterThanOrEqual(0);
    expect(at('later end') - at('body'), 'the teardown ran far past the 600 ms slot').toBeGreaterThanOrEqual(2400);
});

test("drain: Playwright's own teardown slot is the larger of the project and the test timeout", () => {
    // Nothing is abandoned, so the fixture extends nothing: a teardown that
    // sleeps past the larger timeout runs out of exactly that slot. A
    // Playwright that gave teardown another length (the test timeout alone,
    // the project timeout alone, their sum) fails here.
    for (const [title, slot, sleep] of [[SLOT_PIN_BELOW, 600, 800], [SLOT_PIN_ABOVE, 800, 1000]] as const) {
        const r = bySpec.get(title)!;
        expect(r.status, title).toBe('timedOut');
        expect(plain(r), title).toContain(`Tearing down "later" exceeded the test timeout of ${slot}ms.`);
        expect(r.error?.message ?? '', `${title}: the teardown sleeps ${sleep} ms`).not.toContain('Test timeout of');
    }
    expect(teardownEvents(1).map(e => e.line)).toEqual(['body', 'later start']);
    expect(teardownEvents(2).map(e => e.line)).toEqual(['body', 'later start']);
});
