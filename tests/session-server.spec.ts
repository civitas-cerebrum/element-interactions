import { test, expect } from '@playwright/test';
import { resolveServer, parseServerUrl, DEFAULT_APPIUM_URL } from '../src/session';

function errorOf(fn: () => unknown): Error {
    try {
        fn();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a throw');
}

/** Sets env vars for the duration of `fn`, restoring every one afterwards (also on failure). */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(vars)) saved[key] = process.env[key];
    try {
        for (const [key, value] of Object.entries(vars)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
}

test.describe('parseServerUrl', () => {
    test('keeps the base path', () => {
        expect(parseServerUrl('http://127.0.0.1:4725/wd/hub'))
            .toEqual({ protocol: 'http', hostname: '127.0.0.1', port: 4725, path: '/wd/hub' });
        expect(parseServerUrl('https://appium.example.com:8443/wd/hub/'))
            .toEqual({ protocol: 'https', hostname: 'appium.example.com', port: 8443, path: '/wd/hub' });
    });

    test('a URL without a path gets "/"; without a port gets the protocol default', () => {
        expect(parseServerUrl('http://localhost:4723')).toEqual({ protocol: 'http', hostname: 'localhost', port: 4723, path: '/' });
        expect(parseServerUrl('https://appium.example.com')).toEqual({ protocol: 'https', hostname: 'appium.example.com', port: 443, path: '/' });
        expect(parseServerUrl('http://appium.example.com/wd/hub')).toMatchObject({ port: 80, path: '/wd/hub' });
    });

    test('credentials in the URL become user and key', () => {
        expect(parseServerUrl('https://someone:s%40cret@hub.example.com/wd/hub'))
            .toEqual({ protocol: 'https', hostname: 'hub.example.com', port: 443, path: '/wd/hub', user: 'someone', key: 's@cret' });
    });

    test('refuses non-URLs, other protocols, queries and fragments', () => {
        expect(errorOf(() => parseServerUrl('localhost:4723', 'APPIUM_URL')).message).toMatch(/must use http or https|not a valid URL/);
        const notAUrl = errorOf(() => parseServerUrl('not a url', 'APPIUM_URL')).message;
        expect(notAUrl).toMatch(/^APPIUM_URL is not a valid URL/);
        expect(notAUrl).toContain("Expected the server's own URL");
        expect(errorOf(() => parseServerUrl('ws://localhost:4723')).message).toMatch(/must use http or https/);
        const withQuery = errorOf(() => parseServerUrl('http://localhost:4723/wd/hub?x=1')).message;
        expect(withQuery).toMatch(/query or fragment/);
        expect(withQuery).toContain("give the server's own URL only");
    });
});

test.describe('resolveServer', () => {
    test('default: APPIUM_URL, else http://127.0.0.1:4723', () => {
        expect(DEFAULT_APPIUM_URL).toBe('http://127.0.0.1:4723');
        expect(resolveServer(undefined, {})).toEqual({ protocol: 'http', hostname: '127.0.0.1', port: 4723, path: '/' });
        expect(resolveServer(undefined, { APPIUM_URL: 'http://127.0.0.1:4725/wd/hub' }))
            .toEqual({ protocol: 'http', hostname: '127.0.0.1', port: 4725, path: '/wd/hub' });
    });

    test('reads process.env when no env is passed', () => {
        withEnv({ APPIUM_URL: 'https://hub.example.com/wd/hub', APPIUM_USER: 'u', APPIUM_KEY: 'k' }, () => {
            expect(resolveServer(undefined)).toEqual({ protocol: 'https', hostname: 'hub.example.com', port: 443, path: '/wd/hub', user: 'u', key: 'k' });
        });
        withEnv({ APPIUM_URL: undefined, APPIUM_USER: undefined, APPIUM_KEY: undefined }, () => {
            expect(resolveServer(undefined)).toEqual({ protocol: 'http', hostname: '127.0.0.1', port: 4723, path: '/' });
        });
    });

    test('an option URL wins over APPIUM_URL', () => {
        expect(resolveServer('http://appium.example.com:4723/wd/hub', { APPIUM_URL: 'http://127.0.0.1:1/' }))
            .toEqual({ protocol: 'http', hostname: 'appium.example.com', port: 4723, path: '/wd/hub' });
    });

    test('an object keeps its fields and takes missing connection fields from the built-in default, never APPIUM_URL', () => {
        expect(resolveServer({ hostname: 'hub.example.com', path: '/wd/hub' }, { APPIUM_URL: 'https://other.example.com:9/x' }))
            .toEqual({ protocol: 'http', hostname: 'hub.example.com', port: 4723, path: '/wd/hub' });
        expect(resolveServer({ protocol: 'https', hostname: 'h', port: 443, path: '/', user: 'a', key: 'b' }, {}))
            .toEqual({ protocol: 'https', hostname: 'h', port: 443, path: '/', user: 'a', key: 'b' });
    });

    test('APPIUM_USER / APPIUM_KEY fill user and key only when not given', () => {
        const env = { APPIUM_USER: 'env-user', APPIUM_KEY: 'env-key' };
        expect(resolveServer('http://h:1/wd/hub', env)).toMatchObject({ user: 'env-user', key: 'env-key' });
        expect(resolveServer({ hostname: 'h', user: 'mine' }, env)).toMatchObject({ user: 'mine', key: 'env-key' });
        expect(resolveServer('https://url-user:url-key@h/wd/hub', env)).toMatchObject({ user: 'url-user', key: 'url-key' });
        expect(resolveServer(undefined, {})).not.toHaveProperty('user');
        expect(resolveServer(undefined, {})).not.toHaveProperty('key');
    });

    test('an empty APPIUM_URL counts as unset: the built-in default is used', () => {
        expect(resolveServer(undefined, { APPIUM_URL: '' })).toEqual({ protocol: 'http', hostname: '127.0.0.1', port: 4723, path: '/' });
        withEnv({ APPIUM_URL: '' }, () => {
            expect(resolveServer(undefined)).toEqual({ protocol: 'http', hostname: '127.0.0.1', port: 4723, path: '/' });
        });
    });

    test('empty APPIUM_USER / APPIUM_KEY count as unset: no user or key', () => {
        const env = { APPIUM_USER: '', APPIUM_KEY: '' };
        for (const server of [undefined, 'http://h:1/wd/hub', { hostname: 'h' }] as const) {
            const resolved = resolveServer(server, env);
            expect(resolved).not.toHaveProperty('user');
            expect(resolved).not.toHaveProperty('key');
        }
        expect(resolveServer(undefined, { APPIUM_USER: '', APPIUM_KEY: 'k' })).toMatchObject({ key: 'k' });
        expect(resolveServer(undefined, { APPIUM_USER: '', APPIUM_KEY: 'k' })).not.toHaveProperty('user');
    });

    test('refuses an invalid object', () => {
        expect(errorOf(() => resolveServer({ protocol: 'ftp' as never }, {})).message).toMatch(/protocol must be 'http' or 'https'/);
        expect(errorOf(() => resolveServer({ port: 0 }, {})).message).toMatch(/port must be an integer/);
        expect(errorOf(() => resolveServer({ path: 'wd/hub' }, {})).message).toMatch(/path must start with "\/"/);
        expect(errorOf(() => resolveServer({ hostname: '' }, {})).message).toMatch(/hostname must be a non-empty string/);
        expect(errorOf(() => resolveServer(42 as never, {})).message).toMatch(/must be a URL string or a ServerOptions object/);
    });
});
