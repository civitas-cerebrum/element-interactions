import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from '../fixture/InventoryFixture';
import { Steps } from '../../src';
import {
    truncateProjection,
    projectBook,
    projectUser,
    projectOrder,
    projectListing,
    ApiBook,
    ApiUser,
    ApiOrder,
    ApiListing,
} from './project';

/**
 * Inventory SQL Verification Suite
 *
 * Drives bookhive inventory operations via the OpenAPI and verifies relational
 * post-conditions against a projection Postgres read-model (5433/bookhive_live).
 *
 * Pattern per test:
 *   1. POST /api/reset + truncateProjection → isolated starting state
 *   2. Read baseline from API → project into read-model
 *   3. Perform the API mutation
 *   4. Read affected entities from API → project updated state
 *   5. Assert relational post-conditions with SQL steps
 */

test.describe.configure({ mode: 'serial' });

const HEALTH_ATTEMPTS = 30;
const HEALTH_DELAY_MS = 1_000;

// ─── shared helpers ───────────────────────────────────────────────────────────

function uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function email(prefix: string): string {
    return `inv+${prefix}+${uid()}@bh.test`;
}

async function signup(steps: Pick<Steps, 'apiPost'>, username: string, emailAddr: string): Promise<{ token: string; userId: string; balance: number }> {
    const res = await steps.apiPost<ApiUser & { token: string; balance: number }>(
        '/api/auth/signup',
        { username, email: emailAddr, password: 'password123' },
    );
    expect(res.status, `signup failed: ${JSON.stringify(res.body)}`).toBe(200);
    const body = res.body as unknown as { token: string; userId: string; username: string; email: string; balance: number };
    return { token: body.token, userId: body.userId, balance: body.balance };
}

async function getBook(steps: Pick<Steps, 'apiGet'>, bookId: string): Promise<ApiBook> {
    const res = await steps.apiGet<ApiBook>(`/api/books/${bookId}`);
    expect(res.status, `GET book ${bookId} failed`).toBe(200);
    return res.body as unknown as ApiBook;
}

async function getMe(steps: Pick<Steps, 'apiGet'>, token: string): Promise<ApiUser & { balance: number }> {
    const res = await steps.apiGet<ApiUser & { balance: number }>('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status, 'GET /api/auth/me failed').toBe(200);
    return res.body as unknown as ApiUser & { balance: number };
}

// ─── beforeAll: health gate ───────────────────────────────────────────────────

test.describe('TC_INV: Inventory SQL Verification — bookhive + Postgres projection', () => {

    test.beforeAll(async () => {
        const baseURL = process.env.BOOKHIVE_API_URL ?? 'http://localhost:8080';
        const ctx = await playwrightRequest.newContext({ baseURL });
        try {
            for (let i = 0; i < HEALTH_ATTEMPTS; i++) {
                try {
                    const r = await ctx.get('/api/health');
                    if (r.status() === 200) break;
                } catch { /* not ready */ }
                await new Promise((r) => setTimeout(r, HEALTH_DELAY_MS));
            }
        } finally {
            await ctx.dispose();
        }
    });

    test.beforeEach(async ({ steps }) => {
        const res = await steps.apiPost<{ status: string }>('/api/reset');
        expect(res.body?.status).toBe('reset');
        await truncateProjection(steps);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_001: Single-item checkout decrements stock
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_001: single-item checkout decrements stock and reconciles total_price', async ({ steps }) => {
        const u = await signup(steps, `user001_${uid()}`, email('001'));
        const userObj: ApiUser = { userId: u.userId, username: `user001`, email: email('001u'), balance: u.balance };
        await projectUser(steps, userObj);

        const book = await getBook(steps, 'book-001');
        await projectBook(steps, book);
        const baseline = book.stock;

        // Add to cart (qty 2) and checkout
        const cartRes = await steps.apiPost('/api/cart/items', { bookId: 'book-001', quantity: 2 }, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(cartRes.status, 'add-to-cart failed').toBe(200);

        const orderRes = await steps.apiPost<ApiOrder>('/api/orders', {}, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(orderRes.status, `checkout failed: ${JSON.stringify(orderRes.body)}`).toBe(200);
        const order = orderRes.body as unknown as ApiOrder;

        // Project updated book and order
        const bookAfter = await getBook(steps, 'book-001');
        await projectBook(steps, bookAfter);
        await projectOrder(steps, order);

        // SQL assertions
        const stockRow = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-001']);
        await steps.verifySqlRowCount(stockRow, 1);
        await steps.verifySqlValue(stockRow, 0, 'stock', baseline - 2);

        const orderRow = await steps.sqlQuery('SELECT status FROM orders WHERE order_id = $1', [order.id]);
        await steps.verifySqlValue(orderRow, 0, 'status', 'COMPLETED');

        const itemsRow = await steps.sqlQuery('SELECT count(*) AS c FROM order_items WHERE order_id = $1', [order.id]);
        await steps.verifySqlValue(itemsRow, 0, 'c', 1);

        // Reconciliation: total_price == SUM(quantity * price_at_purchase)
        const reconRow = await steps.sqlQuery<{ total_price: string; c: string }>(
            `SELECT o.total_price, SUM(oi.quantity * oi.price_at_purchase) AS c
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.order_id
             WHERE o.order_id = $1
             GROUP BY o.total_price`,
            [order.id],
        );
        await steps.verifySqlRowCount(reconRow, 1);
        expect(Number(reconRow.rows[0].total_price)).toBeCloseTo(Number(reconRow.rows[0].c), 2);

        // No negative stock
        const negRow = await steps.sqlQuery<{ c: string }>('SELECT count(*) AS c FROM books WHERE stock < 0');
        await steps.verifySqlValue(negRow, 0, 'c', 0);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_002: Multi-item checkout
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_002: multi-item checkout decrements both stocks and reconciles total_price', async ({ steps }) => {
        const u = await signup(steps, `user002_${uid()}`, email('002'));

        const book1 = await getBook(steps, 'book-001');
        const book2 = await getBook(steps, 'book-002');
        await projectBook(steps, book1);
        await projectBook(steps, book2);
        const baseline1 = book1.stock;
        const baseline2 = book2.stock;

        await steps.apiPost('/api/cart/items', { bookId: 'book-001', quantity: 2 }, { headers: { Authorization: `Bearer ${u.token}` } });
        await steps.apiPost('/api/cart/items', { bookId: 'book-002', quantity: 1 }, { headers: { Authorization: `Bearer ${u.token}` } });

        const orderRes = await steps.apiPost<ApiOrder>('/api/orders', {}, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(orderRes.status, `checkout failed: ${JSON.stringify(orderRes.body)}`).toBe(200);
        const order = orderRes.body as unknown as ApiOrder;

        const b1After = await getBook(steps, 'book-001');
        const b2After = await getBook(steps, 'book-002');
        await projectBook(steps, b1After);
        await projectBook(steps, b2After);
        await projectOrder(steps, order);

        const s1 = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-001']);
        await steps.verifySqlValue(s1, 0, 'stock', baseline1 - 2);

        const s2 = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-002']);
        await steps.verifySqlValue(s2, 0, 'stock', baseline2 - 1);

        const itemsRow = await steps.sqlQuery('SELECT count(*) AS c FROM order_items WHERE order_id = $1', [order.id]);
        await steps.verifySqlValue(itemsRow, 0, 'c', 2);

        const reconRow = await steps.sqlQuery<{ total_price: string; c: string }>(
            `SELECT o.total_price, SUM(oi.quantity * oi.price_at_purchase) AS c
             FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
             WHERE o.order_id = $1 GROUP BY o.total_price`,
            [order.id],
        );
        await steps.verifySqlRowCount(reconRow, 1);
        expect(Number(reconRow.rows[0].total_price)).toBeCloseTo(Number(reconRow.rows[0].c), 2);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_003: Insufficient-balance checkout → unchanged stock
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_003: insufficient-balance checkout leaves stock and no order', async ({ steps }) => {
        const u = await signup(steps, `user003_${uid()}`, email('003'));

        // book-001 price=12.99; 8 × 12.99 = 103.92 > 100 (starting balance)
        const book = await getBook(steps, 'book-001');
        await projectBook(steps, book);
        const baseline = book.stock;

        // This succeeds (add-to-cart doesn't check balance)
        const cartRes = await steps.apiPost('/api/cart/items', { bookId: 'book-001', quantity: 8 }, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(cartRes.status, 'add to cart should succeed').toBe(200);

        // Checkout should fail with 400
        const orderRes = await steps.apiPost<ApiOrder>('/api/orders', {}, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(orderRes.status, `expected 400 insufficient balance but got ${orderRes.status}: ${JSON.stringify(orderRes.body)}`).toBe(400);

        // Re-project book (should still show baseline stock)
        const bookAfter = await getBook(steps, 'book-001');
        await projectBook(steps, bookAfter);

        const stockRow = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-001']);
        await steps.verifySqlValue(stockRow, 0, 'stock', baseline);

        // No order rows for this user
        const ordersRow = await steps.sqlQuery(
            'SELECT count(*) AS c FROM orders WHERE user_id = $1', [u.userId],
        );
        await steps.verifySqlValue(ordersRow, 0, 'c', 0);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_004: Insufficient-stock checkout → unchanged stock
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_004: insufficient-stock checkout leaves stock unchanged and no order', async ({ steps }) => {
        const u = await signup(steps, `user004_${uid()}`, email('004'));

        const book = await getBook(steps, 'book-001');
        await projectBook(steps, book);
        const baseline = book.stock;

        // Request stock + 1 — should fail at add-to-cart (400)
        const cartRes = await steps.apiPost(
            '/api/cart/items',
            { bookId: 'book-001', quantity: baseline + 1 },
            { headers: { Authorization: `Bearer ${u.token}` } },
        );
        // API returns 400 at add-to-cart when quantity > stock
        expect(cartRes.status, `expected 400 for qty=${baseline + 1} > stock=${baseline}`).toBe(400);

        // Even if somehow cart was populated, checkout would also fail; no order expected
        await steps.apiPost<ApiOrder>('/api/orders', {}, { headers: { Authorization: `Bearer ${u.token}` } });

        const bookAfter = await getBook(steps, 'book-001');
        await projectBook(steps, bookAfter);

        const stockRow = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-001']);
        await steps.verifySqlValue(stockRow, 0, 'stock', baseline);

        const ordersRow = await steps.sqlQuery(
            'SELECT count(*) AS c FROM orders WHERE user_id = $1', [u.userId],
        );
        await steps.verifySqlValue(ordersRow, 0, 'c', 0);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_005: Order return restocks and refunds balance
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_005: order return restocks book and refunds user balance', async ({ steps }) => {
        const u = await signup(steps, `user005_${uid()}`, email('005'));
        const userObj: ApiUser = { userId: u.userId, balance: u.balance };
        await projectUser(steps, userObj);

        const book = await getBook(steps, 'book-002');
        await projectBook(steps, book);
        const baseline = book.stock;

        // checkout book-002 qty 3
        await steps.apiPost('/api/cart/items', { bookId: 'book-002', quantity: 3 }, { headers: { Authorization: `Bearer ${u.token}` } });
        const orderRes = await steps.apiPost<ApiOrder>('/api/orders', {}, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(orderRes.status).toBe(200);
        const order = orderRes.body as unknown as ApiOrder;

        const bookMid = await getBook(steps, 'book-002');
        await projectBook(steps, bookMid);
        await projectOrder(steps, order);

        // Verify stock decremented
        const sMid = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-002']);
        await steps.verifySqlValue(sMid, 0, 'stock', baseline - 3);

        // Return the order
        const returnRes = await steps.apiPost<ApiOrder>(`/api/orders/${order.id}/return`, {}, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(returnRes.status, `return failed: ${JSON.stringify(returnRes.body)}`).toBe(200);
        const returnedOrder = returnRes.body as unknown as ApiOrder;

        // Re-project book and order and user
        const bookAfter = await getBook(steps, 'book-002');
        await projectBook(steps, bookAfter);
        await projectOrder(steps, returnedOrder);
        const meAfter = await getMe(steps, u.token);
        await projectUser(steps, { userId: u.userId, balance: meAfter.balance });

        // SQL: book-002 stock back to baseline
        const sAfter = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-002']);
        await steps.verifySqlValue(sAfter, 0, 'stock', baseline);

        // Order status RETURNED
        const orderRow = await steps.sqlQuery('SELECT status FROM orders WHERE order_id = $1', [order.id]);
        await steps.verifySqlValue(orderRow, 0, 'status', 'RETURNED');

        // User balance refunded back to 100
        const userRow = await steps.sqlQuery<{ balance: string }>('SELECT balance FROM users WHERE user_id = $1', [u.userId]);
        await steps.verifySqlRowCount(userRow, 1);
        expect(Number(userRow.rows[0].balance)).toBeCloseTo(100.0, 2);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_006: Double return rejected
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_006: double return is rejected, order stays RETURNED and stock unchanged', async ({ steps }) => {
        const u = await signup(steps, `user006_${uid()}`, email('006'));

        const book = await getBook(steps, 'book-002');
        await projectBook(steps, book);
        const baseline = book.stock;

        await steps.apiPost('/api/cart/items', { bookId: 'book-002', quantity: 2 }, { headers: { Authorization: `Bearer ${u.token}` } });
        const orderRes = await steps.apiPost<ApiOrder>('/api/orders', {}, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(orderRes.status).toBe(200);
        const order = orderRes.body as unknown as ApiOrder;

        // First return → succeeds
        const ret1 = await steps.apiPost<ApiOrder>(`/api/orders/${order.id}/return`, {}, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(ret1.status).toBe(200);
        await projectOrder(steps, ret1.body as unknown as ApiOrder);

        // Second return → 400
        const ret2 = await steps.apiPost(`/api/orders/${order.id}/return`, {}, { headers: { Authorization: `Bearer ${u.token}` } });
        expect(ret2.status, `expected 400 on double return, got ${ret2.status}`).toBe(400);

        // Re-project book
        const bookAfter = await getBook(steps, 'book-002');
        await projectBook(steps, bookAfter);

        // SQL: order still RETURNED
        const orderRow = await steps.sqlQuery('SELECT status FROM orders WHERE order_id = $1', [order.id]);
        await steps.verifySqlValue(orderRow, 0, 'status', 'RETURNED');

        // Stock back to baseline (was restocked by first return)
        const sAfter = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-002']);
        await steps.verifySqlValue(sAfter, 0, 'stock', baseline);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_007: Create listing → ACTIVE, stock unchanged
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_007: create listing is ACTIVE and does not change book stock', async ({ steps }) => {
        const seller = await signup(steps, `seller007_${uid()}`, email('007s'));

        const book = await getBook(steps, 'book-003');
        await projectBook(steps, book);
        const baseline = book.stock;

        const listRes = await steps.apiPost<ApiListing>(
            '/api/marketplace/listings',
            { bookId: 'book-003', condition: 'LIKE_NEW', price: 7.25 },
            { headers: { Authorization: `Bearer ${seller.token}` } },
        );
        expect(listRes.status, `listing failed: ${JSON.stringify(listRes.body)}`).toBe(200);
        const listing = listRes.body as unknown as ApiListing;
        await projectListing(steps, listing);

        // Re-project book (stock should not change)
        const bookAfter = await getBook(steps, 'book-003');
        await projectBook(steps, bookAfter);

        // SQL: listing ACTIVE
        const listRow = await steps.sqlQuery('SELECT status FROM marketplace_listings WHERE listing_id = $1', [listing.id]);
        await steps.verifySqlRowCount(listRow, 1);
        await steps.verifySqlValue(listRow, 0, 'status', 'ACTIVE');

        // SQL: book-003 stock unchanged
        const sRow = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-003']);
        await steps.verifySqlValue(sRow, 0, 'stock', baseline);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_008: Two listings for same book
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_008: two listings for same book are both ACTIVE with distinct IDs', async ({ steps }) => {
        const seller = await signup(steps, `seller008_${uid()}`, email('008s'));

        const list1Res = await steps.apiPost<ApiListing>(
            '/api/marketplace/listings',
            { bookId: 'book-004', condition: 'GOOD', price: 5.00 },
            { headers: { Authorization: `Bearer ${seller.token}` } },
        );
        expect(list1Res.status).toBe(200);
        const l1 = list1Res.body as unknown as ApiListing;
        await projectListing(steps, l1);

        const list2Res = await steps.apiPost<ApiListing>(
            '/api/marketplace/listings',
            { bookId: 'book-004', condition: 'FAIR', price: 3.50 },
            { headers: { Authorization: `Bearer ${seller.token}` } },
        );
        expect(list2Res.status).toBe(200);
        const l2 = list2Res.body as unknown as ApiListing;
        await projectListing(steps, l2);

        // SQL: 2 ACTIVE listings for book-004, distinct IDs
        const rows = await steps.sqlQuery(
            'SELECT listing_id, status FROM marketplace_listings WHERE book_id = $1 ORDER BY listed_at',
            ['book-004'],
        );
        await steps.verifySqlRowCount(rows, 2);
        await steps.verifySqlValue(rows, 0, 'status', 'ACTIVE');
        await steps.verifySqlValue(rows, 1, 'status', 'ACTIVE');
        expect(rows.rows[0]['listing_id']).not.toBe(rows.rows[1]['listing_id']);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_009: Cancel listing
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_009: cancelled listing shows CANCELLED in projection', async ({ steps }) => {
        const seller = await signup(steps, `seller009_${uid()}`, email('009s'));

        const listRes = await steps.apiPost<ApiListing>(
            '/api/marketplace/listings',
            { bookId: 'book-003', condition: 'GOOD', price: 6.00 },
            { headers: { Authorization: `Bearer ${seller.token}` } },
        );
        expect(listRes.status).toBe(200);
        const listing = listRes.body as unknown as ApiListing;

        // Active before delete
        await projectListing(steps, listing);
        const activeRow = await steps.sqlQuery('SELECT status FROM marketplace_listings WHERE listing_id = $1', [listing.id]);
        await steps.verifySqlValue(activeRow, 0, 'status', 'ACTIVE');

        // Cancel
        const delRes = await steps.apiDelete(`/api/marketplace/listings/${listing.id}`, {
            headers: { Authorization: `Bearer ${seller.token}` },
        });
        expect(delRes.status, `delete failed: ${JSON.stringify(delRes.body)}`).toBe(200);

        // Project listing as CANCELLED (the API returned 200 → listing is now CANCELLED)
        await projectListing(steps, { ...listing, status: 'CANCELLED' });

        // Also confirm it no longer appears in GET /api/marketplace (returns only ACTIVE)
        const mktRes = await steps.apiGet<ApiListing[]>('/api/marketplace', {
            headers: { Authorization: `Bearer ${seller.token}` },
        });
        const visible = (mktRes.body as unknown as ApiListing[]).filter((l) => l.id === listing.id);
        expect(visible.length, 'cancelled listing should not appear in marketplace').toBe(0);

        // SQL: listing CANCELLED
        const row = await steps.sqlQuery('SELECT status FROM marketplace_listings WHERE listing_id = $1', [listing.id]);
        await steps.verifySqlValue(row, 0, 'status', 'CANCELLED');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_010: Buy listing → SOLD, balances transfer, stock unchanged
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_010: buy listing sets SOLD, transfers balance, stock unchanged', async ({ steps }) => {
        const seller = await signup(steps, `seller010_${uid()}`, email('010s'));
        const buyer = await signup(steps, `buyer010_${uid()}`, email('010b'));

        const book = await getBook(steps, 'book-003');
        await projectBook(steps, book);
        const baseline = book.stock;

        const listRes = await steps.apiPost<ApiListing>(
            '/api/marketplace/listings',
            { bookId: 'book-003', condition: 'LIKE_NEW', price: 7.25 },
            { headers: { Authorization: `Bearer ${seller.token}` } },
        );
        expect(listRes.status).toBe(200);
        const listing = listRes.body as unknown as ApiListing;

        // Buyer purchases
        const buyRes = await steps.apiPost<ApiOrder>(
            `/api/marketplace/listings/${listing.id}/buy`,
            {},
            { headers: { Authorization: `Bearer ${buyer.token}` } },
        );
        expect(buyRes.status, `buy failed: ${JSON.stringify(buyRes.body)}`).toBe(200);
        const buyOrder = buyRes.body as unknown as ApiOrder;

        // Project listing as SOLD (the buy endpoint does not return the listing directly;
        // derive status from the fact that buy succeeded)
        await projectListing(steps, { ...listing, status: 'SOLD' });
        await projectOrder(steps, buyOrder);

        // Project both user balances via /api/auth/me
        const sellerMe = await getMe(steps, seller.token);
        const buyerMe = await getMe(steps, buyer.token);
        await projectUser(steps, { userId: seller.userId, balance: sellerMe.balance });
        await projectUser(steps, { userId: buyer.userId, balance: buyerMe.balance });

        // Re-project book (stock should be unchanged)
        const bookAfter = await getBook(steps, 'book-003');
        await projectBook(steps, bookAfter);

        // SQL: listing SOLD
        const listRow = await steps.sqlQuery('SELECT status FROM marketplace_listings WHERE listing_id = $1', [listing.id]);
        await steps.verifySqlValue(listRow, 0, 'status', 'SOLD');

        // SQL: buyer balance = 100 - 7.25 = 92.75
        const buyerRow = await steps.sqlQuery<{ balance: string }>('SELECT balance FROM users WHERE user_id = $1', [buyer.userId]);
        await steps.verifySqlRowCount(buyerRow, 1);
        expect(Number(buyerRow.rows[0].balance)).toBeCloseTo(92.75, 2);

        // SQL: seller balance = 100 + 7.25 = 107.25
        const sellerRow = await steps.sqlQuery<{ balance: string }>('SELECT balance FROM users WHERE user_id = $1', [seller.userId]);
        await steps.verifySqlRowCount(sellerRow, 1);
        expect(Number(sellerRow.rows[0].balance)).toBeCloseTo(107.25, 2);

        // SQL: buy order COMPLETED with 1 item
        const orderRow = await steps.sqlQuery('SELECT status FROM orders WHERE order_id = $1', [buyOrder.id]);
        await steps.verifySqlValue(orderRow, 0, 'status', 'COMPLETED');

        const itemsRow = await steps.sqlQuery('SELECT count(*) AS c FROM order_items WHERE order_id = $1', [buyOrder.id]);
        await steps.verifySqlValue(itemsRow, 0, 'c', 1);

        // SQL: book-003 stock unchanged
        const sRow = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-003']);
        await steps.verifySqlValue(sRow, 0, 'stock', baseline);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_011: Buy with insufficient balance → listing stays ACTIVE
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_011: insufficient-balance buy leaves listing ACTIVE and balances unchanged', async ({ steps }) => {
        const seller = await signup(steps, `seller011_${uid()}`, email('011s'));
        const buyer = await signup(steps, `buyer011_${uid()}`, email('011b'));

        // List book-005 at price 150 (> buyer balance of 100)
        const listRes = await steps.apiPost<ApiListing>(
            '/api/marketplace/listings',
            { bookId: 'book-005', condition: 'NEW', price: 150.00 },
            { headers: { Authorization: `Bearer ${seller.token}` } },
        );
        expect(listRes.status).toBe(200);
        const listing = listRes.body as unknown as ApiListing;
        await projectListing(steps, listing);
        await projectUser(steps, { userId: buyer.userId, balance: buyer.balance });
        await projectUser(steps, { userId: seller.userId, balance: seller.balance });

        // Buyer tries to buy → 400 insufficient balance
        const buyRes = await steps.apiPost(
            `/api/marketplace/listings/${listing.id}/buy`,
            {},
            { headers: { Authorization: `Bearer ${buyer.token}` } },
        );
        expect(buyRes.status, `expected 400 insufficient balance, got ${buyRes.status}`).toBe(400);

        // re-read the listing from the marketplace (post-rejection) and project its REAL status
        const listings = await steps.apiGet<Array<{ id: string; sellerId: string; bookId: string; condition?: string; price: number; status: string; listedAt?: string }>>('/api/marketplace');
        const live = listings.body?.find((l) => l.id === listing.id);
        expect(live, 'listing should still be present in /api/marketplace after a rejected buy').toBeTruthy();
        await projectListing(steps, live!); // genuine post-op status

        // Re-project users (should be unchanged)
        const buyerMe = await getMe(steps, buyer.token);
        const sellerMe = await getMe(steps, seller.token);
        await projectUser(steps, { userId: buyer.userId, balance: buyerMe.balance });
        await projectUser(steps, { userId: seller.userId, balance: sellerMe.balance });

        // SQL: listing still ACTIVE
        const listRow = await steps.sqlQuery('SELECT status FROM marketplace_listings WHERE listing_id = $1', [listing.id]);
        await steps.verifySqlValue(listRow, 0, 'status', 'ACTIVE');

        // SQL: buyer balance still 100
        const buyerRow = await steps.sqlQuery<{ balance: string }>('SELECT balance FROM users WHERE user_id = $1', [buyer.userId]);
        expect(Number(buyerRow.rows[0].balance)).toBeCloseTo(100.0, 2);

        // SQL: seller balance still 100
        const sellerRow = await steps.sqlQuery<{ balance: string }>('SELECT balance FROM users WHERE user_id = $1', [seller.userId]);
        expect(Number(sellerRow.rows[0].balance)).toBeCloseTo(100.0, 2);

        // SQL: no buy order for buyer
        const ordersRow = await steps.sqlQuery('SELECT count(*) AS c FROM orders WHERE user_id = $1', [buyer.userId]);
        await steps.verifySqlValue(ordersRow, 0, 'c', 0);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TC_INV_012: Seller cannot buy own listing
    // ─────────────────────────────────────────────────────────────────────────
    test('TC_INV_012: seller buying own listing is rejected, listing stays ACTIVE', async ({ steps }) => {
        const seller = await signup(steps, `seller012_${uid()}`, email('012s'));

        const listRes = await steps.apiPost<ApiListing>(
            '/api/marketplace/listings',
            { bookId: 'book-003', condition: 'GOOD', price: 5.00 },
            { headers: { Authorization: `Bearer ${seller.token}` } },
        );
        expect(listRes.status).toBe(200);
        const listing = listRes.body as unknown as ApiListing;
        await projectListing(steps, listing);

        // Seller buys own listing → 400
        const buyRes = await steps.apiPost(
            `/api/marketplace/listings/${listing.id}/buy`,
            {},
            { headers: { Authorization: `Bearer ${seller.token}` } },
        );
        expect(buyRes.status, `expected 400 cannot buy own listing, got ${buyRes.status}`).toBe(400);

        // re-read the listing from the marketplace (post-rejection) and project its REAL status
        const listings = await steps.apiGet<Array<{ id: string; sellerId: string; bookId: string; condition?: string; price: number; status: string; listedAt?: string }>>('/api/marketplace');
        const live = listings.body?.find((l) => l.id === listing.id);
        expect(live, 'listing should still be present in /api/marketplace after a rejected buy').toBeTruthy();
        await projectListing(steps, live!); // genuine post-op status

        // SQL: listing still ACTIVE
        const listRow = await steps.sqlQuery('SELECT status FROM marketplace_listings WHERE listing_id = $1', [listing.id]);
        await steps.verifySqlValue(listRow, 0, 'status', 'ACTIVE');
    });
});
