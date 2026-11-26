import type { ServerOptions } from './types';

/** The Appium server used when neither `session.server` nor `APPIUM_URL` is set. */
export const DEFAULT_APPIUM_URL = 'http://127.0.0.1:4723';

/**
 * Resolves `session.server` to connection options.
 *
 * - `undefined`: `env.APPIUM_URL ?? 'http://127.0.0.1:4723'` (an empty
 *   `APPIUM_URL` counts as unset).
 * - A URL string: parsed into protocol / hostname / port / path. The path is
 *   the server's base path, if it has one (`/` otherwise), kept as given minus a trailing slash; a
 *   URL without a port gets its protocol's (80 / 443). Credentials in the URL
 *   (`https://user:key@host/...`) become `user` / `key`.
 * - An object: its fields, with any missing connection field taken from
 *   `http://127.0.0.1:4723` (never from `APPIUM_URL`: an object is a complete
 *   choice of server).
 *
 * In every form `env.APPIUM_USER` / `env.APPIUM_KEY` fill `user` / `key` when
 * not given (empty values count as unset). Credentials are never read from
 * the capabilities file. The
 * result carries only the keys that have a value.
 */
export function resolveServer(server: string | ServerOptions | undefined, env: NodeJS.ProcessEnv = process.env): ServerOptions {
    let resolved: ServerOptions;
    if (server === undefined) {
        // An empty APPIUM_URL counts as unset, like every library env var.
        const fromEnv = env.APPIUM_URL;
        resolved = fromEnv !== undefined && fromEnv !== ''
            ? parseServerUrl(fromEnv, 'APPIUM_URL')
            : parseServerUrl(DEFAULT_APPIUM_URL, 'the default Appium URL');
    } else if (typeof server === 'string') {
        resolved = parseServerUrl(server, 'session.server');
    } else if (typeof server === 'object' && server !== null) {
        resolved = fromObject(server);
    } else {
        throw new Error(`session.server must be a URL string or a ServerOptions object, got ${server === null ? 'null' : typeof server}.`);
    }

    if (resolved.user === undefined && env.APPIUM_USER) resolved.user = env.APPIUM_USER;
    if (resolved.key === undefined && env.APPIUM_KEY) resolved.key = env.APPIUM_KEY;
    return resolved;
}

/** Parses an Appium server URL (its base path included, if it has one). `source` names where it came from, for the error. */
export function parseServerUrl(url: string, source = 'session.server'): ServerOptions {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`${source} is not a valid URL: "${url}". Expected the server's own URL, e.g. http://127.0.0.1:4723, or https://<appium-server>/wd/hub for a server started with that base path.`);
    }
    const protocol = parsed.protocol.replace(/:$/, '');
    if (protocol !== 'http' && protocol !== 'https') {
        throw new Error(`${source} must use http or https, got "${parsed.protocol}".`);
    }
    if (parsed.search || parsed.hash) {
        throw new Error(`${source} must not carry a query or fragment; give the server's own URL only (with its base path if it has one).`);
    }
    const result: ServerOptions = {
        protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : (protocol === 'https' ? 443 : 80),
        path: trimPath(parsed.pathname),
    };
    if (parsed.username) result.user = decodeURIComponent(parsed.username);
    if (parsed.password) result.key = decodeURIComponent(parsed.password);
    return result;
}

function fromObject(server: ServerOptions): ServerOptions {
    const defaults = parseServerUrl(DEFAULT_APPIUM_URL);
    const protocol = server.protocol ?? defaults.protocol;
    if (protocol !== 'http' && protocol !== 'https') {
        throw new Error(`session.server.protocol must be 'http' or 'https', got "${String(protocol)}".`);
    }
    const port = server.port ?? defaults.port;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`session.server.port must be an integer from 1 to 65535, got ${String(port)}.`);
    }
    const hostname = server.hostname ?? defaults.hostname;
    if (typeof hostname !== 'string' || hostname === '') {
        throw new Error('session.server.hostname must be a non-empty string.');
    }
    const rawPath = server.path ?? defaults.path ?? '/';
    if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) {
        throw new Error(`session.server.path must start with "/", got "${String(rawPath)}".`);
    }
    const result: ServerOptions = { protocol, hostname, port, path: trimPath(rawPath) };
    if (server.user !== undefined) result.user = server.user;
    if (server.key !== undefined) result.key = server.key;
    return result;
}

/** `/wd/hub/` -> `/wd/hub`; `/` and `` -> `/`. */
function trimPath(p: string): string {
    const trimmed = p.replace(/\/+$/, '');
    return trimmed === '' ? '/' : trimmed;
}
