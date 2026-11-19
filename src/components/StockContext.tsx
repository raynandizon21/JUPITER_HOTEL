import React, { createContext, useContext, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { CasinoRatesConfig, FolioCharge, HotelPurchase, Reservation, VoucherSale } from '../types/hotel';
import { buildStock, chargeStockItem, stockKey, StockRow } from '../utils/inventory';

/** Purchases + usage, shared so the booking / voucher forms can warn when stock runs out. */
const StockContext = createContext<{
  purchases: HotelPurchase[];
  reservations: Reservation[];
  voucherSales: VoucherSale[];
  rates: CasinoRatesConfig;
} | null>(null);

export const StockProvider = StockContext.Provider;

/** Purchases from the hotel (empty outside the provider). */
export const usePurchases = (): HotelPurchase[] => useContext(StockContext)?.purchases ?? [];

/**
 * Warning when a booking / voucher sale needs more than is left (it can still be saved).
 * Shown only once the hotel inventory is in use (at least one purchase recorded).
 */
export const StockWarning: React.FC<{
  en: boolean;
  /** room type id + nights of the booking (room bookings only) */
  room?: { id: string | null; nights: number };
  items: FolioCharge[];
  exclude?: { reservationId?: string; voucherSaleId?: string };
}> = ({ en, room, items, exclude }) => {
  const ctx = useContext(StockContext);
  const short = useMemo(() => {
    if (!ctx || ctx.purchases.length === 0) return [];
    const rows = new Map<string, StockRow>(
      buildStock(ctx.purchases, ctx.reservations, ctx.voucherSales, ctx.rates, en, exclude).map((r) => [r.key, r])
    );
    const need = new Map<string, number>();
    if (room?.id && room.nights > 0) need.set(stockKey('room', room.id), room.nights);
    for (const c of items) {
      const v = chargeStockItem(c);
      if (v) need.set(stockKey('voucher', v), (need.get(stockKey('voucher', v)) || 0) + c.qty);
    }
    return [...need]
      .map(([key, n]) => ({ row: rows.get(key), n }))
      .filter((x): x is { row: StockRow; n: number } => !!x.row && x.n > x.row.left);
  }, [ctx, en, room?.id, room?.nights, items, exclude?.reservationId, exclude?.voucherSaleId]);

  if (!short.length) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-[10px] border border-warn-line bg-warn-soft px-3 py-1.5 text-[12px] text-ink-2"
      title={en ? 'You can still save; buy more from the hotel in Hotel Purchases.' : '저장은 가능합니다. 호텔 구매에서 추가 구매하세요.'}
    >
      <AlertTriangle className="w-3.5 h-3.5 text-warn shrink-0 mt-0.5" />
      <div className="min-w-0">
        <b className="text-warn">{en ? 'Not enough bought from the hotel' : '호텔 구매 수량 부족'}</b>
        {short.map(({ row, n }) => (
          <span key={row.key}>
            {' · '}
            {row.label}: {en ? 'needs' : '필요'} <b className="num">{n}</b>, <b className="num">{Math.max(row.left, 0)}</b> {en ? 'available' : '가용'}
          </span>
        ))}
        <span className="text-muted"> — {en ? 'you can still save' : '저장 가능'}</span>
      </div>
    </div>
  );
};
