import { test, expect } from './fixture/StepFixture';
import type { Page } from '@playwright/test';
import { Element, ElementRepository, WebElement } from '@civitas-cerebrum/element-repository';
import * as http from 'http';
import * as net from 'net';
import type { AddressInfo } from 'net';
import { Steps } from '../src';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

/**
 * `steps.forPage(page)` binds a `Steps` to a popup / new tab without the test
 * constructing an `ElementRepository` itself. Both documents are served by a
 * context route (no server required); the popup is a real `target="_blank"`
 * window, so the new page arrives through `switchToNewTab` exactly as a
 * third-party popup would.
 */

const ORIGIN = 'https://shop.example';

const SHOP = `
    <main>
        <h1>Checkout</h1>
        <a href="/wallet" target="_blank" data-testid="wallet">Pay with wallet</a>
    </main>
`;

const WALLET = `
    <main>
        <h1>Sign in to your wallet</h1>
        <div style="position:relative;display:inline-block">
            <button type="button" data-testid="covered" onclick="window.__covered = (window.__covered || 0) + 1">Covered action</button>
            <div style="position:absolute;inset:0" data-testid="overlay"></div>
        </div>
        <a href="#" data-testid="cancel" onclick="window.close(); return false;">Cancel and return</a>
    </main>
`;

const REPOSITORY = {
    pages: [
        {
            name: 'CheckoutPage',
            elements: [
                { elementName: 'heading', selector: { role: 'heading', name: 'Checkout' } },
                { elementName: 'walletButton', selector: { css: "[data-testid='wallet']" } },
            ],
        },
        {
            name: 'WalletPopup',
            elements: [
                { elementName: 'heading', selector: { role: 'heading', name: { regex: 'sign in', flags: 'i' } } },
                { elementName: 'cancelLink', selector: { role: 'link', name: 'Cancel and return' } },
                { elementName: 'coveredButton', selector: { css: "[data-testid='covered']" } },
                // Primary never renders: resolution probes it for the repository's timeout, then falls back.
                { elementName: 'slowFallback', selector: { css: "[data-testid='never-rendered']", fallback: { css: "[data-testid='cancel']" } } },
                // Deliberately matches the OPENER's wallet link and nothing on the
                // popup: a Steps mis-bound to the opener resolves it and the
                // "rejects" assertions below fail instead of passing by accident.
                { elementName: 'openerOnlyLink', selector: { css: "[data-testid='wallet']" } },
            ],
        },
    ],
};

const STEP_TIMEOUT = 1500;

async function checkoutSteps(page: Page, options: ConstructorParameters<typeof Steps>[1] = { timeout: STEP_TIMEOUT }): Promise<Steps> {
    return (await checkoutWithRepo(page, options)).steps;
}

async function checkoutWithRepo(page: Page, options: ConstructorParameters<typeof Steps>[1]): Promise<{ steps: Steps; repo: ElementRepository }> {
    await page.context().route(`${ORIGIN}/**`, (route) => {
        const body = new URL(route.request().url()).pathname === '/wallet' ? WALLET : SHOP;
        return route.fulfill({ contentType: 'text/html', body });
    });
    const repo = new ElementRepository(page, REPOSITORY, 5000);
    const steps = new Steps(repo, options);
    await steps.navigateTo(`${ORIGIN}/checkout`);
    return { steps, repo };
}

async function openWallet(steps: Steps): Promise<Page> {
    return steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage'));
}

test.describe('steps.forPage — popup / new-tab binding', () => {

    test('resolves repository entries on the popup by name', async ({ page }) => {
        const steps = await checkoutSteps(page);
        const popup = await steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage'));
        const popupSteps = steps.forPage(popup);

        await popupSteps.verifyPresence('heading', 'WalletPopup');
        await popupSteps.verifyText('cancelLink', 'WalletPopup', 'Cancel and return');
        expect(popupSteps.getCurrentPath()).toBe('/wallet');

        // The original Steps is still bound to the checkout page.
        await steps.verifyPresence('heading', 'CheckoutPage');
        expect(steps.getCurrentPath()).toBe('/checkout');
        log('forPage: popup resolution by repository name — passed');
    });

    test('acts on the popup and leaves the opener untouched', async ({ page }) => {
        const steps = await checkoutSteps(page);
        const popup = await steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage'));
        expect(steps.getTabCount()).toBe(2);

        const closed = popup.waitForEvent('close');
        await steps.forPage(popup).click('cancelLink', 'WalletPopup');
        await closed;

        expect(steps.getTabCount()).toBe(1);
        await steps.verifyPresence('walletButton', 'CheckoutPage');
        log('forPage: action on popup — passed');
    });

    test('shares the step timeout with the original Steps', async ({ page }) => {
        const steps = await checkoutSteps(page);
        const popup = await steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage'));
        const started = Date.now();
        // `openerOnlyLink` exists on the opener only, so this rejection is also
        // proof of binding — and the reason is asserted, so a target-closed or
        // rebind failure cannot stand in for the visibility timeout under test.
        await expect(steps.forPage(popup).verifyPresence('openerOnlyLink', 'WalletPopup'))
            .rejects.toThrow(/WalletPopup\.openerOnlyLink visible to be true[\s\S]*element\(s\) not found/);
        // STEP_TIMEOUT is shared (plus the 2s attach cap and CI jitter) — the
        // 30s package default would blow this ceiling.
        expect(Date.now() - started).toBeLessThan(STEP_TIMEOUT + 6000);
        log('forPage: shared timeout — passed');
    });

    test('fails loudly when the repository driver cannot be rebound', async ({ page }) => {
        // A repository whose driver getter ignores the rebinding (e.g. a future
        // internal rename) must not silently hand back steps acting on the opener.
        class LockedDriverRepository extends ElementRepository {
            constructor(private readonly locked: Page) { super(locked, REPOSITORY, 5000); }
            override get driver(): any { return this.locked; }
        }
        const steps = new Steps(new LockedDriverRepository(page), { timeout: STEP_TIMEOUT });
        const other = await page.context().newPage();
        try {
            expect(() => steps.forPage(other)).toThrow(/forPage: cannot rebind repository driver/);
        } finally {
            await other.close();
        }
        log('forPage: unrebindable repository rejected — passed');
    });

    test('fails loudly when resolution ignores the rebound driver', async ({ page }) => {
        // The getter check cannot see this one: `driver` still answers from
        // `_driver`, so it reports the popup, while resolution goes through a
        // driver captured at construction — the shape a future
        // element-repository could take under the `^0.3.1` range. Unguarded,
        // every element would quietly resolve on the OPENER.
        class CapturedDriverRepository extends ElementRepository {
            constructor(private readonly captured: Page) { super(captured, REPOSITORY, 5000); }
            override async get(): Promise<Element> {
                return new WebElement(this.captured.locator('h1').first(), 'h1', 5000);
            }
        }
        await page.context().route(`${ORIGIN}/**`, (route) =>
            route.fulfill({ contentType: 'text/html', body: new URL(route.request().url()).pathname === '/wallet' ? WALLET : SHOP }));
        await page.goto(`${ORIGIN}/checkout`);
        const steps = new Steps(new CapturedDriverRepository(page), { timeout: STEP_TIMEOUT });
        const other = await page.context().newPage();
        try {
            await other.goto(`${ORIGIN}/wallet`);
            // forPage itself succeeds — the driver getter agrees it was rebound.
            const bound = steps.forPage(other);
            expect((bound as any).repo.driver).toBe(other);
            // The first resolution is where the lie is caught.
            await expect(bound.getText('heading', 'WalletPopup')).rejects.toThrow(/resolution escaped the bound page/);
        } finally {
            await other.close();
        }
        log('forPage: resolution-path guard — passed');
    });

    test('forPage on the bound page returns the same Steps', async ({ page }) => {
        const steps = await checkoutSteps(page);
        expect(steps.forPage(page)).toBe(steps);
        log('forPage: identity on the bound page — passed');
    });

    test('shares the API client registry: the popup calls the opener\'s configured providers', async ({ page }) => {
        let hits = 0;
        const server = http.createServer((req, res) => {
            hits++;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ path: req.url }));
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        try {
            const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            const steps = await checkoutSteps(page, { timeout: STEP_TIMEOUT, apiBaseUrl: base, apiProviders: { named: base } });
            const popupSteps = steps.forPage(await openWallet(steps));

            // Both the 'default' and a named provider resolve on the popup's Steps.
            await popupSteps.apiGet('/from-popup-default');
            await popupSteps.apiGet('named', '/from-popup-named');
            expect(hits).toBe(2);
            // Same registry objects, not copies: a client added later on the opener is visible too.
            expect((popupSteps as any).apiClients).toBe((steps as any).apiClients);
        } finally {
            server.close();
        }
        log('forPage: shared API clients — passed');
    });

    test('shares the SQL client registry: one pool owned by the opener, closed once', async ({ page }) => {
        // A TCP listener that accepts and stays silent stands in for a database;
        // the lazily built client only needs to be created, never to connect.
        const sockets: net.Socket[] = [];
        const server = net.createServer((s) => { sockets.push(s); });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        try {
            const url = `postgres://u:p@127.0.0.1:${(server.address() as AddressInfo).port}/db`;
            const steps = await checkoutSteps(page, { timeout: STEP_TIMEOUT, dbUrl: url, dbConnectTimeoutMs: 400 });
            const popupSteps = steps.forPage(await openWallet(steps));

            // The popup builds the client lazily ...
            await expect(popupSteps.sqlQuery('SELECT 1')).rejects.toThrow();
            // ... into the registry the opener owns: the same Map, now holding the client,
            // so the fixture's single closeDbConnections() on the opener ends the popup's pool too.
            const registry = (steps as any).dbClients as Map<string, unknown>;
            expect((popupSteps as any).dbClients).toBe(registry);
            expect(registry.has('default')).toBe(true);
            await steps.closeDbConnections();
            expect(registry.size).toBe(0);
        } finally {
            sockets.forEach((s) => s.destroy());
            server.close();
        }
        log('forPage: shared SQL clients — passed');
    });

    test('carries dbConnectTimeoutMs over to the popup\'s SQL client', async ({ page }) => {
        // The silent listener never completes the handshake, so the query can only
        // end through the connect timeout. A dropped option leaves the pool without one.
        const sockets: net.Socket[] = [];
        const server = net.createServer((s) => { sockets.push(s); });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        try {
            const url = `postgres://u:p@127.0.0.1:${(server.address() as AddressInfo).port}/db`;
            const steps = await checkoutSteps(page, { timeout: STEP_TIMEOUT, dbUrl: url, dbConnectTimeoutMs: 700 });
            const popupSteps = steps.forPage(await openWallet(steps));

            const started = Date.now();
            await expect(popupSteps.sqlQuery('SELECT 1')).rejects.toThrow(/timeout/i);
            const elapsed = Date.now() - started;
            expect(elapsed).toBeGreaterThanOrEqual(600);
            expect(elapsed).toBeLessThan(5000);
            await steps.closeDbConnections();
        } finally {
            sockets.forEach((s) => s.destroy());
            server.close();
        }
        log('forPage: shared dbConnectTimeoutMs — passed');
    });

    test('carries emailCredentials over: the popup has an email client when the opener does', async ({ page }) => {
        // An SMTP endpoint that drops every connection: sending fails fast, offline, for a reason other than configuration.
        const server = net.createServer((s) => s.destroy());
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        try {
            const port = (server.address() as AddressInfo).port;
            const smtp = { email: 'sender@example.test', password: 'x', host: '127.0.0.1', port };
            const steps = await checkoutSteps(page, { timeout: STEP_TIMEOUT, emailCredentials: { smtp } });
            const popupSteps = steps.forPage(await openWallet(steps));
            const send = popupSteps.sendEmail({ to: 'to@example.test', subject: 's', text: 't' });
            await expect(send).rejects.toThrow();
            await expect(send).rejects.not.toThrow(/not configured/);
        } finally {
            server.close();
        }
        log('forPage: shared emailCredentials — passed');
    });

    test('without emailCredentials the popup reports the email client as not configured (control)', async ({ page }) => {
        const steps = await checkoutSteps(page);
        const popupSteps = steps.forPage(await openWallet(steps));
        await expect(popupSteps.sendEmail({ to: 'to@example.test', subject: 's', text: 't' })).rejects.toThrow(/Email client is not configured/);
        log('forPage: no emailCredentials control — passed');
    });

    test('carries interceptionRetry over: false makes an intercepted popup click fail, default falls back', async ({ page }) => {
        const strict = await checkoutSteps(page, { timeout: STEP_TIMEOUT, interceptionRetry: false });
        const strictPage = await openWallet(strict);
        const strictPopup = strict.forPage(strictPage);
        await expect(strictPopup.click('coveredButton', 'WalletPopup')).rejects.toThrow(/intercepts pointer events|intercept/i);
        expect(await strictPage.evaluate(() => (window as any).__covered ?? 0)).toBe(0);

        // Control: the default (true) dispatches the click instead, so the failure above is the option, not the page.
        const lenient = await checkoutSteps(page, { timeout: STEP_TIMEOUT });
        const lenientPage = await openWallet(lenient);
        const lenientPopup = lenient.forPage(lenientPage);
        await lenientPopup.click('coveredButton', 'WalletPopup');
        expect(await lenientPage.evaluate(() => (window as any).__covered ?? 0)).toBe(1);
        log('forPage: shared interceptionRetry — passed');
    });

    test('sees a later setDefaultTimeout on the opener\'s repository', async ({ page }) => {
        // The repository starts with a short probe timeout; the popup's fallback probe
        // lasts exactly as long as the opener's repository says at that moment.
        const repo = new ElementRepository(page, REPOSITORY, 300);
        await page.context().route(`${ORIGIN}/**`, (route) =>
            route.fulfill({ contentType: 'text/html', body: new URL(route.request().url()).pathname === '/wallet' ? WALLET : SHOP }));
        const steps = new Steps(repo, { timeout: 10000 });
        await steps.navigateTo(`${ORIGIN}/checkout`);
        const popupSteps = steps.forPage(await openWallet(steps));

        repo.setDefaultTimeout(2500); // after forPage: only a live view of the opener's repo notices
        const started = Date.now();
        await popupSteps.verifyPresence('slowFallback', 'WalletPopup');
        const elapsed = Date.now() - started;
        // A copied repo (or dropped option) would probe for 300 ms only.
        expect(elapsed).toBeGreaterThanOrEqual(2300);
        expect(elapsed).toBeLessThan(9000);
        log('forPage: live repository timeout — passed');
    });
});

/**
 * Compile-only guard for the published copy-paste lines. `steps.click(...)`
 * resolves `boolean | void`, so a `switchToNewTab(action: () => Promise<void>)`
 * signature makes both of these fail `tsc --strict` with TS2322 — which is what
 * a reader of the README or of the `forPage` JSDoc would hit on their first
 * attempt. The body is never executed; it exists so `npm run typecheck:tests`
 * fails if the parameter is ever narrowed back to `Promise<void>`.
 */
async function documentedUsageCompiles(steps: Steps): Promise<void> {
    // Verbatim from the `forPage` JSDoc example in src/steps/CommonSteps.ts.
    const popup = await steps.switchToNewTab(() => steps.click('walletButton', 'CheckoutPage'));
    const popupSteps = steps.forPage(popup);
    await popupSteps.verifyPresence('heading', 'WalletPopup');
    await popupSteps.click('cancelLink', 'WalletPopup');

    // Verbatim from the `forPage` bullet in the README API reference.
    const inlineForm = steps.forPage(await steps.switchToNewTab(() => steps.click('openHelp', 'HomePage')));
    void inlineForm;
}
void documentedUsageCompiles;
