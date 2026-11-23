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
interface JsonTest { expectedStatus: string; results: JsonResult[] }
interface JsonSpec { title: string; tests: JsonTest[] }
interface JsonSuite { specs?: JsonSpec[]; suites?: JsonSuite[] }

function specs(suite: JsonSuite): JsonSpec[] {
    return [...(suite.specs ?? []), ...(suite.suites ?? []).flatMap(specs)];
}

const ROOT = path.resolve(__dirname, '..');
let bySpec: Map<string, JsonResult>;
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
    events = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n') : [];
    fs.rmSync(dir, { recursive: true, force: true });
});

/** The evidence attachments (Playwright's own `error-context` and the like left out). */
const names = (r: JsonResult | undefined) => (r?.attachments ?? [])
    .filter(a => a.name === 'failure-screenshot' || a.name === 'page-source')
    .map(a => `${a.name} ${a.contentType}`).sort();

test('the nested run is green (expected failures included)', () => {
    expect(exitCode).toBe(0);
    expect(bySpec.size).toBe(7);
});

test('one session per worker: started once, stopped once at worker teardown, relaunch before every test', () => {
    expect(events.filter(e => e === 'start')).toHaveLength(1);
    expect(events.filter(e => e === 'stop')).toHaveLength(1);
    expect(events.at(-1)).toBe('stop');
    // Six platform tests, each preceded by terminate + activate.
    expect(events.filter(e => e === 'execute mobile: terminateApp')).toHaveLength(6);
    expect(events.filter(e => e === 'execute mobile: activateApp')).toHaveLength(6);
});

test('a failed test gets failure-screenshot (image/png) and page-source (text/xml)', () => {
    const failed = bySpec.get('fails and gets evidence')!;
    expect(failed.status).toBe('failed');
    expect(names(failed)).toEqual(['failure-screenshot image/png', 'page-source text/xml']);
    const source = failed.attachments.find(a => a.name === 'page-source')!;
    expect(Buffer.from(source.body!, 'base64').toString()).toContain('<AppiumAUT>');
    const png = failed.attachments.find(a => a.name === 'failure-screenshot')!;
    expect(Buffer.from(png.body!, 'base64').toString()).toBe('png-bytes');
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
