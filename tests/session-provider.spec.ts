import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import {
    AppiumSessionProvider,
    DEFAULT_CLIENT_OPTIONS,
    prepareSession,
    type WebdriverioModule,
    type SessionStartContext,
} from '../src/session';

const IOS_EXAMPLE = 'tests/capabilities/ios.example.json';

/** A fake `webdriverio` module recording every `remote()` call. */
function fakeWebdriverio() {
    const calls: Array<Record<string, unknown>> = [];
    const driver = { sessionId: 'fake-session' } as unknown as WebdriverIO.Browser;
    let imports = 0;
    const mod: WebdriverioModule = {
        remote: async (options) => { calls.push(options); return driver; },
    };
    return { calls, driver, mod, importer: async () => { imports++; return mod; }, imports: () => imports };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a rejection');
}

const context = (overrides: Partial<SessionStartContext> = {}): SessionStartContext => ({
    platform: 'ios',
    capabilities: { platformName: 'iOS', 'appium:bundleId': 'com.example.app' },
    server: { protocol: 'http', hostname: '127.0.0.1', port: 14732, path: '/wd/hub' },
    ...overrides,
});

test.describe('AppiumSessionProvider.start', () => {
    test('calls remote() with exactly the connection, the capabilities and the client options', async () => {
        const wdio = fakeWebdriverio();
        const provider = new AppiumSessionProvider({ importWebdriverio: wdio.importer });
        const ctx = context({ server: { protocol: 'https', hostname: 'hub.example.com', port: 443, path: '/wd/hub', user: 'u', key: 'k' } });
        const driver = await provider.start(ctx);
        expect(driver).toBe(wdio.driver);
        expect(wdio.calls).toHaveLength(1);
        expect(wdio.calls[0]).toStrictEqual({
            logLevel: 'error',
            waitforTimeout: 0,
            protocol: 'https',
            hostname: 'hub.example.com',
            port: 443,
            path: '/wd/hub',
            user: 'u',
            key: 'k',
            capabilities: ctx.capabilities,
        });
        expect(DEFAULT_CLIENT_OPTIONS).toEqual({ logLevel: 'error', waitforTimeout: 0 });
    });

    test('passes the capabilities file content unchanged (same object, deep-equal to the file)', async () => {
        const wdio = fakeWebdriverio();
        const provider = new AppiumSessionProvider({ importWebdriverio: wdio.importer });
        const prepared = prepareSession('ios', { capabilities: IOS_EXAMPLE, server: 'http://127.0.0.1:14732/wd/hub' }, {});
        await provider.start(prepared.context);
        expect(wdio.calls[0].capabilities).toBe(prepared.context.capabilities);
        expect(wdio.calls[0].capabilities).toStrictEqual(JSON.parse(fs.readFileSync(IOS_EXAMPLE, 'utf-8')));
        expect(Object.keys(wdio.calls[0]).sort()).toEqual(
            ['capabilities', 'hostname', 'logLevel', 'path', 'port', 'protocol', 'waitforTimeout'],
        );
    });

    test('leaves out connection fields that have no value', async () => {
        const wdio = fakeWebdriverio();
        await new AppiumSessionProvider({ importWebdriverio: wdio.importer }).start(context({ server: { hostname: 'h' } }));
        expect(wdio.calls[0]).toStrictEqual({ logLevel: 'error', waitforTimeout: 0, hostname: 'h', capabilities: context().capabilities });
    });

    test('client options override the defaults but never connection or capabilities', async () => {
        const wdio = fakeWebdriverio();
        const provider = new AppiumSessionProvider({
            importWebdriverio: wdio.importer,
            client: { logLevel: 'debug', waitforTimeout: 250, connectionRetryCount: 1, connectionRetryTimeout: undefined },
        });
        await provider.start(context());
        expect(wdio.calls[0]).toMatchObject({ logLevel: 'debug', waitforTimeout: 250, connectionRetryCount: 1, port: 14732 });
        expect(wdio.calls[0]).not.toHaveProperty('connectionRetryTimeout');
    });

    test('imports webdriverio once per provider, on first start, and never at construction', async () => {
        const wdio = fakeWebdriverio();
        const provider = new AppiumSessionProvider({ importWebdriverio: wdio.importer });
        expect(wdio.imports()).toBe(0);
        await provider.start(context());
        await provider.start(context());
        expect(wdio.imports()).toBe(1);
        expect(wdio.calls).toHaveLength(2);
    });

    test('two providers coexist without shared state', async () => {
        const a = fakeWebdriverio();
        const b = fakeWebdriverio();
        const pa = new AppiumSessionProvider({ importWebdriverio: a.importer });
        const pb = new AppiumSessionProvider({ importWebdriverio: b.importer, client: { logLevel: 'info' } });
        await pa.start(context());
        await pb.start(context({ platform: 'android', capabilities: { platformName: 'Android' } }));
        expect(a.calls).toHaveLength(1);
        expect(b.calls).toHaveLength(1);
        expect(a.calls[0].logLevel).toBe('error');
        expect(b.calls[0].logLevel).toBe('info');
    });

    test('a missing webdriverio is a clear error; a later start retries the import', async () => {
        let attempts = 0;
        const wdio = fakeWebdriverio();
        const provider = new AppiumSessionProvider({
            importWebdriverio: async () => {
                attempts++;
                if (attempts === 1) {
                    throw Object.assign(new Error("Cannot find module 'webdriverio'"), { code: 'MODULE_NOT_FOUND' });
                }
                return wdio.mod;
            },
        });
        const err = await rejection(provider.start(context()));
        expect(err.message).toBe('webdriverio is not installed: install webdriverio@^10 to run platform tests (npm install --save-dev webdriverio@^10).');
        expect((err as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);
        await provider.start(context());
        expect(attempts).toBe(2);
    });

    test('other import failures are not disguised as a missing package', async () => {
        const provider = new AppiumSessionProvider({ importWebdriverio: async () => { throw new Error('boom inside webdriverio'); } });
        expect((await rejection(provider.start(context()))).message).toBe('boom inside webdriverio');
        const noRemote = new AppiumSessionProvider({ importWebdriverio: async () => ({}) as WebdriverioModule });
        expect((await rejection(noRemote.start(context()))).message).toMatch(/has no remote\(\) function/);
    });

    test('macos and windows are refused before webdriverio is loaded', async () => {
        for (const platform of ['macos', 'windows'] as const) {
            const wdio = fakeWebdriverio();
            const provider = new AppiumSessionProvider({ importWebdriverio: wdio.importer });
            const err = await rejection(provider.start(context({ platform })));
            expect(err.message).toBe(`Platform "${platform}" is declared but not implemented yet.`);
            expect(wdio.imports()).toBe(0);
        }
    });

    test('web is refused', async () => {
        const wdio = fakeWebdriverio();
        const err = await rejection(new AppiumSessionProvider({ importWebdriverio: wdio.importer }).start(context({ platform: 'web' })));
        expect(err.message).toMatch(/not in the Appium family/);
    });

    test('the real default import resolves webdriverio lazily (installed as a dev dependency here)', async () => {
        const before = Object.keys(require.cache).filter(k => /[\\/]webdriverio[\\/]/.test(k)).length;
        new AppiumSessionProvider();
        const after = Object.keys(require.cache).filter(k => /[\\/]webdriverio[\\/]/.test(k)).length;
        expect(after).toBe(before);
    });

    test('the default import yields the real webdriverio remote()', async () => {
        const provider = new AppiumSessionProvider();
        const mod = await (provider as unknown as { webdriverio(): Promise<WebdriverioModule> }).webdriverio();
        expect(typeof mod.remote).toBe('function');
    });
});

test.describe('AppiumSessionProvider.stop', () => {
    test('deletes the session', async () => {
        let deleted = 0;
        const driver = { deleteSession: async () => { deleted++; } } as unknown as WebdriverIO.Browser;
        await new AppiumSessionProvider().stop(driver);
        expect(deleted).toBe(1);
    });

    test('tolerates an already-dead session', async () => {
        for (const message of [
            'invalid session id',
            'A session is either terminated or not started',
            'WebDriverError: no such session',
        ]) {
            const driver = { deleteSession: async () => { throw new Error(message); } } as unknown as WebdriverIO.Browser;
            await expect(new AppiumSessionProvider().stop(driver)).resolves.toBeUndefined();
        }
    });

    test('rethrows any other failure', async () => {
        const driver = { deleteSession: async () => { throw new Error('ECONNRESET'); } } as unknown as WebdriverIO.Browser;
        expect((await rejection(new AppiumSessionProvider().stop(driver))).message).toBe('ECONNRESET');
    });
});
