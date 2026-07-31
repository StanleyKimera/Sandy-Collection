import { Router } from 'express';
import { db, logAudit } from '../db.js';
import { authRequired, requireRole, hashPin } from '../auth.js';

export const admin = Router();
admin.use(authRequired);

admin.get('/users', requireRole('owner', 'manager'), (req, res) => {
  const rows =
    req.user.role === 'owner'
      ? db.prepare('SELECT id,name,username,role,branch_id,active FROM user ORDER BY branch_id, id').all()
      : db
          .prepare('SELECT id,name,username,role,branch_id,active FROM user WHERE branch_id = ?')
          .all(req.user.branch_id);
  res.json(rows);
});

admin.post('/users', requireRole('owner'), (req, res) => {
  const { name, username, pin, role, branch_id } = req.body;
  if (!name || !username || !pin || !role) {
    return res.status(400).json({ error: 'Name, username, PIN and role are required' });
  }
  if (!/^\d{4,6}$/.test(String(pin))) {
    return res.status(400).json({ error: 'PIN must be 4 to 6 digits' });
  }
  try {
    const id = db
      .prepare('INSERT INTO user (name, username, pin, role, branch_id) VALUES (?,?,?,?,?)')
      .run(name, username, hashPin(pin), role, branch_id ?? null).lastInsertRowid;
    logAudit(req.user.id, req.user.branch_id, 'user.create', `${username} (${role})`);
    res.status(201).json({ id });
  } catch {
    res.status(400).json({ error: 'That username is already taken' });
  }
});

admin.patch('/branches/:id', requireRole('owner'), (req, res) => {
  const { allow_discount, max_discount_percent, name, address, phone } = req.body;
  const b = db.prepare('SELECT * FROM branch WHERE id = ?').get(req.params.id);
  if (!b) return res.status(404).json({ error: 'Branch not found' });
  db.prepare(
    `UPDATE branch SET name=?, address=?, phone=?, allow_discount=?, max_discount_percent=? WHERE id=?`
  ).run(
    name ?? b.name,
    address ?? b.address,
    phone ?? b.phone,
    allow_discount === undefined ? b.allow_discount : allow_discount ? 1 : 0,
    max_discount_percent ?? b.max_discount_percent,
    b.id
  );
  logAudit(req.user.id, b.id, 'branch.update', b.name);
  res.json({ ok: true });
});
