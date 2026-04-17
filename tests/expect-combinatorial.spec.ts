import { test, expect } from './fixture/StepFixture';

/**
 * Combinatorial coverage for the new matcher tree:
 *   - Every strategy selector × every matcher field (fluent)
 *   - Every matcher field at the top level (steps.expect)
 *   - Strategy selectors composed with `.not` and predicate forms
 *
 * Kept separate from expect-matchers.spec.ts (which focuses on per-matcher
 * positive / negative correctness) so this file can stay a pure matrix.
 */

async function gotoButtons(steps: any) {
    await steps.navigateTo('/');
    await steps.click('buttonsLink', 'SidebarNav');
    await steps.verifyUrlContains('/buttons');
}

async function gotoTextInputs(steps: any) {
    await steps.navigateTo('/');
    await steps.click('textInputsLink', 'SidebarNav');
}

// ───────────────────────────────────────────────────────────────────────
// Fluent matcher tree × strategy selectors
// ───────────────────────────────────────────────────────────────────────

test.describe('on().first() × matchers', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('first() × text.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').first().text.toBe('Primary');
    });

    test('first() × count.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').first().count.toBe(1);
    });

    test('first() × visible.toBeTrue', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').first().visible.toBeTrue();
    });

    test('first() × enabled.toBeTrue', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').first().enabled.toBeTrue();
    });

    test('first() × attributes.get().toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').first().attributes.get('data-testid').toBe('btn-primary');
    });

    test('first() × css().toMatch', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').first().css('cursor').toMatch(/pointer|default|auto/);
    });

    test('first() × expect(predicate)', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').first().toBe(el => el.text === 'Primary');
    });

    test('first() × not.text.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').first().not.text.toBe('Nope');
    });
});

test.describe('on().nth() × matchers', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('nth(0) × text.toContain', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').nth(0).text.toContain('rim');
    });

    test('nth(0) × count.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').nth(0).count.toBe(1);
    });

    test('nth(0) × visible.toBe(true)', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').nth(0).visible.toBe(true);
    });

    test('nth(0) × enabled.toBeTrue', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').nth(0).enabled.toBeTrue();
    });

    test('nth(0) × attributes.toHaveKey', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').nth(0).attributes.toHaveKey('data-testid');
    });

    test('nth(0) × css().toBe', async ({ steps }) => {
        const cursor = await steps.getCssProperty('primaryButton', 'ButtonsPage', 'cursor');
        await steps.on('primaryButton', 'ButtonsPage').nth(0).css('cursor').toBe(cursor);
    });

    test('nth(0) × expect(predicate)', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').nth(0).toBe(el => el.enabled && el.visible);
    });

    test('nth(0) × not.text.toContain', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').nth(0).not.text.toContain('xyz');
    });
});

test.describe('on().random() × matchers', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('random() × text.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').random().text.toBe('Primary');
    });

    test('random() × count.toBeGreaterThan', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').random().count.toBeGreaterThan(0);
    });

    test('random() × visible.toBeTrue', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').random().visible.toBeTrue();
    });

    test('random() × enabled.toBeTrue', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').random().enabled.toBeTrue();
    });

    test('random() × attributes.get().toMatch', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').random().attributes.get('data-testid').toMatch(/^btn-/);
    });

    test('random() × expect(predicate)', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').random().toBe(el => el.text.length > 0);
    });

    test('random() × not.text.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').random().not.text.toBe('not-this');
    });
});

test.describe('on().byText() × matchers', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('byText() × text.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byText('Primary').text.toBe('Primary');
    });

    test('byText() × count.toBeGreaterThan', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byText('Primary').count.toBeGreaterThan(0);
    });

    test('byText() × visible.toBeTrue', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byText('Primary').visible.toBeTrue();
    });

    test('byText() × enabled.toBeTrue', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byText('Primary').enabled.toBeTrue();
    });

    test('byText() × attributes.get().toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byText('Primary').attributes.get('data-testid').toBe('btn-primary');
    });

    test('byText() × expect(predicate)', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byText('Primary').toBe(el => el.visible);
    });

    test('byText() × not.text.toContain', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byText('Primary').not.text.toContain('Secondary');
    });
});

test.describe('on().byAttribute() × matchers', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('byAttribute() × text.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byAttribute('data-testid', 'btn-primary').text.toBe('Primary');
    });

    test('byAttribute() × count.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byAttribute('data-testid', 'btn-primary').count.toBe(1);
    });

    test('byAttribute() × visible.toBeTrue', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byAttribute('data-testid', 'btn-primary').visible.toBeTrue();
    });

    test('byAttribute() × attributes.get().toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byAttribute('data-testid', 'btn-primary').attributes.get('data-testid').toBe('btn-primary');
    });

    test('byAttribute() × expect(predicate)', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byAttribute('data-testid', 'btn-primary').toBe(el => el.text === 'Primary');
    });

    test('byAttribute() × not.attributes.get().toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').byAttribute('data-testid', 'btn-primary').not.attributes.get('data-testid').toBe('wrong');
    });
});

test.describe('on().ifVisible() × matchers', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('ifVisible() × text.toBe — present element runs the assertion', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').ifVisible().text.toBe('Primary');
    });

    test('ifVisible() × count.toBe — present element runs', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').ifVisible().count.toBe(1);
    });

    test('ifVisible() × attributes.toHaveKey — present element runs', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').ifVisible().attributes.toHaveKey('data-testid');
    });

    test('ifVisible() × css().toMatch — present element runs', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').ifVisible().css('cursor').toMatch(/pointer|default|auto/);
    });

    test('ifVisible() × predicate — present element runs', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').ifVisible().toBe(el => el.text === 'Primary');
    });

    test('ifVisible() × text.toBe on hidden element — silently skips', async ({ steps }) => {
        await steps.on('noSuchElement', 'ButtonsPage').ifVisible(200).text.toBe('whatever');
    });

    test('ifVisible() × count.toBe on hidden — silently skips', async ({ steps }) => {
        await steps.on('noSuchElement', 'ButtonsPage').ifVisible(200).count.toBe(99);
    });

    test('ifVisible() × visible.toBeTrue on hidden — silently skips', async ({ steps }) => {
        await steps.on('noSuchElement', 'ButtonsPage').ifVisible(200).visible.toBeTrue();
    });

    test('ifVisible() × attributes.toHaveKey on hidden — silently skips', async ({ steps }) => {
        await steps.on('noSuchElement', 'ButtonsPage').ifVisible(200).attributes.toHaveKey('anything');
    });

    test('ifVisible() × css().toBe on hidden — silently skips', async ({ steps }) => {
        await steps.on('noSuchElement', 'ButtonsPage').ifVisible(200).css('color').toBe('irrelevant');
    });
});

// ───────────────────────────────────────────────────────────────────────
// steps.expect() — full top-level coverage
// ───────────────────────────────────────────────────────────────────────

test.describe('steps.expect() × every field matcher (top-level)', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('.text.toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').text.toBe('Primary');
    });

    test('.text.toContain', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').text.toContain('rim');
    });

    test('.text.toMatch', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').text.toMatch(/^Prim/);
    });

    test('.text.toStartWith', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').text.toStartWith('Prim');
    });

    test('.text.toEndWith', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').text.toEndWith('mary');
    });

    test('.count.toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').count.toBe(1);
    });

    test('.count.toBeGreaterThan', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').count.toBeGreaterThan(0);
    });

    test('.count.toBeLessThan', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').count.toBeLessThan(10);
    });

    test('.count.toBeGreaterThanOrEqual', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').count.toBeGreaterThanOrEqual(1);
    });

    test('.count.toBeLessThanOrEqual', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').count.toBeLessThanOrEqual(1);
    });

    test('.visible.toBeTrue', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').visible.toBeTrue();
    });

    test('.visible.toBe(true)', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').visible.toBe(true);
    });

    test('.visible.toBeFalse on disabled (but visible) is flipped via .not', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.visible.toBeFalse();
    });

    test('.enabled.toBeTrue', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').enabled.toBeTrue();
    });

    test('.enabled.toBeFalse on disabled button', async ({ steps }) => {
        await steps.expect('disabledButton', 'ButtonsPage').enabled.toBeFalse();
    });

    test('.attributes.get().toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').attributes.get('data-testid').toBe('btn-primary');
    });

    test('.attributes.get().toContain', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').attributes.get('data-testid').toContain('primary');
    });

    test('.attributes.get().toMatch', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').attributes.get('data-testid').toMatch(/^btn-/);
    });

    test('.attributes.toHaveKey', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').attributes.toHaveKey('data-testid');
    });

    test('.css().toBe', async ({ steps }) => {
        const cursor = await steps.getCssProperty('primaryButton', 'ButtonsPage', 'cursor');
        await steps.expect('primaryButton', 'ButtonsPage').css('cursor').toBe(cursor);
    });

    test('.css().toContain', async ({ steps }) => {
        const cursor = await steps.getCssProperty('primaryButton', 'ButtonsPage', 'cursor');
        await steps.expect('primaryButton', 'ButtonsPage').css('cursor').toContain(cursor.slice(0, 3));
    });

    test('.css().toMatch', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').css('cursor').toMatch(/pointer|default|auto/);
    });

    test('.toBe(predicate) positive', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').toBe(el => el.text === 'Primary');
    });

    test('.toBe(predicate).throws(message) sets custom message', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage')
            .toBe(el => el.visible && el.enabled)
            .throws('must be visible and enabled');
    });

    test('.not.toBe(predicate) flips outcome', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.toBe(el => el.text === 'Wrong');
    });
});

test.describe('steps.expect() — value matcher (input fields)', () => {
    test.beforeEach(async ({ steps }) => { await gotoTextInputs(steps); });

    test('.value.toBe on typed input', async ({ steps }) => {
        await steps.fill('textInput', 'TextInputsPage', 'Alice');
        await steps.expect('textInput', 'TextInputsPage').value.toBe('Alice');
    });

    test('.value.toContain / toMatch / toStartWith / toEndWith', async ({ steps }) => {
        await steps.fill('textInput', 'TextInputsPage', 'Alice Example');
        await steps.expect('textInput', 'TextInputsPage').value.toContain('lice');
        await steps.expect('textInput', 'TextInputsPage').value.toMatch(/^Alice/);
        await steps.expect('textInput', 'TextInputsPage').value.toStartWith('Alice');
        await steps.expect('textInput', 'TextInputsPage').value.toEndWith('Example');
    });

    test('.value.not.toBe', async ({ steps }) => {
        await steps.fill('textInput', 'TextInputsPage', 'Alice');
        await steps.expect('textInput', 'TextInputsPage').value.not.toBe('Bob');
    });
});

test.describe('steps.expect() — .not negation on every field', () => {
    test.beforeEach(async ({ steps }) => { await gotoButtons(steps); });

    test('.not.text.toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.text.toBe('Nope');
    });

    test('.text.not.toContain', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').text.not.toContain('xyz');
    });

    test('.not.count.toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.count.toBe(99);
    });

    test('.count.not.toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').count.not.toBe(99);
    });

    test('.not.visible.toBeFalse (visible element)', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.visible.toBeFalse();
    });

    test('.visible.not.toBeFalse', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').visible.not.toBeFalse();
    });

    test('.not.enabled.toBeFalse (enabled element)', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.enabled.toBeFalse();
    });

    test('.not.attributes.toHaveKey', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.attributes.toHaveKey('nonexistent');
    });

    test('.attributes.not.toHaveKey', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').attributes.not.toHaveKey('nonexistent');
    });

    test('.attributes.get().not.toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').attributes.get('data-testid').not.toBe('btn-secondary');
    });

    test('.not.attributes.get().toBe (via ExpectBuilder.not propagation)', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.attributes.get('data-testid').toBe('btn-secondary');
    });

    test('.not.css().toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.css('cursor').toBe('not-a-real-cursor');
    });

    test('.css().not.toBe', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').css('cursor').not.toBe('not-a-real-cursor');
    });

    test('.css().not.toContain', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').css('cursor').not.toContain('nonsense');
    });

    test('.css().not.toMatch', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').css('cursor').not.toMatch(/nonsense/);
    });
});
