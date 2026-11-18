// Talks to the Node backend (server/index.js), which saves everything in MySQL.
// Same origin in production (the backend serves dist/); in dev, Vite proxies /api.
import { Agent, FundTxn, Holiday, HotelPurchase, CasinoRatesConfig, FolioPayment, Reservation, Settlement, VoucherSale } from '../types/hotel';

const BASE = '/api';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export interface ServerState {
  rates: CasinoRatesConfig;
  reservations: Reservation[];
  settlements: Settlement[];
  voucherSales: VoucherSale[];
  agents: Agent[];
  fundTransactions: FundTxn[];
  holidays: Holiday[];
  purchases: HotelPurchase[];
}

export const api = {
  loadState: () => call<ServerState>('GET', '/state'),
  saveReservation: (r: Reservation) => call('PUT', `/reservations/${encodeURIComponent(r.id)}`, r),
  deleteReservation: (id: string) => call('DELETE', `/reservations/${encodeURIComponent(id)}`),
  /** Deletes all bookings, voucher purchases, payments to the hotel and fund entries (keeps rates, agents, holidays). */
  clearData: () => call<{ ok: boolean; deleted: Record<string, number> }>('POST', '/clear-data', { confirm: 'DELETE' }),
  saveSettlement: (month: string, payments: FolioPayment[]) => call('PUT', `/settlements/${month}`, { payments }),
  saveRates: (rates: CasinoRatesConfig) => call('PUT', '/rates', rates),
  saveVoucherSale: (v: VoucherSale) => call('PUT', `/vouchers/${encodeURIComponent(v.id)}`, v),
  deleteVoucherSale: (id: string) => call('DELETE', `/vouchers/${encodeURIComponent(id)}`),
  listAgents: () => call<Agent[]>('GET', '/agents'),
  saveHoliday: (h: Holiday) => call('PUT', `/holidays/${h.date}`, h),
  savePurchase: (p: HotelPurchase) => call('PUT', `/purchases/${encodeURIComponent(p.id)}`, p),
  deletePurchase: (id: string) => call('DELETE', `/purchases/${encodeURIComponent(id)}`),
  saveFundTxn: (f: FundTxn) => call('PUT', `/fund/${encodeURIComponent(f.id)}`, f),
  createAgent: (name: string) => call<Agent[]>('POST', '/agents', { name }),
  updateAgent: (id: number, patch: { name?: string; active?: boolean }) => call<Agent[]>('PUT', `/agents/${id}`, patch),
};
