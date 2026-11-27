import { Page, APIResponse } from '@playwright/test';

/**
 * Options accepted by the session-aware request family. A pass-through subset of
 * Playwright's `APIRequestContext` request options — see the Playwright docs for
 * the exact semantics of each field.
 */
export interface BrowserRequestOptions {
    /** Maximum number of redirects to follow. `0` disables following — useful for asserting a 30x `location` header. */
    maxRedirects?: number;
    /** Extra request headers. */
    headers?: Record<string, string>;
    /** Query parameters appended to the URL. */
    params?: Record<string, string | number | boolean>;
    /** Raw request body (string, Buffer, or a JSON-serialisable object — Playwright sets `content-type` accordingly). */
    data?: string | Buffer | object;
    /** `application/x-www-form-urlencoded` form body. */
    form?: Record<string, string | number | boolean>;
    /**
     * Whether Playwright throws on a non-2xx/3xx response. Defaults to `false`
     * here (the package default) so status assertions can run against 4xx/5xx
     * responses instead of throwing before the assertion.
     */
    failOnStatusCode?: boolean;
    /** Per-request timeout in ms (0 = no timeout). Defaults to Playwright's request timeout. */
    timeout?: number;
}

/**
 * A typed, framework-owned wrapper over Playwright's `APIResponse`. Exposes the
 * status line, headers, and the lazy body accessors (`json` / `text` / `body`)
 * without leaking the raw Playwright type into user test files.
 */
export interface BrowserResponse {
    /** HTTP status code (e.g. `200`, `404`). */
    readonly status: number;
    /** `true` when the status is in the 2xx range. */
    readonly ok: boolean;
    /** The final request URL (after any followed redirects). */
    readonly url: string;
    /** Response headers, lower-cased keys (Playwright's `headers()` contract). */
    readonly headers: Record<string, string>;
    /** HTTP status text (e.g. `OK`, `Not Found`). */
    readonly statusText: string;
    /** Parse the body as JSON. */
    json<T = unknown>(): Promise<T>;
    /** Read the body as text. */
    text(): Promise<string>;
    /** Read the body as a Buffer. */
    body(): Promise<Buffer>;
}

/** Build a {@link BrowserResponse} from a Playwright {@link APIResponse}. */
function wrap(res: APIResponse): BrowserResponse {
    return {
        status: res.status(),
        ok: res.ok(),
        url: res.url(),
        headers: res.headers(),
        statusText: res.statusText(),
        json: <T = unknown>() => res.json() as Promise<T>,
        text: () => res.text(),
        body: () => res.body(),
    };
}

/**
 * Session-aware HTTP request family, backed by Playwright's `page.request`
 * (`APIRequestContext`). Unlike the wasapi `api*` external-service client, these
 * requests SHARE the browser context's cookies/session — making them the right
 * tool for authenticated redirect / protected-route contract checks (e.g.
 * "hitting `/account` while logged out 30x-redirects to `/login`").
 *
 * Every verb returns a typed {@link BrowserResponse}. `failOnStatusCode`
 * defaults to `false` so status assertions work on 4xx/5xx responses.
 */
export class BrowserRequest {
    constructor(private page: Page) {}

    private toPlaywrightOptions(opts?: BrowserRequestOptions) {
        return {
            maxRedirects: opts?.maxRedirects,
            headers: opts?.headers,
            params: opts?.params,
            data: opts?.data,
            form: opts?.form,
            failOnStatusCode: opts?.failOnStatusCode ?? false,
            timeout: opts?.timeout,
        };
    }

    /** Session-aware `GET`. */
    async get(url: string, opts?: BrowserRequestOptions): Promise<BrowserResponse> {
        return wrap(await this.page.request.get(url, this.toPlaywrightOptions(opts)));
    }

    /** Session-aware `POST`. */
    async post(url: string, opts?: BrowserRequestOptions): Promise<BrowserResponse> {
        return wrap(await this.page.request.post(url, this.toPlaywrightOptions(opts)));
    }

    /** Session-aware `PUT`. */
    async put(url: string, opts?: BrowserRequestOptions): Promise<BrowserResponse> {
        return wrap(await this.page.request.put(url, this.toPlaywrightOptions(opts)));
    }

    /** Session-aware `PATCH`. */
    async patch(url: string, opts?: BrowserRequestOptions): Promise<BrowserResponse> {
        return wrap(await this.page.request.patch(url, this.toPlaywrightOptions(opts)));
    }

    /** Session-aware `DELETE`. */
    async delete(url: string, opts?: BrowserRequestOptions): Promise<BrowserResponse> {
        return wrap(await this.page.request.delete(url, this.toPlaywrightOptions(opts)));
    }

    /** Session-aware `HEAD`. */
    async head(url: string, opts?: BrowserRequestOptions): Promise<BrowserResponse> {
        return wrap(await this.page.request.head(url, this.toPlaywrightOptions(opts)));
    }
}
