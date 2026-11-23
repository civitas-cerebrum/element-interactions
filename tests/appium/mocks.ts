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
