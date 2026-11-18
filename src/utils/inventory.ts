// Hotel purchases: what Jupiter bought from the hotel (wholesale) and how much guests have used.
//  stock left = bought − used.  Room stock is room-nights per room type (any date);
//  voucher stock is per voucher kind. Free nights / free vouchers still use stock.
import { CasinoRatesConfig, FolioCharge, HotelPurchase, PurchaseItem, Reservation, VoucherSale } from '../types/hotel';

export type VoucherItem = 'breakfast' | 'dinner' | 'extraBed';
export const VOUCHER_ITEMS: VoucherItem[] = ['breakfast', 'dinner', 'extraBed'];

export const stockKey = (kind: 'room' | 'voucher', item: string) => `${kind}:${item}`;

export const voucherItemLabel = (v: VoucherItem, en: boolean) =>
  ({
    breakfast: en ? 'Breakfast voucher' : '조식 바우처',
    dinner: en ? 'Dinner voucher' : '석식 바우처',
    extraBed: en ? 'Extra bed (night)' : '엑스트라 베드 (1박)',
  })[v];

/** Which voucher stock a charge / voucher line uses (null = not stock, e.g. "Other"). */
export function chargeStockItem(c: FolioCharge): VoucherItem | null {
  if (c.category === 'breakfast' || c.category === 'dinner' || c.category === 'extraBed') return c.category;
  if (c.category === 'other') return null;
  const d = c.description || '';
  if (/breakfast|조식/i.test(d)) return 'breakfast';
  if (/dinner|석식/i.test(d)) return 'dinner';
  if (/extra\s*bed|엑스트라/i.test(d)) return 'extraBed';
  return null;
}

/** Room type id of a booking (bookings store the room type name). */
export const roomIdOf = (r: Reservation, rates: CasinoRatesConfig) =>
  rates.rooms.find((x) => x.name.toLowerCase() === r.roomType.toLowerCase())?.id ?? null;

export const itemLabel = (it: Pick<PurchaseItem, 'kind' | 'item'>, rates: CasinoRatesConfig, en: boolean) =>
  it.kind === 'room' ? rates.rooms.find((x) => x.id === it.item)?.name ?? it.item : voucherItemLabel(it.item as VoucherItem, en);

export const purchaseTotal = (p: HotelPurchase) => p.items.reduce((a, i) => a + i.qty * i.unitCost, 0);

export interface StockRow {
  key: string;
  kind: 'room' | 'voucher';
  item: string;
  label: string;
  bought: number;
  /** of `bought`, given free by the hotel (unit cost ₱0) */
  free: number;
  /** total paid to the hotel for what was bought */
  cost: number;
  used: number;
  /** available = bought − used (below 0 = guests used more than was bought) */
  left: number;
}

/**
 * Stock per room type and voucher kind. `exclude` leaves out one booking / voucher sale
 * (the one being edited), so the form can show what is left for it.
 */
export function buildStock(
  purchases: HotelPurchase[],
  reservations: Reservation[],
  voucherSales: VoucherSale[],
  rates: CasinoRatesConfig,
  en: boolean,
  exclude?: { reservationId?: string; voucherSaleId?: string }
): StockRow[] {
  const rows = new Map<string, StockRow>();
  const row = (kind: 'room' | 'voucher', item: string) => {
    const key = stockKey(kind, item);
    let r = rows.get(key);
    if (!r) {
      r = { key, kind, item, label: itemLabel({ kind, item }, rates, en), bought: 0, free: 0, cost: 0, used: 0, left: 0 };
      rows.set(key, r);
    }
    return r;
  };
  rates.rooms.forEach((x) => row('room', x.id));
  VOUCHER_ITEMS.forEach((v) => row('voucher', v));

  for (const p of purchases)
    for (const it of p.items) {
      const r = row(it.kind, it.item);
      r.bought += it.qty;
      if (!it.unitCost) r.free += it.qty;
      r.cost += it.qty * it.unitCost;
    }
  const useCharge = (c: FolioCharge) => {
    const v = chargeStockItem(c);
    if (!v) return;
    row('voucher', v).used += c.qty;
  };
  for (const res of reservations) {
    if (res.id === exclude?.reservationId) continue;
    const id = roomIdOf(res, rates);
    if (id) row('room', id).used += res.nights;
    (res.charges || []).forEach(useCharge);
  }
  for (const v of voucherSales) {
    if (v.id === exclude?.voucherSaleId) continue;
    v.items.forEach(useCharge);
  }

  return [...rows.values()].map((r) => ({ ...r, left: r.bought - r.used }));
}
