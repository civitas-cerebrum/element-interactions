-- Books: a deterministic subset drawn from book-hive/seed-data/books.json
INSERT INTO books (book_id, title, author, genre, description, price, cover_image, stock, isbn) VALUES
('book-001','To Kill a Mockingbird','Harper Lee','Fiction','Racial injustice in the American South.',12.99,'/covers/placeholder-fiction.svg',15,'978-0-06-112008-4'),
('book-002','The Great Gatsby','F. Scott Fitzgerald','Fiction','Wealth and the American Dream in the Jazz Age.',10.99,'/covers/placeholder-fiction.svg',12,'978-0-7432-7356-5'),
('book-003','1984','George Orwell','Fiction','Totalitarianism and surveillance.',11.99,'/covers/placeholder-fiction.svg',18,'978-0-452-28423-4'),
('book-004','Pride and Prejudice','Jane Austen','Fiction','Love and class in Regency England.',9.99,'/covers/placeholder-fiction.svg',14,'978-0-14-143951-8'),
('book-005','The Catcher in the Rye','J.D. Salinger','Fiction','Teenage alienation in postwar New York.',8.99,'/covers/placeholder-fiction.svg',10,'978-0-316-76948-0'),
('book-006','Sapiens','Yuval Noah Harari','Non-Fiction','A brief history of humankind.',18.99,'/covers/placeholder-nonfiction.svg',20,'978-0-06-231609-7'),
('book-007','Educated','Tara Westover','Non-Fiction','A memoir about education and family.',16.99,'/covers/placeholder-nonfiction.svg',8,'978-0-399-59050-4'),
('book-008','The Hobbit','J.R.R. Tolkien','Fantasy','Bilbo Baggins'' unexpected journey.',14.99,'/covers/placeholder-fantasy.svg',25,'978-0-547-92822-7');

-- Users (fixed timestamps)
INSERT INTO users (user_id, username, email, password_hash, created_at) VALUES
('user-001','alice','alice@bookhive.test','x-hash-1','2026-01-01T10:00:00Z'),
('user-002','bob','bob@bookhive.test','x-hash-2','2026-01-02T10:00:00Z'),
('user-003','carol','carol@bookhive.test','x-hash-3','2026-01-03T10:00:00Z');

-- Orders: alice has 2 orders, bob has 1, carol has 0
INSERT INTO orders (order_id, user_id, total_price, status, purchased_at) VALUES
('order-001','user-001',36.97,'COMPLETED','2026-02-01T12:00:00Z'),
('order-002','user-001',18.99,'COMPLETED','2026-02-10T12:00:00Z'),
('order-003','user-002',29.98,'PENDING','2026-02-15T12:00:00Z');

-- Order items (normalized OrderItem list)
INSERT INTO order_items (order_item_id, order_id, book_id, quantity, price_at_purchase) VALUES
('oi-001','order-001','book-001',1,12.99),
('oi-002','order-001','book-003',2,11.99),
('oi-003','order-002','book-006',1,18.99),
('oi-004','order-003','book-008',2,14.99);

-- Cart items
INSERT INTO cart_items (cart_item_id, user_id, book_id, quantity, added_at) VALUES
('cart-001','user-001','book-005',1,'2026-03-01T09:00:00Z'),
('cart-002','user-002','book-002',3,'2026-03-02T09:00:00Z');

-- Marketplace listings
INSERT INTO marketplace_listings (listing_id, seller_id, book_id, condition, price, listed_at, status) VALUES
('listing-001','user-001','book-004','USED_GOOD',6.50,'2026-03-05T08:00:00Z','ACTIVE'),
('listing-002','user-002','book-007','LIKE_NEW',12.00,'2026-03-06T08:00:00Z','ACTIVE'),
('listing-003','user-003','book-001','USED_FAIR',4.00,'2026-03-07T08:00:00Z','SOLD');
