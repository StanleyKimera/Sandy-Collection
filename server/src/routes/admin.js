import { Router } from 'express';
import { db, logAudit } from '../db.js';
import { authRequired, requireRole, hashPin } from '../auth.js';

export const admin = Router();
admin.use(authRequired);

admin.get('/users', requireRole('owner', 'manager'), (req, res) => {
  const rows =
    req.user.role === 'owner'
      ? db.prepare('SELECT id,name,username,role,branch_id,active FROM user WHERE deleted_at IS NULL ORDER BY branch_id, id').all()
      : db
          .prepare('SELECT id,name,username,role,branch_id,active FROM user WHERE branch_id = ? AND deleted_at IS NULL')
          .all(req.user.branch_id);
  res.json(rows);
});

admin.get('/users/history', requireRole('owner'), (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id,u.name,u.username,u.role,u.branch_id,u.active,u.deleted_at,u.deleted_by,d.name AS deleted_by_name,b.name AS branch_name
       FROM user u
       LEFT JOIN user d ON d.id = u.deleted_by
       LEFT JOIN branch b ON b.id = u.branch_id
       WHERE u.deleted_at IS NOT NULL
       ORDER BY u.deleted_at DESC`
    )
    .all();
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

admin.patch('/users/:id/activate', requireRole('owner'), (req, res) => {
  const userId = Number(req.params.id);
  const user = db.prepare('SELECT * FROM user WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE user SET active = 1, deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(userId);
  logAudit(req.user.id, req.user.branch_id, 'user.activate', `${user.username}`);
  res.json({ ok: true });
});

admin.delete('/users/:id', requireRole('owner'), (req, res) => {
  const userId = Number(req.params.id);
  const user = db.prepare('SELECT * FROM user WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'owner') {
    return res.status(403).json({ error: 'Cannot delete an owner account' });
  }
  db.prepare("UPDATE user SET active = 0, deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").run(
    req.user.id,
    userId
  );
  logAudit(req.user.id, req.user.branch_id, 'user.delete', `${user.username}`);
  res.json({ ok: true });
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
