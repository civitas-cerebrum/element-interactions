import { test, expect } from '@playwright/test';
import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { Steps } from '../src/index';
import { AppiumFactory } from '../src/appium';
import { DEVICE_PLATFORMS, driverError, mockUiDriver, type MockNarrowing, type MockNode } from './appium/mocks';

/**
 * A `.byText()` selection on a selector element-repository can narrow (an
 * accessibility id here; also a class chain or predicate on iOS, an XPath or
 * a full resource id on Android) is answered from its native narrowed
 * queries: a hit is read and judged, and a narrowed miss is a clean miss,
 * with no full pass over the list. The device verdicts (absence,
 * `not.visible`, `visible.toBeFalse()`) therefore rest on those queries.
 * The mock's `'oracle'` mode answers them as the native query would.
 */

const TIMEOUT = 600;

const PAGES = (platform: string) => ({
    pages: [{ name: 'Screen', platform, elements: [{ elementName: 'items', selector: { 'accessibility id': 'item' } }] }],
});

function items(green: Partial<MockNode> = {}): MockNode[] {
    return [{
        match: '~column',
        children: [
            { match: '~item', text: 'Red 1' },
            { match: '~item', text: 'Green 2', ...green },
            { match: '~item', text: 'Blue 3' },
        ],
    }];
}

function deviceSteps(platform: 'android' | 'ios', tree: MockNode[], narrowing: MockNarrowing = 'oracle') {
    const mock = mockUiDriver(tree, { capabilities: { platformName: platform }, narrowing });
    const repo = new ElementRepository(mock.driver, PAGES(platform), { platform, timeout: TIMEOUT });
    const steps = new Steps(new AppiumFactory(mock.driver, platform, { timeout: TIMEOUT, appId: 'com.example.app' }), repo);
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

/** Narrowed queries the driver received, and plain lookups of the entry's selector (a full pass). */
function traffic(mock: ReturnType<typeof mockUiDriver>) {
    const narrowed = mock.lookups.filter(([, selector]) => /contains\(@text|CONTAINS\[cd\]/.test(selector)).length;
    return { narrowed, fullPasses: mock.lookupCount('~item') };
}

for (const platform of DEVICE_PLATFORMS) {
    test.describe(`a byText selection answered by narrowed queries on ${platform}`, () => {
        test('a narrowed hit that is shown: verifyAbsence and not.visible fail', async () => {
            const { steps, mock } = deviceSteps(platform, items());
            const absence = await caught(() => steps.on('items', 'Screen').byText('Green 2').verifyAbsence());
            expect(absence?.message).toMatch(/absent/);
            expect(absence?.message).toMatch(/Last value: true/);
            const hidden = await caught(async () => { await steps.on('items', 'Screen').byText('Green 2').not.visible.toBeTrue(); });
            expect(hidden?.message).toMatch(/not to be true/);
            expect(hidden?.message).toMatch(/Last value: true/);
            expect(traffic(mock), 'answered by the narrowed queries, no full pass').toEqual({ narrowed: expect.any(Number), fullPasses: 0 });
            expect(traffic(mock).narrowed).toBeGreaterThan(0);
        });

        test('a narrowed clean miss: verifyAbsence and not.visible pass, without a full pass', async () => {
            const { steps, mock } = deviceSteps(platform, items());
            await steps.on('items', 'Screen').byText('Purple 9').verifyAbsence();
            await steps.on('items', 'Screen').byText('Purple 9').not.visible.toBeTrue();
            await steps.on('items', 'Screen').byText('Purple 9').visible.toBeFalse();
            expect(traffic(mock).narrowed).toBeGreaterThan(0);
            expect(traffic(mock).fullPasses).toBe(0);
        });

        test('a narrowed hit whose text read fails (stale) is no answer: verifyAbsence fails', async () => {
            const stale = () => { throw driverError('stale element reference', 'stale element reference: the row was redrawn'); };
            const { steps, mock } = deviceSteps(platform, items({ text: stale, queryText: 'Green 2' }));
            const absence = await caught(() => steps.on('items', 'Screen').byText('Green 2').verifyAbsence());
            expect(absence, 'a hit that could not be read never reads as absent').toBeDefined();
            expect(absence?.message).toMatch(/absent/);
            expect(absence?.message).toMatch(/stale element reference/);
            const hidden = await caught(async () => { await steps.on('items', 'Screen').byText('Green 2').not.visible.toBeTrue(); });
            expect(hidden?.message).toMatch(/not to be true/);
            expect(traffic(mock).fullPasses, 'the narrowed hit is the answer: no full pass reads the list').toBe(0);
        });

        test('documents an element-repository limit: a narrowed miss deeper than appium:snapshotMaxDepth (Android; XCUITest has its own snapshot depth) reads as absent', async () => {
            // The node is shown and the full pass finds it, but the native
            // query does not see it (on Android: deeper than
            // `appium:snapshotMaxDepth`). element-repository takes the
            // narrowed miss as a clean miss, so absence passes. If
            // element-repository changes that, this test shows it.
            const deep = items({ beyondQueryDepth: true });
            await deviceSteps(platform, deep).steps.on('items', 'Screen').byText('Green 2').verifyAbsence();
            // The same tree read by the full pass (the narrowed queries rejected): the shown row fails absence.
            const full = await caught(() => deviceSteps(platform, deep, 'reject').steps.on('items', 'Screen').byText('Green 2').verifyAbsence());
            expect(full?.message).toMatch(/Last value: true/);
        });
    });
}
