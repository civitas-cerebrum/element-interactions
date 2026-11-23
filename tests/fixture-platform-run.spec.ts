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

interface JsonResult { status: string; error?: { message?: string }; attachments: Array<{ name: string; contentType: string; body?: string }> }
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
    for (const key of ['PLATFORM', 'CAPABILITIES', 'APPIUM_URL', 'APPIUM_USER', 'APPIUM_KEY', 'TEST_WORKER_INDEX', 'TEST_PARALLEL_INDEX']) delete env[key];
    const run = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '-c', 'tests/fixture-platform/playwright.config.ts'], {
        cwd: ROOT, env, encoding: 'utf-8', timeout: 120_000,
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
const UNEXPECTED = ['evidence errors never mask the failure', 'fails and gets evidence', 'unexpected pass under test.fail() gets evidence'];

test('the nested run ends unexpectedly exactly where it is built to', () => {
    expect(bySpec.size).toBe(11);
    expect([...outcome].filter(([, status]) => status !== 'expected').map(([title]) => title).sort()).toEqual(UNEXPECTED);
    expect([...outcome].filter(([, status]) => status === 'unexpected').map(([title]) => title).sort()).toEqual(UNEXPECTED);
    expect(exitCode).toBe(1);
});

/** Lifecycle events of the main ios session (the labelled sessions of other files left out). */
const mainEvents = () => events.filter(e => !/^(hook-throws|macos) /.test(e));

test('one session per worker: started once, stopped once at worker teardown, relaunch before every test', () => {
    const main = mainEvents();
    // Playwright replaces the worker after each unexpected outcome: one worker
    // for the first tests, then one more after each of the three unexpected ones.
    const lifecycle = main.filter(e => e === 'start' || e === 'stop');
    expect(lifecycle).toEqual(Array.from({ length: 1 + UNEXPECTED.length }, () => ['start', 'stop']).flat());
    expect(main.at(-1)).toBe('stop');
    // Eight platform tests, each preceded by terminate + activate.
    expect(main.filter(e => e === 'execute mobile: terminateApp')).toHaveLength(8);
    expect(main.filter(e => e === 'execute mobile: activateApp')).toHaveLength(8);
});

test('onSessionStarted throwing still stops the session, and its error fails the test', () => {
    expect(events.filter(e => e.startsWith('hook-throws '))).toEqual(['hook-throws start', 'hook-throws stop']);
    const r = bySpec.get('onSessionStarted throws')!;
    expect(r.status).toBe('failed');
    expect(r.error?.message).toContain('onSessionStarted failed on purpose');
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
