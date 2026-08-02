import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const SECRET = process.env.SANDY_JWT_SECRET || 'sandy-collection-dev-secret';

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPin(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, branch_id: user.branch_id, name: user.name },
    SECRET,
    { expiresIn: '12h' }
  );
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT * FROM user WHERE id = ? AND active = 1').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Account disabled' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, sign in again' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission for this', code: 'FORBIDDEN' });
    }
    next();
  };
}

/** Owners may act on any branch; everyone else is pinned to their own. */
export function branchFor(req, requested) {
  if (req.user.role === 'owner' && requested) return Number(requested);
  return req.user.branch_id;
}

export function canSeeBranch(req, branchId) {
  return req.user.role === 'owner' || Number(branchId) === req.user.branch_id;
}
