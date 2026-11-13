import React, { useState, useEffect, useRef } from 'react';
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
import { ActiveModule, CasinoRatesConfig, FolioCharge, Reservation, Settlement, VoucherSale } from './types/hotel';
import { migrateReservation, syncStatus } from './utils/billing';
import { api, ServerState } from './utils/api';
import { defaultCasinoRates } from './data/initialData';
import { Language } from './i18n/translations';

// Old browser-only data keys: read once and moved into MySQL (see importLocalData).
const STORAGE_KEY_CASINO_RATES = 'hotel_casino_rates_v2';
const STORAGE_KEY_RESERVATIONS = 'hotel_reservations_v2';
const STORAGE_KEY_LANGUAGE = 'hotel_language_v2';
const STORAGE_KEY_SETTLEMENTS = 'hotel_settlements_v1';

const readLocal = <T,>(key: string): T | null => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : null;
  } catch {
    return null;
  }
};

/**
 * Before the database, data lived only in this browser's localStorage. Send anything the
 * server doesn't have yet, then remove the old keys. Returns a short summary, or '' if nothing moved.
 */
async function importLocalData(server: ServerState): Promise<string> {
  const localRes = (readLocal<Reservation[]>(STORAGE_KEY_RESERVATIONS) || []).map(migrateReservation);
  const localSettle = readLocal<Settlement[]>(STORAGE_KEY_SETTLEMENTS) || [];
  const localRates = readLocal<CasinoRatesConfig>(STORAGE_KEY_CASINO_RATES);
  if (!localRes.length && !localSettle.length && !localRates) return '';

  const have = new Set(server.reservations.map((r) => r.id));
  const newRes = localRes.filter((r) => !have.has(r.id));
  const haveMonths = new Set(server.settlements.map((s) => s.month));
  const newSettle = localSettle.filter((s) => s.payments.length && !haveMonths.has(s.month));

  for (const r of newRes) await api.saveReservation(r);
  for (const s of newSettle) await api.saveSettlement(s.month, s.payments);
  // Rates edited in this browser win only while the database has no bookings yet.
  if (localRates && !server.reservations.length) await api.saveRates(localRates);

  for (const key of [STORAGE_KEY_RESERVATIONS, STORAGE_KEY_SETTLEMENTS, STORAGE_KEY_CASINO_RATES]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  return newRes.length || newSettle.length ? `${newRes.length} booking(s), ${newSettle.length} month(s) of hotel payments` : '';
}

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

  // 2. Data — saved in MySQL through the backend (src/utils/api.ts).
  //    The pages keep using plain React state; the effects below send every change to the server.
  const [casinoRates, setCasinoRates] = useState<CasinoRatesConfig>(defaultCasinoRates);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  // Payments Jupiter makes to the hotel, per reference month
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  // Vouchers bought without a room booking (for the record)
  const [voucherSales, setVoucherSales] = useState<VoucherSale[]>([]);
  const [dbStatus, setDbStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // What the server already has (JSON per id / month), so only real changes are sent.
  const syncedRes = useRef(new Map<string, string>());
  const syncedSettle = useRef(new Map<string, string>());
  const syncedVouchers = useRef(new Map<string, string>());
  const syncedRates = useRef('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let state = await api.loadState();
        // One-time move of bookings saved in this browser (before the database) into MySQL.
        const imported = await importLocalData(state);
        if (imported) state = await api.loadState();
        if (cancelled) return;
        const res = state.reservations.map((r) => syncStatus(migrateReservation(r)));
        syncedRes.current = new Map(res.map((r) => [r.id, JSON.stringify(r)]));
        syncedSettle.current = new Map(state.settlements.map((s) => [s.month, JSON.stringify(s.payments)]));
        const vouchers = state.voucherSales || [];
        syncedVouchers.current = new Map(vouchers.map((v) => [v.id, JSON.stringify(v)]));
        const rates = state.rates.rooms.length ? state.rates : defaultCasinoRates;
        syncedRates.current = JSON.stringify(rates);
        setReservations(res);
        setSettlements(state.settlements);
        setVoucherSales(vouchers);
        setCasinoRates(rates);
        setDbStatus('ready');
        if (imported) toast(language === 'en' ? 'Saved data moved to the database' : '저장된 데이터를 DB로 옮겼습니다', `${imported}`, 'info');
      } catch (e) {
        console.error(e);
        if (cancelled) return;
        setDbStatus('error');
        toast(
          language === 'en' ? 'Cannot reach the database' : '데이터베이스에 연결할 수 없습니다',
          language === 'en' ? 'Changes will not be saved. Reload the page.' : '변경 사항이 저장되지 않습니다. 새로고침하세요.',
          'bad'
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncFailed = (e: unknown) => {
    console.error(e);
    toast(language === 'en' ? 'Not saved to the database' : 'DB 저장 실패', e instanceof Error ? e.message : String(e), 'bad');
  };

  useEffect(() => {
    if (dbStatus !== 'ready') return;
    const seen = new Set<string>();
    for (const r of reservations) {
      seen.add(r.id);
      const json = JSON.stringify(r);
      if (syncedRes.current.get(r.id) === json) continue;
      syncedRes.current.set(r.id, json);
      api.saveReservation(r).catch((e) => {
        syncedRes.current.delete(r.id); // retry on the next change
        syncFailed(e);
      });
    }
    for (const id of [...syncedRes.current.keys()]) {
      if (seen.has(id)) continue;
      syncedRes.current.delete(id);
      api.deleteReservation(id).catch(syncFailed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservations, dbStatus]);

  useEffect(() => {
    if (dbStatus !== 'ready') return;
    const seen = new Set<string>();
    for (const s of settlements) {
      seen.add(s.month);
      const json = JSON.stringify(s.payments);
      if (syncedSettle.current.get(s.month) === json) continue;
      syncedSettle.current.set(s.month, json);
      api.saveSettlement(s.month, s.payments).catch((e) => {
        syncedSettle.current.delete(s.month);
        syncFailed(e);
      });
    }
    for (const month of [...syncedSettle.current.keys()]) {
      if (seen.has(month)) continue;
      syncedSettle.current.delete(month);
      api.saveSettlement(month, []).catch(syncFailed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlements, dbStatus]);

  useEffect(() => {
    if (dbStatus !== 'ready') return;
    const json = JSON.stringify(casinoRates);
    if (syncedRates.current === json) return;
    syncedRates.current = json;
    api.saveRates(casinoRates).catch((e) => {
      syncedRates.current = '';
      syncFailed(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casinoRates, dbStatus]);

  useEffect(() => {
    if (dbStatus !== 'ready') return;
    const seen = new Set<string>();
    for (const v of voucherSales) {
      seen.add(v.id);
      const json = JSON.stringify(v);
      if (syncedVouchers.current.get(v.id) === json) continue;
      syncedVouchers.current.set(v.id, json);
      api.saveVoucherSale(v).catch((e) => {
        syncedVouchers.current.delete(v.id); // retry on the next change
        syncFailed(e);
      });
    }
    for (const id of [...syncedVouchers.current.keys()]) {
      if (seen.has(id)) continue;
      syncedVouchers.current.delete(id);
      api.deleteVoucherSale(id).catch(syncFailed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherSales, dbStatus]);

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
          voucherSales={voucherSales}
          setVoucherSales={setVoucherSales}
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
          onVoucherCreated={() => setActiveModule('ledger')}
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
          <div className="flex items-center gap-3 shrink-0 select-none">
            <span className="w-px h-6 bg-white/20" />
            <span className="text-[15px] font-semibold tracking-wide" style={{ color: '#e9c46a' }}>
              Hotel PMS
            </span>
          </div>
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
                voucherSales={voucherSales}
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
                voucherSales={voucherSales}
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
                voucherSales={voucherSales}
                setVoucherSales={setVoucherSales}
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
