import React, { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { Dialog } from './ui';

/**
 * "Clear data" (sidebar): deletes every booking, voucher purchase, payment to the hotel and
 * Fund entry from MySQL for good. Room rates, agents and holidays are kept.
 * Staff must type DELETE first.
 */
export const ClearDataDialog: React.FC<{
  en: boolean;
  counts: { bookings: number; vouchers: number; hotelPayments: number; fund: number; purchases: number };
  onConfirm: () => Promise<void>;
  onClose: () => void;
}> = ({ en, counts, onConfirm, onClose }) => {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toUpperCase() === 'DELETE';

  const rows = [
    [en ? 'Room bookings (with their charges and payments)' : '객실 예약 (추가 요금·결제 포함)', counts.bookings],
    [en ? 'Voucher-only purchases (with their payments)' : '바우처 단독 구매 (결제 포함)', counts.vouchers],
    [en ? 'Payments to the hotel' : '호텔 지급 내역', counts.hotelPayments],
    [en ? 'Fund Cash in / Cash out' : '자금 입금 / 출금', counts.fund],
    [en ? 'Purchases from the hotel (inventory)' : '호텔 구매 (재고)', counts.purchases],
  ] as const;

  const run = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={en ? 'Delete all data' : '모든 데이터 삭제'} subtitle={en ? 'This cannot be undone' : '되돌릴 수 없습니다'} onClose={busy ? () => {} : onClose} width="max-w-md">
      <div className="px-6 py-5 grid gap-4 text-[13px]">
        <div className="flex gap-3 rounded-xl bg-bad-soft border border-bad-line px-4 py-3 text-bad">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>{en ? 'These are deleted from the database for good, for everyone using the app:' : '다음 항목이 데이터베이스에서 영구 삭제됩니다 (모든 사용자):'}</div>
        </div>

        <div className="divide-y divide-line">
          {rows.map(([label, n]) => (
            <div key={label} className="flex items-center justify-between py-1.5">
              <span className="text-ink-2">{label}</span>
              <span className="num font-semibold text-ink">{n}</span>
            </div>
          ))}
        </div>

        <div className="text-muted text-[12.5px]">
          {en ? 'Kept: room rates, room types, vouchers & add-on prices, agents, holidays.' : '유지: 객실 요금, 객실 타입, 바우처·부가 요금, 에이전트, 공휴일.'}
        </div>

        <label className="grid gap-1.5">
          <span className="text-ink-2">
            {en ? 'Type' : '확인하려면'} <b className="text-bad">DELETE</b> {en ? 'to confirm' : '를 입력하세요'}
          </span>
          <input
            id="clear-data-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="DELETE"
            autoFocus
            autoComplete="off"
            className="input uppercase"
          />
        </label>
      </div>
      <div className="px-6 py-4 border-t border-line bg-sunken flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="btn btn-ghost">
          {en ? 'Cancel' : '취소'}
        </button>
        <button
          onClick={run}
          disabled={!ok || busy}
          className="btn border border-bad-line bg-bad text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-4 h-4" />
          {busy ? (en ? 'Deleting…' : '삭제 중…') : en ? 'Delete all data' : '모두 삭제'}
        </button>
      </div>
    </Dialog>
  );
};
