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
    /** The server's base path, only if it has one (e.g. `'/wd/hub'` for a server started with `--base-path /wd/hub`); default `/`. */
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
    /**
     * PATH to a JSON capabilities file: one flat W3C capabilities object (no
     * `alwaysMatch` / `firstMatch` wrapper). Default: `process.env.E2E_CAPABILITIES`
     * (an empty value counts as unset). An inline object is not accepted.
     *
     * A relative path resolves against `process.cwd()` (where Playwright was
     * started, usually the project root), not against the file that calls
     * `baseFixture`.
     */
    capabilities?: string;
    /**
     * The server's own URL (with its base path only if it has one) or object. Default: `process.env.APPIUM_URL ?? 'http://127.0.0.1:4723'`
     * (an empty `APPIUM_URL` counts as unset).
     *
     * The object form is a complete choice of server: a field it leaves out is
     * filled from the built-in default `http://127.0.0.1:4723` (protocol
     * `http`, hostname `127.0.0.1`, port `4723`, path `/`), never from
     * `APPIUM_URL`. `user` / `key` left out are filled from `APPIUM_USER` /
     * `APPIUM_KEY` in every form.
     */
    server?: string | ServerOptions;
    /** Default: the built-in Appium provider ({@link AppiumSessionProvider}). */
    provider?: SessionProvider;
    /**
     * Between tests. Default `'relaunch'`: terminate, then activate the app
     * under test, then wait until it is in the foreground (`relaunchTimeout`)
     * before the test body starts. `'none'` leaves the app as it is.
     */
    reset?: 'relaunch' | 'none';
    /**
     * With `reset: 'relaunch'`: how long, in ms, the app under test may take
     * to reach the foreground after it was activated. Default 15000. When it
     * expires the test fails in its setup, naming the app id, the platform
     * and the last app state. On iOS, an activation that WebDriverAgent
     * answers with its launch timeout ("Timed out attempting to launch app")
     * is retried once; the retried activation and the foreground wait after
     * it share this one budget.
     */
    relaunchTimeout?: number;
    /**
     * How long, in ms, opening the worker's session may take: the provider's
     * start plus `onSessionStarted`. Default 600000 (a cold real-device start
     * can build WebDriverAgent or install the UiAutomator2 server first). It
     * is the worker fixture's own timeout, so it does not depend on the test
     * timeout; the start fails with an error naming the server (without
     * credentials), the platform and this budget shortly before it expires.
     */
    startTimeout?: number;
    /** Called once per worker, right after the session opened. */
    onSessionStarted?: (driver: WebdriverIO.Browser) => Promise<void>;
}
