import React, { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CasinoRatesConfig, FolioCharge, VoucherSale } from '../types/hotel';
import { peso, todayISO, uid, voucherTotals } from '../utils/billing';
import { formatLongDate } from '../utils/hotelHelpers';

/**
 * Voucher-only purchase (no room booking): guest, date, voucher items, paid now / bill later.
 * Renders the body + footer of a Dialog; the caller owns the Dialog and saving.
 */
export const VoucherSaleForm: React.FC<{
  initial?: VoucherSale | null;
  casinoRates: CasinoRatesConfig;
  en: boolean;
  onSave: (v: VoucherSale) => void;
  onCancel: () => void;
}> = ({ initial, casinoRates, en, onSave, onCancel }) => {
  const presets = useMemo(
    () => [
      { key: 'breakfast' as const, label: en ? 'Breakfast voucher' : '조식 바우처', price: casinoRates.vouchers.breakfast },
      { key: 'dinner' as const, label: en ? 'Dinner voucher' : '석식 바우처', price: casinoRates.vouchers.dinner },
      { key: 'other' as const, label: en ? 'Other' : '기타', price: 0 },
    ],
    [casinoRates, en]
  );

  const [guestName, setGuestName] = useState(initial?.guestName ?? '');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [remarks, setRemarks] = useState(initial?.remarks ?? '');
  const [items, setItems] = useState<FolioCharge[]>(initial?.items ?? []);
  const initialPaid = initial ? voucherTotals(initial).balance <= 0 && voucherTotals(initial).total > 0 : false;
  const [paidNow, setPaidNow] = useState(initialPaid);

  // "add item" row
  const [preset, setPreset] = useState<(typeof presets)[number]['key']>('breakfast');
  const [desc, setDesc] = useState(presets[0].label);
  const [qty, setQty] = useState(1);
  const [unitPrice, setUnitPrice] = useState(presets[0].price);
  const pick = (key: string) => {
    const p = presets.find((x) => x.key === key) || presets[0];
    setPreset(p.key);
    setDesc(p.key === 'other' ? '' : p.label);
    setUnitPrice(p.price);
  };
  const addItem = () => {
    if (!desc.trim() || qty < 1) return;
    setItems((prev) => {
      // same description + unit price → add to the qty instead of a new line
      const same = prev.find((c) => c.description.toLowerCase() === desc.trim().toLowerCase() && c.unitPrice === unitPrice);
      if (same) return prev.map((c) => (c === same ? { ...c, qty: c.qty + qty } : c));
      return [...prev, { id: uid(), date, description: desc.trim(), qty, unitPrice, category: preset }];
    });
    setQty(1);
  };

  const total = items.reduce((a, c) => a + c.qty * c.unitPrice, 0);
  const canSave = guestName.trim() && date && items.length > 0;

  const save = () => {
    if (!canSave) return;
    // keep the original payments if they still cover the total exactly; otherwise one payment for the total
    const keep = initial && initialPaid && voucherTotals({ ...initial, items }).balance === 0;
    const payments = paidNow
      ? keep
        ? initial!.payments
        : [{ id: uid(), date, amount: total, method: 'Cash' as const, reference: en ? 'Paid at purchase' : '구매 시 결제' }]
      : [];
    onSave({
      id: initial?.id ?? `vch-${Date.now()}`,
      date,
      guestName: guestName.trim(),
      remarks: remarks.trim(),
      items: items.map((c) => ({ ...c, date })), // items carry the purchase date

      payments,
    });
  };

  return (
    <>
      <div className="px-6 py-5 grid grid-cols-2 gap-4 max-h-[65vh] overflow-y-auto">
        <div className="col-span-2 sm:col-span-1">
          <label className="field-label">{en ? 'Guest Name *' : '손님 이름 *'}</label>
          <input autoFocus value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="e.g. John Doe" className="input" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="field-label">{en ? 'Purchase date *' : '구매일 *'}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </div>

        {/* items */}
        <div className="col-span-2">
          <label className="field-label">{en ? 'Vouchers' : '바우처'}</label>
          <div className="rounded-xl border border-line overflow-hidden">
            {items.length === 0 ? (
              <div className="px-4 py-3 text-[12.5px] text-muted">{en ? 'No vouchers yet — add one below.' : '아직 바우처가 없습니다. 아래에서 추가하세요.'}</div>
            ) : (
              <table className="dtable compact">
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td className="text-ink">{c.description}</td>
                      <td className="r num text-muted whitespace-nowrap">
                        {c.qty} × {peso(c.unitPrice)}
                      </td>
                      <td className="r num font-semibold text-ink whitespace-nowrap">{peso(c.qty * c.unitPrice)}</td>
                      <td className="r w-10">
                        <button type="button" onClick={() => setItems((prev) => prev.filter((x) => x.id !== c.id))} className="icon-btn !text-bad hover:!bg-bad-soft" title={en ? 'Remove' : '삭제'}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-semibold text-ink">{en ? 'Total' : '합계'}</td>
                    <td />
                    <td className="r num font-bold text-ink">{peso(total)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          <div className="mt-2 grid grid-cols-12 gap-2 items-end">
            <div className="col-span-6 sm:col-span-3">
              <label className="field-label">{en ? 'Item' : '항목'}</label>
              <select value={preset} onChange={(e) => pick(e.target.value)} className="input input-sm">
                {presets.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="col-span-6 sm:col-span-4">
              <label className="field-label">{en ? 'Description' : '내역'}</label>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={en ? 'e.g. Lunch voucher' : '예: 중식 바우처'} className="input input-sm" />
            </div>
            <div className="col-span-3 sm:col-span-1">
              <label className="field-label">{en ? 'Qty' : '수량'}</label>
              <input inputMode="numeric" value={qty} onChange={(e) => setQty(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)} className="input input-sm text-center num" />
            </div>
            <div className="col-span-7 sm:col-span-3">
              <label className="field-label">{en ? 'Amount' : '금액'}</label>
              {/* Qty × unit price; typing an amount sets unit price = amount ÷ qty */}
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-faint">₱</span>
                <input
                  inputMode="numeric"
                  value={(qty * unitPrice).toLocaleString('en-US')}
                  onChange={(e) => {
                    const amt = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                    setUnitPrice(qty > 0 ? Math.round(amt / qty) : amt);
                  }}
                  className="input input-sm text-right num font-semibold pl-6"
                />
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <button type="button" onClick={addItem} disabled={!desc.trim() || qty < 1} className="btn btn-outline btn-sm w-full !h-[30px]" title={en ? 'Add voucher' : '바우처 추가'}>
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="col-span-2">
          <label className="field-label">{en ? 'Guest payment' : '손님 결제'}</label>
          <div className="seg w-full">
            <button type="button" data-active={paidNow} onClick={() => setPaidNow(true)} className="flex-1">
              {en ? 'Paid in full now' : '지금 전액 결제'}
            </button>
            <button type="button" data-active={!paidNow} onClick={() => setPaidNow(false)} className="flex-1">
              {en ? 'Bill later' : '나중에 청구'}
            </button>
          </div>
        </div>

        <div className="col-span-2">
          <label className="field-label">{en ? 'Remarks' : '비고'}</label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={en ? 'e.g. For tomorrow’s breakfast' : '예: 내일 조식용'} className="input" />
        </div>
      </div>

      <div className="px-6 py-4 border-t border-line bg-sunken flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-muted">
          {items.length > 0 && (
            <>
              {formatLongDate(date)} · <span className="num font-semibold text-ink">{peso(total)}</span>
            </>
          )}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost">
            {en ? 'Cancel' : '취소'}
          </button>
          <button type="button" onClick={save} disabled={!canSave} className="btn btn-primary px-5">
            {initial ? (en ? 'Update vouchers' : '바우처 수정') : en ? 'Save vouchers' : '바우처 저장'}
          </button>
        </div>
      </div>
    </>
  );
};
