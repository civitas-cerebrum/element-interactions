import { expect } from '@playwright/test';
import { ElementType, PlatformNotSupportedError, type Element, type Platform } from '@civitas-cerebrum/element-repository';
import type { AppiumDriver } from '../../src/appium';

/** One recorded call: the method name followed by its arguments. */
export type Call = [string, ...unknown[]];

export interface MockDriver {
    driver: AppiumDriver;
    calls: Call[];
    /** Scripted results for `execute('mobile: <command>')`, keyed by the full script name. */
    executeResults: Record<string, unknown>;
}

export const WINDOW = { width: 400, height: 800 };

/**
 * A stand-in WebdriverIO session: records every command it receives and
 * answers with scripted values. Only the commands the Appium family uses exist.
 */
export function mockDriver(options: {
    capabilities?: Record<string, unknown>;
    orientation?: string;
    contexts?: unknown[];
    context?: unknown;
    pageSource?: string;
    screenshot?: string;
} = {}): MockDriver {
    const calls: Call[] = [];
    const executeResults: Record<string, unknown> = {};
    const record = (name: string, result?: unknown) => async (...args: unknown[]) => {
        calls.push([name, ...args]);
        return typeof result === 'function' ? (result as () => unknown)() : result;
    };
    const driver = {
        capabilities: options.capabilities ?? {},
        execute: async (script: string, args: unknown) => {
            calls.push(['execute', script, args]);
            return executeResults[script];
        },
        back: record('back'),
        acceptAlert: record('acceptAlert'),
        dismissAlert: record('dismissAlert'),
        getOrientation: record('getOrientation', options.orientation ?? 'PORTRAIT'),
        setOrientation: record('setOrientation'),
        getAppiumContexts: record('getAppiumContexts', options.contexts ?? ['NATIVE_APP', 'WEBVIEW_1']),
        getAppiumContext: record('getAppiumContext', options.context ?? 'NATIVE_APP'),
        switchAppiumContext: record('switchAppiumContext'),
        getPageSource: record('getPageSource', options.pageSource ?? '<hierarchy/>'),
        getWindowSize: async () => ({ ...WINDOW }),
        takeScreenshot: record('takeScreenshot', options.screenshot ?? Buffer.from('png-bytes').toString('base64')),
        performActions: record('performActions'),
        releaseActions: record('releaseActions'),
    };
    return { driver: driver as unknown as AppiumDriver, calls, executeResults };
}

/** Only the touch gestures a mock driver received: one entry per `performActions` call. */
export function touches(calls: Call[]): Array<Array<{ id: string; actions: unknown[] }>> {
    return calls.filter(c => c[0] === 'performActions').map(c => c[1] as Array<{ id: string; actions: unknown[] }>);
}

/** A one-finger W3C touch swipe as the driver received it, read back as finger travel. */
export interface ScreenSwipe {
    from: { x: number; y: number };
    to: { x: number; y: number };
    /** The way the finger moved. */
    direction: 'up' | 'down' | 'left' | 'right';
    /** Finger travel in px. */
    distance: number;
}

/** The exact W3C action sequence of one swipe from `from` to `to` (element-repository's PlatformElement shape). */
export function swipeActions(from: { x: number; y: number }, to: { x: number; y: number }): unknown[] {
    return [
        { type: 'pointerMove', duration: 0, x: from.x, y: from.y, origin: 'viewport' },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 100 },
        { type: 'pointerMove', duration: 600, x: to.x, y: to.y, origin: 'viewport' },
        { type: 'pointerUp', button: 0 },
    ];
}

/**
 * Every screen swipe in `calls`: each `performActions` must be one touch
 * finger with exactly the {@link swipeActions} shape, followed by
 * `releaseActions`; no `mobile:` command may be sent. Returns the swipes as
 * finger travel.
 */
export function screenSwipes(calls: Call[]): ScreenSwipe[] {
    expect(calls.filter(c => c[0] === 'execute'), 'no mobile: command for a screen swipe').toEqual([]);
    const out: ScreenSwipe[] = [];
    calls.forEach((call, i) => {
        if (call[0] !== 'performActions') return;
        const sources = call[1] as Array<{ type: string; id: string; parameters: unknown; actions: Array<{ x: number; y: number }> }>;
        expect(sources).toHaveLength(1);
        const [finger] = sources;
        expect(finger.type).toBe('pointer');
        expect(finger.id).toBe('finger1');
        expect(finger.parameters).toEqual({ pointerType: 'touch' });
        const from = { x: finger.actions[0].x, y: finger.actions[0].y };
        const to = { x: finger.actions[3].x, y: finger.actions[3].y };
        expect(finger.actions).toEqual(swipeActions(from, to));
        expect(calls[i + 1]?.[0], 'releaseActions after every swipe').toBe('releaseActions');
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const direction = dx !== 0 ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
        out.push({ from, to, direction, distance: Math.abs(dx !== 0 ? dx : dy) });
    });
    return out;
}

type Reader<T> = T | (() => T | Promise<T>);

export interface MockElementSpec {
    selector?: string;
    text?: Reader<string | null>;
    visible?: Reader<boolean>;
    enabled?: Reader<boolean>;
    checked?: Reader<boolean>;
    exists?: Reader<boolean>;
    inputValue?: Reader<string>;
    attributes?: Record<string, Reader<string | null>>;
    count?: Reader<number>;
    box?: Reader<{ x: number; y: number; width: number; height: number } | null>;
    children?: Element[];
    waitFor?: (options: unknown) => Promise<void>;
}

/** A stand-in platform element: primitives record their calls; getters answer from `spec`. */
export function mockElement(spec: MockElementSpec = {}, calls: Call[] = []): Element & { calls: Call[] } {
    const read = async <T>(value: Reader<T> | undefined, fallback: T): Promise<T> =>
        value === undefined ? fallback : typeof value === 'function' ? await (value as () => T | Promise<T>)() : value;
    const record = (name: string) => async (...args: unknown[]) => { calls.push([name, ...args]); };
    const el = {
        _type: ElementType.PLATFORM,
        selector: spec.selector ?? '~item',
        calls,
        click: record('click'),
        fill: record('fill'),
        clear: record('clear'),
        check: record('check'),
        uncheck: record('uncheck'),
        doubleClick: record('doubleClick'),
        pressSequentially: record('pressSequentially'),
        scrollIntoView: record('scrollIntoView'),
        swipe: record('swipe'),
        longPress: record('longPress'),
        tapAt: record('tapAt'),
        pinch: record('pinch'),
        zoom: record('zoom'),
        dragTo: record('dragTo'),
        screenshot: async (...args: unknown[]) => { calls.push(['screenshot', ...args]); return Buffer.from('el'); },
        waitFor: spec.waitFor ?? record('waitFor'),
        textContent: () => read(spec.text, 'text'),
        isVisible: () => read(spec.visible, true),
        isEnabled: () => read(spec.enabled, true),
        isChecked: () => read(spec.checked, false),
        exists: () => read(spec.exists, true),
        inputValue: () => read(spec.inputValue, ''),
        getAttribute: (name: string) => read(spec.attributes?.[name], null),
        count: () => read(spec.count, spec.children?.length ?? 1),
        boundingBox: () => read(spec.box, { x: 100, y: 600, width: 80, height: 40 }),
        all: async () => spec.children ?? [el],
    };
    return el as unknown as Element & { calls: Call[] };
}

/** A getter answering `values[i]` on its i-th read (the last value repeats), counting reads. */
export function changing<T>(values: T[]): { read: () => Promise<T>; reads: () => number } {
    let n = 0;
    return { read: async () => values[Math.min(n++, values.length - 1)], reads: () => n };
}

export async function expectNotSupported(call: () => unknown, method: string, platform: Platform): Promise<void> {
    let caught: unknown;
    try {
        await call();
    } catch (error) {
        caught = error;
    }
    expect(caught, `${method} should throw PlatformNotSupportedError`).toBeInstanceOf(PlatformNotSupportedError);
    const err = caught as PlatformNotSupportedError;
    expect(err.method).toBe(method);
    expect(err.platform).toBe(platform);
}

/** The own method names of a class prototype, minus the constructor and private helpers named in `except`. */
export function methodsOf(ctor: { prototype: object }, except: string[] = []): string[] {
    return Object.getOwnPropertyNames(ctor.prototype)
        .filter(n => n !== 'constructor' && !except.includes(n))
        .filter(n => typeof Object.getOwnPropertyDescriptor(ctor.prototype, n)?.value === 'function')
        .sort();
}

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;

// ─── A UI-tree mock driver: `$` / `$$`, scoped `parent.$` / `$$` ────────────

/** One node of a mock native UI tree. Readers are re-read on every command, so tests can flip state. */
export interface MockNode {
    /** The selector strings this node answers to (exact string match, as the repository formats them). */
    match: string | string[];
    text?: Reader<string | null>;
    /** Displayed (default `true`). */
    visible?: Reader<boolean>;
    /** In the tree at all (default `true`); `false` removes the node and its subtree. */
    exists?: Reader<boolean>;
    enabled?: Reader<boolean>;
    attributes?: Record<string, Reader<string | null>>;
    children?: MockNode[];
}

export interface MockUiDriver extends MockDriver {
    /** Every `$` / `$$` the session received, as `[method, selector, scope]` (`scope` is `'driver'` or the parent node's first selector). */
    lookups: Array<[string, string, string]>;
    /** Lookups of `selector` so far. */
    lookupCount(selector: string): number;
    /** Make every following command throw `error` (a dead session); `undefined` heals it. */
    failWith(error: Error | undefined): void;
}

/** A WebDriver error as WebdriverIO raises it: `name` is the W3C error code. */
export function driverError(name: string, message: string = name): Error {
    const err = new Error(message);
    err.name = name;
    return err;
}

/**
 * A stand-in WebdriverIO session over a mock native UI tree: `$(sel)` /
 * `$$(sel)` on the driver search the whole tree; on an element they search
 * only that element's subtree (as WebdriverIO's scoped `parent.$`), so a
 * child outside the parent is never found. `$` returns the first match bound
 * to its node, or (no match) a lazy handle that re-queries on every command,
 * like WebdriverIO's lazy element. Everything else is {@link mockDriver}.
 */
export function mockUiDriver(nodes: MockNode[], options: Parameters<typeof mockDriver>[0] = {}): MockUiDriver {
    const base = mockDriver(options);
    const lookups: Array<[string, string, string]> = [];
    let failure: Error | undefined;
    let ids = 0;
    const idOf = new Map<MockNode, string>();
    const read = async <T>(value: Reader<T> | undefined, fallback: T): Promise<T> =>
        value === undefined ? fallback : typeof value === 'function' ? await (value as () => T | Promise<T>)() : value;
    const matches = (node: MockNode, selector: string) =>
        (Array.isArray(node.match) ? node.match : [node.match]).includes(selector);
    const live = async (node: MockNode) => read(node.exists, true);
    const check = () => { if (failure) throw failure; };

    /** Matches of `selector` among the descendants of `roots` (document order), skipping removed subtrees. */
    async function search(roots: MockNode[], selector: string): Promise<MockNode[]> {
        const out: MockNode[] = [];
        const walk = async (list: MockNode[]) => {
            for (const node of list) {
                if (!(await live(node))) continue;
                if (matches(node, selector)) out.push(node);
                await walk(node.children ?? []);
            }
        };
        await walk(roots);
        return out;
    }

    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    async function waitUntil(cond: () => Promise<boolean>, timeout: number, what: string): Promise<true> {
        const deadline = Date.now() + timeout;
        for (;;) {
            check();
            if (await cond()) return true;
            if (Date.now() >= deadline) throw new Error(`element still not ${what} after ${timeout}ms`);
            await sleep(Math.min(20, Math.max(1, deadline - Date.now())));
        }
    }

    function scopeName(node?: MockNode): string {
        if (!node) return 'driver';
        return Array.isArray(node.match) ? node.match[0] : node.match;
    }

    /** A raw element: bound to `node` when given, else lazy (re-queries `selector` under `scope` on every command). */
    function raw(selector: string, scope: MockNode[], scopeLabel: string, bound?: MockNode): Record<string, unknown> {
        const current = async (): Promise<MockNode | undefined> => {
            check();
            if (bound) return (await stillIn(bound)) ? bound : undefined;
            return (await search(scope, selector))[0];
        };
        // A bound node is gone once it (or an ancestor) is removed: `search` skips removed subtrees.
        const stillIn = async (node: MockNode) => (await search(scope, selector)).includes(node);
        const need = async (): Promise<MockNode> => {
            const node = await current();
            if (!node) throw driverError(bound ? 'stale element reference' : 'no such element', `${bound ? 'stale element reference' : 'no such element'}: ${selector}`);
            return node;
        };
        const el: Record<string, unknown> = {
            selector,
            get elementId() { return bound ? idOf.get(bound) : undefined; },
            isExisting: async () => !!(await current()),
            isDisplayed: async () => { const n = await current(); return n ? read(n.visible, true) : false; },
            isEnabled: async () => read((await need()).enabled, true),
            isSelected: async () => false,
            getText: async () => read((await need()).text, ''),
            getAttribute: async (name: string) => read((await need()).attributes?.[name], null),
            getValue: async () => read((await need()).attributes?.value, ''),
            click: async () => { await need(); base.calls.push(['click', selector, scopeLabel]); },
            waitForExist: async ({ timeout = 0, reverse = false }: { timeout?: number; reverse?: boolean } = {}) =>
                waitUntil(async () => !!(await current()) !== reverse, timeout, reverse ? 'gone' : 'existing'),
            waitForDisplayed: async ({ timeout = 0, reverse = false }: { timeout?: number; reverse?: boolean } = {}) =>
                waitUntil(async () => { const n = await current(); return (n ? await read(n.visible, true) : false) !== reverse; },
                    timeout, reverse ? 'hidden' : 'displayed'),
            $: async (sel: string) => {
                const node = await need();
                return lookup('$', sel, node.children ?? [], scopeName(node));
            },
            $$: async (sel: string) => {
                const node = await need();
                return lookupAll(sel, node.children ?? [], scopeName(node));
            },
        };
        return el;
    }
    async function lookup(method: string, selector: string, scope: MockNode[], label: string) {
        check();
        lookups.push([method, selector, label]);
        const [first] = await search(scope, selector);
        if (first && !idOf.has(first)) idOf.set(first, `el-${++ids}`);
        return raw(selector, scope, label, first);
    }
    async function lookupAll(selector: string, scope: MockNode[], label: string) {
        check();
        lookups.push(['$$', selector, label]);
        const found = await search(scope, selector);
        return found.map(node => {
            if (!idOf.has(node)) idOf.set(node, `el-${++ids}`);
            return raw(selector, scope, label, node);
        });
    }

    const driver = base.driver as unknown as Record<string, unknown>;
    driver.$ = (selector: string) => lookup('$', selector, nodes, 'driver');
    driver.$$ = (selector: string) => lookupAll(selector, nodes, 'driver');
    return {
        ...base,
        lookups,
        lookupCount: selector => lookups.filter(l => l[1] === selector).length,
        failWith: error => { failure = error; },
    };
}
