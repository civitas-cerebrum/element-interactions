import { test, expect, type Page } from '@playwright/test';
import { ElementRepository, WebElement, type Element } from '@civitas-cerebrum/element-repository';
import { Steps, Verifications } from '../src';
import type { EntryTarget } from '../src/interfaces/IEntryTarget';
import { ReResolvingElement } from '../src/appium/ReResolvingElement';
import { mockElement } from './appium/mocks';

/**
 * The entry-level probes of the web family (`pollTarget`, `probeVisible`,
 * `listPresence`), the chain's `probeVisible`, and the pass-through reads of
 * the re-resolving device handle. Uses page.setContent(): no server.
 */

const CONTENT = `
    <ul>
        <li class="row" hidden>Sold out</li>
        <li class="row">soup 4.00</li>
    </ul>
    <p class="hidden-note" hidden>gone</p>
    <ul class="empty"></ul>
`;

/** An entry over a CSS selector of the page, as a fluent chain would hand it over. */
function entryOf(page: Page, css: string, elementName = 'rows'): EntryTarget {
    const one = async (): Promise<Element> => new WebElement(page.locator(css).first());
    return {
        elementName,
        pageName: 'ProbePage',
        resolve: one,
        resolveDefault: one,
        resolveAll: async () => new WebElement(page.locator(css)),
        probe: one,
    };
}

test.describe('web Verifications: entry probes', () => {
    test.beforeEach(async ({ page }) => {
        await page.setContent(CONTENT);
    });

    test('pollTarget resolves the chain element, or the whole collection', async ({ page }) => {
        const verify = new Verifications(page, 1000);
        const entry = entryOf(page, 'li.row');
        const single = await verify.pollTarget(entry);
        const all = await verify.pollTarget(entry, true);
        expect(await single.count()).toBe(1);
        expect(await all.count()).toBe(2);
    });

    test('probeVisible answers true for a visible element and checks containsText', async ({ page }) => {
        const verify = new Verifications(page, 1000);
        const visible = entryOf(page, 'li.row >> visible=true');
        expect(await verify.probeVisible(visible, 500)).toBe(true);
        expect(await verify.probeVisible(visible, 500, 'soup')).toBe(true);
        expect(await verify.probeVisible(visible, 500, 'salad')).toBe(false);
    });

    test('probeVisible answers false, without throwing, for a hidden or missing element', async ({ page }) => {
        const verify = new Verifications(page, 1000);
        expect(await verify.probeVisible(entryOf(page, 'p.hidden-note'), 300)).toBe(false);
        expect(await verify.probeVisible(entryOf(page, 'p.nowhere'), 300)).toBe(false);
    });

    test('listPresence passes when any match is visible, even when the first is hidden', async ({ page }) => {
        const verify = new Verifications(page, 1000);
        await verify.listPresence(entryOf(page, 'li.row'), 500);
    });

    test('listPresence fails naming the entry and the match count when none is visible', async ({ page }) => {
        const verify = new Verifications(page, 1000);
        const error = await verify.listPresence(entryOf(page, 'p.hidden-note', 'note'), 300).then(() => undefined, (e: Error) => e);
        expect(error?.message).toMatch(/'ProbePage\.note' is a list entry/);
        expect(error?.message).toMatch(/found 1 match\(es\) and none visible/);
    });

    test('listPresence fails reporting zero matches for an entry that matches nothing', async ({ page }) => {
        const verify = new Verifications(page, 1000);
        const error = await verify.listPresence(entryOf(page, 'ul.empty li', 'empty'), 300).then(() => undefined, (e: Error) => e);
        expect(error?.message).toMatch(/'ProbePage\.empty' is a list entry/);
        expect(error?.message).toMatch(/found 0 match\(es\) and none visible/);
    });
});

test.describe('ElementAction.probeVisible', () => {
    const REPOSITORY = {
        pages: [{
            name: 'ProbePage',
            elements: [
                { elementName: 'note', selector: { css: 'p.hidden-note' } },
                { elementName: 'soup', selector: { css: 'li.row:not([hidden])' } },
            ],
        }],
    };

    test('answers the visibility of the chain element within the timeout, with an optional text check', async ({ page }) => {
        await page.setContent(CONTENT);
        const steps = new Steps(new ElementRepository(page, REPOSITORY, 500), { timeout: 1000 });
        expect(await steps.on('soup', 'ProbePage').probeVisible(500)).toBe(true);
        expect(await steps.on('soup', 'ProbePage').probeVisible(500, 'soup')).toBe(true);
        expect(await steps.on('soup', 'ProbePage').probeVisible(500, 'salad')).toBe(false);
        expect(await steps.on('note', 'ProbePage').probeVisible(300)).toBe(false);
    });
});

test.describe('ReResolvingElement pass-through reads', () => {
    test('raw and getTagName read the freshly resolved element on every call', async () => {
        let resolutions = 0;
        const handle = new ReResolvingElement(async () => {
            resolutions++;
            return {
                ...mockElement(),
                raw: async () => `<row n="${resolutions}"/>`,
                getTagName: async () => `XCUIElementTypeCell${resolutions}`,
            } as unknown as Element;
        }, "'ProbePage.row'");
        expect(await handle.raw()).toBe('<row n="1"/>');
        expect(await handle.getTagName()).toBe('XCUIElementTypeCell2');
        expect(await handle.raw()).toBe('<row n="3"/>');
        expect(resolutions).toBe(3);
    });
});
