import React, { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Ban, Banknote, FileSpreadsheet, Landmark, Minus, PiggyBank, Plus, Printer, Search, Ticket, Wallet } from 'lucide-react';
import { FundTxn, PaymentMethod, Reservation, Settlement, VoucherSale } from '../types/hotel';
import { escapeHtml as esc, peso, printDocument, todayISO, uid } from '../utils/billing';
import { formatLongDate, formatMonth, formatShortDate, getDaysInMonth } from '../utils/hotelHelpers';
import { Language } from '../i18n/translations';
import { ComboInput, Dialog, PageHeader, Pager, Select, toast } from './ui';
import { DateFilter } from './DateFilter';

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
  sub: string;
  txn?: FundTxn;
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
        label: `${en ? 'Room payment' : '객실 결제'} · ${r.guestName}`,
        sub: [p.method, p.reference].filter(Boolean).join(' · '),
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
        label: `${en ? 'Voucher payment' : '바우처 결제'} · ${v.guestName}`,
        sub: [p.method, p.reference].filter(Boolean).join(' · '),
        voided: false,
      });
  for (const s of settlements)
    for (const p of s.payments)
      out.push({
        key: `hp-${s.month}-${p.id}`,
        date: p.date,
        fund: 'room',
        dir: 'out',
        amount: p.amount,
        method: p.method,
        kind: 'hotel',
        label: `${en ? 'Payment to hotel' : '호텔 지급'} · ${formatMonth(s.month)}`,
        sub: [p.method, p.reference, p.oic && `OIC ${p.oic}`].filter(Boolean).join(' · '),
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
      label:
        f.type === 'opening'
          ? en ? 'Cash in' : '입금'
          : `${en ? 'Cash out' : '출금'} · ${purposeLabel(f.purpose, en)}${f.receivedBy ? ` · ${f.receivedBy}` : ''}`,
      sub: [f.method, f.reference, f.releasedBy && `${en ? 'Released by' : '지급'} ${f.releasedBy}`, f.remarks].filter(Boolean).join(' · '),
      txn: f,
      voided: f.voided,
    });
  // oldest first; on the same day: opening → money in → money out
  const order: Record<Kind, number> = { opening: 0, guest: 1, voucher: 1, hotel: 2, cashout: 2 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
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
}> = ({ reservations, voucherSales, settlements, fundTxns, setFundTxns, selectedMonth, setSelectedMonth, language }) => {
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
  const [size, setSize] = useState(10);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<null | 'out' | 'opening'>(null);
  const [voiding, setVoiding] = useState<FundTxn | null>(null);
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
      .filter((e) => (!fFrom || e.date >= fFrom) && (!fTo || e.date <= fTo))
      .filter((e) => !q || `${e.label} ${e.sub} ${e.txn?.remarks || ''} ${e.txn?.reference || ''}`.toLowerCase().includes(q))
      .slice()
      .reverse();
  }, [ledger, fFrom, fTo, search]);
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
    <div>
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

      {/* balances */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <BalanceCard Icon={PiggyBank} tone="info" label={en ? 'Room fund' : '객실 자금'} b={room} en={en} />
        <BalanceCard Icon={Ticket} tone="warn" label={en ? 'Voucher fund' : '바우처 자금'} b={vouch} en={en} />
        <div className="card p-4 !bg-ok-soft !border-ok-line">
          <div className="flex items-center gap-2.5 text-[12px] text-ink-2">
            <span className="w-7 h-7 rounded-[8px] grid place-items-center text-white bg-ok">
              <Banknote className="w-4 h-4" />
            </span>
            {en ? 'Cash on hand (both funds)' : '현금 보유 (전체)'}
          </div>
          <div className={`num text-[20px] font-semibold mt-3 leading-none ${cashOnHand < 0 ? 'text-bad' : 'text-ok'}`}>{peso(cashOnHand)}</div>
          <div className="text-[11.5px] text-muted mt-1.5">{en ? 'Count this against the actual cash' : '실제 현금과 대조하세요'}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2.5 text-[12px] text-ink-2">
            <span className="w-7 h-7 rounded-[8px] grid place-items-center text-white bg-ink">
              <Wallet className="w-4 h-4" />
            </span>
            {periodLabel}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[13px]">
            <span className="text-ok num font-semibold">+{peso(monthIn)}</span>
            <span className="text-bad num font-semibold">−{peso(monthOut)}</span>
          </div>
          <div className="text-[11.5px] text-muted mt-1.5">{en ? 'In / out in this period' : '기간 내 입금 / 출금'}</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-head">
          <div>
            <h3 className="card-title">{en ? 'Fund ledger' : '자금 원장'}</h3>
            <p className="text-[12.5px] text-muted mt-0.5">
              {en ? 'Guest payments come in automatically; payments to the hotel and cash outs go out.' : '손님 결제는 자동 입금, 호텔 지급·출금은 출금으로 기록됩니다.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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

        <table className="dtable">
          <thead>
            <tr>
              <th>{en ? 'Date' : '날짜'}</th>
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
                <tr key={e.key} className={e.voided ? 'opacity-50' : ''}>
                  <td className="whitespace-nowrap text-ink-2">{formatLongDate(e.date)}</td>
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
                          {e.voided ? `${en ? 'VOIDED' : '취소됨'} — ${e.txn?.voidReason || ''}` : e.sub}
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
                  <td className="r whitespace-nowrap">
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
        {shown.length > 0 && (
          <Pager page={cur} pages={pages} total={shown.length} size={size} onPage={setPage} onSize={setSize} en={en} unitLabel={en ? 'entries' : '건'} />
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

const BalanceCard: React.FC<{ Icon: React.ElementType; tone: 'info' | 'warn'; label: string; b: { cash: number; other: number; total: number }; en: boolean }> = ({
  Icon,
  tone,
  label,
  b,
  en,
}) => (
  <div className={`card p-4 ${tone === 'info' ? '!bg-info-soft !border-info-line' : '!bg-warn-soft !border-warn-line'}`}>
    <div className="flex items-center gap-2.5 text-[12px] text-ink-2">
      <span className={`w-7 h-7 rounded-[8px] grid place-items-center text-white ${tone === 'info' ? 'bg-info' : 'bg-warn'}`}>
        <Icon className="w-4 h-4" />
      </span>
      {label}
    </div>
    <div className={`num text-[20px] font-semibold mt-3 leading-none ${b.total < 0 ? 'text-bad' : tone === 'info' ? 'text-info' : 'text-warn'}`}>{peso(b.total)}</div>
    <div className="text-[11.5px] text-muted mt-1.5 num">
      {en ? 'Cash' : '현금'} {peso(b.cash)} · {en ? 'Bank / e-wallet' : '은행·전자'} {peso(b.other)}
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
