import { Reservation, CasinoRatesConfig } from '../types/hotel';

/**
 * Formats a currency number with comma separation and currency code
 */
export function formatCurrency(amount: number, currency: 'PHP' | 'KRW' = 'PHP', showDecimals = false): string {
  if (isNaN(amount) || amount === null || amount === undefined) return `${currency} 0`;
  const formatted = showDecimals
    ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : amount.toLocaleString('en-US');
  return `${currency} ${formatted}`;
}

/**
 * Extracts reference month (YYYY-MM) from YYYY-MM-DD
 */
export function getReferenceMonth(dateStr: string): string {
  if (!dateStr || dateStr.length < 7) return '';
  return dateStr.substring(0, 7);
}

/**
 * Generates an array of all days in a given YYYY-MM month
 */
export function getDaysInMonth(yearMonth: string): string[] {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const daysInMonth = new Date(year, month, 0).getDate();

  const days: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = d < 10 ? `0${d}` : `${d}`;
    days.push(`${yearMonth}-${dayStr}`);
  }
  return days;
}

/** Parse YYYY-MM-DD as a UTC date so results don't depend on the PC's timezone. */
const utc = (d: string) => new Date(d + 'T00:00:00Z');
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** "2026-11" -> "November 2026" */
export function formatMonth(ym: string): string {
  if (!ym) return '';
  return utc(ym.slice(0, 7) + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "2026-11-11" -> "November 11, 2026" */
export function formatLongDate(dateStr: string): string {
  return utc(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Stay range, shortest readable form:
 *   same month  -> "November 1 - 2, 2026"
 *   same year   -> "November 28 - December 2, 2026"
 *   other years -> "December 30, 2026 - January 2, 2027"
 */
export function formatDateRange(start: string, end: string): string {
  if (!start || !end) return formatLongDate(start || end);
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  const mon = (m: number) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  if (ys !== ye) return `${formatLongDate(start)} - ${formatLongDate(end)}`;
  if (ms !== me) return `${mon(ms)} ${ds} - ${mon(me)} ${de}, ${ye}`;
  return `${mon(ms)} ${ds} - ${de}, ${ys}`;
}

/** Adds days to a YYYY-MM-DD string. */
export function addDays(dateStr: string, days: number): string {
  const d = utc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** Each night of a stay (check-in date up to, not including, check-out date). */
export function getStayNights(checkIn: string, checkOut: string): string[] {
  if (!checkIn || !checkOut) return [];
  const out: string[] = [];
  for (let d = checkIn; d < checkOut && out.length < 366; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Weekday = Sunday–Thursday, weekend = Friday–Saturday.
 * Dates flagged as holidays are charged at the weekend rate.
 */
export function getDayCategory(dateStr: string, holidayDates: string[] = []): 'weekday' | 'weekend' {
  if (holidayDates.includes(dateStr)) return 'weekend';
  const dow = utc(dateStr).getUTCDay(); // 0 Sun … 5 Fri, 6 Sat
  return dow === 5 || dow === 6 ? 'weekend' : 'weekday';
}

export interface NightRate {
  date: string;
  kind: 'weekday' | 'weekend' | 'holiday';
  rate: number; // what is charged (0 on a complimentary night)
  baseRate: number; // rate before any holiday override (= rate unless kind is 'holiday')
  listRate: number; // rate before the complimentary discount (holiday rate included)
  comp: boolean; // complimentary (free) night
}

/** Night-by-night room charges for a stay. */
export function getNightlyRates(
  checkIn: string,
  checkOut: string,
  roomId: string,
  occupancy: 'singleDouble' | 'triple',
  casinoRates: CasinoRatesConfig,
  holidayDates: string[] = [],
  compDates: string[] = []
): NightRate[] {
  const room = casinoRates.rooms.find((r) => r.id === roomId) || casinoRates.rooms[0];
  if (!room) return [];
  return getStayNights(checkIn, checkOut).map((date) => {
    const natural = getDayCategory(date);
    const holiday = natural === 'weekday' && holidayDates.includes(date);
    const weekday = occupancy === 'singleDouble' ? room.singleDoubleWeekday : room.tripleWeekday;
    const weekend = occupancy === 'singleDouble' ? room.singleDoubleWeekend : room.tripleWeekend;
    const baseRate = natural === 'weekend' ? weekend : weekday;
    const listRate = natural === 'weekend' || holiday ? weekend : weekday;
    const comp = compDates.includes(date);
    return { date, kind: holiday ? 'holiday' : natural, rate: comp ? 0 : listRate, baseRate, listRate, comp };
  });
}

/**
 * Calculates stay price using Casino Room Rates & Vouchers
 */
export function calculateCasinoStayPrice(
  checkIn: string,
  checkOut: string,
  roomId: string,
  occupancy: 'singleDouble' | 'triple',
  casinoRates: CasinoRatesConfig,
  vouchers: { breakfastCount: number; dinnerCount: number; extraBedCount: number } = {
    breakfastCount: 0,
    dinnerCount: 0,
    extraBedCount: 0,
  },
  holidayDates: string[] = [],
  compDates: string[] = []
): { total: number; roomTotal: number; voucherTotal: number; nights: number } {
  const nightly = getNightlyRates(checkIn, checkOut, roomId, occupancy, casinoRates, holidayDates, compDates);
  const nights = nightly.length;
  const roomTotal = nightly.reduce((a, n) => a + n.rate, 0);
  const voucherTotal =
    vouchers.breakfastCount * casinoRates.vouchers.breakfast +
    vouchers.dinnerCount * casinoRates.vouchers.dinner +
    vouchers.extraBedCount * casinoRates.vouchers.extraBed * nights;
  return { total: roomTotal + voucherTotal, roomTotal, voucherTotal, nights };
}

/**
 * Export reservations to CSV
 */
export function exportToCSV(reservations: Reservation[], filename = 'hotel_reservations.csv') {
  const headers = ['Guest Name', 'Confirmation No.', 'Room Type', 'Check-in Date', 'Check-out Date', 'Nights', 'Amount', 'Currency', 'Ref Month', 'Payment Status', 'Remarks'];
  const rows = reservations.map((r) => [
    `"${r.guestName}"`,
    `"${(r.confirmationNo || '').replace(/"/g, '""')}"`,
    `"${r.roomType}"`,
    `"${r.checkIn}"`,
    `"${r.checkOut}"`,
    r.nights,
    r.amount,
    `"${r.currency}"`,
    `"${r.referenceMonth}"`,
    `"${r.paymentStatus}"`,
    `"${r.remarks.replace(/"/g, '""')}"`,
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** "1 night" / "3 nights" (English), "3박" (Korean). */
export function nightsLabel(n: number, en = true): string {
  return en ? `${n} ${n === 1 ? 'night' : 'nights'}` : `${n}박`;
}

/** "1-Oct-26" — short date like the hotel's transaction sheet (used in the Daily Settlement table). */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const mon = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${d.getUTCDate()}-${mon}-${String(d.getUTCFullYear()).slice(2)}`;
}
