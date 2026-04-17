import { test, expect } from './fixture/StepFixture';
import { ElementAction, ElementInteractions } from '../src';

/**
 * Chained multi-verification on `steps.on()`. Each matcher call enqueues an
 * assertion and returns the builder; awaiting flushes the queue sequentially;
 * first failure short-circuits the rest.
 *
 * The tests exercise:
 *   - Multiple field matchers in one chained expression
 *   - `.not` as a one-shot flag (applies only to the next matcher)
 *   - `.throws(msg)` attaching to the most recently queued assertion
 *   - `.timeout(ms)` scoping retroactively to the last queued assertion
 *   - Short-circuit — assertions after the first failure do not execute
 *   - Predicate form mixed with field matchers in the same chain
 */

const FAST_TIMEOUT = 500;

async function gotoButtons(steps: any) {
    await steps.navigateTo('/');
    await steps.click('buttonsLink', 'SidebarNav');
    await steps.verifyUrlContains('/buttons');
}

test.describe('steps.on() — chained multi-verification', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('two matchers chained on one element both pass', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage')
            .text.toBe('Primary')
            .visible.toBeTrue();
    });

    test('four matchers chained on one element all pass', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage')
            .text.toBe('Primary')
            .visible.toBeTrue()
            .enabled.toBeTrue()
            .count.toBe(1);
    });

    test('chain mixes field matchers with attribute matchers', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage')
            .text.toContain('rim')
            .attributes.get('data-testid').toBe('btn-primary')
            .visible.toBeTrue();
    });

    test('chain with css matcher works', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage')
            .text.toBe('Primary')
            .css('cursor').toMatch(/pointer|default|auto/);
    });

    test('predicate form in the middle of a chain', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage')
            .text.toBe('Primary')
            .toBe(el => el.visible && el.enabled)
            .count.toBe(1);
    });

    test('kitchen sink — 8 chained verifications on a single element', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage')
            .text.toBe('Primary')
            .text.toContain('rim')
            .text.toMatch(/^Prim/)
            .visible.toBeTrue()
            .enabled.toBeTrue()
            .count.toBe(1)
            .attributes.get('data-testid').toBe('btn-primary')
            .attributes.toHaveKey('data-testid')
            .css('cursor').toMatch(/pointer|default|auto/)
            .toBe(el => el.visible && el.enabled && el.text === 'Primary');
    });

    test('realistic submit-button scenario — text, state, attributes, negation, predicate', async ({ steps }) => {
        // A realistic assertion a test author would write about a "submit"-style
        // button: it has the right label, is visible and enabled, carries the
        // expected data-testid, is not disabled, has a valid cursor style, and
        // its overall shape satisfies a compound predicate.
        await steps.on('primaryButton', 'ButtonsPage')
            .text.toBe('Primary')
            .visible.toBeTrue()
            .enabled.toBeTrue()
            .attributes.get('data-testid').toBe('btn-primary')
            .not.attributes.toHaveKey('disabled')
            .css('cursor').toMatch(/pointer|default|auto/)
            .toBe(el => el.text === 'Primary' && el.visible && el.enabled);
    });

    test('long chain with mixed matcher-level timeouts — each scoped correctly', async ({ steps }) => {
        // Every assertion in the chain sets its own timeout; all should pass,
        // proving each timeout is honored without leaking into neighbors.
        await steps.on('primaryButton', 'ButtonsPage')
            .text.timeout(5000).toBe('Primary')
            .visible.timeout(100).toBeTrue()
            .enabled.timeout(2000).toBeTrue()
            .count.timeout(500).toBe(1)
            .attributes.timeout(100).toHaveKey('data-testid')
            .attributes.get('data-testid').timeout(3000).toBe('btn-primary')
            .css('cursor').timeout(200).toMatch(/pointer|default|auto/);
    });

    test('builder-level timeout(long) with a single matcher-level timeout(short) override', async ({ steps }) => {
        // Builder sets a generous 5s default for every matcher.
        // One specific matcher overrides with a tight 200ms that still passes.
        // The remaining matchers all use the 5s default.
        await steps.on('primaryButton', 'ButtonsPage')
            .timeout(5000)
            .text.toBe('Primary')
            .visible.toBeTrue()
            .enabled.timeout(200).toBeTrue()    // tight override, still passes
            .count.toBe(1)
            .attributes.get('data-testid').toBe('btn-primary');
    });

    test('short per-matcher timeout on a failing assertion fails fast inside a long chain', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: 30000 });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, 30000);

        await page.goto('/');
        await page.click('[data-testid=\'nav-item-buttons\']');

        // Chain where the 3rd matcher has a 300ms timeout on a value that
        // never matches. The whole chain should fail inside ~1s, not the
        // default 30s — proving the per-matcher timeout is honored.
        const start = Date.now();
        await expect(
            action
                .text.toBe('Primary')
                .visible.toBeTrue()
                .text.timeout(300).toBe('NEVER_MATCHES'),
        ).rejects.toThrow(/text to be "NEVER_MATCHES"/);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
    });

    test('trailing builder-level timeout() scopes retroactively to preceding assertion only', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: 30000 });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, 30000);

        await page.goto('/');
        await page.click('[data-testid=\'nav-item-buttons\']');

        // `.toBe(pred).timeout(400)` retroactively tightens the predicate's
        // timeout. First failing assertion here is the predicate; must fail
        // within ~1s regardless of the builder's 30s default.
        const start = Date.now();
        await expect(
            action
                .text.toBe('Primary')
                .toBe(el => el.text === 'NEVER_MATCHES').timeout(400),
        ).rejects.toThrow(/predicate|snapshot at timeout/i);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
    });

    test('kitchen sink short-circuits on first failure out of 8', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);

        await page.goto('/');
        await page.click('[data-testid=\'nav-item-buttons\']');

        let latePredicateCalls = 0;
        const chain = action
            .text.toBe('Primary')                           // passes
            .visible.toBeTrue()                             // passes
            .enabled.toBeTrue()                             // passes
            .text.toBe('WRONG')                             // fails — short-circuit
            .toBe(el => { latePredicateCalls += 1; return true; }) // must NOT run
            .count.toBe(1);                                 // must NOT run

        await expect(chain).rejects.toThrow(/text to be "WRONG"/);
        expect(latePredicateCalls).toBe(0);
    });
});

test.describe('steps.on() chain — .not is one-shot', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('.not applies only to the next matcher, not the rest of the chain', async ({ steps }) => {
        // text.not.toBe('Nope') → passes (text IS Primary, not "Nope")
        // count.toBe(1)          → passes (count IS 1, no negation leaks in)
        await steps.on('primaryButton', 'ButtonsPage')
            .not.text.toBe('Nope')
            .count.toBe(1);
    });

    test('two separate .not applications in one chain', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage')
            .not.text.toBe('Wrong')
            .visible.toBeTrue()
            .not.count.toBe(99)
            .enabled.toBeTrue();
    });
});

test.describe('steps.on() chain — short-circuit on first failure', () => {
    test('second assertion is not evaluated after first fails', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);

        // Navigate so the element resolves
        await page.goto('/');
        await page.click('[data-testid=\'nav-item-buttons\']');

        let secondPredicateCalls = 0;
        const chain = action
            .text.toBe('WRONG')                            // first — will fail
            .toBe(el => { secondPredicateCalls += 1; return true; }); // second — must NOT run

        await expect(chain).rejects.toThrow(/text to be "WRONG"/);
        expect(secondPredicateCalls).toBe(0);
    });
});

test.describe('steps.on() chain — .throws() attaches to last queued assertion', () => {
    test('.throws() overrides the message of the preceding matcher', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);

        await page.goto('/');
        await page.click('[data-testid=\'nav-item-buttons\']');

        await expect(
            action.text.toBe('WRONG').throws('text override message'),
        ).rejects.toThrow(/text override message/);
    });

    test('.throws() applies to the predicate form too', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);

        await page.goto('/');
        await page.click('[data-testid=\'nav-item-buttons\']');

        await expect(
            action.toBe(el => el.text === 'WRONG').throws('predicate override'),
        ).rejects.toThrow(/predicate override/);
    });
});

test.describe('steps.on() chain — .timeout() scopes to last queued assertion', () => {
    test('trailing .timeout() shortens the preceding assertion', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: 30000 });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, 30000);

        await page.goto('/');
        await page.click('[data-testid=\'nav-item-buttons\']');

        const start = Date.now();
        await expect(
            action.text.toBe('WRONG').timeout(500),
        ).rejects.toThrow(/text to be/);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
    });

    test('.timeout() on builder also affects future matchers (persistent mutation)', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: 30000 });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, 30000);

        await page.goto('/');
        await page.click('[data-testid=\'nav-item-buttons\']');

        const start = Date.now();
        await expect(
            action.timeout(500).text.toBe('WRONG'),
        ).rejects.toThrow(/text to be/);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(2000);
    });
});
