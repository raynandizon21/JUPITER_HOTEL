// Jupiter Hotel PMS — Node backend.
// Serves the built frontend (dist/) and the /api the app saves its data to (MySQL).
// Env (from .env via `node --env-file`, PM2 env overrides): DB_*, API_PORT, CORS_ORIGIN.
import express from 'express';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const port = Number(process.env.API_PORT || 4020);
const SYSTEM_USER = 1; // seeded in schema.sql; used for BOOKED_BY / CREATED_BY until login exists

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'Jupiter_hotel',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // DATE → 'YYYY-MM-DD', no timezone shifts
  decimalNumbers: true, // DECIMAL → number
});

const VOUCHER_TABLES = [
  `CREATE TABLE IF NOT EXISTS \`holidays\` (
  \`IDNo\`          INT          NOT NULL AUTO_INCREMENT,
  \`HOLIDAY_DATE\`  DATE         NOT NULL,
  \`HOLIDAY_NAME\`  VARCHAR(150) NOT NULL,
  \`HOLIDAY_TYPE\`  ENUM('regular','special') NOT NULL DEFAULT 'regular' COMMENT 'regular holiday / special non-working day',
  \`ACTIVE\`        TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 = removed',
  \`CREATED_DT\`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`IDNo\`),
  UNIQUE KEY \`uq_holiday_date\` (\`HOLIDAY_DATE\`)
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`fund_transactions\` (
  \`IDNo\`         INT           NOT NULL AUTO_INCREMENT,
  \`APP_ID\`       VARCHAR(50)   NOT NULL COMMENT 'the app''s own id (key for saving)',
  \`FUND\`         ENUM('room','voucher') NOT NULL COMMENT 'room = room payments fund, voucher = voucher payments fund',
  \`TXN_TYPE\`     ENUM('out','opening') NOT NULL COMMENT 'out = cash out, opening = opening balance',
  \`TXN_DATE\`     DATE          NOT NULL,
  \`AMOUNT\`       DECIMAL(12,2) NOT NULL,
  \`METHOD\`       ENUM('Cash','Bank Transfer','GCash','Credit Card','Junket Account') NOT NULL DEFAULT 'Cash',
  \`PURPOSE\`      VARCHAR(30)   NOT NULL DEFAULT 'withdrawal' COMMENT 'withdrawal / expense / remit / other / opening',
  \`RELEASED_BY\`  VARCHAR(100)  NULL,
  \`RECEIVED_BY\`  VARCHAR(100)  NULL,
  \`REFERENCE\`    VARCHAR(100)  NULL,
  \`REMARKS\`      VARCHAR(500)  NULL,
  \`VOIDED\`       TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '1 = voided (kept for the record, not counted)',
  \`VOID_REASON\`  VARCHAR(300)  NULL,
  \`VOIDED_DT\`    DATETIME      NULL,
  \`CREATED_DT\`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`CREATED_BY\`   INT           NOT NULL,
  PRIMARY KEY (\`IDNo\`),
  UNIQUE KEY \`uq_fund_app_id\` (\`APP_ID\`),
  KEY \`idx_fund_date\` (\`TXN_DATE\`),
  CONSTRAINT \`chk_fund_amount\` CHECK (\`AMOUNT\` > 0),
  CONSTRAINT \`fk_fund_user\` FOREIGN KEY (\`CREATED_BY\`) REFERENCES \`users\` (\`IDNo\`)
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`hotel_purchases\` (
  \`IDNo\`           INT          NOT NULL AUTO_INCREMENT,
  \`APP_ID\`         VARCHAR(50)  NOT NULL COMMENT 'the app''s own id (key for saving)',
  \`PURCHASE_DATE\`  DATE         NOT NULL,
  \`REF_MONTH\`      CHAR(7)      AS (CONCAT(YEAR(\`PURCHASE_DATE\`), '-', LPAD(MONTH(\`PURCHASE_DATE\`), 2, '0'))) STORED COMMENT 'settlement month with the hotel',
  \`REFERENCE\`      VARCHAR(100) NULL COMMENT 'hotel invoice / reference no.',
  \`REMARKS\`        VARCHAR(500) NULL,
  \`ACTIVE\`         TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 = deleted',
  \`CREATED_DT\`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`CREATED_BY\`     INT          NOT NULL,
  \`EDITED_DT\`      DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`IDNo\`),
  UNIQUE KEY \`uq_hotel_purchases_app_id\` (\`APP_ID\`),
  KEY \`idx_hotel_purchases_month\` (\`REF_MONTH\`),
  CONSTRAINT \`fk_hotel_purchases_user\` FOREIGN KEY (\`CREATED_BY\`) REFERENCES \`users\` (\`IDNo\`)
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`hotel_purchase_items\` (
  \`IDNo\`         INT           NOT NULL AUTO_INCREMENT,
  \`PURCHASE_ID\`  INT           NOT NULL,
  \`ITEM_KIND\`    ENUM('room','voucher') NOT NULL,
  \`ITEM_CODE\`    VARCHAR(50)   NOT NULL COMMENT 'room_types.ROOM_CODE, or breakfast / dinner / extraBed',
  \`QTY\`          INT           NOT NULL COMMENT 'room-nights or vouchers',
  \`UNIT_COST\`    DECIMAL(12,2) NOT NULL COMMENT 'wholesale price per unit',
  \`AMOUNT\`       DECIMAL(12,2) AS (\`QTY\` * \`UNIT_COST\`) STORED,
  PRIMARY KEY (\`IDNo\`),
  KEY \`idx_purchase_items_purchase\` (\`PURCHASE_ID\`),
  CONSTRAINT \`chk_purchase_items_qty\` CHECK (\`QTY\` > 0),
  CONSTRAINT \`fk_purchase_items_purchase\` FOREIGN KEY (\`PURCHASE_ID\`) REFERENCES \`hotel_purchases\` (\`IDNo\`) ON DELETE CASCADE
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`agents\` (
  \`IDNo\`        INT          NOT NULL AUTO_INCREMENT,
  \`AGENT_NAME\`  VARCHAR(100) NOT NULL,
  \`ACTIVE\`      TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 = hidden from suggestions',
  \`CREATED_DT\`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`CREATED_BY\`  INT          NOT NULL,
  \`EDITED_DT\`   DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`IDNo\`),
  UNIQUE KEY \`uq_agents_name\` (\`AGENT_NAME\`),
  CONSTRAINT \`fk_agents_user\` FOREIGN KEY (\`CREATED_BY\`) REFERENCES \`users\` (\`IDNo\`)
) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`voucher_sales\` (
    \`IDNo\`        INT          NOT NULL AUTO_INCREMENT,
    \`APP_ID\`      VARCHAR(50)  NOT NULL COMMENT 'the app''s own id (key for saving)',
    \`SALE_DATE\`   DATE         NOT NULL,
    \`REF_MONTH\`   CHAR(7)      AS (CONCAT(YEAR(\`SALE_DATE\`), '-', LPAD(MONTH(\`SALE_DATE\`), 2, '0'))) STORED,
    \`GUEST_NAME\`  VARCHAR(150) NOT NULL,
    \`REMARKS\`     VARCHAR(500) NULL,
    \`ACTIVE\`      TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 = deleted',
    \`CREATED_DT\`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`CREATED_BY\`  INT          NOT NULL,
    \`EDITED_DT\`   DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`IDNo\`),
    UNIQUE KEY \`uq_voucher_sales_app_id\` (\`APP_ID\`),
    KEY \`idx_voucher_sales_month\` (\`REF_MONTH\`),
    CONSTRAINT \`fk_voucher_sales_user\` FOREIGN KEY (\`CREATED_BY\`) REFERENCES \`users\` (\`IDNo\`)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`voucher_sale_items\` (
    \`IDNo\`        INT           NOT NULL AUTO_INCREMENT,
    \`SALE_ID\`     INT           NOT NULL,
    \`CATEGORY\`    ENUM('breakfast','dinner','other') NOT NULL DEFAULT 'other',
    \`DESCRIPTION\` VARCHAR(200)  NOT NULL,
    \`QTY\`         INT           NOT NULL DEFAULT 1,
    \`UNIT_PRICE\`  DECIMAL(12,2) NOT NULL,
    \`AMOUNT\`      DECIMAL(12,2) AS (\`QTY\` * \`UNIT_PRICE\`) STORED,
    PRIMARY KEY (\`IDNo\`),
    KEY \`idx_voucher_items_sale\` (\`SALE_ID\`),
    CONSTRAINT \`chk_voucher_items_qty\` CHECK (\`QTY\` > 0),
    CONSTRAINT \`fk_voucher_items_sale\` FOREIGN KEY (\`SALE_ID\`) REFERENCES \`voucher_sales\` (\`IDNo\`) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS \`voucher_sale_payments\` (
    \`IDNo\`       INT           NOT NULL AUTO_INCREMENT,
    \`SALE_ID\`    INT           NOT NULL,
    \`PAY_DATE\`   DATE          NOT NULL,
    \`AMOUNT\`     DECIMAL(12,2) NOT NULL,
    \`METHOD\`     ENUM('Cash','Bank Transfer','GCash','Credit Card','Junket Account') NOT NULL DEFAULT 'Cash',
    \`REFERENCE\`  VARCHAR(100)  NULL,
    PRIMARY KEY (\`IDNo\`),
    KEY \`idx_voucher_payments_sale\` (\`SALE_ID\`),
    CONSTRAINT \`chk_voucher_payments_amount\` CHECK (\`AMOUNT\` > 0),
    CONSTRAINT \`fk_voucher_payments_sale\` FOREIGN KEY (\`SALE_ID\`) REFERENCES \`voucher_sales\` (\`IDNo\`) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
];

// Room types added later. Each copies the current rates of its base room (same price as single/double),
// and the list is re-numbered so they sit right under their base room. Only runs while one is missing.
const EXTRA_ROOMS = [
  ['guest_room_king', 'GUEST ROOM KING BED', 'guest_room'],
  ['guest_room_twin', 'GUEST ROOM TWIN BED', 'guest_room'],
  ['guest_room_king_pool_view', 'GUEST ROOM KING POOL VIEW', 'guest_room_pool_view'],
  ['guest_room_twin_pool_view', 'GUEST ROOM TWIN POOL VIEW', 'guest_room_pool_view'],
];
async function ensureRoomTypes() {
  // "COMPLIMENTARY ROOM" was replaced by per-night Free checkboxes — remove it unless a booking uses it.
  await pool.query(
    "DELETE FROM room_types WHERE ROOM_CODE = 'complimentary_room' AND IDNo NOT IN (SELECT ROOM_TYPE_ID FROM booking)"
  );
  const [have] = await pool.query('SELECT ROOM_CODE FROM room_types');
  const codes = new Set(have.map((r) => r.ROOM_CODE));
  const missing = EXTRA_ROOMS.filter(([code]) => !codes.has(code));
  if (!missing.length) return;
  for (const [code, name, base] of missing) {
    if (!base) {
      await pool.query(
        `INSERT IGNORE INTO room_types
           (ROOM_CODE, ROOM_NAME, WEEKDAY_RATE_SINGLE_DOUBLE, WEEKDAY_RATE_TRIPLE, WEEKEND_RATE_SINGLE_DOUBLE, WEEKEND_RATE_TRIPLE, SORT_ORDER)
         VALUES (?, ?, 0, 0, 0, 0, 999)`,
        [code, name]
      );
      continue;
    }
    await pool.query(
      `INSERT IGNORE INTO room_types
         (ROOM_CODE, ROOM_NAME, WEEKDAY_RATE_SINGLE_DOUBLE, WEEKDAY_RATE_TRIPLE, WEEKEND_RATE_SINGLE_DOUBLE, WEEKEND_RATE_TRIPLE, SORT_ORDER)
       SELECT ?, ?, WEEKDAY_RATE_SINGLE_DOUBLE, WEEKDAY_RATE_TRIPLE, WEEKEND_RATE_SINGLE_DOUBLE, WEEKEND_RATE_TRIPLE, SORT_ORDER
         FROM room_types WHERE ROOM_CODE = ?`,
      [code, name, base]
    );
  }
  // order: each base room, then its king / twin variants, then the rest as before
  const [rows] = await pool.query('SELECT IDNo, ROOM_CODE FROM room_types ORDER BY SORT_ORDER, IDNo');
  const after = new Map(EXTRA_ROOMS.filter(([, , base]) => base).map(([code, , base]) => [code, base]));
  const ordered = [];
  for (const r of rows) {
    if (after.has(r.ROOM_CODE)) continue;
    ordered.push(r);
    for (const x of rows) if (after.get(x.ROOM_CODE) === r.ROOM_CODE) ordered.push(x);
  }
  for (const [i, r] of ordered.entries()) await pool.query('UPDATE room_types SET SORT_ORDER = ? WHERE IDNo = ?', [i + 1, r.IDNo]);
  console.log(`Added room types: ${missing.map((m) => m[1]).join(', ')}`);
}

// Columns added after the first schema release. CREATE TABLE IF NOT EXISTS won't add them
// to an existing table, so add them here when missing.
async function ensureColumns() {
  // Tables added after the first schema release (same DDL as database/schema.sql).
  for (const ddl of VOUCHER_TABLES) await pool.query(ddl);
  await ensureRoomTypes();
  // Philippine holidays 2026–2027 — INSERT IGNORE keeps any date staff already added or changed
  await pool.query(`INSERT IGNORE INTO holidays (HOLIDAY_DATE, HOLIDAY_NAME, HOLIDAY_TYPE) VALUES
  ('2026-01-01', 'New Year''s Day', 'regular'),
  ('2026-02-17', 'Chinese New Year', 'special'),
  ('2026-04-02', 'Maundy Thursday', 'regular'),
  ('2026-04-03', 'Good Friday', 'regular'),
  ('2026-04-04', 'Black Saturday', 'special'),
  ('2026-04-09', 'Araw ng Kagitingan', 'regular'),
  ('2026-05-01', 'Labor Day', 'regular'),
  ('2026-06-12', 'Independence Day', 'regular'),
  ('2026-08-21', 'Ninoy Aquino Day', 'special'),
  ('2026-08-31', 'National Heroes Day', 'regular'),
  ('2026-11-01', 'All Saints'' Day', 'special'),
  ('2026-11-02', 'All Souls'' Day', 'special'),
  ('2026-11-30', 'Bonifacio Day', 'regular'),
  ('2026-12-08', 'Feast of the Immaculate Conception', 'special'),
  ('2026-12-24', 'Christmas Eve', 'special'),
  ('2026-12-25', 'Christmas Day', 'regular'),
  ('2026-12-30', 'Rizal Day', 'regular'),
  ('2026-12-31', 'Last Day of the Year', 'special'),
  ('2027-01-01', 'New Year''s Day', 'regular'),
  ('2027-02-06', 'Chinese New Year', 'special'),
  ('2027-03-25', 'Maundy Thursday', 'regular'),
  ('2027-03-26', 'Good Friday', 'regular'),
  ('2027-03-27', 'Black Saturday', 'special'),
  ('2027-04-09', 'Araw ng Kagitingan', 'regular'),
  ('2027-05-01', 'Labor Day', 'regular'),
  ('2027-06-12', 'Independence Day', 'regular'),
  ('2027-08-21', 'Ninoy Aquino Day', 'special'),
  ('2027-08-30', 'National Heroes Day', 'regular'),
  ('2027-11-01', 'All Saints'' Day', 'special'),
  ('2027-11-02', 'All Souls'' Day', 'special'),
  ('2027-11-30', 'Bonifacio Day', 'regular'),
  ('2027-12-08', 'Feast of the Immaculate Conception', 'special'),
  ('2027-12-24', 'Christmas Eve', 'special'),
  ('2027-12-25', 'Christmas Day', 'regular'),
  ('2027-12-30', 'Rizal Day', 'regular'),
  ('2027-12-31', 'Last Day of the Year', 'special')`);

  const wanted = [
    ['booking', 'CURRENCY', "ENUM('PHP','KRW') NOT NULL DEFAULT 'PHP' AFTER `ROOM_AMOUNT`"],
    ['booking', 'IS_JUPITER_GUEST', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER `REMARKS`'],
    ['booking', 'AGENT_ID', "INT NULL COMMENT 'agents.IDNo' AFTER `GUEST_NAME`"],
    ['voucher_sales', 'AGENT_ID', "INT NULL COMMENT 'agents.IDNo' AFTER `GUEST_NAME`"],
    ['booking', 'COMP_DATES', "JSON NULL COMMENT 'complimentary (free) nights' AFTER `HOLIDAY_DATES`"],
    ['booking_charges', 'IS_FREE', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = complimentary, charged 0' AFTER `UNIT_PRICE`"],
    ['voucher_sale_items', 'IS_FREE', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = complimentary, charged 0' AFTER `UNIT_PRICE`"],
    ['booking_payments', 'RECORDED_AT', "DATETIME NULL COMMENT 'when the payment was first recorded (kept when the list is re-saved)' AFTER `REFERENCE`"],
    ['hotel_payments', 'FUND', "ENUM('room','voucher') NOT NULL DEFAULT 'room' COMMENT 'fund it was paid from' AFTER `METHOD`"],
    ['hotel_payments', 'RECORDED_AT', "DATETIME NULL COMMENT 'when the payment was first recorded (kept when the list is re-saved)' AFTER `REMARKS`"],
    ['voucher_sale_payments', 'RECORDED_AT', "DATETIME NULL COMMENT 'when the payment was first recorded (kept when the list is re-saved)' AFTER `REFERENCE`"],
  ];
  for (const [table, col, def] of wanted) {
    const [rows] = await pool.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [table, col]
    );
    if (!rows.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
  }
  // payments saved before RECORDED_AT existed: best guess = when the row was written
  await pool.query('UPDATE booking_payments SET RECORDED_AT = CREATED_DT WHERE RECORDED_AT IS NULL');
  await pool.query('UPDATE hotel_payments SET RECORDED_AT = CREATED_DT WHERE RECORDED_AT IS NULL');
  await pool.query(
    'UPDATE voucher_sale_payments p JOIN voucher_sales v ON v.IDNo = p.SALE_ID SET p.RECORDED_AT = v.CREATED_DT WHERE p.RECORDED_AT IS NULL'
  );

  // APP_ID = the app's own booking id (key for saving). CONFIRM_NUM = the hotel's confirmation
  // number, typed in by staff, optional but unique. Older rows stored the app id in CONFIRM_NUM:
  // move it to APP_ID and clear CONFIRM_NUM.
  const [appId] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'booking' AND COLUMN_NAME = 'APP_ID'"
  );
  if (!appId.length) {
    await pool.query("ALTER TABLE `booking` ADD COLUMN `APP_ID` VARCHAR(50) NULL AFTER `IDNo`");
    await pool.query('UPDATE `booking` SET `APP_ID` = `CONFIRM_NUM` WHERE `APP_ID` IS NULL');
    await pool.query('ALTER TABLE `booking` MODIFY `APP_ID` VARCHAR(50) NOT NULL, ADD UNIQUE KEY `uq_booking_app_id` (`APP_ID`)');
    await pool.query("ALTER TABLE `booking` MODIFY `CONFIRM_NUM` VARCHAR(50) NULL COMMENT 'hotel confirmation number (unique)'");
    await pool.query('UPDATE `booking` SET `CONFIRM_NUM` = NULL WHERE `CONFIRM_NUM` = `APP_ID`');
  }
}

/**
 * Payment lists are replaced as a whole on every save (DELETE + INSERT), so the time a payment
 * was recorded would be lost. Read the old times first; each payment keeps the time the app sent
 * (recordedAt), else the time of the same old payment (date + amount + method + reference),
 * else now.
 */
async function paymentTimes(conn, table, where, params) {
  const [[{ now }]] = await conn.query('SELECT NOW() AS now');
  const [old] = await conn.query(`SELECT PAY_DATE, AMOUNT, METHOD, REFERENCE, RECORDED_AT FROM \`${table}\` WHERE ${where} ORDER BY IDNo`, params);
  const key = (d, a, m, r) => `${String(d).slice(0, 10)}|${Number(a)}|${m}|${r || ''}`;
  const left = new Map();
  for (const o of old) {
    if (!o.RECORDED_AT) continue;
    const k = key(o.PAY_DATE, o.AMOUNT, o.METHOD, o.REFERENCE);
    if (!left.has(k)) left.set(k, []);
    left.get(k).push(o.RECORDED_AT);
  }
  const valid = (t) => typeof t === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(t);
  return (p, date, method) => {
    if (valid(p.recordedAt)) return p.recordedAt.replace('T', ' ');
    const list = left.get(key(date, p.amount, method, p.reference ? String(p.reference).slice(0, 100) : null));
    return (list && list.shift()) || now;
  };
}

const app = express();
app.use(express.json({ limit: '5mb' }));

// Log every change (who/what/when) to the PM2 log, so lost or deleted data can be traced.
app.use('/api', (req, _res, next) => {
  if (req.method !== 'GET' && req.method !== 'OPTIONS') {
    const who = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const extra = req.body && req.body.guestName ? ` guest="${req.body.guestName}"` : '';
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}${extra} from ${who} ${req.headers['user-agent'] || ''}`);
  }
  next();
});

const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Wraps an async route: errors become a JSON 500 instead of crashing the process.
const route = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Confirmation number is already used by another booking' });
    console.error(req.method, req.originalUrl, err);
    res.status(500).json({ error: err.sqlMessage || err.message });
  }
};

async function inTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

const parseJson = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------- health
app.get(
  '/api/health',
  route(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  })
);

// ---------------------------------------------------------------- load everything
app.get(
  '/api/state',
  route(async (_req, res) => {
    const [rooms] = await pool.query('SELECT * FROM room_types WHERE ACTIVE = 1 ORDER BY SORT_ORDER, IDNo');
    const [addons] = await pool.query('SELECT ADDON_CODE, PRICE FROM addon_rates');
    const [bookings] = await pool.query(
      `SELECT b.*, rt.ROOM_NAME, a.AGENT_NAME FROM booking b JOIN room_types rt ON rt.IDNo = b.ROOM_TYPE_ID
       LEFT JOIN agents a ON a.IDNo = b.AGENT_ID
       WHERE b.ACTIVE = 1 ORDER BY b.BOOKING_DATE DESC, b.IDNo DESC`
    );
    const [charges] = await pool.query(
      'SELECT c.* FROM booking_charges c JOIN booking b ON b.IDNo = c.BOOKING_ID WHERE b.ACTIVE = 1 ORDER BY c.IDNo'
    );
    const [payments] = await pool.query(
      'SELECT p.* FROM booking_payments p JOIN booking b ON b.IDNo = p.BOOKING_ID WHERE b.ACTIVE = 1 ORDER BY p.IDNo'
    );
    const [hotelPays] = await pool.query('SELECT * FROM hotel_payments ORDER BY SETTLE_MONTH, PAY_DATE, IDNo');
    const [vSales] = await pool.query(
      `SELECT v.*, a.AGENT_NAME FROM voucher_sales v LEFT JOIN agents a ON a.IDNo = v.AGENT_ID
       WHERE v.ACTIVE = 1 ORDER BY v.SALE_DATE DESC, v.IDNo DESC`
    );
    const [vItems] = await pool.query(
      'SELECT i.* FROM voucher_sale_items i JOIN voucher_sales v ON v.IDNo = i.SALE_ID WHERE v.ACTIVE = 1 ORDER BY i.IDNo'
    );
    const [vPays] = await pool.query(
      'SELECT p.* FROM voucher_sale_payments p JOIN voucher_sales v ON v.IDNo = p.SALE_ID WHERE v.ACTIVE = 1 ORDER BY p.IDNo'
    );

    const vouchers = { breakfast: 0, dinner: 0, extraBed: 0 };
    for (const a of addons) vouchers[a.ADDON_CODE] = a.PRICE;
    const rates = {
      rooms: rooms.map((r) => ({
        id: r.ROOM_CODE,
        name: r.ROOM_NAME,
        singleDoubleWeekday: r.WEEKDAY_RATE_SINGLE_DOUBLE,
        tripleWeekday: r.WEEKDAY_RATE_TRIPLE,
        singleDoubleWeekend: r.WEEKEND_RATE_SINGLE_DOUBLE,
        tripleWeekend: r.WEEKEND_RATE_TRIPLE,
      })),
      vouchers,
    };

    const byBooking = (rows) => {
      const m = new Map();
      for (const row of rows) {
        if (!m.has(row.BOOKING_ID)) m.set(row.BOOKING_ID, []);
        m.get(row.BOOKING_ID).push(row);
      }
      return m;
    };
    const chargeMap = byBooking(charges);
    const payMap = byBooking(payments);

    const reservations = bookings.map((b) => ({
      id: b.APP_ID,
      confirmationNo: b.CONFIRM_NUM || '',
      guestName: b.GUEST_NAME,
      agentName: b.AGENT_NAME || '',
      roomType: b.ROOM_NAME,
      checkIn: b.CHECK_IN,
      checkOut: b.CHECK_OUT,
      nights: b.NIGHTS,
      amount: b.ROOM_AMOUNT,
      currency: b.CURRENCY || 'PHP',
      referenceMonth: b.REF_MONTH,
      remarks: b.REMARKS || '',
      occupancy: b.OCCUPANCY,
      isJupiterGuest: !!b.IS_JUPITER_GUEST,
      holidayDates: parseJson(b.HOLIDAY_DATES, []),
      compDates: parseJson(b.COMP_DATES, []),
      charges: (chargeMap.get(b.IDNo) || []).map((c) => ({
        id: `c${c.IDNo}`,
        date: c.CHARGE_DATE,
        description: c.DESCRIPTION,
        qty: c.QTY,
        unitPrice: c.UNIT_PRICE,
        category: c.CATEGORY,
        free: !!c.IS_FREE,
      })),
      payments: (payMap.get(b.IDNo) || []).map((p) => ({
        id: `p${p.IDNo}`,
        date: p.PAY_DATE,
        amount: p.AMOUNT,
        method: p.METHOD,
        reference: p.REFERENCE || '',
        recordedAt: p.RECORDED_AT || '',
      })),
    }));

    const months = new Map();
    for (const p of hotelPays) {
      if (!months.has(p.SETTLE_MONTH)) months.set(p.SETTLE_MONTH, []);
      months.get(p.SETTLE_MONTH).push({
        id: `h${p.IDNo}`,
        date: p.PAY_DATE,
        amount: p.AMOUNT,
        method: p.METHOD,
        reference: p.REFERENCE || '',
        oic: p.OIC || '',
        remarks: p.REMARKS || '',
        recordedAt: p.RECORDED_AT || '',
        fund: p.FUND === 'voucher' ? 'voucher' : 'room',
      });
    }
    const settlements = [...months].map(([month, payments]) => ({ month, payments }));

    const group = (rows) => {
      const m = new Map();
      for (const row of rows) {
        if (!m.has(row.SALE_ID)) m.set(row.SALE_ID, []);
        m.get(row.SALE_ID).push(row);
      }
      return m;
    };
    const itemMap = group(vItems);
    const vPayMap = group(vPays);
    const voucherSales = vSales.map((v) => ({
      id: v.APP_ID,
      date: v.SALE_DATE,
      guestName: v.GUEST_NAME,
      agentName: v.AGENT_NAME || '',
      remarks: v.REMARKS || '',
      items: (itemMap.get(v.IDNo) || []).map((c) => ({
        id: `vi${c.IDNo}`,
        date: v.SALE_DATE,
        description: c.DESCRIPTION,
        qty: c.QTY,
        unitPrice: c.UNIT_PRICE,
        category: c.CATEGORY,
        free: !!c.IS_FREE,
      })),
      payments: (vPayMap.get(v.IDNo) || []).map((p) => ({
        id: `vp${p.IDNo}`,
        date: p.PAY_DATE,
        amount: p.AMOUNT,
        method: p.METHOD,
        reference: p.REFERENCE || '',
        recordedAt: p.RECORDED_AT || '',
      })),
    }));

    const [pRows] = await pool.query('SELECT * FROM hotel_purchases WHERE ACTIVE = 1 ORDER BY PURCHASE_DATE, IDNo');
    const [piRows] = await pool.query(
      'SELECT i.* FROM hotel_purchase_items i JOIN hotel_purchases p ON p.IDNo = i.PURCHASE_ID WHERE p.ACTIVE = 1 ORDER BY i.IDNo'
    );
    const purchases = pRows.map((p) => ({
      id: p.APP_ID,
      date: p.PURCHASE_DATE,
      reference: p.REFERENCE || '',
      remarks: p.REMARKS || '',
      items: piRows
        .filter((i) => i.PURCHASE_ID === p.IDNo)
        .map((i) => ({ id: `pi${i.IDNo}`, kind: i.ITEM_KIND, item: i.ITEM_CODE, qty: i.QTY, unitCost: i.UNIT_COST })),
    }));

    const [fundRows] = await pool.query('SELECT * FROM fund_transactions ORDER BY TXN_DATE, IDNo');
    const fundTransactions = fundRows.map((f) => ({
      id: f.APP_ID,
      fund: f.FUND,
      type: f.TXN_TYPE,
      date: f.TXN_DATE,
      amount: f.AMOUNT,
      method: f.METHOD,
      purpose: f.PURPOSE,
      releasedBy: f.RELEASED_BY || '',
      receivedBy: f.RECEIVED_BY || '',
      createdAt: f.CREATED_DT || '',
      reference: f.REFERENCE || '',
      remarks: f.REMARKS || '',
      voided: !!f.VOIDED,
      voidReason: f.VOID_REASON || '',
    }));

    const [hol] = await pool.query('SELECT HOLIDAY_DATE, HOLIDAY_NAME, HOLIDAY_TYPE, ACTIVE FROM holidays ORDER BY HOLIDAY_DATE');
    const holidays = hol.map((h) => ({ date: h.HOLIDAY_DATE, name: h.HOLIDAY_NAME, type: h.HOLIDAY_TYPE, active: !!h.ACTIVE }));

    res.json({ rates, reservations, settlements, voucherSales, agents: await listAgents(), fundTransactions, holidays, purchases });
  })
);

// ---------------------------------------------------------------- agents (file maintenance)
async function listAgents() {
  const [rows] = await pool.query(
    `SELECT a.IDNo, a.AGENT_NAME, a.ACTIVE, a.CREATED_DT,
            (SELECT COUNT(*) FROM booking b WHERE b.AGENT_ID = a.IDNo AND b.ACTIVE = 1) AS BOOKINGS,
            (SELECT COUNT(*) FROM voucher_sales v WHERE v.AGENT_ID = a.IDNo AND v.ACTIVE = 1) AS VOUCHERS,
            GREATEST(
              COALESCE((SELECT MAX(b.CHECK_IN) FROM booking b WHERE b.AGENT_ID = a.IDNo AND b.ACTIVE = 1), '1000-01-01'),
              COALESCE((SELECT MAX(v.SALE_DATE) FROM voucher_sales v WHERE v.AGENT_ID = a.IDNo AND v.ACTIVE = 1), '1000-01-01')
            ) AS LAST_DATE
       FROM agents a ORDER BY a.AGENT_NAME`
  );
  return rows.map((a) => ({
    id: a.IDNo,
    name: a.AGENT_NAME,
    active: !!a.ACTIVE,
    bookings: Number(a.BOOKINGS),
    vouchers: Number(a.VOUCHERS),
    lastDate: a.LAST_DATE && !String(a.LAST_DATE).startsWith('1000') ? String(a.LAST_DATE).slice(0, 10) : '',
    createdAt: String(a.CREATED_DT || '').slice(0, 10),
  }));
}

// Finds the agent by name (case-insensitive) or creates it; re-activates a hidden one. '' → null.
async function agentId(conn, name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!n) return null;
  const [ins] = await conn.query(
    'INSERT INTO agents (AGENT_NAME, CREATED_BY) VALUES (?, ?) ON DUPLICATE KEY UPDATE ACTIVE = 1, IDNo = LAST_INSERT_ID(IDNo)',
    [n, SYSTEM_USER]
  );
  return ins.insertId;
}

app.get(
  '/api/agents',
  route(async (_req, res) => res.json(await listAgents()))
);

app.post(
  '/api/agents',
  route(async (req, res) => {
    const id = await agentId(pool, req.body && req.body.name);
    if (!id) return res.status(400).json({ error: 'name is required' });
    res.json(await listAgents());
  })
);

// Rename and/or show-hide an agent. Renaming to a name that already exists is refused (409).
app.put(
  '/api/agents/:id',
  route(async (req, res) => {
    const id = Number(req.params.id);
    const { name, active } = req.body || {};
    if (name != null) {
      const n = String(name).trim().replace(/\s+/g, ' ').slice(0, 100);
      if (!n) return res.status(400).json({ error: 'name is required' });
      const [dup] = await pool.query('SELECT IDNo FROM agents WHERE AGENT_NAME = ? AND IDNo <> ?', [n, id]);
      if (dup.length) return res.status(409).json({ error: `Agent "${n}" already exists` });
      await pool.query('UPDATE agents SET AGENT_NAME = ? WHERE IDNo = ?', [n, id]);
    }
    if (active != null) await pool.query('UPDATE agents SET ACTIVE = ? WHERE IDNo = ?', [active ? 1 : 0, id]);
    res.json(await listAgents());
  })
);

// ---------------------------------------------------------------- bookings
async function roomTypeId(conn, name) {
  const [rows] = await conn.query('SELECT IDNo FROM room_types WHERE UPPER(ROOM_NAME) = UPPER(?) LIMIT 1', [name]);
  if (rows.length) return rows[0].IDNo;
  const [rows2] = await conn.query('SELECT IDNo FROM room_types ORDER BY SORT_ORDER, IDNo LIMIT 1');
  if (!rows2.length) throw new Error('No room types in the database');
  return rows2[0].IDNo;
}

// Create or update one booking (by its app id = APP_ID) with its charges and payments.
app.put(
  '/api/reservations/:id',
  route(async (req, res) => {
    const r = req.body || {};
    const id = String(req.params.id).slice(0, 50);
    if (!r.guestName || !r.checkIn || !r.checkOut) return res.status(400).json({ error: 'guestName, checkIn and checkOut are required' });

    const confirmNo = String(r.confirmationNo || '').trim().slice(0, 50) || null;

    await inTransaction(async (conn) => {
      // Hotel confirmation number: 1 number = 1 booking (deleted bookings keep theirs too).
      if (confirmNo) {
        const [used] = await conn.query(
          'SELECT GUEST_NAME, ACTIVE FROM booking WHERE CONFIRM_NUM = ? AND APP_ID <> ? LIMIT 1',
          [confirmNo, id]
        );
        if (used.length) {
          const e = new Error(
            `Confirmation no. ${confirmNo} is already used by ${used[0].GUEST_NAME}${used[0].ACTIVE ? '' : ' (deleted booking)'}`
          );
          e.status = 409;
          throw e;
        }
      }
      const roomId = await roomTypeId(conn, r.roomType || '');
      const agent = await agentId(conn, r.agentName); // new names are added to the agents list
      const vals = [
        confirmNo,
        String(r.guestName).slice(0, 150),
        agent,
        roomId,
        r.occupancy === 'triple' ? 'triple' : 'singleDouble',
        JSON.stringify(Array.isArray(r.holidayDates) ? r.holidayDates : []),
        JSON.stringify(Array.isArray(r.compDates) ? r.compDates : []),
        r.checkIn,
        r.checkOut,
        Number(r.amount) || 0,
        r.currency === 'KRW' ? 'KRW' : 'PHP',
        r.remarks ? String(r.remarks).slice(0, 500) : null,
        r.isJupiterGuest === false ? 0 : 1,
      ];
      // Explicit update-or-insert by APP_ID (not ON DUPLICATE KEY: CONFIRM_NUM is unique too,
      // and a clash there must be an error, never an update of another booking).
      const [found] = await conn.query('SELECT IDNo FROM booking WHERE APP_ID = ?', [id]);
      let bookingId;
      if (found.length) {
        bookingId = found[0].IDNo;
        await conn.query(
          `UPDATE booking SET CONFIRM_NUM = ?, GUEST_NAME = ?, AGENT_ID = ?, ROOM_TYPE_ID = ?, OCCUPANCY = ?, HOLIDAY_DATES = ?, COMP_DATES = ?, CHECK_IN = ?,
             CHECK_OUT = ?, ROOM_AMOUNT = ?, CURRENCY = ?, REMARKS = ?, IS_JUPITER_GUEST = ?, ACTIVE = 1, EDITED_BY = ?
           WHERE IDNo = ?`,
          [...vals, SYSTEM_USER, bookingId]
        );
      } else {
        const [ins] = await conn.query(
          `INSERT INTO booking
             (CONFIRM_NUM, GUEST_NAME, AGENT_ID, ROOM_TYPE_ID, OCCUPANCY, HOLIDAY_DATES, COMP_DATES, CHECK_IN, CHECK_OUT, ROOM_AMOUNT, CURRENCY, REMARKS, IS_JUPITER_GUEST, APP_ID, BOOKED_BY)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...vals, id, SYSTEM_USER]
        );
        bookingId = ins.insertId;
      }

      // Charges and payments are replaced as a whole (the app always sends the full lists).
      const timeOf = await paymentTimes(conn, 'booking_payments', 'BOOKING_ID = ?', [bookingId]);
      await conn.query('DELETE FROM booking_charges WHERE BOOKING_ID = ?', [bookingId]);
      await conn.query('DELETE FROM booking_payments WHERE BOOKING_ID = ?', [bookingId]);
      const charges = (r.charges || []).filter((c) => Number(c.qty) > 0);
      if (charges.length) {
        await conn.query(
          'INSERT INTO booking_charges (BOOKING_ID, CHARGE_DATE, CATEGORY, DESCRIPTION, QTY, UNIT_PRICE, IS_FREE, CREATED_BY) VALUES ?',
          [
            charges.map((c) => [
              bookingId,
              c.date || r.checkIn,
              ['buffet', 'extraBed'].includes(c.category) ? c.category : 'other',
              String(c.description || '').slice(0, 200),
              Math.round(Number(c.qty)),
              Math.max(0, Number(c.unitPrice) || 0),
              c.free ? 1 : 0,
              SYSTEM_USER,
            ]),
          ]
        );
      }
      const payments = (r.payments || []).filter((p) => Number(p.amount) > 0);
      if (payments.length) {
        const methods = ['Cash', 'Bank Transfer', 'GCash', 'Credit Card', 'Junket Account'];
        await conn.query(
          'INSERT INTO booking_payments (BOOKING_ID, PAY_DATE, AMOUNT, METHOD, REFERENCE, RECORDED_AT, CREATED_BY) VALUES ?',
          [
            payments.map((p) => {
              const date = p.date || r.checkIn;
              const method = methods.includes(p.method) ? p.method : 'Cash';
              return [bookingId, date, Number(p.amount), method, p.reference ? String(p.reference).slice(0, 100) : null, timeOf(p, date, method), SYSTEM_USER];
            }),
          ]
        );
      }
    });
    res.json({ ok: true });
  })
);

// Delete = soft delete (ACTIVE = 0), so nothing is lost by mistake.
app.delete(
  '/api/reservations/:id',
  route(async (req, res) => {
    await pool.query('UPDATE booking SET ACTIVE = 0, EDITED_BY = ? WHERE APP_ID = ?', [SYSTEM_USER, req.params.id]);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- clear all data
// Sidebar "Clear data": deletes every booking, voucher purchase, payment to the hotel and fund
// entry for good (charges / payments go with their booking or purchase — ON DELETE CASCADE).
// Room rates, room types, add-on prices, agents, holidays and users are kept.
app.post(
  '/api/clear-data',
  route(async (req, res) => {
    if (!req.body || req.body.confirm !== 'DELETE') return res.status(400).json({ error: 'send { "confirm": "DELETE" }' });
    const deleted = {};
    await inTransaction(async (conn) => {
      for (const table of ['booking_charges', 'booking_payments', 'booking', 'voucher_sale_items', 'voucher_sale_payments', 'voucher_sales', 'hotel_payments', 'fund_transactions', 'hotel_purchase_items', 'hotel_purchases']) {
        const [r] = await conn.query(`DELETE FROM \`${table}\``);
        deleted[table] = r.affectedRows;
      }
    });
    console.log('Clear data —', JSON.stringify(deleted));
    res.json({ ok: true, deleted });
  })
);

// ---------------------------------------------------------------- payments to the hotel
// Replaces all payments of one settlement month (YYYY-MM).
app.put(
  '/api/settlements/:month',
  route(async (req, res) => {
    const month = String(req.params.month);
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
    const methods = ['Cash', 'Bank Transfer', 'GCash', 'Credit Card'];
    const payments = ((req.body && req.body.payments) || []).filter((p) => Number(p.amount) > 0);

    await inTransaction(async (conn) => {
      const timeOf = await paymentTimes(conn, 'hotel_payments', 'SETTLE_MONTH = ?', [month]);
      await conn.query('DELETE FROM hotel_payments WHERE SETTLE_MONTH = ?', [month]);
      if (payments.length) {
        await conn.query(
          'INSERT INTO hotel_payments (SETTLE_MONTH, PAY_DATE, AMOUNT, METHOD, FUND, REFERENCE, OIC, REMARKS, RECORDED_AT, CREATED_BY) VALUES ?',
          [
            payments.map((p) => {
              const method = methods.includes(p.method) ? p.method : 'Bank Transfer';
              return [
                month,
                p.date,
                Number(p.amount),
                method,
                p.fund === 'voucher' ? 'voucher' : 'room',
                p.reference ? String(p.reference).slice(0, 100) : null,
                p.oic ? String(p.oic).slice(0, 100) : null,
                p.remarks ? String(p.remarks).slice(0, 500) : null,
                timeOf(p, p.date, method),
                SYSTEM_USER,
              ];
            }),
          ]
        );
      }
    });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- room rates + vouchers
app.put(
  '/api/rates',
  route(async (req, res) => {
    const { rooms = [], vouchers = {} } = req.body || {};
    await inTransaction(async (conn) => {
      for (const [i, r] of rooms.entries()) {
        await conn.query(
          `INSERT INTO room_types
             (ROOM_CODE, ROOM_NAME, WEEKDAY_RATE_SINGLE_DOUBLE, WEEKDAY_RATE_TRIPLE, WEEKEND_RATE_SINGLE_DOUBLE, WEEKEND_RATE_TRIPLE, SORT_ORDER)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             ROOM_NAME = VALUES(ROOM_NAME),
             WEEKDAY_RATE_SINGLE_DOUBLE = VALUES(WEEKDAY_RATE_SINGLE_DOUBLE), WEEKDAY_RATE_TRIPLE = VALUES(WEEKDAY_RATE_TRIPLE),
             WEEKEND_RATE_SINGLE_DOUBLE = VALUES(WEEKEND_RATE_SINGLE_DOUBLE), WEEKEND_RATE_TRIPLE = VALUES(WEEKEND_RATE_TRIPLE),
             SORT_ORDER = VALUES(SORT_ORDER), ACTIVE = 1`,
          [
            String(r.id).slice(0, 50),
            String(r.name).slice(0, 100),
            Number(r.singleDoubleWeekday) || 0,
            Number(r.tripleWeekday) || 0,
            Number(r.singleDoubleWeekend) || 0,
            Number(r.tripleWeekend) || 0,
            i + 1,
          ]
        );
      }
      // room types removed in the app are hidden (ACTIVE = 0), not deleted — old bookings still point to them
      const codes = rooms.map((r) => String(r.id).slice(0, 50));
      if (codes.length) await conn.query('UPDATE room_types SET ACTIVE = 0 WHERE ROOM_CODE NOT IN (?)', [codes]);
      for (const code of ['breakfast', 'dinner', 'extraBed']) {
        if (vouchers[code] == null) continue;
        await conn.query('UPDATE addon_rates SET PRICE = ? WHERE ADDON_CODE = ?', [Number(vouchers[code]) || 0, code]);
      }
    });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- voucher-only purchases
// Create or update one voucher sale (by its app id) with its items and payments.
app.put(
  '/api/vouchers/:id',
  route(async (req, res) => {
    const v = req.body || {};
    const id = String(req.params.id).slice(0, 50);
    const items = (v.items || []).filter((c) => Number(c.qty) > 0);
    if (!v.guestName || !v.date) return res.status(400).json({ error: 'guestName and date are required' });
    if (!items.length) return res.status(400).json({ error: 'Add at least one voucher' });

    await inTransaction(async (conn) => {
      const agent = await agentId(conn, v.agentName); // new names are added to the agents list
      const vals = [v.date, String(v.guestName).slice(0, 150), agent, v.remarks ? String(v.remarks).slice(0, 500) : null];
      const [found] = await conn.query('SELECT IDNo FROM voucher_sales WHERE APP_ID = ?', [id]);
      let saleId;
      if (found.length) {
        saleId = found[0].IDNo;
        await conn.query('UPDATE voucher_sales SET SALE_DATE = ?, GUEST_NAME = ?, AGENT_ID = ?, REMARKS = ?, ACTIVE = 1 WHERE IDNo = ?', [...vals, saleId]);
      } else {
        const [ins] = await conn.query(
          'INSERT INTO voucher_sales (SALE_DATE, GUEST_NAME, AGENT_ID, REMARKS, APP_ID, CREATED_BY) VALUES (?, ?, ?, ?, ?, ?)',
          [...vals, id, SYSTEM_USER]
        );
        saleId = ins.insertId;
      }
      // Items and payments are replaced as a whole (the app always sends the full lists).
      const timeOf = await paymentTimes(conn, 'voucher_sale_payments', 'SALE_ID = ?', [saleId]);
      await conn.query('DELETE FROM voucher_sale_items WHERE SALE_ID = ?', [saleId]);
      await conn.query('DELETE FROM voucher_sale_payments WHERE SALE_ID = ?', [saleId]);
      await conn.query('INSERT INTO voucher_sale_items (SALE_ID, CATEGORY, DESCRIPTION, QTY, UNIT_PRICE, IS_FREE) VALUES ?', [
        items.map((c) => [
          saleId,
          ['breakfast', 'dinner'].includes(c.category) ? c.category : 'other',
          String(c.description || '').slice(0, 200),
          Math.round(Number(c.qty)),
          Math.max(0, Number(c.unitPrice) || 0),
          c.free ? 1 : 0,
        ]),
      ]);
      const payments = (v.payments || []).filter((p) => Number(p.amount) > 0);
      if (payments.length) {
        const methods = ['Cash', 'Bank Transfer', 'GCash', 'Credit Card', 'Junket Account'];
        await conn.query('INSERT INTO voucher_sale_payments (SALE_ID, PAY_DATE, AMOUNT, METHOD, REFERENCE, RECORDED_AT) VALUES ?', [
          payments.map((p) => {
            const date = p.date || v.date;
            const method = methods.includes(p.method) ? p.method : 'Cash';
            return [saleId, date, Number(p.amount), method, p.reference ? String(p.reference).slice(0, 100) : null, timeOf(p, date, method)];
          }),
        ]);
      }
    });
    res.json({ ok: true });
  })
);

// Delete = soft delete (ACTIVE = 0).
app.delete(
  '/api/vouchers/:id',
  route(async (req, res) => {
    await pool.query('UPDATE voucher_sales SET ACTIVE = 0 WHERE APP_ID = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- hotel purchases (inventory)
// Stock Jupiter buys from the hotel at the wholesale rate: room-nights per room type, and vouchers.
// Create or update one purchase (by its app id); its lines are replaced as a whole.
app.put(
  '/api/purchases/:id',
  route(async (req, res) => {
    const p = req.body || {};
    const id = String(req.params.id).slice(0, 50);
    const items = (p.items || []).filter((i) => Number(i.qty) > 0 && i.item);
    if (!p.date || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return res.status(400).json({ error: 'date is required' });
    if (!items.length) return res.status(400).json({ error: 'Add at least one item' });

    await inTransaction(async (conn) => {
      const vals = [p.date, p.reference ? String(p.reference).slice(0, 100) : null, p.remarks ? String(p.remarks).slice(0, 500) : null];
      const [found] = await conn.query('SELECT IDNo FROM hotel_purchases WHERE APP_ID = ?', [id]);
      let purchaseId;
      if (found.length) {
        purchaseId = found[0].IDNo;
        await conn.query('UPDATE hotel_purchases SET PURCHASE_DATE = ?, REFERENCE = ?, REMARKS = ?, ACTIVE = 1 WHERE IDNo = ?', [...vals, purchaseId]);
      } else {
        const [ins] = await conn.query('INSERT INTO hotel_purchases (PURCHASE_DATE, REFERENCE, REMARKS, APP_ID, CREATED_BY) VALUES (?, ?, ?, ?, ?)', [
          ...vals,
          id,
          SYSTEM_USER,
        ]);
        purchaseId = ins.insertId;
      }
      await conn.query('DELETE FROM hotel_purchase_items WHERE PURCHASE_ID = ?', [purchaseId]);
      await conn.query('INSERT INTO hotel_purchase_items (PURCHASE_ID, ITEM_KIND, ITEM_CODE, QTY, UNIT_COST) VALUES ?', [
        items.map((i) => [
          purchaseId,
          i.kind === 'voucher' ? 'voucher' : 'room',
          String(i.item).slice(0, 50),
          Math.round(Number(i.qty)),
          Math.max(0, Number(i.unitCost) || 0),
        ]),
      ]);
    });
    res.json({ ok: true });
  })
);

// Delete = soft delete (ACTIVE = 0).
app.delete(
  '/api/purchases/:id',
  route(async (req, res) => {
    await pool.query('UPDATE hotel_purchases SET ACTIVE = 0 WHERE APP_ID = ?', [req.params.id]);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- fund (cash outs / opening balances)
// Create or update one fund transaction. There is no delete: a mistake is voided (VOIDED = 1) with a reason.
app.put(
  '/api/fund/:id',
  route(async (req, res) => {
    const f = req.body || {};
    const id = String(req.params.id).slice(0, 50);
    const amount = Number(f.amount);
    if (!f.date || !(amount > 0)) return res.status(400).json({ error: 'date and a positive amount are required' });
    const methods = ['Cash', 'Bank Transfer', 'GCash', 'Credit Card', 'Junket Account'];
    const vals = [
      f.fund === 'voucher' ? 'voucher' : 'room',
      f.type === 'opening' ? 'opening' : 'out',
      f.date,
      amount,
      methods.includes(f.method) ? f.method : 'Cash',
      String(f.purpose || 'withdrawal').slice(0, 30),
      f.releasedBy ? String(f.releasedBy).slice(0, 100) : null,
      f.receivedBy ? String(f.receivedBy).slice(0, 100) : null,
      f.reference ? String(f.reference).slice(0, 100) : null,
      f.remarks ? String(f.remarks).slice(0, 500) : null,
      f.voided ? 1 : 0,
      f.voided && f.voidReason ? String(f.voidReason).slice(0, 300) : null,
    ];
    const [found] = await pool.query('SELECT IDNo, VOIDED FROM fund_transactions WHERE APP_ID = ?', [id]);
    if (found.length) {
      await pool.query(
        `UPDATE fund_transactions SET FUND = ?, TXN_TYPE = ?, TXN_DATE = ?, AMOUNT = ?, METHOD = ?, PURPOSE = ?, RELEASED_BY = ?,
           RECEIVED_BY = ?, REFERENCE = ?, REMARKS = ?, VOIDED = ?, VOID_REASON = ?,
           VOIDED_DT = IF(? = 1 AND VOIDED = 0, NOW(), VOIDED_DT) WHERE IDNo = ?`,
        [...vals, f.voided ? 1 : 0, found[0].IDNo]
      );
    } else {
      await pool.query(
        `INSERT INTO fund_transactions
           (FUND, TXN_TYPE, TXN_DATE, AMOUNT, METHOD, PURPOSE, RELEASED_BY, RECEIVED_BY, REFERENCE, REMARKS, VOIDED, VOID_REASON, APP_ID, CREATED_BY)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...vals, id, SYSTEM_USER]
      );
    }
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------- holidays
// Add / update one holiday by date; active = false removes it (kept, so the seed doesn't add it back).
app.put(
  '/api/holidays/:date',
  route(async (req, res) => {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const h = req.body || {};
    const name = String(h.name || '').trim().slice(0, 150);
    if (!name) return res.status(400).json({ error: 'name is required' });
    await pool.query(
      `INSERT INTO holidays (HOLIDAY_DATE, HOLIDAY_NAME, HOLIDAY_TYPE, ACTIVE) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE HOLIDAY_NAME = VALUES(HOLIDAY_NAME), HOLIDAY_TYPE = VALUES(HOLIDAY_TYPE), ACTIVE = VALUES(ACTIVE)`,
      [date, name, h.type === 'special' ? 'special' : 'regular', h.active === false ? 0 : 1]
    );
    res.json({ ok: true });
  })
);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------------------------------------------------------------- frontend
// Static files from dist/, SPA fallback to index.html.
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const dbLabel = `${process.env.DB_NAME || 'Jupiter_hotel'} @ ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}`;
ensureColumns()
  .then(() => console.log(`✓ Database connected — ${dbLabel}`))
  .catch((err) => console.error(`✗ Database NOT connected — ${dbLabel}: ${err.code || ''} ${err.message}`))
  .finally(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Jupiter Hotel backend on :${port} (serving ${dist})`);
    });
  });
