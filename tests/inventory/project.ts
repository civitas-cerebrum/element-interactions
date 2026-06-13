/**
 * Projection helpers: upsert the bookhive backend's live API JSON into the
 * relational read-model (5433/bookhive_live) so the SQL steps can assert
 * relational post-conditions of inventory operations.
 *
 * The read-model is NOT the backend's store (that is MongoDB). Each value
 * projected here is the API's actual reported state, so a missing/incorrect
 * API mutation makes the downstream SQL assertion fail.
 */
import { Steps } from '../../src';

export interface ApiBook { id: string; title: string; author?: string; genre?: string; price: number; stock: number; isbn?: string; }
export interface ApiUser { userId: string; username?: string; email?: string; balance?: number; }
export interface ApiOrderItem { bookId: string; quantity: number; priceAtPurchase: number; }
export interface ApiOrder { id: string; userId: string; items: ApiOrderItem[]; totalPrice: number; status: string; purchasedAt?: string; }
export interface ApiListing { id: string; sellerId: string; bookId: string; condition?: string; price: number; status: string; listedAt?: string; }

/** Empty every projection table — call at the start of each test for isolation. */
export async function truncateProjection(steps: Steps): Promise<void> {
    await steps.sqlExecute('TRUNCATE books, users, orders, order_items, marketplace_listings');
}

/** Upsert a book (book_id keyed); refreshes stock + price on conflict. */
export async function projectBook(steps: Steps, b: ApiBook): Promise<void> {
    await steps.sqlExecute(
        `INSERT INTO books (book_id, title, author, genre, price, stock, isbn)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (book_id) DO UPDATE SET stock = EXCLUDED.stock, price = EXCLUDED.price`,
        [b.id, b.title, b.author ?? null, b.genre ?? null, b.price, b.stock, b.isbn ?? null],
    );
}

/** Upsert a user (user_id keyed); refreshes balance on conflict. */
export async function projectUser(steps: Steps, u: ApiUser): Promise<void> {
    await steps.sqlExecute(
        `INSERT INTO users (user_id, username, email, balance) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance`,
        [u.userId, u.username ?? null, u.email ?? null, u.balance ?? null],
    );
}

/** Insert an order + its normalized line items (order_item_id = `${order.id}-${index}`). */
export async function projectOrder(steps: Steps, o: ApiOrder): Promise<void> {
    await steps.sqlExecute(
        `INSERT INTO orders (order_id, user_id, total_price, status, purchased_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status`,
        [o.id, o.userId, o.totalPrice, o.status, o.purchasedAt ?? null],
    );
    for (let i = 0; i < o.items.length; i++) {
        const it = o.items[i];
        await steps.sqlExecute(
            `INSERT INTO order_items (order_item_id, order_id, book_id, quantity, price_at_purchase)
             VALUES ($1,$2,$3,$4,$5) ON CONFLICT (order_item_id) DO NOTHING`,
            [`${o.id}-${i}`, o.id, it.bookId, it.quantity, it.priceAtPurchase],
        );
    }
}

/** Upsert a marketplace listing (listing_id keyed); refreshes status + price on conflict. */
export async function projectListing(steps: Steps, l: ApiListing): Promise<void> {
    await steps.sqlExecute(
        `INSERT INTO marketplace_listings (listing_id, seller_id, book_id, condition, price, status, listed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (listing_id) DO UPDATE SET status = EXCLUDED.status, price = EXCLUDED.price`,
        [l.id, l.sellerId, l.bookId, l.condition ?? null, l.price, l.status, l.listedAt ?? null],
    );
}
