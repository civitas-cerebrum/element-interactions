import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { EmailClientConfig } from '@civitas-cerebrum/email-client';
import { ContextStore } from '@civitas-cerebrum/context-store';

import { test as base } from '@playwright/test';
import { Steps } from '../steps/CommonSteps';

type StepFixture = {
    interactions: ElementInteractions;
    contextStore: ContextStore;
    repo: ElementRepository;
    steps: Steps;
};

export interface BaseFixtureOptions {
    /** Email credentials for the email client (SMTP/IMAP). */
    emailCredentials?: EmailClientConfig;
    /**
     * Element timeout in milliseconds for all Steps and Interactions methods
     * (click, hover, fill, verify, etc.). Default: `30000`.
     */
    timeout?: number;
    /**
     * Element resolution timeout in milliseconds for the ElementRepository.
     * Controls how long `repo.get()` waits for an element to be attached before returning.
     * Default: `15000`.
     */
    repoTimeout?: number;
    /**
     * Regex pattern of origins to block. Routes matching this pattern are aborted
     * before each test. Useful for blocking tracking, analytics, or third-party scripts
     * that slow down tests.
     *
     * @example
     * ```ts
     * blockedOrigins: /(googletagmanager\.com|posthog\.com|klaviyo\.com)/
     * ```
     */
    blockedOrigins?: RegExp;
    /**
     * Configure automatic screenshots on test failure.
     * - `true` — capture full-page screenshot (default behavior)
     * - `false` — disable failure screenshots
     * - `{ fullPage?: boolean }` — configure screenshot options
     *
     * Default: `{ fullPage: true }`
     */
    screenshotOnFailure?: boolean | { fullPage?: boolean };
    /**
     * Base URL for the default API client. When set, `steps.apiGet/apiPost/...`
     * can be called without a provider name and will dispatch against this URL.
     *
     * @example `apiBaseUrl: 'https://api.example.com'`
     */
    apiBaseUrl?: string;
    /**
     * Named API providers for multi-service testing. Each entry creates a
     * separate `WasapiClient` accessible by name: `steps.apiGet('billing', '/users')`.
     *
     * @example
     * ```ts
     * apiProviders: {
     *   billing: 'https://billing.example.com',
     *   auth: 'https://auth.example.com',
     * }
     * ```
     */
    apiProviders?: Record<string, string>;
}

/**
 * Extends a Playwright `test` with the StepFixture surface — `repo`, `steps`,
 * `interactions`, `contextStore`, and a `page` wrapper that attaches a failure
 * screenshot on every failed test.
 *
 * @param baseTest - The Playwright `test` (or an already-extended test) to build on.
 * @param locatorPath - Absolute or project-relative path to `page-repository.json`.
 * @param options - Optional fixture overrides: `timeout` (element-op default, 30000ms),
 *   `repoTimeout` (element resolution, 15000ms), `emailCredentials`,
 *   `blockedOrigins` (route filter), `screenshotOnFailure`.
 * @returns A new Playwright `test` object exposing the StepFixture surface.
 */
export function baseFixture<T extends {}>(
    baseTest: ReturnType<typeof base.extend<T>>,
    locatorPath: string,
    options?: BaseFixtureOptions
) {
    const screenshotConfig = options?.screenshotOnFailure ?? true;
    const screenshotEnabled = screenshotConfig !== false;
    const screenshotFullPage = typeof screenshotConfig === 'object'
        ? (screenshotConfig.fullPage ?? true)
        : true;

    return (baseTest as typeof base).extend<StepFixture>({
        repo: async ({ page }, use) => {
            await use(new ElementRepository(page, locatorPath, options?.repoTimeout));
        },
        steps: async ({ repo }, use) => {
            await use(new Steps(repo, {
                emailCredentials: options?.emailCredentials,
                timeout: options?.timeout,
                apiBaseUrl: options?.apiBaseUrl,
                apiProviders: options?.apiProviders,
            }));
        },
        interactions: async ({ page }, use) => {
            await use(new ElementInteractions(page, { emailCredentials: options?.emailCredentials, timeout: options?.timeout }));
        },
        contextStore: async ({ }, use) => {
            await use(new ContextStore());
        },
        page: async ({ page }, use, testInfo) => {
            if (options?.blockedOrigins) {
                await page.route(options.blockedOrigins, (route) => route.abort());
            }
            await use(page);
            if (screenshotEnabled && testInfo.status !== testInfo.expectedStatus) {
                const screenshot = await page.screenshot({ fullPage: screenshotFullPage });
                await testInfo.attach('failure-screenshot', {
                    body: screenshot,
                    contentType: 'image/png',
                });
            }
        },
    });
}