import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, 'data', 'sandy.db');
const db = new Database(dbFile, { readonly: true });
const rows = db.prepare('SELECT id, name, username, pin, role, branch_id, active FROM user').all();
console.log(rows);
