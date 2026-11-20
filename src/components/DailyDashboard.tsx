import React, { useState, useMemo } from 'react';
import { DailySettlement, bookingDays } from './DailySettlement';
import { DailyBillList, useMonthBill } from './HotelBillingReport';
import { Reservation, CasinoRatesConfig, Settlement, PaymentMethod, FolioPayment, VoucherSale, HotelPurchase, FundTxn } from '../types/hotel';
import { buildFundEntries } from './FundPage';
import { itemLabel, purchaseTotal } from '../utils/inventory';
import { folioOf, voucherTotals, settlementOf, PAYMENT_METHODS, uid, nowStamp, todayISO, printDocument, escapeHtml as esc } from '../utils/billing';
import { GuestFolio } from './GuestFolio';
import { exportSettlementExcel } from '../utils/excelExport';
import { getDaysInMonth, getStayNights, formatCurrency, formatLongDate, formatShortDate, formatMonth, formatDateRange } from '../utils/hotelHelpers';
import { FileSpreadsheet, CheckCircle2, Printer, Wallet, Scale, Landmark, Plus, Pencil, Trash2, Receipt, Users, History, BedDouble, Ticket, ShoppingCart, ChevronRight, TrendingUp, TrendingDown, CalendarCheck } from 'lucide-react';
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
  /** Fund cash ins / cash outs — to know how much cash / bank money each fund has */
  fundTxns: FundTxn[];
  onOpenInventory: () => void;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
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
  fundTxns,
  onOpenInventory,
  selectedMonth,
  setSelectedMonth,
  language,
}) => {
  const en = language === 'en';
  const month = selectedMonth || '2026-11';

  const monthRes = useMemo(() => reservations.filter((r) => r.checkIn.slice(0, 7) === month), [reservations, month]);
  const hotelPays = settlementOf(settlements, month).payments;
  const monthPurchases = useMemo(() => purchases.filter((p) => p.date.slice(0, 7) === month), [purchases, month]);
  // Hotel Bill pop-up: purchases list, or every day like the hotel's Monthly Billing Report
  const [billTab, setBillTab] = useState<'purchases' | 'daily'>('daily');
  const monthBill = useMonthBill(month, purchases);
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
    const months = Array.from(new Set([...MONTHS, ...reservations.map((r) => r.checkIn.slice(0, 7)), ...purchases.map((p) => p.date.slice(0, 7))])).sort().reverse();
    return months.map((m) => ({
      month: m,
      ...summarize(
        reservations.filter((r) => r.checkIn.slice(0, 7) === m),
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
  const [showBought, setShowBought] = useState(false);
  // Settlement History row → that month's breakdown
  const [historyMonth, setHistoryMonth] = useState<string | null>(null);
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
  // what the chosen fund holds on the side of the chosen method (Cash vs Bank / e-wallet); when editing,
  // this payment's own old amount is added back if it came from the same side
  const payIsCash = payMethod === 'Cash';
  const sideOf = (m: PaymentMethod) => (m === 'Cash' ? 'cash' : 'other');
  const fundHolds = useMemo(() => {
    const b = { room: { cash: 0, other: 0 }, voucher: { cash: 0, other: 0 } };
    for (const e of buildFundEntries(reservations, voucherSales, settlements, fundTxns, en)) {
      if (e.voided) continue;
      b[e.fund][sideOf(e.method)] += e.dir === 'in' ? e.amount : -e.amount;
    }
    return b;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservations, voucherSales, settlements, fundTxns, en]);
  const available =
    fundHolds[payFund][payIsCash ? 'cash' : 'other'] +
    (editingPay && (editingPay.fund === 'voucher' ? 'voucher' : 'room') === payFund && sideOf(editingPay.method) === (payIsCash ? 'cash' : 'other') ? editingPay.amount : 0);
  const shortOfMoney = payAmount > Math.max(available, 0);

  const editHotelPayment = (p: FolioPayment) => {
    setEditingPay(p);
    setPayOpen(true);
  };

  // Edit and delete both ask for confirmation first.
  const [confirmPay, setConfirmPay] = useState<{ kind: 'add' | 'edit' | 'delete'; pay: FolioPayment } | null>(null);

  const addHotelPayment = () => {
    if (payAmount <= 0 || overPay || shortOfMoney) return;
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

  // Profit this month = what guests were charged for this month's nights & vouchers − the Hotel Bill
  const sales = guestMoney.rooms.billed + guestMoney.vouchers.billed;
  // newest payment to the hotel for this month (Paid to hotel card)
  const lastHotelPay = [...hotelPays].sort((x, y) => (y.date + (y.recordedAt || '')).localeCompare(x.date + (x.recordedAt || '')))[0];
  const profit = sales - s.billed;

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

      {/* Row 1 — cards in the Fund-card style: name + total on top, 2 breakdown lines under */}
      {(() => {
        const billed = guestMoney.rooms.billed + guestMoney.vouchers.billed;
        const received = guestMoney.rooms.paid + guestMoney.vouchers.paid;
        const unpaidTotal = guestMoney.rooms.unpaid + guestMoney.vouchers.unpaid;
        const noBill = s.billed === 0 && s.settled === 0;
        // Hotel Bill card = what is still owed: each fund's purchases − payments from that fund
        const owed = (f: 'room' | 'voucher') => Math.max(fundBill[f] - fundPaid[f], 0);
        const owedRow = (f: 'room' | 'voucher'): [string, string] =>
          fundBill[f] > 0 && owed(f) === 0 ? [en ? 'Paid' : '지급 완료', 'text-ok'] : [php(owed(f)), 'text-ink'];
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-4">
            <StatCard
              en={en}
              Icon={Wallet}
              color="blue"
              label={en ? 'Hotel Bill' : '호텔 청구액'}
              note={
                s.settled > 0
                  ? `${en ? 'Left to pay of' : '미지급 / 총'} ${php(s.billed)}`
                  : `${s.purchases} ${en ? (s.purchases === 1 ? 'purchase' : 'purchases') : '건'}`
              }
              value={php(s.balance)}
              valueClass={s.billed > 0 && s.balance === 0 ? 'text-ok' : 'text-accent'}
              rows={[
                [BedDouble, en ? 'Rooms' : '객실', ...owedRow('room')],
                [Ticket, en ? 'Vouchers' : '바우처', ...owedRow('voucher')],
              ]}
              onClick={() => setShowBought(true)}
            />
            <StatCard
              en={en}
              Icon={Landmark}
              color="green"
              label={en ? 'Paid to hotel' : '호텔 지급액'}
              note={
                noBill
                  ? en ? 'No bill yet' : '청구 없음'
                  : `${s.balance > 0 ? (en ? 'Open' : '미정산') : en ? 'Settled' : '정산 완료'} · ${Math.min(100, Math.round((s.settled / s.billed) * 100))}% ${en ? 'paid' : '지급'}`
              }
              value={php(s.settled)}
              valueClass="text-ok"
              rows={[
                [Scale, en ? 'Remaining balance' : '남은 잔액', php(s.balance), s.balance > 0 ? 'text-bad' : 'text-ink'],
                lastHotelPay
                  ? [CalendarCheck, `${en ? 'Last paid' : '최근 지급'} · ${formatShortDate(lastHotelPay.date)}`, php(lastHotelPay.amount)]
                  : [CalendarCheck, en ? 'Last paid' : '최근 지급', en ? 'None yet' : '없음', 'text-muted'],
              ]}
              onClick={() => setShowHotelBill(true)}
            />
            <StatCard
              en={en}
              Icon={Users}
              color="green"
              label={en ? 'Guest payments' : '손님 결제'}
              note={`${billed ? Math.round((received / billed) * 100) : 0}% ${en ? 'collected' : '수금'}`}
              value={php(received)}
              valueClass="text-ok"
              rows={[
                [BedDouble, en ? 'Rooms' : '객실', php(guestMoney.rooms.paid)],
                [Ticket, en ? 'Vouchers' : '바우처', php(guestMoney.vouchers.paid)],
              ]}
              onClick={() => {
                setReceivedTab(guestMoney.rooms.paid || !guestMoney.vouchers.paid ? 'room' : 'voucher');
                setReceivedPage(0);
              }}
            />
            <StatCard
              en={en}
              Icon={Receipt}
              color="red"
              label={en ? 'Unpaid by guests' : '손님 미결제'}
              note={`${guestMoney.owing.length} ${en ? (guestMoney.owing.length === 1 ? 'guest' : 'guests') : '명'}`}
              value={php(unpaidTotal)}
              valueClass={unpaidTotal > 0 ? 'text-bad' : 'text-ok'}
              rows={[
                [BedDouble, en ? 'Rooms' : '객실', php(guestMoney.rooms.unpaid), guestMoney.rooms.unpaid > 0 ? 'text-bad' : 'text-ink'],
                [Ticket, en ? 'Vouchers' : '바우처', php(guestMoney.vouchers.unpaid), guestMoney.vouchers.unpaid > 0 ? 'text-bad' : 'text-ink'],
              ]}
              onClick={() => openGuestMoney(guestMoney.rooms.unpaid || !guestMoney.vouchers.unpaid ? 'room' : 'voucher')}
            />
            <StatCard
              en={en}
              Icon={profit < 0 ? TrendingDown : TrendingUp}
              color={profit < 0 ? 'red' : 'green'}
              label={en ? 'Profit' : '이익'}
              note={sales ? `${Math.round((profit / sales) * 100)}% ${en ? 'of sales' : '매출 대비'}` : en ? 'No sales yet' : '매출 없음'}
              value={`${profit < 0 ? '−' : ''}${php(Math.abs(profit))}`}
              valueClass={profit < 0 ? 'text-bad' : 'text-ok'}
              rows={[
                [Users, en ? 'Sales to guests' : '손님 매출', php(sales)],
                [Wallet, en ? 'Hotel Bill' : '호텔 청구액', `−${php(s.billed)}`],
              ]}
              noFooter
            />
          </div>
        );
      })()}

      {/* Row 2 — daily settlement + payments / guest balances */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
        {/* the card takes its height from the row (the cards on the right), never from its days,
            so only the table inside it scrolls; on narrow screens it gets a fixed height */}
        <div className="xl:col-span-2 min-w-0 relative h-[640px] xl:h-auto xl:min-h-[560px]">
          <div className="absolute inset-0">
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
        </div>

        <div className="flex flex-col gap-4">
          {/* Payments Jupiter → Hotel */}
          <div className="card p-6 flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="card-title flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-[10px] grid place-items-center bg-ok-soft text-ok">
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
              <span className="w-8 h-8 rounded-[10px] grid place-items-center bg-warn-soft text-warn">
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
              <span className="w-8 h-8 rounded-[10px] grid place-items-center bg-violet-soft text-violet">
                <History className="w-4 h-4" strokeWidth={1.75} />
              </span>
              {en ? 'Settlement History' : '정산 이력'}
            </h3>
            <p className="text-[12.5px] text-muted mt-1">{en ? 'Click a month to see its breakdown' : '월을 클릭하면 내역을 볼 수 있습니다'}</p>
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
                <tr key={h.month} onClick={() => setHistoryMonth(h.month)} className={`cursor-pointer ${h.month === month ? '!bg-accent-soft/60' : ''}`}>
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

      {/* Settlement History → one month's breakdown: one table, per fund, what was bought and what was paid */}
      {historyMonth &&
        (() => {
          const m = historyMonth;
          const h = history.find((x) => x.month === m)!;
          const bought = purchases.filter((p) => p.date.slice(0, 7) === m).sort((a, b) => a.date.localeCompare(b.date));
          const pays = [...settlementOf(settlements, m).payments].sort((a, b) => a.date.localeCompare(b.date));
          const pct = h.billed > 0 ? Math.min(100, Math.round((h.settled / h.billed) * 100)) : 0;
          const SHOW = 6; // lines per fund before "+N more" (keeps the pop-up without a scrollbar)
          const funds = (['room', 'voucher'] as const).map((k) => {
            const lines = [
              ...bought.flatMap((p) =>
                p.items
                  .filter((i) => i.kind === k)
                  .map((i) => ({
                    key: `${p.id}-${i.id}`,
                    date: p.date,
                    what: (
                      <>
                        <b className="font-semibold text-ink">{i.qty}</b> × {itemLabel(i, casinoRates, en)}
                        {!i.unitCost && <span className="ml-1.5 badge badge-ok">{en ? 'Free' : '무료'}</span>}
                      </>
                    ),
                    method: '',
                    bill: i.qty * i.unitCost,
                    paid: 0,
                  }))
              ),
              ...pays
                .filter((p) => (p.fund === 'voucher' ? 'voucher' : 'room') === k)
                .map((p) => ({
                  key: p.id,
                  date: p.date,
                  what: (
                    <span className="text-ok">
                      {en ? 'Payment to hotel' : '호텔 지급'}
                      {p.reference ? <span className="text-muted"> · {p.reference}</span> : null}
                    </span>
                  ),
                  method: p.method as string,
                  bill: 0,
                  paid: p.amount,
                })),
            ].sort((x, y) => x.date.localeCompare(y.date) || y.bill - x.bill);
            const bill = lines.reduce((a, x) => a + x.bill, 0);
            const paid = lines.reduce((a, x) => a + x.paid, 0);
            return { k, lines, bill, paid, due: Math.max(bill - paid, 0) };
          });
          return (
            <Dialog
              width="max-w-3xl"
              onClose={() => setHistoryMonth(null)}
              title={en ? `Settlement · ${formatMonth(m)}` : `정산 · ${formatMonth(m)}`}
              subtitle={
                en
                  ? `${bought.length} ${bought.length === 1 ? 'purchase' : 'purchases'} · ${pays.length} ${pays.length === 1 ? 'payment' : 'payments'} to the hotel${h.count ? ` · ${h.count} ${h.count === 1 ? 'booking' : 'bookings'}, ${h.nights} ${h.nights === 1 ? 'night' : 'nights'}` : ''}`
                  : `구매 ${bought.length}건 · 호텔 지급 ${pays.length}건${h.count ? ` · 예약 ${h.count}건, ${h.nights}박` : ''}`
              }
            >
              <div className="px-6 py-4 grid gap-3">
                {/* how much of the bill is paid */}
                <div className="flex items-center gap-3 text-[12px]">
                  <span className="text-muted whitespace-nowrap">
                    {en ? 'Paid' : '지급'} <b className="num text-ok">{php(h.settled)}</b> {en ? 'of' : '/'} <b className="num text-ink">{php(h.billed)}</b>
                  </span>
                  <RaceLine pct={pct} track="bg-canvas" />
                  <span className="num font-bold text-ink">{pct}%</span>
                </div>

                <table className="dtable compact">
                  <thead>
                    <tr>
                      <th className="w-[150px]">{en ? 'Date' : '날짜'}</th>
                      <th>{en ? 'Details' : '내역'}</th>
                      <th>{en ? 'Payment method' : '지급 수단'}</th>
                      <th className="r !text-accent">{en ? 'Hotel Bill' : '호텔 청구액'}</th>
                      <th className="r !text-ok">{en ? 'Paid' : '지급'}</th>
                    </tr>
                  </thead>
                  {funds.map((f) => (
                    <tbody key={f.k}>
                      {/* fund header: name + what is still due */}
                      <tr className={f.k === 'room' ? '!bg-accent-soft/60' : '!bg-warn-soft/60'}>
                        <td colSpan={3}>
                          <span className={`inline-flex items-center gap-2 font-semibold ${f.k === 'room' ? 'text-accent' : 'text-warn'}`}>
                            {f.k === 'room' ? <BedDouble className="w-4 h-4" /> : <Ticket className="w-4 h-4" />}
                            {f.k === 'room' ? (en ? 'Room fund' : '객실 자금') : en ? 'Voucher fund' : '바우처 자금'}
                          </span>
                        </td>
                        <td colSpan={2} className="r text-[12px]">
                          {f.bill === 0 && f.paid === 0 ? (
                            <span className="text-muted">{en ? 'Nothing bought' : '구매 없음'}</span>
                          ) : f.due > 0 ? (
                            <span className="text-bad font-semibold">
                              {en ? 'Balance' : '잔액'} <span className="num">{php(f.due)}</span>
                            </span>
                          ) : (
                            <span className="text-ok font-semibold">{en ? 'Fully paid' : '지급 완료'}</span>
                          )}
                        </td>
                      </tr>
                      {f.lines.slice(0, SHOW).map((x) => (
                        <tr key={x.key}>
                          <td className="text-ink-2 whitespace-nowrap pl-8">{formatLongDate(x.date)}</td>
                          <td className="text-ink-2">{x.what}</td>
                          <td className="text-ink-2 whitespace-nowrap">{x.method || <Dim />}</td>
                          <td className="r num font-semibold text-ink">{x.bill ? php(x.bill) : <Dim />}</td>
                          <td className="r num font-semibold text-ok">{x.paid ? php(x.paid) : <Dim />}</td>
                        </tr>
                      ))}
                      {f.lines.length > SHOW && (
                        <tr>
                          <td colSpan={5} className="pl-8 text-[11.5px] text-muted">
                            +{f.lines.length - SHOW} {en ? 'more' : '건 더'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  ))}
                  <tfoot>
                    <tr>
                      <td colSpan={3}>{en ? 'Total' : '합계'}</td>
                      <td className="r num text-accent">{php(h.billed)}</td>
                      <td className="r num text-ok">{php(h.settled)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3}>{en ? 'Balance due to hotel' : '호텔 미지급 잔액'}</td>
                      <td colSpan={2} className={`r num text-[15px] ${h.balance > 0 ? 'text-bad' : 'text-ok'}`}>{php(h.balance)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="px-6 py-3 border-t border-line bg-sunken flex justify-end gap-2">
                <button onClick={() => setHistoryMonth(null)} className="btn btn-ghost">
                  {en ? 'Close' : '닫기'}
                </button>
                <button
                  onClick={() => {
                    setSelectedMonth(m);
                    setHistoryMonth(null);
                  }}
                  className="btn btn-primary"
                >
                  {en ? `Open ${formatMonth(m)}` : `${formatMonth(m)} 열기`}
                </button>
              </div>
            </Dialog>
          );
        })()}

      {/* Hotel Bill → what was bought from the hotel this month */}
      {showBought && (
        <Dialog
          width="max-w-4xl"
          onClose={() => setShowBought(false)}
          title={en ? `Hotel Bill · ${formatMonth(month)}` : `호텔 청구액 · ${formatMonth(month)}`}
          subtitle={
            billTab === 'purchases'
              ? en ? 'Rooms and vouchers bought from the hotel this month' : '이 달 호텔에서 구매한 객실·바우처'
              : en ? 'Hotel Purchases day by day — click a day for its breakdown' : '호텔 구매 일별 내역 — 날짜를 누르면 상세'
          }
        >
          <div className="px-6 pt-4">
            <div className="seg w-full">
              <button type="button" data-active={billTab === 'daily'} onClick={() => setBillTab('daily')} className="flex-1">
                {en ? 'Every day' : '일별'}
              </button>
              <button type="button" data-active={billTab === 'purchases'} onClick={() => setBillTab('purchases')} className="flex-1">
                {en ? 'Purchases' : '구매 내역'}
              </button>
            </div>
          </div>
          {billTab === 'daily' ? (
            <div className="mx-6 my-4 rounded-xl border border-line overflow-hidden">
              <DailyBillList month={month} bill={monthBill} rates={casinoRates} en={en} />
            </div>
          ) : (
          <div className="px-6 py-4">
            {monthPurchases.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-muted">{en ? 'Nothing bought from the hotel this month yet.' : '이 달 호텔 구매가 없습니다.'}</div>
            ) : (
              (() => {
                // one section per fund: Rooms (Room fund) and Vouchers (Voucher fund), like the two lines on the card
                const lines = monthPurchases
                  .flatMap((p) => p.items.map((i) => ({ p, i })))
                  .sort((x, y) => x.p.date.localeCompare(y.p.date));
                const groups = (
                  [
                    ['room', BedDouble, en ? 'Rooms' : '객실', en ? 'Room fund' : '객실 자금', '!bg-accent-soft !text-accent', 'text-accent'],
                    ['voucher', Ticket, en ? 'Vouchers' : '바우처', en ? 'Voucher fund' : '바우처 자금', '!bg-warn-soft !text-warn', 'text-warn'],
                  ] as const
                )
                  .map(([kind, Icon, label, fund, head, tone]) => {
                    const rows = lines.filter((x) => x.i.kind === kind);
                    return { kind, Icon, label, fund, head, tone, rows, qty: rows.reduce((a, x) => a + x.i.qty, 0), amt: rows.reduce((a, x) => a + x.i.qty * x.i.unitCost, 0) };
                  })
                  .filter((g) => g.rows.length);
                // where it came from: bought with a booking / voucher sale (its remarks), or a bulk purchase
                const forOf = (p: (typeof monthPurchases)[number]) =>
                  p.id.startsWith('buy-') ? p.remarks || '—' : p.id === 'opening-stock' ? (en ? 'Opening stock' : '기초 재고') : en ? 'Bought for stock' : '재고 구매';
                return (
                  <table className="dtable compact">
                    <thead>
                      <tr>
                        <th>{en ? 'Date' : '날짜'}</th>
                        <th>{en ? 'Item' : '항목'}</th>
                        <th>{en ? 'For' : '용도'}</th>
                        <th className="c">{en ? 'Qty' : '수량'}</th>
                        <th className="r">{en ? 'Unit cost' : '단가'}</th>
                        <th className="r">{en ? 'Amount' : '금액'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <React.Fragment key={g.kind}>
                          <tr className="hover:!bg-transparent">
                            <td colSpan={3} className={`${g.head} !py-1.5 font-semibold`}>
                              <span className="inline-flex items-center gap-2">
                                <g.Icon className="w-4 h-4" />
                                {g.label}
                                <span className="text-[11px] font-normal opacity-80">· {g.fund}</span>
                              </span>
                            </td>
                            <td className={`${g.head} !py-1.5 c num font-semibold`}>{g.qty}</td>
                            <td className={`${g.head} !py-1.5`} />
                            <td className={`${g.head} !py-1.5 r num font-semibold`}>{php(g.amt)}</td>
                          </tr>
                          {g.rows.map(({ p, i }) => (
                            <tr key={i.id}>
                              <td className="whitespace-nowrap text-ink-2 !pl-8">
                                {formatLongDate(p.date)}
                                {p.reference && <div className="text-[11px] text-muted">{p.reference}</div>}
                              </td>
                              <td className="text-ink font-medium">{itemLabel(i, casinoRates, en)}</td>
                              <td className="text-[12px] text-muted max-w-[220px] truncate" title={forOf(p)}>
                                {forOf(p)}
                              </td>
                              <td className="c num">{i.qty}</td>
                              <td className="r num text-ink-2">{i.unitCost ? php(i.unitCost) : <span className="text-ok">{en ? 'Free' : '무료'}</span>}</td>
                              <td className="r num font-semibold text-ink">{php(i.qty * i.unitCost)}</td>
                            </tr>
                          ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="!bg-ink !text-[#e9c46a]">
                          {en ? `Hotel Bill for ${formatMonth(month)}` : `${formatMonth(month)} 호텔 청구액`}{' '}
                          <span className="font-normal opacity-80">
                            · {monthPurchases.length} {en ? (monthPurchases.length === 1 ? 'purchase' : 'purchases') : '건'}
                          </span>
                        </td>
                        <td className="!bg-ink !text-[#e9c46a] c num">{groups.reduce((a, g) => a + g.qty, 0)}</td>
                        <td className="!bg-ink" />
                        <td className="!bg-ink !text-[#e9c46a] r num text-[14px]">{php(s.billed)}</td>
                      </tr>
                    </tfoot>
                  </table>
                );
              })()
            )}
          </div>
          )}
          <div className="px-6 py-3 border-t border-line bg-sunken flex justify-end gap-2">
            <button onClick={() => setShowBought(false)} className="btn btn-ghost">
              {en ? 'Close' : '닫기'}
            </button>
            <button
              onClick={() => {
                setShowBought(false);
                onOpenInventory();
              }}
              className="btn btn-primary"
            >
              <ShoppingCart className="w-4 h-4" />
              {en ? 'Hotel Purchases' : '호텔 구매'}
            </button>
          </div>
        </Dialog>
      )}

      {/* Paid to hotel → how much of the month's hotel bill is paid, per fund */}
      {showHotelBill && (
        <Dialog
          width="max-w-3xl"
          onClose={() => setShowHotelBill(false)}
          title={en ? `Hotel bill · ${formatMonth(month)}` : `호텔 청구 · ${formatMonth(month)}`}
          subtitle={en ? `Payments to the hotel this month, per fund · ${hotelPays.length} ${hotelPays.length === 1 ? 'payment' : 'payments'}` : `이 달 자금별 호텔 지급 내역 · ${hotelPays.length}건`}
        >
          <div className="px-6 py-4 grid gap-4">
            {/* 1) each fund: bill → paid → remaining */}
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['room', BedDouble, en ? 'Room fund' : '객실 자금', 'text-accent', 'bg-accent-soft/60 border-accent-line'],
                  ['voucher', Ticket, en ? 'Voucher fund' : '바우처 자금', 'text-warn', 'bg-warn-soft/60 border-warn-line'],
                ] as const
              ).map(([k, Icon, label, tone, box]) => {
                const pct = fundBill[k] ? Math.min(100, Math.round((fundPaid[k] / fundBill[k]) * 100)) : 0;
                return (
                  <div key={k} className={`rounded-xl border px-4 py-3 ${box}`}>
                    <div className={`flex items-center gap-2 text-[13px] font-semibold ${tone}`}>
                      <Icon className="w-4 h-4" />
                      {label}
                      <span className="ml-auto num text-[11.5px] text-muted font-medium">
                        {pct}% {en ? 'paid' : '지급'}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-[12.5px]">
                      <div className="flex justify-between">
                        <span className="text-muted">{en ? 'Hotel bill' : '청구액'}</span>
                        <span className="num font-semibold text-ink">{php(fundBill[k])}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">{en ? 'Paid' : '지급'}</span>
                        <span className="num font-semibold text-ok">−{php(fundPaid[k])}</span>
                      </div>
                      <div className="flex justify-between border-t border-black/[0.07] pt-1 mt-0.5">
                        <span className="font-semibold text-ink">{en ? 'Remaining' : '잔액'}</span>
                        <span className={`num font-bold ${fundDue[k] > 0 ? 'text-bad' : 'text-ok'}`}>{php(fundDue[k])}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 2) every payment made to the hotel this month */}
            {(() => {
              const list = [...hotelPays].sort((x, y) => x.date.localeCompare(y.date));
              const SHOW = 6;
              return (
                <table className="dtable compact">
                  <thead>
                    <tr>
                      <th>{en ? 'Date paid' : '지급일'}</th>
                      <th>{en ? 'From fund' : '자금'}</th>
                      <th>{en ? 'Payment method' : '지급 수단'}</th>
                      <th>{en ? 'Reference / OIC' : '참조 / OIC'}</th>
                      <th className="r">{en ? 'Amount' : '금액'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-[12.5px] text-muted">
                          {en ? 'No payments to the hotel yet' : '호텔 지급 내역이 없습니다'}
                        </td>
                      </tr>
                    ) : (
                      list.slice(0, SHOW).map((p) => (
                        <tr key={p.id}>
                          <td className="text-ink-2 whitespace-nowrap">
                            {formatLongDate(p.date)}
                            {p.recordedAt && <div className="text-[11px] text-muted">{en ? 'recorded' : '기록'} {clockOf(p.recordedAt)}</div>}
                          </td>
                          <td>
                            <span className={`badge ${p.fund === 'voucher' ? 'badge-warn' : 'badge-info'}`}>
                              {p.fund === 'voucher' ? (en ? 'Voucher fund' : '바우처 자금') : en ? 'Room fund' : '객실 자금'}
                            </span>
                          </td>
                          <td className="text-ink-2 whitespace-nowrap">{p.method}</td>
                          <td className="text-muted">
                            {[p.reference, p.oic && `OIC ${p.oic}`].filter(Boolean).join(' · ') || <Dim />}
                            {p.remarks && <div className="text-[11px] text-faint truncate max-w-[220px]" title={p.remarks}>{p.remarks}</div>}
                          </td>
                          <td className="r num font-semibold text-ok">{php(p.amount)}</td>
                        </tr>
                      ))
                    )}
                    {list.length > SHOW && (
                      <tr>
                        <td colSpan={5} className="text-[11.5px] text-muted">
                          +{list.length - SHOW} {en ? 'more' : '건 더'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>
                        {en ? 'Total paid' : '지급 합계'}
                      </td>
                      <td className="r num text-ok">{php(s.settled)}</td>
                    </tr>
                    <tr>
                      <td colSpan={4}>{en ? 'Remaining balance' : '남은 잔액'}</td>
                      <td className={`r num text-[15px] ${s.balance > 0 ? 'text-bad' : 'text-ok'}`}>{php(s.balance)}</td>
                    </tr>
                  </tfoot>
                </table>
              );
            })()}
          </div>
          <div className="px-6 py-3 border-t border-line bg-sunken flex justify-end gap-2">
            <button onClick={() => setShowHotelBill(false)} className="btn btn-ghost">
              {en ? 'Close' : '닫기'}
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
                  className={`input num pl-7 text-[15px] font-semibold ${overPay || shortOfMoney ? '!border-bad' : ''}`}
                />
              </div>
              {overPay ? (
                <div className="text-[11.5px] text-bad mt-1">
                  {en ? `Cannot be more than the bill. Max ${php(maxPay)}` : `청구액을 초과할 수 없습니다. 최대 ${php(maxPay)}`}
                </div>
              ) : shortOfMoney ? (
                <div className="text-[11.5px] text-bad mt-1">
                  {en
                    ? `Not enough ${payIsCash ? 'cash' : 'bank / e-wallet money'} in the ${payFund === 'voucher' ? 'Voucher' : 'Room'} fund: only ${php(Math.max(available, 0))}. Pick another method or lower the amount.`
                    : `${payFund === 'voucher' ? '바우처' : '객실'} 자금의 ${payIsCash ? '현금' : '은행·전자'} 잔액 부족: ${php(Math.max(available, 0))}. 다른 수단을 선택하거나 금액을 줄이세요.`}
                </div>
              ) : (
                <div className="text-[11.5px] text-muted mt-1">
                  {en ? `Max ${php(maxPay)}` : `최대 ${php(maxPay)}`} ·{' '}
                  {en
                    ? `${payFund === 'voucher' ? 'Voucher' : 'Room'} fund has ${php(Math.max(available, 0))} in ${payIsCash ? 'cash' : 'bank / e-wallet'}`
                    : `${payFund === 'voucher' ? '바우처' : '객실'} 자금 ${payIsCash ? '현금' : '은행·전자'} ${php(Math.max(available, 0))}`}
                </div>
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
            <button onClick={addHotelPayment} disabled={payAmount <= 0 || overPay || shortOfMoney} className="btn btn-primary">
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

/** Progress line that fills from 0 to `pct` when it appears. */
const RaceLine: React.FC<{ pct: number; track: string }> = ({ pct, track }) => {
  const [w, setW] = useState(0);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <div className={`flex-1 h-2 rounded-full overflow-hidden ${track}`}>
      <div className="h-full rounded-full bg-ok transition-[width] duration-1000 ease-out" style={{ width: `${w}%` }} />
    </div>
  );
};

/** "2026-11-18 21:10:05" → "9:10 PM" */
const clockOf = (at: string) => {
  const m = /[ T](\d{2}):(\d{2})/.exec(at);
  if (!m) return '';
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
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

// card colour: tinted background + border, solid icon tile
// card colour = the Daily Settlement column colours (blue total · green paid · red unpaid · amber vouchers)
const CARD_COLOR = {
  blue: { text: 'text-accent', tile: 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/20', wash: 'from-accent/20 via-accent-soft to-accent-soft/30', ring: 'hover:border-accent/40', btn: 'group-hover:bg-accent group-hover:text-white' },
  green: { text: 'text-ok', tile: 'bg-ok/15 text-ok ring-1 ring-inset ring-ok/20', wash: 'from-ok/20 via-ok-soft to-ok-soft/30', ring: 'hover:border-ok/40', btn: 'group-hover:bg-ok group-hover:text-white' },
  red: { text: 'text-bad', tile: 'bg-bad/15 text-bad ring-1 ring-inset ring-bad/20', wash: 'from-bad/20 via-bad-soft to-bad-soft/30', ring: 'hover:border-bad/40', btn: 'group-hover:bg-bad group-hover:text-white' },
  amber: { text: 'text-warn', tile: 'bg-warn/15 text-warn ring-1 ring-inset ring-warn/20', wash: 'from-warn/20 via-warn-soft to-warn-soft/30', ring: 'hover:border-warn/40', btn: 'group-hover:bg-warn group-hover:text-white' },
  violet: { text: 'text-violet', tile: 'bg-violet/15 text-violet ring-1 ring-inset ring-violet/20', wash: 'from-violet/20 via-violet-soft to-violet-soft/30', ring: 'hover:border-violet/40', btn: 'group-hover:bg-violet group-hover:text-white' },
} as const;

/**
 * Dashboard card: icon + name left, total right, breakdown lines under, "View details" at the bottom.
 * One soft colour wash, no hard split.
 */
const StatCard: React.FC<{
  Icon: React.ElementType;
  label: string;
  /** small grey note under the name (count / status) */
  note?: string;
  value: React.ReactNode;
  /** colour of the total (default ink) */
  valueClass?: string;
  color: keyof typeof CARD_COLOR;
  /** breakdown lines: [icon, name, amount, amount colour?] */
  rows: [React.ElementType, string, string, string?][];
  /** optional "how much is done" line (0–100) under the breakdown */
  progress?: number;
  onClick?: () => void;
  /** hide the "View details" / "Nothing to check" line (card opens nothing) */
  noFooter?: boolean;
  en: boolean;
}> = ({ Icon, label, note, value, valueClass = 'text-ink', color, rows, progress, onClick, noFooter, en }) => {
  const c = CARD_COLOR[color];
  return (
    <div
      onClick={onClick}
      title={onClick ? (en ? 'Click to see the breakdown' : '클릭하여 내역 보기') : undefined}
      className={`card relative overflow-hidden flex flex-col p-4 bg-linear-to-br ${c.wash} !shadow-[0_1px_2px_rgb(17_18_20/0.05),0_10px_28px_-14px_rgb(17_18_20/0.25)] transition-all duration-200 ${
        onClick ? `group cursor-pointer hover:-translate-y-0.5 ${c.ring} hover:!shadow-[0_2px_4px_rgb(17_18_20/0.06),0_18px_36px_-16px_rgb(17_18_20/0.32)]` : ''
      }`}
    >
      {/* name left, total right */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${c.tile}`}>
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
        {rows.map(([I, name, v, cls]) => (
          <div key={name} className="flex items-center gap-2">
            <I className="w-3.5 h-3.5 text-muted" />
            <span className="text-muted">{name}</span>
            <span className={`ml-auto num font-semibold ${cls || 'text-ink'}`}>{v}</span>
          </div>
        ))}
        {progress !== undefined && (
          <div className="flex items-center gap-2">
            <RaceLine pct={progress} track="bg-canvas" />
            <span className={`num font-semibold w-9 text-right ${progress >= 100 ? 'text-ok' : 'text-ink'}`}>{progress}%</span>
          </div>
        )}
      </div>

      {/* tells staff the card opens a breakdown */}
      {!noFooter && (
      <div className="mt-auto pt-2.5">
        <div className="pt-2 border-t border-black/[0.06] flex items-center text-[11.5px] font-semibold">
          {onClick ? (
            <span className={`inline-flex items-center gap-1 ${c.text}`}>
              {en ? 'View details' : '자세히 보기'}
              <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          ) : (
            <span className="text-faint font-medium">{en ? 'Nothing to check' : '확인할 내역 없음'}</span>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
