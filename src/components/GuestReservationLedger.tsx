import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Agent, Holiday, Reservation, CasinoRatesConfig, PaymentStatus, VoucherSale, FolioCharge } from '../types/hotel';
import { getReferenceMonth, exportToCSV, getNightlyRates, addDays, formatLongDate, formatMonth, formatDateRange, nightsLabel, getStayNights, getDaysInMonth } from '../utils/hotelHelpers';
import { Plus, Search, Download, Pencil, Trash2, Sparkles, Receipt, Ticket, BedDouble, Settings2 } from 'lucide-react';
import { GuestFolio, FolioStatusBadge } from './GuestFolio';
import { folioOf, syncStatus, uid, peso, nowStamp, todayISO, voucherTotals, chargeAmount } from '../utils/billing';
import { Language, translations } from '../i18n/translations';
import { PageHeader, Dialog, ConfirmDialog, ComboInput, Pager, toast, Select } from './ui';
import { VoucherSaleForm, VoucherItemsEditor } from './VoucherSaleForm';
import { HolidaysMaintenance } from './HolidaysMaintenance';
import { DateFilter } from './DateFilter';
import { StayBreakdown, NightRateText, ChargeAmountText } from './StayBreakdown';

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
  // Ledger tabs: room bookings / voucher-only purchases
  const [tab, setTab] = useState<'rooms' | 'vouchers'>(initialTab ?? 'rooms');

  // Form State
  const [formGuestName, setFormGuestName] = useState('');
  const [formConfirmNo, setFormConfirmNo] = useState('');
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
  const toggleHoliday = (date: string) =>
    setFormHolidays((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));

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
    setFormAgent('');
    setFormKind('room');
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
    setFormAgent(res.agentName || '');
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
    } else {
      const newRes: Reservation = {
        id: `res-${Date.now()}`,
        guestName: formGuestName,
        confirmationNo: formConfirmNo.trim(),
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
      setFlashId(newRes.id);
      onCreated?.(newRes);
    }

    toast(
      editingReservation ? (en ? 'Reservation updated' : '예약 수정됨') : en ? 'Reservation saved' : '예약 저장됨',
      `${formGuestName} · ${nightsLabel(formNights, en)} · ${peso(formAmount + (editingReservation ? 0 : addonTotal))}`
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
        const matchesConfirm = (r.confirmationNo || '').toLowerCase().includes(query);
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
                    <td className="num whitespace-nowrap">{res.confirmationNo ? <span className="text-ink font-medium">{res.confirmationNo}</span> : <span className="text-faint">—</span>}</td>
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
          width="max-w-2xl"
          title={en ? 'Edit voucher purchase' : '바우처 구매 수정'}
          subtitle={editingVoucher.guestName}
          onClose={() => setEditingVoucher(null)}
        >
          <VoucherSaleForm
            initial={editingVoucher}
            agents={agents}
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
            toast(en ? 'Reservation deleted' : '예약 삭제됨', deletingRes.guestName, 'bad');
            setDeletingRes(null);
          }}
        />
      )}

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
          width="max-w-2xl"
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
              <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
                {/* Guest + status */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[18px] font-semibold text-ink truncate">{formGuestName}</div>
                    <div className="text-[12.5px] text-muted">
                      {formConfirmNo.trim() && <span className="num text-ink-2">#{formConfirmNo.trim()} · </span>}
                      {formAgent.trim() && <span className="text-ink-2">{en ? 'Agent' : '에이전트'}: {formAgent.trim()} · </span>}
                      {formRoomType} · {formOccupancy === 'singleDouble' ? (en ? 'Single / Double' : '1~2인') : en ? 'Triple' : '3인'}
                    </div>
                  </div>
                  <span className={`badge badge-dot ${formPaymentStatus === '결제완료' ? 'badge-ok' : 'badge-bad'}`}>
                    {formPaymentStatus === '결제완료' ? t.statusPaid : t.statusUnpaid}
                  </span>
                </div>

                {/* Stay */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-line p-3">
                    <div className="text-[11.5px] text-muted">{t.lblCheckIn.replace(' *', '')}</div>
                    <div className="text-[14px] font-semibold text-ink mt-0.5">{formatLongDate(formCheckIn)}</div>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <div className="text-[11.5px] text-muted">{t.lblCheckOut.replace(' *', '')}</div>
                    <div className="text-[14px] font-semibold text-ink mt-0.5">{formatLongDate(formCheckOut)}</div>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <div className="text-[11.5px] text-muted">{en ? 'Nights · Ref. month' : '박수 · 기준 월'}</div>
                    <div className="num text-[14px] font-semibold text-ink mt-0.5">
                      {formNights} · {formatMonth(formCheckIn)}
                    </div>
                  </div>
                </div>

                <StayBreakdown nightly={nightly} amount={formAmount} en={en} />

                {!editingReservation && addonTotal > 0 && (
                  <div className="rounded-xl border border-line overflow-hidden text-[12.5px]">
                    {formVouchers.map((c) => (
                      <div key={c.id} className="flex items-center justify-between px-4 py-2 border-b border-line">
                        <span className="text-ink-2">{c.description}</span>
                        <span className="num text-ink">
                          <span className="text-muted">{c.qty} × {peso(c.unitPrice)} = </span>
                          <ChargeAmountText qty={c.qty} unitPrice={c.unitPrice} free={c.free} />
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-4 py-2.5 bg-sunken font-semibold">
                      <span className="text-ink">{en ? 'Total with vouchers' : '바우처 포함 합계'}</span>
                      <span className="num text-ink text-[14px]">{peso(formAmount + addonTotal)}</span>
                    </div>
                  </div>
                )}

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
            <div className="px-6 py-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <div className="col-span-2">
                <label className="field-label">{en ? 'Confirmation no. (from hotel)' : '호텔 확인 번호'}</label>
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

              {/* Occupancy · Check-in · Check-out on one line */}
              <div className="col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
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
                <div className="min-w-0">
                  <label className="field-label">{t.lblCheckIn}</label>
                  <input type="date" required value={formCheckIn} onChange={(e) => changeCheckIn(e.target.value)} className="input num" />
                </div>
                <div className="min-w-0">
                  <label className="field-label">{t.lblCheckOut}</label>
                  <input type="date" required min={formCheckIn ? addDays(formCheckIn, 1) : undefined} value={formCheckOut} onChange={(e) => setFormCheckOut(e.target.value)} className="input num" />
                </div>
              </div>

              {/* Charges — columns: item · rate · free · amount (same look as the billing pop-up) */}
              <div className="col-span-2 rounded-xl border border-line overflow-hidden">
                <table className="dtable compact">
                  <thead>
                    <tr>
                      <th>{en ? 'Item' : '항목'}</th>
                      <th>{en ? 'Rate' : '요금'}</th>
                      <th className="c w-[64px]">{en ? 'Free' : '무료'}</th>
                      <th className="r w-[120px]">{en ? 'Amount' : '금액'}</th>
                      <th className="w-9" />
                    </tr>
                  </thead>
                  <tbody>
                    {/* room charge */}
                    <tr className="!bg-info-soft/80">
                      <td colSpan={3}>
                        <div className="flex items-center gap-3">
                          <span className="w-7 h-7 rounded-lg bg-info-line text-info grid place-items-center shrink-0">
                            <BedDouble className="w-3.5 h-3.5" />
                          </span>
                          <div>
                            <div className="text-ink font-medium">{en ? 'Room charge' : '객실 요금'}</div>
                            <div className="text-[11.5px] text-muted">
                              {formRoomType} · {nightsLabel(formNights, en)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="r num font-semibold text-ink">{peso(formAmount)}</td>
                      <td />
                    </tr>
                    {formNights === 0 && (
                      <tr>
                        <td colSpan={5} className="text-[12.5px] text-bad">
                          {en ? 'Check-out must be after check-in.' : '체크아웃은 체크인 이후여야 합니다.'}
                        </td>
                      </tr>
                    )}
                    {/* one line per night */}
                    {nightly.map((n, i) => {
                      const natWeekend = n.kind === 'weekend';
                      return (
                        <tr key={n.date} className="text-[12.5px]">
                          <td className="!pl-12">
                            <span className="inline-flex items-center gap-2 whitespace-nowrap">
                              <span className="w-5 h-5 rounded-full bg-canvas border border-line grid place-items-center text-[10.5px] font-semibold text-muted shrink-0">
                                {i + 1}
                              </span>
                              <span className="text-ink-2">{formatLongDate(n.date)}</span>
                              <span className="text-muted">
                                {new Date(n.date + 'T00:00:00Z').toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'short', timeZone: 'UTC' })}
                              </span>

                            </span>
                          </td>
                          <td>
                            <span className="inline-flex items-center gap-2.5 whitespace-nowrap">
                              <span className={`badge w-[68px] justify-center ${n.kind === 'weekday' ? 'badge-info' : n.kind === 'weekend' ? 'badge-warn' : 'badge-bad'}`}>
                                {n.kind === 'weekday' ? (en ? 'Weekday' : '평일') : n.kind === 'weekend' ? (en ? 'Weekend' : '주말') : en ? 'Holiday' : '공휴일'}
                              </span>
                              {!natWeekend && (
                                <label className="inline-flex items-center gap-1 text-[11.5px] text-ink-2 cursor-pointer" title={en ? 'Charge this night at the weekend (holiday) rate' : '이 날을 공휴일(주말) 요금으로'}>
                                  <input type="checkbox" checked={n.kind === 'holiday'} onChange={() => toggleHoliday(n.date)} className="w-3.5 h-3.5 accent-[#b4372c] cursor-pointer" />
                                  {en ? 'Holiday' : '공휴일'}
                                </label>
                              )}
                            </span>
                          </td>
                          <td className="c">
                            <input
                              type="checkbox"
                              checked={n.comp}
                              onChange={() => toggleComp(n.date)}
                              title={en ? 'Complimentary night — charged ₱0' : '무료 숙박 — ₱0'}
                              className="w-4 h-4 accent-[#2e7a57] cursor-pointer align-middle"
                            />
                          </td>
                          <td className="r num whitespace-nowrap">
                            <NightRateText n={n} />
                          </td>
                          <td />
                        </tr>
                      );
                    })}
                    {amountTouched && formAmount !== rateTotal && (
                      <tr className="text-[12.5px] text-muted">
                        <td colSpan={3} className="!pl-12">
                          {en ? 'Manual adjustment' : '수동 조정'}
                        </td>
                        <td className="r num">
                          {formAmount - rateTotal > 0 ? '+' : '−'}
                          {peso(Math.abs(formAmount - rateTotal))}
                        </td>
                        <td />
                      </tr>
                    )}

                    {/* vouchers bought with this booking */}
                    {!editingReservation &&
                      formVouchers.map((c) => (
                        <tr key={c.id} className="!bg-warn-soft/80">
                          <td>
                            <div className="flex items-center gap-3">
                              <span className="w-7 h-7 rounded-lg bg-warn-line text-warn grid place-items-center shrink-0">
                                <Ticket className="w-3.5 h-3.5" />
                              </span>
                              <div>
                                <div className="text-ink font-medium">{c.description}</div>
                                <div className="text-[11.5px] text-muted">{formatLongDate(formCheckIn)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="num text-muted whitespace-nowrap">
                            {c.qty} × {peso(c.unitPrice)}
                          </td>
                          <td className="c">
                            <input
                              type="checkbox"
                              checked={!!c.free}
                              onChange={() => setFormVouchers((prev) => prev.map((x) => (x.id === c.id ? { ...x, free: !x.free } : x)))}
                              title={en ? 'Complimentary — charged ₱0' : '무료 — ₱0'}
                              className="w-4 h-4 accent-[#2e7a57] cursor-pointer align-middle"
                            />
                          </td>
                          <td className="r num font-semibold text-ink whitespace-nowrap">
                            <ChargeAmountText qty={c.qty} unitPrice={c.unitPrice} free={c.free} />
                          </td>
                          <td className="r">
                            <button
                              type="button"
                              onClick={() => setFormVouchers((prev) => prev.filter((x) => x.id !== c.id))}
                              className="icon-btn hover:!text-bad"
                              title={en ? 'Remove' : '삭제'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}>{en ? 'Total charges' : '총 청구액'}</td>
                      <td className="r num">{peso(formAmount + (editingReservation ? 0 : addonTotal))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {!editingReservation && (
                <div className="col-span-2">
                  <VoucherItemsEditor items={formVouchers} setItems={setFormVouchers} date={formCheckIn} casinoRates={casinoRates} en={en} addRowOnly />
                </div>
              )}

              <div className={editingReservation ? 'col-span-2' : 'col-span-2 sm:col-span-1'}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="field-label !mb-0">{t.lblPaymentAmount}</label>
                  {amountTouched && formAmount !== rateTotal ? (
                    <button type="button" onClick={handleAutoCalculateAmount} className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:text-accent-strong cursor-pointer">
                      <Sparkles className="w-3.5 h-3.5" />
                      {language === 'en' ? `Use room rates (₱${rateTotal.toLocaleString()})` : `요금표 적용 (₱${rateTotal.toLocaleString()})`}
                    </button>
                  ) : null}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 num text-[12px] text-faint pointer-events-none">{formCurrency}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={formAmount.toLocaleString('en-US')}
                    onChange={(e) => {
                      setAmountTouched(true);
                      setFormAmount(parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0);
                    }}
                    className="input num pl-12 text-[15px] font-semibold"
                  />
                </div>
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
