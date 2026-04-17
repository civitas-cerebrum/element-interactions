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
