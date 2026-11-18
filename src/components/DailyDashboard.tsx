import React, { useState, useMemo } from 'react';
import { DailySettlement, bookingDays } from './DailySettlement';
import { Reservation, CasinoRatesConfig, Settlement, PaymentMethod, FolioPayment, VoucherSale, HotelPurchase } from '../types/hotel';
import { itemLabel, purchaseTotal } from '../utils/inventory';
import { folioOf, voucherTotals, settlementOf, PAYMENT_METHODS, uid, nowStamp, todayISO, printDocument, escapeHtml as esc } from '../utils/billing';
import { GuestFolio } from './GuestFolio';
import { exportSettlementExcel } from '../utils/excelExport';
import { getDaysInMonth, getStayNights, formatCurrency, calculateCasinoStayPrice, formatLongDate, formatMonth, formatDateRange, nightsLabel } from '../utils/hotelHelpers';
import { FileSpreadsheet, CheckCircle2, ArrowUpRight, Printer, Wallet, Scale, Landmark, Plus, Pencil, Trash2, Receipt, Users, History, BedDouble, Ticket, ShoppingCart } from 'lucide-react';
import { Language } from '../i18n/translations';
import { PageButtons, PageHeader, Dialog, ConfirmDialog, MonthSelect, MONTHS, RowMenu, toast, ComboInput, Select } from './ui';

interface DailyDashboardProps {
  reservations: Reservation[];
  voucherSales: VoucherSale[];
  casinoRates: CasinoRatesConfig;
  setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
  settlements: Settlement[];
  setSettlements: React.Dispatch<React.SetStateAction<Settlement[]>>;
  /** stock bought from the hotel — what Jupiter owes the hotel each month */
  purchases: HotelPurchase[];
  onOpenInventory: () => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  onNavigateToLedger: () => void;
  language: Language;
}

const php = (n: number, dec = false) => '₱' + formatCurrency(n, 'PHP', dec).replace('PHP ', '');

/**
 * One month: what Jupiter owes the hotel = purchases dated that month (wholesale stock);
 * guest figures come from the bookings that check in that month.
 */
const summarize = (list: Reservation[], paidToHotel: number, bought: HotelPurchase[]) => {
  const folios = list.map((r) => ({ r, f: folioOf(r) }));
  const billed = bought.reduce((a, p) => a + purchaseTotal(p), 0);
  const guestBilled = folios.reduce((a, x) => a + x.f.total, 0);
  const guestPaid = folios.reduce((a, x) => a + x.f.paid, 0);
  const nights = list.reduce((a, r) => a + r.nights, 0);
  const settled = Math.min(paidToHotel, billed) || paidToHotel;
  return {
    count: list.length,
    purchases: bought.length,
    nights,
    billed,
    settled: paidToHotel,
    balance: Math.max(billed - paidToHotel, 0),
    pct: billed ? Math.min(100, Math.round((settled / billed) * 100)) : 0,
    guestPaid,
    guestBalance: guestBilled - guestPaid,
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
  purchases,
  onOpenInventory,
  selectedMonth,
  setSelectedMonth,
  onNavigateToLedger,
  language,
}) => {
  const en = language === 'en';
  const month = selectedMonth || '2026-11';

  const monthRes = useMemo(() => reservations.filter((r) => r.referenceMonth === month), [reservations, month]);
  const hotelPays = settlementOf(settlements, month).payments;
  const monthPurchases = useMemo(() => purchases.filter((p) => p.date.slice(0, 7) === month), [purchases, month]);
  // Guest money this month — the SAME rule as the Daily Settlement table, so every number tallies:
  // a booking counts only its nights (and extras) that fall in this month, its payments covering the
  // earliest days first; vouchers-only sales count by their sale date.
  const guestMoney = useMemo(() => {
    const days = new Set(getDaysInMonth(month));
    const statusOf = (total: number, paid: number) => (total - paid <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid') as 'paid' | 'partial' | 'unpaid';
    const rooms = reservations
      .map((r) => {
        let total = 0;
        let paid = 0;
        bookingDays(r, casinoRates).forEach((sh, d) => {
          if (!days.has(d)) return;
          total += sh.total;
          paid += sh.paid;
        });
        const nights = getStayNights(r.checkIn, r.checkOut).filter((d) => days.has(d)).length;
        return { id: r.id, kind: 'room' as const, name: r.guestName, agent: r.agentName || '', res: r as Reservation | undefined, vs: undefined as VoucherSale | undefined, pays: r.payments || [], nights, total, paid, balance: total - paid, status: statusOf(total, paid) };
      })
      .filter((x) => x.total > 0 || x.nights > 0);
    const vouchers = voucherSales
      .filter((v) => days.has(v.date))
      .map((v) => {
        const t = voucherTotals(v);
        return { id: v.id, kind: 'voucher' as const, name: v.guestName, agent: v.agentName || '', res: undefined as Reservation | undefined, vs: v as VoucherSale | undefined, pays: v.payments, nights: 0, total: t.total, paid: t.paid, balance: t.balance, status: t.status };
      });
    const sum = (list: { total: number; paid: number }[]) => ({
      count: list.length,
      billed: list.reduce((a, x) => a + x.total, 0),
      paid: list.reduce((a, x) => a + x.paid, 0),
    });
    const r = sum(rooms);
    const v = sum(vouchers);
    return {
      rooms: { ...r, unpaid: Math.max(r.billed - r.paid, 0) },
      vouchers: { ...v, unpaid: Math.max(v.billed - v.paid, 0) },
      owing: [...rooms, ...vouchers].filter((x) => x.balance > 0).sort((a, b) => b.balance - a.balance),
      received: [...rooms, ...vouchers].filter((x) => x.paid > 0).sort((a, b) => b.paid - a.paid),
    };
  }, [reservations, voucherSales, month, casinoRates]);
  const [showGuestMoney, setShowGuestMoney] = useState(false);
  const [owingTab, setOwingTab] = useState<'room' | 'voucher'>('room');
  const [owingPage, setOwingPage] = useState(0);
  const OWING_PAGE = 10;
  // Guest payments received → who paid (its own pop-up, separate from the unpaid one)
  const [receivedTab, setReceivedTab] = useState<'room' | 'voucher' | null>(null);
  const [receivedPage, setReceivedPage] = useState(0);
  const openGuestMoney = (tab: 'room' | 'voucher') => {
    setOwingTab(tab);
    setOwingPage(0);
    setShowGuestMoney(true);
  };
  const s = useMemo(() => summarize(monthRes, settlementOf(settlements, month).paid, monthPurchases), [monthRes, settlements, month, monthPurchases]);

  const history = useMemo(() => {
    const months = Array.from(new Set([...MONTHS, ...reservations.map((r) => r.referenceMonth), ...purchases.map((p) => p.date.slice(0, 7))])).sort().reverse();
    return months.map((m) => ({
      month: m,
      ...summarize(
        reservations.filter((r) => r.referenceMonth === m),
        settlementOf(settlements, m).paid,
        purchases.filter((p) => p.date.slice(0, 7) === m)
      ),
    }));
  }, [reservations, settlements, purchases]);

  // ---- Jupiter → Hotel payments ----
  const [folioId, setFolioId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payDate, setPayDate] = useState(todayISO());
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Cash');
  const [payRef, setPayRef] = useState('');
  const [payOic, setPayOic] = useState('');
  const [payRemarks, setPayRemarks] = useState('');
  const [payFund, setPayFund] = useState<'room' | 'voucher'>('room');
  const [showHotelBill, setShowHotelBill] = useState(false);
  // the month's hotel bill split by fund: room purchases are paid from the Room fund, voucher purchases from the Voucher fund
  const fundBill = { room: 0, voucher: 0 };
  monthPurchases.forEach((p) => p.items.forEach((i) => (fundBill[i.kind] += i.qty * i.unitCost)));
  const fundPaid = { room: 0, voucher: 0 };
  hotelPays.forEach((p) => (fundPaid[p.fund === 'voucher' ? 'voucher' : 'room'] += p.amount));
  const fundDue = { room: Math.max(fundBill.room - fundPaid.room, 0), voucher: Math.max(fundBill.voucher - fundPaid.voucher, 0) };
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
      setPayFund(editingPay.fund === 'voucher' ? 'voucher' : 'room');
    } else {
      setPayMethod('Cash');
      const f = fundDue.room > 0 || fundDue.voucher <= 0 ? 'room' : 'voucher';
      setPayFund(f);
      setPayAmount(fundDue[f]);
      setPayDate(todayISO());
      setPayRef('');
      setPayOic('');
      setPayRemarks('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payOpen]);

  // Most this payment can be: what is still unpaid, plus (when editing) this payment's own old amount.
  // per fund: that fund's part of the bill, minus what it already paid (when editing, not counting this payment)
  const maxPay = Math.max(
    fundBill[payFund] - (fundPaid[payFund] - (editingPay && (editingPay.fund === 'voucher' ? 'voucher' : 'room') === payFund ? editingPay.amount : 0)),
    0
  );
  const overPay = payAmount > maxPay;

  const editHotelPayment = (p: FolioPayment) => {
    setEditingPay(p);
    setPayOpen(true);
  };

  // Edit and delete both ask for confirmation first.
  const [confirmPay, setConfirmPay] = useState<{ kind: 'add' | 'edit' | 'delete'; pay: FolioPayment } | null>(null);

  const addHotelPayment = () => {
    if (payAmount <= 0 || overPay) return;
    if (editingPay) {
      setConfirmPay({ kind: 'edit', pay: editingPay });
      return;
    }
    const p: FolioPayment = { id: uid(), date: payDate, amount: payAmount, method: payMethod, fund: payFund, reference: payRef.trim(), oic: payOic.trim(), remarks: payRemarks.trim(), recordedAt: nowStamp() };
    setConfirmPay({ kind: 'add', pay: p }); // saved after the staff confirm
  };
  const commitHotelPayment = (p: FolioPayment) => {
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
    const updated: FolioPayment = { ...old, date: payDate, amount: payAmount, method: payMethod, fund: payFund, reference: payRef.trim(), oic: payOic.trim(), remarks: payRemarks.trim() };
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
      await exportSettlementExcel(month, monthRes, hotelPays, monthPurchases, casinoRates);
      toast(en ? 'Excel exported' : '엑셀 내보내기 완료', `Jupiter_Hotel_Settlement_${month}.xlsx`);
    } catch (e) {
      console.error(e);
      toast(en ? 'Export failed' : '내보내기 실패', String(e), 'bad');
    } finally {
      setExporting(false);
    }
  };

  const printStatement = () => {
    const rowsHtml = monthPurchases
      .flatMap((p) =>
        p.items.map(
          (i) =>
            `<tr><td>${formatLongDate(p.date)}</td><td>${esc(p.reference || '—')}</td><td>${esc(itemLabel(i, casinoRates, true))}</td><td class="r">${i.qty}</td><td class="r">${i.unitCost ? php(i.unitCost) : 'Free'}</td><td class="r">${php(i.qty * i.unitCost)}</td></tr>`
        )
      )
      .join('');
    const payHtml = hotelPays
      .map((p) => `<tr><td>${formatLongDate(p.date)}</td><td>${esc(p.method)}</td><td>${esc(p.reference || '—')}</td><td>${esc(p.oic || '—')}</td><td>${esc(p.remarks || '—')}</td><td class="r">${php(p.amount)}</td></tr>`)
      .join('');
    printDocument(
      `Settlement Statement ${formatMonth(month)}`,
      `<div class="row"><div><h1>Monthly Settlement Statement</h1><div class="muted">Statement no. SET-${month.replace('-', '')}</div></div>
       <div style="text-align:right"><b>${formatMonth(month)}</b><div class="muted">Billed to: Jupiter Junket</div><div class="muted">From: Hilton Hotel</div></div></div>
       <h2>Rooms and vouchers bought</h2><table><thead><tr><th>Date</th><th>Reference</th><th>Item</th><th class="r">Qty</th><th class="r">Unit cost</th><th class="r">Amount</th></tr></thead>
       <tbody>${rowsHtml || '<tr><td colspan="6" class="muted">No purchases this month</td></tr>'}</tbody>
       <tfoot><tr><td colspan="5">Total (${s.purchases} purchases)</td><td class="r">${php(s.billed)}</td></tr></tfoot></table>
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
        lede={en ? 'Hotel bill for rooms and vouchers bought each month, and guest payments' : '월별 호텔 구매액(객실·바우처) 정산과 손님 결제 현황'}
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
              {en ? 'Pay Hotel Bill' : '호텔 청구 지급'}
            </button>
          </>
        }
      />

      {/* Row 1 — basic cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
        <StatCard
          Icon={Wallet}
          label={en ? 'Hotel Bill' : '호텔 청구액'}
          value={php(s.billed)}
          pill={`${s.purchases} ${en ? (s.purchases === 1 ? 'purchase' : 'purchases') : '건'}`}
          tone="neutral"
          color="blue"
          onClick={() => setShowHotelBill(true)}
        />
        {/* paid to the hotel + what is still due, in one card */}
        <StatCard
          Icon={Landmark}
          label={en ? 'Paid to hotel' : '호텔 지급액'}
          hint={
            s.billed === 0 && s.settled === 0
              ? en ? 'No hotel bill yet' : '호텔 청구 없음'
              : `${en ? 'Balance due' : '잔액'} ${php(s.balance)}`
          }
          value={php(s.settled)}
          pill={s.balance > 0 ? (en ? 'Open' : '미정산') : s.billed === 0 && s.settled === 0 ? (en ? 'No bill yet' : '청구 없음') : en ? 'Settled' : '정산 완료'}
          tone={s.balance > 0 ? 'bad' : s.billed === 0 && s.settled === 0 ? 'warn' : 'ok'}
          color={s.balance > 0 ? 'red' : 'green'}
          onClick={() => setShowHotelBill(true)}
        />
        {(() => {
          const billed = guestMoney.rooms.billed + guestMoney.vouchers.billed;
          const received = guestMoney.rooms.paid + guestMoney.vouchers.paid;
          const unpaidTotal = guestMoney.rooms.unpaid + guestMoney.vouchers.unpaid;
          return (
            <>
              <StatCard
                Icon={Users}
                label={en ? 'Guest payments received' : '손님 결제 수령액'}
                hint={en ? `of ${php(billed)} for this month's nights & vouchers` : `이 달 숙박·바우처 ${php(billed)} 중`}
                value={php(received)}
                pill={`${billed ? Math.round((received / billed) * 100) : 0}% ${en ? 'collected' : '수금'}`}
                tone="ok"
                color="green"
                onClick={() => {
                  setReceivedTab(guestMoney.rooms.paid || !guestMoney.vouchers.paid ? 'room' : 'voucher');
                  setReceivedPage(0);
                }}
              />
              <StatCard
                Icon={Receipt}
                label={en ? 'Unpaid by guests' : '손님 미결제'}
                hint={
                  <>
                    <span className="block whitespace-nowrap">
                      {en ? 'Rooms' : '객실'} <span className="num font-semibold text-bad">{php(guestMoney.rooms.unpaid)}</span>
                    </span>
                    <span className="block whitespace-nowrap">
                      {en ? 'Voucher' : '바우처'} <span className="num font-semibold text-bad">{php(guestMoney.vouchers.unpaid)}</span>
                    </span>
                  </>
                }
                value={php(unpaidTotal)}
                valueClass={unpaidTotal > 0 ? 'text-bad' : 'text-ok'}
                pill={`${guestMoney.owing.length} ${en ? (guestMoney.owing.length === 1 ? 'guest' : 'guests') : '명'}`}
                tone={unpaidTotal > 0 ? 'bad' : 'ok'}
                color={unpaidTotal > 0 ? 'red' : 'green'}
                onClick={() => openGuestMoney(guestMoney.rooms.unpaid || !guestMoney.vouchers.unpaid ? 'room' : 'voucher')}
              />
            </>
          );
        })()}
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
                      {` · ${p.fund === 'voucher' ? (en ? 'Voucher fund' : '바우처 자금') : en ? 'Room fund' : '객실 자금'}`}
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
            <p className="text-[12.5px] text-muted mt-0.5">{en ? 'Guests with an unpaid balance' : '청구서 잔액이 남은 손님'}</p>
            <div className="mt-3 space-y-2 overflow-y-auto max-h-[240px]">
              {s.guestOwing.length === 0 && <Empty ok text={en ? 'All guest bills are paid' : '모든 손님 청구서 결제 완료'} />}
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
                <th className="c">{en ? 'Purchases' : '구매'}</th>
                <th className="r !bg-accent-soft !text-accent">{en ? 'Hotel Bill' : '호텔 청구액'}</th>
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
                  <td className="c num">{h.purchases || <Dim />}</td>
                  <td className="r num text-accent font-semibold bg-accent-soft/30">{h.billed ? php(h.billed) : <Dim />}</td>
                  <td className="r num text-ok font-semibold bg-ok-soft/30">{h.settled ? php(h.settled) : <Dim />}</td>
                  <td className="r num bg-bad-soft/30">{h.balance ? <span className="text-bad font-semibold">{php(h.balance)}</span> : <Dim />}</td>
                  <td className="c">
                    {h.billed === 0 && h.settled === 0 ? (
                      // nothing bought from the hotel this month: not "settled" — there is no bill yet
                      h.count > 0 ? (
                        <span className="badge badge-warn badge-dot" title={en ? 'Guests stayed, but no purchase from the hotel is recorded for this month' : '손님 숙박은 있으나 이 달 호텔 구매가 없습니다'}>
                          {en ? 'No hotel bill' : '호텔 청구 없음'}
                        </span>
                      ) : (
                        <span className="badge badge-neutral">{en ? 'No activity' : '내역 없음'}</span>
                      )
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

      {/* Hotel Bill / Paid to hotel → how much of the month's hotel bill is paid, per fund */}
      {showHotelBill && (
        <Dialog
          width="max-w-xl"
          onClose={() => setShowHotelBill(false)}
          title={en ? `Hotel bill · ${formatMonth(month)}` : `호텔 청구 · ${formatMonth(month)}`}
          subtitle={en ? "How much of this month's hotel bill is paid, per fund" : '이 달 호텔 청구액의 자금별 지급 현황'}
        >
          <div className="px-6 py-4 grid gap-4">
            <table className="dtable compact">
              <thead>
                <tr>
                  <th>{en ? 'Fund' : '자금'}</th>
                  <th className="r">{en ? 'Hotel bill' : '청구액'}</th>
                  <th className="r">{en ? 'Paid' : '지급액'}</th>
                  <th className="r">{en ? 'Balance' : '잔액'}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['room', BedDouble, en ? 'Room fund' : '객실 자금', 'text-accent'],
                    ['voucher', Ticket, en ? 'Voucher fund' : '바우처 자금', 'text-warn'],
                  ] as const
                ).map(([k, Icon, label, tone]) => (
                  <tr key={k}>
                    <td>
                      <span className={`inline-flex items-center gap-2 font-medium ${tone}`}>
                        <Icon className="w-4 h-4" />
                        {label}
                      </span>
                    </td>
                    <td className="r num">{php(fundBill[k])}</td>
                    <td className="r num text-ok">{php(fundPaid[k])}</td>
                    <td className={`r num font-semibold ${fundDue[k] > 0 ? 'text-bad' : 'text-muted'}`}>{php(fundDue[k])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{en ? 'Total' : '합계'}</td>
                  <td className="r num">{php(s.billed)}</td>
                  <td className="r num text-ok">{php(s.settled)}</td>
                  <td className="r num text-bad">{php(s.balance)}</td>
                </tr>
              </tfoot>
            </table>

          </div>
          <div className="px-6 py-3 border-t border-line bg-sunken flex justify-end gap-2">
            <button onClick={() => setShowHotelBill(false)} className="btn btn-ghost">
              {en ? 'Close' : '닫기'}
            </button>
            <button
              onClick={() => {
                setShowHotelBill(false);
                onOpenInventory();
              }}
              className="btn btn-outline"
            >
              <ShoppingCart className="w-4 h-4" />
              {en ? 'Hotel Purchases' : '호텔 구매'}
            </button>
            <button
              onClick={() => {
                setShowHotelBill(false);
                setPayOpen(true);
              }}
              disabled={s.balance <= 0}
              className="btn btn-primary"
            >
              <Landmark className="w-4 h-4" />
              {en ? 'Pay Hotel Bill' : '호텔 청구 지급'}
            </button>
          </div>
        </Dialog>
      )}

      {receivedTab && (
        <Dialog
          width="max-w-6xl"
          onClose={() => setReceivedTab(null)}
          title={en ? `Payments received · ${formatMonth(month)}` : `결제 수령 · ${formatMonth(month)}`}
          subtitle={en ? 'Nights in this month and vouchers-only sales dated this month — same as Daily Settlement' : '이 달 숙박분과 이 달 바우처 단독 판매 — 일일 정산과 동일'}
        >
          {(() => {
            const list = guestMoney.received.filter((x) => x.kind === receivedTab);
            const pages = Math.max(1, Math.ceil(list.length / OWING_PAGE));
            const cur = Math.min(receivedPage, pages - 1);
            const rows = list.slice(cur * OWING_PAGE, cur * OWING_PAGE + OWING_PAGE);
            return (
              <div>
                <div className="flex items-end gap-1 px-5 pt-2 border-b border-line" role="tablist">
                  {(
                    [
                      ['room', BedDouble, en ? 'Room bookings' : '객실 예약', guestMoney.rooms.paid, 'text-accent', 'border-accent', 'bg-accent text-white'],
                      ['voucher', Ticket, en ? 'Vouchers only' : '바우처만', guestMoney.vouchers.paid, 'text-warn', 'border-warn', 'bg-warn text-white'],
                    ] as const
                  ).map(([k, Icon, label, total, icon, line, chip]) => (
                    <button
                      key={k}
                      role="tab"
                      aria-selected={receivedTab === k}
                      onClick={() => {
                        setReceivedTab(k);
                        setReceivedPage(0);
                      }}
                      className={`-mb-px flex items-center gap-2 px-3 py-2.5 text-[12.5px] font-medium border-b-2 cursor-pointer transition-colors ${
                        receivedTab === k ? `${line} text-ink` : 'border-transparent text-muted hover:text-ink-2'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${icon}`} strokeWidth={1.75} />
                      {label}
                      <span className={`num text-[11px] px-1.5 h-5 min-w-5 inline-grid place-items-center rounded-full ${receivedTab === k ? chip : 'bg-canvas text-muted'}`}>
                        {guestMoney.received.filter((x) => x.kind === k).length}
                      </span>
                      <span className="num text-[11.5px] text-ok">{php(total)}</span>
                    </button>
                  ))}
                </div>
                {list.length === 0 ? (
                  <div className="px-5 py-8 text-[12.5px] text-muted text-center">{en ? 'No payments received yet' : '수령한 결제가 없습니다'}</div>
                ) : (
                  <GuestMoneyTable
                    rows={rows}
                    all={list}
                    kind={receivedTab}
                    en={en}
                    onOpen={(id) => {
                      setReceivedTab(null);
                      setFolioId(id);
                    }}
                  />
                )}
                <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-line bg-sunken text-[11.5px] text-muted">
                  <span className="num">{list.length ? `${cur * OWING_PAGE + 1}–${Math.min((cur + 1) * OWING_PAGE, list.length)} ${en ? 'of' : '/'} ${list.length}` : ''}</span>
                  <span className="flex items-center gap-1">
                    <PageButtons page={cur} pages={pages} onPage={setReceivedPage} />
                    <button onClick={() => setReceivedTab(null)} className="btn btn-primary btn-sm ml-2">
                      {en ? 'Close' : '닫기'}
                    </button>
                  </span>
                </div>
              </div>
            );
          })()}
        </Dialog>
      )}

      {showGuestMoney && (
        <Dialog
          width="max-w-6xl"
          onClose={() => setShowGuestMoney(false)}
          title={en ? `Guest payments · ${formatMonth(month)}` : `손님 결제 · ${formatMonth(month)}`}
          subtitle={en ? 'Nights in this month and vouchers-only sales dated this month — same as Daily Settlement' : '이 달 숙박분과 이 달 바우처 단독 판매 — 일일 정산과 동일'}
        >
          <div className="px-6 py-3 grid gap-3">
            <table className="dtable compact">
              <thead>
                <tr>
                  <th>{en ? 'Type' : '구분'}</th>
                  <th className="c">{en ? 'Count' : '건수'}</th>
                  <th className="r">{en ? 'Billed' : '청구액'}</th>
                  <th className="r">{en ? 'Received' : '수령액'}</th>
                  <th className="r">{en ? 'Unpaid' : '미결제'}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    [BedDouble, en ? 'Room bookings' : '객실 예약', guestMoney.rooms, 'text-accent'],
                    [Ticket, en ? 'Vouchers only' : '바우처만', guestMoney.vouchers, 'text-warn'],
                  ] as const
                ).map(([Icon, label, x, tone]) => (
                  <tr key={label}>
                    <td>
                      <span className={`inline-flex items-center gap-2 font-medium ${tone}`}>
                        <Icon className="w-4 h-4" />
                        {label}
                      </span>
                    </td>
                    <td className="c num">{x.count}</td>
                    <td className="r num">{php(x.billed)}</td>
                    <td className="r num text-ok">{php(x.paid)}</td>
                    <td className={`r num font-semibold ${x.unpaid > 0 ? 'text-bad' : 'text-muted'}`}>{php(x.unpaid)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{en ? 'Total' : '합계'}</td>
                  <td className="c num">{guestMoney.rooms.count + guestMoney.vouchers.count}</td>
                  <td className="r num">{php(guestMoney.rooms.billed + guestMoney.vouchers.billed)}</td>
                  <td className="r num text-ok">{php(guestMoney.rooms.paid + guestMoney.vouchers.paid)}</td>
                  <td className="r num text-bad">{php(guestMoney.rooms.unpaid + guestMoney.vouchers.unpaid)}</td>
                </tr>
              </tfoot>
            </table>

            {/* unpaid guests, one tab per type, paged (no scrolling) */}
            {(() => {
              const list = guestMoney.owing.filter((x) => x.kind === owingTab);
              const pages = Math.max(1, Math.ceil(list.length / OWING_PAGE));
              const cur = Math.min(owingPage, pages - 1);
              const rows = list.slice(cur * OWING_PAGE, cur * OWING_PAGE + OWING_PAGE);
              return (
                <div className="rounded-xl border border-line overflow-hidden">
                  <div className="flex items-end gap-1 px-3 pt-1.5 border-b border-line" role="tablist">
                    {(
                      [
                        ['room', BedDouble, en ? 'Room bookings' : '객실 예약', 'text-accent', 'border-accent', 'bg-accent text-white'],
                        ['voucher', Ticket, en ? 'Vouchers only' : '바우처만', 'text-warn', 'border-warn', 'bg-warn text-white'],
                      ] as const
                    ).map(([k, Icon, label, icon, line, chip]) => {
                      const n = guestMoney.owing.filter((x) => x.kind === k).length;
                      return (
                        <button
                          key={k}
                          role="tab"
                          aria-selected={owingTab === k}
                          onClick={() => {
                            setOwingTab(k);
                            setOwingPage(0);
                          }}
                          className={`-mb-px flex items-center gap-2 px-3 py-2 text-[12.5px] font-medium border-b-2 cursor-pointer transition-colors ${
                            owingTab === k ? `${line} text-ink` : 'border-transparent text-muted hover:text-ink-2'
                          }`}
                        >
                          <Icon className={`w-4 h-4 ${icon}`} strokeWidth={1.75} />
                          {label}
                          <span className={`num text-[11px] px-1.5 h-5 min-w-5 inline-grid place-items-center rounded-full ${owingTab === k ? chip : 'bg-canvas text-muted'}`}>{n}</span>
                        </button>
                      );
                    })}
                    <span className="ml-auto mb-2 text-[11px] text-muted">{en ? 'Unpaid' : '미결제'}</span>
                  </div>
                  {list.length === 0 ? (
                    <div className="px-4 py-6 text-[12.5px] text-ok flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {en ? 'Everyone has paid' : '모두 결제 완료'}
                    </div>
                  ) : (
                    <GuestMoneyTable
                      rows={rows}
                      all={list}
                      kind={owingTab}
                      en={en}
                      onOpen={(id) => {
                        setShowGuestMoney(false);
                        setFolioId(id);
                      }}
                    />
                  )}
                  {pages > 1 && (
                    <div className="flex items-center justify-between px-3.5 py-2 border-t border-line bg-sunken text-[11.5px] text-muted">
                      <span className="num">
                        {cur * OWING_PAGE + 1}–{Math.min((cur + 1) * OWING_PAGE, list.length)} {en ? 'of' : '/'} {list.length}
                      </span>
                      <PageButtons page={cur} pages={pages} onPage={setOwingPage} />
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </Dialog>
      )}

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
          title={editingPay ? (en ? 'Edit payment to hotel' : '호텔 지급 수정') : en ? 'Pay Hotel Bill' : '호텔 청구 지급'}
          subtitle={`${formatMonth(month)} · ${en ? 'balance' : '잔액'} ${php(s.balance)}`}
        >
          <div className="px-6 py-5 grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="field-label">{en ? 'Pay from' : '지급 자금'}</label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['room', BedDouble, en ? 'Room fund' : '객실 자금', 'border-accent bg-accent-soft text-accent', 'ring-2 ring-accent/20'],
                    ['voucher', Ticket, en ? 'Voucher fund' : '바우처 자금', 'border-warn bg-warn-soft text-warn', 'ring-2 ring-warn/20'],
                  ] as const
                ).map(([k, Icon, label, on, ring]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setPayFund(k);
                      if (!editingPay) setPayAmount(fundDue[k]);
                    }}
                    className={`relative text-left rounded-xl border-2 px-3.5 py-2.5 cursor-pointer transition-colors ${
                      payFund === k ? `${on} ${ring}` : 'border-line bg-surface text-ink-2 hover:border-line-strong'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold">
                      <Icon className="w-4 h-4" />
                      {label}
                      {payFund === k && <CheckCircle2 className="w-4 h-4 ml-auto" />}
                    </span>
                    <span className="block mt-1 text-[11px] text-muted">{en ? 'Due' : '미지급'}</span>
                    <span className={`block num text-[17px] font-bold leading-tight ${fundDue[k] > 0 ? 'text-bad' : 'text-ok'}`}>{php(fundDue[k])}</span>
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-muted mt-1">
                {en
                  ? `Room purchases ${php(fundBill.room)} are paid from the Room fund, voucher purchases ${php(fundBill.voucher)} from the Voucher fund.`
                  : `객실 구매 ${php(fundBill.room)}는 객실 자금, 바우처 구매 ${php(fundBill.voucher)}는 바우처 자금에서 지급합니다.`}
              </div>
            </div>
            <div>
              <label className="field-label">{en ? 'Date paid' : '지급일'}</label>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="field-label">{en ? 'Method' : '지급 수단'}</label>
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} className="input">
                {/* Cash only for now; an old payment made another way still shows its method so it can be changed */}
                {PAYMENT_METHODS.filter((m) => m === 'Cash' || (editingPay && m === editingPay.method)).map((m) => (
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
              : confirmPay.kind === 'add'
              ? en ? 'Confirm payment to the hotel' : '호텔 지급 확인'
              : en ? 'Save changes?' : '변경 사항을 저장하시겠습니까?'
          }
          message={
            confirmPay.kind === 'add' ? (
              <div className="grid gap-1.5">
                {(
                  [
                    [en ? 'Pay from' : '지급 자금', confirmPay.pay.fund === 'voucher' ? (en ? 'Voucher fund' : '바우처 자금') : en ? 'Room fund' : '객실 자금'],
                    [en ? 'Amount' : '금액', php(confirmPay.pay.amount)],
                    [en ? 'Method' : '지급 수단', confirmPay.pay.method],
                    [en ? 'Date paid' : '지급일', formatLongDate(confirmPay.pay.date)],
                    [en ? 'Month' : '정산 월', formatMonth(month)],
                    ...(confirmPay.pay.reference ? [[en ? 'Reference' : '참조 번호', confirmPay.pay.reference]] : []),
                    ...(confirmPay.pay.oic ? [['OIC', confirmPay.pay.oic]] : []),
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="text-muted">{k}</span>
                    <b className={`text-ink text-right ${k === (en ? 'Amount' : '금액') ? 'num text-[15px]' : ''}`}>{v}</b>
                  </div>
                ))}
                <div className="mt-1 text-[12px] text-muted">
                  {en ? 'This comes out of the fund above in the Fund page.' : '자금 페이지에서 위 자금이 출금됩니다.'}
                </div>
              </div>
            ) : confirmPay.kind === 'delete' ? (
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
          confirmLabel={confirmPay.kind === 'delete' ? (en ? 'Delete' : '삭제') : confirmPay.kind === 'add' ? (en ? 'Confirm payment' : '지급 확인') : en ? 'Save' : '저장'}
          cancelLabel={en ? 'Cancel' : '취소'}
          onCancel={() => setConfirmPay(null)}
          onConfirm={() => {
            if (confirmPay.kind === 'delete') removeHotelPayment(confirmPay.pay.id);
            else if (confirmPay.kind === 'add') commitHotelPayment(confirmPay.pay);
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

type GuestMoneyRow = {
  id: string;
  kind: 'room' | 'voucher';
  name: string;
  agent: string;
  res?: Reservation;
  vs?: VoucherSale;
  pays: FolioPayment[];
  total: number;
  paid: number;
  balance: number;
  status: 'paid' | 'partial' | 'unpaid';
  /** nights of the stay inside this month */
  nights: number;
};

/** Guest rows in the Guest payments pop-ups, laid out like the Guest Ledger table. Room rows open Billing. */
const GuestMoneyTable: React.FC<{ rows: GuestMoneyRow[]; all: GuestMoneyRow[]; kind: 'room' | 'voucher'; en: boolean; onOpen: (id: string) => void }> = ({ rows, all, kind, en, onOpen }) => (
  <table className="dtable compact">
    <thead>
      <tr>
        <th>{en ? 'Guest name' : '손님 이름'}</th>
        {kind === 'room' ? (
          <>
            <th>{en ? 'Room type' : '객실 타입'}</th>
            <th>{en ? 'Stay' : '숙박 기간'}</th>
            <th className="c">{en ? 'Nights' : '박수'}</th>
          </>
        ) : (
          <>
            <th>{en ? 'Vouchers' : '바우처'}</th>
            <th>{en ? 'Date' : '날짜'}</th>
          </>
        )}
        <th className="r">{en ? 'Total' : '합계'}</th>
        <th className="r">{en ? 'Paid' : '결제액'}</th>
        <th className="r">{en ? 'Balance' : '잔액'}</th>
        <th>{en ? 'Payment' : '결제'}</th>
        <th className="c">{en ? 'Status' : '상태'}</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((x) => {
        const last = x.pays.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
        const methods = Array.from(new Set(x.pays.map((p) => p.method))).join(', ');
        return (
          <tr key={x.id} onClick={x.res ? () => onOpen(x.id) : undefined} className={x.res ? 'cursor-pointer' : ''}>
            <td className="leading-tight">
              <div className="font-medium text-ink whitespace-nowrap">{x.name}</div>
              {x.agent && <div className="text-[11px] text-muted whitespace-nowrap">{en ? 'Agent' : '에이전트'} · {x.agent}</div>}
            </td>
            {x.res ? (
              <>
                <td className="whitespace-nowrap text-ink-2">{x.res.roomType}</td>
                <td className="whitespace-nowrap text-ink-2">{formatDateRange(x.res.checkIn, x.res.checkOut)}</td>
                <td className="c num">{x.nights}</td>
              </>
            ) : (
              <>
                <td className="text-ink-2">{x.vs?.items.map((c) => `${c.description} × ${c.qty}`).join(', ')}</td>
                <td className="whitespace-nowrap text-ink-2">{x.vs && formatLongDate(x.vs.date)}</td>
              </>
            )}
            <td className="r num font-semibold text-ink whitespace-nowrap">{php(x.total)}</td>
            <td className={`r num whitespace-nowrap ${x.paid > 0 ? 'text-ok' : 'text-faint'}`}>{php(x.paid)}</td>
            <td className={`r num font-semibold whitespace-nowrap ${x.balance > 0 ? 'text-bad' : 'text-faint'}`}>{php(Math.max(x.balance, 0))}</td>
            <td className="text-[11.5px] text-muted whitespace-nowrap">{last ? `${methods} · ${formatLongDate(last.date)}` : '—'}</td>
            <td className="c">
              {x.status === 'paid' ? (
                <span className="badge badge-ok badge-dot">{en ? 'Paid' : '결제 완료'}</span>
              ) : x.status === 'partial' ? (
                <span className="badge badge-warn badge-dot">{en ? 'Partial' : '부분 결제'}</span>
              ) : (
                <span className="badge badge-bad badge-dot">{en ? 'Unpaid' : '미결제'}</span>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
    {/* grand total of the whole tab (every page) */}
    <tfoot>
      <tr>
        <td colSpan={3}>
          {en ? 'Grand total' : '총합계'} <span className="text-muted font-normal">· {all.length} {kind === 'room' ? (en ? 'bookings' : '건') : en ? 'purchases' : '건'}</span>
        </td>
        {kind === 'room' && <td className="c num">{all.reduce((a, x) => a + x.nights, 0)}</td>}
        <td className="r num text-ink">{php(all.reduce((a, x) => a + x.total, 0))}</td>
        <td className="r num text-ok">{php(all.reduce((a, x) => a + x.paid, 0))}</td>
        <td className="r num text-bad">{php(all.reduce((a, x) => a + Math.max(x.balance, 0), 0))}</td>
        <td colSpan={2} />
      </tr>
    </tfoot>
  </table>
);

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
  /** a string = one chip; any other node is shown as is */
  pill: React.ReactNode;
  tone: keyof typeof TONE;
  color: keyof typeof CARD_COLOR;
  onClick?: () => void;
  /** small note under the label (what the number counts) */
  hint?: React.ReactNode;
  /** colour of the big number (default ink) */
  valueClass?: string;
}> = ({ Icon, label, value, pill, tone, color, onClick, hint, valueClass = 'text-ink' }) => (
  <div
    onClick={onClick}
    className={`card ${CARD_COLOR[color].card} p-5 flex flex-col justify-between min-h-[118px] ${onClick ? 'cursor-pointer hover:brightness-[0.98] transition' : ''}`}
  >
    <div className="flex items-center gap-3">
      <span className={`w-9 h-9 rounded-[10px] grid place-items-center text-white ${CARD_COLOR[color].icon}`}>
        <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] text-ink-2">{label}</span>
        {hint && <span className="block text-[11px] text-muted mt-0.5">{hint}</span>}
      </span>
      {onClick && <ArrowUpRight className="w-3.5 h-3.5 text-faint ml-auto" />}
    </div>
    <div className="flex items-end justify-between gap-2 mt-4">
      <span className={`num text-[22px] font-semibold leading-none tracking-tight ${valueClass}`}>{value}</span>
      {typeof pill === 'string' ? (
        <span className={`num inline-flex items-center h-6 px-2 rounded-full text-[11px] font-semibold whitespace-nowrap bg-surface/80 ${TONE[tone]}`}>{pill}</span>
      ) : (
        pill
      )}
    </div>
  </div>
);
