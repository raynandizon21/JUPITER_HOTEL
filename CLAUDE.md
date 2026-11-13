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

- **The app is web-only.** Everything is saved in the browser's **localStorage** under these keys (see `src/App.tsx`):
  - `hotel_reservations_v2` — bookings with their `charges[]` and `payments[]`
  - `hotel_settlements_v1` — Jupiter → hotel payments per month
  - `hotel_casino_rates_v2` — room rates and voucher prices
  - `hotel_language_v2`
- The app starts **empty**: there is no sample or demo data. The **Clear data** sidebar button is hidden (pass `onClearData` to `Sidebar` to show it again).
- **MySQL schema** is in `database/schema.sql` (DB `Jupiter_hotel`, 7 tables). `scripts/init-db.mjs` applies it on `npm run dev` using the `DB_*` values in `.env`.
  - It only uses `CREATE … IF NOT EXISTS` and `INSERT IGNORE`, so it is safe to re-run.
  - Nothing in the web app reads from or writes to MySQL yet.
- Old saved bookings are upgraded on load by `migrateReservation` (`src/utils/billing.ts`). Keep that function working when you change the `Reservation` shape.

## Domain rules (do not break)

- **Weekend = Friday and Saturday** (`getUTCDay` 5/6). Sunday–Thursday = weekday.
- **Holiday nights** are ticked per booking (`holidayDates[]`) and charged at the **weekend** rate. The regular rate is shown struck through.
- Rates depend on room type × occupancy (`singleDouble` = 1–2 guests, `triple` = 3 guests) × weekday/weekend.
- **Dates are parsed in UTC** (`new Date(d + 'T00:00:00Z')`) to avoid timezone off-by-one errors.
- **Folio** (`folioOf`):
  - total = `amount` (room) + Σ charges;
  - paid = Σ payments;
  - status is **derived**: `paid` / `partial` / `unpaid`. Never store it. `syncStatus` only keeps the legacy `paymentStatus` field in step.
- **Settlement month** = the check-in month (`referenceMonth`). Money is counted on the **check-in date**.
- **Daily Settlement** columns:
  - *Check-in list* = arrivals that day;
  - *Check-ins (No. of Reservations)* and *Total nights stayed* = rooms occupied that night (`checkIn ≤ date < checkOut`, 1 room = 1 night);
  - Paid/Unpaid counts and amounts are per check-in date.
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
- **Tables should fit the screen without inner scrollbars.** Paginate instead (see `Pager` in `DailySettlement.tsx`, which sizes rows to the available height).
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
