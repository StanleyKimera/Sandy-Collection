import { Router } from 'express';
import { db, logAudit } from '../db.js';
import { authRequired, requireRole, branchFor, canSeeBranch } from '../auth.js';

export const stock = Router();
stock.use(authRequired);

stock.post('/stock/receive', requireRole('owner', 'manager'), (req, res) => {
  const { items, supplier, branch_id } = req.body;
  const bId = branchFor(req, branch_id);
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Nothing to receive' });
  }
  const run = db.transaction(() => {
    for (const i of items) {
      const qty = Math.trunc(i.qty);
      if (qty <= 0) throw new Error('Quantity must be at least 1');
      db.prepare(
        `INSERT INTO stock (variant_id, branch_id, quantity) VALUES (?,?,?)
         ON CONFLICT(variant_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`
      ).run(i.variant_id, bId, qty);
      if (i.cost_price) {
        db.prepare('UPDATE variant SET cost_price = ? WHERE id = ?').run(
          Math.round(i.cost_price),
          i.variant_id
        );
      }
      db.prepare(
        `INSERT INTO stock_movement (variant_id, branch_id, type, qty, ref, user_id)
         VALUES (?,?,'RECEIVE',?,?,?)`
      ).run(i.variant_id, bId, qty, supplier ?? null, req.user.id);
    }
  });
  try {
    run();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  logAudit(req.user.id, bId, 'stock.receive', `${items.length} line(s) from ${supplier ?? 'supplier'}`);
  res.status(201).json({ ok: true });
});

stock.post('/stock/adjust', requireRole('owner', 'manager'), (req, res) => {
  const { variant_id, counted, reason, branch_id } = req.body;
  const bId = branchFor(req, branch_id);
  if (!reason) return res.status(400).json({ error: 'A stock adjustment needs a reason' });
  const current = db
    .prepare('SELECT quantity FROM stock WHERE variant_id = ? AND branch_id = ?')
    .get(variant_id, bId);
  const diff = Math.trunc(counted) - (current?.quantity ?? 0);
  db.prepare(
    `INSERT INTO stock (variant_id, branch_id, quantity) VALUES (?,?,?)
     ON CONFLICT(variant_id, branch_id) DO UPDATE SET quantity = excluded.quantity`
  ).run(variant_id, bId, Math.trunc(counted));
  db.prepare(
    `INSERT INTO stock_movement (variant_id, branch_id, type, qty, reason, user_id)
     VALUES (?,?,'ADJUSTMENT',?,?,?)`
  ).run(variant_id, bId, diff, reason, req.user.id);
  logAudit(req.user.id, bId, 'stock.adjust', `variant ${variant_id} ${diff >= 0 ? '+' : ''}${diff}: ${reason}`);
  res.json({ ok: true, difference: diff });
});

stock.get('/stock/low', (req, res) => {
  const bId = branchFor(req, req.query.branch_id);
  if (!canSeeBranch(req, bId)) return res.status(403).json({ error: 'Wrong branch' });
  res.json(
    db
      .prepare(
        `SELECT p.name, v.sku, v.size, v.colour, s.quantity, s.reorder_level
           FROM stock s JOIN variant v ON v.id = s.variant_id JOIN product p ON p.id = v.product_id
          WHERE s.branch_id = ? AND s.quantity <= s.reorder_level
       ORDER BY s.quantity`
      )
      .all(bId)
  );
});

stock.get('/stock/movements', (req, res) => {
  const bId = branchFor(req, req.query.branch_id);
  if (!canSeeBranch(req, bId)) return res.status(403).json({ error: 'Wrong branch' });
  res.json(
    db
      .prepare(
        `SELECT m.*, p.name, v.sku, v.size, v.colour, u.name AS staff
           FROM stock_movement m
           JOIN variant v ON v.id = m.variant_id
           JOIN product p ON p.id = v.product_id
      LEFT JOIN user u ON u.id = m.user_id
          WHERE m.branch_id = ?
       ORDER BY m.id DESC LIMIT 100`
      )
      .all(bId)
  );
});

/* ---- branch to branch transfers ---- */

stock.post('/transfers', requireRole('owner', 'manager'), (req, res) => {
  const { to_branch, items } = req.body;
  const from = branchFor(req, req.body.from_branch);
  if (Number(to_branch) === Number(from)) {
    return res.status(400).json({ error: 'Choose a different destination branch' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Nothing to transfer' });
  }
  const run = db.transaction(() => {
    const transferId = db
      .prepare('INSERT INTO transfer (from_branch, to_branch, created_by) VALUES (?,?,?)')
      .run(from, to_branch, req.user.id).lastInsertRowid;
    for (const i of items) {
      const qty = Math.trunc(i.qty);
      const s = db
        .prepare('SELECT quantity FROM stock WHERE variant_id = ? AND branch_id = ?')
        .get(i.variant_id, from);
      if (!s || s.quantity < qty) throw new Error('Not enough stock to transfer');
      db.prepare(
        'UPDATE stock SET quantity = quantity - ? WHERE variant_id = ? AND branch_id = ?'
      ).run(qty, i.variant_id, from);
      db.prepare(
        `INSERT INTO stock_movement (variant_id, branch_id, type, qty, ref, user_id)
         VALUES (?,?,'TRANSFER_OUT',?,?,?)`
      ).run(i.variant_id, from, -qty, `TRF-${transferId}`, req.user.id);
      db.prepare('INSERT INTO transfer_item (transfer_id, variant_id, qty) VALUES (?,?,?)').run(
        transferId,
        i.variant_id,
        qty
      );
    }
    return transferId;
  });
  let id;
  try {
    id = run();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.status(201).json({ id });
});

stock.get('/transfers', (req, res) => {
  const bId = branchFor(req, req.query.branch_id);
  res.json(
    db
      .prepare(
        `SELECT t.*, f.name AS from_name, d.name AS to_name,
                (SELECT COUNT(*) FROM transfer_item ti WHERE ti.transfer_id = t.id) AS lines
           FROM transfer t JOIN branch f ON f.id = t.from_branch JOIN branch d ON d.id = t.to_branch
          WHERE t.from_branch = ? OR t.to_branch = ?
       ORDER BY t.id DESC`
      )
      .all(bId, bId)
  );
});

stock.post('/transfers/:id/accept', requireRole('owner', 'manager'), (req, res) => {
  const t = db.prepare('SELECT * FROM transfer WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Transfer not found' });
  if (t.status !== 'pending') return res.status(400).json({ error: 'Already handled' });
  if (!canSeeBranch(req, t.to_branch)) {
    return res.status(403).json({ error: 'Only the receiving branch can accept' });
  }
  const run = db.transaction(() => {
    for (const i of db.prepare('SELECT * FROM transfer_item WHERE transfer_id = ?').all(t.id)) {
      db.prepare(
        `INSERT INTO stock (variant_id, branch_id, quantity) VALUES (?,?,?)
         ON CONFLICT(variant_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`
      ).run(i.variant_id, t.to_branch, i.qty);
      db.prepare(
        `INSERT INTO stock_movement (variant_id, branch_id, type, qty, ref, user_id)
         VALUES (?,?,'TRANSFER_IN',?,?,?)`
      ).run(i.variant_id, t.to_branch, i.qty, `TRF-${t.id}`, req.user.id);
    }
    db.prepare("UPDATE transfer SET status='accepted', accepted_by=?, accepted_at=datetime('now') WHERE id=?").run(
      req.user.id,
      t.id
    );
  });
  run();
  res.json({ ok: true });
});
