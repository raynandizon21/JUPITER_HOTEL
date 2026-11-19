import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Receipt, CalendarDays, BedDouble, Ticket } from 'lucide-react';
import { CasinoRatesConfig, FolioCharge, HotelPurchase, Reservation, VoucherSale } from '../types/hotel';
import { usePurchases } from './StockContext';
import { chargeAmount, folioOf, peso, voucherTotals } from '../utils/billing';
import { chargeStockItem } from '../utils/inventory';
import { addDays, formatLongDate, formatShortDate, formatMonth, getDaysInMonth, getDayCategory, getNightlyRates, getStayNights } from '../utils/hotelHelpers';
import { Language } from '../i18n/translations';
import { useFitRows } from '../utils/useFitRows';
import { PageHeader, Dialog, Pager, toast } from './ui';
import { GuestFolio } from './GuestFolio';
import { DateFilter } from './DateFilter';

interface Props {
  reservations: Reservation[];
  setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
  /** Vouchers bought without a room booking — shown per purchase date, for the record. */
  voucherSales?: VoucherSale[];
  casinoRates: CasinoRatesConfig;
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  language: Language;
  /** Render only the daily table (used inside Monthly Settlement). */
  embedded?: boolean;
}

export interface DailyRow {
  date: string;
  checkIns: number; // 체크인 목록 (건)
  inHouse: number; // 체크인 (예약 건수) — rooms occupied that night (명)
  nights: number; // 총 숙박 박수 (박)
  total: number; // 총 금액 (room + extras)
  roomAmount: number; // room nights of this day (junket rate = what the guest pays)
  hotelAmount: number; // hotel rate = what Jupiter pays the hotel for those room nights (bookings with a hotel cost)
  hotelNights: number; // room nights that day with a known hotel cost (so ₱0 = complimentary, not "unknown")
  hotelAll: number; // main table "Hotel rate": hotel cost of the room nights + vouchers of this day (bookings + vouchers only)
  hotelAllKnown: number; // lines in hotelAll with a known cost (0 = "—")
  junketAll: number; // main table "Junket rate": guest room nights + vouchers of this day (bookings + vouchers only)
  extrasAmount: number; // buffet / vouchers / extra bed charged on this day
  paid: number; // 결제 완료 (건)
  paidAmount: number; // amount collected from guests
  unpaid: number; // 미결제 건수 (건)
  unpaidAmount: number; // 미결제 금액
  vouchers: number; // voucher-only purchases that day (건) — for the record, not in the totals above
  voucherAmount: number; // their total (PHP)
}

export type DayShare = { total: number; paid: number; room: number; extras: number };

/**
 * Day-by-day value of one booking (for the daily audit):
 *  - room: each night's rate from the rate card (holiday / free nights included), scaled so the nights add up
 *    to the booked room amount (a manual price change is spread the same way); the last night takes the rounding;
 *  - extras / vouchers: on their charge date;
 *  - paid: the guest's payments cover the earliest days first, so each day's paid + unpaid = that day's value.
 */
export function bookingDays(r: Reservation, rates: CasinoRatesConfig): Map<string, DayShare> {
  const m = new Map<string, DayShare>();
  const add = (d: string, v: number, kind: 'room' | 'extras') => {
    const c = m.get(d) || { total: 0, paid: 0, room: 0, extras: 0 };
    c.total += v;
    c[kind] += v;
    m.set(d, c);
  };
  const room = rates.rooms.find((x) => x.name.toLowerCase() === r.roomType.toLowerCase());
  const nightly = room ? getNightlyRates(r.checkIn, r.checkOut, room.id, r.occupancy || 'singleDouble', rates, r.holidayDates, r.compDates) : [];
  const nights = nightly.length ? nightly.map((n) => ({ date: n.date, w: n.rate })) : getStayNights(r.checkIn, r.checkOut).map((d) => ({ date: d, w: 1 }));
  if (!nights.length) add(r.checkIn, r.amount, 'room');
  const wsum = nights.reduce((a, n) => a + n.w, 0);
  let left = r.amount;
  nights.forEach((n, i) => {
    const v = i === nights.length - 1 ? left : Math.round(wsum ? (r.amount * n.w) / wsum : r.amount / nights.length);
    left -= v;
    add(n.date, v, 'room');
  });
  for (const c of r.charges || []) {
    const v = chargeAmount(c);
    if (v) add(c.date, v, 'extras');
  }
  let paid = (r.payments || []).reduce((a, p) => a + p.amount, 0);
  for (const d of [...m.keys()].sort()) {
    const sh = m.get(d)!;
    sh.paid = Math.max(0, Math.min(sh.total, paid));
    paid -= sh.paid;
  }
  return m;
}

export function buildDailyRows(reservations: Reservation[], month: string, voucherSales: VoucherSale[] = [], rates?: CasinoRatesConfig, purchases: HotelPurchase[] = []): DailyRow[] {
  return buildDailyRowsFor(reservations, getDaysInMonth(month), voucherSales, rates, purchases);
}

/**
 * Hotel rate per night of one booking, from the purchase saved with it (`buy-<bookingId>`):
 * paid nights at the unit cost, complimentary nights (₱0 lines) on the first nights — same as the form.
 * Bookings without a hotel cost give nothing.
 */
export function hotelNights(r: Reservation, purchases: HotelPurchase[]): Map<string, number> {
  const m = new Map<string, number>();
  const p = purchases.find((x) => x.id === `buy-${r.id}`);
  const rooms = (p?.items || []).filter((i) => i.kind === 'room');
  if (!rooms.length) return m;
  const comp = rooms.filter((i) => !i.unitCost).reduce((a, i) => a + i.qty, 0);
  const cost = rooms.find((i) => i.unitCost > 0)?.unitCost ?? 0;
  getStayNights(r.checkIn, r.checkOut).forEach((d, i) => m.set(d, i < comp ? 0 : cost));
  return m;
}

/** Hotel cost of one voucher line, from the purchase saved with its booking / voucher sale (null = no cost entered). */
export function voucherHotelCost(c: FolioCharge, buyId: string, purchases: HotelPurchase[]): number | null {
  const v = chargeStockItem(c);
  const line = v ? purchases.find((p) => p.id === buyId)?.items.find((i) => i.kind === 'voucher' && i.item === v) : undefined;
  return line ? c.qty * line.unitCost : null;
}

/** Same as buildDailyRows, for any list of dates (the Date / Date Range filter). */
export function buildDailyRowsFor(reservations: Reservation[], dates: string[], voucherSales: VoucherSale[] = [], rates?: CasinoRatesConfig, purchases: HotelPurchase[] = []): DailyRow[] {
  const shares = rates ? reservations.map((r) => bookingDays(r, rates)) : null;
  const hotel = reservations.map((r) => hotelNights(r, purchases));
  return dates.map((date) => {
    const arriving = reservations.filter((r) => r.checkIn === date);
    const folios = arriving.map(folioOf);
    const sold = voucherSales.filter((v) => v.date === date);
    // day-by-day audit: every booking's share of this day (room night + extras on this date)
    let dayTotal = 0;
    let dayPaid = 0;
    let dayRoom = 0;
    let dayExtras = 0;
    if (shares)
      for (const sh of shares) {
        const x = sh.get(date);
        if (x) {
          dayTotal += x.total;
          dayPaid += x.paid;
          dayRoom += x.room;
          dayExtras += x.extras;
        }
      }
    const roomAmount = shares ? dayRoom : folios.reduce((a, f) => a + f.room, 0);
    const hotelAmount = hotel.reduce((a, h) => a + (h.get(date) || 0), 0);
    const hotelNightsN = hotel.filter((h) => h.has(date)).length;
    const voucherAmount = sold.reduce((a, v) => a + voucherTotals(v).total, 0);
    // vouchers of this day: with a booking (charge date) and vouchers-only (purchase date)
    const bookingVouchers = reservations.flatMap((r) => (r.charges || []).filter((c) => c.date === date && chargeStockItem(c)).map((c) => ({ c, buyId: `buy-${r.id}` })));
    const vCosts = [...bookingVouchers, ...sold.flatMap((v) => v.items.map((c) => ({ c, buyId: `buy-${v.id}` })))].map((x) => voucherHotelCost(x.c, x.buyId, purchases)).filter((x): x is number => x !== null);
    return {
      date,
      checkIns: arriving.length,
      inHouse: reservations.filter((r) => r.checkIn <= date && date < r.checkOut).length,
      // 1 room occupied that night = 1 night stayed (new arrivals + guests still staying)
      nights: reservations.filter((r) => r.checkIn <= date && date < r.checkOut).length,
      total: shares ? dayTotal : folios.reduce((a, f) => a + f.total, 0),
      roomAmount,
      hotelAmount,
      hotelNights: hotelNightsN,
      hotelAll: hotelAmount + vCosts.reduce((a, x) => a + x, 0),
      hotelAllKnown: hotelNightsN + vCosts.length,
      junketAll: roomAmount + bookingVouchers.reduce((a, x) => a + chargeAmount(x.c), 0) + voucherAmount,
      extrasAmount: shares ? dayExtras : folios.reduce((a, f) => a + f.extras, 0),
      paid: folios.filter((f) => f.balance <= 0).length,
      paidAmount: shares ? dayPaid : folios.reduce((a, f) => a + f.paid, 0),
      unpaid: folios.filter((f) => f.balance > 0).length,
      unpaidAmount: shares ? dayTotal - dayPaid : folios.reduce((a, f) => a + Math.max(f.balance, 0), 0),
      vouchers: sold.length,
      voucherAmount,
    };
  });
}

export const DailySettlement: React.FC<Props> = ({ reservations, setReservations, voucherSales = [], casinoRates, selectedMonth, language, embedded = false }) => {
  const en = language === 'en';
  const month = selectedMonth || '2026-11';
  // Date / Date Range filter (same as the Guest Ledger); the range starts as the selected month
  const monthRange = (ym: string): [string, string] => [`${ym}-01`, getDaysInMonth(ym).slice(-1)[0]];
  const [dateMode, setDateMode] = useState<'date' | 'range'>('range');
  const [day, setDay] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  });
  const [range, setRange] = useState<[string, string]>(() => monthRange(month));
  useEffect(() => {
    setRange(monthRange(month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);
  const dates = useMemo(() => {
    if (dateMode === 'date') return [day];
    const [a, b] = range[0] && range[1] ? range : monthRange(month);
    const out: string[] = [];
    for (let d = a; d <= b && out.length < 366; d = addDays(d, 1)) out.push(d);
    return out;
  }, [dateMode, day, range, month]);
  const periodLabel =
    dates.length === 1
      ? formatShortDate(dates[0])
      : dates[0] === `${dates[0].slice(0, 7)}-01` && dates[dates.length - 1] === getDaysInMonth(dates[0].slice(0, 7)).slice(-1)[0]
      ? formatMonth(dates[0].slice(0, 7))
      : `${formatShortDate(dates[0])} – ${formatShortDate(dates[dates.length - 1])}`;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [view, setView] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [dayPage, setDayPage] = useState(0);
  const [dayTab, setDayTab] = useState<'in' | 'stay' | 'buffet'>('in');
  // guests per page in the day pop-up: as many as fit the window (rows ≈ 50px, the rest is header/summary/pager)
  const [winH, setWinH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setWinH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const PAGE = Math.max(4, Math.floor((winH - 440) / 50));
  const open = (date: string, v: 'all' | 'paid' | 'unpaid') => {
    setDayPage(0);
    setView(v);
    setSelectedDate(date);
    setDayTab(reservations.some((r) => r.checkIn === date) ? 'in' : reservations.some((r) => r.checkIn < date && date < r.checkOut) ? 'stay' : 'buffet');
  };
  const [folioId, setFolioId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const purchases = usePurchases();
  const rows = useMemo(() => buildDailyRowsFor(reservations, dates, voucherSales, casinoRates, purchases), [reservations, dates, voucherSales, casinoRates, purchases]);

  // each booking's value per day (used by the day pop-up's "This day" column)
  const dayShares = useMemo(() => new Map(reservations.map((r) => [r.id, bookingDays(r, casinoRates)])), [reservations, casinoRates]);

  const t = useMemo(() => {
    const sum = (k: keyof DailyRow) => rows.reduce((a, r) => a + (r[k] as number), 0);
    // guests in the period = arrivals + those already in the room on its first day (each counted once)
    const guests = sum('checkIns') + (rows[0] ? rows[0].inHouse - rows[0].checkIns : 0);
    return { checkIns: sum('checkIns'), guests, nights: sum('nights'), total: sum('total'), roomAmount: sum('roomAmount'), hotelAmount: sum('hotelAmount'), hotelAll: sum('hotelAll'), junketAll: sum('junketAll'), extrasAmount: sum('extrasAmount'), voucherAmount: sum('voucherAmount'), paid: sum('paid'), paidAmount: sum('paidAmount'), unpaid: sum('unpaid'), unpaidAmount: sum('unpaidAmount') };
  }, [rows]);

  // "주피터고객이 사용중인객실" — rooms in use today (or on the 1st day of a past/future month)
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const refDate = todayISO.startsWith(month) ? todayISO : rows.reduce((b, r) => (r.inHouse > b.inHouse ? r : b), rows[0])?.date;
  const inHouseNow = rows.find((r) => r.date === refDate)?.inHouse ?? 0;

  const visible = rows;
  // table pagination, opening on the page that holds today.
  // As many normal-height rows as fit the card (no stretched rows, no inner scroll).
  // rows per page = as many as fit the card; loop-proof (see useFitRows)
  const [areaRef, fitRows] = useFitRows({ rowSelector: 'tbody tr:not([data-filler])', fallbackRow: 36, initial: 5, deps: [rows] });
  const TABLE_PAGE = fitRows;
  const [tablePage, setTablePage] = useState(0);
  const tablePages = Math.max(1, Math.ceil(visible.length / TABLE_PAGE));
  useEffect(() => {
    const i = visible.findIndex((r) => r.date === todayISO);
    setTablePage(i >= 0 ? Math.floor(i / TABLE_PAGE) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, TABLE_PAGE]);
  const pageRows = visible.slice(tablePage * TABLE_PAGE, tablePage * TABLE_PAGE + TABLE_PAGE);
  const dayAll = selectedDate ? reservations.filter((r) => r.checkIn === selectedDate) : [];
  const byView = (r: Reservation) => (view === 'all' ? true : view === 'paid' ? folioOf(r).balance <= 0 : folioOf(r).balance > 0);
  const detail = dayAll.filter(byView);
  // guests who checked in on an earlier day and are still in the room that night
  const stayingAll = selectedDate ? reservations.filter((r) => r.checkIn < selectedDate && selectedDate < r.checkOut) : [];
  const staying = stayingAll.filter(byView);
  const unit = (n: number, ko: string) => (en ? n.toLocaleString() : `${n.toLocaleString()}${ko}`);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { exportDailyExcel } = await import('../utils/excelExport');
      await exportDailyExcel(dates[0].slice(0, 7), rows, inHouseNow);
      toast(en ? 'Excel exported' : '엑셀 내보내기 완료', `Daily_Settlement_${dates[0].slice(0, 7)}.xlsx`);
    } catch (e) {
      console.error(e);
      toast(en ? 'Export failed' : '내보내기 실패', String(e), 'bad');
    } finally {
      setExporting(false);
    }
  };

  // Column groups are colour-coded: blue = check-ins / occupancy, green = paid, red = unpaid.
  const HEAD_TONE = {
    none: { th: '', ko: 'text-ink', en: 'text-muted' },
    info: { th: '!bg-accent-soft', ko: 'text-accent', en: 'text-accent/70' },
    ok: { th: '!bg-ok-soft', ko: 'text-ok', en: 'text-ok/70' },
    bad: { th: '!bg-bad-soft', ko: 'text-bad', en: 'text-bad/70' },
    warn: { th: '!bg-warn-soft', ko: 'text-warn', en: 'text-warn/70' },
    violet: { th: '!bg-violet-soft', ko: 'text-violet', en: 'text-violet/70' },
  } as const;
  const H: React.FC<{ ko: string; enLabel: string; align?: 'l' | 'c' | 'r'; tip?: string; tone?: keyof typeof HEAD_TONE }> = ({ ko, enLabel, align = 'c', tip, tone = 'none' }) => (
    <th className={`${align === 'r' ? 'r' : align === 'c' ? 'c' : ''} !whitespace-normal !px-2 ${HEAD_TONE[tone].th}`} title={tip}>
      <div className={`normal-case tracking-normal text-[12px] font-semibold ${HEAD_TONE[tone].ko}`}>{ko}</div>
      <div className={`text-[10px] mt-0.5 ${HEAD_TONE[tone].en}`}>{enLabel}</div>
    </th>
  );

  return (
    <div className={embedded ? 'h-full' : undefined}>
      {!embedded && <PageHeader title={en ? 'Daily Settlement' : '일별 정산'} />}

      <div className={`card overflow-hidden flex flex-col ${embedded ? 'h-full' : 'h-[calc(100vh-270px)] min-h-[360px]'}`}>
        <div className="card-head">
          <div>
            <h3 className="card-title flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-[10px] grid place-items-center bg-accent-soft text-accent">
                <CalendarDays className="w-4 h-4" strokeWidth={1.75} />
              </span>
              {en ? 'Daily Settlement' : '일별 정산'}
            </h3>
            <p className="text-[12.5px] text-muted mt-0.5">{en ? 'Click a day with check-ins to see the guests' : '체크인이 있는 날짜를 클릭하면 손님 목록이 표시됩니다'}</p>
          </div>
          <div className="flex items-end gap-2">
            <DateFilter en={en} mode={dateMode} onMode={setDateMode} date={day} onDate={setDay} from={range[0]} to={range[1]} onRange={(a, b) => setRange([a, b])} />
            <button onClick={exportExcel} disabled={exporting} className="btn btn-outline btn-sm !h-[30px]">
              <FileSpreadsheet className="w-3.5 h-3.5 text-ok" />
              {exporting ? (en ? 'Exporting…' : '내보내는 중…') : en ? 'Excel' : '엑셀'}
            </button>
          </div>
        </div>

        <div ref={areaRef} className="flex-1 relative min-h-[200px] overflow-hidden">
          <table className="dtable compact absolute inset-0 h-full table-fixed">
            {/* date column fixed, the 8 number columns share the rest equally */}
            <colgroup>
              <col className="w-[200px]" />
              {Array.from({ length: 8 }, (_, i) => (
                <col key={i} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <H ko="날짜" enLabel="Date" align="l" />
                <H tone="info" ko="체크인 목록" enLabel="Check-in list" tip={en ? 'Guests who arrived on this day' : '이날 도착한 손님 수'} />
                <H tone="info" ko="뷔페·추가" enLabel="Buffet / extras" align="r" tip={en ? 'Vouchers, extra bed and other charges on this day (with a room booking)' : '이날 바우처·엑스트라 베드 등 추가 요금 (객실 예약 포함)'} />
                <H
                  tone="info"
                  ko="총 금액"
                  enLabel="Total amount"
                  align="r"
                  tip={en ? 'Room + buffet / extras of this day (= paid + unpaid)' : '객실 + 뷔페·추가 (= 결제 + 미결제)'}
                />
                <H tone="ok" ko="결제 금액" enLabel="Paid amount" align="r" tip={en ? 'All money received that day, including partial payments' : '부분 결제 포함 받은 금액'} />
                <H tone="bad" ko="미결제 금액" enLabel="Unpaid amount" align="r" />
                <H
                  tone="violet"
                  ko="호텔 요금"
                  enLabel="Hotel rate"
                  align="r"
                  tip={en ? 'What Jupiter pays the hotel for this day: room nights + vouchers (bookings and vouchers only, hotel cost saved with each)' : '이날 주피터가 호텔에 지불하는 금액: 숙박 + 바우처 (예약·바우처 단독, 입력한 호텔 원가)'}
                />
                <H tone="info" ko="정킷 요금" enLabel="Junket rate" align="r" tip={en ? 'What guests pay for this day: room nights + vouchers (bookings and vouchers only)' : '이날 손님 요금: 숙박 + 바우처 (예약·바우처 단독)'} />
                <H
                  tone="warn"
                  ko="바우처 판매"
                  enLabel="Vouchers sold"
                  align="r"
                  tip={en ? 'Vouchers bought without a room booking, by purchase date — for the record (not in the totals)' : '객실 예약 없이 구매한 바우처 (구매일 기준, 기록용 · 합계 미포함)'}
                />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const has = r.checkIns > 0;
                // guests who arrived on an earlier day and are still in the room that night
                const staying = r.inHouse - r.checkIns;
                const d = new Date(r.date + 'T00:00:00');
                const wknd = getDayCategory(r.date) === 'weekend';
                const isToday = r.date === todayISO;
                const z = (v: number, ko: string) => (v ? <span>{unit(v, ko)}</span> : <span className="text-faint">—</span>);
                return (
                  <tr
                    key={r.date}
                    onClick={() => (has || staying > 0 || r.total > 0) && open(r.date, 'all')}
                    className={`${has || staying > 0 ? 'cursor-pointer' : ''} ${isToday ? '!bg-accent-line' : ''}`}
                  >
                    <td className={`whitespace-nowrap ${isToday ? 'shadow-[inset_3px_0_0_var(--color-accent)]' : ''}`} title={isToday ? (en ? 'Today' : '오늘') : undefined}>
                      <span className={`num ${isToday ? 'font-bold text-accent-strong' : has ? 'font-medium text-ink' : 'font-medium text-ink-2'}`} title={formatLongDate(r.date)}>{formatShortDate(r.date)}</span>
                      <span className={`ml-2 text-[11.5px] ${wknd ? 'text-[#c0662b] font-medium' : 'text-faint'}`}>
                        {d.toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'short' })}
                      </span>
                    </td>
                    <td className="c num bg-accent-soft/30 whitespace-nowrap">
                      {/* arrivals + guests still staying (merged) */}
                      {r.inHouse > 0 ? (
                        <span
                          className={`badge num ${has ? 'badge-info' : 'badge-neutral'}`}
                          title={en ? `${r.checkIns} arrived · ${staying} still staying` : `도착 ${r.checkIns} · 계속 투숙 ${staying}`}
                        >
                          {unit(r.inHouse, '건')}
                        </span>
                      ) : (
                        z(0, '건')
                      )}
                    </td>
                    <td className="r num bg-accent-soft/30 whitespace-nowrap">{r.extrasAmount ? peso(r.extrasAmount) : <span className="text-faint">—</span>}</td>
                    <td className="r num bg-accent-soft/30 whitespace-nowrap">
                      {r.total > 0 ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            open(r.date, 'all');
                          }}
                          className="num font-semibold text-ink cursor-pointer underline decoration-dotted underline-offset-4 hover:decoration-solid"
                          title={en ? 'Show the bookings of this day' : '이날 예약 보기'}
                        >
                          {peso(r.total)}
                        </button>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="r bg-ok-soft/30">
                      {!r.total ? <span className="text-faint">—</span> : r.paidAmount ? <Link value={peso(r.paidAmount)} tone="ok" onClick={() => open(r.date, 'all')} /> : <span className="num text-muted">{peso(0)}</span>}
                    </td>
                    <td className="r bg-bad-soft/30">
                      {!r.total ? <span className="text-faint">—</span> : r.unpaidAmount ? <Link value={peso(r.unpaidAmount)} tone="bad" onClick={() => open(r.date, 'unpaid')} /> : <span className="num text-muted">{peso(0)}</span>}
                    </td>
                    <td className="r num bg-violet-soft/30 whitespace-nowrap">{!r.hotelAllKnown ? (
                        <span className="text-faint">—</span>
                      ) : r.hotelAll ? (
                        peso(r.hotelAll)
                      ) : (
                        <span className="text-ok text-[11.5px] font-medium">{en ? 'Complimentary' : '무료'}</span>
                      )}</td>
                    <td className="r num bg-accent-soft/30 whitespace-nowrap">{r.junketAll ? peso(r.junketAll) : <span className="text-faint">—</span>}</td>
                    <td
                      className="r bg-warn-soft/30"
                      title={
                        r.vouchers
                          ? voucherSales
                              .filter((v) => v.date === r.date)
                              .map((v) => `${v.guestName}: ${v.items.map((c) => `${c.description} × ${c.qty}`).join(', ')} = ${peso(voucherTotals(v).total)}`)
                              .join('\n')
                          : undefined
                      }
                    >
                      {r.vouchers ? <span className="num font-semibold text-warn">{peso(r.voucherAmount)}</span> : <span className="text-faint">—</span>}
                    </td>
                  </tr>
                );
              })}
              {/* takes up the space left over, so the grand total always sits at the bottom */}
              <tr data-filler aria-hidden style={{ height: '100%' }} className="hover:!bg-transparent">
                <td colSpan={9} className="!p-0 !border-0" />
              </tr>
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="whitespace-nowrap">{en ? `Grand total · ${periodLabel}` : `총합계 · ${periodLabel}`}</td>
                <td className="c num" title={en ? 'Guests in the room during this period (each counted once)' : '기간 중 투숙 손님 수 (중복 제외)'}>
                  {t.guests || '—'}
                </td>
                <td className="r num">{peso(t.extrasAmount)}</td>
                <td className="r num text-ink">{peso(t.total)}</td>
                <td className="r num text-ok">{peso(t.paidAmount)}</td>
                <td className="r num text-bad">{peso(t.unpaidAmount)}</td>
                <td className="r num text-violet">{peso(t.hotelAll)}</td>
                <td className="r num">{peso(t.junketAll)}</td>
                <td className="r num text-warn">{t.voucherAmount ? peso(t.voucherAmount) : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {/* always shown (page numbers only when needed) so the table area never jumps in height */}
        {visible.length > 0 && (
          <Pager page={tablePage} pages={tablePages} total={visible.length} size={TABLE_PAGE} onPage={setTablePage} en={en} unitLabel={en ? 'days' : '일'} />
        )}
      </div>

      {selectedDate && (() => {
        const nightNo = (r: Reservation) => Math.round((Date.parse(selectedDate) - Date.parse(r.checkIn)) / 86400000) + 1;
        const dayRow = rows.find((x) => x.date === selectedDate);
        const shortDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

        // buffet / vouchers / extras on this date: from room bookings (charges) and voucher-only purchases
        const buffet = [
          ...reservations.flatMap((r) =>
            (r.charges || []).filter((c) => c.date === selectedDate).map((c) => ({ key: `r-${r.id}-${c.id}`, guest: r.guestName, src: 'room' as const, c, resId: r.id, buyId: `buy-${r.id}` }))
          ),
          ...voucherSales.filter((v) => v.date === selectedDate).flatMap((v) => v.items.map((c) => ({ key: `v-${v.id}-${c.id}`, guest: v.guestName, src: 'voucher' as const, c, resId: '', buyId: `buy-${v.id}` }))),
        ];
        const buffetTotal = buffet.reduce((a, x) => a + chargeAmount(x.c), 0);
        // hotel cost of a buffet / voucher line (null = not bought through a booking / voucher form)
        const buffetCost = (x: (typeof buffet)[number]) => voucherHotelCost(x.c, x.buyId, purchases);
        const buffetCosts = buffet.map(buffetCost);
        const buffetHotel = buffetCosts.reduce<number>((a, c) => a + (c || 0), 0);
        const z = <span className="text-faint">—</span>;
        const comp = <span className="text-ok">{en ? 'Complimentary' : '무료'}</span>;

        const guestRows = dayTab === 'in' ? detail : staying;
        const pages = Math.max(1, Math.ceil((dayTab === 'buffet' ? buffet.length : guestRows.length) / PAGE));
        const cur = Math.min(dayPage, pages - 1);

        const shareOf = (res: Reservation) => dayShares.get(res.id)?.get(selectedDate) || { total: 0, paid: 0, room: 0, extras: 0 };
        const hotelOf = (res: Reservation) => hotelNights(res, purchases).get(selectedDate);
        const guestRow = (res: Reservation) => {
          const share = shareOf(res);
          const hotelCost = hotelOf(res);
          const due = share.total - share.paid;
          return (
            <tr key={res.id}>
              <td>
                <span className="inline-flex items-center gap-2 font-medium text-accent">
                  <BedDouble className="w-4 h-4 shrink-0" />
                  <span className="text-ink">{res.guestName}</span>
                </span>
                <div className="text-[11px] text-muted pl-6">{res.roomType}</div>
              </td>
              <td className="whitespace-nowrap text-ink-2">
                {shortDay(res.checkIn)} → {shortDay(res.checkOut)}
                <div className="text-[11px] text-muted">{en ? `Night ${nightNo(res)} of ${res.nights}` : `${res.nights}박 중 ${nightNo(res)}박째`}</div>
              </td>
              <td className="r num text-ink-2">{share.extras ? peso(share.extras) : z}</td>
              <td className="r num font-semibold text-ink">{peso(share.total)}</td>
              <td className={`r num ${share.paid ? 'text-ok' : 'text-muted'}`}>{peso(share.paid)}</td>
              <td className={`r num ${due > 0 ? 'text-bad font-semibold' : 'text-muted'}`}>{peso(due)}</td>
              <td className="r num text-ink-2">{hotelCost === undefined ? z : hotelCost === 0 ? comp : peso(hotelCost)}</td>
              <td className="r num text-ink-2">{share.room ? peso(share.room) : z}</td>
              <td className="r">
                <button onClick={() => setFolioId(res.id)} className="icon-btn" title={en ? 'Billing' : '청구서'}>
                  <Receipt className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          );
        };
        const sumRows = (list: Reservation[]) =>
          list.reduce(
            (a, res) => {
              const sh = shareOf(res);
              return { hotel: a.hotel + (hotelOf(res) || 0), room: a.room + sh.room, extras: a.extras + sh.extras, total: a.total + sh.total, paid: a.paid + sh.paid };
            },
            { hotel: 0, room: 0, extras: 0, total: 0, paid: 0 }
          );

        const tabs = [
          { key: 'in' as const, label: en ? 'Checked in' : '체크인', n: detail.length, on: 'bg-ok-soft text-ok', bar: 'bg-ok', pill: 'bg-ok text-white' },
          { key: 'stay' as const, label: en ? 'Still staying' : '계속 투숙', n: staying.length, on: 'bg-info-soft text-info', bar: 'bg-info', pill: 'bg-info text-white' },
          { key: 'buffet' as const, label: en ? 'Buffet & vouchers' : '뷔페·바우처', n: buffet.length, on: 'bg-warn-soft text-warn', bar: 'bg-warn', pill: 'bg-warn text-white' },
        ];

        return (
          <Dialog width="max-w-5xl" onClose={() => setSelectedDate(null)} title={<>{en ? 'Guests · ' : '손님 · '}{formatLongDate(selectedDate)}</>}>
            {/* value of the day — same order as the table columns */}
            <div className="px-6 pt-4 grid grid-cols-6 gap-2">
              {(
                [
                  [en ? 'Buffet / extras' : '뷔페·추가', peso(dayRow?.extrasAmount || 0), 'text-ink-2'],
                  [en ? 'Total amount' : '총 금액', peso(dayRow?.total || 0), 'text-ink'],
                  [en ? 'Paid' : '결제', peso(dayRow?.paidAmount || 0), 'text-ok'],
                  [en ? 'Unpaid' : '미결제', peso(dayRow?.unpaidAmount || 0), dayRow?.unpaidAmount ? 'text-bad' : 'text-muted'],
                  [
                    en ? 'Hotel rate' : '호텔 요금',
                    !dayRow?.hotelNights ? '—' : dayRow.hotelAmount ? peso(dayRow.hotelAmount) : en ? 'Complimentary' : '무료',
                    dayRow?.hotelNights && !dayRow.hotelAmount ? 'text-ok' : 'text-violet',
                  ],
                  [en ? 'Junket rate' : '정킷 요금', peso(dayRow?.roomAmount || 0), 'text-ink-2'],
                ] as const
              ).map(([label, value, tone], i) => (
                <div key={label} className={`rounded-lg border px-3 py-2 ${i === 1 ? 'border-ink/15 bg-surface' : 'border-line bg-sunken'}`}>
                  <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted">{label}</div>
                  <div className={`num mt-0.5 font-semibold leading-tight ${i === 1 ? 'text-[17px]' : 'text-[14px]'} ${tone}`}>{value}</div>
                </div>
              ))}
            </div>

            {/* tabs */}
            <div className="px-6 mt-3 flex items-center gap-1 border-b border-line">
              {tabs.map((tb) => (
                <button
                  key={tb.key}
                  onClick={() => {
                    setDayTab(tb.key);
                    setDayPage(0);
                  }}
                  className={`relative px-3.5 py-2 rounded-t-lg text-[13px] font-semibold cursor-pointer transition-colors inline-flex items-center gap-1.5 ${dayTab === tb.key ? tb.on : 'text-muted hover:text-ink-2 hover:bg-sunken'}`}
                >
                  {tb.label}
                  <span className={`num min-w-[20px] h-[18px] px-1.5 rounded-full text-[11px] grid place-items-center ${dayTab === tb.key ? tb.pill : 'bg-canvas text-muted'}`}>{tb.n}</span>
                  {dayTab === tb.key && <span className={`absolute left-0 right-0 -bottom-px h-[2px] ${tb.bar}`} />}
                </button>
              ))}
              {view !== 'all' && (
                <button onClick={() => setView('all')} className="badge badge-neutral cursor-pointer ml-auto">
                  {view === 'paid' ? (en ? 'Paid only' : '결제만') : en ? 'Unpaid only' : '미결제만'} ✕
                </button>
              )}
            </div>

            <div className="px-6 py-4">
              {dayTab !== 'buffet' ? (
                <table className="dtable compact whitespace-nowrap">
                  <thead>
                    <tr>
                      <th className="!bg-sunken">{en ? 'Guest' : '손님'}</th>
                      <th className="!bg-sunken">{en ? 'Stay' : '숙박'}</th>
                      <th className="r !bg-accent-soft !text-accent">{en ? 'Buffet / extras' : '뷔페·추가'}</th>
                      <th className="r !bg-accent-soft !text-accent">{en ? 'Total' : '총 금액'}</th>
                      <th className="r !bg-ok-soft !text-ok">{en ? 'Paid' : '결제'}</th>
                      <th className="r !bg-bad-soft !text-bad">{en ? 'Unpaid' : '미결제'}</th>
                      <th className="r !bg-violet-soft !text-violet">{en ? 'Hotel rate' : '호텔 요금'}</th>
                      <th className="r !bg-accent-soft !text-accent">{en ? 'Junket rate' : '정킷 요금'}</th>
                      <th className="w-10 !bg-sunken" />
                    </tr>
                  </thead>
                  <tbody>
                    {guestRows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="!py-8 text-center text-muted">{en ? 'None' : '없음'}</td>
                      </tr>
                    )}
                    {guestRows.slice(cur * PAGE, cur * PAGE + PAGE).map(guestRow)}
                  </tbody>
                  {guestRows.length > 0 &&
                    (() => {
                      const t = sumRows(guestRows);
                      return (
                        <tfoot>
                          <tr>
                            <td colSpan={2}>
                              {en ? 'Total' : '합계'}{' '}
                              <span className="text-muted font-normal">
                                · {guestRows.length} {en ? (guestRows.length === 1 ? 'guest' : 'guests') : '명'}
                              </span>
                            </td>
                            <td className="r num">{peso(t.extras)}</td>
                            <td className="r num text-ink">{peso(t.total)}</td>
                            <td className="r num text-ok">{peso(t.paid)}</td>
                            <td className="r num text-bad">{peso(t.total - t.paid)}</td>
                            <td className="r num">{peso(t.hotel)}</td>
                            <td className="r num">{peso(t.room)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      );
                    })()}
                </table>
              ) : (
                <table className="dtable compact whitespace-nowrap">
                  <thead>
                    <tr>
                      <th className="!bg-sunken">{en ? 'Guest' : '손님'}</th>
                      <th className="!bg-warn-soft !text-warn">{en ? 'Item' : '항목'}</th>
                      <th className="c !bg-warn-soft !text-warn">{en ? 'Type' : '구분'}</th>
                      <th className="c !bg-warn-soft !text-warn">{en ? 'Qty' : '수량'}</th>
                      <th className="r !bg-warn-soft !text-warn">{en ? 'Unit price' : '단가'}</th>
                      <th className="r !bg-violet-soft !text-violet">{en ? 'Hotel cost' : '호텔 원가'}</th>
                      <th className="r !bg-accent-soft !text-accent">{en ? 'Amount' : '금액'}</th>
                      <th className="w-10 !bg-sunken" />
                    </tr>
                  </thead>
                  <tbody>
                    {buffet.length === 0 && (
                      <tr>
                        <td colSpan={8} className="!py-8 text-center text-muted">{en ? 'No buffet or vouchers on this day' : '이 날짜 뷔페·바우처 없음'}</td>
                      </tr>
                    )}
                    {buffet.slice(cur * PAGE, cur * PAGE + PAGE).map((x, i) => {
                      const cost = buffetCosts[cur * PAGE + i];
                      const isVoucher = !!chargeStockItem(x.c);
                      return (
                        <tr key={x.key}>
                          <td className="font-medium text-ink">{x.guest}</td>
                          <td>
                            <span className={`inline-flex items-center gap-2 font-medium ${isVoucher ? 'text-warn' : 'text-muted'}`}>
                              {isVoucher ? <Ticket className="w-4 h-4" /> : <Receipt className="w-4 h-4" />}
                              <span className="text-ink">{x.c.description}</span>
                            </span>
                          </td>
                          <td className="c">
                            <span className={`badge ${x.src === 'room' ? 'badge-info' : 'badge-warn'}`}>
                              {x.src === 'room' ? (en ? 'Room booking' : '객실 예약') : en ? 'Vouchers only' : '바우처만'}
                            </span>
                          </td>
                          <td className="c num">{x.c.qty}</td>
                          <td className="r num text-ink-2">{x.c.free ? comp : peso(x.c.unitPrice)}</td>
                          <td className="r num text-ink-2">{cost === null ? z : cost === 0 ? comp : peso(cost)}</td>
                          <td className="r num font-semibold text-ink">{peso(chargeAmount(x.c))}</td>
                          <td className="r">
                            {x.resId && (
                              <button onClick={() => setFolioId(x.resId)} className="icon-btn" title={en ? 'Billing' : '청구서'}>
                                <Receipt className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {buffet.length > 0 && (
                    <tfoot>
                      <tr>
                        <td colSpan={3}>
                          {en ? 'Total' : '합계'}{' '}
                          <span className="text-muted font-normal">
                            · {buffet.length} {en ? (buffet.length === 1 ? 'item' : 'items') : '건'}
                          </span>
                        </td>
                        <td className="c num">{buffet.reduce((a, x) => a + x.c.qty, 0)}</td>
                        <td />
                        <td className="r num">{peso(buffetHotel)}</td>
                        <td className="r num text-ink">{peso(buffetTotal)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
              {pages > 1 && <Pager page={cur} pages={pages} total={dayTab === 'buffet' ? buffet.length : guestRows.length} size={PAGE} onPage={setDayPage} en={en} />}
            </div>
            <div className="px-6 py-3 border-t border-line bg-sunken flex justify-end">
              <button onClick={() => setSelectedDate(null)} className="btn btn-ghost">
                {en ? 'Close' : '닫기'}
              </button>
            </div>
          </Dialog>
        );
      })()}

      {folioId && reservations.find((r) => r.id === folioId) && (
        <GuestFolio
          reservation={reservations.find((r) => r.id === folioId)!}
          casinoRates={casinoRates}
          en={en}
          onChange={(next) => setReservations((prev) => prev.map((r) => (r.id === next.id ? next : r)))}
          onClose={() => setFolioId(null)}
        />
      )}
    </div>
  );
};


/** A number that opens the day breakdown (paid / unpaid); shows "—" when empty. */
const Link: React.FC<{ value: string; tone: 'ok' | 'bad'; onClick: () => void }> = ({ value, tone, onClick }) =>
  value ? (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`num font-semibold cursor-pointer underline decoration-dotted underline-offset-4 hover:decoration-solid ${tone === 'ok' ? 'text-ok' : 'text-bad'}`}
    >
      {value}
    </button>
  ) : (
    <span className="text-faint">—</span>
  );


