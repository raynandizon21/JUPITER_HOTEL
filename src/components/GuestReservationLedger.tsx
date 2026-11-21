import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Agent, Holiday, Reservation, CasinoRatesConfig, PaymentStatus, VoucherSale, FolioCharge, HotelPurchase, PurchaseItem } from '../types/hotel';
import { getReferenceMonth, exportToCSV, getNightlyRates, addDays, formatLongDate, formatMonth, formatDateRange, nightsLabel, getStayNights, getDaysInMonth } from '../utils/hotelHelpers';
import { Plus, Search, Download, Pencil, Trash2, Sparkles, Receipt, Ticket, BedDouble, Settings2, CircleCheck, CircleX } from 'lucide-react';
import { GuestFolio, FolioStatusBadge } from './GuestFolio';
import { folioOf, syncStatus, uid, peso, nowStamp, todayISO, voucherTotals, chargeAmount } from '../utils/billing';
import { Language, translations } from '../i18n/translations';
import { PageHeader, Dialog, ConfirmDialog, ComboInput, Pager, toast, Select } from './ui';
import { VoucherSaleForm, VoucherItemsEditor } from './VoucherSaleForm';
import { StockWarning, useStockLeft } from './StockContext';
import { HolidaysMaintenance } from './HolidaysMaintenance';
import { DateFilter } from './DateFilter';
import { NightRateText, ChargeAmountText } from './StayBreakdown';
import { HotelCostInput, BuyLine, linkedPurchaseId, HG, SourceSelect, StockBadge, VoucherSource } from './HotelCostSection';
import { chargeStockItem, itemLabel, stockKey } from '../utils/inventory';

interface GuestReservationLedgerProps {
  /** Agents file maintenance list (suggestions for the Agent field). */
  agents?: Agent[];
  /** Philippine holidays — nights on these dates get the holiday rate ticked automatically. */
  holidays?: Holiday[];
  /** Full holiday list + save — for the ⚙ Holidays settings pop-up. */
  allHolidays?: Holiday[];
  onSaveHoliday?: (h: Holiday) => void;
  reservations: Reservation[];
  setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
  /** Vouchers bought without a room booking (for the record). */
  voucherSales: VoucherSale[];
  setVoucherSales: React.Dispatch<React.SetStateAction<VoucherSale[]>>;
  casinoRates: CasinoRatesConfig;
  selectedMonth: string;
  setSelectedMonth: (month: string) => void;
  language: Language;
  /** Open the New Reservation form right away (from the top bar "New Booking" button). */
  autoOpenNew?: boolean;
  onAutoOpened?: () => void;
  /** Render only the New Reservation pop-up (opened from the top "New Booking" button on any page). */
  formOnly?: boolean;
  /** Called when the pop-up closes in formOnly mode. */
  onClose?: () => void;
  /** Called after a new reservation is saved. */
  onCreated?: (r: Reservation) => void;
  /** Called after a new voucher-only purchase is saved. */
  onVoucherCreated?: (v: VoucherSale) => void;
  /** Row to highlight (newly added booking). */
  highlightId?: string | null;
  /** Tab to show when the ledger opens (e.g. after a voucher purchase from New Booking). */
  initialTab?: 'rooms' | 'vouchers';
  /** Purchases from the hotel — a booking can record its own (Jupiter's cost) when it is saved. */
  purchases?: HotelPurchase[];
  setPurchases?: React.Dispatch<React.SetStateAction<HotelPurchase[]>>;
}

export const GuestReservationLedger: React.FC<GuestReservationLedgerProps> = ({
  agents = [],
  holidays = [],
  allHolidays,
  onSaveHoliday,
  reservations,
  setReservations,
  voucherSales,
  setVoucherSales,
  casinoRates,
  selectedMonth,
  setSelectedMonth,
  language,
  autoOpenNew,
  onAutoOpened,
  formOnly = false,
  onClose,
  onCreated,
  onVoucherCreated,
  highlightId,
  initialTab,
  purchases = [],
  setPurchases,
}) => {
  const t = translations[language];
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | '결제완료' | '미결제'>('all');
  // extra filters: stay dates (overlapping the range) and agent
  const monthRange = (ym: string) => (ym ? [`${ym}-01`, getDaysInMonth(ym).slice(-1)[0]] : ['', '']);
  // default: one day (today); Date Range starts as the selected month
  const [dateMode, setDateMode] = useState<'date' | 'range'>('date');
  const [day, setDay] = useState(todayISO);
  const [dateFrom, setDateFrom] = useState(() => monthRange(selectedMonth)[0]);
  const [dateTo, setDateTo] = useState(() => monthRange(selectedMonth)[1]);
  // when another page changes the month (e.g. after saving a booking), show that month
  useEffect(() => {
    const [a, b] = monthRange(selectedMonth);
    setDateFrom(a);
    setDateTo(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]);
  // the dates actually filtered on
  const [fFrom, fTo] = dateMode === 'date' ? [day, day] : [dateFrom, dateTo];
  const [agentFilter, setAgentFilter] = useState('');
  const [showHolidays, setShowHolidays] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  // New Booking can be a room booking or a voucher-only purchase (no room)
  const [formKind, setFormKind] = useState<'room' | 'voucher'>('room');
  const [editingVoucher, setEditingVoucher] = useState<VoucherSale | null>(null);
  const [deletingVoucher, setDeletingVoucher] = useState<VoucherSale | null>(null);
  // "Mark as paid / unpaid" action on a voucher purchase (asks first)
  const [payingVoucher, setPayingVoucher] = useState<{ v: VoucherSale; paid: boolean } | null>(null);
  // Ledger tabs: room bookings / voucher-only purchases
  const [tab, setTab] = useState<'rooms' | 'vouchers'>(initialTab ?? 'rooms');

  // Form State
  const [formGuestName, setFormGuestName] = useState('');
  const [formConfirmNo, setFormConfirmNo] = useState('');
  const [formRoomNo, setFormRoomNo] = useState('');
  const [formAgent, setFormAgent] = useState('');
  const [formOic, setFormOic] = useState('');
  const [formRoomType, setFormRoomType] = useState('GUEST ROOM');
  const [formCheckIn, setFormCheckIn] = useState(todayISO);
  const [formCheckOut, setFormCheckOut] = useState(() => addDays(todayISO(), 1));
  const [formAmountTyped, setFormAmount] = useState<number>(0);
  const [formCurrency, setFormCurrency] = useState<'PHP' | 'KRW'>('PHP');
  const [formRemarks, setFormRemarks] = useState('');
  // New bookings only: was the stay paid in full at booking time? (later payments go in the guest folio)
  const [formPaymentStatus, setFormPaymentStatus] = useState<PaymentStatus>('미결제');
  const [folioId, setFolioId] = useState<string | null>(null);
  const [formOccupancy, setFormOccupancy] = useState<'singleDouble' | 'triple'>('singleDouble');
  const [formIsJupiter, setFormIsJupiter] = useState(true);

  const [formHolidays, setFormHolidays] = useState<string[]>([]);
  const [formComps, setFormComps] = useState<string[]>([]); // complimentary (free) nights
  const holidayName = useMemo(() => new Map(holidays.map((h) => [h.date, h.name])), [holidays]);
  // vouchers / add-ons bought together with a new room booking (saved as billing charges)
  const [formVouchers, setFormVouchers] = useState<FolioCharge[]>([]);
  // false = amount follows the room rates automatically; true = user typed their own amount
  const [amountTouched, setAmountTouched] = useState(false);
  // Save shows a breakdown first; the reservation is only stored after confirming
  const [confirming, setConfirming] = useState(false);
  // Hotel column: the purchase saved with this booking (Jupiter's cost), per stock key.
  // noLink = editing an older booking that has no hotel purchase yet: no default costs, and
  // nothing is recorded unless a cost (or Free) is entered.
  const [noLink, setNoLink] = useState(false);
  // typed hotel cost per item: number (0 = free from the hotel) or null = cleared
  const [buyCosts, setBuyCosts] = useState<Record<string, number | null>>({});
  // voucher source per kind: 'buy' = bought with this booking, 'stock' = from vouchers bought earlier
  const [voucherSource, setVoucherSource] = useState<Record<string, VoucherSource>>({});
  // Save was pressed with a hotel cost still empty → highlight it
  const [buyTried, setBuyTried] = useState(false);
  // nights the hotel gives complimentary (₱0 in the hotel purchase; the guest side is separate)
  const [hotelComps, setHotelComps] = useState<string[]>([]);
  // room nights taken from room-nights bought earlier (Hotel Purchases) — not in this booking's purchase
  const [roomStock, setRoomStock] = useState<string[]>([]);
  // hotel cost per room night bought with the booking (null = cleared); same-rate nights are pre-filled
  const [nightCosts, setNightCosts] = useState<Record<string, number | null>>({});

  // Night-by-night charges from the Room Rates master (holiday nights use the weekend rate)
  const nightly = useMemo(() => {
    const room = casinoRates.rooms.find((r) => r.name.toLowerCase() === formRoomType.toLowerCase()) || casinoRates.rooms[0];
    return room ? getNightlyRates(formCheckIn, formCheckOut, room.id, formOccupancy, casinoRates, formHolidays, formComps) : [];
  }, [casinoRates, formRoomType, formCheckIn, formCheckOut, formOccupancy, formHolidays, formComps]);
  const formNights = nightly.length;
  const rateTotal = nightly.reduce((a, n) => a + n.rate, 0);

  // amount = room-rate total until the user types their own amount
  const formAmount = amountTouched ? formAmountTyped : rateTotal;

  const handleAutoCalculateAmount = () => {
    setAmountTouched(false);
    setFormAmount(rateTotal);
  };

  useEffect(() => {
    if (!isModalOpen || editingReservation || !formCheckIn || !formCheckOut || formCheckOut <= formCheckIn) return;
    setFormHolidays(getStayNights(formCheckIn, formCheckOut).filter((d) => holidayName.has(d)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formCheckIn, formCheckOut, isModalOpen, holidayName]);

  const toggleComp = (date: string) => setFormComps((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));

  const changeCheckIn = (v: string) => {
    setFormCheckIn(v);
    if (v && (!formCheckOut || formCheckOut <= v)) setFormCheckOut(addDays(v, 1));
  };

  const openAddModal = () => {
    setEditingReservation(null);
    setFormGuestName('');
    setFormRoomType('GUEST ROOM');
    setFormCheckIn(todayISO());
    setFormCheckOut(addDays(todayISO(), 1));
    setFormAmount(0);
    setFormCurrency('PHP');
    setFormRemarks('');
    setFormPaymentStatus('미결제');
    setFormOccupancy('singleDouble');
    setFormIsJupiter(true);
    setFormHolidays([]);
    setFormComps([]);
    setFormVouchers([]);
    setFormOic('');
    setFormConfirmNo('');
    setFormRoomNo('');
    setFormAgent('');
    setFormKind('room');
    setNoLink(false);
    setBuyCosts({});
    setVoucherSource({});
    setHotelComps([]);
    setRoomStock([]);
    setNightCosts({});
    setBuyTried(false);
    setAmountTouched(false);
    setConfirming(false);
    setIsModalOpen(true);
  };
  const openAddVoucher = () => {
    openAddModal();
    setFormKind('voucher');
  };
  useEffect(() => {
    if (autoOpenNew) {
      openAddModal();
      onAutoOpened?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenNew]);


  const openEditModal = (res: Reservation) => {
    setEditingReservation(res);
    setFormGuestName(res.guestName);
    setFormRoomType(res.roomType);
    setFormCheckIn(res.checkIn);
    setFormCheckOut(res.checkOut);
    setFormAmount(res.amount);
    setFormCurrency(res.currency);
    setFormRemarks(res.remarks);
    setFormPaymentStatus(res.paymentStatus);
    setFormOccupancy(res.occupancy || 'singleDouble');
    setFormIsJupiter(res.isJupiterGuest ?? true);
    setFormHolidays(res.holidayDates || []);
    setFormComps(res.compDates || []);
    setFormOic(res.oic || '');
    setFormConfirmNo(res.confirmationNo || '');
    setFormRoomNo(res.roomNo || '');
    setFormAgent(res.agentName || '');
    // its own hotel purchase (if it was recorded with the booking): load the costs
    const linked = purchases.find((p) => p.id === linkedPurchaseId(res.id));
    setNoLink(!linked);
    const items = linked?.items || [];
    const roomCompQty = items.filter((i) => i.kind === 'room' && !i.unitCost).reduce((a, i) => a + i.qty, 0);
    const roomPaidQty = items.filter((i) => i.kind === 'room' && i.unitCost > 0).reduce((a, i) => a + i.qty, 0);
    const hasPaidRoom = roomPaidQty > 0;
    // nights not in its own purchase came from room stock (order: complimentary, bought, stock)
    const stayNights = getStayNights(res.checkIn, res.checkOut);
    const stockNights = linked ? stayNights.slice(roomCompQty + roomPaidQty) : [];
    setRoomStock(stockNights);
    setBuyCosts(
      Object.fromEntries(
        items
          .filter((i) => i.kind === 'voucher' || i.unitCost > 0 || (!hasPaidRoom && !stockNights.length))
          .map((i) => [stockKey(i.kind, i.item), i.unitCost])
      )
    );
    // a voucher kind of the booking that is not in its own purchase came from stock
    const own = new Set(items.map((i) => stockKey(i.kind, i.item)));
    setVoucherSource(
      linked
        ? Object.fromEntries(
            (res.charges || []).flatMap((c) => {
              const v = chargeStockItem(c);
              return v ? [[stockKey('voucher', v), own.has(stockKey('voucher', v)) ? 'buy' : 'stock']] : [];
            })
          )
        : {}
    );
    const roomItems = items.filter((i) => i.kind === 'room');
    if (roomItems.length && roomItems.every((i) => i.dates?.length)) {
      // saved per night: each line knows its nights (₱0 lines = complimentary, nights in no line = from stock)
      const own = new Set(roomItems.flatMap((i) => i.dates || []));
      setRoomStock(stayNights.filter((d) => !own.has(d)));
      setHotelComps(roomItems.filter((i) => !i.unitCost).flatMap((i) => i.dates || []));
      setNightCosts(Object.fromEntries(roomItems.filter((i) => i.unitCost > 0).flatMap((i) => (i.dates || []).map((d) => [d, i.unitCost]))));
    } else {
      // older purchase (one cost for all nights): complimentary nights first, then bought nights at that cost
      setHotelComps(hasPaidRoom || stockNights.length ? stayNights.slice(0, roomCompQty) : []);
      const cost = roomItems.find((i) => i.unitCost > 0)?.unitCost;
      setNightCosts(cost ? Object.fromEntries(stayNights.slice(roomCompQty, roomCompQty + roomPaidQty).map((d) => [d, cost])) : {});
    }
    setBuyTried(false);
    setAmountTouched(true); // keep the saved amount unless the user recalculates
    setConfirming(false);
    setIsModalOpen(true);
  };

  // Hotel confirmation no. must be unique: 1 number = 1 booking (the server checks again, incl. deleted bookings).
  const confirmTaken = useMemo(() => {
    const no = formConfirmNo.trim().toLowerCase();
    if (!no) return null;
    return reservations.find((r) => r.id !== editingReservation?.id && (r.confirmationNo || '').trim().toLowerCase() === no) || null;
  }, [formConfirmNo, reservations, editingReservation]);

  const en = language === 'en';
  const addonTotal = formVouchers.reduce((a, c) => a + chargeAmount(c), 0);
  // what the guest is billed in total (room + extras)
  const extrasTotal = editingReservation ? (editingReservation.charges || []).reduce((a, c) => a + chargeAmount(c), 0) : addonTotal;
  const guestTotal = formAmount + extrasTotal;

  const formRoomId = casinoRates.rooms.find((x) => x.name.toLowerCase() === formRoomType.toLowerCase())?.id ?? null;
  // quantities follow the booking: nights of its room type + its vouchers
  const stockLeft = useStockLeft(en, editingReservation ? { reservationId: editingReservation.id } : undefined);
  const buyLines = useMemo<(BuyLine & { stock: boolean; left: number; stockQty: number; roomCost: number })[]>(() => {
    const need = new Map<string, number>();
    if (formRoomId && formNights > 0) need.set(stockKey('room', formRoomId), formNights);
    for (const c of editingReservation ? editingReservation.charges || [] : formVouchers) {
      const v = chargeStockItem(c);
      if (v) need.set(stockKey('voucher', v), (need.get(stockKey('voucher', v)) || 0) + c.qty);
    }
    return [...need].map(([key, qty]) => {
      const [kind, item] = key.split(':') as ['room' | 'voucher', string];
      // vouchers: from stock when enough is left (unless picked otherwise) — no cost to type
      const left = stockLeft.get(key) ?? 0;
      const stock = kind === 'voucher' && (voucherSource[key] ?? (left >= qty ? 'stock' : 'buy')) === 'stock';
      // typed cost only — no default (empty = not entered yet)
      const cost = stock ? 0 : key in buyCosts ? buyCosts[key] : null;
      const inStay = (d: string) => nightly.some((n) => n.date === d);
      const stockQty = kind === 'room' ? roomStock.filter(inStay).length : stock ? qty : 0;
      const compQty = kind === 'room' ? hotelComps.filter((d) => inStay(d) && !roomStock.includes(d)).length : 0;
      if (kind === 'room') {
        // room: a cost per bought night (not complimentary, not from stock)
        const buyN = nightly.filter((n) => !roomStock.includes(n.date) && !hotelComps.includes(n.date));
        const roomCost = buyN.reduce((a, n) => a + (nightCosts[n.date] ?? 0), 0);
        return {
          key,
          kind,
          item,
          qty,
          compQty,
          stockQty,
          entered: buyN.every((n) => typeof nightCosts[n.date] === 'number'),
          free: false,
          unitCost: buyN.length ? roomCost / buyN.length : 0,
          roomCost,
          label: itemLabel({ kind, item }, casinoRates, en),
          stock: false,
          left,
        };
      }
      // every night complimentary / from stock → no price needed
      const entered = stock || (cost !== null && cost !== undefined);
      return {
        key,
        kind,
        item,
        qty,
        compQty,
        stockQty,
        entered,
        free: !stock && entered && !cost && compQty + stockQty < qty,
        unitCost: cost ?? 0,
        roomCost: 0,
        label: itemLabel({ kind, item }, casinoRates, en),
        stock,
        left,
      };
    });
  }, [formRoomId, formNights, editingReservation, formVouchers, buyCosts, voucherSource, stockLeft, hotelComps, roomStock, nightCosts, nightly, casinoRates, en]);
  const fromStock = buyLines.reduce((a, l) => a + l.stockQty, 0);
  const buyCost = buyLines.reduce((a, l) => a + (l.kind === 'room' ? l.roomCost : (l.qty - l.compQty - l.stockQty) * l.unitCost), 0);
  // Source of one room night: bought with the booking, from room stock, or complimentary (₱0)
  const pickNight = (date: string, to: 'buy' | 'stock' | 'free') => {
    setRoomStock((prev) => (to === 'stock' ? [...prev.filter((d) => d !== date), date] : prev.filter((d) => d !== date)));
    setHotelComps((prev) => (to === 'free' ? [...prev.filter((d) => d !== date), date] : prev.filter((d) => d !== date)));
    // back to Buy now with no cost: take the cost of a bought night with the same guest rate
    if (to === 'buy' && typeof nightCosts[date] !== 'number') {
      const rate = nightly.find((n) => n.date === date)?.listRate;
      const same = nightly.find((n) => n.date !== date && n.listRate === rate && typeof nightCosts[n.date] === 'number' && !roomStock.includes(n.date) && !hotelComps.includes(n.date));
      if (same) setNightCosts((prev) => ({ ...prev, [date]: prev[same.date] }));
    }
  };
  // hotel cost of one night; other bought nights with the same guest rate follow it while they are
  // empty or still hold this night's previous cost (pre-filled) — each can still be changed on its own
  const setNightCost = (date: string, cost: number | null) =>
    setNightCosts((prev) => {
      const rate = nightly.find((n) => n.date === date)?.listRate;
      const next = { ...prev, [date]: cost };
      for (const n of nightly)
        if (n.date !== date && n.listRate === rate && !roomStock.includes(n.date) && !hotelComps.includes(n.date) && (typeof prev[n.date] !== 'number' || prev[n.date] === prev[date]))
          next[n.date] = cost;
      return next;
    });
  const useBuy = !!setPurchases;
  // older booking, nothing typed in the Hotel column → leave it without a hotel purchase
  const buySkipped = noLink && buyLines.every((l) => l.stock || !l.entered);
  const roomBuy = buyLines.find((l) => l.kind === 'room');
  const setBuyCost = (key: string, cost: number | null) => setBuyCosts((prev) => ({ ...prev, [key]: cost }));
  // charges table: border between the Hotel and Guest column groups, and the small 2nd header row
  // colour per group: Hotel = violet, Guest = green (header, then a light tint down the cells)
  const { G, SUB, HH, GH, HC, GC } = HG;
  // Hotel cells of a voucher / extra row: Source (buy now / from stock / complimentary) + cost per unit
  const hotelCells = (line?: BuyLine & { stock: boolean; left: number; stockQty: number }) => (
    <>
      <td className={`${HC} c ${G}`}>
        {useBuy && line && (
          <SourceSelect
            en={en}
            value={line.stock ? 'stock' : line.free ? 'free' : 'buy'}
            onPick={(to) => {
              setVoucherSource((prev) => ({ ...prev, [line.key]: to === 'stock' ? 'stock' : 'buy' }));
              if (to === 'free') setBuyCost(line.key, 0);
              else if (to === 'buy' && line.free) setBuyCost(line.key, null);
            }}
          />
        )}
      </td>
      <td className={`${HC} c`}>
        {useBuy && line ? (
          line.stock ? <StockBadge en={en} qty={line.qty} left={line.left} /> : <HotelCostInput en={en} line={line} onCost={setBuyCost} warn={buyTried} />
        ) : (
          <span className="text-faint">—</span>
        )}
      </td>
    </>
  );
  // editing: the booking's extras (kept in billing) grouped per voucher kind, so each gets its hotel cost
  const editExtras = useMemo(() => {
    if (!editingReservation) return [];
    const m = new Map<string, { key: string; label: string; qty: number; amount: number; line?: BuyLine & { stock: boolean; left: number; stockQty: number } }>();
    for (const c of editingReservation.charges || []) {
      const v = chargeStockItem(c);
      const key = v ? stockKey('voucher', v) : 'other';
      const row = m.get(key) ?? {
        key,
        label: v ? itemLabel({ kind: 'voucher', item: v }, casinoRates, en) : en ? 'Other extras' : '기타 추가',
        qty: 0,
        amount: 0,
        line: buyLines.find((l) => l.key === key),
      };
      row.qty += v ? c.qty : 0;
      row.amount += chargeAmount(c);
      m.set(key, row);
    }
    return [...m.values()];
  }, [editingReservation, buyLines, casinoRates, en]);

  // save / remove the booking's own purchase from the hotel (dated on check-in = that month's hotel bill)
  const syncLinkedPurchase = (res: Reservation) => {
    if (!setPurchases) return;
    const id = linkedPurchaseId(res.id);
    const items = buyLines.filter((l) => !l.stock).flatMap((l): PurchaseItem[] =>
      l.kind === 'room'
        ? (() => {
            // one line per cost (complimentary = ₱0), each with its nights; stock nights are left out
            const byCost = new Map<number, string[]>();
            for (const n of nightly) {
              if (roomStock.includes(n.date)) continue;
              const c = hotelComps.includes(n.date) ? 0 : nightCosts[n.date] ?? 0;
              byCost.set(c, [...(byCost.get(c) || []), n.date]);
            }
            return [...byCost].map(([unitCost, dates]) => ({ id: uid(), kind: l.kind, item: l.item, qty: dates.length, unitCost, dates }));
          })()
        : [
        { id: uid(), kind: l.kind, item: l.item, qty: l.qty - l.compQty - l.stockQty, unitCost: l.unitCost },
        { id: uid(), kind: l.kind, item: l.item, qty: l.compQty, unitCost: 0 },
      ].filter((i) => i.qty > 0)
    );
    setPurchases((prev) => {
      const old = prev.find((p) => p.id === id);
      if (!items.length || buySkipped) return old ? prev.filter((p) => p.id !== id) : prev;
      const p: HotelPurchase = {
        id,
        date: res.checkIn,
        reference: res.confirmationNo || old?.reference || '',
        remarks: `${en ? 'Booking' : '예약'}: ${res.guestName}`.slice(0, 500),
        items,
      };
      return old ? prev.map((x) => (x.id === id ? p : x)) : [p, ...prev];
    });
  };
  // nothing to charge (all free / ₱0) → the guest owes nothing, so it is paid in full
  const nothingDue = !editingReservation && formAmount + addonTotal === 0;
  useEffect(() => {
    if (nothingDue) setFormPaymentStatus('결제완료');
  }, [nothingDue]);
  // vouchers become billing charges dated on check-in (breakfast / dinner shown as buffet in billing)
  const buildAddonCharges = (): FolioCharge[] =>
    formVouchers.map((c) => ({
      ...c,
      id: uid(),
      date: formCheckIn,
      category: c.category === 'breakfast' || c.category === 'dinner' ? 'buffet' : c.category,
    }));

  const handleSaveReservation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formGuestName.trim() || !formCheckIn || !formCheckOut || formNights < 1 || confirmTaken) return;
    // ₱0 hotel cost must be ticked Free on purpose (₱0 is how a free item is stored)
    const noCost = useBuy && !buySkipped ? buyLines.filter((l) => !l.entered) : [];
    if (noCost.length) {
      setBuyTried(true);
      toast(
        en ? 'Enter the hotel cost' : '호텔 원가를 입력하세요',
        `${noCost.map((l) => l.label).join(', ')} — ${en ? 'type the hotel price in the Hotel column (0 = free from the hotel)' : '호텔 열에 단가 입력 (0 = 호텔 무료)'}`,
        'bad'
      );
      return;
    }
    setConfirming(true);
  };

  const commitReservation = () => {
    if (!formGuestName.trim() || !formCheckIn || !formCheckOut || formNights < 1 || confirmTaken) return;

    const nights = formNights;
    const holidayDates = formHolidays.filter((d) => nightly.some((n) => n.date === d));
    const compDates = formComps.filter((d) => nightly.some((n) => n.date === d));
    const referenceMonth = getReferenceMonth(formCheckIn);

    if (editingReservation) {
      setReservations((prev) =>
        prev.map((r) =>
          r.id === editingReservation.id
            ? {
                ...r,
                guestName: formGuestName,
                confirmationNo: formConfirmNo.trim(),
                roomNo: formRoomNo.trim(),
                agentName: formAgent.trim().replace(/\s+/g, ' '),
                oic: formOic.trim(),
                roomType: formRoomType,
                checkIn: formCheckIn,
                checkOut: formCheckOut,
                nights,
                amount: formAmount,
                currency: formCurrency,
                referenceMonth,
                remarks: formRemarks,
                occupancy: formOccupancy,
                isJupiterGuest: formIsJupiter,
                holidayDates,
                compDates,
              }
            : r
        ).map((r) => (r.id === editingReservation.id ? syncStatus(r) : r))
      );
      syncLinkedPurchase({ ...editingReservation, guestName: formGuestName, confirmationNo: formConfirmNo.trim(), checkIn: formCheckIn });
    } else {
      const newRes: Reservation = {
        id: `res-${Date.now()}`,
        guestName: formGuestName,
        confirmationNo: formConfirmNo.trim(),
        roomNo: formRoomNo.trim(),
        agentName: formAgent.trim().replace(/\s+/g, ' '),
        oic: formOic.trim(),
        roomType: formRoomType,
        checkIn: formCheckIn,
        checkOut: formCheckOut,
        nights,
        amount: formAmount,
        currency: formCurrency,
        referenceMonth,
        remarks: formRemarks,
        paymentStatus: formPaymentStatus,
        occupancy: formOccupancy,
        isJupiterGuest: formIsJupiter,
        holidayDates,
        compDates,
        charges: buildAddonCharges(),
        payments:
          formPaymentStatus === '결제완료' && formAmount + addonTotal > 0
            ? [{ id: uid(), date: formCheckIn, amount: formAmount + addonTotal, method: 'Cash', reference: en ? 'Paid at booking' : '예약 시 결제', recordedAt: nowStamp() }]
            : [],
      };
      setReservations((prev) => [syncStatus(newRes), ...prev]);
      syncLinkedPurchase(newRes);
      setFlashId(newRes.id);
      onCreated?.(newRes);
    }

    toast(
      editingReservation ? (en ? 'Reservation updated' : '예약 수정됨') : en ? 'Reservation saved' : '예약 저장됨',
      `${formGuestName} · ${nightsLabel(formNights, en)} · ${peso(formAmount + (editingReservation ? 0 : addonTotal))}` +
        (useBuy && buyLines.length ? ` · ${en ? 'hotel cost' : '호텔 원가'} ${peso(buyCost)}` : '')
    );
    setConfirming(false);
    setIsModalOpen(false);
  };

  // --- newly added row highlight ---
  const [flashId, setFlashId] = useState<string | null>(highlightId ?? null);
  useEffect(() => {
    if (highlightId) {
      setFlashId(highlightId);
      setSearchTerm('');
      setStatusFilter('all');
      // a just-saved booking may not be on today — show its whole month so the row is visible
      setDateMode('range');
    }
  }, [highlightId]);
  useEffect(() => {
    if (!flashId || formOnly) return;
    const t = setTimeout(() => document.getElementById(`row-${flashId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    const clear = setTimeout(() => setFlashId(null), 6000);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [flashId, formOnly]);

  // formOnly: tell the parent once the pop-up has been closed
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!formOnly) return;
    if (isModalOpen) wasOpen.current = true;
    else if (wasOpen.current) onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen, formOnly]);

  // delete asks first in the app's own confirm pop-up
  const [deletingRes, setDeletingRes] = useState<Reservation | null>(null);
  const handleDelete = (id: string) => setDeletingRes(reservations.find((r) => r.id === id) || null);

  // Filtered reservations list
  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      // stay overlaps the picked dates (check-out day is not a night)
      if (fFrom && r.checkOut <= fFrom) return false;
      if (fTo && r.checkIn > fTo) return false;
      if (agentFilter && (agentFilter === '—' ? !!r.agentName : (r.agentName || '').toLowerCase() !== agentFilter.toLowerCase())) return false;
      if (statusFilter !== 'all' && r.paymentStatus !== statusFilter) {
        return false;
      }
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesName = r.guestName.toLowerCase().includes(query);
        const matchesRoom = r.roomType.toLowerCase().includes(query);
        const matchesDate = r.checkIn.includes(query) || r.checkOut.includes(query);
        const matchesRemarks = r.remarks.toLowerCase().includes(query);
        const matchesConfirm = (r.confirmationNo || '').toLowerCase().includes(query) || (r.roomNo || '').toLowerCase().includes(query);
        if (!matchesName && !matchesRoom && !matchesDate && !matchesRemarks && !matchesConfirm) {
          return false;
        }
      }
      return true;
    });
  }, [reservations, statusFilter, searchTerm, fFrom, fTo, agentFilter]);

  // voucher-only purchases for the selected month (same search box)
  const monthVouchers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return voucherSales.filter(
      (v) =>
        (!fFrom || v.date >= fFrom) &&
        (!fTo || v.date <= fTo) &&
        (!agentFilter || (agentFilter === '—' ? !v.agentName : (v.agentName || '').toLowerCase() === agentFilter.toLowerCase())) &&
        (!q || v.guestName.toLowerCase().includes(q) || v.remarks.toLowerCase().includes(q) || v.items.some((c) => c.description.toLowerCase().includes(q)))
    );
  }, [voucherSales, searchTerm, fFrom, fTo, agentFilter]);

  // Pagination (no inner scrolling): rows per page is picked under the table.
  const [pageSize, setPageSize] = useState(10);
  const [roomPage, setRoomPage] = useState(0);
  const [voucherPage, setVoucherPage] = useState(0);
  useEffect(() => {
    setRoomPage(0);
    setVoucherPage(0);
  }, [fFrom, fTo, searchTerm, statusFilter, agentFilter]);
  const roomPages = Math.max(1, Math.ceil(filteredReservations.length / pageSize));
  const voucherPages = Math.max(1, Math.ceil(monthVouchers.length / pageSize));
  const safeRoomPage = Math.min(roomPage, roomPages - 1);
  const safeVoucherPage = Math.min(voucherPage, voucherPages - 1);
  const pagedReservations = filteredReservations.slice(safeRoomPage * pageSize, safeRoomPage * pageSize + pageSize);
  const pagedVouchers = monthVouchers.slice(safeVoucherPage * pageSize, safeVoucherPage * pageSize + pageSize);

  // a newly added booking opens on the page that holds it
  useEffect(() => {
    if (!flashId) return;
    const idx = filteredReservations.findIndex((r) => r.id === flashId);
    if (idx >= 0) setRoomPage(Math.floor(idx / pageSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashId]);

  return (
    <div>
      {!formOnly && (
      <>
      <PageHeader
        eyebrow={en ? 'Guest ledger' : '예약 관리부'}
        title={t.ledgerTitle}
        lede={t.ledgerNote}
      />

      <div className="card overflow-hidden">
        <div className="flex items-end gap-1 px-5 pt-3 border-b border-line" role="tablist">
          {(
            [
              // tone: icon colour always; underline + count bubble when active
              { key: 'rooms', label: en ? 'Room bookings' : '객실 예약', count: filteredReservations.length, Icon: BedDouble, icon: 'text-accent', line: 'border-accent', chip: 'bg-accent text-white' },
              { key: 'vouchers', label: en ? 'Voucher purchases' : '바우처 구매', count: monthVouchers.length, Icon: Ticket, icon: 'text-warn', line: 'border-warn', chip: 'bg-warn text-white' },
            ] as const
          ).map(({ key, label, count, Icon, icon, line, chip }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium border-b-2 cursor-pointer transition-colors ${
                tab === key ? `${line} text-ink` : 'border-transparent text-muted hover:text-ink-2'
              }`}
            >
              <Icon className={`w-4 h-4 ${icon}`} strokeWidth={1.75} />
              {label}
              <span className={`num text-[11px] px-1.5 h-5 min-w-5 inline-grid place-items-center rounded-full ${tab === key ? chip : 'bg-canvas text-muted'}`}>{count}</span>
            </button>
          ))}
          {onSaveHoliday && (
            <button
              onClick={() => setShowHolidays(true)}
              className="ml-auto mb-1.5 btn btn-outline btn-sm"
              title={en ? 'Settings — Philippine holidays' : '설정 — 필리핀 공휴일'}
            >
              <Settings2 className="w-3.5 h-3.5" />
              {en ? 'Holidays' : '공휴일'}
            </button>
          )}
        </div>
        <div className="card-head flex-col md:flex-row md:items-center items-stretch">
          <div className="flex flex-wrap items-end gap-2 flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder={en ? 'Guest name, confirmation no., room…' : '손님 이름, 확인 번호, 객실…'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input input-sm pl-8 !rounded-full bg-sunken"
              />
            </div>
            <DateFilter
              en={en}
              mode={dateMode}
              onMode={setDateMode}
              date={day}
              onDate={setDay}
              from={dateFrom}
              to={dateTo}
              onRange={(a, b) => {
                setDateFrom(a);
                setDateTo(b);
              }}
            />
            <Select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="input input-sm w-auto min-w-[140px]">
              <option value="">{en ? 'All agents' : '전체 에이전트'}</option>
              <option value="—">{en ? 'No agent' : '에이전트 없음'}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </Select>
            {(agentFilter || searchTerm || dateMode === 'range' || day !== todayISO()) && (
              <button
                onClick={() => {
                  const [a, b] = monthRange(selectedMonth);
                  setDateMode('date');
                  setDay(todayISO());
                  setDateFrom(a);
                  setDateTo(b);
                  setAgentFilter('');
                  setSearchTerm('');
                }}
                className="text-[12px] text-accent hover:underline cursor-pointer"
              >
                {en ? 'Clear filters' : '필터 초기화'}
              </button>
            )}
            {tab === 'rooms' && (
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="input input-sm w-auto min-w-[150px]">
                <option value="all">{t.filterAll} ({filteredReservations.length})</option>
                <option value="결제완료">{t.filterPaid}</option>
                <option value="미결제">{t.filterUnpaid}</option>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-2">
            {tab === 'rooms' && (
              <button onClick={() => exportToCSV(filteredReservations)} className="btn btn-outline">
                <Download className="w-3.5 h-3.5" />
                {t.btnExportCSV}
              </button>
            )}
            <button onClick={tab === 'rooms' ? openAddModal : openAddVoucher} className="btn btn-primary">
              <Plus className="w-4 h-4" />
              {tab === 'rooms' ? t.btnNewReservation : en ? 'New voucher purchase' : '바우처 구매'}
            </button>
          </div>
        </div>

        {tab === 'rooms' ? (
        <>
        <div className="overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>{t.thGuestName}</th>
                <th>{en ? 'Confirmation No.' : '확인 번호'}</th>
                <th>{t.thRoomType}</th>
                <th>{en ? 'Stay' : '투숙 기간'}</th>
                <th className="c">{t.thNightsAuto}</th>
                <th className="r">{en ? 'Total amount (PHP)' : '총 금액 (페소)'}</th>
                <th className="r">{t.thAmountPHP}</th>
                <th className="r">{en ? 'Balance (PHP)' : '잔액 (페소)'}</th>
                <th>{t.thRemarks}</th>
                <th className="c">{t.thPaymentStatus}</th>
                <th className="r w-20"><span className="sr-only">{t.thManage}</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredReservations.length === 0 ? (
                <tr>
                  <td colSpan={11} className="!py-16 text-center">
                    <div className="text-[13px] text-muted">{t.noReservationsFound}</div>
                    <button onClick={openAddModal} className="btn btn-outline btn-sm mt-3">
                      <Plus className="w-3.5 h-3.5" />
                      {t.btnNewReservation}
                    </button>
                  </td>
                </tr>
              ) : (
                pagedReservations.map((res) => (
                  <tr key={res.id} id={`row-${res.id}`} className={`group ${flashId === res.id ? 'row-new' : ''}`}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={res.guestName} />
                        <span className="leading-tight">
                          <span className="block font-medium text-ink whitespace-nowrap">{res.guestName}</span>
                          {res.agentName && <span className="block text-[11px] text-muted whitespace-nowrap">{en ? 'Agent' : '에이전트'} · {res.agentName}</span>}
                        </span>
                        {flashId === res.id && <span className="badge badge-ok">{en ? 'New' : '신규'}</span>}
                      </div>
                    </td>
                    <td className="num whitespace-nowrap">
                      {res.confirmationNo ? <span className="block text-ink font-medium">{res.confirmationNo}</span> : !res.roomNo && <span className="text-faint">—</span>}
                      {res.roomNo && <span className="block text-[11px] text-muted">{en ? 'Room' : '객실'} {res.roomNo}</span>}
                    </td>
                    <td className="text-ink-2 whitespace-nowrap">{res.roomType}</td>
                    <td className="text-ink-2 whitespace-nowrap">{formatDateRange(res.checkIn, res.checkOut)}</td>
                    <td className="c num">{res.nights}</td>
                    <td className="r num font-semibold text-ink whitespace-nowrap">{peso(folioOf(res).total)}</td>
                    {/* paid = sum of guest payments (green); balance = bill − paid (red) */}
                    <td className={`r num font-semibold whitespace-nowrap ${folioOf(res).paid > 0 ? 'text-ok' : 'text-faint'}`}>{peso(folioOf(res).paid)}</td>
                    <td className={`r num font-semibold whitespace-nowrap ${folioOf(res).balance > 0 ? 'text-bad' : 'text-faint'}`}>{peso(Math.max(folioOf(res).balance, 0))}</td>
                    <td className="text-muted max-w-[240px] truncate" title={res.remarks}>{res.remarks || <span className="text-faint">—</span>}</td>
                    <td className="c">
                      <button onClick={() => setFolioId(res.id)} className="inline-flex flex-col items-center gap-0.5 cursor-pointer" title={en ? 'Open billing' : '청구서 열기'}>
                        <FolioStatusBadge r={res} en={en} />
                      </button>
                    </td>
                    <td className="r">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setFolioId(res.id)} className="icon-btn !text-ok hover:!bg-ok-soft" title={en ? 'Billing' : '청구서'}>
                          <Receipt className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => openEditModal(res)} className="icon-btn !text-accent hover:!bg-accent-soft" title={t.edit}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(res.id)} className="icon-btn !text-bad hover:!bg-bad-soft" title={t.delete}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredReservations.length > 0 &&
              (() => {
                // totals of everything the filters show (all pages, not only this page)
                const fs = filteredReservations.map(folioOf);
                return (
                  <tfoot>
                    <tr>
                      <td colSpan={4}>
                        {en ? 'Total' : '합계'} <span className="text-muted font-normal">· {filteredReservations.length} {en ? (filteredReservations.length === 1 ? 'booking' : 'bookings') : '건'}</span>
                      </td>
                      <td className="c num">{filteredReservations.reduce((a, r) => a + r.nights, 0)}</td>
                      <td className="r num text-ink">{peso(fs.reduce((a, f) => a + f.total, 0))}</td>
                      <td className="r num text-ok">{peso(fs.reduce((a, f) => a + f.paid, 0))}</td>
                      <td className="r num text-bad">{peso(fs.reduce((a, f) => a + Math.max(f.balance, 0), 0))}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                );
              })()}
          </table>
        </div>
        {filteredReservations.length > 0 && (
          <Pager page={safeRoomPage} pages={roomPages} total={filteredReservations.length} size={pageSize} onPage={setRoomPage} onSize={setPageSize} en={en} unitLabel={en ? 'bookings' : '건'} />
        )}
        </>
        ) : (
        <>
        <div className="overflow-x-auto">
          <table className="dtable">
            <thead>
              <tr>
                <th>{t.thGuestName}</th>
                <th>{en ? 'Date' : '날짜'}</th>
                <th>{en ? 'Vouchers' : '바우처'}</th>
                <th className="r">{en ? 'Total amount (PHP)' : '총 금액 (페소)'}</th>
                <th className="r">{t.thAmountPHP}</th>
                <th className="r">{en ? 'Balance (PHP)' : '잔액 (페소)'}</th>
                <th className="c">{t.thPaymentStatus}</th>
                <th className="r w-20"><span className="sr-only">{t.thManage}</span></th>
              </tr>
            </thead>
            <tbody>
              {monthVouchers.length === 0 && (
                <tr>
                  <td colSpan={8} className="!py-16 text-center">
                    <div className="text-[13px] text-muted">{en ? 'No voucher purchases this month.' : '이번 달 바우처 구매 내역이 없습니다.'}</div>
                    <button onClick={openAddVoucher} className="btn btn-outline btn-sm mt-3">
                      <Plus className="w-3.5 h-3.5" />
                      {en ? 'New voucher purchase' : '바우처 구매'}
                    </button>
                  </td>
                </tr>
              )}
              {pagedVouchers.map((v) => {
                const f = voucherTotals(v);
                return (
                  <tr key={v.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={v.guestName} />
                        <span className="leading-tight">
                          <span className="block font-medium text-ink whitespace-nowrap">{v.guestName}</span>
                          {v.agentName && <span className="block text-[11px] text-muted whitespace-nowrap">{en ? 'Agent' : '에이전트'} · {v.agentName}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="text-ink-2 whitespace-nowrap">{formatLongDate(v.date)}</td>
                    <td className="text-ink-2 max-w-[320px] truncate" title={v.remarks}>
                      {v.items.map((c) => `${c.description} × ${c.qty}`).join(', ')}
                    </td>
                    <td className="r num font-semibold text-ink whitespace-nowrap">{peso(f.total)}</td>
                    <td className={`r num font-semibold whitespace-nowrap ${f.paid > 0 ? 'text-ok' : 'text-faint'}`}>{peso(f.paid)}</td>
                    <td className={`r num font-semibold whitespace-nowrap ${f.balance > 0 ? 'text-bad' : 'text-faint'}`}>{peso(Math.max(f.balance, 0))}</td>
                    <td className="c">
                      <span className={`badge badge-dot ${f.status === 'paid' ? 'badge-ok' : f.status === 'partial' ? 'badge-warn' : 'badge-bad'}`}>
                        {f.status === 'paid' ? t.statusPaid : f.status === 'partial' ? (en ? 'Partial' : '부분 결제') : t.statusUnpaid}
                      </span>
                    </td>
                    <td className="r">
                      <div className="flex items-center justify-end gap-1.5">
                        {f.total > 0 &&
                          (f.balance > 0 ? (
                            <button onClick={() => setPayingVoucher({ v, paid: true })} className="icon-btn !text-ok hover:!bg-ok-soft" title={en ? 'Mark as paid' : '결제 완료로 표시'}>
                              <CircleCheck className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button onClick={() => setPayingVoucher({ v, paid: false })} className="icon-btn !text-warn hover:!bg-warn-soft" title={en ? 'Mark as unpaid' : '미결제로 표시'}>
                              <CircleX className="w-3.5 h-3.5" />
                            </button>
                          ))}
                        <button onClick={() => setEditingVoucher(v)} className="icon-btn !text-accent hover:!bg-accent-soft" title={t.edit}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeletingVoucher(v)} className="icon-btn !text-bad hover:!bg-bad-soft" title={t.delete}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {monthVouchers.length > 0 &&
              (() => {
                const fs = monthVouchers.map(voucherTotals);
                return (
                  <tfoot>
                    <tr>
                      <td colSpan={3}>
                        {en ? 'Total' : '합계'} <span className="text-muted font-normal">· {monthVouchers.length} {en ? (monthVouchers.length === 1 ? 'purchase' : 'purchases') : '건'}</span>
                      </td>
                      <td className="r num text-ink">{peso(fs.reduce((a, f) => a + f.total, 0))}</td>
                      <td className="r num text-ok">{peso(fs.reduce((a, f) => a + f.paid, 0))}</td>
                      <td className="r num text-bad">{peso(fs.reduce((a, f) => a + Math.max(f.balance, 0), 0))}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                );
              })()}
          </table>
        </div>
        {monthVouchers.length > 0 && (
          <Pager page={safeVoucherPage} pages={voucherPages} total={monthVouchers.length} size={pageSize} onPage={setVoucherPage} onSize={setPageSize} en={en} unitLabel={en ? 'purchases' : '건'} />
        )}
        </>
        )}
      </div>

      </>
      )}

      {editingVoucher && (
        <Dialog
          width="max-w-4xl"
          title={en ? 'Edit voucher purchase' : '바우처 구매 수정'}
          subtitle={editingVoucher.guestName}
          onClose={() => setEditingVoucher(null)}
        >
          <VoucherSaleForm
            initial={editingVoucher}
            agents={agents}
            purchases={purchases}
            setPurchases={setPurchases}
            casinoRates={casinoRates}
            en={en}
            onCancel={() => setEditingVoucher(null)}
            onSave={(v) => {
              setVoucherSales((prev) => prev.map((x) => (x.id === v.id ? v : x)));
              toast(en ? 'Voucher purchase updated' : '바우처 구매 수정됨', `${v.guestName} · ${peso(voucherTotals(v).total)}`);
              setEditingVoucher(null);
            }}
          />
        </Dialog>
      )}

      {deletingRes && (
        <ConfirmDialog
          danger
          title={en ? 'Delete reservation?' : '예약을 삭제하시겠습니까?'}
          message={
            <>
              <b className="text-ink">{deletingRes.guestName}</b> · {deletingRes.roomType} · {formatDateRange(deletingRes.checkIn, deletingRes.checkOut)} ·{' '}
              {peso(folioOf(deletingRes).total)}
            </>
          }
          confirmLabel={en ? 'Delete' : '삭제'}
          cancelLabel={en ? 'Cancel' : '취소'}
          onCancel={() => setDeletingRes(null)}
          onConfirm={() => {
            setReservations((prev) => prev.filter((r) => r.id !== deletingRes.id));
            setPurchases?.((prev) => prev.filter((p) => p.id !== linkedPurchaseId(deletingRes.id)));
            toast(en ? 'Reservation deleted' : '예약 삭제됨', deletingRes.guestName, 'bad');
            setDeletingRes(null);
          }}
        />
      )}

      {payingVoucher && (() => {
        const { v, paid } = payingVoucher;
        const f = voucherTotals(v);
        return (
          <ConfirmDialog
            danger={!paid}
            title={paid ? (en ? 'Mark as paid?' : '결제 완료로 표시하시겠습니까?') : en ? 'Mark as unpaid?' : '미결제로 표시하시겠습니까?'}
            message={
              <>
                <b className="text-ink">{v.guestName}</b> · {formatLongDate(v.date)} · {peso(f.total)}
                <div className="mt-2 text-muted">
                  {paid
                    ? en
                      ? `Records a cash payment of ${peso(f.balance)} today. It goes into the Voucher fund.`
                      : `오늘 날짜로 현금 ${peso(f.balance)} 결제를 기록합니다. 바우처 자금에 입금됩니다.`
                    : en
                      ? `Removes the payments of ${peso(f.paid)} from this purchase. They also come out of the Voucher fund.`
                      : `이 구매의 결제 ${peso(f.paid)}를 삭제합니다. 바우처 자금에서도 빠집니다.`}
                </div>
              </>
            }
            confirmLabel={paid ? (en ? 'Mark as paid' : '결제 완료') : en ? 'Mark as unpaid' : '미결제로 표시'}
            cancelLabel={en ? 'Cancel' : '취소'}
            onCancel={() => setPayingVoucher(null)}
            onConfirm={() => {
              const next: VoucherSale = paid
                ? { ...v, payments: [...v.payments, { id: uid(), date: todayISO(), amount: f.balance, method: 'Cash', reference: '', recordedAt: nowStamp() }] }
                : { ...v, payments: [] };
              setVoucherSales((prev) => prev.map((x) => (x.id === v.id ? next : x)));
              toast(
                paid ? (en ? 'Marked as paid' : '결제 완료로 표시됨') : en ? 'Marked as unpaid' : '미결제로 표시됨',
                `${v.guestName} · ${peso(paid ? f.balance : f.paid)}`,
                paid ? 'ok' : 'bad'
              );
              setPayingVoucher(null);
            }}
          />
        );
      })()}

      {deletingVoucher && (
        <ConfirmDialog
          danger
          title={en ? 'Delete voucher purchase?' : '바우처 구매를 삭제하시겠습니까?'}
          message={
            <>
              <b className="text-ink">{deletingVoucher.guestName}</b> · {formatLongDate(deletingVoucher.date)} · {peso(voucherTotals(deletingVoucher).total)}
            </>
          }
          confirmLabel={en ? 'Delete' : '삭제'}
          cancelLabel={en ? 'Cancel' : '취소'}
          onCancel={() => setDeletingVoucher(null)}
          onConfirm={() => {
            setVoucherSales((prev) => prev.filter((x) => x.id !== deletingVoucher.id));
            setPurchases?.((prev) => prev.filter((p) => p.id !== linkedPurchaseId(deletingVoucher.id)));
            toast(en ? 'Voucher purchase deleted' : '바우처 구매 삭제됨', deletingVoucher.guestName, 'bad');
            setDeletingVoucher(null);
          }}
        />
      )}

      {showHolidays && onSaveHoliday && (
        <HolidaysMaintenance holidays={allHolidays || holidays} onSave={onSaveHoliday} language={language} onClose={() => setShowHolidays(false)} />
      )}

      {isModalOpen && (
        <Dialog
          width="max-w-4xl"
          title={
            formKind === 'voucher' && !editingReservation
              ? en ? 'New voucher purchase' : '바우처 구매'
              : confirming ? (en ? 'Review reservation' : '예약 내용 확인') : editingReservation ? t.modalTitleEdit : t.modalTitleNew
          }
          subtitle={
            formKind === 'voucher' && !editingReservation
              ? en ? 'Vouchers only — no room booking. Kept for the record.' : '객실 예약 없이 바우처만 구매합니다 (기록용).'
              : confirming
              ? en ? 'Check the breakdown before saving.' : '저장하기 전에 내역을 확인하세요.'
              : en ? 'Nights and amount are computed from the dates.' : '박수와 금액은 날짜로 자동 계산됩니다.'
          }
          onClose={() => setIsModalOpen(false)}
        >
          {!editingReservation && !confirming && (
            <div className="px-6 pt-4">
              <div className="seg w-full">
                <button type="button" data-active={formKind === 'room'} onClick={() => setFormKind('room')} className="flex-1">
                  {en ? 'Room booking' : '객실 예약'}
                </button>
                <button type="button" data-active={formKind === 'voucher'} onClick={() => setFormKind('voucher')} className="flex-1">
                  {en ? 'Vouchers only' : '바우처만'}
                </button>
              </div>
            </div>
          )}
          {formKind === 'voucher' && !editingReservation ? (
            <VoucherSaleForm
              agents={agents}
              purchases={purchases}
              setPurchases={setPurchases}
              casinoRates={casinoRates}
              en={en}
              onCancel={() => setIsModalOpen(false)}
              onSave={(v) => {
                setVoucherSales((prev) => [v, ...prev]);
                toast(en ? 'Voucher purchase saved' : '바우처 구매 저장됨', `${v.guestName} · ${peso(voucherTotals(v).total)}`);
                setSelectedMonth(v.date.slice(0, 7));
                setTab('vouchers');
                setIsModalOpen(false);
                onVoucherCreated?.(v);
              }}
            />
          ) : confirming ? (
            <div>
              <div className="px-6 py-4 space-y-3">
                {/* Guest + stay on two lines */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[18px] font-semibold text-ink truncate">{formGuestName}</div>
                    <div className="text-[12.5px] text-muted">
                      {formConfirmNo.trim() && <span className="num text-ink-2">#{formConfirmNo.trim()} · </span>}
                      {formAgent.trim() && <span className="text-ink-2">{en ? 'Agent' : '에이전트'}: {formAgent.trim()} · </span>}
                      {formRoomType} · {formOccupancy === 'singleDouble' ? (en ? 'Single / Double' : '1~2인') : en ? 'Triple' : '3인'}
                    </div>
                    <div className="text-[13px] text-ink-2 mt-0.5">
                      <b className="text-ink font-semibold">{formatDateRange(formCheckIn, formCheckOut)}</b> · {nightsLabel(formNights, en)}
                      <span className="text-muted"> · {en ? 'billed in' : '정산 월'} {formatMonth(formCheckIn)}</span>
                    </div>
                  </div>
                  <span className={`badge badge-dot shrink-0 ${formPaymentStatus === '결제완료' ? 'badge-ok' : 'badge-bad'}`}>
                    {formPaymentStatus === '결제완료' ? t.statusPaid : t.statusUnpaid}
                  </span>
                </div>

                {/* same layout as the form: item · rate ║ hotel ║ guest, one total + margin */}
                <div className="rounded-xl border border-line overflow-hidden">
                  <table className="dtable compact">
                    <thead>
                      <tr>
                        <th className="!static">{en ? 'Item' : '항목'}</th>
                        <th className="!static">{en ? 'Rate' : '요금'}</th>
                        {useBuy && <th className={`${HH} !static c w-[128px] ${G}`}>{en ? 'Hotel' : '호텔'}</th>}
                        <th className={`${GH} !static c w-[128px] ${G}`}>{en ? 'Guest' : '손님'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nightly.map((n, i) => {
                        const hotelComp = !!roomBuy && hotelComps.includes(n.date);
                        return (
                          <tr key={n.date} className="text-[12.5px] !bg-info-soft/60">
                            <td>
                              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                <BedDouble className={`w-3.5 h-3.5 text-info ${i ? 'invisible' : ''}`} />
                                <span className="text-ink-2">{formatLongDate(n.date)}</span>
                                <span className="text-muted">
                                  {new Date(n.date + 'T00:00:00Z').toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'short', timeZone: 'UTC' })}
                                </span>
                              </span>
                            </td>
                            <td>
                              <span className={`badge w-[72px] justify-center ${n.kind === 'holiday' ? 'badge-bad' : n.kind === 'weekend' ? 'badge-warn' : 'badge-info'}`}>
                                {n.kind === 'holiday' ? (en ? 'Holiday' : '공휴일') : n.kind === 'weekend' ? (en ? 'Weekend' : '주말') : en ? 'Weekday' : '평일'}
                              </span>
                            </td>
                            {useBuy && (
                              <td className={`${HC} c num ${G}`}>
                                {!roomBuy ? (
                                  '—'
                                ) : roomStock.includes(n.date) ? (
                                  <span className="text-info text-[11.5px]">{en ? 'From stock' : '재고 사용'}</span>
                                ) : hotelComp ? (
                                  <span className="text-ok text-[11.5px]">{en ? 'Complimentary' : '무료'}</span>
                                ) : (
                                  peso(nightCosts[n.date] ?? 0)
                                )}
                              </td>
                            )}
                            <td className={`${GC} c num ${G}`}>
                              <NightRateText n={n} />
                            </td>
                          </tr>
                        );
                      })}
                      {amountTouched && formAmount !== rateTotal && (
                        <tr className="text-[12.5px] text-muted">
                          <td colSpan={2} className="!pl-[34px]">{en ? 'Manual adjustment' : '수동 조정'}</td>
                          {useBuy && <td className={`${HC} ${G}`} />}
                          <td className={`${GC} c num ${G}`}>
                            {formAmount - rateTotal > 0 ? '+' : '−'}
                            {peso(Math.abs(formAmount - rateTotal))}
                          </td>
                        </tr>
                      )}
                      {(editingReservation ? editingReservation.charges || [] : formVouchers).map((c) => {
                        const v = chargeStockItem(c);
                        const line = v ? buyLines.find((l) => l.key === stockKey('voucher', v)) : undefined;
                        return (
                          <tr key={c.id} className="text-[12.5px] !bg-warn-soft/80">
                            <td>
                              <span className="inline-flex items-center gap-2">
                                <Ticket className="w-3.5 h-3.5 text-warn" />
                                <span className="text-ink-2">{c.description}</span>
                              </span>
                            </td>
                            <td className="num text-muted whitespace-nowrap">
                              {c.qty} × {peso(c.unitPrice)}
                            </td>
                            {useBuy && (
                              <td className={`${HC} c num ${G}`}>
                                {!line ? (
                                  <span className="text-faint">—</span>
                                ) : line.stock ? (
                                  <span className="text-info text-[11.5px]">{en ? 'From stock' : '재고 사용'}</span>
                                ) : line.free ? (
                                  <span className="text-ok text-[11.5px]">{en ? 'Complimentary' : '무료'}</span>
                                ) : (
                                  peso(c.qty * line.unitCost)
                                )}
                              </td>
                            )}
                            <td className={`${GC} c num ${G}`}>
                              <ChargeAmountText qty={c.qty} unitPrice={c.unitPrice} free={c.free} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}>
                          <div className="flex items-center gap-2">
                            {en ? 'Total' : '합계'}
                            {useBuy && formCurrency === 'PHP' && (
                              <span className="ml-auto text-[12px] font-normal text-muted">
                                {en ? 'Margin' : '마진'}{' '}
                                <b className={`num ${guestTotal - buyCost < 0 ? 'text-bad' : 'text-ok'}`}>
                                  {guestTotal - buyCost < 0 ? '−' : ''}
                                  {peso(Math.abs(guestTotal - buyCost))}
                                </b>
                              </span>
                            )}
                          </div>
                        </td>
                        {useBuy && <td className={`${HC} c num ${G}`}>{peso(buyCost)}</td>}
                        <td className={`${GC} c num text-[15px] font-bold ${G}`}>{peso(guestTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {formRemarks && (
                  <div className="text-[12.5px]">
                    <span className="text-muted">{t.lblRemarks}: </span>
                    <span className="text-ink-2">{formRemarks}</span>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-line bg-sunken flex items-center justify-end gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost">
                  {en ? 'Back to edit' : '수정하기'}
                </button>
                <button type="button" onClick={commitReservation} className="btn btn-primary px-5" autoFocus>
                  {en ? 'Confirm & save' : '확인 및 저장'}
                </button>
              </div>
            </div>
          ) : (
          <form onSubmit={handleSaveReservation}>
            <div className="px-6 py-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {/* Confirmation no. · Room no. on one line */}
              <div className="min-w-0">
                <label className="field-label">{en ? 'Confirmation #: (from hotel)' : '호텔 확인 번호'}</label>
                <input
                  type="text"
                  value={formConfirmNo}
                  onChange={(e) => setFormConfirmNo(e.target.value)}
                  maxLength={50}
                  placeholder={en ? 'Optional — if the hotel sent one' : '선택 — 호텔에서 받은 경우'}
                  className={`input num ${confirmTaken ? '!border-bad' : ''}`}
                />
                {confirmTaken && (
                  <div className="text-[11.5px] text-bad mt-1">
                    {en
                      ? `Already used by ${confirmTaken.guestName} (${formatDateRange(confirmTaken.checkIn, confirmTaken.checkOut)})`
                      : `이미 사용 중: ${confirmTaken.guestName} (${formatDateRange(confirmTaken.checkIn, confirmTaken.checkOut)})`}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <label className="field-label">{en ? 'Room #:' : '객실 번호'}</label>
                <input
                  type="text"
                  value={formRoomNo}
                  onChange={(e) => setFormRoomNo(e.target.value)}
                  maxLength={20}
                  placeholder={en ? 'Optional — e.g. 1203' : '선택 — 예: 1203'}
                  className="input num"
                />
              </div>

              {/* Agent · Guest Name · Room Type on one line */}
              <div className="col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                <div className="min-w-0">
                  <label className="field-label">{en ? 'Agent' : '에이전트'}</label>
                  <ComboInput
                    autoFocus
                    value={formAgent}
                    onChange={setFormAgent}
                    options={agents.filter((a) => a.active).map((a) => a.name)}
                    maxLength={100}
                    placeholder={en ? 'Type or pick — new names are saved' : '입력 또는 선택 — 새 이름은 자동 저장'}
                    emptyText={en ? 'No agents yet — type a name' : '등록된 에이전트 없음 — 이름을 입력하세요'}
                  />
                  {formAgent.trim() && !agents.some((a) => a.name.toLowerCase() === formAgent.trim().toLowerCase()) && (
                    <div className="text-[11px] text-accent mt-1">{en ? 'New agent — will be added to the Agents list' : '새 에이전트 — 목록에 추가됩니다'}</div>
                  )}
                </div>
                <div className="min-w-0">
                  <label className="field-label">{t.lblGuestName}</label>
                  <input
                    type="text"
                    required
                    value={formGuestName}
                    onChange={(e) => setFormGuestName(e.target.value)}
                    placeholder="e.g. John Doe, Park Chul-gyu"
                    className="input"
                  />
                </div>
                <div className="min-w-0">
                  <label className="field-label">{t.lblRoomType}</label>
                  <Select value={formRoomType} onChange={(e) => setFormRoomType(e.target.value)} className="input">
                    {casinoRates.rooms.map((room) => (
                      <option key={room.id} value={room.name}>{room.name}</option>
                    ))}
                  </Select>
                </div>
              </div>

              {/* Occupancy · Stay on one line, half each */}
              <div className="col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <div className="min-w-0">
                  <label className="field-label">{en ? 'Occupancy' : '투숙 인원'}</label>
                  <div className="seg w-full !h-9">
                    <button type="button" className="flex-1 !h-[28px]" data-active={formOccupancy === 'singleDouble'} onClick={() => setFormOccupancy('singleDouble')}>
                      {en ? 'Single / Double' : '1~2인'}
                    </button>
                    <button type="button" className="flex-1 !h-[28px]" data-active={formOccupancy === 'triple'} onClick={() => setFormOccupancy('triple')}>
                      {en ? 'Triple' : '3인'}
                    </button>
                  </div>
                </div>
                {/* one stay picker: click the check-in day, then the check-out day */}
                <div className="min-w-0">
                  <label className="field-label">{en ? 'Stay (check-in – check-out) *' : '숙박 (체크인 – 체크아웃) *'}</label>
                  <DateFilter
                    stay
                    en={en}
                    mode="range"
                    onMode={() => {}}
                    date={formCheckIn}
                    onDate={() => {}}
                    from={formCheckIn}
                    to={formCheckOut}
                    onRange={(a, b) => {
                      changeCheckIn(a);
                      setFormCheckOut(b > a ? b : addDays(a, 1));
                    }}
                  />
                </div>
              </div>

              {/* Charges — item · rate ║ HOTEL: complimentary · cost ║ GUEST: complimentary · amount */}
              <div className="col-span-2 rounded-xl border border-line overflow-hidden">
                <table className="dtable compact">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="!static align-bottom">{en ? 'Item' : '항목'}</th>
                      <th rowSpan={2} className="!static align-bottom">{en ? 'Rate' : '요금'}</th>
                      <th colSpan={2} className={`${HH} !static c !border-b-0 !pb-0 ${G}`}>
                        {en ? 'Hotel' : '호텔'}
                      </th>
                      <th colSpan={2} className={`${GH} !static c !border-b-0 !pb-0 ${G}`}>
                        {en ? 'Guest' : '손님'}
                      </th>
                    </tr>
                    <tr>
                      <th
                        className={`${HC} !static c w-[128px] ${SUB} ${G}`}
                        title={en ? 'Each night / voucher: Buy now (with this booking) · From stock (bought earlier) · Complimentary (₱0 from the hotel)' : '박·바우처별: 지금 구매 / 재고 사용 / 호텔 무료'}
                      >
                        {en ? 'Source' : '출처'}
                      </th>
                      <th className={`${HC} !static c w-[128px] ${SUB}`}>{en ? 'Cost' : '원가'}</th>
                      <th className={`${GC} !static c w-[108px] ${SUB} ${G}`} title={en ? 'Complimentary for the guest — ₱0' : '손님 무료 — ₱0'}>
                        {en ? 'Complimentary' : '무료'}
                      </th>
                      <th className={`${GC} !static c w-[128px] ${SUB}`}>{en ? 'Amount' : '금액'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formNights === 0 && (
                      <tr>
                        <td colSpan={6} className="text-[12.5px] text-bad">
                          {en ? 'Check-out must be after check-in.' : '체크아웃은 체크인 이후여야 합니다.'}
                        </td>
                      </tr>
                    )}
                    {/* room: one line per night — the first carries the room type, one hotel cost box spans all nights */}
                    {nightly.map((n, i) => {
                      const natWeekend = n.kind === 'weekend';
                      const hotelComp = !!roomBuy && hotelComps.includes(n.date);
                      const date = (
                        <span className="whitespace-nowrap">
                          <span className="text-ink-2">{formatLongDate(n.date)}</span>{' '}
                          <span className="text-muted">
                            {new Date(n.date + 'T00:00:00Z').toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'short', timeZone: 'UTC' })}
                          </span>
                        </span>
                      );
                      return (
                        <tr key={n.date} className="text-[12.5px] !bg-info-soft/60">
                          {i === 0 ? (
                            <td>
                              <div className="flex items-center gap-3">
                                <span className="w-7 h-7 rounded-lg bg-info-line text-info grid place-items-center shrink-0">
                                  <BedDouble className="w-3.5 h-3.5" />
                                </span>
                                <div>
                                  <div className="text-ink font-medium text-[13px]">{formRoomType}</div>
                                  <div className="text-[11.5px]">{date}</div>
                                </div>
                              </div>
                            </td>
                          ) : (
                            <td className="!pl-[50px]">{date}</td>
                          )}
                          <td>
                            {/* day type; holidays come from the Holidays list (⚙) and are charged at the weekend rate */}
                            <span
                              className={`badge w-[72px] justify-center ${n.kind === 'holiday' ? 'badge-bad' : natWeekend ? 'badge-warn' : 'badge-info'}`}
                              title={n.kind === 'holiday' ? `${holidayName.get(n.date) || (en ? 'Holiday' : '공휴일')} — ${en ? 'weekend rate' : '주말 요금'}` : undefined}
                            >
                              {n.kind === 'holiday' ? (en ? 'Holiday' : '공휴일') : natWeekend ? (en ? 'Weekend' : '주말') : en ? 'Weekday' : '평일'}
                            </span>
                          </td>
                          {/* hotel */}
                          <td className={`${HC} c ${G}`}>
                            {useBuy && roomBuy && (
                              <SourceSelect en={en} value={roomStock.includes(n.date) ? 'stock' : hotelComp ? 'free' : 'buy'} onPick={(to) => pickNight(n.date, to)} />
                            )}
                          </td>
                          <td className={`${HC} c`}>
                            {!useBuy || !roomBuy ? (
                              <span className="text-faint">—</span>
                            ) : roomStock.includes(n.date) ? (
                              <span
                                className={`badge ${roomBuy.left >= roomBuy.stockQty ? 'badge-info' : 'badge-warn'} w-[108px] mx-auto justify-center h-7 num`}
                                title={en ? 'Taken from room-nights already bought from the hotel (Hotel Purchases) — no new cost' : '이미 구매한 객실 사용 — 추가 원가 없음'}
                              >
                                {en ? `${Math.max(roomBuy.left, 0)} in stock` : `재고 ${Math.max(roomBuy.left, 0)}`}
                              </span>
                            ) : hotelComp ? (
                              <span className="badge badge-ok w-[108px] mx-auto justify-center h-7">{en ? 'Free' : '무료'}</span>
                            ) : (
                              <HotelCostInput
                                en={en}
                                line={{ ...roomBuy, key: n.date, qty: 1, compQty: 0, free: false, entered: typeof nightCosts[n.date] === 'number', unitCost: nightCosts[n.date] ?? 0 }}
                                onCost={setNightCost}
                                warn={buyTried}
                              />
                            )}
                          </td>
                          {/* guest */}
                          <td className={`${GC} c ${G}`}>
                            <input
                              type="checkbox"
                              checked={n.comp}
                              onChange={() => toggleComp(n.date)}
                              title={en ? 'Complimentary for the guest — ₱0' : '손님 무료 — ₱0'}
                              className="w-4 h-4 accent-[#2e7a57] cursor-pointer align-middle"
                            />
                          </td>
                          <td className={`${GC} c num whitespace-nowrap`}>
                            <NightRateText n={n} />
                          </td>
                        </tr>
                      );
                    })}
                    {amountTouched && formAmount !== rateTotal && (
                      <tr className="text-[12.5px] text-muted">
                        <td colSpan={2} className="!pl-12">
                          {en ? 'Manual adjustment' : '수동 조정'}
                        </td>
                        <td className={`${HC} ${G}`} />
                        <td className={HC} />
                        <td className={`${GC} ${G}`} />
                        <td className={`${GC} c num`}>
                          {formAmount - rateTotal > 0 ? '+' : '−'}
                          {peso(Math.abs(formAmount - rateTotal))}
                        </td>
                      </tr>
                    )}

                    {/* vouchers bought with this booking */}
                    {!editingReservation &&
                      formVouchers.map((c) => {
                        const v = chargeStockItem(c);
                        const line = v ? buyLines.find((l) => l.key === stockKey('voucher', v)) : undefined;
                        return (
                          <tr key={c.id} className="!bg-warn-soft/80">
                            <td>
                              <div className="flex items-center gap-3">
                                <span className="w-7 h-7 rounded-lg bg-warn-line text-warn grid place-items-center shrink-0">
                                  <Ticket className="w-3.5 h-3.5" />
                                </span>
                                <div className="min-w-0 text-ink font-medium">{c.description}</div>
                                <button
                                  type="button"
                                  onClick={() => setFormVouchers((prev) => prev.filter((x) => x.id !== c.id))}
                                  className="icon-btn !w-6 !h-6 ml-auto hover:!text-bad"
                                  title={en ? 'Remove' : '삭제'}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                            <td className="num text-muted whitespace-nowrap">
                              {c.qty} × {peso(c.unitPrice)}
                            </td>
                            {hotelCells(line)}
                            <td className={`${GC} c ${G}`}>
                              <input
                                type="checkbox"
                                checked={!!c.free}
                                onChange={() => setFormVouchers((prev) => prev.map((x) => (x.id === c.id ? { ...x, free: !x.free } : x)))}
                                title={en ? 'Complimentary for the guest — ₱0' : '손님 무료 — ₱0'}
                                className="w-4 h-4 accent-[#2e7a57] cursor-pointer align-middle"
                              />
                            </td>
                            <td className={`${GC} c num font-semibold text-ink whitespace-nowrap`}>
                              <ChargeAmountText qty={c.qty} unitPrice={c.unitPrice} free={c.free} />
                            </td>
                          </tr>
                        );
                      })}

                    {/* editing: the booking's vouchers / extras are in billing — shown here for the hotel cost */}
                    {editingReservation &&
                      editExtras.map((x) => (
                        <tr key={x.key} className="!bg-warn-soft/80 text-[12.5px]">
                          <td colSpan={2}>
                            <span className="text-ink font-medium">{x.label}</span>
                            <span className="text-muted"> · {x.qty ? `× ${x.qty} · ` : ''}{en ? 'in billing' : '청구서'}</span>
                          </td>
                          {hotelCells(x.line)}
                          <td className={`${GC} ${G}`} />
                          <td className={`${GC} c num font-semibold text-ink`}>{peso(x.amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>
                        <div className="flex items-center gap-2">
                          {en ? 'Total' : '합계'}
                          {formNights > 0 && (
                            <span className="inline-grid place-items-center h-5 px-2 rounded-full bg-accent-soft text-accent text-[11px] font-semibold num">
                              {en ? nightsLabel(formNights, true) : `${formNights}박`}
                            </span>
                          )}
                          {useBuy && formCurrency === 'PHP' && (
                            <span className="ml-auto text-[12px] font-normal text-muted">
                              {en ? 'Margin' : '마진'}{' '}
                              <b className={`num ${guestTotal - buyCost < 0 ? 'text-bad' : 'text-ok'}`}>
                                {guestTotal - buyCost < 0 ? '−' : ''}
                                {peso(Math.abs(guestTotal - buyCost))}
                              </b>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`${HC} ${G}`} />
                      <td className={`${HC} c num`}>
                        {useBuy ? (
                          <>
                            {peso(buyCost)}
                            {fromStock > 0 && (
                              <div className="text-[10.5px] font-normal text-muted">
                                + {fromStock} {en ? 'from stock' : '재고 사용'}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-faint">—</span>
                        )}
                      </td>
                      <td className={`${GC} ${G}`} />
                      <td className={`${GC} c num`}>{peso(guestTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {!editingReservation && (
                <div className="col-span-2">
                  <VoucherItemsEditor items={formVouchers} setItems={setFormVouchers} date={formCheckIn} casinoRates={casinoRates} en={en} addRowOnly />
                </div>
              )}

              {/* hotel stock left for this room type / these vouchers (warning only — saving is still allowed);
                  not needed when this booking buys its own from the hotel */}
              {!useBuy && (
              <div className="col-span-2 empty:hidden">
                <StockWarning
                  en={en}
                  room={{ id: casinoRates.rooms.find((x) => x.name.toLowerCase() === formRoomType.toLowerCase())?.id ?? null, nights: formNights }}
                  items={editingReservation ? editingReservation.charges || [] : formVouchers}
                  exclude={editingReservation ? { reservationId: editingReservation.id } : undefined}
                />
              </div>
              )}

              <div className={editingReservation ? 'col-span-2' : 'col-span-2 sm:col-span-1'}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="field-label !mb-0">{t.lblPaymentAmount}</label>
                  {amountTouched && formAmount !== rateTotal ? (
                    <button type="button" onClick={handleAutoCalculateAmount} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:text-accent-strong cursor-pointer">
                      <Sparkles className="w-3.5 h-3.5" />
                      {language === 'en' ? `Use room rates (₱${(rateTotal + extrasTotal).toLocaleString()})` : `요금표 적용 (₱${(rateTotal + extrasTotal).toLocaleString()})`}
                    </button>
                  ) : null}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 num text-[12px] text-faint pointer-events-none">{formCurrency}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={guestTotal.toLocaleString('en-US')}
                    onChange={(e) => {
                      // the box is the total (room + vouchers); typing a total changes the room amount only
                      setAmountTouched(true);
                      setFormAmount(Math.max(0, (parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0) - extrasTotal));
                    }}
                    className="input num pl-12 text-[15px] font-semibold"
                  />
                </div>
                {extrasTotal > 0 && (
                  <div className="text-[11px] text-muted mt-1 num">
                    {en ? 'Room' : '객실'} {peso(formAmount)} + {en ? 'vouchers / extras' : '바우처 / 추가'} {peso(extrasTotal)}
                  </div>
                )}
              </div>

              {editingReservation ? (
                <div className="col-span-2 flex items-center justify-between gap-3 rounded-[10px] border border-line px-3.5 py-2.5 text-[12.5px]">
                  <span className="flex items-center gap-2 text-muted">
                    {en ? 'Guest billing' : '손님 청구'} <FolioStatusBadge r={editingReservation} en={en} />
                    {en ? 'Paid' : '결제액'} <span className="num text-ink-2">{peso(folioOf(editingReservation).paid)}</span>
                  </span>
                  <span className="text-[11.5px] text-faint">{en ? 'Record payments in Billing' : '결제는 청구서에서 기록'}</span>
                </div>
              ) : (
                <div className="col-span-2 sm:col-span-1">
                  <label className="field-label">{en ? 'Guest payment' : '손님 결제'}</label>
                  <div className="seg w-full">
                    <button type="button" className="flex-1" data-active={formPaymentStatus === '결제완료'} onClick={() => setFormPaymentStatus('결제완료')}>
                      {en ? 'Paid in full now' : '지금 전액 결제'}
                    </button>
                    <button
                      type="button"
                      className="flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                      data-active={formPaymentStatus === '미결제'}
                      disabled={nothingDue}
                      onClick={() => setFormPaymentStatus('미결제')}
                    >
                      {en ? 'Bill later' : '나중에 청구'}
                    </button>
                  </div>
                  {nothingDue && <div className="text-[11px] text-ok mt-1">{en ? 'Nothing to charge — marked as paid' : '청구 금액 없음 — 결제 완료로 처리'}</div>}
                </div>
              )}

              <div className="col-span-2">
                <label className="field-label">{t.lblRemarks}</label>
                <input
                  type="text"
                  value={formRemarks}
                  onChange={(e) => setFormRemarks(e.target.value)}
                  placeholder="e.g. Non-smoking room, late check-out requested"
                  className="input"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-line bg-sunken flex items-center justify-end gap-2">
              <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-ghost">
                {t.btnCancel}
              </button>
              <button type="submit" disabled={!!confirmTaken} className="btn btn-primary px-5">
                {editingReservation ? t.btnUpdateReservation : t.btnSaveReservation}
              </button>
            </div>
          </form>
          )}
        </Dialog>
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


const AVATAR_TONES = ['bg-accent-soft text-accent-strong', 'bg-info-soft text-info', 'bg-ok-soft text-ok', 'bg-warn-soft text-warn', 'bg-canvas text-ink-2'];

const Avatar: React.FC<{ name: string }> = ({ name }) => {
  const initials = name.trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
  const tone = AVATAR_TONES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return <span className={`w-7 h-7 shrink-0 rounded-full grid place-items-center text-[11px] font-semibold ${tone}`}>{initials}</span>;
};
