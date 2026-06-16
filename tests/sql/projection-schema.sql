-- Projection read-model for inventory verification.
--
-- This is NOT the bookhive backend's datastore (that is MongoDB). It is a
-- relational read-model that the inventory specs populate from the backend's
-- live API responses, so the new SQL steps can assert relational post-conditions
-- (stock deltas, order⋈order_items reconciliation, listing transitions, balance
-- transfers, no-negative-stock) that the REST API does not expose directly.
--
-- No FK constraints: the API already enforces integrity; the read-model only
-- needs to support JOINs/aggregates, and order-independent projection upserts.

CREATE TABLE books (
    book_id      TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    author       TEXT,
    genre        TEXT,
    price        NUMERIC(10,2) NOT NULL,
    stock        INTEGER NOT NULL,
    isbn         TEXT
);

CREATE TABLE users (
    user_id   TEXT PRIMARY KEY,
    username  TEXT,
    email     TEXT,
    balance   NUMERIC(10,2)
);

CREATE TABLE orders (
    order_id     TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    total_price  NUMERIC(10,2) NOT NULL,
    status       TEXT NOT NULL,
    purchased_at TIMESTAMPTZ
);

CREATE TABLE order_items (
    order_item_id     TEXT PRIMARY KEY,
    order_id          TEXT NOT NULL,
    book_id           TEXT NOT NULL,
    quantity          INTEGER NOT NULL,
    price_at_purchase NUMERIC(10,2) NOT NULL
);

CREATE TABLE marketplace_listings (
    listing_id TEXT PRIMARY KEY,
    seller_id  TEXT NOT NULL,
    book_id    TEXT NOT NULL,
    condition  TEXT,
    price      NUMERIC(10,2) NOT NULL,
    status     TEXT NOT NULL,
    listed_at  TIMESTAMPTZ
);

CREATE INDEX idx_proj_order_items_order ON order_items(order_id);
CREATE INDEX idx_proj_order_items_book  ON order_items(book_id);
CREATE INDEX idx_proj_orders_user       ON orders(user_id);
CREATE INDEX idx_proj_listings_book     ON marketplace_listings(book_id);
CREATE INDEX idx_proj_listings_seller   ON marketplace_listings(seller_id);
