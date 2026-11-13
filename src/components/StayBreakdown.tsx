import React from 'react';
import { NightRate, formatLongDate } from '../utils/hotelHelpers';

/** Night-by-night rate table + totals (room rate, holiday surcharge, manual adjustment, total). */
export const StayBreakdown: React.FC<{ nightly: NightRate[]; amount: number; en: boolean }> = ({ nightly, amount, en }) => {
  const base = nightly.reduce((a, n) => a + n.baseRate, 0);
  const rateTotal = nightly.reduce((a, n) => a + n.rate, 0);
  const surcharge = rateTotal - base;
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
                </td>
                <td className="r num whitespace-nowrap">
                  {n.kind === 'holiday' && <span className="text-faint line-through mr-1.5">₱{n.baseRate.toLocaleString()}</span>}
                  <span className={n.kind === 'holiday' ? 'text-bad font-medium' : 'text-ink'}>₱{n.rate.toLocaleString()}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl bg-sunken border border-line p-4 text-[13px] space-y-1.5">
        <div className="flex justify-between">
          <span className="text-muted">{en ? `Room rate (${nightly.length} nights)` : `객실 요금 (${nightly.length}박)`}</span>
          <span className="num text-ink-2">₱{base.toLocaleString()}</span>
        </div>
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
