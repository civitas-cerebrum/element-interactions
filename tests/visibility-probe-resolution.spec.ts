import { test, expect } from './fixture/StepFixture';
import type { Page } from '@playwright/test';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { Steps } from '../src';
import { createLogger } from '../src/logger/Logger';

const log = createLogger('tests');

/**
 * Regression tests: visibility probes resolve the repository entry's FULL
 * selector.
 *
 * `isVisible()` / `.isVisible().click()` / `verifyAbsence()` used to build
 * their locator from `repo.getSelector(...)`, which keeps only the first
 * plain-string strategy of an entry:
 *
 *   - role + name   → `[role='button']` — the accessible name is dropped, so
 *                     the probe answers for ANY element carrying that role
 *                     (false "visible") and misses native elements (no
 *                     explicit role attribute) entirely;
 *   - regex text    → `text={"regex":…}` — matches nothing (false "hidden");
 *   - frame pages   → queried in the top document, never inside the frame.
 *
 * Actions (`click`, `fill`, `verify*`) resolve through `repo.get(...)` and were
 * always right, so a gate could skip — or run — the opposite way from the
 * action it guards. Each selector kind gets its own case below. Like
 * tests/click-retry-safety.spec.ts, these use page.setContent() — no server.
 */

const SHOP = `
    <main>
        <div role="button" tabindex="0" data-testid="add">Add to basket</div>
        <button type="button" onclick="window.__applyClicks = (window.__applyClicks || 0) + 1">Apply code</button>
        <button type="button" style="display:none" onclick="window.__hiddenClicks = (window.__hiddenClicks || 0) + 1">Secret</button>
        <p class="summary">Total ¤12.50</p>
        <ul>
            <li class="row" style="display:none">first</li>
            <li class="row">second</li>
        </ul>
        <span class="gone" style="display:none">one</span>
        <span class="gone" style="display:none">two</span>
        <span id="hidden-primary" style="display:none">Total (old layout)</span>
        <iframe title="Payment form"
                srcdoc="<button type='button' data-testid='pay'>Pay now</button>"></iframe>
    </main>
`;

const REPOSITORY = {
    pages: [
        {
            name: 'ShopPage',
            elements: [
                { elementName: 'addToBasket', selector: { role: 'button', name: 'Add to basket' } },
                // Absent — but another element with role="button" is shown.
                { elementName: 'checkoutButton', selector: { role: 'button', name: 'Checkout' } },
                // Native <button>: no explicit role attribute.
                { elementName: 'applyCode', selector: { role: 'button', name: 'Apply code' } },
                { elementName: 'secretButton', selector: { role: 'button', name: 'Secret' } },
                { elementName: 'rows', selector: { css: '.row' } },
                // Two matches, both display:none.
                { elementName: 'goneRows', selector: { css: '.gone' } },
                // Missing primary; the fallback attaches late, hidden. Resolving it
                // really spends attach time (the repository walks the chain).
                { elementName: 'lateChain', selector: { css: '#late-primary', fallback: { css: '#late' } } },
                // Fallback chains attach-wait each node; neither node of ghostChain exists.
                { elementName: 'ghostChain', selector: { css: '#ghost-1', fallback: { css: '#ghost-2' } } },
                // Primary present and visible, fallback absent.
                // Primary exists but hidden; fallback visible.
                { elementName: 'hiddenPrimary', selector: { css: '#hidden-primary', fallback: { css: '.summary' } } },
                // Multi-match primaries: two hidden matches / one of two visible; fallback absent.
                { elementName: 'hiddenMultiPrimary', selector: { css: '.gone', fallback: { css: '#nope-fallback' } } },
                { elementName: 'visibleMultiPrimary', selector: { css: '.row', fallback: { css: '#nope-fallback' } } },
                { elementName: 'primaryHit', selector: { css: "[data-testid='add']", fallback: { css: '#nope-fallback' } } },
                { elementName: 'fallbackHit', selector: { css: '#nope', fallback: { role: 'button', name: 'Apply code' } } },
                { elementName: 'totalLine', selector: { text: { regex: 'Total ¤[0-9.]+' } } },
                { elementName: 'refundLine', selector: { text: { regex: 'Refund ¤[0-9.]+' } } },
            ],
        },
        {
            name: 'PaymentFrame',
            frame: { css: "iframe[title='Payment form']" },
            elements: [
                { elementName: 'payButton', selector: { css: "[data-testid='pay']" } },
                { elementName: 'cancelButton', selector: { css: "[data-testid='cancel']" } },
            ],
        },
    ],
};

const PROBE_TIMEOUT = 400;

async function shopSteps(page: Page): Promise<Steps> {
    await page.setContent(SHOP);
    await page.frameLocator("iframe[title='Payment form']").locator("[data-testid='pay']").waitFor();
    // Repository default of 15s: a probe that paid it would blow the budget assertions below.
    return new Steps(new ElementRepository(page, REPOSITORY, 15000), { timeout: 2000 });
}

test.describe('Visibility probes resolve the full repository selector', () => {

    test('role + name: a named control is probed by its accessible name', async ({ page }) => {
        const steps = await shopSteps(page);
        expect(await steps.isVisible('addToBasket', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(true);
        // Before the fix: `[role='button']` matched "Add to basket" → true.
        expect(await steps.isVisible('checkoutButton', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(false);
        // Before the fix: `[role='button']` never matches a native <button> → false.
        expect(await steps.isVisible('applyCode', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(true);
        log('probe resolution: role + name — passed');
    });

    test('regex text: the pattern is honoured', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix: `text={"regex":…}` matched nothing → false.
        expect(await steps.isVisible('totalLine', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(true);
        expect(await steps.isVisible('refundLine', 'ShopPage', { timeout: PROBE_TIMEOUT })).toBe(false);
        expect(await steps.isVisible('totalLine', 'ShopPage', { timeout: PROBE_TIMEOUT, containsText: '¤12.50' })).toBe(true);
        log('probe resolution: regex text — passed');
    });

    test('frame page: the probe looks inside the frame', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix: queried in the top document → false.
        expect(await steps.isVisible('payButton', 'PaymentFrame', { timeout: PROBE_TIMEOUT })).toBe(true);
        expect(await steps.isVisible('cancelButton', 'PaymentFrame', { timeout: PROBE_TIMEOUT })).toBe(false);
        log('probe resolution: frame page — passed');
    });

    test('fluent form agrees with the Steps form', async ({ page }) => {
        const steps = await shopSteps(page);
        expect(await steps.on('checkoutButton', 'ShopPage').isVisible({ timeout: PROBE_TIMEOUT })).toBe(false);
        expect(await steps.on('applyCode', 'ShopPage').isVisible({ timeout: PROBE_TIMEOUT })).toBe(true);
        log('probe resolution: fluent form — passed');
    });

    test('gate acts on a present named control and skips an absent one', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix the probe missed the native <button>, so the gate
        // skipped the click silently.
        await steps.isVisible('applyCode', 'ShopPage', { timeout: PROBE_TIMEOUT }).click();
        expect(await page.evaluate(() => (window as unknown as Record<string, number>).__applyClicks)).toBe(1);
        // Before the fix `[role='button']` opened the gate, and doubleClick()
        // (no second visibility check of its own) then waited for a "Checkout"
        // control that does not exist, failing after the step timeout.
        await steps.isVisible('checkoutButton', 'ShopPage', { timeout: PROBE_TIMEOUT }).doubleClick();
        expect(await steps.on('refundLine', 'ShopPage').isVisible({ timeout: PROBE_TIMEOUT }).clickIfPresent()).toBe(false);
        // Positive skip: a present-but-hidden control is probed false, so the gated action never reaches it.
        await steps.isVisible('secretButton', 'ShopPage', { timeout: PROBE_TIMEOUT }).doubleClick();
        await steps.isVisible('secretButton', 'ShopPage', { timeout: PROBE_TIMEOUT }).click();
        expect(await page.evaluate(() => (window as unknown as Record<string, number>).__hiddenClicks)).toBeUndefined();
        log('probe resolution: gate act / skip — passed');
    });

    test('a missing element reports false within the probe budget', async ({ page }) => {
        const steps = await shopSteps(page);
        for (const [el, pg] of [['checkoutButton', 'ShopPage'], ['refundLine', 'ShopPage'], ['cancelButton', 'PaymentFrame']]) {
            const started = Date.now();
            expect(await steps.isVisible(el, pg, { timeout: PROBE_TIMEOUT })).toBe(false);
            // Far below the 15s repository default, and (with the distinct-timeout test below) pins the probe to its own budget.
            expect(Date.now() - started, `${pg}.${el} probe elapsed`).toBeLessThan(PROBE_TIMEOUT + 1500);
        }
        log('probe resolution: short timeout honoured — passed');
    });

    test('the probe honours its own timeout: two distinct budgets scale the wait', async ({ page }) => {
        const steps = await shopSteps(page);
        const measure = async (timeout: number) => {
            const started = Date.now();
            expect(await steps.isVisible('checkoutButton', 'ShopPage', { timeout })).toBe(false);
            return Date.now() - started;
        };
        const short = await measure(300);
        const long = await measure(1200);
        // Ignoring the param would make both take the Steps default (2000ms) and be equal.
        expect(short, 'short probe elapsed').toBeLessThan(900);
        expect(long, 'long probe elapsed').toBeGreaterThanOrEqual(900);
        expect(long, 'long probe elapsed').toBeLessThan(1800);
        log('probe resolution: distinct budgets — passed');
    });

    test('a fallback chain that matches nothing is probed within the probe budget', async ({ page }) => {
        const steps = await shopSteps(page);
        const started = Date.now();
        expect(await steps.isVisible('ghostChain', 'ShopPage', { timeout: 300 })).toBe(false);
        // Per-node attach waits at 300ms stay under 1800ms; the 15s repository default per node would not.
        expect(Date.now() - started, 'ghost chain probe elapsed').toBeLessThan(1800);
        log('probe resolution: fallback chain — passed');
    });

    test('fallback chain: a visible fallback hit is reported visible within the probe budget', async ({ page }) => {
        const steps = await shopSteps(page);
        // The primary (#nope) is missing; its attach waits must not consume the
        // whole budget and leave the fallback hit no time to be seen visible.
        for (const timeout of [PROBE_TIMEOUT, 1500]) {
            const started = Date.now();
            expect(await steps.isVisible('fallbackHit', 'ShopPage', { timeout }), `fallbackHit probe (timeout=${timeout})`).toBe(true);
            expect(Date.now() - started, `fallbackHit probe elapsed (timeout=${timeout})`).toBeLessThan(timeout + 500);
        }
        expect(await steps.on('fallbackHit', 'ShopPage').isVisible({ timeout: PROBE_TIMEOUT })).toBe(true);
        // The gate opens on the fallback hit and the action lands on it. The click
        // itself resolves with the repository default (it walks a missing primary
        // per that default, as every action does), so use a short one here.
        const shortRepoSteps = new Steps(new ElementRepository(page, REPOSITORY, 500), { timeout: 2000 });
        await shortRepoSteps.isVisible('fallbackHit', 'ShopPage', { timeout: PROBE_TIMEOUT }).click();
        expect(await page.evaluate(() => (window as unknown as Record<string, number>).__applyClicks)).toBe(1);
        log('probe resolution: fallback hit — passed');
    });

    test('one budget: attach time is deducted from the visibility wait', async ({ page }) => {
        const steps = await shopSteps(page);
        // A fallback chain spends real attach time before the visibility wait
        // starts: the probe gives the repository timeout / 8 = 375ms per node,
        // and the missing primary (two waits) plus the not-yet-attached
        // fallback (one wait) cost ~1125ms. The fallback then attaches HIDDEN
        // at 2000ms. With the attach time deducted the probe gives up at
        // ~3000ms; without it, it would wait a further full 3000ms (~4100ms).
        await page.evaluate(() => setTimeout(() => {
            const el = document.createElement('div');
            el.id = 'late';
            el.style.display = 'none';
            document.body.appendChild(el);
        }, 2000));
        const started = Date.now();
        expect(await steps.isVisible('lateChain', 'ShopPage', { timeout: 3000 })).toBe(false);
        const elapsed = Date.now() - started;
        expect(elapsed, 'probe elapsed').toBeGreaterThanOrEqual(2700);
        expect(elapsed, 'probe elapsed').toBeLessThan(3600);
        log('probe resolution: single budget — passed');
    });

    test('timeout 0 is clamped, not "wait forever"', async ({ page }) => {
        const steps = await shopSteps(page);
        const started = Date.now();
        expect(await steps.isVisible('checkoutButton', 'ShopPage', { timeout: 0 })).toBe(false);
        expect(await steps.on('checkoutButton', 'ShopPage').isVisible({ timeout: 0 })).toBe(false);
        expect(Date.now() - started, 'timeout:0 probes elapsed').toBeLessThan(3000);
        log('probe resolution: timeout 0 — passed');
    });

    test('containsText mismatch reports false', async ({ page }) => {
        const steps = await shopSteps(page);
        expect(await steps.isVisible('totalLine', 'ShopPage', { timeout: PROBE_TIMEOUT, containsText: 'nope' })).toBe(false);
        expect(await steps.isVisible('applyCode', 'ShopPage', { timeout: PROBE_TIMEOUT, containsText: 'Apply' })).toBe(true);
        log('probe resolution: containsText mismatch — passed');
    });
});

test.describe('verifyAbsence resolves the full repository selector', () => {

    test('passes for absent entries of every selector kind', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix: `[role='button']` was visible → false failure.
        await steps.verifyAbsence('checkoutButton', 'ShopPage');
        await steps.verifyAbsence('refundLine', 'ShopPage');
        await steps.verifyAbsence('cancelButton', 'PaymentFrame');
        log('absence resolution: absent entries — passed');
    });

    test('an absent entry is asserted fast, not after the 15s repository default', async ({ page }) => {
        const steps = await shopSteps(page);
        for (const [el, pg] of [['checkoutButton', 'ShopPage'], ['refundLine', 'ShopPage'], ['cancelButton', 'PaymentFrame']]) {
            const started = Date.now();
            await steps.verifyAbsence(el, pg);
            expect(Date.now() - started, `${pg}.${el} absence elapsed`).toBeLessThan(2500);
        }
        log('absence resolution: fast attach budget — passed');
    });

    test('a fallback chain is asserted absent without the repository attach wait', async ({ page }) => {
        const steps = await shopSteps(page);
        const started = Date.now();
        await steps.verifyAbsence('ghostChain', 'ShopPage');
        // a 250 ms attach slice per node (ABSENCE_ATTACH_SLICE_MS); the 15s repository default per node would be 30s.
        expect(Date.now() - started, 'ghost chain absence elapsed').toBeLessThan(2500);
        await expect(steps.verifyAbsence('fallbackHit', 'ShopPage')).rejects.toThrow();
        log('absence resolution: fallback chain — passed');
    });

    test('fallback chain: a visible primary fails the absence assertion', async ({ page }) => {
        const steps = await shopSteps(page);
        // A ~1ms attach check can miss the present primary, walk to the absent
        // fallback and pass — a false PASS. The primary must be seen.
        await expect(steps.verifyAbsence('primaryHit', 'ShopPage')).rejects.toThrow();
        log('absence resolution: fallback chain, visible primary — passed');
    });

    test('fallback chain: the resolved variant decides — a hidden existing primary is absent', async ({ page }) => {
        const steps = await shopSteps(page);
        // repo.get resolves a fallback chain to the first node that EXISTS, and
        // every action on the entry targets that node. The primary exists but
        // is hidden, so the entry is absent even though the fallback is visible.
        await steps.verifyAbsence('hiddenPrimary', 'ShopPage');
        // The same entry fails as soon as the resolved primary shows.
        await page.evaluate(() => ((document.getElementById('hidden-primary') as HTMLElement).style.display = ''));
        await expect(steps.verifyAbsence('hiddenPrimary', 'ShopPage')).rejects.toThrow(/toBeHidden/);
        log('absence resolution: resolved variant semantics — passed');
    });

    test('fallback chain with a multi-match primary never passes falsely', async ({ page }) => {
        const steps = await shopSteps(page);
        // The repository's ALL resolution walks past a primary that matches
        // several elements (strict attach wait) to the absent fallback; asserting
        // on that would pass while the primary is visible.
        await expect(steps.verifyAbsence('visibleMultiPrimary', 'ShopPage')).rejects.toThrow();
        // Documented limit: such an entry is refused even when every match is hidden.
        await expect(steps.verifyAbsence('hiddenMultiPrimary', 'ShopPage')).rejects.toThrow(/matches several elements/);
        log('absence resolution: multi-match fallback primary — passed');
    });

    test('multi-match entry: a visible later match fails the absence assertion', async ({ page }) => {
        const steps = await shopSteps(page);
        // First match hidden, second visible: asserting on the first match alone would pass.
        const error = await steps.verifyAbsence('rows', 'ShopPage').then(() => null, (e: unknown) => e);
        expect(error, 'absence of a visible match must fail').toBeInstanceOf(Error);
        // It must fail because a match is visible, not on a strict-mode violation.
        expect((error as Error).message).not.toContain('strict mode violation');
        log('absence resolution: multi-match — passed');
    });

    test('multi-match entry: passes when every match is hidden', async ({ page }) => {
        const steps = await shopSteps(page);
        // Two display:none matches: absent. A strict single-element assertion
        // would throw "resolved to 2 elements" instead.
        await steps.verifyAbsence('goneRows', 'ShopPage');
        log('absence resolution: multi-match all hidden — passed');
    });

    test('fails for present entries of every selector kind', async ({ page }) => {
        const steps = await shopSteps(page);
        // Before the fix the regex-text and frame cases passed silently: the
        // selector they asserted on could never match anything.
        await expect(steps.verifyAbsence('totalLine', 'ShopPage')).rejects.toThrow();
        await expect(steps.verifyAbsence('payButton', 'PaymentFrame')).rejects.toThrow();
        await expect(steps.verifyAbsence('applyCode', 'ShopPage')).rejects.toThrow();
        log('absence resolution: present entries — passed');
    });
});
