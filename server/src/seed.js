import { db, dbFile } from './db.js';
import { hashPin } from './auth.js';

const branches = [
  {
    id: 1,
    name: 'Sandy Collection — Main Branch',
    address: 'Kampala Road, Kampala',
    phone: '+256 700 000001',
    allow_discount: 0,
    max_discount_percent: 0
  },
  {
    id: 2,
    name: 'Sandy Collection — Branch Two',
    address: 'Ntinda, Kampala',
    phone: '+256 700 000002',
    allow_discount: 1,
    max_discount_percent: 10
  }
];

const users = [
  { name: 'Sandy (Owner)', username: 'owner', pin: '1234', role: 'owner', branch_id: 1 },
  { name: 'Main Manager', username: 'main.manager', pin: '1111', role: 'manager', branch_id: 1 },
  { name: 'Main Attendant', username: 'main.sales', pin: '2222', role: 'attendant', branch_id: 1 },
  { name: 'Two Manager', username: 'two.manager', pin: '3333', role: 'manager', branch_id: 2 },
  { name: 'Two Attendant A', username: 'two.sales1', pin: '4444', role: 'attendant', branch_id: 2 },
  { name: 'Two Attendant B', username: 'two.sales2', pin: '5555', role: 'attendant', branch_id: 2 }
];

const catalogue = [
  { name: "Men's Kitenge Shirt", category: 'Shirts', cost: 35000, price: 60000, sizes: ['S', 'M', 'L', 'XL'], colours: ['Blue', 'Black'] },
  { name: 'Ladies Maxi Dress', category: 'Dresses', cost: 55000, price: 95000, sizes: ['S', 'M', 'L'], colours: ['Red', 'Green'] },
  { name: 'Denim Jeans', category: 'Trousers', cost: 45000, price: 80000, sizes: ['30', '32', '34', '36'], colours: ['Blue'] },
  { name: 'Cotton T-Shirt', category: 'T-Shirts', cost: 12000, price: 25000, sizes: ['S', 'M', 'L', 'XL'], colours: ['White', 'Black'] },
  { name: 'Ladies Handbag', category: 'Accessories', cost: 40000, price: 75000, sizes: ['One Size'], colours: ['Brown', 'Black'] },
  { name: 'Kids Two-Piece Set', category: 'Kids', cost: 20000, price: 38000, sizes: ['2Y', '4Y', '6Y'], colours: ['Pink', 'Blue'] }
];

const seed = db.transaction(() => {
  if (db.prepare('SELECT COUNT(*) AS n FROM branch').get().n > 0) {
    console.log('Database already has data — nothing to seed.');
    return false;
  }
  for (const b of branches) {
    db.prepare(
      'INSERT INTO branch (id, name, address, phone, allow_discount, max_discount_percent) VALUES (?,?,?,?,?,?)'
    ).run(b.id, b.name, b.address, b.phone, b.allow_discount, b.max_discount_percent);
  }
  for (const u of users) {
    db.prepare('INSERT INTO user (name, username, pin, role, branch_id) VALUES (?,?,?,?,?)').run(
      u.name,
      u.username,
      hashPin(u.pin),
      u.role,
      u.branch_id
    );
  }
  let n = 1;
  for (const p of catalogue) {
    const productId = db
      .prepare('INSERT INTO product (name, category) VALUES (?,?)')
      .run(p.name, p.category).lastInsertRowid;
    for (const size of p.sizes) {
      for (const colour of p.colours) {
        const sku = `SC-${String(n).padStart(4, '0')}`;
        n += 1;
        const variantId = db
          .prepare(
            'INSERT INTO variant (product_id, sku, size, colour, cost_price, selling_price) VALUES (?,?,?,?,?,?)'
          )
          .run(productId, sku, size, colour, p.cost, p.price).lastInsertRowid;
        for (const b of branches) {
          const qty = 4 + ((n + b.id) % 9);
          db.prepare(
            'INSERT INTO stock (variant_id, branch_id, quantity, reorder_level) VALUES (?,?,?,3)'
          ).run(variantId, b.id, qty);
          db.prepare(
            `INSERT INTO stock_movement (variant_id, branch_id, type, qty, ref, user_id)
             VALUES (?,?,'RECEIVE',?, 'Opening stock', 1)`
          ).run(variantId, b.id, qty);
        }
      }
    }
  }
  return true;
});

if (seed()) {
  console.log(`Seeded Sandy Collection database at ${dbFile}`);
  console.log('Sign in with owner / 1234 (see README for the other staff PINs).');
}
