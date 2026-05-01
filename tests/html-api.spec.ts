import { test, expect } from './fixture/StepFixture';
import { ElementAction, ElementInteractions } from '../src';
import { gotoButtons } from './fixture/pageHelpers';

/**
 * Coverage for the HTML extraction + verification surface:
 *
 * - `steps.getHtml` / `steps.getPageHtml`               (extraction)
 * - `steps.verifyHtml*` / `steps.verifyPageHtml*`       (top-level assertions)
 * - `steps.on(...).getHtml / verifyHtml*`               (fluent terminals)
 * - `.html` / `.outerHtml` matcher tree                 (chainable assertions)
 * - `outer` toggle, `negated`, custom timeout, retry semantics, regex
 *
 * Negative-path tests construct ElementAction directly with a short timeout so
 * failing retries resolve quickly.
 */

const FAST_TIMEOUT = 500;

test.describe('Extraction — steps.getHtml / steps.getPageHtml', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('getHtml returns innerHTML by default (button label substring)', async ({ steps }) => {
        const html = await steps.getHtml('primaryButton', 'ButtonsPage');
        expect(html).toContain('Primary');
        expect(html).not.toContain('data-testid');
    });

    test('getHtml with { outer: true } returns outerHTML (includes the tag)', async ({ steps }) => {
        const html = await steps.getHtml('primaryButton', 'ButtonsPage', { outer: true });
        expect(html).toContain('data-testid="btn-primary"');
        expect(html.startsWith('<')).toBe(true);
    });

    test('getPageHtml returns body innerHTML containing app structure', async ({ steps }) => {
        const html = await steps.getPageHtml();
        expect(html).toContain('btn-primary');
        expect(html).not.toContain('<head>');
    });

    test('getPageHtml with { outer: true } returns full document outerHTML', async ({ steps }) => {
        const html = await steps.getPageHtml({ outer: true });
        expect(html.startsWith('<html')).toBe(true);
        expect(html).toContain('<head>');
        expect(html).toContain('</html>');
    });
});

test.describe('Element-scoped — steps.verifyHtml*', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('verifyHtmlContains passes on substring (innerHTML default)', async ({ steps }) => {
        await steps.verifyHtmlContains('primaryButton', 'ButtonsPage', 'Primary');
    });

    test('verifyHtmlContains with { outer: true } finds attribute', async ({ steps }) => {
        await steps.verifyHtmlContains('primaryButton', 'ButtonsPage', 'data-testid="btn-primary"', { outer: true });
    });

    test('verifyHtmlMatches accepts regex', async ({ steps }) => {
        await steps.verifyHtmlMatches('primaryButton', 'ButtonsPage', /Pri\w+ary/);
    });

    test('verifyHtmlContains throws on missing substring', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);
        await expect(action.verifyHtmlContains('definitely-not-in-the-html')).rejects.toThrow(/html to contain/);
    });
});

test.describe('Page-scoped — steps.verifyPageHtml*', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('verifyPageHtmlContains passes for content rendered into body', async ({ steps }) => {
        await steps.verifyPageHtmlContains('btn-primary');
    });

    test('verifyPageHtmlContains with { negated: true } passes when substring is absent', async ({ steps }) => {
        // Common XSS-probe shape: payload must not appear unescaped on the page.
        await steps.verifyPageHtmlContains('<script>alert(__never__)</script>', { negated: true });
    });

    test('verifyPageHtmlContains with { outer: true } can match against <head> contents', async ({ steps }) => {
        await steps.verifyPageHtmlContains('<title', { outer: true });
    });

    test('verifyPageHtmlMatches accepts regex', async ({ steps }) => {
        await steps.verifyPageHtmlMatches(/data-testid="btn-\w+"/);
    });

    test('verifyPageHtmlContains throws when substring is missing (no negation)', async ({ page, repo }) => {
        const { Steps } = await import('../src');
        const fastSteps = new Steps(repo, { timeout: FAST_TIMEOUT });
        // sanity — we navigated already in beforeEach via shared fixture
        await fastSteps.navigateTo('/buttons');
        await expect(
            fastSteps.verifyPageHtmlContains('definitely-not-on-this-page'),
        ).rejects.toThrow(/body html to contain/);
        // Reuse `page` to keep biome happy; the throwaway Steps shares the page.
        expect(page.url()).toContain('/buttons');
    });
});

test.describe('Fluent terminals — steps.on(...).getHtml / verifyHtml*', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('.getHtml returns innerHTML', async ({ steps }) => {
        const html = await steps.on('primaryButton', 'ButtonsPage').getHtml();
        expect(html).toContain('Primary');
    });

    test('.getHtml({ outer: true }) returns outerHTML', async ({ steps }) => {
        const html = await steps.on('primaryButton', 'ButtonsPage').getHtml({ outer: true });
        expect(html).toContain('btn-primary');
    });

    test('.verifyHtmlContains delegates through matcher tree', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').verifyHtmlContains('Primary');
    });

    test('.verifyHtmlMatches with regex', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage').verifyHtmlMatches(/^P\w+y$/);
    });
});

test.describe('Matcher tree — .html / .outerHtml on top-level expect', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('.html.toBe matches exact innerHTML', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').html.toBe('Primary');
    });

    test('.html.toContain on substring', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').html.toContain('rim');
    });

    test('.html.toMatch on regex', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').html.toMatch(/^Prim/);
    });

    test('.html.toStartWith / toEndWith', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').html.toStartWith('Pri');
        await steps.expect('primaryButton', 'ButtonsPage').html.toEndWith('ary');
    });

    test('.outerHtml.toContain finds attribute', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').outerHtml.toContain('data-testid="btn-primary"');
    });

    test('.not.html.toContain flips outcome', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').not.html.toContain('Secondary');
    });

    test('.html.not.toContain flips outcome', async ({ steps }) => {
        await steps.expect('primaryButton', 'ButtonsPage').html.not.toContain('Secondary');
    });
});

test.describe('Matcher tree — chained html with other matchers', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoButtons(steps);
    });

    test('.html.toContain composes with other field matchers in one chain', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage')
            .text.toBe('Primary')
            .html.toContain('Primary')
            .outerHtml.toContain('btn-primary')
            .visible.toBeTrue();
    });

    test('per-matcher .timeout() applies to .html', async ({ steps }) => {
        await steps.on('primaryButton', 'ButtonsPage')
            .html.timeout(5000).toContain('Primary');
    });
});

test.describe('Matcher tree — failure messages', () => {
    test('.html.toContain failure reports element scope and substring', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);
        await expect(action.html.toContain('NOT-IN-HTML')).rejects.toThrow(/html to contain "NOT-IN-HTML"/);
    });

    test('.outerHtml.not.toContain throws when substring is present', async ({ page, repo }) => {
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'primaryButton', 'ButtonsPage', fast, FAST_TIMEOUT);
        await expect(action.outerHtml.not.toContain('btn-primary')).rejects.toThrow(/outerHtml not to contain/);
    });
});
