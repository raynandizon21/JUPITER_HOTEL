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

// Columns added after the first schema release. CREATE TABLE IF NOT EXISTS won't add them
// to an existing table, so add them here when missing.
async function ensureColumns() {
  // Tables added after the first schema release (same DDL as database/schema.sql).
  for (const ddl of VOUCHER_TABLES) await pool.query(ddl);

  const wanted = [
    ['booking', 'CURRENCY', "ENUM('PHP','KRW') NOT NULL DEFAULT 'PHP' AFTER `ROOM_AMOUNT`"],
    ['booking', 'IS_JUPITER_GUEST', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER `REMARKS`'],
  ];
  for (const [table, col, def] of wanted) {
    const [rows] = await pool.query(
      'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      [table, col]
    );
    if (!rows.length) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
  }

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
      `SELECT b.*, rt.ROOM_NAME FROM booking b JOIN room_types rt ON rt.IDNo = b.ROOM_TYPE_ID
       WHERE b.ACTIVE = 1 ORDER BY b.BOOKING_DATE DESC, b.IDNo DESC`
    );
    const [charges] = await pool.query(
      'SELECT c.* FROM booking_charges c JOIN booking b ON b.IDNo = c.BOOKING_ID WHERE b.ACTIVE = 1 ORDER BY c.IDNo'
    );
    const [payments] = await pool.query(
      'SELECT p.* FROM booking_payments p JOIN booking b ON b.IDNo = p.BOOKING_ID WHERE b.ACTIVE = 1 ORDER BY p.IDNo'
    );
    const [hotelPays] = await pool.query('SELECT * FROM hotel_payments ORDER BY SETTLE_MONTH, PAY_DATE, IDNo');
    const [vSales] = await pool.query('SELECT * FROM voucher_sales WHERE ACTIVE = 1 ORDER BY SALE_DATE DESC, IDNo DESC');
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
      charges: (chargeMap.get(b.IDNo) || []).map((c) => ({
        id: `c${c.IDNo}`,
        date: c.CHARGE_DATE,
        description: c.DESCRIPTION,
        qty: c.QTY,
        unitPrice: c.UNIT_PRICE,
        category: c.CATEGORY,
      })),
      payments: (payMap.get(b.IDNo) || []).map((p) => ({
        id: `p${p.IDNo}`,
        date: p.PAY_DATE,
        amount: p.AMOUNT,
        method: p.METHOD,
        reference: p.REFERENCE || '',
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
      remarks: v.REMARKS || '',
      items: (itemMap.get(v.IDNo) || []).map((c) => ({
        id: `vi${c.IDNo}`,
        date: v.SALE_DATE,
        description: c.DESCRIPTION,
        qty: c.QTY,
        unitPrice: c.UNIT_PRICE,
        category: c.CATEGORY,
      })),
      payments: (vPayMap.get(v.IDNo) || []).map((p) => ({
        id: `vp${p.IDNo}`,
        date: p.PAY_DATE,
        amount: p.AMOUNT,
        method: p.METHOD,
        reference: p.REFERENCE || '',
      })),
    }));

    res.json({ rates, reservations, settlements, voucherSales });
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
      const vals = [
        confirmNo,
        String(r.guestName).slice(0, 150),
        roomId,
        r.occupancy === 'triple' ? 'triple' : 'singleDouble',
        JSON.stringify(Array.isArray(r.holidayDates) ? r.holidayDates : []),
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
          `UPDATE booking SET CONFIRM_NUM = ?, GUEST_NAME = ?, ROOM_TYPE_ID = ?, OCCUPANCY = ?, HOLIDAY_DATES = ?, CHECK_IN = ?,
             CHECK_OUT = ?, ROOM_AMOUNT = ?, CURRENCY = ?, REMARKS = ?, IS_JUPITER_GUEST = ?, ACTIVE = 1, EDITED_BY = ?
           WHERE IDNo = ?`,
          [...vals, SYSTEM_USER, bookingId]
        );
      } else {
        const [ins] = await conn.query(
          `INSERT INTO booking
             (CONFIRM_NUM, GUEST_NAME, ROOM_TYPE_ID, OCCUPANCY, HOLIDAY_DATES, CHECK_IN, CHECK_OUT, ROOM_AMOUNT, CURRENCY, REMARKS, IS_JUPITER_GUEST, APP_ID, BOOKED_BY)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [...vals, id, SYSTEM_USER]
        );
        bookingId = ins.insertId;
      }

      // Charges and payments are replaced as a whole (the app always sends the full lists).
      await conn.query('DELETE FROM booking_charges WHERE BOOKING_ID = ?', [bookingId]);
      await conn.query('DELETE FROM booking_payments WHERE BOOKING_ID = ?', [bookingId]);
      const charges = (r.charges || []).filter((c) => Number(c.qty) > 0);
      if (charges.length) {
        await conn.query(
          'INSERT INTO booking_charges (BOOKING_ID, CHARGE_DATE, CATEGORY, DESCRIPTION, QTY, UNIT_PRICE, CREATED_BY) VALUES ?',
          [
            charges.map((c) => [
              bookingId,
              c.date || r.checkIn,
              ['buffet', 'extraBed'].includes(c.category) ? c.category : 'other',
              String(c.description || '').slice(0, 200),
              Math.round(Number(c.qty)),
              Math.max(0, Number(c.unitPrice) || 0),
              SYSTEM_USER,
            ]),
          ]
        );
      }
      const payments = (r.payments || []).filter((p) => Number(p.amount) > 0);
      if (payments.length) {
        const methods = ['Cash', 'Bank Transfer', 'GCash', 'Credit Card', 'Junket Account'];
        await conn.query(
          'INSERT INTO booking_payments (BOOKING_ID, PAY_DATE, AMOUNT, METHOD, REFERENCE, CREATED_BY) VALUES ?',
          [
            payments.map((p) => [
              bookingId,
              p.date || r.checkIn,
              Number(p.amount),
              methods.includes(p.method) ? p.method : 'Cash',
              p.reference ? String(p.reference).slice(0, 100) : null,
              SYSTEM_USER,
            ]),
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
      await conn.query('DELETE FROM hotel_payments WHERE SETTLE_MONTH = ?', [month]);
      if (payments.length) {
        await conn.query(
          'INSERT INTO hotel_payments (SETTLE_MONTH, PAY_DATE, AMOUNT, METHOD, REFERENCE, OIC, REMARKS, CREATED_BY) VALUES ?',
          [
            payments.map((p) => [
              month,
              p.date,
              Number(p.amount),
              methods.includes(p.method) ? p.method : 'Bank Transfer',
              p.reference ? String(p.reference).slice(0, 100) : null,
              p.oic ? String(p.oic).slice(0, 100) : null,
              p.remarks ? String(p.remarks).slice(0, 500) : null,
              SYSTEM_USER,
            ]),
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
      const vals = [v.date, String(v.guestName).slice(0, 150), v.remarks ? String(v.remarks).slice(0, 500) : null];
      const [found] = await conn.query('SELECT IDNo FROM voucher_sales WHERE APP_ID = ?', [id]);
      let saleId;
      if (found.length) {
        saleId = found[0].IDNo;
        await conn.query('UPDATE voucher_sales SET SALE_DATE = ?, GUEST_NAME = ?, REMARKS = ?, ACTIVE = 1 WHERE IDNo = ?', [...vals, saleId]);
      } else {
        const [ins] = await conn.query(
          'INSERT INTO voucher_sales (SALE_DATE, GUEST_NAME, REMARKS, APP_ID, CREATED_BY) VALUES (?, ?, ?, ?, ?)',
          [...vals, id, SYSTEM_USER]
        );
        saleId = ins.insertId;
      }
      // Items and payments are replaced as a whole (the app always sends the full lists).
      await conn.query('DELETE FROM voucher_sale_items WHERE SALE_ID = ?', [saleId]);
      await conn.query('DELETE FROM voucher_sale_payments WHERE SALE_ID = ?', [saleId]);
      await conn.query('INSERT INTO voucher_sale_items (SALE_ID, CATEGORY, DESCRIPTION, QTY, UNIT_PRICE) VALUES ?', [
        items.map((c) => [
          saleId,
          ['breakfast', 'dinner'].includes(c.category) ? c.category : 'other',
          String(c.description || '').slice(0, 200),
          Math.round(Number(c.qty)),
          Math.max(0, Number(c.unitPrice) || 0),
        ]),
      ]);
      const payments = (v.payments || []).filter((p) => Number(p.amount) > 0);
      if (payments.length) {
        const methods = ['Cash', 'Bank Transfer', 'GCash', 'Credit Card', 'Junket Account'];
        await conn.query('INSERT INTO voucher_sale_payments (SALE_ID, PAY_DATE, AMOUNT, METHOD, REFERENCE) VALUES ?', [
          payments.map((p) => [
            saleId,
            p.date || v.date,
            Number(p.amount),
            methods.includes(p.method) ? p.method : 'Cash',
            p.reference ? String(p.reference).slice(0, 100) : null,
          ]),
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

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------------------------------------------------------------- frontend
// Static files from dist/, SPA fallback to index.html.
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

ensureColumns()
  .catch((err) => console.error('Could not check/add booking columns:', err.message))
  .finally(() => {
    app.listen(port, '0.0.0.0', () => {
      console.log(`Jupiter Hotel backend on :${port} (serving ${dist})`);
    });
  });
