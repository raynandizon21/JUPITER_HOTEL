import React, { useState, useEffect, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { DailyDashboard } from './components/DailyDashboard';
import { DailySettlement } from './components/DailySettlement';
import { GuestReservationLedger } from './components/GuestReservationLedger';
import { ReservationCalendar } from './components/ReservationCalendar';
import { RoomRatesMaintenance } from './components/RoomRatesMaintenance';
import { RateCalculator } from './components/RateCalculator';
import { AgentsMaintenance } from './components/AgentsMaintenance';
import { FundPage } from './components/FundPage';
import { PH_HOLIDAYS } from './data/phHolidays';
import { LanguageSelector } from './components/LanguageSelector';
import jupiterLogo from './logo.jpg';
import { Home as HomeIcon, Plus } from 'lucide-react';
import { Toaster, toast } from './components/ui';
import { ActiveModule, Agent, FundTxn, Holiday, CasinoRatesConfig, FolioCharge, Reservation, Settlement, VoucherSale } from './types/hotel';
import { migrateReservation, syncStatus } from './utils/billing';
import { api } from './utils/api';
import { defaultCasinoRates } from './data/initialData';
import { Language } from './i18n/translations';
import { nightsLabel } from './utils/hotelHelpers';

const STORAGE_KEY_LANGUAGE = 'hotel_language_v2';
// Data saved in the browser before the database existed. It is NOT imported (that brought old
// sample / demo bookings back) — it is only removed so it can't be picked up again.
const OLD_BROWSER_KEYS = ['hotel_reservations_v2', 'hotel_settlements_v1', 'hotel_casino_rates_v2', 'hotel_demo_mixed_payments_v1'];

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
  // Agents file maintenance (suggestions in the booking form)
  const [agents, setAgents] = useState<Agent[]>([]);
  // Fund (Pondo): manual cash outs + opening balances
  const [fundTxns, setFundTxns] = useState<FundTxn[]>([]);
  // Philippine holidays (auto holiday rate + calendar marks); built-in list until the server answers
  const [holidays, setHolidays] = useState<Holiday[]>(() => PH_HOLIDAYS.map((h) => ({ ...h, active: true })));
  const activeHolidays = holidays.filter((h) => h.active);
  const saveHoliday = (h: Holiday) => {
    setHolidays((prev) => [...prev.filter((x) => x.date !== h.date), h].sort((a, b) => a.date.localeCompare(b.date)));
    api.saveHoliday(h).catch(syncFailed);
  };
  const syncedFund = useRef(new Map<string, string>());
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
        // retry a few times — the backend may still be starting (e.g. right after `npm run dev:all` or a restart)
        let state: Awaited<ReturnType<typeof api.loadState>> | null = null;
        for (let attempt = 0; ; attempt++) {
          try {
            state = await api.loadState();
            break;
          } catch (err) {
            if (cancelled || attempt >= 4) throw err;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        if (!state) return;
        for (const key of OLD_BROWSER_KEYS) {
          try {
            localStorage.removeItem(key);
          } catch {
            /* ignore */
          }
        }
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
        setAgents(state.agents || []);
        const fund = state.fundTransactions || [];
        syncedFund.current = new Map(fund.map((f) => [f.id, JSON.stringify(f)]));
        setFundTxns(fund);
        if (state.holidays?.length) setHolidays(state.holidays);
        setCasinoRates(rates);
        setDbStatus('ready');
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
      api
        .saveReservation(r)
        // a new agent name is added to the Agents list by the server — refresh the suggestions
        .then(() => (r.agentName ? api.listAgents().then(setAgents) : undefined))
        .catch((e) => {
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
      api
        .saveVoucherSale(v)
        .then(() => (v.agentName ? api.listAgents().then(setAgents) : undefined))
        .catch((e) => {
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

  useEffect(() => {
    if (dbStatus !== 'ready') return;
    for (const f of fundTxns) {
      const json = JSON.stringify(f);
      if (syncedFund.current.get(f.id) === json) continue;
      syncedFund.current.set(f.id, json);
      api.saveFundTxn(f).catch((e) => {
        syncedFund.current.delete(f.id); // retry on the next change
        syncFailed(e);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundTxns, dbStatus]);

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
    toast(language === 'en' ? 'Reservation saved' : '예약 저장됨', `${newRes.guestName} · ${nightsLabel(newRes.nights, language === 'en')} · ₱${newRes.amount.toLocaleString()}`);
    setSelectedMonth(newRes.referenceMonth);
    setActiveModule('ledger');
  };

  // "New Booking" opens the form on top of the current page; after saving we go to the ledger and highlight the row
  const [bookingOpen, setBookingOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [ledgerTab, setLedgerTab] = useState<'rooms' | 'vouchers'>('rooms');

  return (
    <div className="h-screen w-screen overflow-hidden bg-canvas text-ink flex flex-col p-3 gap-3">
      <Toaster />
      {bookingOpen && (
        <GuestReservationLedger
          formOnly
          autoOpenNew
          agents={agents}
          holidays={activeHolidays}
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
            setLedgerTab('rooms');
            setActiveModule('ledger');
          }}
          onVoucherCreated={() => {
            setLedgerTab('vouchers');
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
                className="h-9 pl-1.5 pr-4 rounded-full inline-flex items-center gap-2 text-[13px] font-medium border bg-accent text-white border-accent hover:brightness-110 shadow-sm transition-all cursor-pointer"
              >
                <span className="w-6 h-6 rounded-full grid place-items-center bg-white/20">
                  <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
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
                key={ledgerTab}
                initialTab={ledgerTab}
                highlightId={highlightId}
                agents={agents}
                holidays={activeHolidays}
                allHolidays={holidays}
                onSaveHoliday={saveHoliday}
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
                holidays={activeHolidays}
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
                reservations={reservations}
                onSave={(next) => {
                  // a renamed room type: move its bookings to the new name (bookings keep the room by name)
                  const renamed = new Map<string, string>();
                  for (const r of next.rooms) {
                    const old = casinoRates.rooms.find((x) => x.id === r.id);
                    if (old && old.name !== r.name) renamed.set(old.name.toLowerCase(), r.name);
                  }
                  if (renamed.size)
                    setReservations((prev) => prev.map((r) => (renamed.has(r.roomType.toLowerCase()) ? { ...r, roomType: renamed.get(r.roomType.toLowerCase())! } : r)));
                  setCasinoRates(next);
                }}
                language={language}
              />
            )}

            {activeModule === 'agents' && <AgentsMaintenance agents={agents} setAgents={setAgents} language={language} />}



            {activeModule === 'fund' && (
              <FundPage
                reservations={reservations}
                voucherSales={voucherSales}
                settlements={settlements}
                fundTxns={fundTxns}
                setFundTxns={setFundTxns}
                selectedMonth={selectedMonth}
                setSelectedMonth={setSelectedMonth}
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
