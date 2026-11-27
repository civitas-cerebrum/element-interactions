import { ElementRepository } from '@civitas-cerebrum/element-repository';
import { Steps } from '../../src/index';
import { AppiumFactory } from '../../src/appium';
import { mockUiDriver, type MockNode } from './mocks';

/** One driver command as the slow driver saw it: when it started and ended (ms since the driver was made). */
export interface DriverCall {
    method: string;
    start: number;
    end?: number;
    /** Commands in flight when this one started, itself included. */
    inFlight: number;
}

export interface SlowDriverOptions {
    /** Latency of every `$` / `$$` (driver or element scoped), in ms. */
    lookupMs: number;
    /** Latency of every other element command (getAttribute, getText, getTagName, isDisplayed, ...), in ms. */
    readMs: number;
    /** Model WebdriverIO's stale-element refetch (see {@link slowDriver}). */
    wdioRefetch?: boolean;
}

const UNDERLYING = Symbol('underlying');

interface Origin {
    /** Re-runs the `$$` the element came from (a timed lookup). */
    refind: () => Promise<unknown>;
    index: number;
    /** The id generation the element was found in. */
    gen: number;
}

/**
 * A recorder over the mock UI driver that gives every command a latency, as
 * a real Appium server does: `$` / `$$` take `lookupMs`, every element
 * command `readMs`. It records every command's start and end and how many
 * were in flight at once, so a test can see the traffic a step leaves behind.
 *
 * With `wdioRefetch` it also models WebdriverIO's element middleware: a
 * command on an element whose id went stale ({@link invalidateIds}, e.g. the
 * app was relaunched) finds the element again by re-running the `$$` it came
 * from and taking the same index, then retries the command; with the session
 * provider's `waitforTimeout: 0`, an index that is gone costs one more lookup
 * (the implicit wait) and then fails with WebdriverIO's "wasn't found".
 */
export function slowDriver(platform: 'android' | 'ios', nodes: MockNode[], options: SlowDriverOptions) {
    const mock = mockUiDriver(nodes, { capabilities: { platformName: platform } });
    const born = Date.now();
    const calls: DriverCall[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let generation = 0;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const isLookup = (name: string) => name === '$' || name === '$$';
    const isStale = (err: unknown) => err instanceof Error && err.name === 'stale element reference';

    async function timed(method: string, ms: number, run: () => Promise<unknown>, refind?: () => Promise<unknown>): Promise<unknown> {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const call: DriverCall = { method, start: Date.now() - born, inFlight };
        calls.push(call);
        try {
            await sleep(ms);
            return wrap(await run(), refind);
        } finally {
            inFlight--;
            call.end = Date.now() - born;
        }
    }

    function wrapRaw(raw: Record<string, unknown>, origin?: Origin): Record<string, unknown> {
        let current = raw;
        return new Proxy(raw, {
            get(_target, prop) {
                if (prop === UNDERLYING) return current;
                const value = Reflect.get(current, prop, current);
                if (typeof prop !== 'string' || typeof value !== 'function') return value;
                const ms = isLookup(prop) ? options.lookupMs : options.readMs;
                return async (...args: unknown[]) => {
                    const once = () => timed(prop, ms, async () => {
                        if (origin && origin.gen < generation) {
                            const err = new Error(`stale element reference: ${String(raw.selector)}`);
                            err.name = 'stale element reference';
                            throw err;
                        }
                        return (Reflect.get(current, prop, current) as (...a: unknown[]) => Promise<unknown>).apply(current, args);
                    });
                    try {
                        return await once();
                    } catch (err) {
                        if (!options.wdioRefetch || !origin || !isStale(err)) throw err;
                        const list = (await origin.refind()) as Array<Record<string | symbol, unknown>>;
                        const again = list[origin.index];
                        if (!again) {
                            await origin.refind();
                            throw new Error(`Can't call ${prop} on element with selector "${String(raw.selector)}" at index ${origin.index} because element wasn't found`);
                        }
                        current = (again[UNDERLYING] as Record<string, unknown> | undefined) ?? again;
                        origin.gen = generation;
                        return once();
                    }
                };
            },
        });
    }

    function wrapOne(value: unknown, origin?: Origin): unknown {
        if (value && typeof value === 'object' && 'selector' in (value as object) && 'isDisplayed' in (value as object)) {
            return wrapRaw(value as Record<string, unknown>, origin);
        }
        return value;
    }
    function wrap(value: unknown, refind?: () => Promise<unknown>): unknown {
        if (Array.isArray(value)) return value.map((v, index) => wrapOne(v, refind ? { refind, index, gen: generation } : undefined));
        return wrapOne(value);
    }

    const driver = mock.driver as unknown as Record<string, unknown>;
    const original$ = driver.$ as (s: string) => Promise<unknown>;
    const original$$ = driver.$$ as (s: string) => Promise<unknown>;
    driver.$ = (selector: string) => timed('$', options.lookupMs, () => original$(selector));
    const all$$ = (selector: string): Promise<unknown> => timed('$$', options.lookupMs, () => original$$(selector), () => all$$(selector));
    driver.$$ = all$$;

    return {
        mock,
        calls,
        /** Ms since the driver was made. */
        now: () => Date.now() - born,
        inFlight: () => inFlight,
        maxInFlight: () => maxInFlight,
        /** Every element id handed out so far goes stale (an app relaunch, a new screen). */
        invalidateIds: () => { generation++; },
        /** Commands that STARTED after `t` (ms since the driver was made). */
        startedAfter: (t: number) => calls.filter(c => c.start > t),
        /** The most commands in flight at once among those started at or after `t`. */
        maxInFlightAfter: (t: number) => calls.filter(c => c.start >= t).reduce((m, c) => Math.max(m, c.inFlight), 0),
        /** Resolves once nothing is in flight and nothing new started for `quietMs`, or after `maxMs`. */
        async settle(quietMs: number, maxMs: number): Promise<void> {
            const stop = Date.now() + maxMs;
            for (;;) {
                const lastStart = calls.length ? calls[calls.length - 1].start : 0;
                if (inFlight === 0 && Date.now() - born - lastStart >= quietMs) return;
                if (Date.now() >= stop) return;
                await sleep(20);
            }
        },
    };
}

/** A repository page with one entry, `cells`, over `~cell`. */
export function cellPages(platform: string) {
    return {
        pages: [{
            name: 'Screen',
            platform,
            elements: [{ elementName: 'cells', selector: { 'accessibility id': 'cell' } }],
        }],
    };
}

/**
 * `count` cells 'Item 2'..'Item <count>' and then 'Item 1' LAST, so a text
 * pass for 'Item 1' reads every cell before it finds the exact match (the
 * shape of a long list whose wanted row is near the end).
 */
export function cellTree(count: number, exists: () => boolean = () => true): MockNode[] {
    const texts = [...Array.from({ length: count - 1 }, (_, i) => `Item ${i + 2}`), 'Item 1'];
    return [{
        match: '~table',
        exists,
        children: texts.map((text, i) => ({ match: '~cell', text, attributes: { type: 'XCUIElementTypeCell', name: `cell-${i}` } })),
    }];
}

/** Steps over a slow driver: a real ElementRepository and AppiumFactory, as the device path builds them. */
export function slowDeviceSteps(
    platform: 'android' | 'ios',
    nodes: MockNode[],
    options: SlowDriverOptions & { repoTimeout: number; stepTimeout: number },
) {
    const slow = slowDriver(platform, nodes, options);
    const repo = new ElementRepository(slow.mock.driver, cellPages(platform), { platform, timeout: options.repoTimeout });
    const factory = new AppiumFactory(slow.mock.driver, platform, { timeout: options.stepTimeout, appId: 'com.example.app' });
    return { steps: new Steps(factory, repo), slow };
}
