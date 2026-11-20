import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Ticket, Trash2 } from 'lucide-react';
import { Agent, CasinoRatesConfig, FolioCharge, HotelPurchase, VoucherSale } from '../types/hotel';
import { peso, nowStamp, todayISO, uid, voucherTotals, chargeAmount } from '../utils/billing';
import { chargeStockItem, itemLabel, stockKey } from '../utils/inventory';
import { ChargeAmountText, FreeCheck } from './StayBreakdown';
import { ComboInput, Select, toast } from './ui';
import { StockWarning, useStockLeft } from './StockContext';
import { DateFilter } from './DateFilter';
import { BuyLine, HG, HotelCostInput, linkedPurchaseId } from './HotelCostSection';

/**
 * Voucher-only purchase (no room booking): guest, date, voucher items (hotel cost | guest price), paid now / bill later.
 * Renders the body + footer of a Dialog; the caller owns the Dialog and saving.
 */
export const VoucherSaleForm: React.FC<{
  initial?: VoucherSale | null;
  casinoRates: CasinoRatesConfig;
  en: boolean;
  onSave: (v: VoucherSale) => void;
  onCancel: () => void;
  /** Agents file maintenance list (suggestions for the Agent field). */
  agents?: Agent[];
  /** Purchases from the hotel — the voucher sale records its own (Jupiter's cost) when it is saved. */
  purchases?: HotelPurchase[];
  setPurchases?: React.Dispatch<React.SetStateAction<HotelPurchase[]>>;
}> = ({ initial, casinoRates, en, onSave, onCancel, agents = [], purchases = [], setPurchases }) => {
  const [guestName, setGuestName] = useState(initial?.guestName ?? '');
  const [agentName, setAgentName] = useState(initial?.agentName ?? '');
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [remarks, setRemarks] = useState(initial?.remarks ?? '');
  const [items, setItems] = useState<FolioCharge[]>(initial?.items ?? []);
  const initialPaid = initial ? voucherTotals(initial).balance <= 0 && voucherTotals(initial).total > 0 : false;
  const [paidNow, setPaidNow] = useState(initialPaid);

  const total = items.reduce((a, c) => a + chargeAmount(c), 0);
  const canSave = guestName.trim() && date && items.length > 0;
  // nothing to charge (all free) → the guest owes nothing, so it is paid in full (same as room bookings)
  const nothingDue = items.length > 0 && total === 0;
  useEffect(() => {
    if (nothingDue) setPaidNow(true);
  }, [nothingDue]);

  // ---- Hotel column: what Jupiter pays the hotel for these vouchers (saved as purchase `buy-<saleId>`)
  const useBuy = !!setPurchases;
  const linked = initial ? purchases.find((p) => p.id === linkedPurchaseId(initial.id)) : undefined;
  // editing an older sale without a hotel purchase: no default costs; nothing recorded unless a cost is typed
  const noLink = !!initial && !linked;
  const [buyCosts, setBuyCosts] = useState<Record<string, number | null>>(() =>
    Object.fromEntries((linked?.items || []).map((i) => [stockKey(i.kind, i.item), i.unitCost]))
  );
  const [buyTried, setBuyTried] = useState(false);
  // Source per voucher kind: 'buy' = bought from the hotel now (cost typed, saved as `buy-<saleId>`),
  // 'stock' = taken from vouchers bought earlier (Hotel Purchases) — no new purchase, no cost to type.
  // Editing: a kind that is not in its own purchase came from stock. New line: stock when enough is left.
  const stockLeft = useStockLeft(en, initial ? { voucherSaleId: initial.id } : undefined);
  const [source, setSource] = useState<Record<string, 'buy' | 'stock'>>(() => {
    if (!initial) return {};
    const own = new Set((linked?.items || []).map((i) => stockKey(i.kind, i.item)));
    return Object.fromEntries(
      initial.items.flatMap((c) => {
        const v = chargeStockItem(c);
        return v ? [[stockKey('voucher', v), own.has(stockKey('voucher', v)) ? 'buy' : 'stock']] : [];
      })
    );
  });
  const buyLines = useMemo<(BuyLine & { stock: boolean; left: number })[]>(() => {
    const need = new Map<string, number>();
    for (const c of items) {
      const v = chargeStockItem(c);
      if (v) need.set(stockKey('voucher', v), (need.get(stockKey('voucher', v)) || 0) + c.qty);
    }
    return [...need].map(([key, qty]) => {
      const item = key.split(':')[1];
      const left = stockLeft.get(key) ?? 0;
      const stock = (source[key] ?? (left >= qty ? 'stock' : 'buy')) === 'stock';
      const cost = stock ? 0 : key in buyCosts ? buyCosts[key] : null;
      const entered = stock || (cost !== null && cost !== undefined);
      return {
        key,
        kind: 'voucher' as const,
        item,
        qty,
        compQty: 0,
        entered,
        free: !stock && entered && !cost,
        unitCost: cost ?? 0,
        label: itemLabel({ kind: 'voucher', item }, casinoRates, en),
        stock,
        left,
      };
    });
  }, [items, buyCosts, source, stockLeft, casinoRates, en]);
  const buyCost = buyLines.reduce((a, l) => a + l.qty * l.unitCost, 0);
  const fromStock = buyLines.filter((l) => l.stock).reduce((a, l) => a + l.qty, 0);
  const buySkipped = noLink && buyLines.every((l) => !l.entered);
  const setBuyCost = (key: string, cost: number | null) => setBuyCosts((prev) => ({ ...prev, [key]: cost }));
  const { G, SUB, HH, GH, HC, GC } = HG;

  const save = () => {
    if (!canSave) return;
    const noCost = useBuy && !buySkipped ? buyLines.filter((l) => !l.entered) : [];
    if (noCost.length) {
      setBuyTried(true);
      toast(
        en ? 'Enter the hotel cost' : '호텔 원가를 입력하세요',
        `${noCost.map((l) => l.label).join(', ')} — ${en ? 'type the hotel price in the Hotel column (0 = free from the hotel), or pick From stock' : '호텔 열에 단가 입력 (0 = 호텔 무료) 또는 재고 사용 선택'}`,
        'bad'
      );
      return;
    }
    // keep the original payments if they still cover the total exactly; otherwise one payment for the total
    const keep = initial && initialPaid && voucherTotals({ ...initial, items }).balance === 0;
    const payments = paidNow && total > 0
      ? keep
        ? initial!.payments
        : [{ id: uid(), date, amount: total, method: 'Cash' as const, reference: en ? 'Paid at purchase' : '구매 시 결제', recordedAt: nowStamp() }]
      : [];
    const sale: VoucherSale = {
      id: initial?.id ?? `vch-${Date.now()}`,
      date,
      guestName: guestName.trim(),
      agentName: agentName.trim().replace(/\s+/g, ' '),
      remarks: remarks.trim(),
      items: items.map((c) => ({ ...c, date })), // items carry the purchase date
      payments,
    };
    // its purchase from the hotel, dated on the purchase date (= that month's hotel bill)
    if (setPurchases) {
      const id = linkedPurchaseId(sale.id);
      const lines = buyLines.filter((l) => l.qty > 0 && !l.stock).map((l) => ({ id: uid(), kind: l.kind, item: l.item, qty: l.qty, unitCost: l.unitCost }));
      setPurchases((prev) => {
        const old = prev.find((p) => p.id === id);
        if (!lines.length || buySkipped) return old ? prev.filter((p) => p.id !== id) : prev;
        const p: HotelPurchase = { id, date, reference: old?.reference || '', remarks: `${en ? 'Vouchers' : '바우처'}: ${sale.guestName}`.slice(0, 500), items: lines };
        return old ? prev.map((x) => (x.id === id ? p : x)) : [p, ...prev];
      });
    }
    onSave(sale);
  };

  return (
    <>
      <div className="px-6 py-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {/* Agent · Guest Name · Purchase date on one line (same as the room booking form) */}
        <div className="col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
          <div className="min-w-0">
            <label className="field-label">{en ? 'Agent' : '에이전트'}</label>
            <ComboInput
              autoFocus
              value={agentName}
              onChange={setAgentName}
              options={agents.filter((a) => a.active).map((a) => a.name)}
              maxLength={100}
              placeholder={en ? 'Type or pick' : '입력 또는 선택'}
              emptyText={en ? 'No agents yet — type a name' : '등록된 에이전트 없음 — 이름을 입력하세요'}
            />
            {agentName.trim() && !agents.some((a) => a.name.toLowerCase() === agentName.trim().toLowerCase()) && (
              <div className="text-[11px] text-accent mt-1">{en ? 'New agent — will be added to the Agents list' : '새 에이전트 — 목록에 추가됩니다'}</div>
            )}
          </div>
          <div className="min-w-0">
            <label className="field-label">{en ? 'Guest Name *' : '손님 이름 *'}</label>
            <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="e.g. John Doe" className="input" />
          </div>
          <div className="min-w-0">
            <label className="field-label">{en ? 'Purchase date *' : '구매일 *'}</label>
            <DateFilter stay en={en} mode="date" onMode={() => {}} date={date} onDate={setDate} from={date} to={date} onRange={() => {}} />
          </div>
        </div>

        {/* items — item · qty × price ║ HOTEL: complimentary · cost ║ GUEST: complimentary · amount */}
        <div className="col-span-2 rounded-xl border border-line overflow-hidden">
          <table className="dtable compact">
            <thead>
              <tr>
                <th rowSpan={2} className="!static align-bottom">{en ? 'Voucher' : '바우처'}</th>
                <th rowSpan={2} className="!static align-bottom">{en ? 'Rate' : '요금'}</th>
                <th colSpan={2} className={`${HH} !static c !border-b-0 !pb-0 ${G}`}>{en ? 'Hotel' : '호텔'}</th>
                <th colSpan={2} className={`${GH} !static c !border-b-0 !pb-0 ${G}`}>{en ? 'Guest' : '손님'}</th>
              </tr>
              <tr>
                <th
                  className={`${HC} !static c w-[128px] ${SUB} ${G}`}
                  title={en ? 'Buy now = bought from the hotel with this sale · From stock = vouchers bought earlier · Complimentary = ₱0 from the hotel' : '지금 구매 / 재고 사용 / 호텔 무료'}
                >
                  {en ? 'Source' : '출처'}
                </th>
                <th className={`${HC} !static c w-[128px] ${SUB}`}>{en ? 'Cost' : '원가'}</th>
                <th className={`${GC} !static c w-[108px] ${SUB} ${G}`} title={en ? 'Complimentary for the guest — ₱0' : '손님 무료 — ₱0'}>
                  {en ? 'Complimentary' : '무료'}
                </th>
                <th className={`${GC} !static c w-[128px] ${SUB}`}>{en ? 'Amount' : '금액'}</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-[12.5px] text-muted">
                    {en ? 'No vouchers yet — add one below.' : '아직 바우처가 없습니다. 아래에서 추가하세요.'}
                  </td>
                </tr>
              )}
              {items.map((c) => {
                const v = chargeStockItem(c);
                const line = v ? buyLines.find((l) => l.key === stockKey('voucher', v)) : undefined;
                return (
                  <tr key={c.id} className="!bg-warn-soft/80">
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="w-7 h-7 rounded-lg bg-warn-line text-warn grid place-items-center shrink-0">
                          <Ticket className="w-3.5 h-3.5" />
                        </span>
                        <div className="min-w-0 text-ink font-medium">{c.description}</div>
                        <button
                          type="button"
                          onClick={() => setItems((prev) => prev.filter((x) => x.id !== c.id))}
                          className="icon-btn !w-6 !h-6 ml-auto hover:!text-bad"
                          title={en ? 'Remove' : '삭제'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="num text-muted whitespace-nowrap">
                      {c.qty} × {peso(c.unitPrice)}
                    </td>
                    {/* hotel */}
                    <td className={`${HC} c ${G}`}>
                      {useBuy && line && (
                        <Select
                          value={line.stock ? 'stock' : line.free ? 'free' : 'buy'}
                          onChange={(e) => {
                            const to = e.target.value;
                            setSource((prev) => ({ ...prev, [line.key]: to === 'stock' ? 'stock' : 'buy' }));
                            if (to === 'free') setBuyCost(line.key, 0);
                            else if (to === 'buy' && line.free) setBuyCost(line.key, null);
                          }}
                          className="input input-sm w-[116px] mx-auto text-[12px]"
                        >
                          <option value="buy">{en ? 'Buy now' : '지금 구매'}</option>
                          <option value="stock">{en ? 'From stock' : '재고 사용'}</option>
                          <option value="free">{en ? 'Complimentary' : '호텔 무료'}</option>
                        </Select>
                      )}
                    </td>
                    <td className={`${HC} c`}>
                      {useBuy && line ? (
                        line.stock ? (
                          <span
                            className={`badge ${line.left >= line.qty ? 'badge-info' : 'badge-warn'} w-[108px] mx-auto justify-center h-7 num`}
                            title={en ? 'Taken from vouchers already bought from the hotel (Hotel Purchases) — no new cost' : '이미 구매한 바우처 사용 — 추가 원가 없음'}
                          >
                            {line.left >= line.qty
                              ? en ? `${line.left} in stock` : `재고 ${line.left}`
                              : en ? `Only ${Math.max(line.left, 0)} left` : `재고 ${Math.max(line.left, 0)}뿐`}
                          </span>
                        ) : (
                          <HotelCostInput en={en} line={line} onCost={setBuyCost} warn={buyTried} />
                        )
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    {/* guest */}
                    <td className={`${GC} c ${G}`}>
                      <input
                        type="checkbox"
                        checked={!!c.free}
                        onChange={() => setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, free: !x.free } : x)))}
                        title={en ? 'Complimentary for the guest — ₱0' : '손님 무료 — ₱0'}
                        className="w-4 h-4 accent-[#2e7a57] cursor-pointer align-middle"
                      />
                    </td>
                    <td className={`${GC} c num font-semibold text-ink whitespace-nowrap`}>
                      <ChargeAmountText qty={c.qty} unitPrice={c.unitPrice} free={c.free} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {items.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={2}>
                    <div className="flex items-center gap-2">
                      {en ? 'Total' : '합계'}
                      {useBuy && (
                        <span className="ml-auto text-[12px] font-normal text-muted">
                          {en ? 'Margin' : '마진'}{' '}
                          <b className={`num ${total - buyCost < 0 ? 'text-bad' : 'text-ok'}`}>
                            {total - buyCost < 0 ? '−' : ''}
                            {peso(Math.abs(total - buyCost))}
                          </b>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={`${HC} ${G}`} />
                  <td className={`${HC} c num`}>
                    {useBuy ? (
                      <>
                        {peso(buyCost)}
                        {fromStock > 0 && (
                          <div className="text-[10.5px] font-normal text-muted">
                            + {fromStock} {en ? 'from stock' : '재고 사용'}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className={`${GC} ${G}`} />
                  <td className={`${GC} c num`}>{peso(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="col-span-2">
          <VoucherItemsEditor items={items} setItems={setItems} date={date} casinoRates={casinoRates} en={en} addRowOnly />
        </div>
        {!useBuy && (
          <div className="col-span-2 empty:hidden">
            <StockWarning en={en} items={items} exclude={initial ? { voucherSaleId: initial.id } : undefined} />
          </div>
        )}

        <div className="col-span-2 sm:col-span-1">
          <label className="field-label">{en ? 'Guest payment' : '손님 결제'}</label>
          <div className="seg w-full">
            <button type="button" data-active={paidNow} onClick={() => setPaidNow(true)} className="flex-1">
              {en ? 'Paid in full now' : '지금 전액 결제'}
            </button>
            <button
              type="button"
              data-active={!paidNow}
              disabled={nothingDue}
              onClick={() => setPaidNow(false)}
              className="flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {en ? 'Bill later' : '나중에 청구'}
            </button>
          </div>
          {nothingDue && <div className="text-[11px] text-ok mt-1">{en ? 'Nothing to charge — marked as paid' : '청구 금액 없음 — 결제 완료로 처리'}</div>}
        </div>

        <div className="col-span-2 sm:col-span-1">
          <label className="field-label">{en ? 'Remarks' : '비고'}</label>
          <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={en ? 'e.g. For tomorrow’s breakfast' : '예: 내일 조식용'} className="input" />
        </div>
      </div>

      <div className="px-6 py-4 border-t border-line bg-sunken flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          {en ? 'Cancel' : '취소'}
        </button>
        <button type="button" onClick={save} disabled={!canSave} className="btn btn-primary px-5">
          {initial ? (en ? 'Update vouchers' : '바우처 수정') : en ? 'Save vouchers' : '바우처 저장'}
        </button>
      </div>
    </>
  );
};

type PresetKey = 'breakfast' | 'dinner' | 'extraBed' | 'other';

/**
 * Voucher list + "add" row (Item / Description / Qty / Amount / +).
 * Used by the voucher-only purchase form and the room booking form, so both look the same.
 * Same description + unit price is merged into one line (qty added).
 */
export const VoucherItemsEditor: React.FC<{
  items: FolioCharge[];
  setItems: React.Dispatch<React.SetStateAction<FolioCharge[]>>;
  date: string;
  casinoRates: CasinoRatesConfig;
  en: boolean;
  /** also offer "Extra bed (per night)" — for room bookings */
  withExtraBed?: boolean;
  /** only the "add" row — the caller shows the list itself (room booking breakdown) */
  addRowOnly?: boolean;
}> = ({ items, setItems, date, casinoRates, en, withExtraBed = false, addRowOnly = false }) => {
  const presets = useMemo(
    () =>
      [
        { key: 'breakfast' as PresetKey, label: en ? 'Breakfast voucher' : '조식 바우처', price: casinoRates.vouchers.breakfast },
        { key: 'dinner' as PresetKey, label: en ? 'Dinner voucher' : '석식 바우처', price: casinoRates.vouchers.dinner },
        ...(withExtraBed ? [{ key: 'extraBed' as PresetKey, label: en ? 'Extra bed (per night)' : '엑스트라 베드 (1박)', price: casinoRates.vouchers.extraBed }] : []),
        { key: 'other' as PresetKey, label: en ? 'Other' : '기타', price: 0 },
      ],
    [casinoRates, en, withExtraBed]
  );

  const [preset, setPreset] = useState<PresetKey>('breakfast');
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
      const same = prev.find((c) => !c.free && c.description.toLowerCase() === desc.trim().toLowerCase() && c.unitPrice === unitPrice);
      if (same) return prev.map((c) => (c === same ? { ...c, qty: c.qty + qty } : c));
      return [...prev, { id: uid(), date, description: desc.trim(), qty, unitPrice, category: preset }];
    });
    setQty(1);
  };
  const total = items.reduce((a, c) => a + chargeAmount(c), 0);

  return (
    <>
      {!addRowOnly && (
      <>
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
                    <span className="inline-flex items-center gap-3">
                      <FreeCheck en={en} checked={!!c.free} onChange={() => setItems((prev) => prev.map((x) => (x.id === c.id ? { ...x, free: !x.free } : x)))} />
                      {c.qty} × {peso(c.unitPrice)}
                    </span>
                  </td>
                  <td className="r num font-semibold text-ink whitespace-nowrap">
                    <ChargeAmountText qty={c.qty} unitPrice={c.unitPrice} free={c.free} />
                  </td>
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
      </>
      )}

      <div className={`${addRowOnly ? '' : 'mt-2 '}grid grid-cols-12 gap-2 items-end`}>
        <div className="col-span-6 sm:col-span-3">
          {!addRowOnly && <label className="field-label">{addRowOnly ? (en ? 'Add voucher' : '바우처 추가') : en ? 'Item' : '항목'}</label>}
          <Select value={preset} onChange={(e) => pick(e.target.value)} className="input input-sm">
            {presets.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </Select>
        </div>
        <div className="col-span-6 sm:col-span-4">
          {!addRowOnly && <label className="field-label">{en ? 'Description' : '내역'}</label>}
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={addRowOnly ? (en ? 'Add voucher — description' : '바우처 추가 — 내역') : en ? 'e.g. Lunch voucher' : '예: 중식 바우처'} className="input input-sm" />
        </div>
        <div className="col-span-3 sm:col-span-1">
          {!addRowOnly && <label className="field-label">{en ? 'Qty' : '수량'}</label>}
          <input inputMode="numeric" value={qty} onChange={(e) => setQty(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)} className="input input-sm text-center num" />
        </div>
        <div className="col-span-7 sm:col-span-3">
          {!addRowOnly && <label className="field-label">{en ? 'Amount' : '금액'}</label>}
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
    </>
  );
};
