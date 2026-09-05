CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  store_name TEXT NOT NULL,
  purchased_at TEXT NOT NULL,
  payment_method_id TEXT NOT NULL REFERENCES payment_methods(id),
  receipt_total INTEGER,
  image_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES receipts(id),
  sort_order INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL,
  category TEXT NOT NULL
);

CREATE INDEX idx_receipts_purchased_at ON receipts(purchased_at);
CREATE INDEX idx_receipt_items_receipt_id ON receipt_items(receipt_id);
