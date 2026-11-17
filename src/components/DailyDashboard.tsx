import React, { useState, useMemo } from 'react';
import { DailySettlement } from './DailySettlement';
import { Reservation, CasinoRatesConfig, Settlement, PaymentMethod, FolioPayment, VoucherSale } from '../types/hotel';
import { folioOf, settlementOf, PAYMENT_METHODS, uid, nowStamp, todayISO, printDocument, escapeHtml as esc } from '../utils/billing';
import { GuestFolio } from './GuestFolio';
import { exportSettlementExcel } from '../utils/excelExport';
import { formatCurrency, calculateCasinoStayPrice, formatLongDate, formatMonth, formatDateRange, nightsLabel } from '../utils/hotelHelpers';
import { FileSpreadsheet, AlertTriangle, CheckCircle2, ArrowUpRight, Printer, Wallet, Scale, Landmark, Plus, Pencil, Trash2, Receipt, Users, History } from 'lucide-react';
import { Language } from '../i18n/translations';
import { PageHeader, Dialog, ConfirmDialog, MonthSelect, MONTHS, RowMenu, toast, ComboInput, Select } from './ui';

interface DailyDashboardProps {
  reservations: Reservation[];
  voucherSales: VoucherSale[];
  casinoRates: CasinoRatesConfig;
  setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
  settlements: Settlement[];
  setSettlements: React.Dispatch<React.SetStateAction<Settlement[]>>;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  onNavigateToLedger: () => void;
  language: Language;
}

const php = (n: number, dec = false) => '₱' + formatCurrency(n, 'PHP', dec).replace('PHP ', '');

const summarize = (list: Reservation[], paidToHotel: number) => {
  const folios = list.map((r) => ({ r, f: folioOf(r) }));
  const billed = folios.reduce((a, x) => a + x.f.total, 0);
  const guestPaid = folios.reduce((a, x) => a + x.f.paid, 0);
  const nights = list.reduce((a, r) => a + r.nights, 0);
  const settled = Math.min(paidToHotel, billed) || paidToHotel;
  return {
    count: list.length,
    nights,
    billed,
    settled: paidToHotel,
    balance: Math.max(billed - paidToHotel, 0),
    pct: billed ? Math.min(100, Math.round((settled / billed) * 100)) : 0,
    guestPaid,
    guestBalance: billed - guestPaid,
    guestOwing: folios.filter((x) => x.f.balance > 0).map((x) => x.r),
  };
};

export const DailyDashboard: React.FC<DailyDashboardProps> = ({
  reservations,
  voucherSales,
  casinoRates,
  setReservations,
  settlements,
  setSettlements,
  selectedMonth,
  setSelectedMonth,
  onNavigateToLedger,
  language,
}) => {
  const en = language === 'en';
  const month = selectedMonth || '2026-11';

  const monthRes = useMemo(() => reservations.filter((r) => r.referenceMonth === month), [reservations, month]);
  const hotelPays = settlementOf(settlements, month).payments;
  const s = useMemo(() => summarize(monthRes, settlementOf(settlements, month).paid), [monthRes, settlements, month]);

  const history = useMemo(() => {
    const months = Array.from(new Set([...MONTHS, ...reservations.map((r) => r.referenceMonth)])).sort().reverse();
    return months.map((m) => ({ month: m, ...summarize(reservations.filter((r) => r.referenceMonth === m), settlementOf(settlements, m).paid) }));
  }, [reservations, settlements]);

  // ---- Jupiter → Hotel payments ----
  const [folioId, setFolioId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState(todayISO());
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Bank Transfer');
  const [payRef, setPayRef] = useState('');
  const [payOic, setPayOic] = useState('');
  const [payRemarks, setPayRemarks] = useState('');
  // payment being edited (null = adding a new one)
  const [editingPay, setEditingPay] = useState<FolioPayment | null>(null);
  React.useEffect(() => {
    if (!payOpen) return setEditingPay(null);
    if (editingPay) {
      setPayAmount(editingPay.amount);
      setPayDate(editingPay.date);
      setPayMethod(editingPay.method);
      setPayRef(editingPay.reference || '');
      setPayOic(editingPay.oic || '');
      setPayRemarks(editingPay.remarks || '');
    } else {
      setPayAmount(s.balance);
      setPayDate(todayISO());
      setPayRef('');
      setPayOic('');
      setPayRemarks('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payOpen]);

  // Most this payment can be: what is still unpaid, plus (when editing) this payment's own old amount.
  const maxPay = editingPay ? Math.max(s.billed - (s.settled - editingPay.amount), 0) : s.balance;
  const overPay = payAmount > maxPay;

  const editHotelPayment = (p: FolioPayment) => {
    setEditingPay(p);
    setPayOpen(true);
  };

  // Edit and delete both ask for confirmation first.
  const [confirmPay, setConfirmPay] = useState<{ kind: 'edit' | 'delete'; pay: FolioPayment } | null>(null);

  const addHotelPayment = () => {
    if (payAmount <= 0 || overPay) return;
    if (editingPay) {
      setConfirmPay({ kind: 'edit', pay: editingPay });
      return;
    }
    const p: FolioPayment = { id: uid(), date: payDate, amount: payAmount, method: payMethod, reference: payRef.trim(), oic: payOic.trim(), remarks: payRemarks.trim(), recordedAt: nowStamp() };
    setSettlements((prev) => {
      const exists = prev.some((x) => x.month === month);
      return exists ? prev.map((x) => (x.month === month ? { ...x, payments: [...x.payments, p] } : x)) : [...prev, { month, payments: [p] }];
    });
    setPayOpen(false);
    const left = Math.max(s.balance - p.amount, 0);
    toast(
      en ? 'Payment to hotel recorded' : '호텔 지급 기록됨',
      `${php(p.amount)} · ${formatMonth(month)} — ${left === 0 ? (en ? 'month fully settled' : '정산 완료') : `${en ? 'balance' : '잔액'} ${php(left)}`}`
    );
  };
  const saveEditedPayment = (old: FolioPayment) => {
    const updated: FolioPayment = { ...old, date: payDate, amount: payAmount, method: payMethod, reference: payRef.trim(), oic: payOic.trim(), remarks: payRemarks.trim() };
    setSettlements((prev) => prev.map((x) => (x.month === month ? { ...x, payments: x.payments.map((p) => (p.id === updated.id ? updated : p)) } : x)));
    setPayOpen(false);
    toast(en ? 'Payment to hotel updated' : '호텔 지급 수정됨', `${php(updated.amount)} · ${formatMonth(month)}`);
  };
  const removeHotelPayment = (id: string) => {
    setSettlements((prev) => prev.map((x) => (x.month === month ? { ...x, payments: x.payments.filter((p) => p.id !== id) } : x)));
    toast(en ? 'Payment to hotel removed' : '호텔 지급 삭제됨', formatMonth(month), 'bad');
  };

  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    setExporting(true);
    try {
      await exportSettlementExcel(month, monthRes, hotelPays);
      toast(en ? 'Excel exported' : '엑셀 내보내기 완료', `Jupiter_Hotel_Settlement_${month}.xlsx`);
    } catch (e) {
      console.error(e);
      toast(en ? 'Export failed' : '내보내기 실패', String(e), 'bad');
    } finally {
      setExporting(false);
    }
  };

  const printStatement = () => {
    const rowsHtml = monthRes
      .map((r) => {
        const f = folioOf(r);
        return `<tr><td>${esc(r.guestName)}</td><td>${esc(r.roomType)}</td><td>${formatDateRange(r.checkIn, r.checkOut)}</td><td class="r">${r.nights}</td><td class="r">${php(r.amount)}</td><td class="r">${php(f.extras)}</td><td class="r">${php(f.total)}</td></tr>`;
      })
      .join('');
    const payHtml = hotelPays
      .map((p) => `<tr><td>${formatLongDate(p.date)}</td><td>${esc(p.method)}</td><td>${esc(p.reference || '—')}</td><td>${esc(p.oic || '—')}</td><td>${esc(p.remarks || '—')}</td><td class="r">${php(p.amount)}</td></tr>`)
      .join('');
    printDocument(
      `Settlement Statement ${formatMonth(month)}`,
      `<div class="row"><div><h1>Monthly Settlement Statement</h1><div class="muted">Statement no. SET-${month.replace('-', '')}</div></div>
       <div style="text-align:right"><b>${formatMonth(month)}</b><div class="muted">Billed to: Jupiter Junket</div><div class="muted">From: Hilton Hotel</div></div></div>
       <h2>Bookings</h2><table><thead><tr><th>Guest</th><th>Room</th><th>Stay</th><th class="r">Nights</th><th class="r">Room</th><th class="r">Extras</th><th class="r">Total</th></tr></thead>
       <tbody>${rowsHtml || '<tr><td colspan="8" class="muted">No bookings</td></tr>'}</tbody>
       <tfoot><tr><td colspan="3">Total (${s.count} bookings)</td><td class="r">${s.nights}</td><td></td><td></td><td class="r">${php(s.billed)}</td></tr></tfoot></table>
       <h2>Payments received from Jupiter</h2><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>OIC</th><th>Remarks</th><th class="r">Amount</th></tr></thead>
       <tbody>${payHtml || '<tr><td colspan="6" class="muted">No payments yet</td></tr>'}</tbody></table>
       <div class="totals"><div><span>Total billed</span><span>${php(s.billed)}</span></div><div><span>Payments received</span><span>−${php(s.settled)}</span></div>
       <div class="grand"><span>Balance due</span><span>${php(s.balance)}</span></div></div>
       <div class="sign"><div>Prepared by (Hotel)</div><div>Received by (Jupiter)</div></div>`
    );
  };

  // Expected amount per folio from the rate master (weekday/weekend × occupancy)
  const expectedFor = (r: Reservation) => {
    const room = casinoRates.rooms.find((x) => x.name.toLowerCase() === r.roomType.toLowerCase());
    if (!room) return null;
    return calculateCasinoStayPrice(r.checkIn, r.checkOut, room.id, r.occupancy || 'singleDouble', casinoRates, undefined, r.holidayDates, r.compDates).total;
  };

  const audit = useMemo(() => {
    const items = monthRes.map((r) => {
      const expected = expectedFor(r);
      return { r, expected, diff: expected === null ? 0 : r.amount - expected };
    });
    const priced = items.filter((i) => i.expected !== null);
    const expected = priced.reduce((a, i) => a + (i.expected as number), 0);
    const billedPriced = priced.reduce((a, i) => a + i.r.amount, 0);
    const mismatches = priced.filter((i) => Math.abs(i.diff) >= 1).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    return {
      expected,
      variance: billedPriced - expected,
      over: mismatches.filter((i) => i.diff > 0),
      under: mismatches.filter((i) => i.diff < 0),
      matched: priced.length - mismatches.length,
      unpriced: items.length - priced.length,
      mismatches,
      byId: new Map(items.map((i) => [i.r.id, i])),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthRes, casinoRates]);

  const [showAudit, setShowAudit] = useState(false);

  return (
    <div>
      <PageHeader
        title={en ? 'Dashboard' : '대시보드'}
        lede={en ? 'Room charges between the Jupiter junket and the hotel, settled per reference month' : '주피터 정킷과 호텔 간 객실 요금을 기준 월 단위로 정산합니다'}
        actions={
          <>
            <MonthSelect value={month} onChange={setSelectedMonth} months={history.map((h) => h.month)} />
            <button onClick={printStatement} className="btn btn-outline">
              <Printer className="w-3.5 h-3.5" />
              {en ? 'Print statement' : '정산서 인쇄'}
            </button>
            <button onClick={exportExcel} disabled={exporting} className="btn btn-outline">
              <FileSpreadsheet className="w-3.5 h-3.5 text-ok" />
              {exporting ? (en ? 'Exporting…' : '내보내는 중…') : en ? 'Export Excel' : '엑셀 내보내기'}
            </button>
            <button onClick={() => setPayOpen(true)} disabled={s.balance <= 0} className="btn btn-primary">
              <Landmark className="w-4 h-4" />
              {en ? 'Record payment to hotel' : '호텔 지급 기록'}
            </button>
          </>
        }
      />

      {/* Row 1 — basic cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
        <StatCard Icon={Wallet} label={en ? 'Total hotel bill' : '호텔 총 청구액'} value={php(s.billed)} pill={`${s.count} ${en ? 'bookings' : '건'}`} tone="neutral" color="blue" />
        <StatCard Icon={Landmark} label={en ? 'Paid to hotel' : '호텔 지급액'} value={php(s.settled)} pill={`${s.pct}%`} tone="ok" color="green" />
        <StatCard Icon={AlertTriangle} label={en ? 'Balance due to hotel' : '호텔 미지급 잔액'} value={php(s.balance)} pill={s.balance > 0 ? (en ? 'Open' : '미정산') : en ? 'Settled' : '정산 완료'} tone={s.balance > 0 ? 'bad' : 'ok'} color={s.balance > 0 ? 'red' : 'green'} />
        <StatCard Icon={Users} label={en ? 'Guest payments received' : '손님 결제 수령액'} value={php(s.guestPaid)} pill={`${php(s.guestBalance)} ${en ? 'unpaid' : '미결제'}`} tone={s.guestBalance > 0 ? 'warn' : 'ok'} color="amber" />
        <StatCard
          Icon={Scale}
          label={en ? 'Rate difference' : '요금 차이'}
          value={`${audit.variance > 0 ? '+' : audit.variance < 0 ? '−' : ''}${php(Math.abs(audit.variance))}`}
          pill={`${audit.mismatches.length} ${en ? 'mismatch' : '불일치'}`}
          tone={audit.mismatches.length ? 'warn' : 'ok'}
          color="violet"
          onClick={audit.mismatches.length ? () => setShowAudit(true) : undefined}
        />
      </div>

      {/* Row 2 — daily settlement + payments / guest balances */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        <div className="xl:col-span-2 min-w-0 h-full">
          <DailySettlement
            embedded
            reservations={reservations}
            voucherSales={voucherSales}
            setReservations={setReservations}
            casinoRates={casinoRates}
            selectedMonth={month}
            setSelectedMonth={setSelectedMonth}
            language={language}
          />
        </div>

        <div className="flex flex-col gap-4">
          {/* Payments Jupiter → Hotel */}
          <div className="card p-6 flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="card-title flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-[8px] bg-ok text-white grid place-items-center">
                    <Landmark className="w-4 h-4" strokeWidth={1.75} />
                  </span>
                  {en ? 'Payments to Hotel' : '호텔 지급 내역'}
                </h3>
                <p className="text-[12.5px] text-muted mt-0.5">{en ? `Jupiter → Hotel · ${formatMonth(month)}` : `주피터 → 호텔 · ${formatMonth(month)}`}</p>
              </div>
              <button onClick={() => setPayOpen(true)} disabled={s.balance <= 0} className="btn btn-outline btn-sm">
                <Plus className="w-3.5 h-3.5" />
                {en ? 'Add' : '추가'}
              </button>
            </div>
            <div className="mt-3 space-y-1.5 max-h-[180px] overflow-y-auto">
              {hotelPays.length === 0 && <div className="text-[12.5px] text-muted py-3">{en ? 'No payments to the hotel yet' : '호텔 지급 내역 없음'}</div>}
              {hotelPays.map((p) => (
                <div key={p.id} className="flex items-center gap-3 text-[12.5px] py-1.5 border-b border-line last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="text-ink font-medium">{formatLongDate(p.date)}</div>
                    <div className="text-[11.5px] text-muted truncate">
                      {p.method}
                      {p.reference && ` · ${p.reference}`}
                      {p.oic && ` · OIC ${p.oic}`}
                    </div>
                    {p.remarks && <div className="text-[11.5px] text-ink-2 truncate">{p.remarks}</div>}
                  </div>
                  <span className="num font-semibold text-ok">{php(p.amount)}</span>
                  <RowMenu
                    title={en ? 'Actions' : '작업'}
                    items={[
                      { label: en ? 'Edit' : '수정', Icon: Pencil, onClick: () => editHotelPayment(p) },
                      { label: en ? 'Delete' : '삭제', Icon: Trash2, onClick: () => setConfirmPay({ kind: 'delete', pay: p }), danger: true },
                    ]}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-line flex justify-between text-[13px]">
              <span className="text-muted">{en ? 'Balance due to hotel' : '호텔 미지급 잔액'}</span>
              <span className={`num font-bold ${s.balance > 0 ? 'text-bad' : 'text-ok'}`}>{php(s.balance)}</span>
            </div>
            {hotelPays.length > 0 && (
              <button onClick={exportExcel} disabled={exporting} className="btn btn-outline btn-sm mt-3 self-start">
                <FileSpreadsheet className="w-3.5 h-3.5 text-ok" />
                {en ? 'Export settlement to Excel' : '정산 엑셀 내보내기'}
              </button>
            )}
          </div>

          {/* Guest balances */}
          <div className="card p-6 flex flex-col">
            <h3 className="card-title flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-[8px] bg-warn text-white grid place-items-center">
                <Users className="w-4 h-4" strokeWidth={1.75} />
              </span>
              {en ? 'Guest Balances' : '손님 미수금'}
            </h3>
            <p className="text-[12.5px] text-muted mt-0.5">{en ? 'Guests who still owe on their folio' : '청구서 잔액이 남은 손님'}</p>
            <div className="mt-3 space-y-2 overflow-y-auto max-h-[240px]">
              {s.guestOwing.length === 0 && <Empty ok text={en ? 'All guest folios are paid' : '모든 손님 청구서 결제 완료'} />}
              {s.guestOwing.map((r) => (
                <button key={r.id} onClick={() => setFolioId(r.id)} className="w-full text-left rounded-xl border border-line p-3 flex items-center gap-3 hover:bg-sunken cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-ink truncate">{r.guestName}</div>
                    <div className="text-[11.5px] text-muted truncate">{r.roomType} · {formatLongDate(r.checkIn)}</div>
                  </div>
                  <span className="num text-[12.5px] font-semibold text-bad">{php(folioOf(r).balance)}</span>
                  <Receipt className="w-3.5 h-3.5 text-faint" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Row 3 — settlement history */}
      <div className="card overflow-hidden mb-4">
        <div className="card-head">
          <div>
            <h3 className="card-title flex items-center gap-2.5">
              <span className="w-7 h-7 rounded-[8px] bg-violet text-white grid place-items-center">
                <History className="w-4 h-4" strokeWidth={1.75} />
              </span>
              {en ? 'Settlement History' : '정산 이력'}
            </h3>
            <p className="text-[12.5px] text-muted mt-1">{en ? 'Click a month to open it' : '월을 클릭하면 해당 월로 이동합니다'}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>{en ? 'Month' : '기준 월'}</th>
                <th className="c">{en ? 'Bookings' : '예약'}</th>
                <th className="c">{en ? 'Nights' : '박수'}</th>
                <th className="r !bg-accent-soft !text-accent">{en ? 'Billed' : '청구액'}</th>
                <th className="r !bg-ok-soft !text-ok">{en ? 'Paid to hotel' : '호텔 지급액'}</th>
                <th className="r !bg-bad-soft !text-bad">{en ? 'Balance' : '잔액'}</th>
                <th className="c">{en ? 'Status' : '상태'}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.month} onClick={() => setSelectedMonth(h.month)} className={`cursor-pointer ${h.month === month ? '!bg-accent-soft/60' : ''}`}>
                  <td className={`font-medium text-ink whitespace-nowrap ${h.month === month ? 'shadow-[inset_3px_0_0_var(--color-accent)]' : ''}`}>{formatMonth(h.month)}</td>
                  <td className="c num">{h.count ? <span className="inline-grid place-items-center min-w-6 h-6 px-1.5 rounded-full bg-accent-soft text-accent font-semibold">{h.count}</span> : <Dim />}</td>
                  <td className="c num">{h.nights || <Dim />}</td>
                  <td className="r num text-accent font-semibold bg-accent-soft/30">{h.billed ? php(h.billed) : <Dim />}</td>
                  <td className="r num text-ok font-semibold bg-ok-soft/30">{h.settled ? php(h.settled) : <Dim />}</td>
                  <td className="r num bg-bad-soft/30">{h.balance ? <span className="text-bad font-semibold">{php(h.balance)}</span> : <Dim />}</td>
                  <td className="c">
                    {h.count === 0 ? (
                      <span className="badge badge-neutral">{en ? 'No activity' : '내역 없음'}</span>
                    ) : h.balance <= 0 ? (
                      <span className="badge badge-ok badge-dot">{en ? 'Settled' : '정산 완료'}</span>
                    ) : (
                      <span className="badge badge-bad badge-dot">{en ? 'Open' : '미정산'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAudit && (
        <Dialog
          width="max-w-4xl"
          onClose={() => setShowAudit(false)}
          title={en ? `Rate differences · ${formatMonth(month)}` : `요금 차이 · ${formatMonth(month)}`}
          subtitle={
            en
              ? `${audit.over.length} billed above rate card · ${audit.under.length} below · net ${audit.variance >= 0 ? '+' : '−'}${php(Math.abs(audit.variance))}`
              : `요금표 초과 ${audit.over.length}건 · 미달 ${audit.under.length}건 · 순 차액 ${audit.variance >= 0 ? '+' : '−'}${php(Math.abs(audit.variance))}`
          }
        >
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{en ? 'Guest' : '손님'}</th>
                  <th>{en ? 'Room' : '객실'}</th>
                  <th>{en ? 'Stay' : '기간'}</th>
                  <th className="r">{en ? 'Rate card' : '요금표'}</th>
                  <th className="r">{en ? 'Billed' : '청구액'}</th>
                  <th className="r">{en ? 'Variance' : '차액'}</th>
                </tr>
              </thead>
              <tbody>
                {audit.mismatches.map(({ r, expected, diff }) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-medium text-ink">{r.guestName}</div>
                      {r.remarks && <div className="text-[11.5px] text-muted truncate max-w-[220px]" title={r.remarks}>{r.remarks}</div>}
                    </td>
                    <td className="whitespace-nowrap">{r.roomType} <span className="text-faint">· {r.occupancy === 'triple' ? '3' : '1–2'}</span></td>
                    <td className="text-muted whitespace-nowrap">{formatDateRange(r.checkIn, r.checkOut)} · {nightsLabel(r.nights, en)}</td>
                    <td className="r num text-muted">{php(expected as number)}</td>
                    <td className="r num font-medium text-ink">{php(r.amount)}</td>
                    <td className={`r num font-semibold ${diff > 0 ? 'text-bad' : 'text-info'}`}>{diff > 0 ? '+' : '−'}{php(Math.abs(diff))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-line flex items-center justify-between gap-3">
            <span className="text-[12px] text-muted">
              <span className="text-bad font-medium">+</span> {en ? 'billed above rate card' : '요금표 초과 청구'} · <span className="text-info font-medium">−</span> {en ? 'below rate card' : '요금표 미달'}
            </span>
            <button onClick={onNavigateToLedger} className="btn btn-primary">
              {en ? 'Fix in ledger' : '예약 관리부에서 수정'}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </Dialog>
      )}

      {payOpen && (
        <Dialog
          width="max-w-md"
          onClose={() => setPayOpen(false)}
          title={editingPay ? (en ? 'Edit payment to hotel' : '호텔 지급 수정') : en ? 'Record payment to hotel' : '호텔 지급 기록'}
          subtitle={`${formatMonth(month)} · ${en ? 'balance' : '잔액'} ${php(s.balance)}`}
        >
          <div className="px-6 py-5 grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">{en ? 'Date paid' : '지급일'}</label>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="field-label">{en ? 'Method' : '지급 수단'}</label>
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} className="input">
                {PAYMENT_METHODS.filter((m) => m !== 'Junket Account').map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="field-label">{en ? 'OIC' : '담당자'}</label>
              <ComboInput
                value={payOic}
                onChange={(v) => setPayOic(v.toUpperCase())}
                options={[
                  ...settlements.flatMap((x) => x.payments.map((p) => p.oic || '')),
                  ...(reservations.map((r) => r.oic).filter(Boolean) as string[]),
                ]}
                placeholder={en ? 'Who handled the payment' : '지급 담당자'}
                className="uppercase"
              />
            </div>
            <div>
              <label className="field-label">{en ? 'Reference no.' : '참조 번호'}</label>
              <input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder={en ? 'Bank ref / check / OR no.' : '은행 참조 / 수표 / OR 번호'}
                className="input"
              />
            </div>
            <div className="col-span-2">
              <label className="field-label">{en ? 'Amount' : '금액'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-faint">₱</span>
                <input
                  inputMode="numeric"
                  value={payAmount.toLocaleString('en-US')}
                  onChange={(e) => setPayAmount(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                  className={`input num pl-7 text-[15px] font-semibold ${overPay ? '!border-bad' : ''}`}
                />
              </div>
              {overPay ? (
                <div className="text-[11.5px] text-bad mt-1">
                  {en ? `Cannot be more than the bill. Max ${php(maxPay)}` : `청구액을 초과할 수 없습니다. 최대 ${php(maxPay)}`}
                </div>
              ) : (
                <div className="text-[11.5px] text-muted mt-1">{en ? `Max ${php(maxPay)}` : `최대 ${php(maxPay)}`}</div>
              )}
            </div>
            <div className="col-span-2">
              <label className="field-label">{en ? 'Remarks' : '비고'}</label>
              <textarea
                rows={2}
                value={payRemarks}
                onChange={(e) => setPayRemarks(e.target.value)}
                placeholder={en ? 'e.g. partial settlement for Nov 1–15' : '예: 11월 1~15일 부분 정산'}
                className="input !h-auto py-2 resize-none"
              />
            </div>
          </div>
          <div className="px-6 py-4 border-t border-line bg-sunken flex justify-end gap-2">
            <button onClick={() => setPayOpen(false)} className="btn btn-ghost">{en ? 'Cancel' : '취소'}</button>
            <button onClick={addHotelPayment} disabled={payAmount <= 0 || overPay} className="btn btn-primary">
              <CheckCircle2 className="w-4 h-4" />
              {en ? 'Save payment' : '저장'}
            </button>
          </div>
        </Dialog>
      )}

      {confirmPay && (
        <ConfirmDialog
          danger={confirmPay.kind === 'delete'}
          title={
            confirmPay.kind === 'delete'
              ? en ? 'Delete payment to hotel?' : '호텔 지급을 삭제하시겠습니까?'
              : en ? 'Save changes?' : '변경 사항을 저장하시겠습니까?'
          }
          message={
            confirmPay.kind === 'delete' ? (
              <>
                <b className="text-ink">{php(confirmPay.pay.amount)}</b> · {formatLongDate(confirmPay.pay.date)} · {confirmPay.pay.method}
                {confirmPay.pay.reference && ` · ${confirmPay.pay.reference}`}
                <div className="mt-2 text-muted">{en ? 'This cannot be undone.' : '되돌릴 수 없습니다.'}</div>
              </>
            ) : (
              <>
                {en ? 'Update this payment to the hotel:' : '호텔 지급 내역 수정:'}
                <div className="mt-2 num">
                  <span className="text-muted line-through">{php(confirmPay.pay.amount)}</span> → <b className="text-ink">{php(payAmount)}</b>
                </div>
              </>
            )
          }
          confirmLabel={confirmPay.kind === 'delete' ? (en ? 'Delete' : '삭제') : en ? 'Save' : '저장'}
          cancelLabel={en ? 'Cancel' : '취소'}
          onCancel={() => setConfirmPay(null)}
          onConfirm={() => {
            if (confirmPay.kind === 'delete') removeHotelPayment(confirmPay.pay.id);
            else saveEditedPayment(confirmPay.pay);
            setConfirmPay(null);
          }}
        />
      )}

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

const Dim: React.FC = () => <span className="text-faint/70">·</span>;

const Empty: React.FC<{ text: string; ok?: boolean }> = ({ text, ok }) => (
  <div className="h-full min-h-[120px] rounded-xl border border-dashed border-line-strong grid place-items-center text-center px-4">
    <div>
      {ok && <CheckCircle2 className="w-6 h-6 text-ok mx-auto mb-2" />}
      <div className="text-[12.5px] text-muted">{text}</div>
    </div>
  </div>
);

// pill text colour (the pill sits on a white chip so it reads on any card colour)
const TONE = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  neutral: 'text-ink-2',
} as const;

// card colour: tinted background + border, solid icon tile
const CARD_COLOR = {
  blue: { card: '!bg-accent-soft !border-accent-line', icon: 'bg-accent' },
  green: { card: '!bg-ok-soft !border-ok-line', icon: 'bg-ok' },
  red: { card: '!bg-bad-soft !border-bad-line', icon: 'bg-bad' },
  amber: { card: '!bg-warn-soft !border-warn-line', icon: 'bg-warn' },
  violet: { card: '!bg-violet-soft !border-violet-line', icon: 'bg-violet' },
} as const;

const StatCard: React.FC<{
  Icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  pill: string;
  tone: keyof typeof TONE;
  color: keyof typeof CARD_COLOR;
  onClick?: () => void;
}> = ({ Icon, label, value, pill, tone, color, onClick }) => (
  <div
    onClick={onClick}
    className={`card ${CARD_COLOR[color].card} p-5 flex flex-col justify-between min-h-[118px] ${onClick ? 'cursor-pointer hover:brightness-[0.98] transition' : ''}`}
  >
    <div className="flex items-center gap-3">
      <span className={`w-9 h-9 rounded-[10px] grid place-items-center text-white ${CARD_COLOR[color].icon}`}>
        <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
      </span>
      <span className="text-[13px] text-ink-2">{label}</span>
      {onClick && <ArrowUpRight className="w-3.5 h-3.5 text-faint ml-auto" />}
    </div>
    <div className="flex items-end justify-between gap-2 mt-4">
      <span className="num text-[22px] font-semibold leading-none tracking-tight text-ink">{value}</span>
      <span className={`num inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold whitespace-nowrap bg-surface/80 ${TONE[tone]}`}>{pill}</span>
    </div>
  </div>
);
