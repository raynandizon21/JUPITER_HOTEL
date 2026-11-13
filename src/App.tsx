import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { DailyDashboard } from './components/DailyDashboard';
import { DailySettlement } from './components/DailySettlement';
import { GuestReservationLedger } from './components/GuestReservationLedger';
import { ReservationCalendar } from './components/ReservationCalendar';
import { RoomRatesMaintenance } from './components/RoomRatesMaintenance';
import { RateCalculator } from './components/RateCalculator';
import { LanguageSelector } from './components/LanguageSelector';
import jupiterLogo from './logo.jpg';
import { Home as HomeIcon, Plus } from 'lucide-react';
import { Toaster, toast } from './components/ui';
import { ActiveModule, CasinoRatesConfig, FolioCharge, Reservation, Settlement } from './types/hotel';
import { migrateReservation } from './utils/billing';
import { defaultCasinoRates } from './data/initialData';
import { Language } from './i18n/translations';

const STORAGE_KEY_CASINO_RATES = 'hotel_casino_rates_v2';
const STORAGE_KEY_RESERVATIONS = 'hotel_reservations_v2';
const STORAGE_KEY_LANGUAGE = 'hotel_language_v2';
const STORAGE_KEY_SETTLEMENTS = 'hotel_settlements_v1';

export default function App() {
  // 1. Language State (DEFAULT: English 'en' with PH / KOR flags)
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LANGUAGE);
      if (saved === 'ko' || saved === 'en') return saved;
    } catch (e) {
      console.error(e);
    }
    return 'en';
  });


  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_LANGUAGE, language);
  }, [language]);

  // 2. Casino Room Rates (Image 2) State with LocalStorage
  const [casinoRates, setCasinoRates] = useState<CasinoRatesConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CASINO_RATES);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return defaultCasinoRates;
  });

  // Reservations State with LocalStorage
  const [reservations, setReservations] = useState<Reservation[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_RESERVATIONS);
      if (saved) return (JSON.parse(saved) as Reservation[]).map(migrateReservation);
    } catch (e) {
      console.error(e);
    }
    return []; // start empty — no sample bookings
  });

  // Payments Jupiter makes to the hotel, per reference month
  const [settlements, setSettlements] = useState<Settlement[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTLEMENTS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SETTLEMENTS, JSON.stringify(settlements));
  }, [settlements]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CASINO_RATES, JSON.stringify(casinoRates));
  }, [casinoRates]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(reservations));
  }, [reservations]);

  // 3. Navigation State
  const [activeModule, setActiveModule] = useState<ActiveModule>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('2026-11');

  // Handler for booking from Rate Calculator
  const handleBookWithQuote = (quote: {
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
  }) => {
    const newRes: Reservation = {
      id: `res-${Date.now()}`,
      guestName: quote.guestName,
      oic: quote.oic,
      roomType: quote.roomType,
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      nights: Math.max(1, Math.ceil((new Date(quote.checkOut).getTime() - new Date(quote.checkIn).getTime()) / (1000 * 3600 * 24))),
      amount: quote.amount,
      currency: 'PHP',
      referenceMonth: quote.checkIn.substring(0, 7),
      remarks: quote.remarks,
      holidayDates: quote.holidayDates,
      charges: quote.charges,
      payments: [],
      paymentStatus: '미결제',
      occupancy: quote.occupancy,
      isJupiterGuest: true,
    };
    setReservations((prev) => [newRes, ...prev]);
    toast(language === 'en' ? 'Reservation saved' : '예약 저장됨', `${newRes.guestName} · ${newRes.nights} ${language === 'en' ? 'nights' : '박'} · ₱${newRes.amount.toLocaleString()}`);
    setSelectedMonth(newRes.referenceMonth);
    setActiveModule('ledger');
  };

  // "New Booking" opens the form on top of the current page; after saving we go to the ledger and highlight the row
  const [bookingOpen, setBookingOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  return (
    <div className="h-screen w-screen overflow-hidden bg-canvas text-ink flex flex-col p-3 gap-3">
      <Toaster />
      {bookingOpen && (
        <GuestReservationLedger
          formOnly
          autoOpenNew
          reservations={reservations}
          setReservations={setReservations}
          casinoRates={casinoRates}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          language={language}
          onClose={() => setBookingOpen(false)}
          onCreated={(r) => {
            setSelectedMonth(r.referenceMonth);
            setHighlightId(r.id);
            setActiveModule('ledger');
          }}
        />
      )}
      {/* Floating top bar */}
      <header
        className="h-16 shrink-0 rounded-2xl px-3 md:px-4 flex items-center justify-between gap-4 text-white relative z-40"
        style={{
          background: '#000',
          boxShadow: '0 6px 20px -8px rgb(0 0 0 / 0.5), inset 0 1px 0 rgb(255 255 255 / 0.06)',
        }}
      >
        {/* thin gold line along the bottom */}
        <div
          className="absolute inset-x-6 bottom-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgb(230 190 90 / 0.55), transparent)' }}
        />
        {/* Left: logo + main actions */}
        <div className="flex items-center gap-5 min-w-0">
          <button onClick={() => setActiveModule('dashboard')} className="cursor-pointer shrink-0" title={language === 'en' ? 'Home' : '홈'}>
            {/* crop the logo's black padding so only the mark + wordmark show */}
            <span className="relative block w-[120px] h-[30px] overflow-hidden">
              <img src={jupiterLogo} alt="Jupiter" className="absolute max-w-none w-[147px] left-[-14px] top-[-23px]" />
            </span>
          </button>
        </div>

        {/* Right: live clock + language */}
        <div className="flex items-center gap-4">
          <div className="hidden md:block text-right">
            <LiveClock language={language} />
          </div>
          <div className="w-px h-7 bg-white/10" />
          <LanguageSelector dark currentLanguage={language} onLanguageChange={setLanguage} />
        </div>
      </header>

      <div className="flex-1 flex gap-3 min-h-0">
        <Sidebar
          activeModule={activeModule}
          setActiveModule={setActiveModule}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          language={language}
          onClearData={() => {
            const en = language === 'en';
            if (
              !confirm(
                en
                  ? 'Delete ALL saved data in this browser?\n\nBookings, guest bills, payments to hotel and room rates will be removed. This cannot be undone.'
                  : '이 브라우저에 저장된 모든 데이터를 삭제하시겠습니까?\n\n예약, 청구서, 호텔 지급 내역, 객실 요금이 삭제됩니다. 되돌릴 수 없습니다.'
              )
            )
              return;
            try {
              localStorage.clear();
            } catch {
              /* ignore */
            }
            location.reload();
          }}
        />

        <main className="flex-1 min-w-0 overflow-y-auto rounded-2xl">
          <div key={activeModule} className="px-2 md:px-4 pt-3 pb-8 animate-fade-in">
            {/* Quick actions (in place of the breadcrumb) */}
            <nav className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setActiveModule('dashboard')}
                className={`group h-9 pl-1.5 pr-4 rounded-full inline-flex items-center gap-2 text-[13px] font-medium border transition-all cursor-pointer ${
                  activeModule === 'dashboard'
                    ? 'bg-ink text-white border-ink shadow-sm'
                    : 'bg-surface text-ink-2 border-line hover:border-line-strong hover:text-ink shadow-xs'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full grid place-items-center transition-colors ${
                    activeModule === 'dashboard' ? 'bg-white/15' : 'bg-canvas group-hover:bg-line'
                  }`}
                >
                  <HomeIcon className="w-3.5 h-3.5" />
                </span>
                {language === 'en' ? 'Home' : '홈'}
              </button>
              <button
                onClick={() => setBookingOpen(true)}
                className="h-9 pl-1.5 pr-4 rounded-full inline-flex items-center gap-2 text-[13px] font-medium border bg-surface text-ink-2 border-line hover:border-line-strong hover:text-ink shadow-xs transition-all cursor-pointer"
              >
                <span
                  className="w-6 h-6 rounded-full grid place-items-center text-[#1d1505]"
                  style={{ background: 'linear-gradient(180deg, #f7df92 0%, #e6bb52 55%, #c9982e 100%)' }}
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={2.75} />
                </span>
                {language === 'en' ? 'New Booking' : '새 예약'}
              </button>
            </nav>
            {activeModule === 'dashboard' && (
              <DailyDashboard
                reservations={reservations}
                casinoRates={casinoRates}
                setReservations={setReservations}
                settlements={settlements}
                setSettlements={setSettlements}
                selectedMonth={selectedMonth}
                setSelectedMonth={setSelectedMonth}
                onNavigateToLedger={() => setActiveModule('ledger')}
                language={language}
              />
            )}

            {activeModule === 'daily' && (
              <DailySettlement
                reservations={reservations}
                setReservations={setReservations}
                casinoRates={casinoRates}
                selectedMonth={selectedMonth}
                setSelectedMonth={setSelectedMonth}
                language={language}
              />
            )}

            {activeModule === 'ledger' && (
              <GuestReservationLedger
                highlightId={highlightId}
                reservations={reservations}
                setReservations={setReservations}
                casinoRates={casinoRates}
                selectedMonth={selectedMonth}
                setSelectedMonth={setSelectedMonth}
                language={language}
              />
            )}

            {activeModule === 'calendar' && (
              <ReservationCalendar
                reservations={reservations}
                setReservations={setReservations}
                casinoRates={casinoRates}
                currentYearMonth={selectedMonth}
                onSelectMonth={(ym) => setSelectedMonth(ym)}
                language={language}
              />
            )}

            {activeModule === 'maintenance' && (
              <RoomRatesMaintenance
                casinoRates={casinoRates}
                setCasinoRates={setCasinoRates}
                language={language}
              />
            )}

            {activeModule === 'calculator' && (
              <RateCalculator
                casinoRates={casinoRates}
                onBookWithQuote={handleBookWithQuote}
                language={language}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Live date + time for the top bar, ticking every second. */
const LiveClock: React.FC<{ language: Language }> = ({ language }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const loc = language === 'en' ? 'en-US' : 'ko-KR';
  return (
    <div className="leading-tight">
      <div className="num text-[15px] font-semibold tracking-wide" style={{ color: '#e9c46a' }}>
        {now.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div className="text-[11.5px] text-white/60">
        {now.toLocaleDateString(loc, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </div>
    </div>
  );
};
