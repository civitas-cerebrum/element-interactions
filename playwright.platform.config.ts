import { defineConfig } from '@playwright/test';
import { resolvePlatform } from './src';

/**
 * Platform runs: the cross-platform spec and the live device
 * checks against an Appium server. The only start form:
 *
 *   E2E_PLATFORM=<platform> E2E_CAPABILITIES=<capabilities-file> APPIUM_URL=<appium-server-url-with-base-path> \
 *     npx playwright test -c playwright.platform.config.ts [tests/cross-platform | tests/live]
 *
 * One device session per worker, so one worker. Long timeouts: the first
 * gesture of a fresh iOS session can take 15-30 s. No `use.baseURL`: a device
 * run opens no browser. (The cross-platform spec's web run belongs to the
 * default config, `npm run test:unit`, which has the test site's baseURL.)
 *
 * CI may need more headroom than 180 s (an iOS simulator builds
 * WebDriverAgent on first use): pass Playwright's `--timeout <ms>` on the
 * command line rather than editing this file.
 */
const platform = resolvePlatform(undefined);
if (platform === 'web') {
    throw new Error(
        'playwright.platform.config.ts runs device platforms only, but the platform resolved to "web" (E2E_PLATFORM unset, empty or "web"). '
        + 'Set E2E_PLATFORM=ios or E2E_PLATFORM=android with E2E_CAPABILITIES and APPIUM_URL; '
        + 'the web run of tests/cross-platform belongs to the default config (npx playwright test tests/cross-platform).',
    );
}

export default defineConfig({
    testDir: './tests',
    testMatch: ['cross-platform/**/*.spec.ts', 'live/**/*.spec.ts'],
    // Pure unit tests of the Settings guard: they open no session, so they run
    // in the default web suite only, never against a device.
    testIgnore: ['cross-platform/settingsGuard.spec.ts'],
    workers: 1,
    fullyParallel: false,
    retries: 0,
    timeout: 180_000,
    expect: { timeout: 30_000 },
    reporter: [['list'], ['html', { open: 'never' }]],
});
