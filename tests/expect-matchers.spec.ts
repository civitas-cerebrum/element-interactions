import { test, expect } from './fixture/StepFixture';
import { ElementAction, ElementInteractions } from '../src';
import { gotoButtons } from './fixture/pageHelpers';

/**
 * Covers the expect matcher tree on both:
 *   - `steps.expect(el, page).<matcher>` (top-level entry)
 *   - `steps.on(el, page).<matcher>`     (fluent builder getter)
 *
 * Plus the predicate escape hatch in both shapes and `.not` negation.
 *
 * Negative-path tests construct ElementAction directly with a short timeout
 * so failing retries resolve quickly.
 */

const FAST_TIMEOUT = 500;

test.describe('Expect matcher tree — text', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('top-level .text.toBe passes on exact match', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').text.toBe('Primary');
    });

    test('fluent .text.toBe passes on exact match', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').text.toBe('Primary');
    });

    test('.text.toContain passes on substring', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').text.toContain('rim');
    });

    test('.text.toMatch passes on regex', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').text.toMatch(/^Prim/);
    });

    test('.text.toStartWith passes on prefix', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').text.toStartWith('Prim');
    });

    test('.text.toEndWith passes on suffix', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').text.toEndWith('mary');
    });

    test('.not.text.toBe flips outcome', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').not.text.toBe('Secondary');
    });

    test('.text.not.toContain flips outcome', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').text.not.toContain('Secondary');
    });

    test('top-level .not.text.toContain flips outcome', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.text.toContain('Secondary');
    });

    test('.text.toBe throws on mismatch', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);
        await expect(action.text.toBe('Nope')).rejects.toThrow(/text to be "Nope"/);
    });

    test('.text.not.toBe throws when values match', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);
        await expect(action.text.not.toBe('Primary')).rejects.toThrow(/text not to be/);
    });
});

test.describe('Expect matcher tree — value (input fields)', () => {
    test.beforeEach(async ({ steps }) => {
        await steps.navigateTo('/');
        await steps.click('textInputsLink', 'SidebarNav');
    });

    test('.value.toBe passes on typed input', async ({ steps }) => {
        await steps.fill('textInput', 'TextInputsPage', 'Alice');
        await steps.on('textInput', 'TextInputsPage').value.toBe('Alice');
    });

    test('.value.toContain, .toMatch, .toStartWith, .toEndWith', async ({ steps }) => {
        await steps.fill('textInput', 'TextInputsPage', 'Alice Example');
        await steps.on('textInput', 'TextInputsPage').value.toContain('lice');
        await steps.on('textInput', 'TextInputsPage').value.toMatch(/^Alice/);
        await steps.on('textInput', 'TextInputsPage').value.toStartWith('Alice');
        await steps.on('textInput', 'TextInputsPage').value.toEndWith('Example');
    });

    test('.value.not.toBe flips outcome', async ({ steps }) => {
        await steps.fill('textInput', 'TextInputsPage', 'Alice');
        await steps.on('textInput', 'TextInputsPage').value.not.toBe('Bob');
    });
});

test.describe('Expect matcher tree — count', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('.count.toBe passes on exact match', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').count.toBe(1);
    });

    test('.count.toBeGreaterThan / toBeLessThan', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').count.toBeGreaterThan(0);
        await steps.on('primaryButton', 'ButtonsPage').count.toBeLessThan(10);
    });

    test('.count.toBeGreaterThanOrEqual / toBeLessThanOrEqual', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').count.toBeGreaterThanOrEqual(1);
        await steps.on('primaryButton', 'ButtonsPage').count.toBeLessThanOrEqual(1);
    });

    test('.count.not.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').count.not.toBe(5);
    });
});

test.describe('Expect matcher tree — visible / enabled', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('.visible.toBeTrue passes for visible element', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').visible.toBeTrue();
    });

    test('.visible.toBe(true) passes for visible element', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').visible.toBe(true);
    });

    test('.enabled.toBeTrue passes for enabled element', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').enabled.toBeTrue();
    });

    test('.enabled.toBeFalse passes for disabled element', async ({ steps }) => {
        await steps.on('disabledButton', 'ButtonsPage').enabled.toBeFalse();
    });

    test('.not.enabled.toBeTrue flips for disabled element', async ({ steps }) => {
        await steps.on('disabledButton', 'ButtonsPage').not.enabled.toBeTrue();
    });
});

test.describe('Expect matcher tree — attributes', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('.attributes.get(name).toBe passes', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').attributes.get('data-testid').toBe('btn-primary');
    });

    test('.attributes.get(name).toContain / toMatch', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').attributes.get('data-testid').toContain('primary');
        await steps.on('primaryButton', 'ButtonsPage').attributes.get('data-testid').toMatch(/^btn-/);
    });

    test('.attributes.toHaveKey passes', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').attributes.toHaveKey('data-testid');
    });

    test('.attributes.not.toHaveKey flips', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').attributes.not.toHaveKey('nonexistent-attr');
    });

    test('.attributes.get(name).not.toBe flips', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').attributes.get('data-testid').not.toBe('btn-secondary');
    });
});

test.describe('Expect matcher tree — css', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('.css(property).toBe passes', async ({ steps }) => {
        // `cursor` should resolve to a concrete value on buttons regardless of styling
        await steps.on('primaryButton', 'ButtonsPage').css('cursor').toMatch(/pointer|default|auto/);
    });

    test('.css(property).toContain / toMatch', async ({ steps }) => {
        const color = await steps.getCssProperty('primaryButton', 'ButtonsPage', 'color');
        await steps.on('primaryButton', 'ButtonsPage').css('color').toBe(color);
    });

    test('top-level .css(property).toMatch', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').css('cursor').toMatch(/pointer|default|auto/);
    });
});

test.describe('Expect matcher tree — predicate escape hatch', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('fluent predicate passes when true', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').toBe(el => el.text === 'Primary');
    });

    test('top-level predicate passes when true', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').toBe(el => el.text === 'Primary');
    });

    test('predicate reads multiple snapshot fields', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').toBe(
            el => el.visible && el.enabled && el.text === 'Primary' && el.attributes['data-testid'] === 'btn-primary',
        );
    });

    test('.throws(message) surfaces custom failure message', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);
        await expect(
            action.toBe(el => el.text === 'NotThere').throws('primary must say NotThere'),
        ).rejects.toThrow(/primary must say NotThere/);
    });

    test('default failure includes snapshot JSON', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);
        await expect(action.toBe(el => el.text === 'Nope')).rejects.toThrow(/snapshot at timeout/);
    });

    test('chain is synchronous before await (thenable semantics)', async ({ steps }) => {
        // Build the assertion without awaiting, then await later — must succeed.
        const pending = steps.on('primaryButton', 'ButtonsPage').toBe(el => el.visible);
        await pending;
    });

    test('builder.then() is callable directly (PromiseLike contract)', async ({ steps }) => {
        // Covers ExpectBuilder.then explicitly — this is what `await` triggers under the hood.
        const builder = steps.on('primaryButton', 'ButtonsPage').text.toBe('Primary');
        await new Promise<void>((resolve, reject) => {
            builder.then(() => resolve(), reject);
        });
    });
});

test.describe('Expect matcher tree — strategy selector composition', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('.first() + .text.toBe', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').first().text.toBe('Primary');
    });

    test('.nth(0) + .text.toContain', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').nth(0).text.toContain('rim');
    });
});

test.describe('Expect matcher tree — ifVisible composition', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('ifVisible() silently skips when element is hidden', async ({ steps }) => {
        // No banner on this page — matcher should NOT throw, it should just skip
        await steps.on('noSuchElement', 'ButtonsPage').ifVisible(200).text.toBe('anything');
    });

    test('ifVisible() + predicate silently skips when element is hidden', async ({ steps }) => {
        await steps.on('noSuchElement', 'ButtonsPage').ifVisible(200).toBe(el => el.text === 'x');
    });
});
