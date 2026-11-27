import { defineConfig } from '@playwright/test';
import * as os from 'os';
import * as path from 'path';

/**
 * Nested run for tests/fixture-platform-run.spec.ts: drives baseFixture end to
 * end (worker teardown, failure evidence, fixture errors) and is read back
 * through the JSON reporter. Not part of the main suite (`*.pw.ts`).
 */
export default defineConfig({
    testDir: '.',
    testMatch: '*.pw.ts',
    workers: 1,
    retries: 0,
    reporter: 'json',
    outputDir: path.join(os.tmpdir(), 'ei-fixture-platform-nested'),
    use: {
        // Any browser launch fails: the fixtures under test must not start one.
        launchOptions: { executablePath: '/nonexistent/browser' },
    },
    projects: [
        { name: 'default', testIgnore: 'drain-timeout.pw.ts' },
        // A project timeout shorter than one wait for an abandoned lookup.
        { name: 'short-timeout', testMatch: 'drain-timeout.pw.ts', timeout: 600 },
    ],
});
