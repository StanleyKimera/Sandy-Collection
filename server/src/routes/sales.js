import { Router } from 'express';
import { db, logAudit } from '../db.js';
import { authRequired, requireRole, branchFor, canSeeBranch } from '../auth.js';

export const sales = Router();
sales.use(authRequired);

function receiptText(sale, items, branch) {
  const lines = items.map((i) => `${i.qty} x ${i.name} ${i.size ?? ''} ${i.colour ?? ''} = UGX ${i.line_total.toLocaleString()}`);
  return [
    'SANDY COLLECTION',
    branch.name,
    `Receipt #${sale.id}  ${sale.created_at}`,
    ...lines,
    sale.discount ? `Discount: -UGX ${sale.discount.toLocaleString()}` : null,
    `TOTAL: UGX ${sale.total.toLocaleString()}`,
    `Paid by ${sale.payment_method.replace('_', ' ')}`,
    'CUSTOMER is KING, King never Bargain!'
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Complete a sale. `client_uid` makes the call idempotent so a re-sent sale
 * from an offline device is never counted twice.
 */
sales.post('/sales', (req, res) => {
  const {
    client_uid,
    items,
    payment_method,
    amount_paid,
    discount = 0,
    discount_reason,
    customer_name,
    customer_phone,
    sms_receipt = false,
    branch_id
  } = req.body;

  if (!client_uid) return res.status(400).json({ error: 'client_uid is required' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'The cart is empty' });
  }
  if (!['cash', 'mobile_money', 'card'].includes(payment_method)) {
    return res.status(400).json({ error: 'Choose a payment method' });
  }

  const existing = db.prepare('SELECT id FROM sale WHERE client_uid = ?').get(client_uid);
  if (existing) return res.status(200).json({ id: existing.id, duplicate: true });

  const bId = branchFor(req, branch_id);
  const branch = db.prepare('SELECT * FROM branch WHERE id = ?').get(bId);
  if (!branch) return res.status(400).json({ error: 'Unknown branch' });

  const priced = [];
  for (const item of items) {
    const v = db
      .prepare(
        `SELECT v.*, p.name FROM variant v JOIN product p ON p.id = v.product_id WHERE v.id = ?`
      )
      .get(item.variant_id);
    if (!v) return res.status(400).json({ error: `Item ${item.variant_id} not found` });
    const stock = db
      .prepare('SELECT quantity FROM stock WHERE variant_id = ? AND branch_id = ?')
      .get(v.id, bId);
    const qty = Math.trunc(item.qty);
    if (qty <= 0) return res.status(400).json({ error: 'Quantity must be at least 1' });
    if (!stock || stock.quantity < qty) {
      return res
        .status(409)
        .json({ error: `Not enough stock for ${v.name} ${v.size ?? ''} (${stock?.quantity ?? 0} left)` });
    }
    priced.push({ ...v, qty, line_total: v.selling_price * qty });
  }

  const subtotal = priced.reduce((sum, i) => sum + i.line_total, 0);
  const requestedDiscount = Math.max(0, Math.round(discount));

  if (requestedDiscount > 0) {
    if (!branch.allow_discount) {
      return res
        .status(403)
        .json({ error: `${branch.name} does not allow discounts — King never Bargain!` });
    }
    const maxAllowed = Math.floor((subtotal * branch.max_discount_percent) / 100);
    if (requestedDiscount > maxAllowed) {
      return res.status(403).json({
        error: `Maximum discount at ${branch.name} is ${branch.max_discount_percent}% (UGX ${maxAllowed.toLocaleString()})`
      });
    }
    if (!discount_reason) return res.status(400).json({ error: 'A discount needs a reason' });
  }

  const total = subtotal - requestedDiscount;
  if (payment_method === 'cash' && Number(amount_paid || 0) < total) {
    return res.status(400).json({ error: 'Amount paid is less than the total' });
  }

  const commit = db.transaction(() => {
    const saleId = db
      .prepare(
        `INSERT INTO sale (client_uid, branch_id, user_id, customer_name, customer_phone,
                           subtotal, discount, discount_reason, total, payment_method,
                           amount_paid, sms_receipt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        client_uid,
        bId,
        req.user.id,
        customer_name ?? null,
        customer_phone ?? null,
        subtotal,
        requestedDiscount,
        discount_reason ?? null,
        total,
        payment_method,
        Math.round(amount_paid || total),
        sms_receipt && customer_phone ? 1 : 0
      ).lastInsertRowid;

    for (const i of priced) {
      db.prepare(
        `INSERT INTO sale_item (sale_id, variant_id, qty, unit_price, unit_cost, line_total)
         VALUES (?,?,?,?,?,?)`
      ).run(saleId, i.id, i.qty, i.selling_price, i.cost_price, i.line_total);
      db.prepare(
        'UPDATE stock SET quantity = quantity - ? WHERE variant_id = ? AND branch_id = ?'
      ).run(i.qty, i.id, bId);
      db.prepare(
        `INSERT INTO stock_movement (variant_id, branch_id, type, qty, ref, user_id)
         VALUES (?,?,'SALE',?,?,?)`
      ).run(i.id, bId, -i.qty, `SALE-${saleId}`, req.user.id);
    }

    if (requestedDiscount > 0) {
      logAudit(req.user.id, bId, 'sale.discount', `SALE-${saleId} UGX ${requestedDiscount}: ${discount_reason}`);
    }
    return saleId;
  });

  const saleId = commit();
  const sale = db.prepare('SELECT * FROM sale WHERE id = ?').get(saleId);
  const receipt = receiptText(sale, priced, branch);

  if (sale.sms_receipt) {
    db.prepare('INSERT INTO sms_outbox (sale_id, phone, message) VALUES (?,?,?)').run(
      saleId,
      sale.customer_phone,
      receipt
    );
  }

  res.status(201).json({
    id: saleId,
    total,
    change: payment_method === 'cash' ? Math.round(amount_paid || total) - total : 0,
    receipt
  });
});

sales.get('/sales', (req, res) => {
  const branchId = branchFor(req, req.query.branch_id);
  if (!canSeeBranch(req, branchId)) return res.status(403).json({ error: 'Wrong branch' });
  const rows = db
    .prepare(
      `SELECT s.*, u.name AS seller, b.name AS branch
         FROM sale s JOIN user u ON u.id = s.user_id JOIN branch b ON b.id = s.branch_id
        WHERE s.branch_id = ? AND date(s.created_at) = COALESCE(?, date('now'))
     ORDER BY s.id DESC`
    )
    .all(branchId, req.query.date || null);
  res.json(rows);
});

sales.post('/sales/:id/void', requireRole('owner', 'manager'), (req, res) => {
  const sale = db.prepare('SELECT * FROM sale WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (!canSeeBranch(req, sale.branch_id)) return res.status(403).json({ error: 'Wrong branch' });
  if (sale.status === 'voided') return res.status(400).json({ error: 'Already voided' });
  if (!req.body.reason) return res.status(400).json({ error: 'A void needs a reason' });

  const undo = db.transaction(() => {
    const items = db.prepare('SELECT * FROM sale_item WHERE sale_id = ?').all(sale.id);
    for (const i of items) {
      db.prepare(
        'UPDATE stock SET quantity = quantity + ? WHERE variant_id = ? AND branch_id = ?'
      ).run(i.qty, i.variant_id, sale.branch_id);
      db.prepare(
        `INSERT INTO stock_movement (variant_id, branch_id, type, qty, ref, reason, user_id)
         VALUES (?,?,'RETURN',?,?,?,?)`
      ).run(i.variant_id, sale.branch_id, i.qty, `VOID-${sale.id}`, req.body.reason, req.user.id);
    }
    db.prepare("UPDATE sale SET status = 'voided' WHERE id = ?").run(sale.id);
    logAudit(req.user.id, sale.branch_id, 'sale.void', `SALE-${sale.id}: ${req.body.reason}`);
  });
  undo();
  res.json({ ok: true });
});

sales.get('/sms-outbox', requireRole('owner', 'manager'), (req, res) => {
  res.json(db.prepare('SELECT * FROM sms_outbox ORDER BY id DESC LIMIT 50').all());
});
