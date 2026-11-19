import React from 'react';

/** One line of what Jupiter buys from the hotel for a booking (room-nights or vouchers). */
export interface BuyLine {
  key: string; // stockKey: 'room:<id>' | 'voucher:<item>'
  kind: 'room' | 'voucher';
  item: string;
  label: string;
  qty: number;
  /** wholesale price per unit; 0 = given free by the hotel */
  unitCost: number;
  /** of `qty`, given complimentary by the hotel (room nights ticked in the Hotel column) */
  compQty: number;
  /** a cost was typed (or filled from the last price paid); false = still empty */
  entered: boolean;
  free: boolean;
}

/** Purchase from the hotel recorded together with a booking (id `buy-<bookingId>`). */
export const linkedPurchaseId = (reservationId: string) => `buy-${reservationId}`;

/**
 * Hotel column cell of the booking form: Jupiter's unit cost (wholesale) for one item.
 * Empty = not entered yet; 0 = given free by the hotel.
 */
export const HotelCostInput: React.FC<{
  en: boolean;
  line: BuyLine;
  onCost: (key: string, cost: number | null) => void;
  /** highlight when still empty (after Save was pressed) */
  warn?: boolean;
}> = ({ en, line, onCost, warn }) => (
  <div className="relative w-[108px] mx-auto">
    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11.5px] text-faint pointer-events-none">₱</span>
    <input
      type="text"
      inputMode="numeric"
      value={line.entered ? line.unitCost.toLocaleString('en-US') : ''}
      placeholder={line.kind === 'room' ? (en ? '/ night' : '1박') : en ? 'each' : '개당'}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^0-9]/g, '');
        onCost(line.key, digits ? parseInt(digits, 10) : null);
      }}
      aria-label={en ? `Hotel cost per ${line.kind === 'room' ? 'night' : 'unit'}` : '호텔 단가'}
      title={en ? `Hotel cost per ${line.kind === 'room' ? 'night' : 'unit'} — 0 = complimentary from the hotel` : '호텔 단가 — 0 = 호텔 무료'}
      className={`input input-sm num text-right pl-6 pr-2.5 font-semibold ${warn && !line.entered ? '!border-warn' : ''}`}
    />
  </div>
);

/** Hotel | Guest column groups of the booking / voucher forms (border, 2nd header row, colours). */
export const HG = {
  G: 'border-l border-line',
  SUB: '!pt-1 !normal-case !tracking-normal !text-[11px] !font-medium !text-muted',
  HH: '!bg-violet-soft !text-violet border-t-2 border-t-violet',
  GH: '!bg-ok-soft !text-ok border-t-2 border-t-ok',
  HC: '!bg-violet-soft/45',
  GC: '!bg-ok-soft/45',
};

/** Last wholesale price paid per item (stock key) — the default hotel cost. ₱0 (free) lines are skipped. */
export const lastCostOf = (purchases: { date: string; items: { kind: 'room' | 'voucher'; item: string; unitCost: number }[] }[]) => {
  const m = new Map<string, number>();
  purchases
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((p) => p.items.forEach((i) => i.unitCost > 0 && m.set(`${i.kind}:${i.item}`, i.unitCost)));
  return m;
};
