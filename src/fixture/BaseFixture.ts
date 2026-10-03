import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { EmailClientConfig } from '@civitas-cerebrum/email-client';
import { ContextStore } from '@civitas-cerebrum/context-store';

import { test as base, BrowserContext, Page } from '@playwright/test';
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
     * When a click is intercepted by an overlaying element, retry it as a
     * dispatched DOM click event. Default `true` (compat). Set `false` so
     * genuine overlay bugs (stuck modals, cookie walls) fail the click —
     * recommended for adversarial/bug-discovery suites.
     */
    interceptionRetry?: boolean;
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
    /**
     * Connection string for the default SQL client. When set, `steps.sqlQuery/
     * sqlExecute/...` can be called without a provider name.
     *
     * @example `dbUrl: 'postgres://bookhive:bookhive@localhost:5432/bookhive'`
     */
    dbUrl?: string;
    /**
     * Named SQL connections for multi-database testing. Each entry creates a
     * separate `SqlClient` accessible by name: `steps.sqlQuery('analytics', sql)`.
     */
    dbProviders?: Record<string, string>;
    /**
     * Connect-timeout (ms) applied to every SQL client, so an unreachable `dbUrl`
     * fails fast in CI instead of hanging on the first query.
     *
     * @example `dbConnectTimeoutMs: 5000`
     */
    dbConnectTimeoutMs?: number;
    /**
     * Forward browser-level mutation injection to every page of the test's
     * browser context — the main page and any popup or new tab it opens.
     * Behavioural mutation runners (e.g. `achilles-mutate`) set two
     * environment variables per mutation run; with this option on, the fixture
     * applies them so the project needs no hand-written hook:
     *
     * - `E2E_MUTATION_INIT` — a JS string, added with
     *   `context.addInitScript({ content })` — the explicit object form the
     *   mutation runner documents.
     * - `E2E_MUTATION_CSS` — a CSS string, added with `page.addStyleTag` on
     *   every `load` of every page in the context.
     *
     * Inert when both variables are unset or empty (the runner's `noop`
     * control), so it is safe to leave on permanently. Default: `false`.
     */
    mutationInjection?: boolean;
}

/** Mutation injection read from the environment; empty or whitespace-only values are absent. */
export interface MutationInjection {
    init?: string;
    css?: string;
}

/** Reads `E2E_MUTATION_INIT` / `E2E_MUTATION_CSS` from `env` (default `process.env`). */
export function readMutationInjection(env: NodeJS.ProcessEnv = process.env): MutationInjection {
    const init = env.E2E_MUTATION_INIT?.trim();
    const css = env.E2E_MUTATION_CSS?.trim();
    return { ...(init ? { init } : {}), ...(css ? { css } : {}) };
}

/**
 * Applies mutation injection to a browser context: the init script to every
 * page created from now on, and the CSS to every page (existing and future)
 * on each `load`. The CSS reaches top-level pages and popups, not child
 * iframes (the init script does). A no-op when `injection` is empty.
 */
export async function forwardMutationInjection(context: BrowserContext, injection: MutationInjection = readMutationInjection()): Promise<void> {
    const { init, css } = injection;
    if (init) await context.addInitScript({ content: init });
    if (css) {
        const attach = (page: Page) => {
            page.on('load', () => { page.addStyleTag({ content: css }).catch(() => {}); });
        };
        context.pages().forEach(attach);
        context.on('page', attach);
    }
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
 *   `blockedOrigins` (route filter), `screenshotOnFailure`, `mutationInjection`
 *   (forward `E2E_MUTATION_INIT` / `E2E_MUTATION_CSS` to every page of the context).
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
        context: async ({ context }, use) => {
            if (options?.mutationInjection) await forwardMutationInjection(context);
            await use(context);
        },
        repo: async ({ page }, use) => {
            await use(new ElementRepository(page, locatorPath, options?.repoTimeout));
        },
        steps: async ({ repo }, use) => {
            const steps = new Steps(repo, {
                emailCredentials: options?.emailCredentials,
                timeout: options?.timeout,
                interceptionRetry: options?.interceptionRetry,
                apiBaseUrl: options?.apiBaseUrl,
                apiProviders: options?.apiProviders,
                dbUrl: options?.dbUrl,
                dbProviders: options?.dbProviders,
                dbConnectTimeoutMs: options?.dbConnectTimeoutMs,
            });
            await use(steps);
            await steps.closeDbConnections();
        },
        interactions: async ({ page }, use) => {
            await use(new ElementInteractions(page, { emailCredentials: options?.emailCredentials, timeout: options?.timeout, interceptionRetry: options?.interceptionRetry }));
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