import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.SANDY_DATA_DIR || path.join(here, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const dbFile = path.join(dataDir, 'sandy.db');
export const db = new Database(dbFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS branch (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT,
  phone TEXT,
  allow_discount INTEGER NOT NULL DEFAULT 0,
  max_discount_percent REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  pin TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','attendant')),
  branch_id INTEGER REFERENCES branch(id),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS product (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS variant (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES product(id),
  sku TEXT NOT NULL UNIQUE,
  size TEXT,
  colour TEXT,
  cost_price INTEGER NOT NULL DEFAULT 0,
  selling_price INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock (
  variant_id INTEGER NOT NULL REFERENCES variant(id),
  branch_id INTEGER NOT NULL REFERENCES branch(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 3,
  PRIMARY KEY (variant_id, branch_id)
);

CREATE TABLE IF NOT EXISTS stock_movement (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES variant(id),
  branch_id INTEGER NOT NULL REFERENCES branch(id),
  type TEXT NOT NULL CHECK (type IN ('SALE','RECEIVE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT','RETURN')),
  qty INTEGER NOT NULL,
  ref TEXT,
  reason TEXT,
  user_id INTEGER REFERENCES user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transfer (
  id INTEGER PRIMARY KEY,
  from_branch INTEGER NOT NULL REFERENCES branch(id),
  to_branch INTEGER NOT NULL REFERENCES branch(id),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','cancelled')) DEFAULT 'pending',
  created_by INTEGER REFERENCES user(id),
  accepted_by INTEGER REFERENCES user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT
);

CREATE TABLE IF NOT EXISTS transfer_item (
  id INTEGER PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES transfer(id),
  variant_id INTEGER NOT NULL REFERENCES variant(id),
  qty INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sale (
  id INTEGER PRIMARY KEY,
  client_uid TEXT NOT NULL UNIQUE,
  branch_id INTEGER NOT NULL REFERENCES branch(id),
  user_id INTEGER NOT NULL REFERENCES user(id),
  customer_name TEXT,
  customer_phone TEXT,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','mobile_money','card')),
  amount_paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('completed','voided')) DEFAULT 'completed',
  sms_receipt INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_item (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sale(id),
  variant_id INTEGER NOT NULL REFERENCES variant(id),
  qty INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES user(id),
  branch_id INTEGER REFERENCES branch(id),
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sms_outbox (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER REFERENCES sale(id),
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sale_branch_date ON sale(branch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_movement_variant ON stock_movement(variant_id, branch_id);
`);

export function logAudit(userId, branchId, action, detail) {
  db.prepare(
    'INSERT INTO audit_log (user_id, branch_id, action, detail) VALUES (?,?,?,?)'
  ).run(userId ?? null, branchId ?? null, action, detail ?? null);
}
