import { test, expect } from './fixture/StepFixture';

/**
 * Validates `.timeout(ms)` as a chainable override that composes at every
 * level: on `steps.on()` (ElementAction), on `steps.expect()` (ExpectBuilder),
 * on individual matchers (TextMatcher/CountMatcher/etc.), on `.not` chains,
 * on ifVisible chains, and on `.satisfy(predicate)` (PredicateAssertion).
 *
 * Negative-path tests pass a short timeout and assert the failure bubbles
 * within a bounded window — proof that the override is actually honored
 * rather than silently falling back to the default Steps timeout.
 */

async function gotoButtons(steps: any) {
    await steps.navigateTo('/');
    await steps.click('buttonsLink', 'SidebarNav');
    await steps.verifyUrlContains('/buttons');
}

test.describe('timeout() — positive override (long timeout tolerated)', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('on ElementAction — .timeout() before matcher', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').timeout(5000).text.toBe('Primary');
    });

    test('on ExpectBuilder — steps.expect().timeout()', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').timeout(5000).text.toBe('Primary');
    });

    test('on TextMatcher — .text.timeout()', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').text.timeout(5000).toBe('Primary');
    });

    test('on CountMatcher — .count.timeout()', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').count.timeout(5000).toBe(1);
    });

    test('on BooleanMatcher — .visible.timeout()', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').visible.timeout(5000).toBeTrue();
    });

    test('on AttributesMatcher — .attributes.timeout()', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').attributes.timeout(5000).toHaveKey('data-testid');
    });

    test('on AttributeMatcher — .attributes.get().timeout()', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').attributes.get('data-testid').timeout(5000).toBe('btn-primary');
    });

    test('on CssMatcher — .css().timeout()', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').css('cursor').timeout(5000).toMatch(/pointer|default|auto/);
    });

    test('on PredicateAssertion — .toBe(pred).timeout()', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').satisfy(el => el.text === 'Primary').timeout(5000);
    });

    test('composes with .not — .timeout().not.text.toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').timeout(5000).not.text.toBe('Nope');
    });

    test('composes with .not — .not.timeout().text.toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.timeout(5000).text.toBe('Nope');
    });

    test('composes with strategy selectors — .nth().timeout()', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').nth(0).timeout(5000).text.toBe('Primary');
    });

    test('composes with ifVisible — .ifVisible().timeout()', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').ifVisible().timeout(5000).text.toBe('Primary');
    });

    test('composes with .toBe(pred).throws() — .toBe(pred).throws().timeout()', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage')
            .satisfy(el => el.visible)
            .throws('must be visible')
            .timeout(5000);
    });
});

test.describe('timeout() — negative override (short timeout fails fast)', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('fails within the override window on TextMatcher', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.expect('primaryButton', 'ButtonsPage').text.timeout(500).toBe('WRONG'),
        ).rejects.toThrow(/text to be/);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
    });

    test('fails within the override window on ExpectBuilder', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.expect('primaryButton', 'ButtonsPage').timeout(500).text.toBe('WRONG'),
        ).rejects.toThrow(/text to be/);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
    });

    test('fails within the override window on ElementAction', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.on('primaryButton', 'ButtonsPage').timeout(500).text.toBe('WRONG'),
        ).rejects.toThrow(/text to be/);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
    });

    test('fails within the override window on PredicateAssertion', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.expect('primaryButton', 'ButtonsPage').satisfy(el => el.text === 'WRONG').timeout(500),
        ).rejects.toThrow(/snapshot at timeout/);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
    });

    test('timeout() overrides survive through .throws(message)', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.expect('primaryButton', 'ButtonsPage')
                .satisfy(el => el.text === 'WRONG')
                .timeout(500)
                .throws('domain message'),
        ).rejects.toThrow(/domain message/);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
    });

    test('matcher-level .timeout() on a later matcher does NOT retroactively patch an earlier queued assertion', async ({ steps }) => {
        // Invariant: `.text.timeout(2000).toBe('WRONG').count.timeout(500).toBe(1)` must honor
        // the 2000ms timeout on the text assertion — the later `.count.timeout(500)` propagates
        // forward (for subsequent matchers) but must NOT retroactively rewrite the already-queued
        // text entry's ctx. If the invariant breaks, the text assertion would fail at ~500ms
        // instead of ~2000ms.
        //
        // Builder-level `.timeout()` (`.satisfy(pred).timeout(ms)`) is a separate code path that
        // IS expected to retroactively patch — exercised elsewhere in this file.
        const start = Date.now();
        await expect(
            steps.expect('primaryButton', 'ButtonsPage')
                .text.timeout(2000).toBe('WRONG')
                .count.timeout(500).toBe(1),
        ).rejects.toThrow(/text to be/);
        const elapsed = Date.now() - start;
        // Elapsed should reflect the text assertion's 2000ms timeout, not 500ms.
        // Allow generous lower bound (1500ms) for scheduling noise while still distinguishing
        // the correct behavior from the bug (which would resolve in ~500ms).
        expect(elapsed).toBeGreaterThan(1500);
        expect(elapsed).toBeLessThan(4000);
    });

    test('timeout() order does not matter: .throws().timeout() and .timeout().throws() both honored', async ({ steps }) => {
        // throws first, then timeout
        await expect(
            steps.expect('primaryButton', 'ButtonsPage')
                .satisfy(el => el.text === 'WRONG')
                .throws('msg A')
                .timeout(500),
        ).rejects.toThrow(/msg A/);

        // timeout first, then throws
        await expect(
            steps.expect('primaryButton', 'ButtonsPage')
                .satisfy(el => el.text === 'WRONG')
                .timeout(500)
                .throws('msg B'),
        ).rejects.toThrow(/msg B/);
    });
});

/**
 * Issue #76 — `ElementAction.timeout()` now threads through Interactions-routed
 * actions (click, clickIfPresent, rightClick, uploadFile, dragAndDrop,
 * selectDropdown, setSliderValue, selectMultiple).
 *
 * Each test below targets an element that exists in the page-repository but is
 * NOT attached to the DOM of the current page (we stay on `/` and use elements
 * from other pages). The pre-action `waitForState('visible')` inside
 * `Interactions` will time out; we assert the failure bubbles within the
 * override window rather than the fixture default (30_000ms).
 *
 * Without the fix, each of these would take ~30s; with it, each times out in ~500ms.
 */
test.describe('ElementAction.timeout() — Interactions-routed actions', () => {
    const TIMEOUT = 500;
    // Tight bound: distinguishes the fixed behavior (~500ms action + fast repo
    // resolution ≈ under 3s) from the pre-fix behavior (~30s default action
    // timeout regardless of the chain override).
    const UPPER_BOUND = 5000;

    test.beforeEach(async ({ steps, repo }) => {
        // Shorten repo resolution timeout so the action-side timeout dominates
        // elapsed time. Without this, each test would wait the full 15s default
        // inside StrategyResolver before the action-level timeout kicks in.
        repo.setDefaultTimeout(1000);
        // Land on home. The elements targeted below are from other pages —
        // their selectors won't resolve to attached DOM nodes here.
        await steps.navigateTo('/');
    });

    test('click() honors the chain timeout', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.on('primaryButton', 'ButtonsPage').timeout(TIMEOUT).click(),
        ).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(UPPER_BOUND);
    });

    test('clickIfPresent() returns false quickly regardless of chain timeout', async ({ steps }) => {
        // clickIfPresent short-circuits when the element isn't visible. The
        // timeout doesn't extend that path — we just assert the signature
        // accepts a chain timeout and the call resolves without throwing.
        const start = Date.now();
        const result = await steps.on('primaryButton', 'ButtonsPage').timeout(TIMEOUT).clickIfPresent();
        expect(result).toBe(false);
        expect(Date.now() - start).toBeLessThan(UPPER_BOUND);
    });

    test('rightClick() honors the chain timeout', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.on('primaryButton', 'ButtonsPage').timeout(TIMEOUT).rightClick(),
        ).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(UPPER_BOUND);
    });

    test('uploadFile() honors the chain timeout', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.on('singleFileInput', 'FileUploadPage').timeout(TIMEOUT).uploadFile('tests/test-files/test-upload.txt'),
        ).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(UPPER_BOUND);
    });

    test('dragAndDrop() honors the chain timeout', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.on('item1', 'DraggablePage').timeout(TIMEOUT).dragAndDrop({ xOffset: 10, yOffset: 10 }),
        ).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(UPPER_BOUND);
    });

    test('selectDropdown() honors the chain timeout', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.on('singleSelect', 'DropdownSelectPage').timeout(TIMEOUT).selectDropdown(),
        ).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(UPPER_BOUND);
    });

    test('setSliderValue() honors the chain timeout', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.on('basicSlider', 'SlidersPage').timeout(TIMEOUT).setSliderValue(50),
        ).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(UPPER_BOUND);
    });

    test('selectMultiple() honors the chain timeout', async ({ steps }) => {
        const start = Date.now();
        await expect(
            steps.on('multiSelect', 'DropdownSelectPage').timeout(TIMEOUT).selectMultiple(['Australia']),
        ).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(UPPER_BOUND);
    });
});
