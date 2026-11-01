import { ElementInteractions } from '../interactions/facade/ElementInteractions';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { EmailClientConfig } from '@civitas-cerebrum/email-client';
import { ContextStore } from '@civitas-cerebrum/context-store';

import { test as base, BrowserContext, Page } from '@playwright/test';
import { Steps } from '../steps/CommonSteps';
import { log } from '../logger/Logger';

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
     * Forward browser-level mutation injection to every page and frame of the
     * test's browser context. Behavioural mutation runners (e.g.
     * `achilles-mutate`) set a payload per mutation run; with this option on,
     * the fixture applies it so the project needs no hand-written hook:
     *
     * - `E2E_MUTATION_RUN` — the explicit opt-in. Nothing is injected unless
     *   it is `1`/`true`/`yes`; the other two variables are then reported as
     *   ignored (`log.warn` plus a `mutation-injection-ignored` annotation).
     * - `E2E_MUTATION_INIT` — a JS string, added with
     *   `context.addInitScript({ content })`, so it runs before the page's own
     *   scripts in every page and child frame.
     * - `E2E_MUTATION_CSS` — a CSS string, adopted as a constructable
     *   stylesheet from an init script of its own: in place before the first
     *   script of the document, unaffected by a `style-src`
     *   Content-Security-Policy, and not dependent on a `load` event.
     *
     * A mutated run is never silent: activation logs a warning and pushes a
     * `mutation-injection` annotation, every page load is sampled for proof
     * that the injection applied, and anything unprovable is reported as a
     * `mutation-injection-error` annotation — so a failure is never
     * misattributed to the application under test.
     *
     * - `true` — inject and report.
     * - `{ strict: true }` — additionally *fail* the test when a non-empty
     *   injection cannot be proven to have applied (malformed init JS, CSS
     *   that parses to no rules, a stylesheet the browser refused, or no
     *   document reporting the injection), rather than scoring the run as a
     *   surviving mutant.
     *
     * Inert when the opt-in or the payload is absent (the runner's `noop`
     * control). Default: `false`.
     */
    mutationInjection?: boolean | { strict?: boolean };
}

/** Mutation injection read from the environment; empty or whitespace-only values are absent. */
export interface MutationInjection {
    init?: string;
    css?: string;
}

/** Behaviour knobs for {@link forwardMutationInjection}. */
export interface MutationInjectionOptions {
    /**
     * Fail instead of warning when a non-empty injection cannot be proven to
     * have applied — malformed `E2E_MUTATION_INIT`, CSS that parses to no
     * rules, a stylesheet the browser refused to adopt, or no document
     * reporting the injection at all.
     */
    strict?: boolean;
}

/**
 * The live injection, plus the read-back that proves it applied. Returned by
 * {@link forwardMutationInjection}; `baseFixture` calls `verify()` when the
 * test ends.
 */
export interface MutationInjectionHandle {
    /** What was forwarded. Empty object when the injection was inert. */
    injection: MutationInjection;
    /**
     * Samples every open page's self-report and returns one human-readable
     * line per problem found during the whole run. Empty array means the
     * injection is proven to have been applied in at least one document.
     */
    verify(): Promise<string[]>;
}

/** The explicit opt-in. Without it `E2E_MUTATION_INIT` / `E2E_MUTATION_CSS` are ignored. */
export const MUTATION_RUN_VAR = 'E2E_MUTATION_RUN';
const MUTATION_INIT_VAR = 'E2E_MUTATION_INIT';
const MUTATION_CSS_VAR = 'E2E_MUTATION_CSS';
/** Window property the in-page applier writes its self-report to. */
const MUTATION_REPORT_KEY = '__eiMutationInjection';

/** The in-page report, projected to serialisable fields. */
interface PageMutationReport {
    cssRequested: boolean;
    cssApplied: boolean;
    cssRuleCount: number;
    cssError?: string;
    /** Rules carrying a selector (`@media` and friends excluded). */
    selectors: number;
    /** How many of those selectors match something in this document right now. */
    matched: number;
}

/**
 * Pushes a report-visible annotation when running inside a Playwright test.
 * No-ops outside a test-runner context (library consumers driving a raw
 * `BrowserContext`), where the `log.warn` line is the only signal.
 */
function annotateMutation(type: string, description: string): void {
    try {
        // test.info() throws when no test is running; the catch is the guard
        // that makes this a no-op for library consumers.
        base.info().annotations.push({ type, description });
    } catch {
        /* not in a test context — the log.warn is the only signal */
    }
}

/**
 * Reads `E2E_MUTATION_INIT` / `E2E_MUTATION_CSS` from `env` (default
 * `process.env`) — but only when the run is explicitly opted in with
 * `E2E_MUTATION_RUN` (`1`/`true`/`yes`).
 *
 * Without the opt-in, present-but-ignored variables are reported (`log.warn`
 * plus a `mutation-injection-ignored` annotation) and `{}` is returned. That
 * is the guard against a value left behind by an earlier mutation run in the
 * same CI job, exported by a shell profile, or committed to a `.env` that this
 * package's `dotenv` call loads — any of which would otherwise mutate a normal
 * run with nothing in the report to say so.
 */
export function readMutationInjection(env: NodeJS.ProcessEnv = process.env): MutationInjection {
    const init = env[MUTATION_INIT_VAR]?.trim();
    const css = env[MUTATION_CSS_VAR]?.trim();
    const present = [init ? MUTATION_INIT_VAR : '', css ? MUTATION_CSS_VAR : ''].filter(Boolean);
    if (present.length === 0) return {};

    const optIn = env[MUTATION_RUN_VAR]?.trim().toLowerCase();
    if (!optIn || optIn === '0' || optIn === 'false' || optIn === 'no') {
        const detail = `${present.join(' and ')} ${present.length > 1 ? 'are' : 'is'} set but ${MUTATION_RUN_VAR} is not — `
            + `ignoring them: this run is NOT mutated. A mutation runner must set ${MUTATION_RUN_VAR}=1 alongside the payload, `
            + `so a leftover value from a previous run, a shell profile or a committed .env cannot silently mutate a normal run.`;
        log.warn(detail);
        annotateMutation('mutation-injection-ignored', detail);
        return {};
    }
    return { ...(init ? { init } : {}), ...(css ? { css } : {}) };
}

/**
 * Source of the in-page applier. Attaches the CSS through CSSOM — a
 * constructable stylesheet adopted by the document — and records what
 * happened on `window.__eiMutationInjection`.
 *
 * CSSOM rather than `page.addStyleTag`, for three reasons the style-element
 * route gets wrong: a `Content-Security-Policy: style-src 'self'` header
 * blocks an inline `<style>` (the element lands, the rules never apply) while
 * leaving CSSOM untouched; running from an init script means the rules are in
 * place before the document's first script instead of on `load`, which never
 * fires while a subresource hangs; and parse failures become an observable
 * `cssError`/`cssRuleCount` instead of a browser-side shrug.
 */
function mutationApplierSource(injection: MutationInjection): string {
    return `(() => {
    const report = { cssRequested: ${JSON.stringify(Boolean(injection.css))}, cssApplied: false, cssRuleCount: 0 };
    const css = ${JSON.stringify(injection.css ?? '')};
    if (css) {
        try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(css);
            report.cssRuleCount = sheet.cssRules.length;
            if (report.cssRuleCount === 0) throw new Error('the CSS parsed to zero rules — check it is valid CSS');
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
            report.cssApplied = true;
            report.sheet = sheet;
        } catch (error) {
            report.cssError = (error && error.message) ? error.message : String(error);
        }
    }
    try { window[${JSON.stringify(MUTATION_REPORT_KEY)}] = report; } catch (error) { /* locked-down window */ }
})();`;
}

/** Expression that projects the in-page report, including live selector matches. */
const MUTATION_READBACK_SOURCE = `(() => {
    const report = window[${JSON.stringify(MUTATION_REPORT_KEY)}];
    if (!report) return null;
    let selectors = 0;
    let matched = 0;
    try {
        const rules = report.sheet ? report.sheet.cssRules : [];
        for (const rule of rules) {
            if (!rule.selectorText) continue;
            selectors++;
            try { if (document.querySelector(rule.selectorText)) matched++; } catch (error) { matched++; }
        }
    } catch (error) { /* sheet unreadable — the applied flag is the proof that matters */ }
    return {
        cssRequested: report.cssRequested,
        cssApplied: report.cssApplied,
        cssRuleCount: report.cssRuleCount,
        cssError: report.cssError,
        selectors,
        matched,
    };
})()`;

/**
 * Applies mutation injection to a browser context: the init script to every
 * page and child frame created or navigated from now on, and the CSS through
 * CSSOM from an init script of its own — so it is in place before the
 * document's first script, survives a `load` event that never fires, and is
 * not blocked by a `style-src` Content-Security-Policy. Pages that already
 * exist get the CSS applied to their current document immediately; their
 * current document cannot receive the init script (nothing can run "before
 * the page's scripts" in a document that already ran them), only their next
 * navigation does.
 *
 * A non-empty injection is announced — `log.warn` plus a `mutation-injection`
 * annotation — so no run is ever mutated without the report saying so, and
 * every page load is sampled for proof that it took. Failures are surfaced:
 * `log.warn` plus a `mutation-injection-error` annotation, and, with
 * `{ strict: true }`, a thrown error from here (malformed init) or from
 * `verify()` (CSS that never applied).
 *
 * A no-op when `injection` is empty.
 */
export async function forwardMutationInjection(
    context: BrowserContext,
    injection: MutationInjection = readMutationInjection(),
    options: MutationInjectionOptions = {},
): Promise<MutationInjectionHandle> {
    const { init, css } = injection;
    const strict = options.strict === true;
    if (!init && !css) return { injection, verify: async () => [] };

    const problems: string[] = [];
    const record = (message: string): void => {
        if (problems.includes(message)) return;
        problems.push(message);
        log.warn(message);
        annotateMutation('mutation-injection-error', message);
    };
    const warnOnly = (message: string): void => {
        log.warn(message);
        annotateMutation('mutation-injection-warning', message);
    };

    const parts = [init ? `init script (${init.length} chars)` : '', css ? `CSS (${css.length} chars)` : ''].filter(Boolean);
    const active = `mutation injection ACTIVE — this run is mutated: ${parts.join(' and ')}. `
        + `A failure in this test may be the injected mutation rather than a defect in the application under test.`;
    log.warn(active);
    annotateMutation('mutation-injection', active);

    if (init) {
        try {
            // Compiles without executing: a SyntaxError surfaces here, in Node,
            // instead of only as a page error the test never looks at.
            new Function(init);
        } catch (error) {
            const message = `${MUTATION_INIT_VAR} is not valid JavaScript (${error instanceof Error ? error.message : String(error)}) — `
                + `it throws inside the page and injects nothing.`;
            if (strict) {
                log.warn(message);
                annotateMutation('mutation-injection-error', message);
                throw new Error(`mutationInjection (strict): ${message}`);
            }
            record(message);
        }
    }

    await context.addInitScript({ content: mutationApplierSource(injection) });
    if (init) await context.addInitScript({ content: init });

    let sawDocument = false;
    let sawSelectors = false;
    let everMatched = false;

    const sample = async (page: Page, reportReadFailure = false): Promise<void> => {
        if (page.isClosed()) return;
        const report = await page.evaluate<PageMutationReport | null>(MUTATION_READBACK_SOURCE)
            .catch((error: unknown) => {
                // Mid-navigation or closing: the load sampler gets another turn,
                // and `verify()` says so out loud rather than reading nothing.
                if (reportReadFailure) {
                    warnOnly(`could not read the mutation injection report from ${page.url()} `
                        + `(${error instanceof Error ? error.message.split('\n')[0] : String(error)}) — this page is unverified.`);
                }
                return undefined;
            });
        if (!report) return;
        sawDocument = true;
        if (report.cssRequested && !report.cssApplied) {
            record(`the mutation CSS did not apply in ${page.url()} — ${report.cssError ?? 'no reason reported'}`);
        }
        if (report.selectors > 0) sawSelectors = true;
        if (report.matched > 0) everMatched = true;
    };

    if (css) {
        // Already-open pages never ran the init script for their current
        // document, so apply it there by hand.
        for (const page of context.pages()) {
            await page.evaluate(mutationApplierSource(injection)).catch((error: unknown) => {
                warnOnly(`could not apply the mutation CSS to the already-open ${page.url()} `
                    + `(${error instanceof Error ? error.message.split('\n')[0] : String(error)}) — its next navigation will carry it.`);
            });
        }
    }
    if (init) {
        const loaded = context.pages().filter(page => page.url() !== 'about:blank');
        if (loaded.length > 0) {
            warnOnly(`${MUTATION_INIT_VAR} cannot reach a document that has already run its scripts — `
                + `${loaded.length} page(s) open before forwarding keep their current document unmutated until the next navigation.`);
        }
    }

    const watch = (page: Page) => { page.on('load', () => { void sample(page); }); };
    context.pages().forEach(watch);
    context.on('page', watch);

    return {
        injection,
        async verify(): Promise<string[]> {
            for (const page of context.pages()) await sample(page, true);
            if (!sawDocument) {
                record(`the mutation injection never reached a document — no page in the context reported it, so nothing was mutated.`);
            }
            if (css && sawSelectors && !everMatched) {
                // A warning, not a failure: an SPA can add the targeted node
                // between the samples, and a pseudo-element selector never
                // matches `querySelector` even though it styles the page.
                warnOnly(`the mutation CSS was applied but none of its selectors matched an element in any document sampled `
                    + `during this run — the mutation may have been a no-op, which would be scored as a surviving mutant.`);
            }
            return [...problems];
        },
    };
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
 *   (forward an opted-in `E2E_MUTATION_INIT` / `E2E_MUTATION_CSS` payload to every
 *   page and frame of the context, announcing and verifying it).
 * @returns A new Playwright `test` object exposing the StepFixture surface.
 */
export function baseFixture<T extends {}>(
    baseTest: ReturnType<typeof base.extend<T>>,
    locatorPath: string,
    options?: BaseFixtureOptions
) {
    const mutationConfig = options?.mutationInjection ?? false;
    const mutationEnabled = mutationConfig !== false;
    const mutationStrict = typeof mutationConfig === 'object' ? mutationConfig.strict === true : false;

    const screenshotConfig = options?.screenshotOnFailure ?? true;
    const screenshotEnabled = screenshotConfig !== false;
    const screenshotFullPage = typeof screenshotConfig === 'object'
        ? (screenshotConfig.fullPage ?? true)
        : true;

    return (baseTest as typeof base).extend<StepFixture>({
        context: async ({ context }, use) => {
            if (!mutationEnabled) {
                await use(context);
                return;
            }
            const mutation = await forwardMutationInjection(context, readMutationInjection(), { strict: mutationStrict });
            await use(context);
            const problems = await mutation.verify();
            // Already logged and annotated one by one; strict turns them into a
            // failure so an injection that never applied cannot be scored as a
            // surviving mutant.
            if (problems.length > 0 && mutationStrict) {
                throw new Error(`mutationInjection (strict): the injection cannot be proven to have applied:\n- ${problems.join('\n- ')}`);
            }
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