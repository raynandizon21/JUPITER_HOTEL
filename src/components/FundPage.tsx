import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Ban, Banknote, Check, FileSpreadsheet, Landmark, Minus, PiggyBank, Plus, Printer, Scale, Search, Ticket } from 'lucide-react';
import { CasinoRatesConfig, FolioPayment, FundTxn, PaymentMethod, Reservation, Settlement, VoucherSale } from '../types/hotel';
import { chargeAmount, escapeHtml as esc, folioOf, peso, nowStamp, printDocument, todayISO, uid, voucherTotals } from '../utils/billing';
import { formatDateRange, formatLongDate, formatMonth, formatShortDate, getDaysInMonth, nightsLabel } from '../utils/hotelHelpers';
import { Language } from '../i18n/translations';
import { ComboInput, Dialog, PageHeader, Pager, Select, toast } from './ui';
import { DateFilter } from './DateFilter';
import { GuestFolio } from './GuestFolio';

type Fund = 'room' | 'voucher';
type Kind = 'guest' | 'voucher' | 'hotel' | 'cashout' | 'opening';

/** One line of the fund ledger (money in or out of the room / voucher fund). */
export interface FundEntry {
  key: string;
  date: string;
  fund: Fund;
  dir: 'in' | 'out';
  amount: number;
  method: PaymentMethod;
  kind: Kind;
  label: string;
  /** "Agent - Guest name" for guest payments, '' otherwise */
  who: string;
  sub: string;
  txn?: FundTxn;
  /** when it was recorded, 'YYYY-MM-DD HH:MM:SS' ('' for old data without it) */
  at: string;
  /** where the line comes from — shown in the details pop-up */
  res?: Reservation;
  vs?: VoucherSale;
  pay?: FolioPayment;
  month?: string;
  voided: boolean;
  balance: number; // running balance of the shown fund(s) after this line
}

const isCash = (m: PaymentMethod) => m === 'Cash';
const OUT_METHODS: PaymentMethod[] = ['Cash', 'Bank Transfer', 'GCash'];

/**
 * Builds the fund ledger from data the app already has:
 *  in  — guest payments on room bookings (room fund) and on voucher-only purchases (voucher fund), opening balances
 *  out — payments to the hotel (room fund) and manual cash outs
 */
/** A reference typed as a plain number (e.g. 25300) shows with commas → 25,300. Codes like 000123 or OR-55 stay as typed. */
/** '2026-11-17 15:42:08' → '3:42 PM' */
const timeOf = (at: string) => {
  const m = /[ T](\d{2}):(\d{2})/.exec(at);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

const whoOf = (agent: string | undefined, guest: string) => [agent?.trim(), guest].filter(Boolean).join(' - ');

const fmtRef = (ref?: string) => (ref && /^[1-9]\d{3,}$/.test(ref.trim()) ? Number(ref.trim()).toLocaleString('en-US') : ref);
// Reference to show for a payment: hidden when it is just the amount typed again (e.g. "25300" for ₱25,300).
const refOf = (p: { reference?: string; amount: number }) => {
  const ref = (p.reference || '').trim().replace(/,/g, '');
  return ref && Number(ref) === p.amount ? '' : fmtRef(p.reference);
};

export function buildFundEntries(
  reservations: Reservation[],
  voucherSales: VoucherSale[],
  settlements: Settlement[],
  fundTxns: FundTxn[],
  en: boolean
): Omit<FundEntry, 'balance'>[] {
  const out: Omit<FundEntry, 'balance'>[] = [];
  for (const r of reservations)
    for (const p of r.payments || [])
      out.push({
        key: `rp-${r.id}-${p.id}`,
        date: p.date,
        fund: 'room',
        dir: 'in',
        amount: p.amount,
        method: p.method,
        kind: 'guest',
        label: en ? 'Room payment' : '객실 결제',
        who: whoOf(r.agentName, r.guestName),
        sub: [p.method, refOf(p)].filter(Boolean).join(' · '),
        res: r,
        pay: p,
        at: p.recordedAt || '',
        voided: false,
      });
  for (const v of voucherSales)
    for (const p of v.payments || [])
      out.push({
        key: `vp-${v.id}-${p.id}`,
        date: p.date,
        fund: 'voucher',
        dir: 'in',
        amount: p.amount,
        method: p.method,
        kind: 'voucher',
        label: en ? 'Voucher payment' : '바우처 결제',
        who: whoOf(v.agentName, v.guestName),
        sub: [p.method, refOf(p)].filter(Boolean).join(' · '),
        vs: v,
        pay: p,
        at: p.recordedAt || '',
        voided: false,
      });
  for (const s of settlements)
    for (const p of s.payments)
      out.push({
        key: `hp-${s.month}-${p.id}`,
        date: p.date,
        fund: p.fund === 'voucher' ? 'voucher' : 'room',
        dir: 'out',
        amount: p.amount,
        method: p.method,
        kind: 'hotel',
        label: `${en ? 'Payment to hotel' : '호텔 지급'} · ${formatMonth(s.month)}`,
        who: '',
        sub: [p.method, refOf(p), p.oic && `OIC ${p.oic}`].filter(Boolean).join(' · '),
        pay: p,
        at: p.recordedAt || '',
        month: s.month,
        voided: false,
      });
  for (const f of fundTxns)
    out.push({
      key: `ft-${f.id}`,
      date: f.date,
      fund: f.fund,
      dir: f.type === 'opening' ? 'in' : 'out',
      amount: f.amount,
      method: f.method,
      kind: f.type === 'opening' ? 'opening' : 'cashout',
      who: '',
      label:
        f.type === 'opening'
          ? en ? 'Cash in' : '입금'
          : `${en ? 'Cash out' : '출금'} · ${purposeLabel(f.purpose, en)}${f.receivedBy ? ` · ${f.receivedBy}` : ''}`,
      sub: [f.method, fmtRef(f.reference), f.releasedBy && `${en ? 'Released by' : '지급'} ${f.releasedBy}`, f.remarks].filter(Boolean).join(' · '),
      txn: f,
      at: f.createdAt || '',
      voided: f.voided,
    });
  // oldest first; on the same day by the time it was recorded, then opening → money in → money out
  const order: Record<Kind, number> = { opening: 0, guest: 1, voucher: 1, hotel: 2, cashout: 2 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at) || order[a.kind] - order[b.kind]);
}

const purposeLabel = (p: FundTxn['purpose'], en: boolean) =>
  ({
    withdrawal: en ? 'Withdrawal' : '인출',
    expense: en ? 'Expense' : '경비',
    remit: en ? 'Remittance' : '송금',
    other: en ? 'Other' : '기타',
    opening: en ? 'Cash in' : '입금',
  })[p];

/** Fund balance (excluding voided lines), split into cash on hand and bank / e-wallet. */
const balanceOf = (entries: Omit<FundEntry, 'balance'>[], fund?: Fund) => {
  let cash = 0;
  let other = 0;
  for (const e of entries) {
    if (e.voided || (fund && e.fund !== fund)) continue;
    const v = e.dir === 'in' ? e.amount : -e.amount;
    if (isCash(e.method)) cash += v;
    else other += v;
  }
  return { cash, other, total: cash + other };
};

export const FundPage: React.FC<{
  reservations: Reservation[];
  voucherSales: VoucherSale[];
  settlements: Settlement[];
  fundTxns: FundTxn[];
  setFundTxns: React.Dispatch<React.SetStateAction<FundTxn[]>>;
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  language: Language;
  /** for the room payment pop-up (the guest's billing, read-only) */
  casinoRates: CasinoRatesConfig;
}> = ({ reservations, voucherSales, settlements, fundTxns, setFundTxns, selectedMonth, setSelectedMonth, language, casinoRates }) => {
  const en = language === 'en';
  const [fundView, setFundView] = useState<'all' | Fund>('all');
  // Date / Date Range filter (same as the other pages); the range starts as the selected month
  const monthRange = (ym: string): [string, string] => (ym ? [`${ym}-01`, getDaysInMonth(ym).slice(-1)[0]] : ['', '']);
  const [dateMode, setDateMode] = useState<'date' | 'range'>('range');
  const [day, setDay] = useState(todayISO);
  const [range, setRange] = useState<[string, string]>(() => monthRange(selectedMonth));
  const [fFrom, fTo] = dateMode === 'date' ? [day, day] : range;
  const periodLabel =
    !fFrom || !fTo
      ? en ? 'All time' : '전체 기간'
      : fFrom === fTo
      ? formatLongDate(fFrom)
      : fFrom.slice(0, 7) === fTo.slice(0, 7) && fFrom.endsWith('-01') && fTo === getDaysInMonth(fFrom.slice(0, 7)).slice(-1)[0]
      ? formatMonth(fFrom.slice(0, 7))
      : `${formatShortDate(fFrom)} – ${formatShortDate(fTo)}`;
  const [page, setPage] = useState(0);
  // Rows per page = as many as fit the ledger card (like Daily Settlement), so the page never scrolls.
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(8);
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const head = el.querySelector('thead')?.getBoundingClientRect().height ?? 40;
      const rows = Array.from(el.querySelectorAll('tbody tr'));
      const row = rows.length ? rows.reduce((a, r) => a + r.getBoundingClientRect().height, 0) / rows.length : 51;
      const n = Math.max(3, Math.floor((el.clientHeight - head) / row));
      setSize((prev) => (prev === n ? prev : n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<null | 'out' | 'opening'>(null);
  const [voiding, setVoiding] = useState<FundTxn | null>(null);
  const [detail, setDetail] = useState<FundEntry | null>(null);
  const [exporting, setExporting] = useState(false);

  const all = useMemo(() => buildFundEntries(reservations, voucherSales, settlements, fundTxns, en), [reservations, voucherSales, settlements, fundTxns, en]);
  const room = balanceOf(all, 'room');
  const vouch = balanceOf(all, 'voucher');
  const cashOnHand = room.cash + vouch.cash;

  // running balance for the fund(s) being viewed, then the month filter
  const ledger = useMemo(() => {
    let bal = 0;
    const rows: FundEntry[] = [];
    for (const e of all) {
      if (fundView !== 'all' && e.fund !== fundView) continue;
      if (!e.voided) bal += e.dir === 'in' ? e.amount : -e.amount;
      rows.push({ ...e, balance: bal });
    }
    return rows;
  }, [all, fundView]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledger
      .filter((e) => !e.voided) // voided lines are listed in the Voided pop-up instead
      .filter((e) => (!fFrom || e.date >= fFrom) && (!fTo || e.date <= fTo))
      .filter((e) => !q || `${e.who} ${e.label} ${e.sub} ${e.txn?.remarks || ''} ${e.txn?.reference || ''}`.toLowerCase().includes(q))
      .slice()
      .reverse();
  }, [ledger, fFrom, fTo, search]);
  const voidedList = useMemo(() => all.filter((e) => e.voided).map((e): FundEntry => ({ ...e, balance: 0 })).reverse(), [all]);
  const [showVoided, setShowVoided] = useState(false);
  const monthIn = shown.filter((e) => !e.voided && e.dir === 'in').reduce((a, e) => a + e.amount, 0);
  const monthOut = shown.filter((e) => !e.voided && e.dir === 'out').reduce((a, e) => a + e.amount, 0);

  const pages = Math.max(1, Math.ceil(shown.length / size));
  const cur = Math.min(page, pages - 1);
  const pageRows = shown.slice(cur * size, cur * size + size);

  const names = useMemo(() => fundTxns.flatMap((f) => [f.releasedBy, f.receivedBy]).filter(Boolean), [fundTxns]);

  // cash-out slip numbers: CO-0001, CO-0002 … in date order
  const slipNo = useMemo(() => {
    const m = new Map<string, string>();
    fundTxns
      .filter((f) => f.type === 'out')
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .forEach((f, i) => m.set(f.id, `CO-${String(i + 1).padStart(4, '0')}`));
    return m;
  }, [fundTxns]);

  const printSlip = (f: FundTxn) => {
    const no = slipNo.get(f.id) || '';
    printDocument(
      `Cash-out slip ${no}`,
      `<div class="row"><div><h1>Cash-out Slip</h1><div class="muted">Jupiter Junket · ${f.fund === 'room' ? 'Room payments fund' : 'Voucher payments fund'}</div></div>
       <div style="text-align:right"><b>${esc(no)}</b><div class="muted">${formatLongDate(f.date)}</div>${f.voided ? '<div style="color:#b4372c;font-weight:700">VOIDED</div>' : ''}</div></div>
       <table><tbody>
         <tr><td>Amount</td><td class="r"><b style="font-size:18px">${peso(f.amount)}</b></td></tr>
         <tr><td>Purpose</td><td class="r">${esc(purposeLabel(f.purpose, true))}</td></tr>
         <tr><td>Method</td><td class="r">${esc(f.method)}</td></tr>
         <tr><td>Reference</td><td class="r">${esc(f.reference || '—')}</td></tr>
         <tr><td>Remarks</td><td class="r">${esc(f.remarks || '—')}</td></tr>
         ${f.voided ? `<tr><td>Void reason</td><td class="r">${esc(f.voidReason)}</td></tr>` : ''}
       </tbody></table>
       <div class="sign"><div>Released by: ${esc(f.releasedBy || '')}</div><div>Received by: ${esc(f.receivedBy || '')}</div></div>`
    );
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { exportFundExcel } = await import('../utils/excelExport');
      const label = fundView === 'all' ? 'All funds' : fundView === 'room' ? 'Room fund' : 'Voucher fund';
      const fileMonth = fFrom && fFrom.slice(0, 7) === fTo.slice(0, 7) ? fFrom.slice(0, 7) : '';
      await exportFundExcel(fileMonth, `${label} · ${periodLabel}`, shown.slice().reverse());
      toast(en ? 'Excel exported' : '엑셀 내보내기 완료', `Fund_${fileMonth || 'all'}.xlsx`);
    } catch (e) {
      toast(en ? 'Export failed' : '내보내기 실패', String(e), 'bad');
    } finally {
      setExporting(false);
    }
  };

  const fundName = (f: Fund) => (f === 'room' ? (en ? 'Room' : '객실') : en ? 'Voucher' : '바우처');

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader
        title={en ? 'Fund' : '자금 (펀드)'}
        lede={en ? 'Money collected from room and voucher payments, and what was paid out.' : '객실·바우처 결제로 모인 자금과 출금 내역.'}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <DateFilter
              size="md"
              en={en}
              mode={dateMode}
              onMode={(m) => {
                setDateMode(m);
                setPage(0);
              }}
              date={day}
              onDate={(d) => {
                setDay(d);
                setPage(0);
              }}
              from={range[0]}
              to={range[1]}
              onRange={(a, b) => {
                setRange([a, b]);
                if (a && a.slice(0, 7) === b.slice(0, 7)) setSelectedMonth(a.slice(0, 7));
                setPage(0);
              }}
            />
            <button onClick={exportExcel} disabled={exporting} className="btn btn-outline">
              <FileSpreadsheet className="w-4 h-4 text-ok" />
              {en ? 'Export Excel' : '엑셀'}
            </button>
            <button onClick={() => setForm('opening')} className="btn btn-outline">
              <Plus className="w-4 h-4" />
              {en ? 'Cash in' : '입금'}
            </button>
            <button onClick={() => setForm('out')} className="btn btn-primary">
              <Minus className="w-4 h-4" />
              {en ? 'Cash out' : '출금'}
            </button>
          </div>
        }
      />

      {/* balances — same card style as the Dashboard cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        <FundCard
          Icon={PiggyBank}
          tone="info"
          label={en ? 'Room fund' : '객실 자금'}
          value={peso(room.total)}
          valueClass={room.total < 0 ? 'text-bad' : 'text-info'}
          rows={[
            [Banknote, en ? 'Cash' : '현금', room.cash],
            [Landmark, en ? 'Bank / e-wallet' : '은행·전자', room.other],
          ]}
        />
        <FundCard
          Icon={Ticket}
          tone="warn"
          label={en ? 'Voucher fund' : '바우처 자금'}
          value={peso(vouch.total)}
          valueClass={vouch.total < 0 ? 'text-bad' : 'text-warn'}
          rows={[
            [Banknote, en ? 'Cash' : '현금', vouch.cash],
            [Landmark, en ? 'Bank / e-wallet' : '은행·전자', vouch.other],
          ]}
        />
        <FundCard
          Icon={Banknote}
          tone="ok"
          label={en ? 'Cash on hand' : '현금 보유'}
          note={en ? 'Count this against the actual cash' : '실제 현금과 대조하세요'}
          value={peso(cashOnHand)}
          valueClass={cashOnHand < 0 ? 'text-bad' : 'text-ok'}
          rows={[
            [PiggyBank, en ? 'Room fund cash' : '객실 자금 현금', room.cash],
            [Ticket, en ? 'Voucher fund cash' : '바우처 자금 현금', vouch.cash],
          ]}
        />
        {/* period cash flow: In − Out = Net (green when positive, red when negative) */}
        <FundCard
          Icon={Scale}
          tone="violet"
          label={en ? 'Net' : '순증감'}
          note={periodLabel}
          value={`${monthIn - monthOut < 0 ? '−' : ''}${peso(Math.abs(monthIn - monthOut))}`}
          valueClass={monthIn - monthOut < 0 ? 'text-bad' : monthIn - monthOut > 0 ? 'text-ok' : 'text-ink'}
          rows={[
            [ArrowDownLeft, en ? 'Money in' : '입금', monthIn, '+'],
            [ArrowUpRight, en ? 'Money out' : '출금', monthOut, '−'],
          ]}
        />
      </div>

      <div className="card overflow-hidden flex-1 min-h-[360px] flex flex-col">
        <div className="card-head">
          <div>
            <h3 className="card-title">{en ? 'Fund ledger' : '자금 원장'}</h3>
            <p className="text-[12.5px] text-muted mt-0.5">
              {en ? 'Guest payments come in automatically; payments to the hotel and cash outs go out.' : '손님 결제는 자동 입금, 호텔 지급·출금은 출금으로 기록됩니다.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
          {voidedList.length > 0 && (
            <button onClick={() => setShowVoided(true)} className="btn btn-outline btn-sm !rounded-full !h-[30px] text-muted hover:!text-bad">
              <Ban className="w-3.5 h-3.5" />
              {en ? 'Voided' : '취소됨'}
              <span className="badge badge-bad !px-1.5 num">{voidedList.length}</span>
            </button>
          )}
          <div className="relative w-[260px]">
            <Search className="w-3.5 h-3.5 text-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder={en ? 'Search guest, name, reference…' : '손님, 이름, 참조 번호 검색…'}
              className="input input-sm pl-8 !rounded-full bg-sunken"
            />
          </div>
          <div className="seg">
            {(['all', 'room', 'voucher'] as const).map((k) => (
              <button
                key={k}
                data-active={fundView === k}
                onClick={() => {
                  setFundView(k);
                  setPage(0);
                }}
              >
                {k === 'all' ? (en ? 'All funds' : '전체') : k === 'room' ? (en ? 'Room fund' : '객실 자금') : en ? 'Voucher fund' : '바우처 자금'}
              </button>
            ))}
          </div>
          </div>
        </div>

        <div ref={areaRef} className="flex-1 relative min-h-[200px] overflow-hidden">
        <table className="dtable absolute inset-x-0 top-0">
          <thead>
            <tr>
              <th>{en ? 'Date / time' : '날짜 / 시간'}</th>
              <th>{en ? 'Description' : '내역'}</th>
              <th className="c">{en ? 'Fund' : '자금'}</th>
              <th className="r">{en ? 'In' : '입금'}</th>
              <th className="r">{en ? 'Out' : '출금'}</th>
              <th className="r">{en ? 'Balance' : '잔액'}</th>
              <th className="w-[84px]" />
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={7} className="!py-14 text-center text-muted">
                  {en ? 'Nothing in this period yet.' : '이 기간에 내역이 없습니다.'}
                </td>
              </tr>
            )}
            {pageRows.map((e) => {
              const Icon = e.kind === 'hotel' ? Landmark : e.dir === 'in' ? ArrowDownLeft : ArrowUpRight;
              return (
                <tr key={e.key} onClick={() => setDetail(e)} className={`cursor-pointer ${e.voided ? 'opacity-50' : ''}`} title={en ? 'Show details' : '상세 보기'}>
                  <td className="whitespace-nowrap text-ink-2" title={e.at ? `${en ? 'Recorded' : '기록'} ${formatLongDate(e.at.slice(0, 10))} ${timeOf(e.at)}` : undefined}>
                    {/* 17-Nov-26, 11:09 AM (time it was recorded; a back-dated payment shows its recorded day in the tooltip) */}
                    {formatShortDate(e.date)}
                    {e.at && `, ${timeOf(e.at)}`}
                  </td>
                  <td>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 ${e.dir === 'in' ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0 leading-tight">
                        <div className={`font-medium text-ink truncate ${e.voided ? 'line-through' : ''}`}>
                          {e.label}
                          {e.kind === 'cashout' && e.txn && <span className="text-muted font-normal num text-[11.5px] ml-1.5">{slipNo.get(e.txn.id)}</span>}
                        </div>
                        <div className="text-[11.5px] text-muted truncate">
                          {e.voided ? (
                            `${en ? 'VOIDED' : '취소됨'} — ${e.txn?.voidReason || ''}`
                          ) : e.who ? (
                            // method · Agent - Guest (bold) · reference …
                            <>
                              {e.method} · <b className="font-semibold text-ink">{e.who}</b>
                              {e.sub.slice(e.method.length)}
                            </>
                          ) : (
                            e.sub
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="c">
                    <span className={`badge ${e.fund === 'room' ? 'badge-info' : 'badge-warn'}`}>{fundName(e.fund)}</span>
                  </td>
                  <td className="r num text-ok whitespace-nowrap">{e.dir === 'in' ? peso(e.amount) : ''}</td>
                  <td className="r num text-bad whitespace-nowrap">{e.dir === 'out' ? peso(e.amount) : ''}</td>
                  <td className={`r num font-semibold whitespace-nowrap ${e.balance < 0 ? 'text-bad' : 'text-ink'}`}>{peso(e.balance)}</td>
                  <td className="r whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                    {e.txn && (
                      <>
                        {e.kind === 'cashout' && (
                          <button onClick={() => printSlip(e.txn!)} className="icon-btn" title={en ? 'Print cash-out slip' : '출금 전표 인쇄'}>
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {!e.voided && (
                          <button onClick={() => setVoiding(e.txn!)} className="icon-btn hover:!text-bad" title={en ? 'Void' : '취소'}>
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {shown.length > 0 && (
          <Pager page={cur} pages={pages} total={shown.length} size={size} onPage={setPage} en={en} unitLabel={en ? 'entries' : '건'} />
        )}
      </div>

      {form && (
        <FundForm
          kind={form}
          en={en}
          names={names}
          balances={{ room, voucher: vouch }}
          onCancel={() => setForm(null)}
          onSave={(f) => {
            setFundTxns((prev) => [...prev, f]);
            setForm(null);
            toast(
              f.type === 'opening' ? (en ? 'Cash in recorded' : '입금 기록됨') : en ? 'Cash out recorded' : '출금 기록됨',
              `${fundName(f.fund)} · ${peso(f.amount)} · ${f.method}`
            );
          }}
        />
      )}

      {showVoided && (
        <Dialog
          title={en ? 'Voided entries' : '취소된 내역'}
          subtitle={en ? 'Not counted in any balance. Click one to see its details.' : '잔액에 포함되지 않습니다. 클릭하면 상세를 볼 수 있습니다.'}
          onClose={() => setShowVoided(false)}
          width="max-w-xl"
        >
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-line">
            {voidedList.length === 0 && <div className="px-6 py-10 text-center text-muted">{en ? 'No voided entries.' : '취소된 내역이 없습니다.'}</div>}
            {voidedList.map((e) => (
              <button
                key={e.key}
                onClick={() => setDetail(e)}
                className="w-full text-left px-6 py-3 flex items-center gap-3 hover:bg-sunken cursor-pointer"
              >
                <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0 bg-bad-soft text-bad">
                  <Ban className="w-3.5 h-3.5" />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="font-medium text-ink truncate">
                    {e.label}
                    {e.who && ` · ${e.who}`}
                    {e.kind === 'cashout' && e.txn && <span className="text-muted font-normal num text-[11.5px] ml-1.5">{slipNo.get(e.txn.id)}</span>}
                  </div>
                  <div className="text-[11.5px] text-muted truncate">
                    {formatLongDate(e.date)} · {fundName(e.fund)} · {e.txn?.voidReason || '—'}
                  </div>
                </div>
                <span className="num text-muted line-through whitespace-nowrap">
                  {e.dir === 'in' ? '+' : '−'}
                  {peso(e.amount)}
                </span>
              </button>
            ))}
          </div>
          <div className="px-6 py-4 border-t border-line bg-sunken flex justify-end">
            <button onClick={() => setShowVoided(false)} className="btn btn-primary">
              {en ? 'Close' : '닫기'}
            </button>
          </div>
        </Dialog>
      )}

      {detail && (
        detail.res ? (
          // room payment: the guest's billing pop-up, view only, with this payment highlighted
          <GuestFolio
            readOnly
            reservation={detail.res}
            highlightPaymentId={detail.pay?.id}
            casinoRates={casinoRates}
            en={en}
            onChange={() => {}}
            onClose={() => setDetail(null)}
          />
        ) : (
        <EntryDetails
          e={detail}
          en={en}
          fundName={fundName}
          slipNo={detail.txn ? slipNo.get(detail.txn.id) : undefined}
          onClose={() => setDetail(null)}
          onPrint={detail.kind === 'cashout' && detail.txn ? () => printSlip(detail.txn!) : undefined}
          onVoid={
            detail.txn && !detail.voided
              ? () => {
                  setVoiding(detail.txn!);
                  setDetail(null);
                }
              : undefined
          }
        />
        )
      )}

      {voiding && (
        <VoidDialog
          en={en}
          txn={voiding}
          onCancel={() => setVoiding(null)}
          onConfirm={(reason) => {
            setFundTxns((prev) => prev.map((x) => (x.id === voiding.id ? { ...x, voided: true, voidReason: reason } : x)));
            toast(en ? 'Entry voided' : '내역 취소됨', `${peso(voiding.amount)} · ${reason}`, 'bad');
            setVoiding(null);
          }}
        />
      )}
    </div>
  );
};

/** First section of the card: a two-column grid, small label above each value; empty values are left out. */
const DetailsTable: React.FC<{ title: string; items: { k: string; v?: React.ReactNode }[] }> = ({ title, items }) => {
  const shown = items.filter((it) => it.v !== undefined && it.v !== null && it.v !== '');
  return (
    <div className="pb-3">
      <div className="px-4 pt-3 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{title}</div>
      <div className="px-4 grid grid-cols-2 gap-x-6 gap-y-3">
        {shown.map((it) => (
          <div key={it.k} className="min-w-0">
            <div className="text-[11px] text-muted">{it.k}</div>
            <div className="text-[13.5px] font-medium text-ink mt-0.5 break-words">{it.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Pop-up with the details of one fund line: one card with the booking details, charges, payments and balance. */
const EntryDetails: React.FC<{
  e: FundEntry;
  en: boolean;
  fundName: (f: Fund) => string;
  slipNo?: string;
  onClose: () => void;
  onPrint?: () => void;
  onVoid?: () => void;
}> = ({ e, en, fundName, slipNo, onClose, onPrint, onVoid }) => {
  const t = e.txn;
  const ref = refOf({ reference: t ? t.reference : e.pay?.reference, amount: e.amount });
  const remarks = t ? t.remarks : e.pay?.remarks;
  const f = e.res ? folioOf(e.res) : e.vs ? voucherTotals(e.vs) : null;
  const guest = e.res?.guestName ?? e.vs?.guestName;
  const agent = e.res?.agentName ?? e.vs?.agentName;
  const isIn = e.dir === 'in';
  // billing lines with their dates: room charge + extras (booking) or the vouchers bought (voucher purchase)
  const bill: { date: string; desc: string; qty: string; amount: React.ReactNode }[] = e.res
    ? [
        { date: '', desc: en ? 'Room charge' : '객실 요금', qty: '', amount: peso(e.res.amount) },
        ...(e.res.charges || []).map((c) => ({
          date: formatShortDate(c.date),
          desc: c.description,
          qty: `× ${c.qty}`,
          amount: c.free ? (en ? 'Free' : '무료') : peso(chargeAmount(c)),
        })),
      ]
    : e.vs
      ? e.vs.items.map((c) => ({
          date: '',
          desc: c.description,
          qty: `× ${c.qty}`,
          amount: c.free ? (en ? 'Free' : '무료') : peso(chargeAmount(c)),
        }))
      : [];
  // every payment on that bill, oldest first, with when it was recorded
  const payments = [...((e.res ? e.res.payments : e.vs?.payments) || [])].sort((a, b) =>
    `${a.date}${a.recordedAt || ''}`.localeCompare(`${b.date}${b.recordedAt || ''}`)
  );

  return (
    <Dialog title={e.label} subtitle={`${formatLongDate(e.date)}${e.at ? ` · ${timeOf(e.at)}` : ''}`} onClose={onClose} width="max-w-md">
      <div className="max-h-[calc(93vh-170px)] overflow-y-auto">
        {/* amount — only for cash in / cash out; a guest payment shows it in the Payments list below */}
        {!f && (
        <div className="px-6 pt-4 pb-0 flex items-end justify-between gap-4">
          <div className={`num text-[24px] font-semibold leading-none ${e.voided ? 'line-through text-muted' : isIn ? 'text-ok' : 'text-bad'}`}>
            {isIn ? '+' : '−'}
            {peso(e.amount)}
          </div>
          {e.voided && <div className="text-[12px] text-bad font-medium text-right">{en ? 'Voided' : '취소됨'}</div>}
        </div>
        )}

        {/* one card: details, then charges / payments / status */}
        <div className="px-6 py-4">
          <div className="rounded-xl border border-line overflow-hidden">
            <DetailsTable
              title={e.res ? (en ? 'Booking' : '예약') : e.vs ? (en ? 'Voucher purchase' : '바우처 구매') : en ? 'Details' : '상세'}
              items={[
                ...(guest
                  ? [
                      { k: en ? 'Agent' : '에이전트', v: agent?.trim() ? agent : '-' },
                      { k: en ? 'Guest' : '손님', v: guest },
                    ]
                  : []),
                ...(e.res
                  ? [
                      { k: en ? 'Stay' : '숙박', v: formatDateRange(e.res.checkIn, e.res.checkOut) },
                      { k: en ? 'Nights' : '박수', v: nightsLabel(e.res.nights, en) },
                      { k: en ? 'Room type' : '객실 타입', v: e.res.roomType },
                      { k: en ? 'Confirmation no.' : '확인 번호', v: e.res.confirmationNo },
                    ]
                  : []),
                ...(e.vs && e.vs.date !== e.date ? [{ k: en ? 'Purchased' : '구매일', v: formatLongDate(e.vs.date) }] : []),
                ...(f ? [] : [{ k: en ? 'Payment' : '결제', v: `${e.method} · ${fundName(e.fund)} ${en ? 'fund' : '자금'}` }]),
                { k: en ? 'Reference' : '참조 번호', v: ref },
                { k: en ? 'Slip no.' : '전표 번호', v: slipNo },
                ...(t && t.type === 'out' ? [{ k: en ? 'Purpose' : '용도', v: purposeLabel(t.purpose, en) }] : []),
                { k: en ? 'Released by' : '지급자', v: t?.releasedBy },
                { k: en ? 'Received by' : '수령자', v: t?.receivedBy },
                { k: en ? 'Settlement month' : '정산 월', v: e.month && formatMonth(e.month) },
                { k: 'OIC', v: e.pay?.oic },
                { k: en ? 'Remarks' : '비고', v: remarks },
                ...(e.voided ? [{ k: en ? 'Void reason' : '취소 사유', v: <span className="text-bad">{t?.voidReason || '—'}</span> }] : []),
              ]}
            />

          {f && (
            <>
                {/* charges */}
                <div className="px-4 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint border-t border-line">{en ? 'Charges' : '청구 내역'}</div>
                {bill.map((b, i) => (
                  <div key={i} className="px-4 py-2 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-medium text-ink truncate">{b.desc}</div>
                      {(b.date || b.qty) && <div className="text-[11.5px] text-muted">{[b.date, b.qty].filter(Boolean).join(' · ')}</div>}
                    </div>
                    <div className="num text-[13.5px] text-ink whitespace-nowrap">{b.amount}</div>
                  </div>
                ))}
                {bill.length > 1 && (
                  <div className="mx-4 py-2 border-t border-line flex items-center justify-between text-[13.5px]">
                    <span className="font-semibold text-ink">{en ? 'Total' : '합계'}</span>
                    <span className="num font-semibold text-ink">{peso(f.total)}</span>
                  </div>
                )}

                {/* payments */}
                <div className="px-4 pt-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint border-t border-line">
                  {en ? 'Payments' : '결제 내역'}
                </div>
                {payments.length === 0 && <div className="px-4 py-2 text-[12.5px] text-muted">{en ? 'No payments yet' : '결제 내역 없음'}</div>}
                {payments.map((p) => {
                  const current = p.id === e.pay?.id;
                  const pref = refOf(p);
                  return (
                    <div key={p.id} className="px-4 py-2 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-7 h-7 shrink-0 rounded-full bg-ok-soft text-ok grid place-items-center">
                          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                        </span>
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-medium text-ink flex items-center gap-2">
                            <span className="truncate">
                              {p.method} {en ? 'payment' : '결제'}
                              {pref && <span className="font-normal text-muted"> · {pref}</span>}
                            </span>
                            {current && <span className="badge badge-ok !h-5 !text-[10.5px] shrink-0">{en ? 'this payment' : '이 결제'}</span>}
                          </div>
                          <div className="text-[11.5px] text-muted">
                            {formatShortDate(p.date)}
                            {p.recordedAt && ` · ${timeOf(p.recordedAt)}`}
                          </div>
                        </div>
                      </div>
                      <div className="num text-[13.5px] text-ok whitespace-nowrap">−{peso(p.amount)}</div>
                    </div>
                  );
                })}

                {/* status */}
                <div className={`mt-1 px-4 py-3 flex items-center justify-between ${f.balance > 0 ? 'bg-bad-soft' : 'bg-ok-soft'}`}>
                  <div className={`text-[13.5px] font-semibold ${f.balance > 0 ? 'text-bad' : 'text-ok'}`}>
                    {f.balance > 0 ? (en ? 'Balance due' : '잔액') : en ? 'Fully paid' : '결제 완료'}
                  </div>
                  <div className={`num text-[18px] font-semibold ${f.balance > 0 ? 'text-bad' : 'text-ok'}`}>{peso(Math.max(f.balance, 0))}</div>
                </div>
            </>
          )}
          </div>
        </div>
      </div>
      <div className="px-6 py-4 border-t border-line flex justify-end gap-2">
        {onVoid && (
          <button onClick={onVoid} className="btn btn-outline !text-bad">
            <Ban className="w-4 h-4" />
            {en ? 'Void' : '취소'}
          </button>
        )}
        {onPrint && (
          <button onClick={onPrint} className="btn btn-outline">
            <Printer className="w-4 h-4" />
            {en ? 'Print slip' : '전표 인쇄'}
          </button>
        )}
        <button onClick={onClose} className="btn btn-primary">
          {en ? 'Close' : '닫기'}
        </button>
      </div>
    </Dialog>
  );
};

// soft colour wash, tinted icon tile (same look as the Dashboard cards)
const FUND_TONE = {
  info: { wash: 'from-info/20 via-info-soft to-info-soft/30', icon: 'bg-info/15 text-info ring-1 ring-inset ring-info/20' },
  warn: { wash: 'from-warn/20 via-warn-soft to-warn-soft/30', icon: 'bg-warn/15 text-warn ring-1 ring-inset ring-warn/20' },
  ok: { wash: 'from-ok/20 via-ok-soft to-ok-soft/30', icon: 'bg-ok/15 text-ok ring-1 ring-inset ring-ok/20' },
  violet: { wash: 'from-violet/20 via-violet-soft to-violet-soft/30', icon: 'bg-violet/15 text-violet ring-1 ring-inset ring-violet/20' },
} as const;

const FundCard: React.FC<{
  Icon: React.ElementType;
  tone: keyof typeof FUND_TONE;
  label: string;
  note?: string;
  value: string;
  valueClass: string;
  /** [icon, name, amount, sign shown before it?] — red below 0 */
  rows: [React.ElementType, string, number, string?][];
}> = ({ Icon, tone, label, note, value, valueClass, rows }) => (
  <div
    className={`card p-4 flex flex-col bg-linear-to-br ${FUND_TONE[tone].wash} !shadow-[0_1px_2px_rgb(17_18_20/0.05),0_10px_28px_-14px_rgb(17_18_20/0.25)]`}
  >
    {/* name left, total right */}
    <div className="flex items-center gap-2.5 min-w-0">
      <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${FUND_TONE[tone].icon}`}>
        <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-[12.5px] font-medium text-ink truncate">{label}</span>
        {note && <span className="block text-[11px] text-muted truncate">{note}</span>}
      </span>
      <span className={`ml-auto num text-[20px] font-semibold leading-none whitespace-nowrap ${valueClass}`}>{value}</span>
    </div>
    {/* breakdown: one line each, amounts lined up on the right */}
    <div className="mt-3 pt-2.5 border-t border-black/[0.06] grid gap-1.5 text-[12px]">
      {rows.map(([I, name, v, sign]) => (
        <div key={name} className="flex items-center gap-2">
          <I className="w-3.5 h-3.5 text-muted" />
          <span className="text-muted">{name}</span>
          <span className={`ml-auto num font-semibold ${v < 0 ? 'text-bad' : 'text-ink'}`}>
            {sign && v !== 0 ? sign : ''}
            {peso(v)}
          </span>
        </div>
      ))}
    </div>
  </div>
);

/** Cash out / opening balance form. */
const FundForm: React.FC<{
  kind: 'out' | 'opening';
  en: boolean;
  names: string[];
  balances: Record<Fund, { cash: number; other: number; total: number }>;
  onCancel: () => void;
  onSave: (f: FundTxn) => void;
}> = ({ kind, en, names, balances, onCancel, onSave }) => {
  const [fund, setFund] = useState<Fund>('room');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [purpose, setPurpose] = useState<FundTxn['purpose']>('withdrawal');
  const [releasedBy, setReleasedBy] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');

  const avail = isCash(method) ? balances[fund].cash : balances[fund].other;
  const over = kind === 'out' && amount > avail;
  const canSave = amount > 0 && date && (kind === 'opening' || receivedBy.trim());

  const save = () => {
    if (!canSave) return;
    onSave({
      id: `fund-${Date.now()}-${uid().slice(0, 4)}`,
      fund,
      type: kind,
      date,
      amount,
      method,
      purpose: kind === 'opening' ? 'opening' : purpose,
      releasedBy: releasedBy.trim(),
      receivedBy: receivedBy.trim(),
      reference: isCash(method) ? '' : reference.trim(), // cash has no reference no.
      remarks: remarks.trim(),
      voided: false,
      voidReason: '',
      createdAt: nowStamp(),
    });
  };

  return (
    <Dialog
      width="max-w-xl"
      onClose={onCancel}
      title={kind === 'out' ? (en ? 'Cash out' : '출금') : en ? 'Cash in' : '입금'}
      subtitle={
        kind === 'out'
          ? en ? 'Take money out of the room or voucher fund.' : '객실 또는 바우처 자금에서 출금합니다.'
          : en ? 'Put money into the room or voucher fund (e.g. money already on hand).' : '객실 또는 바우처 자금에 입금합니다 (예: 보유 중인 자금).'
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="px-6 py-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <div className="col-span-2">
            <label className="field-label">{en ? 'Fund' : '자금'}</label>
            <div className="seg w-full">
              {(['room', 'voucher'] as const).map((f) => (
                <button key={f} type="button" className="flex-1" data-active={fund === f} onClick={() => setFund(f)}>
                  {f === 'room' ? (en ? 'Room fund' : '객실 자금') : en ? 'Voucher fund' : '바우처 자금'}
                  <span className="num opacity-70 ml-1.5">{peso(balances[f].total)}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="field-label">{en ? 'Date *' : '날짜 *'}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="field-label">{en ? 'Amount *' : '금액 *'}</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-faint pointer-events-none">₱</span>
              <input
                autoFocus
                inputMode="numeric"
                value={amount ? amount.toLocaleString('en-US') : ''}
                onChange={(e) => setAmount(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                placeholder="0"
                className={`input num pl-7 text-[15px] font-semibold ${over ? '!border-bad' : ''}`}
              />
            </div>
          </div>
          {/* how — a reference no. only makes sense for bank / GCash, so it is hidden for cash */}
          <div className={kind === 'out' || !isCash(method) ? '' : 'col-span-2'}>
            <label className="field-label">{en ? 'Method' : '방법'}</label>
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {OUT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </div>
          {kind === 'out' && (
            <div>
              <label className="field-label">{en ? 'Purpose' : '용도'}</label>
              <Select value={purpose} onChange={(e) => setPurpose(e.target.value as FundTxn['purpose'])}>
                <option value="withdrawal">{purposeLabel('withdrawal', en)}</option>
                <option value="expense">{purposeLabel('expense', en)}</option>
                <option value="other">{purposeLabel('other', en)}</option>
              </Select>
            </div>
          )}
          {kind === 'opening' && !isCash(method) && (
            <div>
              <label className="field-label">{en ? 'Reference no.' : '참조 번호'}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className="input" placeholder={en ? 'Bank / GCash ref' : '은행·GCash 참조'} />
            </div>
          )}
          {kind === 'out' && (
            <div className="col-span-2 -mt-1 text-[11.5px]">
              {over ? (
                <span className="text-bad font-medium">
                  {en
                    ? `More than the available ${isCash(method) ? 'cash' : 'bank / e-wallet'} in this fund (${peso(avail)}).`
                    : `이 자금의 사용 가능 ${isCash(method) ? '현금' : '은행·전자'} 잔액(${peso(avail)})보다 많습니다.`}
                </span>
              ) : (
                <span className="text-muted">
                  {en ? 'Available' : '사용 가능'} {isCash(method) ? (en ? 'cash' : '현금') : en ? 'bank / e-wallet' : '은행·전자'}: <span className="num text-ink-2">{peso(avail)}</span>
                </span>
              )}
            </div>
          )}
          {kind === 'out' && (
            <>
              <div>
                <label className="field-label">{en ? 'Released by' : '지급자'}</label>
                <ComboInput value={releasedBy} onChange={setReleasedBy} options={names} placeholder={en ? 'Who gave the money' : '지급한 사람'} />
              </div>
              <div>
                <label className="field-label">{en ? 'Received by *' : '수령자 *'}</label>
                <ComboInput value={receivedBy} onChange={setReceivedBy} options={names} placeholder={en ? 'Who received it' : '받은 사람'} />
              </div>
            </>
          )}
          {kind === 'out' && !isCash(method) && (
            <div>
              <label className="field-label">{en ? 'Reference no.' : '참조 번호'}</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} className="input" placeholder={en ? 'Bank / GCash ref' : '은행·GCash 참조'} />
            </div>
          )}
          <div className={kind === 'out' && !isCash(method) ? '' : 'col-span-2'}>
            <label className="field-label">{en ? 'Remarks' : '비고'}</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} className="input" placeholder={en ? 'Optional' : '선택'} />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-line bg-sunken flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            {en ? 'Cancel' : '취소'}
          </button>
          <button type="submit" disabled={!canSave} className="btn btn-primary">
            {kind === 'out' ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {kind === 'out' ? (en ? 'Record cash out' : '출금 기록') : en ? 'Record cash in' : '입금 기록'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

/** Void a cash out / opening balance: kept in the ledger but no longer counted. A reason is required. */
const VoidDialog: React.FC<{ en: boolean; txn: FundTxn; onCancel: () => void; onConfirm: (reason: string) => void }> = ({ en, txn, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  return (
    <Dialog width="max-w-sm" onClose={onCancel} title={en ? 'Void this entry?' : '이 내역을 취소하시겠습니까?'}>
      <div className="px-6 py-5 space-y-3 text-[13px]">
        <div className="text-ink-2">
          <b className="text-ink">{peso(txn.amount)}</b> · {txn.method} · {formatLongDate(txn.date)}
        </div>
        <div className="text-[12px] text-muted">{en ? 'It stays in the ledger (crossed out) but is no longer counted.' : '원장에 남지만 잔액에서 제외됩니다.'}</div>
        <div>
          <label className="field-label">{en ? 'Reason *' : '사유 *'}</label>
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} className="input" placeholder={en ? 'e.g. Wrong amount' : '예: 금액 오류'} />
        </div>
      </div>
      <div className="px-6 py-4 border-t border-line bg-sunken flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-ghost">
          {en ? 'Cancel' : '취소'}
        </button>
        <button onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={!reason.trim()} className="btn border border-bad-line bg-bad text-white hover:opacity-90">
          {en ? 'Void' : '취소 처리'}
        </button>
      </div>
    </Dialog>
  );
};
