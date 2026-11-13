// Creates the Jupiter_hotel database + tables (if they don't exist yet) every time the
// dev server starts. Runs database/schema.sql, which only uses CREATE ... IF NOT EXISTS
// and INSERT IGNORE, so existing data is never touched.
//
// Usage:  npm run dev        (runs automatically before Vite)
//         npm run db:init    (run on its own)
//
// Reads DB_* settings from .env. If MySQL is not reachable it only prints a warning,
// so the web app still starts.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import mysql from 'mysql2/promise';

if (existsSync('.env')) process.loadEnvFile('.env');

const cfg = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};
const dbName = process.env.DB_NAME || 'Jupiter_hotel';

const c = { ok: '\x1b[32m', warn: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' };
const tag = `${c.dim}[db]${c.off}`;

let conn;
try {
  let sql = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  // allow a different DB name from .env
  sql = sql.replaceAll('`Jupiter_hotel`', `\`${dbName.replace(/`/g, '')}\``);

  conn = await mysql.createConnection({ ...cfg, multipleStatements: true, connectTimeout: 5000 });
  await conn.query(sql);
  const [tables] = await conn.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
    [dbName]
  );
  console.log(`${tag} ${c.ok}✓${c.off} ${dbName} ready on ${cfg.host}:${cfg.port} — ${tables.length} tables: ${tables.map((r) => r.t).join(', ')}`);
} catch (e) {
  console.warn(`${tag} ${c.warn}⚠ could not set up ${dbName} on ${cfg.host}:${cfg.port}${c.off} — ${e.code || ''} ${e.message}`);
  console.warn(`${tag} ${c.dim}Check MySQL is running and the DB_* values in .env. The web app will still start.${c.off}`);
} finally {
  await conn?.end().catch(() => {});
}
