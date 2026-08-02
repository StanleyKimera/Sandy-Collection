import { Router } from 'express';
import { db, logAudit } from '../db.js';
import { authRequired, requireRole, branchFor, canSeeBranch } from '../auth.js';

export const catalog = Router();
catalog.use(authRequired);

/** Full sellable catalogue for one branch: variant + live stock. */
catalog.get('/products', (req, res) => {
  const branchId = branchFor(req, req.query.branch_id);
  if (!canSeeBranch(req, branchId)) return res.status(403).json({ error: 'Wrong branch' });
  const rows = db
    .prepare(
      `SELECT v.id AS variant_id, v.sku, v.size, v.colour, v.selling_price, v.cost_price,
              p.id AS product_id, p.name, p.category, ? AS branch_id,
              COALESCE(s.quantity, 0) AS quantity,
              COALESCE(s.reorder_level, 3) AS reorder_level
         FROM variant v
         JOIN product p ON p.id = v.product_id
    LEFT JOIN stock s ON s.variant_id = v.id AND s.branch_id = ?
        WHERE p.active = 1 AND (v.active IS NULL OR v.active = 1)
     ORDER BY p.name, v.size, v.colour`
    )
    .all(branchId, branchId);
  const hideCost = req.user.role === 'attendant';
  res.json(rows.map((r) => (hideCost ? { ...r, cost_price: undefined } : r)));
});

catalog.post('/products', requireRole('owner', 'manager'), (req, res) => {
  const { name, category, variants } = req.body;
  if (!name || !Array.isArray(variants) || variants.length === 0) {
    return res.status(400).json({ error: 'Product name and at least one variant are required' });
  }
  const branches = db.prepare('SELECT id FROM branch').all();
  const create = db.transaction(() => {
    const productId = db
      .prepare('INSERT INTO product (name, category) VALUES (?,?)')
      .run(name, category ?? null).lastInsertRowid;
    for (const v of variants) {
      const variantId = db
        .prepare(
          'INSERT INTO variant (product_id, sku, size, colour, cost_price, selling_price) VALUES (?,?,?,?,?,?)'
        )
        .run(
          productId,
          v.sku,
          v.size ?? null,
          v.colour ?? null,
          Math.round(v.cost_price || 0),
          Math.round(v.selling_price || 0)
        ).lastInsertRowid;
      for (const b of branches) {
        db.prepare(
          'INSERT INTO stock (variant_id, branch_id, quantity, reorder_level) VALUES (?,?,0,?)'
        ).run(variantId, b.id, v.reorder_level ?? 3);
      }
    }
    return productId;
  });
  const id = create();
  logAudit(req.user.id, req.user.branch_id, 'product.create', name);
  res.status(201).json({ id });
});

// Soft-delete a variant (owner only)
catalog.delete('/variants/:id', requireRole('owner'), (req, res) => {
  const v = db.prepare('SELECT * FROM variant WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Variant not found' });
  db.prepare("UPDATE variant SET active = 0, deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").run(
    req.user.id,
    req.params.id
  );
  logAudit(req.user.id, req.user.branch_id, 'variant.delete', `variant ${v.sku}`);
  res.json({ ok: true });
});

// List deleted variants (owner only)
catalog.get('/products/deleted', requireRole('owner'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT v.id AS variant_id, v.sku, v.size, v.colour, v.selling_price, v.cost_price,
              p.id AS product_id, p.name, p.category, v.deleted_at, v.deleted_by
         FROM variant v
         JOIN product p ON p.id = v.product_id
        WHERE v.active = 0
     ORDER BY v.deleted_at DESC`
    )
    .all();
  res.json(rows);
});

// Restore a deleted variant (owner only)
catalog.patch('/variants/:id/restore', requireRole('owner'), (req, res) => {
  const v = db.prepare('SELECT * FROM variant WHERE id = ?').get(req.params.id);
  if (!v) return res.status(404).json({ error: 'Variant not found' });
  db.prepare('UPDATE variant SET active = 1, deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(req.params.id);
  logAudit(req.user.id, req.user.branch_id, 'variant.restore', `variant ${v.sku}`);
  res.json({ ok: true });
});

catalog.patch('/variants/:id/price', requireRole('owner'), (req, res) => {
  const { selling_price, cost_price } = req.body;
  const before = db.prepare('SELECT * FROM variant WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Item not found' });
  db.prepare('UPDATE variant SET selling_price = ?, cost_price = ? WHERE id = ?').run(
    Math.round(selling_price ?? before.selling_price),
    Math.round(cost_price ?? before.cost_price),
    req.params.id
  );
  logAudit(
    req.user.id,
    req.user.branch_id,
    'price.change',
    `${before.sku}: ${before.selling_price} -> ${selling_price}`
  );
  res.json({ ok: true });
});

catalog.get('/branches', (req, res) => {
  res.json(db.prepare('SELECT * FROM branch ORDER BY id').all());
});
