import { test, expect } from './fixture/SqlFixture';

/**
 * 100% SQL Step Coverage against the bookhive Postgres fixture
 * (docker-compose.sql.yml). Exercises every sql* / verifySql* method and every
 * conventional query archetype. Mutations clean up after themselves so the
 * suite is rerunnable against the seeded database.
 *
 * Known-correct seed facts (tests/sql/seed.sql):
 *   books=8 (Fiction=5); units/genre: Fiction=3, Non-Fiction=1, Fantasy=2;
 *   alice(user-001) has 2 orders, bob 1, carol 0; alice spend=55.96.
 */
test.describe.configure({ mode: 'serial' });

test.describe('TC_SQL_001: SQL Database Steps — bookhive integration', () => {

    test('SELECT with params + verifySqlRowCount + verifySqlValue', async ({ steps }) => {
        const res = await steps.sqlQuery<{ title: string }>(
            'SELECT title FROM books WHERE genre = $1 ORDER BY title', ['Fiction']);
        await steps.verifySqlRowCount(res, 5);
        await steps.verifySqlValue(res, 0, 'title', '1984');
    });

    test('verifySqlRowCount range + verifySqlNotEmpty + verifySqlEmpty', async ({ steps }) => {
        const some = await steps.sqlQuery('SELECT * FROM books');
        await steps.verifySqlRowCount(some, { min: 1, max: 8 });
        await steps.verifySqlNotEmpty(some);
        const none = await steps.sqlQuery('SELECT * FROM books WHERE genre = $1', ['Nonexistent']);
        await steps.verifySqlEmpty(none);
    });

    test('FK JOIN across orders ⋈ order_items ⋈ books + verifySqlContains', async ({ steps }) => {
        const res = await steps.sqlQuery(
            `SELECT o.order_id, b.title, oi.quantity
             FROM orders o
             JOIN order_items oi ON oi.order_id = o.order_id
             JOIN books b ON b.book_id = oi.book_id
             WHERE o.order_id = $1 ORDER BY b.title`, ['order-001']);
        await steps.verifySqlRowCount(res, 2);
        await steps.verifySqlContains(res, { title: '1984', quantity: 2 });
    });

    test('Aggregate GROUP BY + HAVING — units sold per genre', async ({ steps }) => {
        const res = await steps.sqlQuery<{ genre: string; units: string }>(
            `SELECT b.genre, SUM(oi.quantity)::int AS units
             FROM order_items oi JOIN books b ON b.book_id = oi.book_id
             GROUP BY b.genre HAVING SUM(oi.quantity) >= 2
             ORDER BY units DESC, b.genre ASC`);
        // Fiction=3, Fantasy=2 (Non-Fiction=1 filtered out by HAVING)
        await steps.verifySqlColumn(res, 'genre', ['Fiction', 'Fantasy']);
        await steps.verifySqlColumn(res, 'units', [3, 2]);
    });

    test('Subquery — users with at least one order', async ({ steps }) => {
        const res = await steps.sqlQuery(
            `SELECT username FROM users
             WHERE user_id IN (SELECT DISTINCT user_id FROM orders)
             ORDER BY username`);
        await steps.verifySqlColumn(res, 'username', ['alice', 'bob']);
    });

    test('CTE + window function — rank books by units sold', async ({ steps }) => {
        const res = await steps.sqlQuery<{ title: string; rnk: string }>(
            `WITH sales AS (
                SELECT book_id, SUM(quantity)::int AS units
                FROM order_items GROUP BY book_id)
             SELECT b.title, RANK() OVER (ORDER BY s.units DESC, b.book_id ASC) AS rnk
             FROM sales s JOIN books b ON b.book_id = s.book_id
             ORDER BY rnk`);
        // book-003 (2) and book-008 (2) tie on units; book_id asc breaks the tie → book-003 rank 1
        await steps.verifySqlValue(res, 0, 'title', '1984');
        await steps.verifySqlValue(res, 0, 'rnk', 1);
    });

    test('DISTINCT + ORDER BY/LIMIT/OFFSET', async ({ steps }) => {
        const res = await steps.sqlQuery(
            'SELECT DISTINCT genre FROM books ORDER BY genre ASC LIMIT 2 OFFSET 1');
        // genres asc: Fantasy, Fiction, Non-Fiction → offset 1, limit 2 → Fiction, Non-Fiction
        await steps.verifySqlColumn(res, 'genre', ['Fiction', 'Non-Fiction']);
    });

    test('Builder: sqlSelect(...).run() dispatches a SELECT', async ({ steps }) => {
        const res = await steps.sqlSelect('books')
            .columns('book_id')
            .where('genre = ?', 'Fantasy')
            .run();
        await steps.verifySqlRowCount(res, 1);
        await steps.verifySqlValue(res, 0, 'book_id', 'book-008');
    });

    test('Builder: insert/update/delete lifecycle', async ({ steps }) => {
        const ins = await steps.sqlInsert('cart_items')
            .values({ cart_item_id: 'cart-tmp', user_id: 'user-003', book_id: 'book-002', quantity: 1, added_at: '2026-04-01T00:00:00Z' })
            .run();
        expect(ins.rowCount).toBe(1);

        const upd = await steps.sqlUpdate('cart_items')
            .set({ quantity: 5 })
            .where('cart_item_id = ?', 'cart-tmp')
            .run();
        expect(upd.rowCount).toBe(1);

        const check = await steps.sqlQuery('SELECT quantity FROM cart_items WHERE cart_item_id = $1', ['cart-tmp']);
        await steps.verifySqlValue(check, 0, 'quantity', 5);

        const del = await steps.sqlDelete('cart_items').where('cart_item_id = ?', 'cart-tmp').run();
        expect(del.rowCount).toBe(1);
    });

    test('Raw sqlExecute INSERT/DELETE + provider routing (analytics)', async ({ steps }) => {
        const ins = await steps.sqlExecute(
            'INSERT INTO cart_items (cart_item_id,user_id,book_id,quantity,added_at) VALUES ($1,$2,$3,$4,$5)',
            ['cart-raw', 'user-003', 'book-001', 2, '2026-04-03T00:00:00Z']);
        expect(ins.rowCount).toBe(1);
        const viaProvider = await steps.sqlQuery('analytics', 'SELECT quantity FROM cart_items WHERE cart_item_id = $1', ['cart-raw']);
        await steps.verifySqlValue(viaProvider, 0, 'quantity', 2);
        const del = await steps.sqlExecute('DELETE FROM cart_items WHERE cart_item_id = $1', ['cart-raw']);
        expect(del.rowCount).toBe(1);
    });

    test('Transaction COMMIT — place order decrements stock', async ({ steps }) => {
        await steps.sqlTransaction(async (tx) => {
            await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['book-002']);
            await tx.execute("INSERT INTO orders (order_id,user_id,total_price,status,purchased_at) VALUES ('order-tx','user-003',10.99,'COMPLETED','2026-04-04T00:00:00Z')");
        });
        try {
            const after = await steps.sqlQuery('SELECT stock FROM books WHERE book_id = $1', ['book-002']);
            await steps.verifySqlValue(after, 0, 'stock', 11);
        } finally {
            await steps.sqlExecute("DELETE FROM orders WHERE order_id = 'order-tx'");
            await steps.sqlExecute('UPDATE books SET stock = 12 WHERE book_id = $1', ['book-002']);
        }
    });

    test('Transaction ROLLBACK — failure leaves stock intact', async ({ steps }) => {
        await expect(steps.sqlTransaction(async (tx) => {
            await tx.execute('UPDATE books SET stock = stock - 1 WHERE book_id = $1', ['book-002']);
            throw new Error('boom');
        })).rejects.toThrow('boom');
        const after = await steps.sqlQuery<{ stock: number }>('SELECT stock FROM books WHERE book_id = $1', ['book-002']);
        await steps.verifySqlValue(after, 0, 'stock', 12); // unchanged
    });

    test('Transaction with provider name', async ({ steps }) => {
        const count = await steps.sqlTransaction('analytics', async (tx) => {
            const r = await tx.query<{ n: string }>('SELECT count(*)::int AS n FROM books');
            return Number(r.rows[0].n);
        });
        expect(count).toBe(8);
    });

    test('Negative: verifySqlRowCount mismatch + range violation throw', async ({ steps }) => {
        const res = await steps.sqlQuery('SELECT * FROM books');
        await expect(steps.verifySqlRowCount(res, 999)).rejects.toThrow(/row count/i);
        await expect(steps.verifySqlRowCount(res, { min: 999 })).rejects.toThrow(/row count/i);
        await expect(steps.verifySqlRowCount(res, { max: 1 })).rejects.toThrow(/row count/i);
    });

    test('Negative: verifySqlValue mismatch throws', async ({ steps }) => {
        const res = await steps.sqlQuery('SELECT title FROM books WHERE book_id = $1', ['book-001']);
        await expect(steps.verifySqlValue(res, 0, 'title', 'Wrong Title')).rejects.toThrow(/Expected row/);
    });

    test('Negative: verifySqlContains no-match throws', async ({ steps }) => {
        const res = await steps.sqlQuery('SELECT genre FROM books');
        await expect(steps.verifySqlContains(res, { genre: 'Horror' })).rejects.toThrow(/Expected a row matching/);
    });

    test('Negative: verifySqlColumn order mismatch throws', async ({ steps }) => {
        const res = await steps.sqlQuery('SELECT genre FROM books WHERE genre = $1', ['Fiction']);
        await expect(steps.verifySqlColumn(res, 'genre', ['Fantasy'])).rejects.toThrow(/Expected column/);
    });

    test('Negative: verifySqlNotEmpty on empty throws; verifySqlEmpty on non-empty throws', async ({ steps }) => {
        const empty = await steps.sqlQuery('SELECT * FROM books WHERE 1 = 0');
        await expect(steps.verifySqlNotEmpty(empty)).rejects.toThrow(/non-empty/);
        const full = await steps.sqlQuery('SELECT * FROM books');
        await expect(steps.verifySqlEmpty(full)).rejects.toThrow(/empty SQL result/);
    });

    test('Negative: bad SQL throws QueryFailedException', async ({ steps }) => {
        await expect(steps.sqlQuery('SELECT * FROM not_a_table')).rejects.toThrow(/Query failed/);
    });

    test('Negative: unconfigured provider throws helpful error', async ({ steps }) => {
        await expect(steps.sqlQuery('nope', 'SELECT 1')).rejects.toThrow(/SQL provider "nope" is not configured/);
    });

    test('sqlPing — default and named-provider connectivity probe', async ({ steps }) => {
        await steps.sqlPing();             // default client — resolves without throwing
        await steps.sqlPing('analytics');  // named provider
    });

    test('Negative: sqlPing on unconfigured provider throws helpful error', async ({ steps }) => {
        await expect(steps.sqlPing('nope')).rejects.toThrow(/SQL provider "nope" is not configured/);
    });

    test('sqlScript — runs a multi-statement schema/seed script', async ({ steps }) => {
        await steps.sqlScript(`
            CREATE TABLE IF NOT EXISTS _sql_script_tmp (id INT PRIMARY KEY, label TEXT);
            INSERT INTO _sql_script_tmp (id, label) VALUES (1, 'one'), (2, 'two');
        `);
        try {
            const res = await steps.sqlQuery('SELECT label FROM _sql_script_tmp ORDER BY id');
            await steps.verifySqlColumn(res, 'label', ['one', 'two']);
        } finally {
            await steps.sqlExecute('DROP TABLE IF EXISTS _sql_script_tmp');
        }
    });

    test('sqlScript — provider-routed (analytics)', async ({ steps }) => {
        await steps.sqlScript('analytics',
            'CREATE TABLE IF NOT EXISTS _sql_script_tmp2 (n INT); INSERT INTO _sql_script_tmp2 VALUES (7);');
        try {
            const res = await steps.sqlQuery('SELECT n FROM _sql_script_tmp2');
            await steps.verifySqlValue(res, 0, 'n', 7);
        } finally {
            await steps.sqlExecute('DROP TABLE IF EXISTS _sql_script_tmp2');
        }
    });

    test('closeDbConnections — idempotent pool shutdown', async ({ steps }) => {
        // First call drains the pools; second call must not throw (idempotent).
        await steps.closeDbConnections();
        await steps.closeDbConnections();
    });
});
