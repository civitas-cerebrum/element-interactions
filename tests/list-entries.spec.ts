import { test, expect } from './fixture/StepFixture';
import type { Page } from '@playwright/test';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { Steps } from '../src';
import { createLogger } from '../src/logger/Logger';
import { isListEntry } from '../src/steps/listEntry';

const log = createLogger('tests');

/**
 * `"list": true` repository entries (element-repository schema key) carry the
 * contract "a collection with at least one match" (count ≥ 1):
 *
 *   - `verifyPresence` passes when ANY match is visible — not only the first;
 *   - `getAll` requires at least one match and throws on an empty collection
 *     instead of returning `[]`;
 *   - a narrowing strategy (`.nth()`, `{ strategy: 'index' }`, …) opts out and
 *     keeps single-element semantics.
 *
 * Entries without the flag are unchanged. Uses page.setContent() — no server.
 */

const CATALOGUE = `
    <ul class="catalogue">
        <li class="row" hidden>Sold out</li>
        <li class="row">veggie-wrap ¤6.50</li>
        <li class="row">soup ¤4.00</li>
    </ul>
    <ul class="later"></ul>
    <script>
        setTimeout(function () {
            var li = document.createElement('li');
            li.className = 'late';
            li.textContent = 'late item';
            document.querySelector('ul.later').appendChild(li);
        }, 300);
    </script>
`;

const REPOSITORY = {
    pages: [
        {
            name: 'CataloguePage',
            elements: [
                { elementName: 'rows', list: true, selector: { css: 'li.row' } },
                { elementName: 'rowsNoFlag', selector: { css: 'li.row' } },
                { elementName: 'promoRows', list: true, selector: { css: 'li.promo' } },
                { elementName: 'promoRowsNoFlag', selector: { css: 'li.promo' } },
                { elementName: 'lateRows', list: true, selector: { css: 'li.late' } },
            ],
        },
    ],
};

const STEP_TIMEOUT = 1500;

async function catalogueSteps(page: Page): Promise<Steps> {
    await page.setContent(CATALOGUE);
    return new Steps(new ElementRepository(page, REPOSITORY, 1000), { timeout: STEP_TIMEOUT });
}

test.describe('list: true — verifyPresence', () => {

    test('passes when any match is visible, even if the first is hidden', async ({ page }) => {
        const steps = await catalogueSteps(page);
        await steps.verifyPresence('rows', 'CataloguePage');
        await steps.on('rows', 'CataloguePage').verifyPresence();
        log('list entries: verifyPresence count ≥ 1 — passed');
    });

    test('an entry without the flag keeps first-match semantics', async ({ page }) => {
        const steps = await catalogueSteps(page);
        await expect(steps.verifyPresence('rowsNoFlag', 'CataloguePage')).rejects.toThrow(/expected .*rowsNoFlag visible to be true/);
        log('list entries: unflagged entry unchanged — passed');
    });

    test('fails with a list message when nothing matches', async ({ page }) => {
        const steps = await catalogueSteps(page);
        await expect(steps.verifyPresence('promoRows', 'CataloguePage'))
            .rejects.toThrow(/'CataloguePage\.promoRows' is a list entry \("list": true\).*found 0 match/);
        log('list entries: empty list rejected — passed');
    });

    test('waits for a list that renders late', async ({ page }) => {
        const steps = await catalogueSteps(page);
        await steps.verifyPresence('lateRows', 'CataloguePage');
        log('list entries: verifyPresence waits for a late list — passed');
    });

    test('a narrowing strategy opts out of list semantics', async ({ page }) => {
        const steps = await catalogueSteps(page);
        const firstMatchFailure = /expected .*rows visible to be true/;
        await steps.on('rows', 'CataloguePage').nth(1).verifyPresence();
        await expect(steps.on('rows', 'CataloguePage').nth(0).verifyPresence()).rejects.toThrow(firstMatchFailure);
        await expect(steps.verifyPresence('rows', 'CataloguePage', { strategy: 'index', index: 0 })).rejects.toThrow(firstMatchFailure);
        // .byText() selects the hidden row: first-match semantics, not "any visible".
        await expect(steps.on('rows', 'CataloguePage').byText('Sold out').verifyPresence()).rejects.toThrow(firstMatchFailure);
        log('list entries: narrowing opts out — passed');
    });

    test('.visible() opts out: its own no-visible-match error, not the list message', async ({ page }) => {
        const steps = await catalogueSteps(page);
        await expect(steps.on('promoRows', 'CataloguePage').visible().verifyPresence())
            .rejects.toThrow(/No visible elements found for 'promoRows'/);
        log('list entries: .visible() opts out — passed');
    });

    test('a scoped findBy* opts out: it asserts on the child, not the list', async ({ page }) => {
        const steps = await catalogueSteps(page);
        // `rows` has visible matches, so list semantics would pass; the child does not exist.
        await expect(steps.on('rows', 'CataloguePage').findBySelector('.nope').verifyPresence())
            .rejects.toThrow(/findBySelector\(\.nope\) visible to be true/);
        log('list entries: scoped findBy* opts out — passed');
    });

    test('ifVisible() opts out: an absent list is skipped, not rejected', async ({ page }) => {
        const steps = await catalogueSteps(page);
        // list semantics would throw "found 0 match(es)" for the empty list.
        await steps.on('promoRows', 'CataloguePage').ifVisible(300).verifyPresence();
        log('list entries: ifVisible() opts out — passed');
    });

    test('an unknown element or page is not a list entry', async ({ page }) => {
        const repo = new ElementRepository(page, REPOSITORY, 1000);
        expect(isListEntry(repo, 'rows', 'CataloguePage')).toBe(true);
        expect(isListEntry(repo, 'rowsNoFlag', 'CataloguePage')).toBe(false);
        expect(isListEntry(repo, 'nope', 'CataloguePage')).toBe(false);
        expect(isListEntry(repo, 'rows', 'NoSuchPage')).toBe(false);
        log('list entries: unknown names answer false — passed');
    });
});

test.describe('list: true — getAll', () => {

    test('returns every match of a non-empty list', async ({ page }) => {
        const steps = await catalogueSteps(page);
        const texts = await steps.getAll('rows', 'CataloguePage');
        expect(texts).toEqual(['Sold out', 'veggie-wrap ¤6.50', 'soup ¤4.00']);
        log('list entries: getAll non-empty — passed');
    });

    test('waits for a list that renders late', async ({ page }) => {
        const steps = await catalogueSteps(page);
        expect(await steps.getAll('lateRows', 'CataloguePage')).toEqual(['late item']);
        log('list entries: getAll waits for first match — passed');
    });

    test('throws on an empty list instead of returning []', async ({ page }) => {
        const steps = await catalogueSteps(page);
        await expect(steps.getAll('promoRows', 'CataloguePage'))
            .rejects.toThrow(/getAll: 'CataloguePage\.promoRows' is a list entry \("list": true\).*found 0/);
        log('list entries: getAll empty list rejected — passed');
    });

    test('an entry without the flag still returns [] when nothing matches', async ({ page }) => {
        const steps = await catalogueSteps(page);
        expect(await steps.getAll('promoRowsNoFlag', 'CataloguePage')).toEqual([]);
        log('list entries: unflagged getAll unchanged — passed');
    });

    test('a getAll strategy opts out of the non-empty requirement', async ({ page }) => {
        const steps = await catalogueSteps(page);
        // `first` resolves the whole collection like the default, but is a narrowing strategy: no list requirement.
        expect(await steps.getAll('promoRows', 'CataloguePage', undefined, { strategy: 'first' })).toEqual([]);
        await expect(steps.getAll('promoRows', 'CataloguePage', undefined, { strategy: 'index', index: 0 }))
            .rejects.toThrow(/Index 0 out of bounds for 'promoRows'/);
        log('list entries: getAll strategy opts out — passed');
    });
});
