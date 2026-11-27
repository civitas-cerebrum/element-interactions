import { familyOf } from '@civitas-cerebrum/element-repository';
import { strategyFor } from '../appium/platform';
import { notImplementedError } from '../appium/platform/notImplemented';
import { log } from '../logger/Logger';
import type { SessionProvider, SessionStartContext } from './types';

/** WebdriverIO log levels (its `logLevel` client option). */
export type WebdriverioLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * WebdriverIO client options: how the client behaves, not what the session
 * is. They are never capabilities and never connection options.
 */
export interface AppiumClientOptions {
    /** Default `'error'`. Set `'debug'` or `'info'` to see the WebDriver traffic. */
    logLevel?: WebdriverioLogLevel;
    /**
     * WebdriverIO's implicit wait for element commands, in ms. Default `0`:
     * the Steps layer does its own polling with the step timeout, and an
     * implicit wait inside each probe would stretch every poll by it.
     */
    waitforTimeout?: number;
    /** Timeout of one WebDriver request, in ms (WebdriverIO default 120000). */
    connectionRetryTimeout?: number;
    /** Retries of a failed WebDriver request (WebdriverIO default 3). */
    connectionRetryCount?: number;
}

/** The part of the `webdriverio` module the provider uses. */
export interface WebdriverioModule {
    remote(options: Record<string, unknown>): Promise<WebdriverIO.Browser>;
}

export interface AppiumSessionProviderOptions {
    /** WebdriverIO client options; see {@link AppiumClientOptions}. */
    client?: AppiumClientOptions;
    /**
     * Loads `webdriverio`. Default: `import('webdriverio')` on first use.
     * A seam for tests (and for loading it from a custom location); most users
     * never set it.
     */
    importWebdriverio?: () => Promise<WebdriverioModule>;
}

/** The client options the provider applies unless {@link AppiumSessionProviderOptions.client} overrides them. */
export const DEFAULT_CLIENT_OPTIONS: Readonly<Required<Pick<AppiumClientOptions, 'logLevel' | 'waitforTimeout'>>> =
    Object.freeze({ logLevel: 'error', waitforTimeout: 0 });

const MISSING_WEBDRIVERIO =
    'webdriverio is not installed: install webdriverio@^10 to run platform tests (npm install --save-dev webdriverio@^10).';

/**
 * The built-in {@link SessionProvider}: opens a WebdriverIO `remote()` session
 * against an Appium server. `webdriverio` is an optional peer, imported on the
 * first `start`, so web-only users never load it.
 *
 * The session is opened with exactly the capabilities it is given (the
 * capabilities file's content) and the server's connection options. They are
 * passed as a deep copy, so the caller's object is never changed. WebdriverIO
 * adds BiDi keys (`webSocketUrl`, `unhandledPromptBehavior`) to a session that
 * has `browserName` unless `"wdio:enforceWebDriverClassic": true` is set;
 * {@link prepareSession} requires that key in such files. Each
 * instance is independent: no global or static state, two providers coexist.
 */
export class AppiumSessionProvider implements SessionProvider {
    private readonly client: AppiumClientOptions;
    private readonly importer: () => Promise<WebdriverioModule>;
    private loaded: Promise<WebdriverioModule> | undefined;

    constructor(options: AppiumSessionProviderOptions = {}) {
        this.client = { ...DEFAULT_CLIENT_OPTIONS, ...definedOnly(options.client ?? {}) };
        this.importer = options.importWebdriverio ?? (async () => await import('webdriverio') as unknown as WebdriverioModule);
    }

    async start(context: SessionStartContext): Promise<WebdriverIO.Browser> {
        const { platform } = context;
        if (familyOf(platform) !== 'appium') {
            throw new Error(`AppiumSessionProvider: platform "${platform}" is not in the Appium family; web runs need no session.`);
        }
        if (!strategyFor(platform).implemented) throw notImplementedError(platform);

        const { remote } = await this.webdriverio();
        const { protocol, hostname, port, path, user, key } = context.server;
        return await remote({
            ...this.client,
            ...definedOnly({ protocol, hostname, port, path, user, key }),
            // A copy: WebdriverIO writes into the capabilities object it is
            // given, and the caller's object must stay exactly the file.
            capabilities: structuredClone(context.capabilities),
        });
    }

    async stop(driver: WebdriverIO.Browser): Promise<void> {
        try {
            await (driver as unknown as { deleteSession(): Promise<unknown> }).deleteSession();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (isDeadSession(message)) {
                log.info('Appium session was already closed: %s', message);
                return;
            }
            log.warn('Closing the Appium session failed: %s', message);
            throw error;
        }
    }

    private webdriverio(): Promise<WebdriverioModule> {
        this.loaded ??= this.importer().then(
            (mod) => {
                if (typeof mod?.remote !== 'function') {
                    throw new Error(`The loaded webdriverio module has no remote() function. ${MISSING_WEBDRIVERIO}`);
                }
                return mod;
            },
            (error: unknown) => {
                const code = (error as NodeJS.ErrnoException)?.code;
                const message = error instanceof Error ? error.message : String(error);
                if ((code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') && /webdriverio/.test(message)) {
                    throw new Error(MISSING_WEBDRIVERIO, { cause: error });
                }
                throw error;
            },
        );
        // A failed load is not cached: installing webdriverio and retrying works.
        this.loaded.catch(() => { this.loaded = undefined; });
        return this.loaded;
    }
}

/** True for the errors a server gives when the session is already gone. */
function isDeadSession(message: string): boolean {
    return /invalid session id|no such session|session is either terminated or not started|session (?:was |has been )?(?:not found|terminated|deleted)/i
        .test(message);
}

function definedOnly<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
