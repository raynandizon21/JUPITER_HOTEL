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

// Columns added after the first schema release. CREATE TABLE IF NOT EXISTS won't add them
// to an existing table, so add them here when missing.
async function ensureColumns() {
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
}

const app = express();
app.use(express.json({ limit: '5mb' }));

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
      id: b.CONFIRM_NUM,
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

    res.json({ rates, reservations, settlements });
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

// Create or update one booking (by its app id = CONFIRM_NUM) with its charges and payments.
app.put(
  '/api/reservations/:id',
  route(async (req, res) => {
    const r = req.body || {};
    const id = String(req.params.id).slice(0, 50);
    if (!r.guestName || !r.checkIn || !r.checkOut) return res.status(400).json({ error: 'guestName, checkIn and checkOut are required' });

    await inTransaction(async (conn) => {
      const roomId = await roomTypeId(conn, r.roomType || '');
      const vals = [
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
      await conn.query(
        `INSERT INTO booking
           (CONFIRM_NUM, GUEST_NAME, ROOM_TYPE_ID, OCCUPANCY, HOLIDAY_DATES, CHECK_IN, CHECK_OUT, ROOM_AMOUNT, CURRENCY, REMARKS, IS_JUPITER_GUEST, BOOKED_BY)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           GUEST_NAME = VALUES(GUEST_NAME), ROOM_TYPE_ID = VALUES(ROOM_TYPE_ID), OCCUPANCY = VALUES(OCCUPANCY),
           HOLIDAY_DATES = VALUES(HOLIDAY_DATES), CHECK_IN = VALUES(CHECK_IN), CHECK_OUT = VALUES(CHECK_OUT),
           ROOM_AMOUNT = VALUES(ROOM_AMOUNT), CURRENCY = VALUES(CURRENCY), REMARKS = VALUES(REMARKS),
           IS_JUPITER_GUEST = VALUES(IS_JUPITER_GUEST), ACTIVE = 1, EDITED_BY = ?`,
        [id, ...vals, SYSTEM_USER, SYSTEM_USER]
      );
      const [[{ IDNo: bookingId }]] = await conn.query('SELECT IDNo FROM booking WHERE CONFIRM_NUM = ?', [id]);

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
    await pool.query('UPDATE booking SET ACTIVE = 0, EDITED_BY = ? WHERE CONFIRM_NUM = ?', [SYSTEM_USER, req.params.id]);
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
