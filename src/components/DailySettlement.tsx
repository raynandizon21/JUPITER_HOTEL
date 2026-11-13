import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileSpreadsheet, BedDouble, LogIn, Moon, Wallet, CheckCircle2, AlertTriangle, Info, Receipt } from 'lucide-react';
import { CasinoRatesConfig, Reservation } from '../types/hotel';
import { folioOf, peso } from '../utils/billing';
import { formatLongDate, formatMonth, formatDateRange, getDaysInMonth, getDayCategory } from '../utils/hotelHelpers';
import { Language } from '../i18n/translations';
import { PageHeader, Dialog, MonthSelect, MONTHS, toast } from './ui';
import { GuestFolio, FolioStatusBadge } from './GuestFolio';

interface Props {
  reservations: Reservation[];
  setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
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
  total: number; // 총 결제 금액
  paid: number; // 결제 완료 (건)
  paidAmount: number; // amount collected from guests
  unpaid: number; // 미결제 건수 (건)
  unpaidAmount: number; // 미결제 금액
}

export function buildDailyRows(reservations: Reservation[], month: string): DailyRow[] {
  return getDaysInMonth(month).map((date) => {
    const arriving = reservations.filter((r) => r.checkIn === date);
    const folios = arriving.map(folioOf);
    return {
      date,
      checkIns: arriving.length,
      inHouse: reservations.filter((r) => r.checkIn <= date && date < r.checkOut).length,
      // 1 room occupied that night = 1 night stayed (new arrivals + guests still staying)
      nights: reservations.filter((r) => r.checkIn <= date && date < r.checkOut).length,
      total: folios.reduce((a, f) => a + f.total, 0),
      paid: folios.filter((f) => f.balance <= 0).length,
      paidAmount: folios.reduce((a, f) => a + f.paid, 0),
      unpaid: folios.filter((f) => f.balance > 0).length,
      unpaidAmount: folios.reduce((a, f) => a + Math.max(f.balance, 0), 0),
    };
  });
}

const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const DailySettlement: React.FC<Props> = ({ reservations, setReservations, casinoRates, selectedMonth, setSelectedMonth, language, embedded = false }) => {
  const en = language === 'en';
  const month = selectedMonth || '2026-11';
  const [onlyActive, setOnlyActive] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [view, setView] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [dayPage, setDayPage] = useState(0);
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
  };
  const [folioId, setFolioId] = useState<string | null>(null);
  const [inHouseDate, setInHouseDate] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const rows = useMemo(() => buildDailyRows(reservations, month), [reservations, month]);
  const months = useMemo(() => Array.from(new Set([...MONTHS, month, ...reservations.map((r) => r.referenceMonth)])).sort(), [reservations, month]);

  const t = useMemo(() => {
    const sum = (k: keyof DailyRow) => rows.reduce((a, r) => a + (r[k] as number), 0);
    return { checkIns: sum('checkIns'), nights: sum('nights'), total: sum('total'), paid: sum('paid'), paidAmount: sum('paidAmount'), unpaid: sum('unpaid'), unpaidAmount: sum('unpaidAmount') };
  }, [rows]);

  // "주피터고객이 사용중인객실" — rooms in use today (or on the 1st day of a past/future month)
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const refDate = todayISO.startsWith(month) ? todayISO : rows.reduce((b, r) => (r.inHouse > b.inHouse ? r : b), rows[0])?.date;
  const inHouseNow = rows.find((r) => r.date === refDate)?.inHouse ?? 0;

  const visible = onlyActive ? rows.filter((r) => r.checkIns > 0 || r.inHouse > 0) : rows;
  // table pagination, opening on the page that holds today.
  // As many normal-height rows as fit the card (no stretched rows, no inner scroll).
  const areaRef = useRef<HTMLDivElement>(null);
  const [fitRows, setFitRows] = useState(5);
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const head = el.querySelector('thead')?.getBoundingClientRect().height ?? 52;
      const row = el.querySelector('tbody tr')?.getBoundingClientRect().height || 38;
      setFitRows(Math.max(3, Math.floor((el.clientHeight - head) / row)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const TABLE_PAGE = fitRows;
  const [tablePage, setTablePage] = useState(0);
  const tablePages = Math.max(1, Math.ceil(visible.length / TABLE_PAGE));
  useEffect(() => {
    const i = visible.findIndex((r) => r.date === todayISO);
    setTablePage(i >= 0 ? Math.floor(i / TABLE_PAGE) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, onlyActive, TABLE_PAGE]);
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
      await exportDailyExcel(month, rows, inHouseNow);
      toast(en ? 'Excel exported' : '엑셀 내보내기 완료', `Daily_Settlement_${month}.xlsx`);
    } catch (e) {
      console.error(e);
      toast(en ? 'Export failed' : '내보내기 실패', String(e), 'bad');
    } finally {
      setExporting(false);
    }
  };

  const H: React.FC<{ ko: string; enLabel: string; align?: 'l' | 'c' | 'r'; tip?: string }> = ({ ko, enLabel, align = 'c', tip }) => (
    <th className={`${align === 'r' ? 'r' : align === 'c' ? 'c' : ''} ${embedded ? '!whitespace-normal !px-2' : ''}`} title={tip}>
      <div className="normal-case tracking-normal text-[12px] font-semibold text-ink">{ko}</div>
      <div className="text-[10px] text-muted mt-0.5">{enLabel}</div>
    </th>
  );

  return (
    <div className={embedded ? 'h-full' : undefined}>
      {!embedded && (
      <>
      <PageHeader
        title={en ? 'Daily Settlement' : '일별 호텔 예약 & 결제 정산'}
        lede={
          <span className="inline-flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            {en
              ? 'Auto-totalled from the Guest Ledger. Amounts are counted on the check-in date.'
              : '예약 목록에 입력된 데이터가 자동으로 집계됩니다. 금액은 체크인 날짜 기준으로 집계됩니다.'}
          </span>
        }
        actions={
          <>
            <div className="flex items-center gap-1">
              <button onClick={() => setSelectedMonth(shiftMonth(month, -1))} className="icon-btn border border-line-strong bg-surface !w-[34px] !h-[34px]" aria-label="Previous month">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <MonthSelect value={month} onChange={setSelectedMonth} months={months} />
              <button onClick={() => setSelectedMonth(shiftMonth(month, 1))} className="icon-btn border border-line-strong bg-surface !w-[34px] !h-[34px]" aria-label="Next month">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <button onClick={exportExcel} disabled={exporting} className="btn btn-outline">
              <FileSpreadsheet className="w-4 h-4 text-ok" />
              {exporting ? (en ? 'Exporting…' : '내보내는 중…') : en ? 'Export Excel' : '엑셀 내보내기'}
            </button>
          </>
        }
      />

      {/* Month summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Stat Icon={BedDouble} label={en ? 'Rooms in use (Jupiter)' : '주피터고객 사용중 객실'} value={unit(inHouseNow, '실')} sub={refDate ? formatLongDate(refDate) : ''} tone="info" />
        <Stat Icon={LogIn} label={en ? 'Check-ins' : '체크인'} value={unit(t.checkIns, '건')} />
        <Stat Icon={Moon} label={en ? 'Total nights' : '총 숙박'} value={unit(t.nights, '박')} />
        <Stat Icon={Wallet} label={en ? 'Total payment' : '총 결제 금액'} value={peso(t.total)} />
        <Stat Icon={CheckCircle2} label={en ? 'Payment completed' : '결제 완료'} value={unit(t.paid, '건')} tone="ok" />
        <Stat Icon={AlertTriangle} label={en ? 'Unpaid' : '미결제'} value={unit(t.unpaid, '건')} sub={peso(t.unpaidAmount)} tone={t.unpaid ? 'bad' : undefined} />
      </div>
      </>
      )}

      <div className={`card overflow-hidden flex flex-col ${embedded ? 'h-full' : 'h-[calc(100vh-310px)] min-h-[380px]'}`}>
        <div className="card-head">
          <div>
            <h3 className="card-title">{embedded ? (en ? 'Daily Settlement' : '일별 정산') : formatMonth(month)}</h3>
            <p className="text-[12.5px] text-muted mt-0.5">{en ? 'Click a day with check-ins to see the guests' : '체크인이 있는 날짜를 클릭하면 손님 목록이 표시됩니다'}</p>
          </div>
          <div className="flex items-center gap-2">
          {embedded && (
            <button onClick={exportExcel} disabled={exporting} className="btn btn-outline btn-sm">
              <FileSpreadsheet className="w-3.5 h-3.5 text-ok" />
              {exporting ? (en ? 'Exporting…' : '내보내는 중…') : en ? 'Excel' : '엑셀'}
            </button>
          )}
          <div className="seg">
            <button data-active={!onlyActive} onClick={() => setOnlyActive(false)}>{en ? `All ${rows.length} days` : `전체 ${rows.length}일`}</button>
            <button data-active={onlyActive} onClick={() => setOnlyActive(true)}>{en ? 'Active days' : '활동일만'}</button>
          </div>
          </div>
        </div>

        <div ref={areaRef} className="flex-1 relative min-h-[200px] overflow-hidden">
          <table className={`${embedded ? 'dtable compact' : 'dtable'} absolute inset-x-0 top-0`}>
            <thead>
              <tr>
                <H ko="날짜" enLabel="Date" align="l" />
                <H ko="체크인 목록" enLabel="Check-in list" tip={en ? 'Guests who arrived on this day' : '이날 도착한 손님 수'} />
                <H
                  ko="체크인 (예약 건수)"
                  enLabel="Check-ins (No. of Reservations)"
                  tip={en ? 'Reservations staying that night — includes guests who checked in on earlier days' : '그날 밤 투숙 중인 예약 수 (이전에 체크인한 손님 포함)'}
                />
                <H ko="총 숙박 박수" enLabel="Total nights stayed" tip={en ? 'Nights stayed on this date — 1 room occupied that night = 1 night' : '이 날짜의 숙박 박수 — 그날 밤 사용 객실 1개 = 1박'} />
                <H ko="결제 완료" enLabel="Paid (bookings)" />
                <H ko="결제 금액" enLabel="Paid amount (PHP)" align="r" tip={en ? 'All money received that day, including partial payments' : '부분 결제 포함 받은 금액'} />
                <H ko="미결제 건수" enLabel="Unpaid (bookings)" />
                <H ko="미결제 금액" enLabel="Unpaid amount (PHP)" align="r" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const has = r.checkIns > 0;
                const d = new Date(r.date + 'T00:00:00');
                const wknd = getDayCategory(r.date) === 'weekend';
                const isToday = r.date === todayISO;
                const z = (v: number, ko: string) => (v ? <span>{unit(v, ko)}</span> : <span className="text-faint">—</span>);
                return (
                  <tr
                    key={r.date}
                    onClick={() => has && open(r.date, 'all')}
                    className={`${has ? 'cursor-pointer' : ''} ${isToday ? '!bg-accent-soft/60' : ''}`}
                  >
                    <td className="whitespace-nowrap">
                      <span className={`font-medium ${has ? 'text-ink' : 'text-ink-2'}`}>{formatLongDate(r.date)}</span>
                      <span className={`ml-2 text-[11.5px] ${wknd ? 'text-[#c0662b] font-medium' : 'text-faint'}`}>
                        {d.toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'short' })}
                      </span>
                      {isToday && <span className="ml-2 badge badge-accent !h-5 !text-[10px]">{en ? 'Today' : '오늘'}</span>}
                    </td>
                    <td className="c num">{has ? <span className="badge badge-info num">{unit(r.checkIns, '건')}</span> : z(0, '건')}</td>
                    <td className="c num">
                      {r.inHouse ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDayPage(0);
                            setInHouseDate(r.date);
                          }}
                          className="num font-medium text-accent cursor-pointer underline decoration-dotted underline-offset-4 hover:decoration-solid"
                          title={en ? 'Show guests in-house this night' : '이날 투숙 중인 손님 보기'}
                        >
                          {unit(r.inHouse, '명')}
                        </button>
                      ) : (
                        z(0, '명')
                      )}
                    </td>
                    <td className="c num">
                      {r.nights ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            open(r.date, 'all');
                          }}
                          className="num text-ink cursor-pointer underline decoration-dotted underline-offset-4 hover:decoration-solid"
                          title={
                            reservations
                              .filter((x) => x.checkIn <= r.date && r.date < x.checkOut)
                              .map((x) => {
                                const no = Math.round((Date.parse(r.date) - Date.parse(x.checkIn)) / 86400000) + 1;
                                return `${x.guestName}: ${en ? `night ${no} of ${x.nights}` : `${x.nights}박 중 ${no}박째`}`;
                              })
                              .join('\n') + `\n= ${r.nights}${en ? (r.nights === 1 ? ' night' : ' nights') : '박'}`
                          }
                        >
                          {unit(r.nights, '박')}
                        </button>
                      ) : (
                        z(0, '박')
                      )}
                    </td>
                    <td className="c">
                      {!has ? <span className="text-faint">—</span> : r.paid ? <Link value={unit(r.paid, '건')} tone="ok" onClick={() => open(r.date, 'paid')} /> : <span className="num text-muted">{unit(0, '건')}</span>}
                    </td>
                    <td className="r">
                      {!has ? <span className="text-faint">—</span> : r.paidAmount ? <Link value={peso(r.paidAmount)} tone="ok" onClick={() => open(r.date, 'all')} /> : <span className="num text-muted">{peso(0)}</span>}
                    </td>
                    <td className="c">
                      {!has ? <span className="text-faint">—</span> : r.unpaid ? <Link value={unit(r.unpaid, '건')} tone="bad" onClick={() => open(r.date, 'unpaid')} /> : <span className="num text-muted">{unit(0, '건')}</span>}
                    </td>
                    <td className="r">
                      {!has ? <span className="text-faint">—</span> : r.unpaidAmount ? <Link value={peso(r.unpaidAmount)} tone="bad" onClick={() => open(r.date, 'unpaid')} /> : <span className="num text-muted">{peso(0)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {tablePages > 1 && (
          <Pager page={tablePage} pages={tablePages} total={visible.length} size={TABLE_PAGE} onPage={setTablePage} en={en} unitLabel={en ? 'days' : '일'} />
        )}
      </div>

      {selectedDate && (() => {
        const fs = dayAll.map(folioOf);
        const paidN = fs.filter((f) => f.balance <= 0).length;
        const unpaidN = fs.length - paidN;
        const nightNo = (r: Reservation) => Math.round((Date.parse(selectedDate) - Date.parse(r.checkIn)) / 86400000) + 1;
        const row = (res: Reservation, staying: boolean) => {
          const f = folioOf(res);
          const pays = res.payments || [];
          const n = nightNo(res);
          return (
            <tr key={res.id} className={staying ? 'text-muted' : ''}>
              <td>
                <div className="font-medium text-ink">{res.guestName}</div>
              </td>
              <td className={staying ? '' : 'text-ink-2'}>{res.roomType}</td>
              <td>
                <div className={staying ? '' : 'text-ink-2'}>{formatDateRange(res.checkIn, res.checkOut)}</div>
                <div className={`text-[11px] ${staying ? 'text-info font-medium' : 'text-muted'}`}>
                  {en ? `Night ${n} of ${res.nights}` : `${res.nights}박 중 ${n}박째`}
                </div>
              </td>
              <td className={`r num ${staying ? '' : 'font-medium text-ink'}`}>{peso(f.total)}</td>
              <td className={`r num ${staying ? '' : 'text-ok'}`}>
                {peso(f.paid)}
                {pays.length > 0 && <div className="text-[10px] leading-none text-muted font-normal">{Array.from(new Set(pays.map((p) => p.method))).join(', ')}</div>}
              </td>
              <td className={`r num ${f.balance > 0 ? (staying ? 'text-bad/70' : 'text-bad font-semibold') : 'text-faint'}`}>{peso(Math.max(f.balance, 0))}</td>
              <td className="c"><FolioStatusBadge r={res} en={en} /></td>
              <td className="r">
                <button onClick={() => setFolioId(res.id)} className="icon-btn" title={en ? 'Billing' : '청구서'}>
                  <Receipt className="w-3.5 h-3.5" />
                </button>
              </td>
            </tr>
          );
        };
        return (
          <Dialog width="max-w-5xl" onClose={() => setSelectedDate(null)} title={<>{en ? 'Guests · ' : '손님 · '}{formatLongDate(selectedDate)}</>}>
            {/* Summary */}
            <div className="px-6 pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MiniStat label={en ? 'Checked in' : '체크인'} value={dayAll.length} tone="ok" />
              <MiniStat label={en ? 'Still staying' : '계속 투숙'} value={stayingAll.length} tone="info" />
              <MiniStat label={en ? 'Nights stayed' : '숙박 박수'} value={dayAll.length + stayingAll.length} sub={en ? '1 room = 1 night' : '객실 1개 = 1박'} />
              <div className="rounded-xl border border-line px-3 py-2.5">
                <div className="text-[11.5px] text-muted">{en ? 'Billed on this date' : '이 날짜 청구액'}</div>
                <div className="num text-[16px] font-semibold text-ink">{peso(fs.reduce((a, f) => a + f.total, 0))}</div>
                <div className="text-[11px] num">
                  <span className="text-ok">{peso(fs.reduce((a, f) => a + f.paid, 0))} {en ? 'paid' : '결제'}</span>
                  <span className="text-faint"> · </span>
                  <span className="text-bad">{peso(fs.reduce((a, f) => a + Math.max(f.balance, 0), 0))} {en ? 'due' : '잔액'}</span>
                </div>
              </div>
            </div>

            {/* Filter */}
            <div className="px-6 pt-4">
              <div className="seg">
                <button data-active={view === 'all'} onClick={() => { setView('all'); setDayPage(0); }}>{en ? 'All' : '전체'}</button>
                <button data-active={view === 'paid'} onClick={() => { setView('paid'); setDayPage(0); }}>{en ? `Paid (${paidN})` : `결제 완료 (${paidN})`}</button>
                <button data-active={view === 'unpaid'} onClick={() => { setView('unpaid'); setDayPage(0); }}>{en ? `Unpaid (${unpaidN})` : `미결제 (${unpaidN})`}</button>
              </div>
            </div>

            <div className="mt-3 border-t border-line">
              <table className="dtable compact whitespace-nowrap">
                <thead>
                  <tr>
                    <th>{en ? 'Guest' : '손님'}</th>
                    <th>{en ? 'Room' : '객실'}</th>
                    <th>{en ? 'Stay' : '기간'}</th>
                    <th className="r">{en ? 'Total' : '합계'}</th>
                    <th className="r">{en ? 'Paid' : '결제'}</th>
                    <th className="r">{en ? 'Balance' : '잔액'}</th>
                    <th className="c">{en ? 'Status' : '상태'}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // 15 rows per page; a group label is shown at the start of each group on the page
                    const items = [...detail.map((r) => ({ r, st: false })), ...staying.map((r) => ({ r, st: true }))];
                    const slice = items.slice(dayPage * PAGE, dayPage * PAGE + PAGE);
                    const out: React.ReactNode[] = [];
                    if (detail.length === 0 && dayPage === 0) {
                      out.push(
                        <Section key="s-in" colSpan={8} tone="ok" label={en ? 'Checked in today · 0' : '오늘 체크인 · 0'} note={en ? 'Billed on this date' : '이 날짜에 청구'} />,
                        <tr key="none">
                          <td colSpan={8} className="!py-5 text-center text-muted">{en ? 'None' : '없음'}</td>
                        </tr>
                      );
                    }
                    slice.forEach((it, i) => {
                      if (i === 0 || slice[i - 1].st !== it.st) {
                        out.push(
                          it.st ? (
                            <Section
                              key={`s-st-${i}`}
                              colSpan={8}
                              tone="info"
                              label={en ? `Still staying · ${staying.length}` : `계속 투숙 · ${staying.length}`}
                              note={en ? 'Checked in earlier — billed on their check-in date' : '이전 체크인 — 체크인 날짜에 청구됨'}
                            />
                          ) : (
                            <Section
                              key={`s-in-${i}`}
                              colSpan={8}
                              tone="ok"
                              label={en ? `Checked in today · ${detail.length}` : `오늘 체크인 · ${detail.length}`}
                              note={en ? 'Billed on this date' : '이 날짜에 청구'}
                            />
                          )
                        );
                      }
                      out.push(row(it.r, it.st));
                    });
                    return out;
                  })()}
                </tbody>
              </table>
            </div>
            {(() => {
              const total = detail.length + staying.length;
              const pages = Math.ceil(total / PAGE);
              if (pages <= 1) return null;
              return (
                <div className="px-6 py-3 border-t border-line flex items-center justify-between text-[12.5px]">
                  <span className="text-muted num">
                    {dayPage * PAGE + 1}–{Math.min(total, dayPage * PAGE + PAGE)} {en ? 'of' : '/'} {total}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setDayPage(dayPage - 1)} disabled={dayPage === 0} className="icon-btn disabled:opacity-30" aria-label="Previous page">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    {Array.from({ length: pages }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setDayPage(i)}
                        className={`min-w-[28px] h-7 px-2 rounded-lg num cursor-pointer ${i === dayPage ? 'bg-ink text-white font-semibold' : 'text-ink-2 hover:bg-canvas'}`}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button onClick={() => setDayPage(dayPage + 1)} disabled={dayPage >= pages - 1} className="icon-btn disabled:opacity-30" aria-label="Next page">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })()}
          </Dialog>
        );
      })()}

      {inHouseDate && (() => {
        const list = reservations
          .filter((r) => r.checkIn <= inHouseDate && inHouseDate < r.checkOut)
          .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.guestName.localeCompare(b.guestName));
        const nightNo = (r: Reservation) => Math.round((Date.parse(inHouseDate) - Date.parse(r.checkIn)) / 86400000) + 1;
        const arriving = list.filter((r) => r.checkIn === inHouseDate).length;
        const lastNight = list.filter((r) => nightNo(r) === r.nights).length;
        const size = Math.max(5, Math.floor((winH - 300) / 40));
        const pages = Math.ceil(list.length / size);
        const pageList = list.slice(dayPage * size, dayPage * size + size);
        return (
          <Dialog
            width="max-w-6xl"
            onClose={() => setInHouseDate(null)}
            title={<>{en ? 'In-house · night of ' : '투숙 중 · '}{formatLongDate(inHouseDate)}</>}
            subtitle={
              en
                ? `${list.length} rooms occupied · ${arriving} arrived today · ${list.length - arriving} still staying · ${lastNight} check out tomorrow`
                : `객실 ${list.length}개 사용 중 · 오늘 체크인 ${arriving} · 계속 투숙 ${list.length - arriving} · 내일 체크아웃 ${lastNight}`
            }
          >
            <div>
              <table className="dtable compact whitespace-nowrap">
                <thead>
                  <tr>
                    <th>{en ? 'Guest' : '손님'}</th>
                    <th>{en ? 'Room' : '객실'}</th>
                    <th>{en ? 'Stay' : '기간'}</th>
                    <th className="c">{en ? 'Night' : '숙박'}</th>
                    <th className="c">{en ? 'Today' : '오늘'}</th>
                    <th className="c">{en ? 'Billing' : '결제'}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pageList.map((res) => {
                    const n = nightNo(res);
                    const tag =
                      res.checkIn === inHouseDate
                        ? <span className="badge badge-ok">{en ? 'Arrived' : '체크인'}</span>
                        : n === res.nights
                        ? <span className="badge badge-warn">{en ? 'Last night' : '마지막 밤'}</span>
                        : <span className="badge badge-info">{en ? 'Staying' : '투숙 중'}</span>;
                    return (
                      <tr key={res.id}>
                        <td className="font-medium text-ink">{res.guestName}</td>
                        <td>{res.roomType}</td>
                        <td className="text-muted">{formatDateRange(res.checkIn, res.checkOut)}</td>
                        <td className="c num">{n} / {res.nights}</td>
                        <td className="c">{tag}</td>
                        <td className="c"><FolioStatusBadge r={res} en={en} /></td>
                        <td className="r">
                          <button onClick={() => setFolioId(res.id)} className="icon-btn" title={en ? 'Billing' : '청구서'}>
                            <Receipt className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {pages > 1 && <Pager page={dayPage} pages={pages} total={list.length} size={size} onPage={setDayPage} en={en} unitLabel={en ? 'rooms' : '실'} />}
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

const Stat: React.FC<{ Icon: React.ElementType; label: string; value: string; sub?: string; tone?: 'ok' | 'bad' | 'info' }> = ({ Icon, label, value, sub, tone }) => (
  <div className={`card p-4 ${tone === 'info' ? '!bg-accent-soft/50 !border-accent-line' : ''}`}>
    <div className="flex items-center gap-2 text-[12px] text-ink-2">
      <Icon className={`w-4 h-4 ${tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : tone === 'info' ? 'text-accent' : 'text-muted'}`} />
      <span className="truncate">{label}</span>
    </div>
    <div className={`num text-[20px] font-semibold mt-2 leading-none ${tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-ink'}`}>{value}</div>
    {sub && <div className="text-[11.5px] text-muted mt-1.5 truncate">{sub}</div>}
  </div>
);

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

/** Group label row inside the day breakdown table. */
const Section: React.FC<{ colSpan: number; tone: 'ok' | 'info'; label: string; note: string }> = ({ colSpan, tone, label, note }) => (
  <tr className={tone === 'ok' ? '!bg-ok-soft/60' : '!bg-info-soft/70'}>
    <td colSpan={colSpan} className="!py-1.5">
      <span className={`text-[11.5px] font-semibold uppercase tracking-wide ${tone === 'ok' ? 'text-ok' : 'text-info'}`}>{label}</span>
      <span className="text-[11.5px] text-muted ml-2">{note}</span>
    </td>
  </tr>
);

const MiniStat: React.FC<{ label: string; value: number; sub?: string; tone?: 'ok' | 'info' }> = ({ label, value, sub, tone }) => (
  <div className="rounded-xl border border-line px-3 py-2.5">
    <div className="text-[11.5px] text-muted">{label}</div>
    <div className={`num text-[20px] font-semibold leading-tight ${tone === 'ok' ? 'text-ok' : tone === 'info' ? 'text-info' : 'text-ink'}`}>{value}</div>
    {sub && <div className="text-[11px] text-muted">{sub}</div>}
  </div>
);

const Pager: React.FC<{ page: number; pages: number; total: number; size: number; onPage: (p: number) => void; en: boolean; unitLabel?: string }> = ({
  page,
  pages,
  total,
  size,
  onPage,
  en,
  unitLabel = '',
}) => (
  <div className="px-5 py-3 border-t border-line flex items-center justify-between text-[12.5px]">
    <span className="text-muted num">
      {page * size + 1}–{Math.min(total, page * size + size)} {en ? 'of' : '/'} {total} {unitLabel}
    </span>
    <div className="flex items-center gap-1">
      <button onClick={() => onPage(page - 1)} disabled={page === 0} className="icon-btn disabled:opacity-30" aria-label="Previous page">
        <ChevronLeft className="w-4 h-4" />
      </button>
      {Array.from({ length: pages }, (_, i) => (
        <button
          key={i}
          onClick={() => onPage(i)}
          className={`min-w-[28px] h-7 px-2 rounded-lg num cursor-pointer ${i === page ? 'bg-ink text-white font-semibold' : 'text-ink-2 hover:bg-canvas'}`}
        >
          {i + 1}
        </button>
      ))}
      <button onClick={() => onPage(page + 1)} disabled={page >= pages - 1} className="icon-btn disabled:opacity-30" aria-label="Next page">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  </div>
);
