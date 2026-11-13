import React, { useState, useMemo } from 'react';
import { Reservation, CasinoRatesConfig } from '../types/hotel';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GuestFolio } from './GuestFolio';
import { Language, translations } from '../i18n/translations';
import { PageHeader } from './ui';

interface ReservationCalendarProps {
  casinoRates: CasinoRatesConfig;
  reservations: Reservation[];
  setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
  currentYearMonth: string;
  onSelectMonth: (ym: string) => void;
  language: Language;
}

interface GuestDayStatus {
  reservationId: string;
  guestName: string;
  status: '입실' | '체류' | '퇴실';
  roomType: string;
  amount: number;
  currency: 'PHP' | 'KRW';
  checkIn: string;
  checkOut: string;
}

export const ReservationCalendar: React.FC<ReservationCalendarProps> = ({
  reservations,
  setReservations,
  currentYearMonth,
  onSelectMonth,
  language,
  casinoRates,
}) => {
  const t = translations[language];
  const [folioId, setFolioId] = useState<string | null>(null);
  const setSelectedRes = (r: Reservation | null) => setFolioId(r ? r.id : null);

  // Parse Year and Month
  const [year, month] = useMemo(() => {
    const parts = (currentYearMonth || '2026-09').split('-');
    return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  }, [currentYearMonth]);

  // Navigate months
  const handlePrevMonth = () => {
    let newYear = year;
    let newMonth = month - 1;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    const ym = `${newYear}-${newMonth < 10 ? `0${newMonth}` : newMonth}`;
    onSelectMonth(ym);
  };

  const handleNextMonth = () => {
    let newYear = year;
    let newMonth = month + 1;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    const ym = `${newYear}-${newMonth < 10 ? `0${newMonth}` : newMonth}`;
    onSelectMonth(ym);
  };

  // Build calendar matrix (Sunday to Saturday)
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(year, month - 1, 1).getDay(); // 0 = Sun
    const totalDaysInMonth = new Date(year, month, 0).getDate();

    const prevMonthDaysCount = new Date(year, month - 1, 0).getDate();
    const prevDays: { day: number; isCurrentMonth: boolean; dateStr: string; dayOfWeek: number }[] = [];
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = prevMonthDaysCount - i;
      const m = month === 1 ? 12 : month - 1;
      const y = month === 1 ? year - 1 : year;
      const mStr = m < 10 ? `0${m}` : `${m}`;
      const dStr = d < 10 ? `0${d}` : `${d}`;
      prevDays.push({
        day: d,
        isCurrentMonth: false,
        dateStr: `${y}-${mStr}-${dStr}`,
        dayOfWeek: (firstDayIndex - 1 - i) % 7,
      });
    }

    const currentDays = [];
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const mStr = month < 10 ? `0${month}` : `${month}`;
      const dStr = d < 10 ? `0${d}` : `${d}`;
      const dateStr = `${year}-${mStr}-${dStr}`;
      const dayOfWeek = new Date(year, month - 1, d).getDay();
      currentDays.push({
        day: d,
        isCurrentMonth: true,
        dateStr,
        dayOfWeek,
      });
    }

    const totalCells = Math.ceil((prevDays.length + currentDays.length) / 7) * 7;
    const nextDaysCount = totalCells - (prevDays.length + currentDays.length);
    const nextDays = [];
    for (let d = 1; d <= nextDaysCount; d++) {
      const m = month === 12 ? 1 : month + 1;
      const y = month === 12 ? year + 1 : year;
      const mStr = m < 10 ? `0${m}` : `${m}`;
      const dStr = d < 10 ? `0${d}` : `${d}`;
      const dateStr = `${y}-${mStr}-${dStr}`;
      const dayOfWeek = (prevDays.length + currentDays.length + d - 1) % 7;
      nextDays.push({
        day: d,
        isCurrentMonth: false,
        dateStr,
        dayOfWeek,
      });
    }

    return [...prevDays, ...currentDays, ...nextDays];
  }, [year, month]);

  // Compute status for each day matching image_db14c553.png
  const dayStatusMap = useMemo(() => {
    const map = new Map<string, GuestDayStatus[]>();

    reservations.forEach((res) => {
      const start = new Date(res.checkIn);
      const end = new Date(res.checkOut);

      const cur = new Date(start);
      while (cur <= end) {
        const dateStr = cur.toISOString().split('T')[0];
        let status: '입실' | '체류' | '퇴실' = '체류';
        if (dateStr === res.checkIn) {
          status = '입실';
        } else if (dateStr === res.checkOut) {
          status = '퇴실';
        }

        const item: GuestDayStatus = {
          reservationId: res.id,
          guestName: res.guestName,
          status,
          roomType: res.roomType,
          amount: res.amount,
          currency: res.currency,
          checkIn: res.checkIn,
          checkOut: res.checkOut,
        };

        const existing = map.get(dateStr) || [];
        existing.push(item);
        map.set(dateStr, existing);

        cur.setDate(cur.getDate() + 1);
      }
    });

    return map;
  }, [reservations]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const en = language === 'en';
  const todayStr = new Date().toISOString().split('T')[0];
  const weekdays = [
    ['일', 'SUN'], ['월', 'MON'], ['화', 'TUE'], ['수', 'WED'], ['목', 'THU'], ['금', 'FRI'], ['토', 'SAT'],
  ];
  const pill = {
    입실: { cls: 'bg-ok-soft text-ok border-l-2 border-ok', label: t.statusCheckIn },
    체류: { cls: 'bg-info-soft text-info border-l-2 border-info', label: t.statusStaying },
    퇴실: { cls: 'bg-warn-soft text-warn border-l-2 border-warn', label: t.statusCheckOut },
  } as const;

  return (
    <div className="flex flex-col h-[calc(100vh-176px)] min-h-[520px]">
      <PageHeader
        title={`${monthNames[month - 1]} ${year}`}
        actions={
          <>
            <div className="hidden md:flex items-center gap-4 text-[12px] text-muted mr-2">
              <Legend cls="bg-ok" label={en ? 'Check-in' : '입실'} />
              <Legend cls="bg-info" label={en ? 'Staying' : '체류'} />
              <Legend cls="bg-warn" label={en ? 'Check-out' : '퇴실'} />
            </div>
            <div className="flex items-center rounded-[10px] border border-line-strong bg-surface h-[34px] overflow-hidden">
              <button onClick={handlePrevMonth} className="icon-btn h-full rounded-none" aria-label="Previous month">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="h-full border-l border-line" />
              <button onClick={handleNextMonth} className="icon-btn h-full rounded-none" aria-label="Next month">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </>
        }
      />

      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-x-auto flex-1 min-h-0 flex flex-col">
          <div className="min-w-[760px] flex-1 min-h-0 flex flex-col">
            <div className="grid grid-cols-7">
              {weekdays.map(([ko, enDay], i) => (
                <div
                  key={enDay}
                  className={`py-2 text-center text-[13px] font-bold text-white ${i >= 5 ? 'bg-[#c0662b]' : 'bg-[#3567d6]'} ${i < 6 ? 'border-r border-white/20' : ''}`}
                >
                  {ko} <span className="text-[11.5px] font-semibold">({enDay})</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 flex-1 min-h-0" style={{ gridTemplateRows: `repeat(${calendarDays.length / 7}, minmax(0, 1fr))` }}>
              {calendarDays.map((cd, idx) => {
                const items = dayStatusMap.get(cd.dateStr) || [];
                const isToday = cd.dateStr === todayStr;
                const sunday = cd.dayOfWeek === 0;
                return (
                  <div
                    key={cd.dateStr}
                    className={`relative min-h-0 overflow-hidden p-1.5 flex flex-col border-line ${(idx + 1) % 7 !== 0 ? 'border-r' : ''} ${
                      idx < calendarDays.length - 7 ? 'border-b' : ''
                    } ${!cd.isCurrentMonth ? 'bg-sunken' : 'bg-surface'} ${
                      isToday ? 'ring-2 ring-inset ring-ink z-[1]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1 px-0.5 shrink-0">
                      <span
                        className={`num text-[13px] font-semibold w-6 h-6 grid place-items-center rounded-full ${
                          isToday ? 'bg-ink text-white' : !cd.isCurrentMonth ? (sunday ? 'text-bad/50' : 'text-faint/70') : sunday ? 'text-bad' : 'text-ink'
                        }`}
                      >
                        {cd.day}
                      </span>
                    </div>

                    <div className={`space-y-0.5 flex-1 min-h-0 overflow-y-auto ${cd.isCurrentMonth ? '' : 'opacity-40'}`}>
                      {items.map((gs, gi) => {
                        const p = pill[gs.status];
                        return (
                          <button
                            key={`${gs.reservationId}-${gi}`}
                            onClick={() => {
                              const full = reservations.find((r) => r.id === gs.reservationId);
                              if (full) setSelectedRes(full);
                            }}
                            title={`${gs.guestName} · ${p.label} · ${gs.roomType}`}
                            className={`w-full text-left px-1.5 py-[3px] rounded-[5px] text-[11px] leading-tight flex items-center gap-1 cursor-pointer transition hover:brightness-95 ${p.cls}`}
                          >
                            <span className="truncate font-medium flex-1">{gs.guestName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {folioId && reservations.find((r) => r.id === folioId) && (
        <GuestFolio
          reservation={reservations.find((r) => r.id === folioId)!}
          casinoRates={casinoRates}
          en={en}
          onChange={(next) => setReservations((prev) => prev.map((x) => (x.id === next.id ? next : x)))}
          onClose={() => setFolioId(null)}
        />
      )}
    </div>
  );
};

const Legend: React.FC<{ cls: string; label: string }> = ({ cls, label }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={`w-2 h-2 rounded-full ${cls}`} />
    {label}
  </span>
);
