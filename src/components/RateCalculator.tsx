import React, { useState, useMemo } from 'react';
import { CasinoRatesConfig, FolioCharge } from '../types/hotel';
import { uid, peso, todayISO } from '../utils/billing';
import { getNightlyRates, addDays, formatLongDate, formatDateRange, nightsLabel } from '../utils/hotelHelpers';
import { ArrowRight, Utensils, Coffee, BedDouble, Minus, Plus } from 'lucide-react';
import { Language } from '../i18n/translations';
import { PageHeader, Select } from './ui';
import { DateFilter } from './DateFilter';

interface RateCalculatorProps {
  casinoRates: CasinoRatesConfig;
  onBookWithQuote: (quote: {
    guestName: string;
    oic: string;
    roomType: string;
    checkIn: string;
    checkOut: string;
    amount: number;
    occupancy: 'singleDouble' | 'triple';
    remarks: string;
    holidayDates: string[];
    charges: FolioCharge[];
  }) => void;
  language: Language;
}

export const RateCalculator: React.FC<RateCalculatorProps> = ({
  casinoRates,
  onBookWithQuote,
  language,
}) => {
  const [guestName, setGuestName] = useState(language === 'en' ? 'VIP Guest' : '신규 고객');
  const oic = '';
  const [checkIn, setCheckIn] = useState(todayISO);
  const [checkOut, setCheckOut] = useState(() => addDays(todayISO(), 1));

  // Casino Plan controls
  const [casinoRoomId, setCasinoRoomId] = useState('guest_room');
  const [occupancy, setOccupancy] = useState<'singleDouble' | 'triple'>('singleDouble');
  const [extraBreakfastCount, setExtraBreakfastCount] = useState(0);
  const [dinnerVoucherCount, setDinnerVoucherCount] = useState(0);
  const [extraBedCount, setExtraBedCount] = useState(0);

  const [holidays, setHolidays] = useState<string[]>([]);
  const toggleHoliday = (date: string) =>
    setHolidays((prev) => (prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]));

  // Night-by-night breakdown (holiday nights use the weekend rate)
  const dailyBreakdown = useMemo(
    () =>
      getNightlyRates(checkIn, checkOut, casinoRoomId, occupancy, casinoRates, holidays).map((n) => ({
        dateStr: n.date,
        kind: n.kind,
        dayType: n.kind === 'weekday' ? ('weekday' as const) : ('weekend' as const),
        rate: n.rate,
        baseRate: n.baseRate,
      })),
    [checkIn, checkOut, casinoRoomId, occupancy, casinoRates, holidays]
  );
  const totalNights = dailyBreakdown.length;

  const roomSubtotal = useMemo(() => {
    return dailyBreakdown.reduce((sum, item) => sum + item.rate, 0);
  }, [dailyBreakdown]);

  // Voucher Addons
  const voucherSubtotal = useMemo(() => {
    return (
      extraBreakfastCount * casinoRates.vouchers.breakfast +
      dinnerVoucherCount * casinoRates.vouchers.dinner +
      extraBedCount * casinoRates.vouchers.extraBed * totalNights
    );
  }, [extraBreakfastCount, dinnerVoucherCount, extraBedCount, casinoRates, totalNights]);

  const grandTotal = roomSubtotal + voucherSubtotal;

  const handleBookNow = () => {
    const matchedRoom = casinoRates.rooms.find((r) => r.id === casinoRoomId) || casinoRates.rooms[0];

    onBookWithQuote({
      guestName,
      oic: oic.trim(),
      roomType: matchedRoom.name,
      checkIn,
      checkOut,
      amount: roomSubtotal,
      charges: [
        { label: 'Breakfast voucher', qty: extraBreakfastCount, price: casinoRates.vouchers.breakfast },
        { label: 'Dinner voucher', qty: dinnerVoucherCount, price: casinoRates.vouchers.dinner },
        { label: `Extra bed (${nightsLabel(totalNights)})`, qty: extraBedCount * totalNights, price: casinoRates.vouchers.extraBed },
      ]
        .filter((c) => c.qty > 0)
        .map((c) => ({ id: uid(), date: checkIn, description: c.label, qty: c.qty, unitPrice: c.price, category: c.label.startsWith('Extra bed') ? ('extraBed' as const) : ('buffet' as const) })),
      occupancy,
      holidayDates: holidays.filter((d) => dailyBreakdown.some((n) => n.dateStr === d)),
      remarks: language === 'en'
        ? `Quotation booked: ${matchedRoom.name} (${occupancy === 'singleDouble' ? '1-2 Guests' : '3 Guests'})`
        : `계산기 견적 등록: ${matchedRoom.name} (${occupancy === 'singleDouble' ? '1-2인' : '3인'})`,
    });
  };

  const en = language === 'en';

  const stepper = (value: number, set: (n: number) => void, max = 99) => (
    <div className="flex items-center h-9 rounded-[9px] border border-line-strong bg-surface overflow-hidden">
      <button type="button" onClick={() => set(Math.max(0, value - 1))} className="w-9 h-full grid place-items-center text-muted hover:bg-canvas hover:text-ink cursor-pointer disabled:opacity-40" disabled={value <= 0} aria-label="Decrease">
        <Minus className="w-3.5 h-3.5" />
      </button>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={(e) => set(Math.min(max, Math.max(0, parseInt(e.target.value, 10) || 0)))}
        className="flex-1 min-w-0 h-full text-center num text-[13px] font-medium text-ink bg-transparent border-x border-line focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" onClick={() => set(Math.min(max, value + 1))} className="w-9 h-full grid place-items-center text-muted hover:bg-canvas hover:text-ink cursor-pointer" aria-label="Increase">
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  const addons = [
    { key: 'bf', label: en ? 'Breakfast voucher' : '조식 바우처', count: extraBreakfastCount, total: extraBreakfastCount * casinoRates.vouchers.breakfast },
    { key: 'dn', label: en ? 'Dinner voucher' : '석식 바우처', count: dinnerVoucherCount, total: dinnerVoucherCount * casinoRates.vouchers.dinner },
    { key: 'eb', label: en ? `Extra bed · ${totalNights}n` : `엑스트라 베드 · ${totalNights}박`, count: extraBedCount, total: extraBedCount * casinoRates.vouchers.extraBed * totalNights },
  ].filter((a) => a.count > 0);

  const room = casinoRates.rooms.find((r) => r.id === casinoRoomId) || casinoRates.rooms[0];
  const kindBadge = { weekday: 'badge-info', weekend: 'badge-warn', holiday: 'badge-bad' } as const;
  const kindLabel = { weekday: en ? 'Weekday' : '평일', weekend: en ? 'Weekend' : '주말', holiday: en ? 'Holiday' : '공휴일' };

  return (
    <div>
      <PageHeader
        title={en ? 'Rate Calculator' : '숙박 요금 계산기'}
        lede={en ? 'Quote a stay night by night, then book it.' : '1박 단위로 견적을 내고 바로 예약하세요.'}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* ---------- Left: inputs ---------- */}
        <section className="lg:col-span-7 card">
          {/* Stay */}
          <div className="p-5 grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="field-label">{en ? 'Guest name' : '고객명'}</label>
              <input type="text" value={guestName} onChange={(e) => setGuestName(e.target.value)} className="input" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="field-label">{en ? 'Room type' : '객실 타입'}</label>
              <Select value={casinoRoomId} onChange={(e) => setCasinoRoomId(e.target.value)} className="input">
                {casinoRates.rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Select>
            </div>
            {/* one stay picker: click the check-in day, then the check-out day */}
            <div className="col-span-2">
              <label className="field-label">{en ? 'Stay (check-in – check-out)' : '숙박 (체크인 – 체크아웃)'}</label>
              <DateFilter
                stay
                en={en}
                mode="range"
                onMode={() => {}}
                date={checkIn}
                onDate={() => {}}
                from={checkIn}
                to={checkOut}
                onRange={(a, b) => {
                  setCheckIn(a);
                  setCheckOut(b > a ? b : addDays(a, 1));
                }}
              />
            </div>
            <div className="col-span-2">
              <label className="field-label">{en ? 'Occupancy' : '투숙 인원'}</label>
              <div className="seg w-full">
                {(['singleDouble', 'triple'] as const).map((o) => (
                  <button key={o} type="button" className="flex-1" data-active={occupancy === o} onClick={() => setOccupancy(o)}>
                    {o === 'singleDouble' ? (en ? 'Single / Double · 1–2 guests' : '싱글 / 더블 · 1~2인') : en ? 'Triple · 3 guests' : '트리플 · 3인'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Add-ons */}
          <div className="border-t border-line px-5 pt-4 pb-5">
            <div className="text-[12.5px] font-semibold text-ink mb-3">{en ? 'Add-ons' : '부가 옵션'}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { Icon: Coffee, label: en ? 'Breakfast voucher' : '조식 바우처', price: casinoRates.vouchers.breakfast, unit: en ? 'each' : '장당', v: extraBreakfastCount, set: setExtraBreakfastCount, max: 99 },
                { Icon: Utensils, label: en ? 'Dinner voucher' : '석식 바우처', price: casinoRates.vouchers.dinner, unit: en ? 'each' : '장당', v: dinnerVoucherCount, set: setDinnerVoucherCount, max: 99 },
                { Icon: BedDouble, label: en ? 'Extra bed' : '엑스트라 베드', price: casinoRates.vouchers.extraBed, unit: en ? 'per night' : '1박당', v: extraBedCount, set: setExtraBedCount, max: 5 },
              ].map(({ Icon, label, price, unit, v, set, max }) => (
                <div key={label} className={`rounded-xl border p-3 transition-colors ${v > 0 ? 'border-warn-line bg-warn-soft/50' : 'border-line'}`}>
                  <div className="flex items-center gap-2.5 mb-2.5">
                    <span className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${v > 0 ? 'bg-warn-line text-warn' : 'bg-canvas text-muted'}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-ink truncate">{label}</div>
                      <div className="text-[11px] text-muted">
                        <span className="num">{peso(price)}</span> {unit}
                      </div>
                    </div>
                  </div>
                  {stepper(v, set, max)}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Right: quotation ---------- */}
        <aside className="lg:col-span-5 lg:sticky lg:top-2 card overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-line">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="eyebrow">{en ? 'Quotation' : '견적서'}</div>
                <div className="mt-1 text-[15px] font-semibold text-ink truncate">{guestName || '—'}</div>
              </div>
              <span className="badge badge-neutral num shrink-0">
                {totalNights} {en ? (totalNights === 1 ? 'night' : 'nights') : '박'}
              </span>
            </div>
            <div className="text-[12px] text-muted mt-0.5">
              {room.name} · {occupancy === 'singleDouble' ? (en ? '1–2 guests' : '1~2인') : en ? '3 guests' : '3인'}
              {totalNights > 0 && <> · {formatDateRange(checkIn, checkOut)}</>}
            </div>
          </div>

          {/* nights */}
          <div className="max-h-[260px] overflow-y-auto">
            {dailyBreakdown.length === 0 && <div className="py-6 text-center text-[12.5px] text-faint">{en ? 'Pick valid dates' : '날짜를 선택하세요'}</div>}
            {dailyBreakdown.map((item, i) => (
              <div key={item.dateStr} className="grid grid-cols-[20px_1fr_76px_74px_110px] items-center gap-2 px-5 py-2 text-[12.5px] border-b border-line last:border-0">
                <span className="w-5 h-5 rounded-full bg-canvas text-[10.5px] font-semibold text-muted grid place-items-center">{i + 1}</span>
                <span className="text-ink-2 truncate">
                  {formatLongDate(item.dateStr)}
                  <span className="text-faint ml-1.5">
                    {new Date(item.dateStr + 'T00:00:00Z').toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'short', timeZone: 'UTC' })}
                  </span>
                </span>
                <span className={`badge justify-center ${kindBadge[item.kind]}`}>{kindLabel[item.kind]}</span>
                <span>
                  {item.kind !== 'weekend' && (
                    <label className="inline-flex items-center gap-1 text-[11px] text-muted cursor-pointer">
                      <input type="checkbox" checked={item.kind === 'holiday'} onChange={() => toggleHoliday(item.dateStr)} className="w-3.5 h-3.5 accent-[#b4372c] cursor-pointer" />
                      {en ? 'Holiday' : '공휴일'}
                    </label>
                  )}
                </span>
                <span className="num text-right whitespace-nowrap">
                  {item.kind === 'holiday' && <s className="text-faint text-[11px] mr-1.5">{peso(item.baseRate)}</s>}
                  <span className={item.kind === 'holiday' ? 'text-bad font-medium' : 'text-ink'}>{peso(item.rate)}</span>
                </span>
              </div>
            ))}
          </div>

          {/* subtotals */}
          <div className="px-5 py-3 border-t border-line bg-sunken text-[12.5px] space-y-1.5">
            <Row label={en ? 'Room subtotal' : '객실 소계'} value={peso(roomSubtotal)} />
            {addons.map((a) => (
              <Row key={a.key} label={`${a.label} × ${a.count}`} value={peso(a.total)} />
            ))}
          </div>

          {/* total + book */}
          <div className="px-5 py-4 bg-night text-white">
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-white/60">{en ? 'Total' : '합계'}</span>
              <span className="num text-[26px] font-semibold tracking-tight">{peso(grandTotal)}</span>
            </div>
            <button onClick={handleBookNow} disabled={dailyBreakdown.length === 0} className="btn btn-accent btn-lg w-full mt-3">
              {en ? 'Book with this quote' : '이 견적으로 예약 등록'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-muted">{label}</span>
    <span className="num text-ink-2">{value}</span>
  </div>
);
