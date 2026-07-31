import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { verifyPin, signToken, authRequired } from './auth.js';
import { catalog } from './routes/catalog.js';
import { sales } from './routes/sales.js';
import { stock } from './routes/stock.js';
import { reports } from './routes/reports.js';
import { admin } from './routes/admin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/login', (req, res) => {
  const { username, pin } = req.body;
  const user = db.prepare('SELECT * FROM user WHERE username = ? AND active = 1').get(username);
  if (!user || !verifyPin(pin, user.pin)) {
    return res.status(401).json({ error: 'Wrong username or PIN' });
  }
  const branch = user.branch_id
    ? db.prepare('SELECT * FROM branch WHERE id = ?').get(user.branch_id)
    : null;
  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, role: user.role, branch_id: user.branch_id },
    branch
  });
});

app.get('/api/me', authRequired, (req, res) => {
  const branch = req.user.branch_id
    ? db.prepare('SELECT * FROM branch WHERE id = ?').get(req.user.branch_id)
    : null;
  res.json({
    user: { id: req.user.id, name: req.user.name, role: req.user.role, branch_id: req.user.branch_id },
    branch
  });
});

app.use('/api', catalog);
app.use('/api', sales);
app.use('/api', stock);
app.use('/api', reports);
app.use('/api', admin);

// Serve the built shop front-end so the whole system runs from one process.
const webDist = path.join(here, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
}

const port = Number(process.env.PORT || 4000);
app.listen(port, '0.0.0.0', () => {
  console.log(`Sandy Collection server running on http://localhost:${port}`);
});
