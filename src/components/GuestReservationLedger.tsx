import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Reservation, CasinoRatesConfig, PaymentStatus, VoucherSale } from '../types/hotel';
import { getReferenceMonth, exportToCSV, getNightlyRates, addDays, formatLongDate, formatMonth, formatDateRange } from '../utils/hotelHelpers';
import { Plus, Search, Download, Pencil, Trash2, Sparkles, Receipt, Ticket } from 'lucide-react';
import { GuestFolio, FolioStatusBadge } from './GuestFolio';
import { folioOf, syncStatus, uid, peso, todayISO, voucherTotals } from '../utils/billing';
import { Language, translations } from '../i18n/translations';
import { PageHeader, Dialog, ConfirmDialog, MonthSelect, MONTHS, toast } from './ui';
import { VoucherSaleForm } from './VoucherSaleForm';
import { StayBreakdown } from './StayBreakdown';

interface GuestReservationLedgerProps {
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
}

export const GuestReservationLedger: React.FC<GuestReservationLedgerProps> = ({
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
}) => {
  const t = translations[language];
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | '결제완료' | '미결제'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  // New Booking can be a room booking or a voucher-only purchase (no room)
  const [formKind, setFormKind] = useState<'room' | 'voucher'>('room');
  const [editingVoucher, setEditingVoucher] = useState<VoucherSale | null>(null);
  const [deletingVoucher, setDeletingVoucher] = useState<VoucherSale | null>(null);

  // Form State
  const [formGuestName, setFormGuestName] = useState('');
  const [formConfirmNo, setFormConfirmNo] = useState('');
  const [formOic, setFormOic] = useState('');
  const [formRoomType, setFormRoomType] = useState('GUEST ROOM');
  const [formCheckIn, setFormCheckIn] = useState(todayISO);
  const [formCheckOut, setFormCheckOut] = useState(() => addDays(todayISO(), 1));
  const [formAmount, setFormAmount] = useState<number>(19250);
  const [formCurrency, setFormCurrency] = useState<'PHP' | 'KRW'>('PHP');
  const [formRemarks, setFormRemarks] = useState('');
  // New bookings only: was the stay paid in full at booking time? (later payments go in the guest folio)
  const [formPaymentStatus, setFormPaymentStatus] = useState<PaymentStatus>('미결제');
  const [folioId, setFolioId] = useState<string | null>(null);
  const [formOccupancy, setFormOccupancy] = useState<'singleDouble' | 'triple'>('singleDouble');
  const [formIsJupiter, setFormIsJupiter] = useState(true);

  const [formHolidays, setFormHolidays] = useState<string[]>([]);
  // false = amount follows the room rates automatically; true = user typed their own amount
  const [amountTouched, setAmountTouched] = useState(false);
  // Save shows a breakdown first; the reservation is only stored after confirming
  const [confirming, setConfirming] = useState(false);

  // Night-by-night charges from the Room Rates master (holiday nights use the weekend rate)
  const nightly = useMemo(() => {
    const room = casinoRates.rooms.find((r) => r.name.toLowerCase() === formRoomType.toLowerCase()) || casinoRates.rooms[0];
    return room ? getNightlyRates(formCheckIn, formCheckOut, room.id, formOccupancy, casinoRates, formHolidays) : [];
  }, [casinoRates, formRoomType, formCheckIn, formCheckOut, formOccupancy, formHolidays]);
  const formNights = nightly.length;
  const rateTotal = nightly.reduce((a, n) => a + n.rate, 0);

  useEffect(() => {
    if (isModalOpen && !amountTouched) setFormAmount(rateTotal);
  }, [isModalOpen, amountTouched, rateTotal]);

  const handleAutoCalculateAmount = () => {
    setAmountTouched(false);
    setFormAmount(rateTotal);
  };

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
    setFormAmount(19250);
    setFormCurrency('PHP');
    setFormRemarks('');
    setFormPaymentStatus('미결제');
    setFormOccupancy('singleDouble');
    setFormIsJupiter(true);
    setFormHolidays([]);
    setFormOic('');
    setFormConfirmNo('');
    setFormKind('room');
    setAmountTouched(false);
    setConfirming(false);
    setIsModalOpen(true);
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
    setFormOic(res.oic || '');
    setFormConfirmNo(res.confirmationNo || '');
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

  const handleSaveReservation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formGuestName.trim() || !formCheckIn || !formCheckOut || formNights < 1 || confirmTaken) return;
    setConfirming(true);
  };

  const commitReservation = () => {
    if (!formGuestName.trim() || !formCheckIn || !formCheckOut || formNights < 1 || confirmTaken) return;

    const nights = formNights;
    const holidayDates = formHolidays.filter((d) => nightly.some((n) => n.date === d));
    const referenceMonth = getReferenceMonth(formCheckIn);

    if (editingReservation) {
      setReservations((prev) =>
        prev.map((r) =>
          r.id === editingReservation.id
            ? {
                ...r,
                guestName: formGuestName,
                confirmationNo: formConfirmNo.trim(),
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
              }
            : r
        ).map((r) => (r.id === editingReservation.id ? syncStatus(r) : r))
      );
    } else {
      const newRes: Reservation = {
        id: `res-${Date.now()}`,
        guestName: formGuestName,
        confirmationNo: formConfirmNo.trim(),
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
        charges: [],
        payments:
          formPaymentStatus === '결제완료'
            ? [{ id: uid(), date: formCheckIn, amount: formAmount, method: 'Cash', reference: en ? 'Paid at booking' : '예약 시 결제' }]
            : [],
      };
      setReservations((prev) => [syncStatus(newRes), ...prev]);
      setFlashId(newRes.id);
      onCreated?.(newRes);
    }

    toast(
      editingReservation ? (en ? 'Reservation updated' : '예약 수정됨') : en ? 'Reservation saved' : '예약 저장됨',
      `${formGuestName} · ${formNights} ${en ? 'nights' : '박'} · ${peso(formAmount)}`
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

  const handleDelete = (id: string, name: string) => {
    if (confirm(`${t.confirmDelete} '${name}'?`)) {
      setReservations((prev) => prev.filter((r) => r.id !== id));
      toast(en ? 'Reservation deleted' : '예약 삭제됨', name, 'bad');
    }
  };

  // Filtered reservations list
  const filteredReservations = useMemo(() => {
    return reservations.filter((r) => {
      if (selectedMonth && r.referenceMonth !== selectedMonth) {
        return false;
      }
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
  }, [reservations, selectedMonth, statusFilter, searchTerm]);

  // voucher-only purchases for the selected month (same search box)
  const monthVouchers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return voucherSales.filter(
      (v) =>
        v.date.startsWith(selectedMonth) &&
        (!q || v.guestName.toLowerCase().includes(q) || v.remarks.toLowerCase().includes(q) || v.items.some((c) => c.description.toLowerCase().includes(q)))
    );
  }, [voucherSales, selectedMonth, searchTerm]);

  const en = language === 'en';
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
        <div className="card-head flex-col md:flex-row md:items-center items-stretch">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder={t.searchLedgerPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input input-sm pl-8 !rounded-full bg-sunken"
              />
            </div>
            <MonthSelect value={selectedMonth} onChange={setSelectedMonth} months={MONTHS} allLabel={t.allMonths} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="input input-sm w-auto min-w-[150px]">
              <option value="all">{t.filterAll} ({filteredReservations.length})</option>
              <option value="결제완료">{t.filterPaid}</option>
              <option value="미결제">{t.filterUnpaid}</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => exportToCSV(filteredReservations)} className="btn btn-outline">
              <Download className="w-3.5 h-3.5" />
              {t.btnExportCSV}
            </button>
            <button onClick={openAddModal} className="btn btn-primary">
              <Plus className="w-4 h-4" />
              {t.btnNewReservation}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[680px]">
          <table className="dtable">
            <thead>
              <tr>
                <th>{t.thGuestName}</th>
                <th>{en ? 'Confirmation No.' : '확인 번호'}</th>
                <th>{t.thRoomType}</th>
                <th>{en ? 'Stay' : '투숙 기간'}</th>
                <th className="c">{t.thNightsAuto}</th>
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
                  <td colSpan={10} className="!py-16 text-center">
                    <div className="text-[13px] text-muted">{t.noReservationsFound}</div>
                    <button onClick={openAddModal} className="btn btn-outline btn-sm mt-3">
                      <Plus className="w-3.5 h-3.5" />
                      {t.btnNewReservation}
                    </button>
                  </td>
                </tr>
              ) : (
                filteredReservations.map((res) => (
                  <tr key={res.id} id={`row-${res.id}`} className={`group ${flashId === res.id ? 'row-new' : ''}`}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={res.guestName} />
                        <span className="font-medium text-ink whitespace-nowrap">{res.guestName}</span>
                        {flashId === res.id && <span className="badge badge-ok">{en ? 'New' : '신규'}</span>}
                      </div>
                    </td>
                    <td className="num whitespace-nowrap">{res.confirmationNo ? <span className="text-ink font-medium">{res.confirmationNo}</span> : <span className="text-faint">—</span>}</td>
                    <td className="text-ink-2 whitespace-nowrap">{res.roomType}</td>
                    <td className="text-ink-2 whitespace-nowrap">{formatDateRange(res.checkIn, res.checkOut)}</td>
                    <td className="c num">{res.nights}</td>
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
                        <button onClick={() => handleDelete(res.id, res.guestName)} className="icon-btn !text-bad hover:!bg-bad-soft" title={t.delete}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {monthVouchers.length > 0 && (
        <div className="card overflow-hidden mt-4">
          <div className="card-head">
            <div>
              <h3 className="card-title flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-[8px] bg-warn text-white grid place-items-center">
                  <Ticket className="w-4 h-4" strokeWidth={1.75} />
                </span>
                {en ? 'Voucher purchases' : '바우처 구매'} · {formatMonth(selectedMonth)}
              </h3>
              <p className="text-[12.5px] text-muted mt-1">{en ? 'Vouchers bought without a room booking — for the record' : '객실 예약 없이 구매한 바우처 (기록용)'}</p>
            </div>
          </div>
          <table className="dtable">
            <thead>
              <tr>
                <th>{t.thGuestName}</th>
                <th>{en ? 'Date' : '날짜'}</th>
                <th>{en ? 'Vouchers' : '바우처'}</th>
                <th className="r">{t.thAmountPHP}</th>
                <th className="r">{en ? 'Balance (PHP)' : '잔액 (페소)'}</th>
                <th className="c">{t.thPaymentStatus}</th>
                <th className="r w-20"><span className="sr-only">{t.thManage}</span></th>
              </tr>
            </thead>
            <tbody>
              {monthVouchers.map((v) => {
                const f = voucherTotals(v);
                return (
                  <tr key={v.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={v.guestName} />
                        <span className="font-medium text-ink whitespace-nowrap">{v.guestName}</span>
                      </div>
                    </td>
                    <td className="text-ink-2 whitespace-nowrap">{formatLongDate(v.date)}</td>
                    <td className="text-ink-2 max-w-[320px] truncate" title={v.remarks}>
                      {v.items.map((c) => `${c.description} × ${c.qty}`).join(', ')}
                    </td>
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
          </table>
        </div>
      )}

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
            <div className="px-6 pt-5">
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
              casinoRates={casinoRates}
              en={en}
              onCancel={() => setIsModalOpen(false)}
              onSave={(v) => {
                setVoucherSales((prev) => [v, ...prev]);
                toast(en ? 'Voucher purchase saved' : '바우처 구매 저장됨', `${v.guestName} · ${peso(voucherTotals(v).total)}`);
                setSelectedMonth(v.date.slice(0, 7));
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
            <div className="px-6 py-5 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="field-label">{en ? 'Confirmation no. (from hotel)' : '호텔 확인 번호'}</label>
                <input
                  type="text"
                  value={formConfirmNo}
                  onChange={(e) => setFormConfirmNo(e.target.value)}
                  maxLength={50}
                  placeholder={en ? 'Leave blank if the hotel has not sent it yet' : '아직 받지 않았다면 비워 두세요'}
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
              <div className="col-span-2 sm:col-span-1">
                <label className="field-label">{t.lblGuestName}</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={formGuestName}
                  onChange={(e) => setFormGuestName(e.target.value)}
                  placeholder="e.g. John Doe, Park Chul-gyu"
                  className="input"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="field-label">{t.lblRoomType}</label>
                <select value={formRoomType} onChange={(e) => setFormRoomType(e.target.value)} className="input">
                  {casinoRates.rooms.map((room) => (
                    <option key={room.id} value={room.name}>{room.name}</option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className="field-label">{en ? 'Occupancy' : '투숙 인원'}</label>
                <div className="seg w-full">
                  <button type="button" className="flex-1" data-active={formOccupancy === 'singleDouble'} onClick={() => setFormOccupancy('singleDouble')}>
                    {en ? 'Single / Double' : '1~2인'}
                  </button>
                  <button type="button" className="flex-1" data-active={formOccupancy === 'triple'} onClick={() => setFormOccupancy('triple')}>
                    {en ? 'Triple' : '3인'}
                  </button>
                </div>
              </div>

              <div>
                <label className="field-label">{t.lblCheckIn}</label>
                <input type="date" required value={formCheckIn} onChange={(e) => changeCheckIn(e.target.value)} className="input num" />
              </div>
              <div>
                <label className="field-label">{t.lblCheckOut}</label>
                <input type="date" required min={formCheckIn ? addDays(formCheckIn, 1) : undefined} value={formCheckOut} onChange={(e) => setFormCheckOut(e.target.value)} className="input num" />
              </div>

              <div className="col-span-2 rounded-[10px] border border-line overflow-hidden">
                <div className="flex items-center justify-between bg-sunken px-3.5 py-2 text-[12.5px] border-b border-line">
                  <span className="text-muted">
                    {t.lblTotalStayDuration} <strong className="num text-ink font-semibold">{formNights} {t.nightsUnit}</strong>
                  </span>
                </div>
                {formNights === 0 ? (
                  <div className="px-3.5 py-3 text-[12.5px] text-bad">
                    {language === 'en' ? 'Check-out must be after check-in.' : '체크아웃은 체크인 이후여야 합니다.'}
                  </div>
                ) : (
                  <div className="max-h-[168px] overflow-y-auto divide-y divide-line">
                    {nightly.map((n) => {
                      const d = new Date(n.date + 'T00:00:00');
                      const natWeekend = n.kind === 'weekend';
                      return (
                        <div key={n.date} className="flex items-center gap-3 px-3.5 min-h-9 py-1 text-[12.5px]">
                          <span className="text-ink-2 w-[136px] whitespace-nowrap">{formatLongDate(n.date)}</span>
                          <span className="text-muted w-9">{d.toLocaleDateString(language === 'en' ? 'en-US' : 'ko-KR', { weekday: 'short' })}</span>
                          <span className={`badge !h-5 !text-[10.5px] ${n.kind === 'holiday' ? 'badge-bad' : natWeekend ? 'badge-warn' : 'badge-info'}`}>
                            {n.kind === 'holiday'
                              ? language === 'en' ? 'Holiday' : '공휴일'
                              : natWeekend
                              ? language === 'en' ? 'Weekend' : '주말'
                              : language === 'en' ? 'Weekday' : '평일'}
                          </span>
                          <label
                            className={`ml-auto inline-flex items-center gap-1.5 text-[12px] ${natWeekend ? 'text-faint cursor-not-allowed' : 'text-ink-2 cursor-pointer'}`}
                            title={natWeekend ? (language === 'en' ? 'Already charged at weekend rate' : '이미 주말 요금 적용') : undefined}
                          >
                            <input
                              type="checkbox"
                              disabled={natWeekend}
                              checked={n.kind === 'holiday'}
                              onChange={() => toggleHoliday(n.date)}
                              className="w-3.5 h-3.5 accent-[#b4372c] cursor-pointer disabled:cursor-not-allowed"
                            />
                            {language === 'en' ? 'Holiday rate' : '공휴일 요금'}
                          </label>
                          <span className="num w-[132px] text-right whitespace-nowrap">
                            {n.kind === 'holiday' && (
                              <>
                                <span className="text-faint line-through mr-1.5">₱{n.baseRate.toLocaleString()}</span>
                              </>
                            )}
                            <span className={`font-medium ${n.kind === 'holiday' ? 'text-bad' : 'text-ink'}`}>₱{n.rate.toLocaleString()}</span>
                            {n.kind === 'holiday' && (
                              <span className="block text-[10.5px] text-bad leading-none -mt-0.5">+₱{(n.rate - n.baseRate).toLocaleString()}</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="col-span-2">
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
                <div className="col-span-2">
                  <label className="field-label">{en ? 'Guest payment' : '손님 결제'}</label>
                  <div className="seg w-full">
                    <button type="button" className="flex-1" data-active={formPaymentStatus === '결제완료'} onClick={() => setFormPaymentStatus('결제완료')}>
                      {en ? 'Paid in full now' : '지금 전액 결제'}
                    </button>
                    <button type="button" className="flex-1" data-active={formPaymentStatus === '미결제'} onClick={() => setFormPaymentStatus('미결제')}>
                      {en ? 'Bill later' : '나중에 청구'}
                    </button>
                  </div>
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
