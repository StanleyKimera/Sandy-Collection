import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, requireRole, branchFor, canSeeBranch } from '../auth.js';

export const reports = Router();
reports.use(authRequired);

/** Owners may ask for every branch at once by passing branch_id=all. */
function scope(req) {
  if (req.user.role === 'owner' && req.query.branch_id === 'all') return { all: true };
  const branchId = branchFor(req, req.query.branch_id);
  return { all: false, branchId };
}

function range(req) {
  return {
    from: req.query.from || new Date().toISOString().slice(0, 10),
    to: req.query.to || new Date().toISOString().slice(0, 10)
  };
}

reports.get('/reports/summary', (req, res) => {
  const s = scope(req);
  if (!s.all && !canSeeBranch(req, s.branchId)) return res.status(403).json({ error: 'Wrong branch' });
  const { from, to } = range(req);
  const where = s.all ? '1=1' : 'sale.branch_id = @branch';
  const params = { from, to, branch: s.branchId };

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS sales_count,
              COALESCE(SUM(total),0) AS revenue,
              COALESCE(SUM(discount),0) AS discounts
         FROM sale
        WHERE ${where} AND status='completed' AND date(created_at) BETWEEN @from AND @to`
    )
    .get(params);

  const byPayment = db
    .prepare(
      `SELECT payment_method, COUNT(*) AS count, COALESCE(SUM(total),0) AS amount
         FROM sale
        WHERE ${where} AND status='completed' AND date(created_at) BETWEEN @from AND @to
     GROUP BY payment_method`
    )
    .all(params);

  const byBranch = db
    .prepare(
      `SELECT b.name AS branch, COUNT(*) AS count, COALESCE(SUM(sale.total),0) AS amount
         FROM sale JOIN branch b ON b.id = sale.branch_id
        WHERE ${where} AND status='completed' AND date(sale.created_at) BETWEEN @from AND @to
     GROUP BY b.name ORDER BY amount DESC`
    )
    .all(params);

  const byStaff = db
    .prepare(
      `SELECT u.name AS staff, COUNT(*) AS count, COALESCE(SUM(sale.total),0) AS amount
         FROM sale JOIN user u ON u.id = sale.user_id
        WHERE ${where} AND status='completed' AND date(sale.created_at) BETWEEN @from AND @to
     GROUP BY u.name ORDER BY amount DESC`
    )
    .all(params);

  const topItems = db
    .prepare(
      `SELECT p.name, v.size, v.colour, SUM(si.qty) AS qty, SUM(si.line_total) AS amount
         FROM sale_item si
         JOIN sale ON sale.id = si.sale_id
         JOIN variant v ON v.id = si.variant_id
         JOIN product p ON p.id = v.product_id
        WHERE ${where} AND sale.status='completed' AND date(sale.created_at) BETWEEN @from AND @to
     GROUP BY p.name, v.size, v.colour ORDER BY qty DESC LIMIT 10`
    )
    .all(params);

  const body = { from, to, totals, byPayment, byBranch, byStaff, topItems };

  if (req.user.role !== 'attendant') {
    const profit = db
      .prepare(
        `SELECT COALESCE(SUM(si.line_total),0) AS revenue,
                COALESCE(SUM(si.unit_cost * si.qty),0) AS cost
           FROM sale_item si JOIN sale ON sale.id = si.sale_id
          WHERE ${where} AND sale.status='completed' AND date(sale.created_at) BETWEEN @from AND @to`
      )
      .get(params);
    body.profit = { ...profit, gross_profit: profit.revenue - profit.cost };
  }
  res.json(body);
});

/** End-of-day cash-up sheet: what should be in the drawer. */
reports.get('/reports/cashup', (req, res) => {
  const branchId = branchFor(req, req.query.branch_id);
  if (!canSeeBranch(req, branchId)) return res.status(403).json({ error: 'Wrong branch' });
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT payment_method, COALESCE(SUM(total),0) AS amount, COUNT(*) AS count
         FROM sale
        WHERE branch_id = ? AND status='completed' AND date(created_at) = ?
     GROUP BY payment_method`
    )
    .all(branchId, date);
  const expectedCash = rows.find((r) => r.payment_method === 'cash')?.amount ?? 0;
  res.json({ date, rows, expected_cash: expectedCash });
});

reports.get('/reports/stock-valuation', requireRole('owner', 'manager'), (req, res) => {
  const branchId = branchFor(req, req.query.branch_id);
  const rows = db
    .prepare(
      `SELECT p.name, v.sku, v.size, v.colour, s.quantity,
              v.cost_price, v.selling_price,
              s.quantity * v.cost_price AS cost_value,
              s.quantity * v.selling_price AS retail_value
         FROM stock s JOIN variant v ON v.id = s.variant_id JOIN product p ON p.id = v.product_id
        WHERE s.branch_id = ? AND s.quantity > 0
     ORDER BY retail_value DESC`
    )
    .all(branchId);
  res.json({
    rows,
    cost_value: rows.reduce((a, r) => a + r.cost_value, 0),
    retail_value: rows.reduce((a, r) => a + r.retail_value, 0)
  });
});

reports.get('/reports/audit', requireRole('owner'), (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT a.*, u.name AS staff, b.name AS branch
           FROM audit_log a LEFT JOIN user u ON u.id = a.user_id LEFT JOIN branch b ON b.id = a.branch_id
       ORDER BY a.id DESC LIMIT 200`
      )
      .all()
  );
});
