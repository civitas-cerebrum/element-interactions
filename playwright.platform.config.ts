import { defineConfig } from '@playwright/test';

/**
 * Platform runs (CONTRACT C1, C2): the cross-platform spec and the live device
 * checks against an Appium server. The only start form:
 *
 *   PLATFORM=<platform> CAPABILITIES=<capabilities-file> APPIUM_URL=<appium-server-url-with-base-path> \
 *     npx playwright test -c playwright.platform.config.ts [tests/cross-platform | tests/live]
 *
 * One device session per worker, so one worker. Long timeouts: the first
 * gesture of a fresh iOS session can take 15-30 s. No `use.baseURL`: a device
 * run opens no browser. (The cross-platform spec's web run belongs to the
 * default config, `npm run test:unit`, which has the test site's baseURL.)
 */
export default defineConfig({
    testDir: './tests',
    testMatch: ['cross-platform/**/*.spec.ts', 'live/**/*.spec.ts'],
    workers: 1,
    fullyParallel: false,
    retries: 0,
    timeout: 180_000,
    expect: { timeout: 30_000 },
    reporter: [['list'], ['html', { open: 'never' }]],
});
