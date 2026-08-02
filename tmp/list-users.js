const Database = require('better-sqlite3');
const path = require('path');
const dbFile = path.join(__dirname, '..', 'server', 'data', 'sandy.db');
const db = new Database(dbFile, { readonly: true });
const rows = db.prepare('SELECT id, name, username, pin, role, branch_id, active FROM user').all();
console.log(rows);
