import { test, expect } from '@playwright/test';
import type { Element } from '@civitas-cerebrum/element-repository';
import { AppiumFactory, AppiumVerifications } from '../src/appium';
import { PollTimeoutError } from '../src/utils/poll';
import { mockDriver, mockElement, changing, expectNotSupported, DEVICE_PLATFORMS, type MockElementSpec } from './appium/mocks';
import { DEVICE_METHODS } from './appium/methods';

/**
 * Pure unit tests: every Appium verification polls until its timeout. Each
 * case scripts a getter whose value is wrong twice and right on the 3rd
 * read; the assertion must pass after exactly 3 reads, and fail after its
 * timeout with the last value when the value never turns right.
 */

const CAPS = {
    android: { platformName: 'Android', 'appium:appPackage': 'com.example.app' },
    ios: { platformName: 'iOS', 'appium:bundleId': 'com.example.App' },
} as const;

type Case = {
    /** Which mock getter the assertion reads. */
    getter: keyof MockElementSpec;
    /** Two wrong values, then the right one. */
    values: [unknown, unknown, unknown];
    run: (v: AppiumVerifications, el: Element, timeout: number) => Promise<void>;
    /** Text the timeout message must contain. */
    message: string;
};

const attr = (values: [unknown, unknown, unknown]) => values;

const CASES: Record<string, Case> = {
    text: { getter: 'text', values: ['a', 'b', ' Done '], run: (v, el, t) => v.text(el, 'Done', { timeout: t }), message: 'Expected text "Done"' },
    'text notEmpty': { getter: 'text', values: [null, '  ', 'x'], run: (v, el, t) => v.text(el, undefined, { notEmpty: true, timeout: t }), message: 'non-empty' },
    textContains: { getter: 'text', values: ['a', 'b', 'xx Done xx'], run: (v, el, t) => v.textContains(el, 'Done', { timeout: t }), message: 'to contain "Done"' },
    textMatches: { getter: 'text', values: ['a', 'b', 'Total: 42'], run: (v, el, t) => v.textMatches(el, /\d+$/, { timeout: t }), message: 'to match /\\d+$/' },
    textStartsWith: { getter: 'text', values: ['a', 'b', 'Hello world'], run: (v, el, t) => v.textStartsWith(el, 'Hello', { timeout: t }), message: 'to match /^Hello/' },
    textEndsWith: { getter: 'text', values: ['a', 'b', 'Hello world'], run: (v, el, t) => v.textEndsWith(el, 'world', { timeout: t }), message: 'to match /world$/' },
    presence: { getter: 'visible', values: [false, false, true], run: (v, el, t) => v.presence(el, { timeout: t }), message: 'element to be displayed' },
    absence: { getter: 'visible', values: [true, true, false], run: (v, el, t) => v.absence(el, { timeout: t }), message: 'to be absent' },
    'state enabled': { getter: 'enabled', values: [false, false, true], run: (v, el, t) => v.state(el, 'enabled', { timeout: t }), message: 'element to be enabled' },
    'state editable': { getter: 'enabled', values: [false, false, true], run: (v, el, t) => v.state(el, 'editable', { timeout: t }), message: 'element to be editable' },
    'state disabled': { getter: 'enabled', values: [true, true, false], run: (v, el, t) => v.state(el, 'disabled', { timeout: t }), message: 'element to be disabled' },
    'state checked': { getter: 'checked', values: [false, false, true], run: (v, el, t) => v.state(el, 'checked', { timeout: t }), message: 'element to be checked' },
    'state visible': { getter: 'visible', values: [false, false, true], run: (v, el, t) => v.state(el, 'visible', { timeout: t }), message: 'element to be visible' },
    'state inViewport': { getter: 'visible', values: [false, false, true], run: (v, el, t) => v.state(el, 'inViewport', { timeout: t }), message: 'element to be inViewport' },
    'state hidden': { getter: 'visible', values: [true, true, false], run: (v, el, t) => v.state(el, 'hidden', { timeout: t }), message: 'element to be hidden' },
    'state attached': { getter: 'exists', values: [false, false, true], run: (v, el, t) => v.state(el, 'attached', { timeout: t }), message: 'element to be attached' },
    attribute: { getter: 'attributes', values: attr([null, 'off', 'on']), run: (v, el, t) => v.attribute(el, 'value', 'on', { timeout: t }), message: 'attribute "value" to be "on"' },
    attributeContains: { getter: 'attributes', values: attr([null, 'x', 'is on now']), run: (v, el, t) => v.attributeContains(el, 'value', 'on', { timeout: t }), message: 'to contain "on"' },
    attributeMatches: { getter: 'attributes', values: attr([null, 'x', 'on-7']), run: (v, el, t) => v.attributeMatches(el, 'value', /on-\d/, { timeout: t }), message: 'to match /on-\\d/' },
    hasAttribute: { getter: 'attributes', values: attr([null, null, '']), run: (v, el, t) => v.hasAttribute(el, 'value', { timeout: t }), message: 'to be present' },
    inputValue: { getter: 'inputValue', values: ['', 'ab', 'abc'], run: (v, el, t) => v.inputValue(el, 'abc', { timeout: t }), message: 'input value "abc"' },
    inputValueContains: { getter: 'inputValue', values: ['', 'x', 'xabcx'], run: (v, el, t) => v.inputValueContains(el, 'abc', { timeout: t }), message: 'to contain "abc"' },
    inputValueMatches: { getter: 'inputValue', values: ['', 'x', 'a1'], run: (v, el, t) => v.inputValueMatches(el, /\d/, { timeout: t }), message: 'to match /\\d/' },
    inputValueStartsWith: { getter: 'inputValue', values: ['', 'x', 'abc'], run: (v, el, t) => v.inputValueStartsWith(el, 'ab', { timeout: t }), message: 'to match /^ab/' },
    inputValueEndsWith: { getter: 'inputValue', values: ['', 'x', 'abc'], run: (v, el, t) => v.inputValueEndsWith(el, 'bc', { timeout: t }), message: 'to match /bc$/' },
    count: { getter: 'count', values: [0, 1, 3], run: (v, el, t) => v.count(el, { exactly: 3 }, { timeout: t }), message: 'count exactly 3' },
    'count range': { getter: 'count', values: [0, 9, 4], run: (v, el, t) => v.count(el, { greaterThan: 2, lessThan: 5 }, { timeout: t }), message: 'count > 2 and < 5' },
};

/**
 * Device verifications with no row in CASES, and why. Every other method in
 * DEVICE_METHODS.verifications must have a CASES row (keyed by the method
 * name, optionally followed by a space and a variant).
 */
const EXEMPT: Record<string, string> = {
    order: 'polls a list of texts; covered by "order and listOrder poll the texts of all matches"',
    listOrder: 'polls a list of texts; covered by "order and listOrder poll the texts of all matches"',
    expectEqual: 'compares two captured values; nothing to poll',
    expectNotEqual: 'compares two captured values; nothing to poll',
    expectEventually: 'private polling helper behind every case',
    readText: 'private probe helper',
    allTexts: 'private probe helper',
    anyDisplayed: 'private probe helper behind absence (covered by its CASES row and the fatal-error case)',
    selectionDisplayed: 'private probe helper behind the absence of a byText chain; covered in platform-paths.spec.ts',
    pollTarget: 'builds the re-resolving handle the other verifications poll; covered in appium-entry.spec.ts',
    visibleWithin: 'the visibility probe; covered in appium-entry.spec.ts',
    probeVisible: 'the visibility probe; covered in appium-entry.spec.ts',
    listPresence: 'polls the collection; retry and timeout covered in appium-entry.spec.ts',
    entryAbsence: 'resolves the entry, then the absence CASES row; covered in appium-entry.spec.ts',
};

test('every polling device verification has a retry case or an explicit exemption', () => {
    const covered = new Set(Object.keys(CASES).map(name => name.split(' ')[0]));
    const missing = DEVICE_METHODS.verifications.filter(m => !covered.has(m) && !(m in EXEMPT));
    expect(missing, 'device verifications with no CASES row and no exemption').toEqual([]);
    const stale = [...Object.keys(EXEMPT), ...covered].filter(m => !DEVICE_METHODS.verifications.includes(m));
    expect(stale, 'CASES rows or exemptions naming no device verification').toEqual([]);
    expect(Object.keys(EXEMPT).filter(m => covered.has(m)), 'methods both covered and exempted').toEqual([]);
});

/** Builds an element whose `getter` answers the scripted values; reports how many reads happened. */
function scripted(c: Case, values: unknown[]) {
    const reader = changing(values);
    const spec: MockElementSpec = c.getter === 'attributes'
        ? { attributes: { value: reader.read as () => Promise<string | null> } }
        : { [c.getter]: reader.read };
    return { el: mockElement(spec), reads: reader.reads };
}

for (const platform of DEVICE_PLATFORMS) {
    const factory = (timeout?: number) =>
        new AppiumFactory(mockDriver({ capabilities: CAPS[platform] }).driver, platform, timeout ? { timeout } : {});

    test.describe(`AppiumVerifications on ${platform}`, () => {
        for (const [name, c] of Object.entries(CASES)) {
            test(`${name} retries until the value turns right on the 3rd read`, async () => {
                const { el, reads } = scripted(c, c.values);
                await c.run(factory().createVerifications(), el, 3000);
                expect(reads()).toBe(3);
            });

            test(`${name} fails after its timeout with the last value`, async () => {
                const { el, reads } = scripted(c, [c.values[0], c.values[1]]);
                const started = Date.now();
                const error = await c.run(factory().createVerifications(), el, 250).catch(e => e);
                const elapsed = Date.now() - started;
                expect(error).toBeInstanceOf(PollTimeoutError);
                expect(error.message).toContain(c.message);
                expect(error.message).toContain('timed out after 250 ms');
                expect(error.message).toContain('Last value:');
                expect(elapsed).toBeGreaterThanOrEqual(240);
                expect(elapsed).toBeLessThan(1500);
                expect(reads()).toBeGreaterThan(2);
            });
        }

        test('order and listOrder poll the texts of all matches', async () => {
            const lists = changing([['b', 'a'], ['a'], ['a', 'b']]);
            const list = { ...mockElement(), all: async () => (await lists.read()).map(t => mockElement({ text: t })) } as unknown as Element;
            const v = factory(3000).createVerifications();
            await v.order(list, ['a', 'b']);
            expect(lists.reads()).toBe(3);
            await v.listOrder(list, 'asc');
            const unsorted = { ...mockElement(), all: async () => ['b', 'a'].map(t => mockElement({ text: t })) } as unknown as Element;
            const error = await factory(200).createVerifications().listOrder(unsorted, 'asc').catch(e => e);
            expect(error.message).toContain('Expected list to be sorted ascending: timed out after 200 ms. Last value: ["b","a"]');
            const orderError = await factory(200).createVerifications().order(unsorted, ['a', 'b']).catch(e => e);
            expect(orderError.message).toContain('Last value: ["b","a"]');
        });

        test('the instance timeout applies when no per-call timeout is given', async () => {
            const started = Date.now();
            await factory(300).createVerifications().presence(mockElement({ visible: false })).catch(() => undefined);
            const elapsed = Date.now() - started;
            expect(elapsed).toBeGreaterThanOrEqual(290);
            expect(elapsed).toBeLessThan(1500);
        });

        test('negated inverts the condition and says so', async () => {
            const v = factory().createVerifications();
            await v.text(mockElement({ text: 'other' }), 'Done', { negated: true, timeout: 200 });
            const error = await v.text(mockElement({ text: 'Done' }), 'Done', { negated: true, timeout: 150 }).catch(e => e);
            expect(error.message).toContain('Expected NOT text "Done": timed out after 150 ms. Last value: "Done"');
            const shown = changing([true, true, false]);
            await v.presence(mockElement({ visible: shown.read }), { negated: true, timeout: 3000 });
            expect(shown.reads()).toBe(3);
        });

        test('errorMessage leads the failure message', async () => {
            const error = await factory().createVerifications()
                .presence(mockElement({ visible: false }), { timeout: 120, errorMessage: 'Login button missing' })
                .catch(e => e);
            expect(error.message).toMatch(/^Login button missing \(Expected element to be displayed\): timed out after 120 ms/);
        });

        test('getter errors (stale element) are retried until the deadline, then reported', async () => {
            let n = 0;
            const flaky = mockElement({ text: async () => { if (n++ < 2) throw new Error('stale element reference'); return 'ok'; } });
            await factory().createVerifications().text(flaky, 'ok', { timeout: 3000 });
            expect(n).toBe(3);
            const broken = mockElement({ text: async () => { throw new Error('no such element'); } });
            const error = await factory().createVerifications().text(broken, 'ok', { timeout: 120 }).catch(e => e);
            expect(error.message).toContain('Last error: no such element');
        });

        test('absence never counts a failing read of a match as absent: it retries and reports the error', async () => {
            const error = await factory().createVerifications()
                .absence(mockElement({ visible: async () => { throw new Error('no such element'); } }), { timeout: 100 })
                .catch(e => e);
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect(error.message).toContain('Last error: no such element');
        });

        test('absence with a selector string resolves a platform element on the driver (every match)', async () => {
            const mock = mockDriver({ capabilities: CAPS[platform] });
            const looked: unknown[] = [];
            (mock.driver as unknown as Record<string, unknown>).$$ = async (selector: string) => {
                looked.push(selector);
                return [{ elementId: 'a', isDisplayed: async () => false }];
            };
            await new AppiumFactory(mock.driver, platform).createVerifications().absence('~gone', { timeout: 100 });
            expect(looked[0]).toBe('~gone');
        });

        test('absence fails when any match is displayed', async () => {
            const list = mockElement({ children: [mockElement({ visible: false }), mockElement({ visible: true })] });
            const error = await factory().createVerifications().absence(list, { timeout: 150 }).catch(e => e);
            expect(error).toBeInstanceOf(PollTimeoutError);
        });

        test('absence never passes on a fatal driver error (dead session)', async () => {
            const dead = Object.assign(new Error('invalid session id'), { name: 'invalid session id' });
            const el = mockElement({ visible: async () => { throw dead; } });
            const started = Date.now();
            const error = await factory().createVerifications().absence(el, { timeout: 5000 }).catch(e => e);
            expect(error).toBe(dead);
            const listDead = { ...mockElement(), all: async () => { throw dead; } } as unknown as Element;
            expect(await factory().createVerifications().absence(listDead, { timeout: 5000 }).catch(e => e)).toBe(dead);
            expect(Date.now() - started).toBeLessThan(1000);
        });

        test(`state 'focused' ${platform === 'android' ? 'polls the focused attribute' : 'throws PlatformNotSupportedError'}`, async () => {
            const v = factory().createVerifications();
            if (platform === 'android') {
                const focused = changing([null, 'false', 'true']);
                await v.state(mockElement({ attributes: { focused: focused.read } }), 'focused', { timeout: 3000 });
                expect(focused.reads()).toBe(3);
            } else {
                await expectNotSupported(() => v.state(mockElement(), 'focused'), "state('focused')", 'ios');
            }
        });

        test('state accepts a numeric timeout', async () => {
            const started = Date.now();
            await factory().createVerifications().state(mockElement({ enabled: false }), 'enabled', 150 as never).catch(() => undefined);
            expect(Date.now() - started).toBeLessThan(1000);
        });

        test('count validates its options before polling', async () => {
            const v = factory().createVerifications();
            const el = mockElement();
            await expect(v.count(el, { exactly: -1 })).rejects.toThrow(/cannot be negative/);
            await expect(v.count(el, { lessThan: 0 })).rejects.toThrow(/must be greater than 0/);
            await expect(v.count(el, {} as never)).rejects.toThrow(/You must provide/);
        });

        test('a negated count range is worded as on web', async () => {
            const v = factory().createVerifications();
            const error = await v.count(mockElement({ count: 6 }), { greaterThan: 5 }, { negated: true, timeout: 150 }).catch(e => e);
            expect(error).toBeInstanceOf(PollTimeoutError);
            expect(error.message).toContain('Expected count not > 5');
            expect(error.message).not.toContain('Expected NOT count');
        });

        test('text without expectedText or notEmpty is a usage error', async () => {
            await expect(factory().createVerifications().text(mockElement(), undefined)).rejects.toThrow(/You must provide either/);
        });

        test('expectEqual / expectNotEqual compare captured values', () => {
            const v = factory().createVerifications();
            v.expectEqual('a', 'a');
            v.expectEqual(null, null);
            expect(() => v.expectEqual('a', 'b')).toThrow('Expected values to be equal.\n  Actual:   "a"\n  Expected: "b"');
            v.expectNotEqual('a', 'b');
            expect(() => v.expectNotEqual('a', 'a')).toThrow('Expected values to differ, but both were: "a"');
        });
    });
}
