import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Reservation, CasinoRatesConfig, PaymentStatus } from '../types/hotel';
import { formatCurrency, getReferenceMonth, exportToCSV, getNightlyRates, addDays, formatLongDate, formatMonth, formatDateRange } from '../utils/hotelHelpers';
import { Plus, Search, Download, Pencil, Trash2, Sparkles, Receipt } from 'lucide-react';
import { GuestFolio, FolioStatusBadge } from './GuestFolio';
import { folioOf, syncStatus, uid, peso, todayISO } from '../utils/billing';
import { Language, translations } from '../i18n/translations';
import { PageHeader, Dialog, MonthSelect, MONTHS, toast } from './ui';
import { StayBreakdown } from './StayBreakdown';

interface GuestReservationLedgerProps {
  reservations: Reservation[];
  setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
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
  /** Row to highlight (newly added booking). */
  highlightId?: string | null;
}

export const GuestReservationLedger: React.FC<GuestReservationLedgerProps> = ({
  reservations,
  setReservations,
  casinoRates,
  selectedMonth,
  setSelectedMonth,
  language,
  autoOpenNew,
  onAutoOpened,
  formOnly = false,
  onClose,
  onCreated,
  highlightId,
}) => {
  const t = translations[language];
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | '결제완료' | '미결제'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);

  // Form State
  const [formGuestName, setFormGuestName] = useState('');
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
    setAmountTouched(true); // keep the saved amount unless the user recalculates
    setConfirming(false);
    setIsModalOpen(true);
  };

  const handleSaveReservation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formGuestName.trim() || !formCheckIn || !formCheckOut || formNights < 1) return;
    setConfirming(true);
  };

  const commitReservation = () => {
    if (!formGuestName.trim() || !formCheckIn || !formCheckOut || formNights < 1) return;

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
        if (!matchesName && !matchesRoom && !matchesDate && !matchesRemarks) {
          return false;
        }
      }
      return true;
    });
  }, [reservations, selectedMonth, statusFilter, searchTerm]);

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
                <th>{t.thRoomType}</th>
                <th>{en ? 'Stay' : '투숙 기간'}</th>
                <th className="c">{t.thNightsAuto}</th>
                <th className="r">{t.thAmountPHP}</th>
                <th>{t.thRemarks}</th>
                <th className="c">{t.thPaymentStatus}</th>
                <th className="r w-20"><span className="sr-only">{t.thManage}</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredReservations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="!py-16 text-center">
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
                    <td className="text-ink-2 whitespace-nowrap">{res.roomType}</td>
                    <td className="text-ink-2 whitespace-nowrap">{formatDateRange(res.checkIn, res.checkOut)}</td>
                    <td className="c num">{res.nights}</td>
                    <td className="r num font-medium text-ink whitespace-nowrap">{formatCurrency(res.amount, res.currency)}</td>
                    <td className="text-muted max-w-[240px] truncate" title={res.remarks}>{res.remarks || <span className="text-faint">—</span>}</td>
                    <td className="c">
                      <button onClick={() => setFolioId(res.id)} className="inline-flex flex-col items-center gap-0.5 cursor-pointer" title={en ? 'Open billing' : '청구서 열기'}>
                        <FolioStatusBadge r={res} en={en} />
                        {folioOf(res).balance > 0 && <span className="num text-[11px] text-bad">{peso(folioOf(res).balance)}</span>}
                      </button>
                    </td>
                    <td className="r">
                      <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setFolioId(res.id)} className="icon-btn" title={en ? 'Billing' : '청구서'}>
                          <Receipt className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => openEditModal(res)} className="icon-btn" title={t.edit}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDelete(res.id, res.guestName)} className="icon-btn hover:!text-bad hover:!bg-bad-soft" title={t.delete}>
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

      </>
      )}

      {isModalOpen && (
        <Dialog
          width="max-w-2xl"
          title={confirming ? (en ? 'Review reservation' : '예약 내용 확인') : editingReservation ? t.modalTitleEdit : t.modalTitleNew}
          subtitle={
            confirming
              ? en ? 'Check the breakdown before saving.' : '저장하기 전에 내역을 확인하세요.'
              : en ? 'Nights and amount are computed from the dates.' : '박수와 금액은 날짜로 자동 계산됩니다.'
          }
          onClose={() => setIsModalOpen(false)}
        >
          {confirming ? (
            <div>
              <div className="px-6 py-5 space-y-4 max-h-[65vh] overflow-y-auto">
                {/* Guest + status */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[18px] font-semibold text-ink truncate">{formGuestName}</div>
                    <div className="text-[12.5px] text-muted">
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
              <button type="submit" className="btn btn-primary px-5">
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
