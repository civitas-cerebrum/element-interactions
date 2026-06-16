CREATE TABLE books (
    book_id      TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    author       TEXT NOT NULL,
    genre        TEXT NOT NULL,
    description  TEXT,
    price        NUMERIC(10,2) NOT NULL,
    cover_image  TEXT,
    stock        INTEGER NOT NULL DEFAULT 0,
    isbn         TEXT UNIQUE
);

CREATE TABLE users (
    user_id       TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE orders (
    order_id     TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(user_id),
    total_price  NUMERIC(10,2) NOT NULL,
    status       TEXT NOT NULL,
    purchased_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE order_items (
    order_item_id     TEXT PRIMARY KEY,
    order_id          TEXT NOT NULL REFERENCES orders(order_id),
    book_id           TEXT NOT NULL REFERENCES books(book_id),
    quantity          INTEGER NOT NULL,
    price_at_purchase NUMERIC(10,2) NOT NULL
);

CREATE TABLE cart_items (
    cart_item_id TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(user_id),
    book_id      TEXT NOT NULL REFERENCES books(book_id),
    quantity     INTEGER NOT NULL,
    added_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE marketplace_listings (
    listing_id TEXT PRIMARY KEY,
    seller_id  TEXT NOT NULL REFERENCES users(user_id),
    book_id    TEXT NOT NULL REFERENCES books(book_id),
    condition  TEXT NOT NULL,
    price      NUMERIC(10,2) NOT NULL,
    listed_at  TIMESTAMPTZ NOT NULL,
    status     TEXT NOT NULL
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_book  ON order_items(book_id);
CREATE INDEX idx_orders_user       ON orders(user_id);
CREATE INDEX idx_cart_user         ON cart_items(user_id);
CREATE INDEX idx_listings_book     ON marketplace_listings(book_id);
