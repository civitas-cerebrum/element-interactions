import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from './fixture/StepFixture';

/**
 * 100% API Coverage — HTTP Steps against a real BookHive backend.
 *
 * These tests exercise every `api*` / `verifyApi*` method on the Steps API
 * against the `umutayb/book-hive-backend:latest` image brought up by the
 * project's docker-compose. No mocks — behaviour is locked against the same
 * real artefact that downstream consumers use.
 *
 * Endpoints exercised (from book-hive/README.md → Backend API):
 *   GET    /api/health
 *   GET    /api/books, /api/books/{id}
 *   POST   /api/reset, /api/auth/login
 *   PUT    /api/cart/items/{id}        (auth-gated → 401 when unauth'd)
 *   DELETE /api/cart/items/{id}        (auth-gated → 401 when unauth'd)
 *   PATCH  /api/books/{id}             (unmapped  → 405)
 *   HEAD   /api/books                  (supported on GET routes by Spring)
 *
 * Unauthenticated 401 / 405 responses are valid targets here — they prove
 * the method wrapper, URL, and response-parsing paths work end-to-end
 * without needing to thread a JWT through every test.
 */

const BOOKHIVE_HEALTH_ATTEMPTS = 30;
const BOOKHIVE_HEALTH_DELAY_MS = 1000;

test.describe.configure({ mode: 'serial' });

test.describe('TC_API_001: HTTP API Steps — BookHive integration', () => {
    test.beforeAll(async () => {
        // Infrastructure pre-flight uses Playwright's own `request` (the Steps
        // API fixture depends on `page`, which Playwright disallows in `beforeAll`).
        // The actual coverage tests below exercise our API steps, not this setup.
        const baseURL = process.env.BOOKHIVE_API_URL ?? 'http://localhost:8080';
        const ctx = await playwrightRequest.newContext({ baseURL });
        try {
            for (let attempt = 0; attempt < BOOKHIVE_HEALTH_ATTEMPTS; attempt++) {
                try {
                    const res = await ctx.get('/api/health');
                    if (res.status() === 200) break;
                } catch { /* not ready yet */ }
                await new Promise((r) => setTimeout(r, BOOKHIVE_HEALTH_DELAY_MS));
            }
            // Reset to known seed state (50 books + 2 test users).
            await ctx.post('/api/reset');
        } finally {
            await ctx.dispose();
        }
    });

    test('apiGet — default provider, no query', async ({ steps }) => {
        const res = await steps.apiGet<{ content: unknown[] }>('/api/books');
        await steps.verifyApiStatus(res, 200);
        expect(Array.isArray(res.body.content)).toBe(true);
    });

    test('apiGet — default provider, with query params', async ({ steps }) => {
        const res = await steps.apiGet<{ content: unknown[] }>('/api/books', {
            query: { genre: 'Fiction', size: '5' },
        });
        await steps.verifyApiStatus(res, 200);
        expect(res.body.content.length).toBeGreaterThan(0);
    });

    test('apiGet — named provider (bookhive)', async ({ steps }) => {
        const res = await steps.apiGet<unknown>('bookhive', '/api/books/book-001');
        await steps.verifyApiStatus(res, 200);
    });

    test('apiGet — named provider with query params', async ({ steps }) => {
        const res = await steps.apiGet<unknown>('bookhive', '/api/books', {
            query: { query: 'mockingbird' },
        });
        await steps.verifyApiStatus(res, 200);
    });

    test('apiGet — unknown resource returns 404', async ({ steps }) => {
        const res = await steps.apiGet<unknown>('/api/books/does-not-exist-xyz');
        await steps.verifyApiStatus(res, 404);
    });

    test('apiPost — with JSON body (login)', async ({ steps }) => {
        const res = await steps.apiPost<{ token: string }>('/api/auth/login', {
            email: 'testuser1@bookhive.test',
            password: 'Test1234!',
        });
        await steps.verifyApiStatus(res, 200);
        expect(typeof res.body.token).toBe('string');
    });

    test('apiPost — named provider, no body', async ({ steps }) => {
        const res = await steps.apiPost<{ status: string }>('bookhive', '/api/reset');
        await steps.verifyApiStatus(res, 200);
        expect(res.body.status).toBe('reset');
    });

    test('apiPut — exercises wrapper (401 unauthenticated)', async ({ steps }) => {
        const res = await steps.apiPut<unknown>('/api/cart/items/anything', { quantity: 2 });
        expect([401, 403]).toContain(res.status);
    });

    test('apiPut — named provider', async ({ steps }) => {
        const res = await steps.apiPut<unknown>('bookhive', '/api/cart/items/anything', {
            quantity: 3,
        });
        expect([401, 403]).toContain(res.status);
    });

    test('apiDelete — exercises wrapper (401 unauthenticated)', async ({ steps }) => {
        const res = await steps.apiDelete<unknown>('/api/cart/items/anything');
        expect([401, 403]).toContain(res.status);
    });

    test('apiDelete — named provider', async ({ steps }) => {
        const res = await steps.apiDelete<unknown>('bookhive', '/api/cart/items/anything');
        expect([401, 403]).toContain(res.status);
    });

    test('apiPatch — unmapped route returns 4xx', async ({ steps }) => {
        const res = await steps.apiPatch<unknown>('/api/books/book-001', { price: 1 });
        // book-hive has no @PatchMapping; Spring returns 401/403/404/405 depending on filter chain.
        expect([401, 403, 404, 405]).toContain(res.status);
    });

    test('apiPatch — named provider', async ({ steps }) => {
        const res = await steps.apiPatch<unknown>('bookhive', '/api/books/book-001', {
            price: 1,
        });
        expect([401, 403, 404, 405]).toContain(res.status);
    });

    test('apiHead — returns headers record, no body', async ({ steps }) => {
        const headers = await steps.apiHead('/api/books');
        expect(headers).toBeDefined();
        expect(Object.keys(headers).length).toBeGreaterThan(0);
    });

    test('apiHead — named provider', async ({ steps }) => {
        const headers = await steps.apiHead('bookhive', '/api/books/book-001');
        expect(headers).toBeDefined();
    });

    test('verifyApiStatus — passes on match', async ({ steps }) => {
        const res = await steps.apiGet<unknown>('/api/health');
        await steps.verifyApiStatus(res, 200);
    });

    test('verifyApiStatus — throws on mismatch with body in message', async ({ steps }) => {
        const res = await steps.apiGet<unknown>('/api/books/nope');
        await expect(steps.verifyApiStatus(res, 200)).rejects.toThrow(/404/);
    });

    test('verifyApiHeader — presence only (case-insensitive name)', async ({ steps }) => {
        const res = await steps.apiGet<unknown>('/api/books');
        await steps.verifyApiHeader(res, 'content-type');
        await steps.verifyApiHeader(res, 'Content-Type'); // same header, different case
    });

    test('verifyApiHeader — exact value match', async ({ steps }) => {
        const res = await steps.apiGet<unknown>('/api/books');
        const actual = res.headers['content-type'] ?? res.headers['Content-Type'];
        expect(actual).toBeDefined();
        await steps.verifyApiHeader(res, 'content-type', actual!);
    });

    test('verifyApiHeader — throws when header missing', async ({ steps }) => {
        const res = await steps.apiGet<unknown>('/api/books');
        await expect(steps.verifyApiHeader(res, 'x-missing-header')).rejects.toThrow(
            /x-missing-header/,
        );
    });

    test('verifyApiHeader — throws on value mismatch', async ({ steps }) => {
        const res = await steps.apiGet<unknown>('/api/books');
        await expect(
            steps.verifyApiHeader(res, 'content-type', 'text/plain'),
        ).rejects.toThrow(/content-type/);
    });
});
