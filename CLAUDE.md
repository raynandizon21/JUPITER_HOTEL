# CLAUDE.md

Guidance for Claude (and other contributors) working in this repo.

## What this is

**Jupiter Hotel PMS** — a web app for the Jupiter junket, which books rooms for its guests at **Hilton Hotel**.

- Guests are billed per booking (room charge + extras − payments = balance).
- Every month Jupiter settles the total with the hotel.

Stack: React 19 · Vite 8 · Tailwind CSS v4 · TypeScript · lucide-react · exceljs (lazy-loaded for Excel export).

## Commands

```bash
npm run dev       # runs scripts/init-db.mjs (creates MySQL DB/tables if missing), then Vite on :3000
npm run db:init   # only the DB setup
npm run lint      # tsc --noEmit — run after every change
npm run build     # production build
```

**Production (PM2):** `npm run build && pm2 start ecosystem.config.cjs && pm2 save`. One process, `JupiterHotel-Backend` (`server/index.js`, port 4020), serves `dist/` plus `/api` (`/api/health` checks MySQL). After a frontend change: `npm run build && pm2 restart JupiterHotel-Backend`.

To check for dead code, run `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`. It should print nothing.

## Data

- **Data is saved in MySQL** (DB `jupiter_hotel`) through the Node backend `server/index.js`. The app calls `/api` via `src/utils/api.ts`:
  - `GET /api/state` loads rates, bookings (with charges and payments) and payments to the hotel on startup;
  - `PUT/DELETE /api/reservations/:id` (id = `booking.APP_ID`; delete sets `ACTIVE = 0`), `PUT /api/settlements/:month`, `PUT /api/rates`.
  - `booking.CONFIRM_NUM` = the **hotel's confirmation number** (`Reservation.confirmationNo`), typed in by staff. Optional, but **1 number = 1 booking**: the form blocks duplicates and the server returns 409 (deleted bookings keep their number too).
  - The pages still use plain React state. Effects in `src/App.tsx` diff each change against what the server has and send only what changed.
  - Only the language (`hotel_language_v2`) stays in localStorage. Old browser data (`hotel_reservations_v2`, `hotel_settlements_v1`, `hotel_casino_rates_v2`, demo flag) is **not imported** — the app just deletes those keys on load (importing them once brought old sample / demo bookings back into MySQL).
  - **Voucher-only purchases** (`VoucherSale`, tables `voucher_sales` / `voucher_sale_items` / `voucher_sale_payments`, `PUT/DELETE /api/vouchers/:id`): vouchers bought **without** a room booking. New Booking → *Vouchers only* (`VoucherSaleForm`). They are **for the record**: listed under the Guest Ledger and in the Daily Settlement *Vouchers sold* column (by purchase date), but **not** in check-ins / nights / occupancy or the hotel settlement totals.
  - **Agents** (file maintenance, table `agents`, `booking.AGENT_ID`, page `AgentsMaintenance`): the booking form's *Agent* field suggests active agents; a new name is added to `agents` by the server when the booking is saved (`agentId()` find-or-create, case-insensitive). `GET/POST /api/agents`, `PUT /api/agents/:id` (rename / show-hide).
  - **Hotel Purchases** (`HotelPurchase`, tables `hotel_purchases` / `hotel_purchase_items`, `PUT/DELETE /api/purchases/:id`, page `InventoryPage`): stock Jupiter buys from the hotel at the **wholesale** rate — room-nights per room type (any date) and breakfast / dinner / extra-bed vouchers. A line with unit cost ₱0 = given **free** by the hotel (still adds stock). Stock left = bought − used (`buildStock` in `src/utils/inventory.ts`): each booking night uses 1 of its room type, each voucher / extra bed uses 1, **free nights / vouchers included**. Running out only **warns** (`StockWarning` in the booking and Vouchers-only forms, shown once any purchase exists); saving is still allowed and stock goes negative.
    - **Bought with a booking** (the **Hotel** column of the reservation form's charges table, `HotelCostInput` in `HotelCostSection.tsx`; always on, no checkbox — an older booking without one gets it only if a cost is typed): the form records Jupiter's cost in the same save as a purchase with id `buy-<bookingId>` (`linkedPurchaseId`), dated on **check-in**. Qty follows the booking (nights + its vouchers); only the unit cost is typed (default = last price paid; empty = not entered, Save is blocked; 0 = free from the hotel). Each night row has a tick for a night the hotel gives **complimentary**: saved as a separate ₱0 room line (paid nights × cost + comp nights × ₱0). The guest-side column is labelled *Complimentary* (was *Free*). **Vouchers only** (`VoucherSaleForm`) has the same Hotel | Guest table and saves `buy-<voucherSaleId>` dated on the purchase date; deleting the voucher sale deletes it. Column colours / last price helpers: `HG`, `lastCostOf` in `HotelCostSection.tsx`. Date fields in these forms and the Rate Calculator use `DateFilter stay` (app calendar, not `<input type="date">`). Editing the booking rewrites it; deleting the booking deletes it. The form shows hotel cost and margin (guest total − hotel cost).
  - **Holidays** (table `holidays`, seeded with PH holidays 2026–2027 on backend start, `PUT /api/holidays/:date`): managed from the ⚙ **Holidays** button on the Guest Ledger (no sidebar item). New Reservation ticks *Holiday rate* automatically for nights on an active holiday; the calendar marks them.
  - There is no login yet: `BOOKED_BY` / `CREATED_BY` use the seeded `system` user (IDNo 1).
- The app starts **empty**: there is no sample or demo data. The **Clear data** sidebar button is hidden for now (pass `onClearData={() => setClearOpen(true)}` to `Sidebar` in `App.tsx` to show it). It opens `ClearDataDialog` (type DELETE) → `POST /api/clear-data`, which hard-deletes all bookings, voucher purchases, hotel payments and fund entries. Rates, room types, agents and holidays are kept.
- **MySQL schema** is in `database/schema.sql` (13 tables). `scripts/init-db.mjs` applies it on `npm run dev` using the `DB_*` values in `.env`.
  - It only uses `CREATE … IF NOT EXISTS` and `INSERT IGNORE`, so it is safe to re-run.
  - Columns added later (`booking.CURRENCY`, `booking.IS_JUPITER_GUEST`, `booking.APP_ID`, `RECORDED_AT` on the 3 payment tables) and the voucher tables are added by `ensureColumns` in `server/index.js` when the backend starts.
  - **Payment time** (`FolioPayment.recordedAt` → `RECORDED_AT`): set with `nowStamp()` when a payment is added. Payment lists are DELETE + INSERT on save, so `paymentTimes()` in the server carries the old time over. The Fund ledger shows it under the date.
- **Dev:** `npm run dev:all` runs the backend (`server/index.js`, restarts on change) and Vite together; `npm run dev` is Vite only. Vite proxies `/api` to `API_PORT` from `.env`, and prints API / Database status under the Local/Network lines.
- Old saved bookings are upgraded on load by `migrateReservation` (`src/utils/billing.ts`). Keep that function working when you change the `Reservation` shape.

## Domain rules (do not break)

- **Weekend = Friday and Saturday** (`getUTCDay` 5/6). Sunday–Thursday = weekday.
- **Holiday nights** (`holidayDates[]` per booking) are charged at the **weekend** rate. The regular rate is shown struck through. They come only from the Holidays list (no tick in the reservation form; the night's badge shows *Holiday*).
- Rates depend on room type × occupancy (`singleDouble` = 1–2 guests, `triple` = 3 guests) × weekday/weekend.
- **Dates are parsed in UTC** (`new Date(d + 'T00:00:00Z')`) to avoid timezone off-by-one errors.
- **Folio** (`folioOf`):
  - total = `amount` (room) + Σ charges;
  - paid = Σ payments;
  - status is **derived**: `paid` / `partial` / `unpaid`. Never store it. `syncStatus` only keeps the legacy `paymentStatus` field in step.
- **What Jupiter owes the hotel** for a month = the **purchases dated that month** (Hotel Purchases), not what guests were billed. A payment to the hotel has a **fund** (`hotel_payments.FUND`): room purchases are paid from the Room fund, voucher purchases from the Voucher fund (Pay Hotel Bill → *Pay from*). Guest figures on the Dashboard still use the bookings' check-in month (`referenceMonth`).
- **Daily Settlement** is a **day-by-day audit** (`bookingDays` / `buildDailyRows` in `DailySettlement.tsx`):
  - *Check-in list* = guests in the room that night: arrivals + guests who arrived earlier and are still staying (merged; blue badge = has arrivals, grey = only staying; hover shows the split). Grand total = guests in the period, each counted once;
  - *Total amount* = each booking's value **on that day**: that night's rate (holiday / free nights included), scaled so the nights add up to the booked room amount; extras on their charge date;
  - *Paid / Unpaid amount* = the guest's payments cover the earliest days first, so each day's paid + unpaid = that day's total;
  - *Hotel rate* = what Jupiter pays the hotel for that day's room nights, from each booking's own purchase (`hotelNights`: paid nights × unit cost, complimentary nights = the first nights at ₱0). Bookings without a hotel cost and bulk purchases are not in it. *Junket rate* (was *Room*) = the guest's room amount for that day;
  - *Vouchers sold* = voucher-only purchases that day (record only, not added to the other columns).
  - The Paid/Unpaid **booking counts** and the *Check-ins (No. of Reservations)* / *Total nights stayed* / *Still staying* columns were removed on request (still-staying guests show in the day pop-up's tab).
- Extra charges with the same description + date + unit price are **merged** (qty added), not duplicated.
- The reservation OIC (hotel) has been **removed** from the UI and exports. Only *payments to the hotel* have an OIC field.

## UI conventions

- **Design tokens and component classes** are in `src/index.css`:
  - tokens via `@theme`;
  - classes: `.card`, `.btn*`, `.input`, `.seg` (with `button[data-active]`), `.badge-*`, `.dtable` (`.compact`), `.dialog`, `.overlay`.
  - Use these instead of one-off styles.
- **Top bar** is black with gold accents (`#e9c46a`). **Home** and **New Booking** pills sit above each page title.
- **Formats** (helpers in `src/utils/hotelHelpers.ts` / `billing.ts`):
  - dates: `formatLongDate` → "November 11, 2026";
  - months: `formatMonth` → "November 2026";
  - stays: `formatDateRange` → "November 1 - 2, 2026";
  - money: `peso()` → "₱19,250".
- **Every create/update/delete** shows a toast (`toast()` from `src/components/ui.tsx`, top-right).
- **Tables should fit the screen without inner scrollbars.** Paginate instead (`Pager`), with rows per page from **`useFitRows`** (`src/utils/useFitRows.ts`). Don't hand-roll row measuring: an average-row-height version looped forever (React error #185, blank white page).
- **Error boundaries** (`ErrorBoundary` in `ui.tsx`) wrap the app (`main.tsx`) and each page (`App.tsx`), so a crash shows a "Something went wrong — Reload" box instead of a blank page.
- **Pop-ups** use `Dialog`. Don't add `backdrop-filter`: it made pop-ups laggy.
- **Text is bilingual EN/KO.** Pass `en` booleans or use `translations` (`src/i18n/translations.ts`, unused keys were pruned).
- **Printing** goes through `printDocument` (hidden iframe). A pop-up window froze the tab.
- **New Booking** opens the reservation form on the current page (`GuestReservationLedger formOnly`). After saving, it goes to the Guest Ledger and highlights the new row (`highlightId`).

## Files

| Path | Purpose |
|---|---|
| `src/App.tsx` | Layout, top bar, state + localStorage, New Booking flow |
| `src/components/DailyDashboard.tsx` | Dashboard (monthly settlement, payments to hotel, guest balances; embeds Daily Settlement) |
| `src/components/DailySettlement.tsx` | Daily table, guest / in-house pop-ups, `Pager` |
| `src/components/GuestReservationLedger.tsx` | Ledger table + New/Edit reservation form with confirm step |
| `src/components/VoucherSaleForm.tsx` | Voucher-only purchase form (New Booking → Vouchers only; ledger edit) |
| `src/components/GuestFolio.tsx` | Guest billing pop-up (charges, payments, print) |
| `src/components/ReservationCalendar.tsx` | Month calendar; clicking a booking opens billing |
| `src/components/RoomRatesMaintenance.tsx` | Rate grid with Settings edit mode |
| `src/components/RateCalculator.tsx` | Night-by-night quote → book |
| `src/utils/excelExport.ts` | Monthly settlement + daily settlement `.xlsx` |
| `database/schema.sql`, `scripts/init-db.mjs` | MySQL schema + auto-setup |
| `server/index.js`, `ecosystem.config.cjs` | Express backend (serves `dist/` + `/api`) and its PM2 config |

## Working style

- The user writes in Taglish. Reply in clear, plain English unless asked otherwise.
- Keep changes small and match the existing patterns. Run `npm run lint` before finishing.
- Never commit `.env` (it is git-ignored; `.env.example` is the template).
