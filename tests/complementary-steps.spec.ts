import { test, expect } from './fixture/StepFixture';
import { ElementAction, ElementInteractions } from '../src';

/**
 * Coverage for the Phase-1 complementary Steps surface (RFC: complementary
 * steps API) — the page-level verification family and the scoped `findBy*`
 * child queries a consumer suite previously had to drop to raw Playwright
 * `page.*` / `page.locator(parent).getBy*` for:
 *
 * - `steps.verifyPageContainsText(text | RegExp)`        — document-body contains
 * - `steps.verifyPageNotContainsText(text | RegExp)`     — document-body absence (XSS / 404)
 * - `steps.verifyPageTitle(title | RegExp)`              — page <title>
 * - `steps.getHtml(el, page, { outer })`                 — element-level HTML (inner/outer)
 * - `steps.on(el, page).findByRole / findByText / findBySelector` — scoped child queries
 *
 * All run against the live Vue test app. The TablePage `table` element is the
 * scoped-query container — a real `[data-testid='table']` holding a header row
 * plus five data rows (6 `row`, 30 `cell`, 30 `td`), so the scoped counts and
 * terminals assert genuine on-page structure.
 *
 * Negative-path tests construct ElementAction directly with a short timeout so
 * failing retries resolve quickly.
 */

const FAST_TIMEOUT = 500;

/** Navigate to the Table demo page used by the scoped-query tests. */
async function gotoTable(steps: import('../src').Steps): Promise<void> {
    await steps.navigateTo('/');
    await steps.click('tableLink', 'SidebarNav');
    await steps.verifyUrlContains('/table');
}

test.describe('Page-level verification — verifyPageContainsText / NotContainsText', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoTable(steps);
    });

    test('verifyPageContainsText passes on a known body substring', async ({ steps }) => {
        // "UI Components" is the app shell heading present on every page.
        await steps.verifyPageContainsText('UI Components');
        // Row data rendered into the table is part of the body text too.
        await steps.verifyPageContainsText('Alice Martin');
    });

    test('verifyPageContainsText accepts a RegExp', async ({ steps }) => {
        await steps.verifyPageContainsText(/alice@example\.com/i);
    });

    test('verifyPageNotContainsText passes when the text is absent (XSS-style probe)', async ({ steps }) => {
        // A raw script payload must never appear as literal body text.
        await steps.verifyPageNotContainsText('<script>alert');
        await steps.verifyPageNotContainsText(/server error|404 not found/i);
    });

    test('verifyPageContainsText throws when the text is missing', async ({ steps }) => {
        await expect(
            steps.verifyPageContainsText('this-copy-is-not-on-the-page-xyz', { timeout: FAST_TIMEOUT }),
        ).rejects.toThrow();
    });

    test('verifyPageNotContainsText throws when the text IS present', async ({ steps }) => {
        await expect(
            steps.verifyPageNotContainsText('Alice Martin', { timeout: FAST_TIMEOUT }),
        ).rejects.toThrow();
    });
});

test.describe('Page-level verification — verifyPageTitle', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoTable(steps);
    });

    test('verifyPageTitle passes on the exact title', async ({ steps }) => {
        await steps.verifyPageTitle('vue-test-app');
    });

    test('verifyPageTitle accepts a RegExp', async ({ steps }) => {
        await steps.verifyPageTitle(/vue-test/i);
    });

    test('verifyPageTitle throws on a wrong title', async ({ steps }) => {
        await expect(
            steps.verifyPageTitle('Some Other App', { timeout: FAST_TIMEOUT }),
        ).rejects.toThrow();
    });
});

test.describe('Element-level HTML extraction — steps.getHtml (inner vs outer)', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoTable(steps);
    });

    test('getHtml returns innerHTML by default (no wrapping tag)', async ({ steps }) => {
        const html = await steps.getHtml('table', 'TablePage');
        // innerHTML of the table contains rows but NOT the <table ...> open tag.
        expect(html).toContain('Alice Martin');
        expect(html).toMatch(/<tr[\s>]/);
        expect(html.trimStart().startsWith('<table')).toBe(false);
    });

    test('getHtml with { outer: true } includes the element tag itself', async ({ steps }) => {
        const html = await steps.getHtml('table', 'TablePage', { outer: true });
        expect(html.trimStart().startsWith('<table')).toBe(true);
        expect(html).toContain("data-testid=\"table\"");
        expect(html).toContain('Alice Martin');
    });
});

test.describe('Scoped child queries — findByRole / findByText / findBySelector', () => {
    test.beforeEach(async ({ steps }) => {
        await gotoTable(steps);
    });

    test('findByRole scopes getByRole within the parent (.count)', async ({ steps }) => {
        // Header row + five data rows = 6 rows; 5 rows x 6 columns = 30 data cells.
        await steps.on('table', 'TablePage').findByRole('row').count.toBe(6);
        await steps.on('table', 'TablePage').findByRole('cell').count.toBe(30);
    });

    test('findByRole with a name option narrows to a single match (.count + .getText)', async ({ steps }) => {
        const cell = steps.on('table', 'TablePage').findByRole('cell', { name: 'Alice Martin' });
        await cell.count.toBe(1);
        expect(await cell.getText()).toBe('Alice Martin');
    });

    test('findByText scopes getByText within the parent (.verifyState visible)', async ({ steps }) => {
        await steps.on('table', 'TablePage').findByText('Alice Martin').verifyState('visible');
    });

    test('findBySelector scopes a raw CSS query within the parent (.count + .verifyState)', async ({ steps }) => {
        const cells = steps.on('table', 'TablePage').findBySelector('td');
        await cells.count.toBe(30);
        // .first() narrowing composes onto the scoped locator.
        await steps.on('table', 'TablePage').findBySelector('td').first().verifyState('visible');
    });

    test('findByRole composes with .nth() narrowing', async ({ steps }) => {
        // Second row (index 1) is the first data row — its first cell is "Alice Martin".
        const secondRow = steps.on('table', 'TablePage').findByRole('row').nth(1);
        await secondRow.verifyState('visible');
        expect(await secondRow.getText()).toContain('Alice Martin');
    });

    test('scoped query scopes correctly — text outside the parent is not matched', async ({ steps, page, repo }) => {
        // "UI Components" (the app shell heading) is on the page but NOT inside
        // the table, so a scoped findByText must resolve to zero matches.
        await gotoTable(steps);
        const fast = new ElementInteractions(page, { timeout: FAST_TIMEOUT });
        const action = new ElementAction(repo, 'table', 'TablePage', fast, FAST_TIMEOUT);
        await action.findByText('UI Components').count.toBe(0);
    });

    test('scoped chain rejects an unsupported strategy (.random) with a clear error', async ({ steps }) => {
        // A scoped findBy* already filters by role/text/selector — layering RANDOM
        // on top must fail fast, not silently behave like .first().
        await expect(
            steps.on('table', 'TablePage').findByRole('row').random().verifyState('visible'),
        ).rejects.toThrow(/not supported on a scoped findBy\*\(\) chain/);
    });
});
