// Talks to the Node backend (server/index.js), which saves everything in MySQL.
// Same origin in production (the backend serves dist/); in dev, Vite proxies /api.
import { CasinoRatesConfig, FolioPayment, Reservation, Settlement } from '../types/hotel';

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
}

export const api = {
  loadState: () => call<ServerState>('GET', '/state'),
  saveReservation: (r: Reservation) => call('PUT', `/reservations/${encodeURIComponent(r.id)}`, r),
  deleteReservation: (id: string) => call('DELETE', `/reservations/${encodeURIComponent(id)}`),
  saveSettlement: (month: string, payments: FolioPayment[]) => call('PUT', `/settlements/${month}`, { payments }),
  saveRates: (rates: CasinoRatesConfig) => call('PUT', '/rates', rates),
};
