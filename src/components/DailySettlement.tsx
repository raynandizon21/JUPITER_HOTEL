import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Receipt, CalendarDays } from 'lucide-react';
import { CasinoRatesConfig, Reservation, VoucherSale } from '../types/hotel';
import { chargeAmount, folioOf, peso, voucherTotals } from '../utils/billing';
import { addDays, formatLongDate, formatShortDate, formatMonth, getDaysInMonth, getDayCategory, getNightlyRates, getStayNights } from '../utils/hotelHelpers';
import { Language } from '../i18n/translations';
import { PageHeader, Dialog, Pager, toast } from './ui';
import { GuestFolio, FolioStatusBadge } from './GuestFolio';
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
  roomAmount: number; // room nights of this day
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

export function buildDailyRows(reservations: Reservation[], month: string, voucherSales: VoucherSale[] = [], rates?: CasinoRatesConfig): DailyRow[] {
  return buildDailyRowsFor(reservations, getDaysInMonth(month), voucherSales, rates);
}

/** Same as buildDailyRows, for any list of dates (the Date / Date Range filter). */
export function buildDailyRowsFor(reservations: Reservation[], dates: string[], voucherSales: VoucherSale[] = [], rates?: CasinoRatesConfig): DailyRow[] {
  const shares = rates ? reservations.map((r) => bookingDays(r, rates)) : null;
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
    return {
      date,
      checkIns: arriving.length,
      inHouse: reservations.filter((r) => r.checkIn <= date && date < r.checkOut).length,
      // 1 room occupied that night = 1 night stayed (new arrivals + guests still staying)
      nights: reservations.filter((r) => r.checkIn <= date && date < r.checkOut).length,
      total: shares ? dayTotal : folios.reduce((a, f) => a + f.total, 0),
      roomAmount: shares ? dayRoom : folios.reduce((a, f) => a + f.room, 0),
      extrasAmount: shares ? dayExtras : folios.reduce((a, f) => a + f.extras, 0),
      paid: folios.filter((f) => f.balance <= 0).length,
      paidAmount: shares ? dayPaid : folios.reduce((a, f) => a + f.paid, 0),
      unpaid: folios.filter((f) => f.balance > 0).length,
      unpaidAmount: shares ? dayTotal - dayPaid : folios.reduce((a, f) => a + Math.max(f.balance, 0), 0),
      vouchers: sold.length,
      voucherAmount: sold.reduce((a, v) => a + voucherTotals(v).total, 0),
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

  const rows = useMemo(() => buildDailyRowsFor(reservations, dates, voucherSales, casinoRates), [reservations, dates, voucherSales, casinoRates]);

  // each booking's value per day (used by the day pop-up's "This day" column)
  const dayShares = useMemo(() => new Map(reservations.map((r) => [r.id, bookingDays(r, casinoRates)])), [reservations, casinoRates]);

  const t = useMemo(() => {
    const sum = (k: keyof DailyRow) => rows.reduce((a, r) => a + (r[k] as number), 0);
    return { checkIns: sum('checkIns'), nights: sum('nights'), total: sum('total'), roomAmount: sum('roomAmount'), extrasAmount: sum('extrasAmount'), voucherAmount: sum('voucherAmount'), paid: sum('paid'), paidAmount: sum('paidAmount'), unpaid: sum('unpaid'), unpaidAmount: sum('unpaidAmount') };
  }, [rows]);

  // "주피터고객이 사용중인객실" — rooms in use today (or on the 1st day of a past/future month)
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const refDate = todayISO.startsWith(month) ? todayISO : rows.reduce((b, r) => (r.inHouse > b.inHouse ? r : b), rows[0])?.date;
  const inHouseNow = rows.find((r) => r.date === refDate)?.inHouse ?? 0;

  const visible = rows;
  // table pagination, opening on the page that holds today.
  // As many normal-height rows as fit the card (no stretched rows, no inner scroll).
  const areaRef = useRef<HTMLDivElement>(null);
  const [fitRows, setFitRows] = useState(5);
  // how many day rows fit between the header and the grand total (measured from the real rows)
  const measureFit = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    measureFit.current = () => {
      const head = el.querySelector('thead')?.getBoundingClientRect().height ?? 52;
      const foot = el.querySelector('tfoot')?.getBoundingClientRect().height ?? 44;
      // average row height (a row with badges / "Today" can be a bit taller than the rest)
      const dayRows = Array.from(el.querySelectorAll('tbody tr:not([data-filler])'));
      const row = dayRows.length ? dayRows.reduce((sum, r) => sum + r.getBoundingClientRect().height, 0) / dayRows.length : 36;
      const n = Math.max(3, Math.floor((el.clientHeight - head - foot + 1) / row));
      setFitRows((prev) => (prev === n ? prev : n));
    };
    measureFit.current();
    // card resized, or the header wraps differently at another width
    const ro = new ResizeObserver(() => measureFit.current());
    ro.observe(el);
    const thead = el.querySelector('thead');
    if (thead) ro.observe(thead);
    return () => ro.disconnect();
  }, []);
  const TABLE_PAGE = fitRows;
  const [tablePage, setTablePage] = useState(0);
  const tablePages = Math.max(1, Math.ceil(visible.length / TABLE_PAGE));
  useEffect(() => {
    const i = visible.findIndex((r) => r.date === todayISO);
    setTablePage(i >= 0 ? Math.floor(i / TABLE_PAGE) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates, TABLE_PAGE]);
  const pageRows = visible.slice(tablePage * TABLE_PAGE, tablePage * TABLE_PAGE + TABLE_PAGE);
  useLayoutEffect(() => measureFit.current(), [pageRows.length, rows]);
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
          <table className="dtable compact absolute inset-0 h-full">
            <thead>
              <tr>
                <H ko="날짜" enLabel="Date" align="l" />
                <H tone="info" ko="체크인 목록" enLabel="Check-in list" tip={en ? 'Guests who arrived on this day' : '이날 도착한 손님 수'} />
                <H tone="info" ko="계속 투숙" enLabel="Still staying" tip={en ? 'Guests who checked in on an earlier day and are still in the room this night' : '이전에 체크인하여 이날 밤에도 투숙 중인 손님 수'} />
                <H tone="info" ko="객실 요금" enLabel="Room (PHP)" align="r" tip={en ? 'Room nights of this day (each night at its own rate)' : '이날 숙박분 객실 요금'} />
                <H tone="info" ko="뷔페·추가" enLabel="Buffet / extras (PHP)" align="r" tip={en ? 'Vouchers, extra bed and other charges on this day (with a room booking)' : '이날 바우처·엑스트라 베드 등 추가 요금 (객실 예약 포함)'} />
                <H
                  tone="info"
                  ko="총 금액"
                  enLabel="Total amount (PHP)"
                  align="r"
                  tip={en ? 'Room + buffet / extras of this day (= paid + unpaid)' : '객실 + 뷔페·추가 (= 결제 + 미결제)'}
                />
                <H tone="ok" ko="결제 금액" enLabel="Paid amount (PHP)" align="r" tip={en ? 'All money received that day, including partial payments' : '부분 결제 포함 받은 금액'} />
                <H tone="bad" ko="미결제 금액" enLabel="Unpaid amount (PHP)" align="r" />
                <H
                  tone="warn"
                  ko="바우처 판매"
                  enLabel="Vouchers sold (PHP)"
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
                    className={`${has || staying > 0 ? 'cursor-pointer' : ''} ${isToday ? '!bg-accent-soft/60' : ''}`}
                  >
                    <td className="whitespace-nowrap">
                      <span className={`font-medium num ${has ? 'text-ink' : 'text-ink-2'}`} title={formatLongDate(r.date)}>{formatShortDate(r.date)}</span>
                      <span className={`ml-2 text-[11.5px] ${wknd ? 'text-[#c0662b] font-medium' : 'text-faint'}`}>
                        {d.toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'short' })}
                      </span>
                      {isToday && <span className="ml-2 badge badge-accent !h-5 !text-[10px]">{en ? 'Today' : '오늘'}</span>}
                    </td>
                    <td className="c num bg-accent-soft/30 whitespace-nowrap">
                      {has ? <span className="badge badge-info num">{unit(r.checkIns, '건')}</span> : z(0, '건')}
                    </td>
                    <td className="c num bg-accent-soft/30 whitespace-nowrap">
                      {staying > 0 ? <span className="badge badge-info num">{unit(staying, '건')}</span> : z(0, '건')}
                    </td>
                    <td className="r num bg-accent-soft/30 whitespace-nowrap">{r.roomAmount ? peso(r.roomAmount) : <span className="text-faint">—</span>}</td>
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
                <td className="c num">{t.checkIns || '—'}</td>
                <td className="c text-faint">—</td>
                <td className="r num">{peso(t.roomAmount)}</td>
                <td className="r num">{peso(t.extrasAmount)}</td>
                <td className="r num text-ink">{peso(t.total)}</td>
                <td className="r num text-ok">{peso(t.paidAmount)}</td>
                <td className="r num text-bad">{peso(t.unpaidAmount)}</td>
                <td className="r num text-warn">{t.voucherAmount ? peso(t.voucherAmount) : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {tablePages > 1 && (
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
            (r.charges || []).filter((c) => c.date === selectedDate).map((c) => ({ key: `r-${r.id}-${c.id}`, guest: r.guestName, src: 'room' as const, c, resId: r.id }))
          ),
          ...voucherSales.filter((v) => v.date === selectedDate).flatMap((v) => v.items.map((c) => ({ key: `v-${v.id}-${c.id}`, guest: v.guestName, src: 'voucher' as const, c, resId: '' }))),
        ];
        const buffetTotal = buffet.reduce((a, x) => a + chargeAmount(x.c), 0);

        const guestRows = dayTab === 'in' ? detail : staying;
        const pages = Math.max(1, Math.ceil((dayTab === 'buffet' ? buffet.length : guestRows.length) / PAGE));
        const cur = Math.min(dayPage, pages - 1);

        const guestRow = (res: Reservation) => {
          const share = dayShares.get(res.id)?.get(selectedDate) || { total: 0, paid: 0, room: 0, extras: 0 };
          const due = share.total - share.paid;
          return (
            <tr key={res.id}>
              <td>
                <div className="font-medium text-ink">{res.guestName}</div>
                <div className="text-[11px] text-muted">{res.roomType}</div>
              </td>
              <td className="whitespace-nowrap text-ink-2">
                {shortDay(res.checkIn)} → {shortDay(res.checkOut)}
                <span className={`badge !h-5 !text-[10.5px] ml-2 ${dayTab === 'in' ? 'badge-ok' : 'badge-info'}`}>
                  {en ? `Night ${nightNo(res)}/${res.nights}` : `${nightNo(res)}/${res.nights}박`}
                </span>
              </td>
              <td className="r num whitespace-nowrap">
                <span className="font-semibold text-ink">{peso(share.total)}</span>
                {due > 0 && <div className="text-[10.5px] text-bad">{peso(due)} {en ? 'due' : '미결제'}</div>}
              </td>
              <td className="c"><FolioStatusBadge r={res} en={en} /></td>
              <td className="r">
                <button onClick={() => setFolioId(res.id)} className="icon-btn" title={en ? 'Billing' : '청구서'}>
                  <Receipt className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          );
        };

        const tabs = [
          { key: 'in' as const, label: en ? 'Checked in' : '체크인', n: detail.length, tone: 'text-ok' },
          { key: 'stay' as const, label: en ? 'Still staying' : '계속 투숙', n: staying.length, tone: 'text-info' },
          { key: 'buffet' as const, label: en ? 'Buffet & vouchers' : '뷔페·바우처', n: buffet.length, tone: 'text-warn' },
        ];

        return (
          <Dialog width="max-w-3xl" onClose={() => setSelectedDate(null)} title={<>{en ? 'Guests · ' : '손님 · '}{formatLongDate(selectedDate)}</>}>
            {/* value of the day */}
            <div className="px-6 pt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <div className="num text-[22px] font-semibold text-ink leading-none">{peso(dayRow?.total || 0)}</div>
              <div className="text-[12px] num text-muted">
                {en ? 'Room' : '객실'} {peso(dayRow?.roomAmount || 0)} · {en ? 'Buffet / extras' : '뷔페·추가'} {peso(dayRow?.extrasAmount || 0)}
              </div>
              <div className="text-[12px] num">
                <span className="text-ok">{peso(dayRow?.paidAmount || 0)} {en ? 'paid' : '결제'}</span>
                <span className="text-faint"> · </span>
                <span className="text-bad">{peso(dayRow?.unpaidAmount || 0)} {en ? 'due' : '미결제'}</span>
              </div>
              {view !== 'all' && (
                <button onClick={() => setView('all')} className="badge badge-neutral cursor-pointer">
                  {view === 'paid' ? (en ? 'Paid only' : '결제만') : en ? 'Unpaid only' : '미결제만'} ✕
                </button>
              )}
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
                  className={`relative px-3 py-2.5 text-[13px] font-medium cursor-pointer transition-colors ${dayTab === tb.key ? 'text-ink' : 'text-muted hover:text-ink-2'}`}
                >
                  {tb.label}
                  <span className={`num ml-1.5 text-[11.5px] ${dayTab === tb.key ? tb.tone : 'text-faint'}`}>{tb.n}</span>
                  {dayTab === tb.key && <span className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full bg-ink" />}
                </button>
              ))}
            </div>

            {dayTab !== 'buffet' ? (
              <table className="dtable compact whitespace-nowrap">
                <thead>
                  <tr>
                    <th>{en ? 'Guest' : '손님'}</th>
                    <th>{en ? 'Stay' : '숙박'}</th>
                    <th className="r">{en ? 'This day' : '이 날짜'}</th>
                    <th className="c">{en ? 'Status' : '상태'}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {guestRows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="!py-8 text-center text-muted">{en ? 'None' : '없음'}</td>
                    </tr>
                  )}
                  {guestRows.slice(cur * PAGE, cur * PAGE + PAGE).map(guestRow)}
                </tbody>
              </table>
            ) : (
              <table className="dtable compact whitespace-nowrap">
                <thead>
                  <tr>
                    <th>{en ? 'Guest' : '손님'}</th>
                    <th>{en ? 'Item' : '항목'}</th>
                    <th className="r">{en ? 'Qty × Price' : '수량 × 단가'}</th>
                    <th className="r">{en ? 'Amount' : '금액'}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {buffet.length === 0 && (
                    <tr>
                      <td colSpan={5} className="!py-8 text-center text-muted">{en ? 'No buffet or vouchers on this day' : '이 날짜 뷔페·바우처 없음'}</td>
                    </tr>
                  )}
                  {buffet.slice(cur * PAGE, cur * PAGE + PAGE).map((x) => (
                    <tr key={x.key}>
                      <td>
                        <div className="font-medium text-ink">{x.guest}</div>
                        <div className="text-[11px] text-muted">{x.src === 'room' ? (en ? 'With room booking' : '객실 예약') : en ? 'Vouchers only' : '바우처만'}</div>
                      </td>
                      <td className="text-ink-2">
                        {x.c.description}
                        {x.c.free && <span className="badge badge-ok !h-5 !text-[10.5px] ml-2">{en ? 'Free' : '무료'}</span>}
                      </td>
                      <td className="r num text-muted">
                        {x.c.qty} × {peso(x.c.unitPrice)}
                      </td>
                      <td className={`r num font-semibold ${x.c.free ? 'text-ok' : 'text-ink'}`}>{peso(chargeAmount(x.c))}</td>
                      <td className="r">
                        {x.resId && (
                          <button onClick={() => setFolioId(x.resId)} className="icon-btn" title={en ? 'Billing' : '청구서'}>
                            <Receipt className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {buffet.length > 0 && (
                  <tfoot>
                    <tr>
                      <td colSpan={3}>{en ? 'Total' : '합계'}</td>
                      <td className="r num">{peso(buffetTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
            {pages > 1 && <Pager page={cur} pages={pages} total={dayTab === 'buffet' ? buffet.length : guestRows.length} size={PAGE} onPage={setDayPage} en={en} />}
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


