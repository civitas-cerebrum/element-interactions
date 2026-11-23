// Keeps `WebdriverIO.Browser` resolvable in the published types without webdriverio installed.
import '../types/webdriverio-global';
import type { Platform } from '@civitas-cerebrum/element-repository';

/**
 * Where the Appium server is: the connection part of WebdriverIO's `remote()`
 * options. Vendor- or device-specific settings are capabilities and live in
 * the capabilities file, never here.
 */
export interface ServerOptions {
    protocol?: 'http' | 'https';
    hostname?: string;
    port?: number;
    /** Appium base path, e.g. `'/wd/hub'`. */
    path?: string;
    user?: string;
    key?: string;
}

/** What a {@link SessionProvider} is given to open one session. */
export interface SessionStartContext {
    platform: Platform;
    /** Exactly the capabilities file's content: nothing added, defaulted or rewritten. */
    capabilities: Record<string, unknown>;
    server: ServerOptions;
}

/**
 * Opens and closes the WebdriverIO session a platform run drives. The
 * built-in one is {@link AppiumSessionProvider}; a cloud vendor that needs
 * more than connection options (tunnels, app upload) brings its own.
 */
export interface SessionProvider {
    start(context: SessionStartContext): Promise<WebdriverIO.Browser>;
    stop(driver: WebdriverIO.Browser): Promise<void>;
}

/** The `session` option of `baseFixture`, used only when the platform is in the Appium family. */
export interface SessionOptions {
    /** PATH to a JSON capabilities file. Default: `process.env.CAPABILITIES`. An inline object is not accepted. */
    capabilities?: string;
    /** URL (with base path) or object. Default: `process.env.APPIUM_URL ?? 'http://127.0.0.1:4723'`. */
    server?: string | ServerOptions;
    /** Default: the built-in Appium provider ({@link AppiumSessionProvider}). */
    provider?: SessionProvider;
    /** Between tests. Default `'relaunch'` (terminate, then activate the app under test); `'none'` leaves the app as it is. */
    reset?: 'relaunch' | 'none';
    /** Called once per worker, right after the session opened. */
    onSessionStarted?: (driver: WebdriverIO.Browser) => Promise<void>;
}
