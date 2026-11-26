import { test, expect } from '@playwright/test';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { PollTimeoutError, Steps } from '../src/index';
import { AppiumFactory } from '../src/appium';
import { ReResolvingElement } from '../src/appium/ReResolvingElement';
import { DEVICE_PLATFORMS, driverError, expectNotSupported, mockElement, mockUiDriver, screenSwipes, type MockNode } from './appium/mocks';

/**
 * Platform paths of the shared features (verifyAbsence, "list": true
 * entries, listed elements with child / withDescendant, visibility probes and
 * gates, polling matchers) on the REAL AppiumFactory and ElementRepository,
 * over a mock native UI tree, for android and ios. No device.
 */

const STEP_TIMEOUT = 600;

/** A reader flipping from `before` to `after` on its `n`-th read (1-based), counting reads. */
function flipOnRead<T>(n: number, before: T, after: T): { read: () => T; reads: () => number } {
    let reads = 0;
    return { read: () => (++reads >= n ? after : before), reads: () => reads };
}

function pages(platform: string) {
    return {
        pages: [{
            name: 'Screen',
            platform,
            elements: [
                { elementName: 'rows', list: true, selector: { 'accessibility id': 'row' } },
                { elementName: 'emptyList', list: true, selector: { 'accessibility id': 'nothing' } },
                { elementName: 'items', selector: { 'accessibility id': 'item' } },
                { elementName: 'title', selector: { 'accessibility id': 'title' } },
                { elementName: 'banner', selector: { 'accessibility id': 'banner' } },
                { elementName: 'toast', selector: { 'accessibility id': 'toast' } },
                { elementName: 'status', selector: { 'accessibility id': 'status' } },
                { elementName: 'field', selector: { 'accessibility id': 'field' } },
                { elementName: 'draft', provisional: true, selector: { 'accessibility id': 'draft' } },
                {
                    elementName: 'dialog',
                    selector: { 'accessibility id': 'primary', fallback: { 'accessibility id': 'secondary' } },
                },
                {
                    elementName: 'chain',
                    selector: {
                        'accessibility id': 'node-1',
                        fallback: { 'accessibility id': 'node-2', fallback: { 'accessibility id': 'node-3' } },
                    },
                },
            ],
        }],
    };
}

/** Three rows (each with a title; only the third with a badge) plus an orphan title and badge OUTSIDE the list. */
function listTree(overrides: { rowVisible?: Array<MockNode['visible']>; rows?: boolean } = {}): MockNode[] {
    const texts = ['Apple pie', 'Apple', 'banana'];
    const rows: MockNode[] = overrides.rows === false ? [] : texts.map((text, i) => ({
        match: '~row',
        text,
        visible: overrides.rowVisible?.[i] ?? true,
        attributes: { name: `r${i + 1}` },
        children: [
            { match: '~title', text: `title ${i + 1}${i === 1 ? ' second' : ''}` },
            ...(i === 2 ? [{ match: '~badge', text: 'NEW' }] : []),
        ],
    }));
    return [
        { match: '~list', children: rows },
        { match: '~title', text: 'Orphan title' },
        { match: '~badge', text: 'orphan badge' },
    ];
}

const ITEM_LABELS = ['Red 1', 'Red 2', 'Blue 1', 'Blue 2', 'Green 1', 'Green 2'];

/** Six items under one entry (not a list entry), each text read taking `readMs` like a real driver round trip. */
function itemTree(readMs = 0): MockNode[] {
    const slow = (text: string) => async () => {
        if (readMs > 0) await new Promise(resolve => setTimeout(resolve, readMs));
        return text;
    };
    return [{ match: '~column', children: ITEM_LABELS.map((text, i) => ({ match: '~item', text: slow(text), attributes: { name: `item-${i + 1}` } })) }];
}

function deviceSteps(platform: 'android' | 'ios', tree: MockNode[], timeout = STEP_TIMEOUT) {
    const mock = mockUiDriver(tree, { capabilities: { platformName: platform } });
    const repo = new ElementRepository(mock.driver, pages(platform), { platform, timeout });
    const factory = new AppiumFactory(mock.driver, platform, { timeout, appId: 'com.example.app' });
    const steps = new Steps(factory, repo);
    return { steps, mock };
}

async function caught(call: () => unknown): Promise<Error | undefined> {
    try {
        await call();
    } catch (error) {
        return error as Error;
    }
    return undefined;
}

async function timed<T>(call: () => Promise<T>): Promise<{ result?: T; error?: Error; elapsed: number }> {
    const started = Date.now();
    try {
        const result = await call();
        return { result, elapsed: Date.now() - started };
    } catch (error) {
        return { error: error as Error, elapsed: Date.now() - started };
    }
}

for (const platform of DEVICE_PLATFORMS) {
    test.describe(`verifyAbsence on ${platform}`, () => {
        test('a displayed element fails after the step timeout', async () => {
            const { steps } = deviceSteps(platform, [{ match: '~toast', text: 'Saved' }]);
            for (const run of [() => steps.verifyAbsence('toast', 'Screen'), () => steps.on('toast', 'Screen').verifyAbsence()]) {
                const { error, elapsed } = await timed(run);
                expect(error?.message).toMatch(/absent/);
                expect(elapsed).toBeGreaterThanOrEqual(STEP_TIMEOUT - 50);
                expect(elapsed).toBeLessThan(STEP_TIMEOUT + 3000);
            }
        });

        test('an element that disappears on the 3rd poll passes', async () => {
            const visible = flipOnRead(3, true, false);
            const { steps } = deviceSteps(platform, [{ match: '~toast', visible: visible.read }]);
            await steps.verifyAbsence('toast', 'Screen', { timeout: 2000 });
            expect(visible.reads()).toBe(3);
        });

        test('an element not in the tree passes; a hidden one passes; a per-call timeout is honoured', async () => {
            await deviceSteps(platform, []).steps.verifyAbsence('toast', 'Screen');
            await deviceSteps(platform, [{ match: '~toast', visible: false }]).steps.verifyAbsence('toast', 'Screen');
            const { steps } = deviceSteps(platform, [{ match: '~toast' }]);
            const { error, elapsed } = await timed(() => steps.verifyAbsence('toast', 'Screen', { timeout: 1500 }));
            expect(error).toBeDefined();
            expect(elapsed).toBeGreaterThanOrEqual(1450);
        });

        test('absence holds only when EVERY match is hidden', async () => {
            const { steps } = deviceSteps(platform, [{ match: '~toast', visible: false }, { match: '~toast', visible: true }]);
            expect(await caught(() => steps.verifyAbsence('toast', 'Screen'))).toBeDefined();
        });

        test('fallback: asserted on the node the repository resolves (web semantics)', async () => {
            // Primary missing, fallback shown: the walk lands on the fallback -> present -> fails.
            let r = deviceSteps(platform, [{ match: '~secondary' }]);
            expect((await caught(() => r.steps.verifyAbsence('dialog', 'Screen')))?.message).toMatch(/absent/);
            // Primary exists but hidden, fallback shown: the walk stops at the primary -> absent -> passes.
            r = deviceSteps(platform, [{ match: '~primary', visible: false }, { match: '~secondary' }]);
            await r.steps.verifyAbsence('dialog', 'Screen');
            // Primary shown: fails.
            r = deviceSteps(platform, [{ match: '~primary' }]);
            expect(await caught(() => r.steps.verifyAbsence('dialog', 'Screen'))).toBeDefined();
            // No node at all, or only a hidden fallback: passes.
            await deviceSteps(platform, []).steps.verifyAbsence('dialog', 'Screen');
            await deviceSteps(platform, [{ match: '~secondary', visible: false }]).steps.verifyAbsence('dialog', 'Screen');
        });

        test('a provisional entry keeps the same meaning', async () => {
            await deviceSteps(platform, []).steps.verifyAbsence('draft', 'Screen');
            expect(await caught(() => deviceSteps(platform, [{ match: '~draft' }]).steps.verifyAbsence('draft', 'Screen'))).toBeDefined();
        });

        test('a dead session never passes as absent', async () => {
            const { steps, mock } = deviceSteps(platform, []);
            mock.failWith(driverError('invalid session id', 'invalid session id: the session is gone'));
            const error = await caught(() => steps.verifyAbsence('toast', 'Screen'));
            expect(error, 'verifyAbsence must not pass on a dead session').toBeDefined();
        });
    });

    test.describe(`"list": true entries on ${platform}`, () => {
        test('verifyPresence: one displayed match is enough, none fails with the list message', async () => {
            let r = deviceSteps(platform, listTree({ rowVisible: [false, true, false] }));
            await r.steps.verifyPresence('rows', 'Screen');
            await r.steps.on('rows', 'Screen').verifyPresence();
            r = deviceSteps(platform, listTree({ rowVisible: [false, false, false] }));
            const { error, elapsed } = await timed(() => r.steps.verifyPresence('rows', 'Screen'));
            expect(error?.message).toMatch(/list entry \("list": true\).*found 3 match\(es\) and none visible/);
            expect(elapsed).toBeGreaterThanOrEqual(STEP_TIMEOUT - 50);
        });

        test('verifyPresence waits for the first row to appear (re-resolved per poll)', async () => {
            const exists = flipOnRead(4, false, true);
            const tree = listTree();
            (tree[0] as MockNode).exists = exists.read;
            const { steps } = deviceSteps(platform, tree);
            await steps.verifyPresence('rows', 'Screen', { timeout: 3000 });
        });

        test('getCount and getAll see every match, through the ALL strategy', async () => {
            const { steps } = deviceSteps(platform, listTree());
            expect(await steps.getCount('rows', 'Screen')).toBe(3);
            expect(await steps.getAll('rows', 'Screen')).toEqual(['Apple pie', 'Apple', 'banana']);
            expect(await steps.getAll('rows', 'Screen', { extractAttribute: 'name' })).toEqual(['r1', 'r2', 'r3']);
            await steps.verifyCount('rows', 'Screen', { exactly: 3 });
            await steps.on('rows', 'Screen').count.toBe(3);
        });

        test('getAll on an empty list entry fails instead of returning []', async () => {
            const { steps } = deviceSteps(platform, listTree({ rows: false }));
            const error = await caught(() => steps.getAll('rows', 'Screen'));
            expect(error?.message).toMatch(/list entry \("list": true\).*found 0/);
        });

        test('getAll { child } is scoped to the list items: a child outside them never matches', async () => {
            const { steps } = deviceSteps(platform, listTree());
            const expected = ['title 1', 'title 2 second', 'title 3'];
            expect(await steps.getAll('rows', 'Screen', { child: '~title' })).toEqual(expected);
            expect(await steps.getAll('rows', 'Screen', { child: { pageName: 'Screen', elementName: 'title' } })).toEqual(expected);
            expect(await steps.getAll('rows', 'Screen', { child: '~badge' })).toEqual(['NEW']);
        });

        test('getAll with a narrowing strategy returns the picked match only, as on web', async () => {
            const { steps } = deviceSteps(platform, listTree());
            const index1 = { strategy: 'index', index: 1 } as const;
            expect(await steps.getAll('rows', 'Screen', undefined, index1)).toEqual(['Apple']);
            expect(await steps.getAll('rows', 'Screen', { extractAttribute: 'name' }, index1)).toEqual(['r2']);
            expect(await steps.getAll('rows', 'Screen', { child: '~title' }, index1)).toEqual(['title 2 second']);
            expect(await steps.getAll('rows', 'Screen', { child: '~badge' }, index1)).toEqual([]);
            expect(await steps.getAll('rows', 'Screen', { child: '~badge' }, { strategy: 'index', index: 2 })).toEqual(['NEW']);
            expect(await steps.getAll('rows', 'Screen', undefined, { strategy: 'text', text: 'banana' })).toEqual(['banana']);
            expect(await steps.getAll('rows', 'Screen', { child: '~title' }, { strategy: 'attribute', attribute: 'name', value: 'r1' }))
                .toEqual(['title 1']);
            // `all` (and the default) still read every match.
            expect(await steps.getAll('rows', 'Screen', undefined, { strategy: 'all' })).toEqual(['Apple pie', 'Apple', 'banana']);
        });

        test('a dead session fails list presence and getAll with the driver error, never "found 0"', async () => {
            const { steps, mock } = deviceSteps(platform, listTree(), 5000);
            mock.failWith(driverError('invalid session id', 'invalid session id: the session is gone'));
            const { error: presence, elapsed } = await timed(() => steps.verifyPresence('rows', 'Screen'));
            expect(presence?.message).toMatch(/invalid session id/);
            expect(elapsed, 'a dead session fails at once, not at the step timeout').toBeLessThan(2000);
            const all = await caught(() => steps.getAll('rows', 'Screen'));
            expect(all?.message).toMatch(/invalid session id/);
            expect(all?.message).not.toMatch(/found 0/);
        });

        test('an empty-string child is honoured (checked with !== undefined, not truthiness)', async () => {
            const { steps } = deviceSteps(platform, listTree());
            // '' is a child selector nothing answers to: no texts, not the rows' own texts.
            expect(await steps.getAll('rows', 'Screen', { child: '' })).toEqual([]);
        });
    });

    test.describe(`fluent collection reads on ${platform}`, () => {
        test('getCount and getAllTexts read every match, as steps.getCount / steps.getAll do', async () => {
            const { steps } = deviceSteps(platform, itemTree());
            expect(await steps.getCount('items', 'Screen')).toBe(6);
            expect(await steps.on('items', 'Screen').getCount()).toBe(6);
            expect(await steps.on('items', 'Screen').getAllTexts()).toEqual(ITEM_LABELS);
        });

        test('getCount and getAllTexts are collection-level: a strategy selector does not narrow them', async () => {
            const { steps } = deviceSteps(platform, itemTree());
            expect(await steps.on('items', 'Screen').nth(4).getCount()).toBe(6);
            expect(await steps.on('items', 'Screen').byText('Green 2').getAllTexts()).toEqual(ITEM_LABELS);
            expect(await steps.on('items', 'Screen').first().getAllTexts()).toEqual(ITEM_LABELS);
        });

        test('an entry with no match counts 0 and reads no texts', async () => {
            const { steps } = deviceSteps(platform, []);
            expect(await steps.on('items', 'Screen').getCount()).toBe(0);
            expect(await steps.on('items', 'Screen').getAllTexts()).toEqual([]);
        });
    });

    test.describe(`listed elements on ${platform}`, () => {
        const nameOf = (steps: Steps, options: Parameters<Steps['getListedElementData']>[2]) =>
            steps.getListedElementData('rows', 'Screen', { ...options, extractAttribute: 'name' });

        test('text: the web hasText rule (substring ignoring case, whitespace normalised, first in list order); regex', async () => {
            const { steps } = deviceSteps(platform, listTree());
            // No exact-match tier: "Apple pie" comes first and contains "Apple", as on web.
            expect(await nameOf(steps, { text: 'Apple' })).toBe('r1');
            expect(await nameOf(steps, { text: 'pie' })).toBe('r1');
            expect(await nameOf(steps, { text: 'BANANA' })).toBe('r3');
            expect(await nameOf(steps, { text: '  apple \t PIE ' })).toBe('r1');
            expect(await nameOf(steps, { text: { regex: '^Apple$' } })).toBe('r2');
            expect(await nameOf(steps, { text: { regex: '^ban' } })).toBe('r3');
            expect(await nameOf(steps, { attribute: { name: 'name', value: 'r2' } })).toBe('r2');
            expect(await nameOf(steps, { attribute: { name: 'name', value: { regex: '3$' } } })).toBe('r3');
            expect(await steps.getListedElementData('rows', 'Screen', { text: 'banana' })).toBe('banana');
        });

        test('withDescendant searches inside each item only', async () => {
            const { steps } = deviceSteps(platform, listTree());
            // The orphan badge outside the list must not make row 1 match.
            expect(await nameOf(steps, { withDescendant: { child: '~badge' } })).toBe('r3');
            expect(await nameOf(steps, { withDescendant: { child: '~title', text: 'SECOND' } })).toBe('r2');
            expect(await nameOf(steps, { text: 'Apple', withDescendant: { child: { pageName: 'Screen', elementName: 'title' } } })).toBe('r1');
            expect(await nameOf(steps, { withDescendant: { child: '~title', text: '  title  2 ' } })).toBe('r2');
            // No item has a descendant with that text; the orphan title does: no match.
            const error = await caught(() => nameOf(steps, { withDescendant: { child: '~title', text: 'Orphan' } }));
            expect(error?.message).toMatch(/No listed element matched/);
        });

        test('child returns the descendant of the matched item, never one outside it', async () => {
            const { steps } = deviceSteps(platform, listTree());
            expect(await steps.getListedElementData('rows', 'Screen', { text: 'pie', child: '~title' })).toBe('title 1');
            expect(await steps.getListedElementData('rows', 'Screen', { text: 'banana', child: { pageName: 'Screen', elementName: 'title' } })).toBe('title 3');
            await steps.verifyListedElement('rows', 'Screen', { text: 'Apple', child: '~title', expectedText: 'title 1' });
            await steps.verifyListedElement('rows', 'Screen', { text: { regex: '^Apple$' }, child: '~title', expectedText: 'title 2 second' });
            await steps.verifyListedElement('rows', 'Screen', { text: 'Apple', expected: { name: 'name', value: 'r1' } });
            await steps.verifyListedElement('rows', 'Screen', { text: 'Apple' });
        });

        test('clickListedElement taps the matched item', async () => {
            const { steps, mock } = deviceSteps(platform, listTree());
            await steps.clickListedElement('rows', 'Screen', { text: 'banana', child: '~badge' });
            expect(mock.calls.filter(c => c[0] === 'click')).toEqual([['click', '~badge', '~row']]);
        });

        test('a dead session fails a listed-element step with the driver error', async () => {
            const { steps, mock } = deviceSteps(platform, listTree(), 5000);
            mock.failWith(driverError('invalid session id', 'invalid session id: the session is gone'));
            for (const run of [
                () => steps.clickListedElement('rows', 'Screen', { text: 'banana' }),
                () => steps.verifyListedElement('rows', 'Screen', { text: 'banana' }),
                () => steps.getListedElementData('rows', 'Screen', { text: 'banana' }),
            ] as Array<() => Promise<unknown>>) {
                const { error, elapsed } = await timed(run);
                expect(error?.message).toMatch(/invalid session id/);
                expect(elapsed, 'a dead session fails at once, not at the step timeout').toBeLessThan(2000);
            }
            expect(mock.calls.filter(c => c[0] === 'click')).toEqual([]);
        });

        test('options that cannot identify an item, or a wrong reference, fail before anything resolves', async () => {
            const { steps, mock } = deviceSteps(platform, listTree());
            for (const run of [
                () => steps.clickListedElement('rows', 'Screen', {}),
                () => steps.verifyListedElement('rows', 'Screen', { expectedText: 'x' }),
                () => steps.getListedElementData('rows', 'Screen', { text: 'x', child: { pageName: 'Screen', elementName: 'missing' } }),
                () => steps.getListedElementData('rows', 'Screen', { withDescendant: { child: { pageName: 'Nope', elementName: 'x' } } }),
            ]) {
                expect(await caught(run)).toBeDefined();
            }
            expect(mock.lookups, 'nothing was looked up').toEqual([]);
        });
    });

    test.describe(`probes and gates on ${platform}`, () => {
        test('the isVisible probe answers true / false within its timeout', async () => {
            expect(await deviceSteps(platform, [{ match: '~banner' }]).steps.isVisible('banner', 'Screen', { timeout: 300 })).toBe(true);
            const { result, elapsed } = await timed(async () => deviceSteps(platform, [{ match: '~banner', visible: false }])
                .steps.isVisible('banner', 'Screen', { timeout: 300 }));
            expect(result).toBe(false);
            expect(elapsed).toBeGreaterThanOrEqual(290);
            expect(elapsed).toBeLessThan(2000);
        });

        test('the probe re-resolves: an element that enters the tree late is seen', async () => {
            const exists = flipOnRead(4, false, true);
            const { steps, mock } = deviceSteps(platform, [{ match: '~banner', exists: exists.read }]);
            expect(await steps.isVisible('banner', 'Screen', { timeout: 3000 })).toBe(true);
            expect(mock.lookupCount('~banner')).toBeGreaterThan(1);
        });

        test('the probe re-resolves a fallback entry: a late primary wins over the fallback', async () => {
            const exists = flipOnRead(3, false, true);
            const { steps } = deviceSteps(platform, [
                { match: '~primary', exists: exists.read, text: 'primary' },
                { match: '~secondary', visible: false },
            ]);
            expect(await steps.isVisible('dialog', 'Screen', { timeout: 3000 })).toBe(true);
        });

        test('containsText', async () => {
            const { steps } = deviceSteps(platform, [{ match: '~banner', text: 'Summer sale' }]);
            expect(await steps.isVisible('banner', 'Screen', { timeout: 300, containsText: 'sale' })).toBe(true);
            expect(await steps.isVisible('banner', 'Screen', { timeout: 300, containsText: 'winter' })).toBe(false);
        });

        test('gates skip a hidden element and act on a visible one', async () => {
            let r = deviceSteps(platform, [{ match: '~banner', visible: false }]);
            await r.steps.isVisible('banner', 'Screen', { timeout: 300 }).click();
            await r.steps.on('banner', 'Screen').ifVisible(300).click();
            await r.steps.isVisible('banner', 'Screen', { timeout: 300 }).text.toBe('never checked');
            expect(r.mock.calls.filter(c => c[0] === 'click')).toEqual([]);

            r = deviceSteps(platform, [{ match: '~banner', text: 'Hi' }]);
            await r.steps.isVisible('banner', 'Screen', { timeout: 300 }).click();
            await r.steps.on('banner', 'Screen').ifVisible(300).click();
            expect(r.mock.calls.filter(c => c[0] === 'click')).toHaveLength(2);
            const error = await caught(() => Promise.resolve(r.steps.isVisible('banner', 'Screen', { timeout: 300 }).text.toBe('Bye')));
            expect(error?.message, 'a visible element is asserted').toMatch(/Bye/);
        });

        test('a dead session is thrown by a probe and a gate, never read as "hidden"', async () => {
            const { steps, mock } = deviceSteps(platform, [{ match: '~banner' }]);
            mock.failWith(driverError('invalid session id', 'invalid session id'));
            expect(await caught(async () => { await steps.isVisible('banner', 'Screen', { timeout: 300 }); })).toBeDefined();
            expect(await caught(() => steps.isVisible('banner', 'Screen', { timeout: 300 }).click())).toBeDefined();
            expect(await caught(() => steps.on('banner', 'Screen').ifVisible(300).click())).toBeDefined();
        });

        test('a web-only terminal behind a visibility gate is refused before anything is sent, shown or not', async () => {
            type Gated = { [K in 'hover' | 'rightClick' | 'uploadFile' | 'selectDropdown' | 'setSliderValue' | 'selectMultiple']: (...a: never[]) => Promise<unknown> };
            const terminals: Array<[string, (chain: Gated) => Promise<unknown>]> = [
                ['hover', c => c.hover()],
                ['rightClick', c => c.rightClick()],
                ['uploadFile', c => (c.uploadFile as (p: string) => Promise<void>)('/tmp/upload.txt')],
                ['selectDropdown', c => c.selectDropdown()],
                ['setSliderValue', c => (c.setSliderValue as (v: number) => Promise<void>)(5)],
                ['selectMultiple', c => (c.selectMultiple as (v: string[]) => Promise<string[]>)(['a'])],
            ];
            const gates: Array<[string, (steps: Steps) => unknown]> = [
                ['steps.isVisible(...)', s => s.isVisible('banner', 'Screen', { timeout: 100 })],
                ['steps.on(...).isVisible()', s => s.on('banner', 'Screen').isVisible({ timeout: 100 })],
                ['steps.on(...).ifVisible()', s => s.on('banner', 'Screen').ifVisible(100)],
            ];
            const trees: Array<[string, MockNode[]]> = [
                ['missing', []],
                ['hidden', [{ match: '~banner', visible: false }]],
                ['shown', [{ match: '~banner' }]],
            ];
            for (const [state, tree] of trees) {
                for (const [gateName, gate] of gates) {
                    for (const [name, run] of terminals) {
                        const { steps, mock } = deviceSteps(platform, tree);
                        await expectNotSupported(() => run(gate(steps) as Gated), name, platform);
                        expect(mock.lookups, `${gateName}.${name}() on a ${state} element sends nothing`).toEqual([]);
                    }
                }
            }
        });

        test('a web-only matcher behind a visibility gate is refused before anything is sent', async () => {
            const { steps, mock } = deviceSteps(platform, []);
            await expectNotSupported(() => steps.isVisible('banner', 'Screen', { timeout: 100 }).css('color').toBe('red'), 'css', platform);
            await expectNotSupported(() => steps.on('banner', 'Screen').ifVisible(100).css('color').toBe('red'), 'css', platform);
            await expectNotSupported(() => steps.on('banner', 'Screen').ifVisible(100).html.toBe('<b/>'), 'html', platform);
            await expectNotSupported(() => steps.on('banner', 'Screen').ifVisible(100).outerHtml.toContain('b'), 'outerHtml', platform);
            expect(mock.lookups).toEqual([]);
        });

        test('clickIfPresent skips a missing element and taps a shown one', async () => {
            let r = deviceSteps(platform, []);
            expect(await r.steps.clickIfPresent('banner', 'Screen')).toBe(false);
            r = deviceSteps(platform, [{ match: '~banner' }]);
            expect(await r.steps.clickIfPresent('banner', 'Screen')).toBe(true);
            expect(r.mock.calls.filter(c => c[0] === 'click')).toHaveLength(1);
        });

        test('a dead session is thrown by clickIfPresent and scrollUntilFound, never a skip or a swipe loop', async () => {
            const { steps, mock } = deviceSteps(platform, [{ match: '~banner' }]);
            mock.failWith(driverError('invalid session id', 'invalid session id: the session is gone'));
            expect((await caught(() => steps.clickIfPresent('banner', 'Screen')))?.message).toMatch(/invalid session id/);
            const { error, elapsed } = await timed(() => steps.scrollUntilFound('banner', 'Screen', { timeout: 5000 }));
            expect(error?.message).toMatch(/invalid session id/);
            expect(elapsed, 'fails at once instead of swiping until the timeout').toBeLessThan(2000);
            expect(mock.calls.filter(c => c[0] === 'performActions')).toEqual([]);
        });
    });

    test.describe(`matchers poll on ${platform}`, () => {
        test('text.toBe passes once the value flips', async () => {
            const status = flipOnRead(4, 'loading', 'ready');
            const { steps } = deviceSteps(platform, [{ match: '~status', text: status.read }]);
            await steps.expect('status', 'Screen').text.toBe('ready');
            expect(status.reads()).toBe(4);
        });

        test('a matcher that never holds fails after the timeout with the last value', async () => {
            const { steps } = deviceSteps(platform, [{ match: '~status', text: 'loading' }]);
            const { error, elapsed } = await timed(() => Promise.resolve(steps.expect('status', 'Screen').text.toBe('ready')));
            expect(error?.message).toMatch(/"loading"/);
            expect(error?.message).toMatch(new RegExp(`${STEP_TIMEOUT} ms`));
            expect(elapsed).toBeGreaterThanOrEqual(STEP_TIMEOUT - 50);
            expect(elapsed).toBeLessThan(STEP_TIMEOUT + 3000);
        });

        test('every poll re-resolves: a late fallback primary is read, not the fallback the first walk chose', async () => {
            const exists = flipOnRead(3, false, true);
            const { steps } = deviceSteps(platform, [
                { match: '~primary', exists: exists.read, text: 'primary' },
                { match: '~secondary', text: 'fallback' },
            ]);
            await steps.expect('dialog', 'Screen').timeout(3000).text.toBe('primary');
        });

        test('a poll re-resolves without an attach wait: short timeouts pass on a missing node and a long chain', async () => {
            // A missing element: each poll is one existence check, so a 200 ms matcher gets its polls in.
            const missing = await timed(() => Promise.resolve(deviceSteps(platform, []).steps.on('banner', 'Screen').timeout(200).visible.toBeFalse()));
            expect(missing.error, 'visible.toBeFalse on a missing element within 200 ms').toBeUndefined();
            expect(missing.elapsed).toBeLessThan(1000);
            // A 3-node fallback chain whose last node shows the text: two missing nodes cost no attach wait.
            const { steps } = deviceSteps(platform, [{ match: '~node-3', text: 'third' }]);
            const chain = await timed(() => Promise.resolve(steps.on('chain', 'Screen').timeout(800).text.toBe('third')));
            expect(chain.error, 'text.toBe on the last chain node within 800 ms').toBeUndefined();
            expect(chain.elapsed).toBeLessThan(800);
            await steps.expect('chain', 'Screen').timeout(800).satisfy(el => el.text === 'third' && el.count === 1);
            await steps.on('chain', 'Screen').timeout(800).count.toBe(1);
        });

        test('every poll re-resolves: a redrawn element is read afresh', async () => {
            // The old node is replaced by a new one after its text was read twice.
            let oldReads = 0;
            const { steps, mock } = deviceSteps(platform, [
                { match: '~status', exists: () => oldReads < 2, text: () => { oldReads++; return 'old'; } },
                { match: '~status', exists: () => oldReads >= 2, text: 'new' },
            ]);
            await steps.on('status', 'Screen').timeout(3000).text.toBe('new');
            expect(mock.lookupCount('~status')).toBeGreaterThan(2);
        });

        test('visible / enabled / attributes / not / count / satisfy poll too', async () => {
            const visible = flipOnRead(3, false, true);
            const { steps } = deviceSteps(platform, [
                { match: '~banner', visible: visible.read, attributes: { name: 'banner-1' } },
            ]);
            await steps.on('banner', 'Screen').visible.toBeTrue();
            await steps.on('banner', 'Screen').attributes.get('name').toBe('banner-1');
            await steps.on('banner', 'Screen').not.text.toBe('nope');
            await steps.verifyState('banner', 'Screen', 'enabled');
            const shown = flipOnRead(3, true, false);
            await deviceSteps(platform, [{ match: '~banner', visible: shown.read }]).steps.on('banner', 'Screen').visible.toBeFalse();
        });

        test('satisfy() re-captures a snapshot per poll and prints the last one on failure', async () => {
            const status = flipOnRead(3, 'loading', 'ready');
            const { steps } = deviceSteps(platform, [{ match: '~status', text: status.read, attributes: { name: 'status-cell' } }]);
            await steps.on('status', 'Screen').satisfy(el => el.text === 'ready' && el.visible && el.count === 1);
            const attrName = platform === 'ios' ? 'name' : 'resource-id';
            const r = deviceSteps(platform, [{ match: '~status', text: 'loading', attributes: { [attrName]: 'status-cell' } }]);
            const error = await caught(() => Promise.resolve(r.steps.on('status', 'Screen').satisfy(el => el.text === 'ready')));
            expect(error?.message).toMatch(/snapshot at timeout/);
            expect(error?.message).toMatch(/"text": "loading"/);
            expect(error?.message).toMatch(/status-cell/);
        });

        test('satisfy() fails at once on a dead session instead of folding it into a snapshot', async () => {
            const { steps, mock } = deviceSteps(platform, [{ match: '~status', text: 'x' }]);
            mock.failWith(driverError('invalid session id', 'invalid session id'));
            const { error, elapsed } = await timed(() => Promise.resolve(steps.on('status', 'Screen').timeout(5000).satisfy(el => !el.visible)));
            expect(error?.message).toMatch(/invalid session id/);
            expect(elapsed).toBeLessThan(2000);
        });
    });
}

test.describe('ReResolvingElement (the handle device verifications poll)', () => {
    test('dragTo is refused with a clear error naming the entry, on derived handles too', async () => {
        const handle = new ReResolvingElement(async () => mockElement(), "'Screen.status'");
        expect(handle.selector).toBeUndefined();
        const error = await caught(() => handle.dragTo(mockElement()));
        expect(error?.message).toMatch(/dragTo: 'Screen\.status' is a re-resolving element, used by verifications only/);
        expect((await caught(() => handle.first().dragTo(mockElement())))?.message).toMatch(/'Screen\.status'/);
    });

    test('getters re-resolve on every read', async () => {
        let resolutions = 0;
        const handle = new ReResolvingElement(async () => { resolutions++; return mockElement({ text: `t${resolutions}` }); });
        expect(await handle.textContent()).toBe('t1');
        expect(await handle.textContent()).toBe('t2');
    });
});

test.describe('visible text on ios is the label, falling back to the value', () => {
    // A settings row with a badge: XCUITest's getText answers the value "1";
    // the label "General" is what the row shows. A title with no label reads
    // its value; a navigation bar with neither reads "", never its name.
    const badgeRow = (n: number): MockNode => ({
        match: '~row', text: '1',
        attributes: { label: `General ${n}`, value: '1', name: `row-${n}`, type: 'XCUIElementTypeButton' },
        children: [{ match: '~title', text: '1', attributes: { label: `title ${n}`, value: '1' } }],
    });
    const tree = (): MockNode[] => [
        { match: '~list', children: [badgeRow(1), badgeRow(2)] },
        { match: '~banner', text: '1', attributes: { label: 'General', value: '1', type: 'XCUIElementTypeButton' } },
        { match: '~status', text: 'ready', attributes: { label: null, value: 'ready' } },
        { match: '~toast', text: '', attributes: { label: null, value: null, name: 'General' } },
        { match: '~field', text: 'Email', attributes: { label: 'Email', value: 'typed text', type: 'XCUIElementTypeTextField' } },
    ];

    test('verifications, matchers, getText, snapshots and probes read the label', async () => {
        const { steps } = deviceSteps('ios', tree());
        await steps.verifyText('banner', 'Screen', 'General');
        await steps.verifyTextContains('banner', 'Screen', 'Gen');
        await steps.expect('banner', 'Screen').text.toBe('General');
        await steps.expect('banner', 'Screen').satisfy(el => el.text === 'General');
        expect(await steps.getText('banner', 'Screen')).toBe('General');
        expect(await steps.on('banner', 'Screen').getText()).toBe('General');
        expect(await steps.isVisible('banner', 'Screen', { timeout: 300, containsText: 'General' })).toBe(true);
        expect(await steps.getText('status', 'Screen')).toBe('ready');
        expect(await steps.getText('toast', 'Screen')).toBe('');
        // a text input reads its typed value before its label
        expect(await steps.getText('field', 'Screen')).toBe('typed text');
        await steps.verifyText('field', 'Screen', 'typed text');
        const error = await caught(() => steps.verifyText('banner', 'Screen', '1'));
        expect(error?.message).toMatch(/Last value: "General"/);
    });

    test('lists, order and listed elements match on the label', async () => {
        const { steps } = deviceSteps('ios', tree());
        expect(await steps.getAll('rows', 'Screen')).toEqual(['General 1', 'General 2']);
        expect(await steps.getAll('rows', 'Screen', { child: '~title' })).toEqual(['title 1', 'title 2']);
        await steps.verifyOrder('rows', 'Screen', ['General 1', 'General 2']);
        await steps.verifyListOrder('rows', 'Screen', 'asc');
        expect(await steps.getListedElementData('rows', 'Screen', { text: 'general 2', extractAttribute: 'name' })).toBe('row-2');
        expect(await steps.getListedElementData('rows', 'Screen', {
            withDescendant: { child: '~title', text: 'title 2' }, extractAttribute: 'name',
        })).toBe('row-2');
    });
});

for (const platform of DEVICE_PLATFORMS) {
    test.describe(`scrollUntilFound on ${platform} is element-repository's scrollIntoView sweep`, () => {
        test('swipes with element-repository\'s touch swipe until the element is displayed', async () => {
            const shown = flipOnRead(3, false, true);
            const { steps, mock } = deviceSteps(platform, [{ match: '~title', text: 'Title', visible: shown.read }]);
            await steps.scrollUntilFound('title', 'Screen', { timeout: 10000 });
            // screenSwipes checks each gesture is exactly buildTouchSwipe's payload, released after
            const swipes = screenSwipes(mock.calls);
            expect(swipes.length).toBeGreaterThan(0);
            // target below (default 'down'): the finger moves up
            expect(new Set(swipes.map(s => s.direction))).toEqual(new Set(['up']));
        });

        test('the step timeout bounds the sweep', async () => {
            const { steps } = deviceSteps(platform, [{ match: '~title', text: 'Title', visible: false }]);
            const { error, elapsed } = await timed(() => steps.scrollUntilFound('title', 'Screen', { direction: 'right', timeout: 300 }));
            expect(error?.message).toMatch(/within the 300 ms timeout .*direction=right/);
            expect(elapsed).toBeLessThan(3000);
        });

        test('maxSwipes bounds the sweep', async () => {
            const { steps, mock } = deviceSteps(platform, [{ match: '~title', text: 'Title', visible: false }]);
            const error = await caught(() => steps.scrollUntilFound('title', 'Screen', { maxSwipes: 2, timeout: 20000 }));
            expect(error?.message).toMatch(/after 2 swipes, the swipe limit/);
            expect(screenSwipes(mock.calls)).toHaveLength(2);
        });
    });
}

/**
 * Android reads that element-repository answers differently from the raw
 * UiAutomator2 wire values, as the steps see them: a container's text, a
 * missing attribute, and the checked state with check / uncheck.
 */
test.describe('android element reads through the steps', () => {
    /** Rows whose own text is empty: the visible text sits in two child TextViews (plus a hint, which is not text). */
    function containerTree(): MockNode[] {
        const rows: MockNode[] = [['Item 1', 'Alpha'], ['Item 2', 'Beta']].map(([title, category], i) => ({
            match: '~row',
            text: '',
            attributes: { name: `r${i + 1}` },
            children: [
                { match: '~title', text: title },
                { match: '~hint', text: 'Search', attributes: { 'showing-hint': 'true' } },
                { match: '~category', text: category },
            ],
        }));
        return [{ match: '~list', children: rows }, { match: '~title', text: 'Outside' }];
    }

    test('a container with empty own text reads its descendants\' text, joined with spaces in document order, hints left out', async () => {
        const { steps } = deviceSteps('android', containerTree());
        expect(await steps.getAll('rows', 'Screen')).toEqual(['Item 1 Alpha', 'Item 2 Beta']);
        expect(await steps.getText('rows', 'Screen')).toBe('Item 1 Alpha');
        await steps.verifyText('rows', 'Screen');
        await steps.verifyText('rows', 'Screen', 'Item 1 Alpha');
        await steps.verifyTextContains('rows', 'Screen', 'Alpha');
        await steps.expect('rows', 'Screen').text.toBe('Item 1 Alpha');
    });

    test('listed-element text matching and the text strategy see a container\'s descendants\' text', async () => {
        const { steps } = deviceSteps('android', containerTree());
        expect(await steps.getListedElementData('rows', 'Screen', { text: 'beta', extractAttribute: 'name' })).toBe('r2');
        expect(await steps.getListedElementData('rows', 'Screen', { text: { regex: '^Item 2 Beta$' }, extractAttribute: 'name' })).toBe('r2');
        await steps.verifyListedElement('rows', 'Screen', { text: 'Item 2', child: '~category', expectedText: 'Beta' });
        expect(await steps.getAll('rows', 'Screen', undefined, { strategy: 'text', text: 'Item 2 Beta' })).toEqual(['Item 2 Beta']);
    });

    test('a missing attribute reads as null, not the driver\'s "null" string', async () => {
        const { steps } = deviceSteps('android', [{ match: '~status', text: 'Ready', attributes: { 'resource-id': 'app:id/status' } }]);
        expect(await steps.getAttribute('status', 'Screen', 'resource-id')).toBe('app:id/status');
        expect(await steps.getAttribute('status', 'Screen', 'hint')).toBeNull();
        // An attribute filter never matches an element that lacks the attribute.
        const rows = deviceSteps('android', listTree());
        const error = await caught(() => rows.steps.getListedElementData('rows', 'Screen', { attribute: { name: 'missing', value: 'null' } }));
        expect(error?.message).toMatch(/No listed element matched/);
    });

    /** A checkable control whose `checked` attribute flips on every tap (a radio button only ever checks). */
    function control(className: string, initially: boolean, options: { checkable?: string; radio?: boolean } = {}) {
        let checked = initially;
        const node: MockNode = {
            match: '~field',
            text: 'Option',
            attributes: { class: className, checkable: options.checkable ?? 'true', checked: () => String(checked) },
            onClick: () => { checked = options.radio ? true : !checked; },
        };
        return { node, checked: () => checked };
    }
    const taps = (mock: ReturnType<typeof deviceSteps>['mock']) => mock.calls.filter(c => c[0] === 'click').length;

    test('verifyState checked reads the checked attribute', async () => {
        await deviceSteps('android', [control('android.widget.CheckBox', true).node]).steps.verifyState('field', 'Screen', 'checked');
        const error = await caught(() => deviceSteps('android', [control('android.widget.Switch', false).node]).steps.verifyState('field', 'Screen', 'checked'));
        // Timed out having read the switch as unchecked, not on a read that threw.
        expect(error).toBeInstanceOf(PollTimeoutError);
        expect(error).toMatchObject({ lastValue: false });
    });

    test('check and uncheck tap only when the state differs, and confirm the new state', async () => {
        let c = control('android.widget.CheckBox', false);
        let r = deviceSteps('android', [c.node]);
        await r.steps.check('field', 'Screen');
        await r.steps.check('field', 'Screen');
        expect(taps(r.mock), 'one tap checks; checking a checked box taps nothing').toBe(1);
        expect(c.checked()).toBe(true);

        c = control('android.widget.Switch', true);
        r = deviceSteps('android', [c.node]);
        await r.steps.uncheck('field', 'Screen');
        await r.steps.uncheck('field', 'Screen');
        expect(taps(r.mock), 'one tap unchecks; unchecking an unchecked switch taps nothing').toBe(1);
        expect(c.checked()).toBe(false);
    });

    test('uncheck refuses a checked radio button and check refuses a control that is not checkable, without a tap', async () => {
        const radio = deviceSteps('android', [control('android.widget.RadioButton', true, { radio: true }).node]);
        expect((await caught(() => radio.steps.uncheck('field', 'Screen')))?.message).toMatch(/is a radio button; select another option instead/);
        const plain = deviceSteps('android', [control('android.widget.TextView', false, { checkable: 'false' }).node]);
        expect((await caught(() => plain.steps.check('field', 'Screen')))?.message).toMatch(/is not checkable/);
        expect(taps(radio.mock) + taps(plain.mock)).toBe(0);
    });

    test('check on a disabled control fails once the step timeout runs out, without a tap', async () => {
        const disabled: MockNode = { ...control('android.widget.CheckBox', false).node, enabled: false };
        const { steps, mock } = deviceSteps('android', [disabled], 300);
        expect((await caught(() => steps.check('field', 'Screen')))?.message).toMatch(/is disabled/);
        expect(taps(mock)).toBe(0);
    });

    test('a tap that does not change the state fails the step instead of passing', async () => {
        const stuck: MockNode = { match: '~field', attributes: { class: 'android.widget.CheckBox', checkable: 'true', checked: 'false' } };
        const { steps, mock } = deviceSteps('android', [stuck]);
        expect((await caught(() => steps.check('field', 'Screen')))?.message).toMatch(/is still unchecked after clicking/);
        expect(taps(mock)).toBe(1);
    });
});

/**
 * On iOS a switch reports its state in `value` ("1" on, "0" off), not in
 * `selected`; element-repository reads `value` only for switch and toggle
 * types.
 */
test.describe('ios switch state through the steps', () => {
    /** An `XCUIElementTypeSwitch` whose `value` flips between "1" and "0" on every tap. */
    function iosSwitch(initially: boolean) {
        let on = initially;
        const node: MockNode = {
            match: '~field',
            text: 'Sound',
            attributes: { type: 'XCUIElementTypeSwitch', label: 'Sound', value: () => (on ? '1' : '0') },
            onClick: () => { on = !on; },
        };
        return { node, on: () => on };
    }
    const taps = (mock: ReturnType<typeof deviceSteps>['mock']) => mock.calls.filter(c => c[0] === 'click').length;

    test('verifyState checked reads the switch value', async () => {
        await deviceSteps('ios', [iosSwitch(true).node]).steps.verifyState('field', 'Screen', 'checked');
        const error = await caught(() => deviceSteps('ios', [iosSwitch(false).node]).steps.verifyState('field', 'Screen', 'checked'));
        expect(error).toBeInstanceOf(PollTimeoutError);
        expect(error).toMatchObject({ lastValue: false });
    });

    test('a value of "1" on a type that is not a switch is not read as checked', async () => {
        const badge: MockNode = { match: '~field', text: 'General', attributes: { type: 'XCUIElementTypeButton', label: 'General', value: '1' } };
        const error = await caught(() => deviceSteps('ios', [badge]).steps.verifyState('field', 'Screen', 'checked'));
        expect(error).toBeInstanceOf(PollTimeoutError);
        expect(error).toMatchObject({ lastValue: false });
    });

    test('check and uncheck tap only when the value differs, and confirm the new value', async () => {
        let sw = iosSwitch(false);
        let r = deviceSteps('ios', [sw.node]);
        await r.steps.check('field', 'Screen');
        await r.steps.check('field', 'Screen');
        expect(taps(r.mock), 'one tap turns it on; checking an on switch taps nothing').toBe(1);
        expect(sw.on()).toBe(true);

        sw = iosSwitch(true);
        r = deviceSteps('ios', [sw.node]);
        await r.steps.uncheck('field', 'Screen');
        await r.steps.uncheck('field', 'Screen');
        expect(taps(r.mock), 'one tap turns it off; unchecking an off switch taps nothing').toBe(1);
        expect(sw.on()).toBe(false);
    });
});
