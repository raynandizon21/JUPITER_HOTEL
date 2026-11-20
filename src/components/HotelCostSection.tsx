import React from 'react';
import { Select } from './ui';

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
  /** a cost was typed; false = still empty */
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
}> = ({ en, line, onCost, warn }) =>
  // complimentary (cost ₱0, or every night ticked in the Hotel column): a green Free badge instead of "₱ 0".
  // Clicking it empties a ₱0 cost so a price can be typed again (all nights ticked: untick a night instead).
  line.free || (line.qty > 0 && line.compQty >= line.qty) ? (
    <button
      type="button"
      onClick={() => onCost(line.key, null)}
      title={
        line.compQty > 0 && line.compQty >= line.qty
          ? en ? 'Every night is complimentary from the hotel — untick a night to type a cost' : '모든 박 호텔 무료 — 체크 해제 후 단가 입력'
          : en ? 'Complimentary from the hotel — click to type a cost' : '호텔 무료 — 클릭하여 단가 입력'
      }
      className="badge badge-ok w-[108px] mx-auto justify-center h-7 cursor-pointer"
    >
      {en ? 'Free' : '무료'}
    </button>
  ) : (
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

/** Where a voucher comes from (Hotel column): bought now, taken from stock bought earlier, or free from the hotel. */
export type VoucherSource = 'buy' | 'stock';

export type SourcePick = 'buy' | 'stock' | 'free';

/** Hotel Source dropdown of a voucher kind or a room night: Buy now / From stock / Complimentary. */
export const SourceSelect: React.FC<{ en: boolean; value: SourcePick; onPick: (to: SourcePick) => void }> = ({ en, value, onPick }) => (
  <Select value={value} onChange={(e) => onPick(e.target.value as SourcePick)} className="input input-sm w-[116px] mx-auto text-[12px]">
    <option value="buy">{en ? 'Buy now' : '지금 구매'}</option>
    <option value="stock">{en ? 'From stock' : '재고 사용'}</option>
    <option value="free">{en ? 'Complimentary' : '호텔 무료'}</option>
  </Select>
);

/** Cost cell of a voucher taken from stock: how many are left (amber when not enough). */
export const StockBadge: React.FC<{ en: boolean; qty: number; left: number }> = ({ en, qty, left }) => (
  <span
    className={`badge ${left >= qty ? 'badge-info' : 'badge-warn'} w-[108px] mx-auto justify-center h-7 num`}
    title={en ? 'Taken from vouchers already bought from the hotel (Hotel Purchases) — no new cost' : '이미 구매한 바우처 사용 — 추가 원가 없음'}
  >
    {left >= qty ? (en ? `${left} in stock` : `재고 ${left}`) : en ? `Only ${Math.max(left, 0)} left` : `재고 ${Math.max(left, 0)}뿐`}
  </span>
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

