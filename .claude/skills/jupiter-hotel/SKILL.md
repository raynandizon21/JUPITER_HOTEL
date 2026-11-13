---
name: jupiter-hotel
description: How to change the Jupiter Hotel PMS web app (React + Vite + Tailwind v4). Use for any task in this repo — adding or changing pages, tables, pop-ups, billing, settlement, room rates, Excel export, or the MySQL schema — so the change follows the app's domain rules and UI conventions.
---

# Jupiter Hotel PMS — working on this app

Read `CLAUDE.md` at the repo root first. It has the domain rules, the data model and the file map. This skill is the step-by-step checklist for making changes.

## 1. Before you change anything

- Find the component in the file map in `CLAUDE.md`. Shared helpers:
  - `src/utils/hotelHelpers.ts` — dates, rates, nightly breakdown
  - `src/utils/billing.ts` — folio, peso, print, ids
  - `src/components/ui.tsx` — `PageHeader`, `Dialog`, `MonthSelect`, `toast`
- Reuse helpers instead of writing new ones:
  - `formatLongDate`, `formatMonth`, `formatDateRange`
  - `peso`, `folioOf`, `getNightlyRates`, `todayISO`, `addDays`, `uid`

## 2. Domain checklist

- [ ] **Weekend** is Friday and Saturday only. **Holiday** nights use the weekend rate. Show the regular rate struck through.
- [ ] **Parse dates in UTC:** `new Date(d + 'T00:00:00Z')`.
- [ ] **Never store paid/partial/unpaid.** Derive it with `folioOf(r)`. After changing charges or payments, pass the booking through `syncStatus`.
- [ ] **Money and settlement month** come from the **check-in date** (`referenceMonth`).
- [ ] **Occupancy** ("rooms that night") = `checkIn ≤ date < checkOut`.
- [ ] **Changing the `Reservation` shape** in `src/types/hotel.ts`: update `migrateReservation` so bookings already saved in localStorage still load.
- [ ] **Bookings have no OIC.** Only hotel payments do.

## 3. UI checklist

- [ ] **Use the classes in `src/index.css`:** `.card`, `.btn btn-primary|btn-outline|btn-ghost|btn-accent`, `.input`, `.seg` + `data-active`, `.badge badge-ok|warn|bad|info|neutral`, `.dtable` (`compact`).
- [ ] **Every create / update / delete calls `toast(title, detail, tone?)`.**
- [ ] **Formats:** dates "November 11, 2026", months "November 2026", ranges "November 1 - 2, 2026", money "₱19,250".
- [ ] **No inner scrollbars on tables.** Paginate with `Pager` and size page length to the available height (see `DailySettlement.tsx`).
- [ ] **Pop-ups use `Dialog`.** No `backdrop-filter`.
- [ ] **Text is bilingual:** `en ? 'English' : '한국어'`, or keys in `src/i18n/translations.ts`.
- [ ] **Print with `printDocument`** (hidden iframe), never `window.open`.
- [ ] **Keep it simple.** The user prefers fewer columns, no redundant data, and layouts that fill the screen without empty space.

## 4. Data and database

- **The web app saves to localStorage only.** Keys are listed in `CLAUDE.md`, and there is no seed data.
- **Changing the MySQL schema:** edit `database/schema.sql`.
  - Keep `CREATE TABLE IF NOT EXISTS` and `INSERT IGNORE` so `npm run dev` stays safe to re-run.
  - Generated columns must be MySQL-safe. For example, use `CONCAT(YEAR(d), '-', LPAD(MONTH(d), 2, '0'))`, not `DATE_FORMAT`.
- **Never commit `.env`.** Update `.env.example` instead.

## 5. Excel export

- Lives in `src/utils/excelExport.ts` and is loaded lazily (`await import(...)`).
- **When you add or remove a column:**
  - update the header array, widths, `numFmt` cell indexes, `SUM` formula column letters and `autoFilter` width together;
  - re-check every index after the removed column.

## 6. Finish

```bash
npm run lint                                              # must pass
npx tsc --noEmit --noUnusedLocals --noUnusedParameters    # should print nothing
npx vite build
```

Then tell the user what changed in plain English, short and specific.

## Patching tips (Windows / Git Bash)

- **Avoid `\n` inside Python heredoc strings** that write TSX. They become real newlines and break string literals. Use the Edit tool, or raw strings for multi-line patches.
- **Long heredocs can fail with "unexpected EOF".** Write the patch script to the scratchpad with the Write tool and run it from there.
