import React from 'react';
import { NightRate, formatLongDate, nightsLabel } from '../utils/hotelHelpers';

/** Night-by-night rate table + totals (room rate, holiday surcharge, manual adjustment, total). */
export const StayBreakdown: React.FC<{ nightly: NightRate[]; amount: number; en: boolean }> = ({ nightly, amount, en }) => {
  const base = nightly.reduce((a, n) => a + n.baseRate, 0);
  const listTotal = nightly.reduce((a, n) => a + n.listRate, 0);
  const rateTotal = nightly.reduce((a, n) => a + n.rate, 0);
  const surcharge = listTotal - base; // holiday nights at the weekend rate
  const comp = listTotal - rateTotal; // complimentary nights
  const adjust = amount - rateTotal;
  const kindLabel = (k: NightRate['kind']) =>
    k === 'holiday' ? (en ? 'Holiday' : '공휴일') : k === 'weekend' ? (en ? 'Weekend' : '주말') : en ? 'Weekday' : '평일';

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line overflow-hidden">
        <table className="dtable">
          <thead>
            <tr>
              <th>{en ? 'Night' : '날짜'}</th>
              <th>{en ? 'Rate type' : '요금 구분'}</th>
              <th className="r">{en ? 'Rate' : '요금'}</th>
            </tr>
          </thead>
          <tbody>
            {nightly.map((n) => (
              <tr key={n.date}>
                <td className="whitespace-nowrap">
                  {formatLongDate(n.date)}{' '}
                  <span className="text-muted">
                    {new Date(n.date + 'T00:00:00').toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'short' })}
                  </span>
                </td>
                <td>
                  <span className={`badge !h-5 !text-[10.5px] ${n.kind === 'holiday' ? 'badge-bad' : n.kind === 'weekend' ? 'badge-warn' : 'badge-info'}`}>
                    {kindLabel(n.kind)}
                  </span>
                  {n.comp && <span className="badge badge-ok !h-5 !text-[10.5px] ml-1.5">{en ? 'Free' : '무료'}</span>}
                </td>
                <td className="r num whitespace-nowrap">
                  <NightRateText n={n} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl bg-sunken border border-line p-4 text-[13px] space-y-1.5">
        <div className="flex justify-between">
          <span className="text-muted">{en ? `Room rate (${nightsLabel(nightly.length)})` : `객실 요금 (${nightly.length}박)`}</span>
          <span className="num text-ink-2">₱{base.toLocaleString()}</span>
        </div>
        {comp !== 0 && (
          <div className="flex justify-between">
            <span className="text-muted">{en ? 'Complimentary (free nights)' : '무료 숙박'}</span>
            <span className="num text-ok">−₱{comp.toLocaleString()}</span>
          </div>
        )}
        {surcharge !== 0 && (
          <div className="flex justify-between">
            <span className="text-muted">{en ? 'Holiday surcharge' : '공휴일 할증'}</span>
            <span className="num text-bad">+₱{surcharge.toLocaleString()}</span>
          </div>
        )}
        {adjust !== 0 && (
          <div className="flex justify-between">
            <span className="text-muted">{en ? 'Manual adjustment' : '수동 조정'}</span>
            <span className={`num ${adjust > 0 ? 'text-bad' : 'text-info'}`}>
              {adjust > 0 ? '+' : '−'}₱{Math.abs(adjust).toLocaleString()}
            </span>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-2 mt-1 border-t border-line">
          <span className="font-semibold text-ink">{en ? 'Total amount' : '총 결제 금액'}</span>
          <span className="num text-[20px] font-bold text-ink">₱{amount.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
};

/** Weekday / Weekend / Holiday tag for one night, green "Free" when it is complimentary. */
export const NightBadge: React.FC<{ n: NightRate; en: boolean }> = ({ n, en }) =>
  n.comp ? (
    <span className="badge badge-ok w-[72px] justify-center">{en ? 'Free' : '무료'}</span>
  ) : (
    <span className={`badge w-[72px] justify-center ${n.kind === 'weekday' ? 'badge-info' : n.kind === 'weekend' ? 'badge-warn' : 'badge-bad'}`}>
      {n.kind === 'weekday' ? (en ? 'Weekday' : '평일') : n.kind === 'weekend' ? (en ? 'Weekend' : '주말') : en ? 'Holiday' : '공휴일'}
    </span>
  );

/** Night rate with the regular price struck through for holiday and free nights. */
export const NightRateText: React.FC<{ n: NightRate }> = ({ n }) => {
  const struck = n.comp ? n.listRate : n.kind === 'holiday' && n.baseRate !== n.rate ? n.baseRate : null;
  return (
    <>
      {struck != null && <s className="text-faint text-[11px] mr-2">₱{struck.toLocaleString()}</s>}
      <span className={n.comp ? 'text-ok font-medium' : n.kind === 'holiday' ? 'text-bad font-medium' : 'text-ink'}>₱{n.rate.toLocaleString()}</span>
    </>
  );
};

/** Amount of a charge line; a free one shows the price struck through and ₱0 in green. */
export const ChargeAmountText: React.FC<{ qty: number; unitPrice: number; free?: boolean }> = ({ qty, unitPrice, free }) =>
  free ? (
    <>
      <s className="text-faint text-[11px] font-normal mr-2">₱{(qty * unitPrice).toLocaleString()}</s>
      <span className="text-ok">₱0</span>
    </>
  ) : (
    <>₱{(qty * unitPrice).toLocaleString()}</>
  );

/** Small "Free" checkbox used on charge / voucher lines. */
export const FreeCheck: React.FC<{ checked: boolean; onChange: () => void; en: boolean }> = ({ checked, onChange, en }) => (
  <label className="inline-flex items-center gap-1 font-sans text-[11.5px] text-ink-2 cursor-pointer whitespace-nowrap" title={en ? 'Complimentary — charged ₱0' : '무료 — ₱0'}>
    <input type="checkbox" checked={checked} onChange={onChange} className="w-3.5 h-3.5 accent-[#2e7a57] cursor-pointer" />
    {en ? 'Free' : '무료'}
  </label>
);
