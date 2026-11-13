import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Printer, Receipt, CreditCard, BedDouble, BedSingle, UtensilsCrossed, Tag, Pencil, Check, X } from 'lucide-react';
import { CasinoRatesConfig, FolioCharge, FolioPayment, PaymentMethod, Reservation } from '../types/hotel';
import { folioOf, syncStatus, uid, todayISO, PAYMENT_METHODS, peso, printDocument, escapeHtml as esc } from '../utils/billing';
import { formatLongDate, getNightlyRates, formatDateRange } from '../utils/hotelHelpers';
import { Dialog, toast } from './ui';

interface Props {
  reservation: Reservation;
  casinoRates: CasinoRatesConfig;
  en: boolean;
  onChange: (r: Reservation) => void;
  onClose: () => void;
}

const statusBadge = (status: 'paid' | 'partial' | 'unpaid', en: boolean) =>
  status === 'paid' ? (
    <span className="badge badge-ok badge-dot">{en ? 'Paid' : '결제 완료'}</span>
  ) : status === 'partial' ? (
    <span className="badge badge-warn badge-dot">{en ? 'Partial' : '부분 결제'}</span>
  ) : (
    <span className="badge badge-bad badge-dot">{en ? 'Unpaid' : '미결제'}</span>
  );

export const GuestFolio: React.FC<Props> = ({ reservation: r, casinoRates, en, onChange, onClose }) => {
  const f = folioOf(r);
  const charges = r.charges || [];
  const payments = r.payments || [];
  const update = (patch: Partial<Reservation>) => onChange(syncStatus({ ...r, ...patch }));

  // --- add charge form ---
  const presets = [
    { key: 'breakfast', label: en ? 'Breakfast voucher' : '조식 바우처', price: casinoRates.vouchers.breakfast },
    { key: 'dinner', label: en ? 'Dinner voucher' : '석식 바우처', price: casinoRates.vouchers.dinner },
    { key: 'extraBed', label: en ? 'Extra bed (per night)' : '엑스트라 베드 (1박)', price: casinoRates.vouchers.extraBed },
    { key: 'other', label: en ? 'Other…' : '기타…', price: 0 },
  ];
  const [preset, setPreset] = useState(presets[0].key);
  const [chDesc, setChDesc] = useState(presets[0].label);
  const [chQty, setChQty] = useState(1);
  const [chPrice, setChPrice] = useState(presets[0].price);
  const [chDate, setChDate] = useState(r.checkIn);

  const pickPreset = (key: string) => {
    const p = presets.find((x) => x.key === key)!;
    setPreset(key);
    setChDesc(key === 'other' ? '' : p.label);
    setChPrice(p.price);
  };
  const addCharge = () => {
    if (!chDesc.trim() || chQty < 1) return;
    const category = preset === 'breakfast' || preset === 'dinner' ? 'buffet' : preset === 'extraBed' ? 'extraBed' : 'other';
    const c: FolioCharge = { id: uid(), date: chDate, description: chDesc.trim(), qty: chQty, unitPrice: chPrice, category };
    const same = charges.find((x) => sameItem(x, c));
    if (same) {
      // same item, date and price → add to its quantity instead of a new row
      const qty = same.qty + c.qty;
      update({ charges: charges.map((x) => (x.id === same.id ? { ...x, qty } : x)) });
      toast(en ? 'Quantity updated' : '수량 변경됨', `${c.description} × ${qty} · ${peso(qty * c.unitPrice)}`);
    } else {
      update({ charges: [...charges, c] });
      toast(en ? 'Charge added' : '청구 추가됨', `${c.description} × ${c.qty} · ${peso(c.qty * c.unitPrice)}`);
    }
    setChQty(1);
  };

  // merge duplicate rows saved before (same item, date and price)
  useEffect(() => {
    const merged: FolioCharge[] = [];
    charges.forEach((c) => {
      const m = merged.find((x) => sameItem(x, c));
      if (m) m.qty += c.qty;
      else merged.push({ ...c });
    });
    if (merged.length !== charges.length) update({ charges: merged });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- edit a charge row ---
  const [editId, setEditId] = useState<string | null>(null);
  const [eDesc, setEDesc] = useState('');
  const [eDate, setEDate] = useState('');
  const [eQty, setEQty] = useState(1);
  const [ePrice, setEPrice] = useState(0);
  const [eKey, setEKey] = useState('other');
  const presetKeyOf = (c: FolioCharge) =>
    presets.find((p) => p.key !== 'other' && p.label.toLowerCase() === c.description.trim().toLowerCase())?.key ??
    (/breakfast/i.test(c.description) ? 'breakfast' : /dinner/i.test(c.description) ? 'dinner' : /extra bed/i.test(c.description) ? 'extraBed' : 'other');
  const pickEditPreset = (key: string) => {
    const p = presets.find((x) => x.key === key)!;
    setEKey(key);
    if (key !== 'other') {
      setEDesc(p.label);
      setEPrice(p.price);
    }
  };
  const startEdit = (c: FolioCharge) => {
    setEditId(c.id);
    setEKey(presetKeyOf(c));
    setEDesc(c.description);
    setEDate(c.date);
    setEQty(c.qty);
    setEPrice(c.unitPrice);
  };
  const saveEdit = () => {
    if (!editId || !eDesc.trim() || eQty < 1) return;
    const category = eKey === 'breakfast' || eKey === 'dinner' ? 'buffet' : eKey === 'extraBed' ? 'extraBed' : 'other';
    update({ charges: charges.map((x) => (x.id === editId ? { ...x, description: eDesc.trim(), date: eDate, qty: eQty, unitPrice: ePrice, category } : x)) });
    setEditId(null);
    toast(en ? 'Charge updated' : '청구 수정됨', `${eDesc.trim()} × ${eQty} · ${peso(eQty * ePrice)}`);
  };

  // --- add payment form ---
  const [pDate, setPDate] = useState(todayISO());
  const [pAmount, setPAmount] = useState<number>(Math.max(f.balance, 0));
  const [pMethod, setPMethod] = useState<PaymentMethod>('Cash');
  const [pRef, setPRef] = useState('');
  const addPayment = () => {
    if (pAmount <= 0) return;
    const p: FolioPayment = { id: uid(), date: pDate, amount: pAmount, method: pMethod, reference: pRef.trim() };
    const next = syncStatus({ ...r, payments: [...payments, p] });
    onChange(next);
    setPRef('');
    setPAmount(Math.max(folioOf(next).balance, 0));
    const nf = folioOf(next);
    toast(
      en ? 'Payment recorded' : '결제 기록됨',
      `${peso(p.amount)} · ${p.method} — ${nf.balance <= 0 ? (en ? 'folio fully paid' : '전액 결제 완료') : `${en ? 'balance' : '잔액'} ${peso(nf.balance)}`}`
    );
  };

  const room = casinoRates.rooms.find((x) => x.name.toLowerCase() === r.roomType.toLowerCase());
  const nightly = room ? getNightlyRates(r.checkIn, r.checkOut, room.id, r.occupancy || 'singleDouble', casinoRates, r.holidayDates) : [];

  const printFolio = () => {
    const rows = [
      `<tr><td>${formatLongDate(r.checkIn)}</td><td>${esc(r.roomType)} — ${r.nights} night(s)</td><td class="r">1</td><td class="r">${peso(r.amount)}</td><td class="r">${peso(r.amount)}</td></tr>`,
      ...charges.map(
        (c) => `<tr><td>${formatLongDate(c.date)}</td><td>${esc(c.description)}</td><td class="r">${c.qty}</td><td class="r">${peso(c.unitPrice)}</td><td class="r">${peso(c.qty * c.unitPrice)}</td></tr>`
      ),
    ].join('');
    const pays = payments
      .map((p) => `<tr><td>${formatLongDate(p.date)}</td><td>${esc(p.method)}</td><td>${esc(p.reference || '—')}</td><td class="r">${peso(p.amount)}</td></tr>`)
      .join('');
    printDocument(
      `Guest Folio - ${r.guestName}`,
      `<div class="row"><div><h1>Hilton Hotel — Guest Folio</h1><div class="muted">Folio #${esc(r.id)}</div></div>
       <div style="text-align:right"><b>${esc(r.guestName)}</b><div class="muted">${esc(r.roomType)}</div>
       <div class="muted">${formatDateRange(r.checkIn, r.checkOut)} · ${r.nights} night(s)</div></div></div>
       <h2>Charges</h2><table><thead><tr><th>Date</th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
       <h2>Payments</h2><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="r">Amount</th></tr></thead><tbody>${pays || '<tr><td colspan="4" class="muted">No payments</td></tr>'}</tbody></table>
       <div class="totals"><div><span>Total charges</span><span>${peso(f.total)}</span></div><div><span>Payments</span><span>−${peso(f.paid)}</span></div>
       <div class="grand"><span>Balance due</span><span>${peso(f.balance)}</span></div></div>
       <div class="sign"><div>Guest signature</div><div>Cashier</div></div>`
    );
  };

  return (
    <Dialog
      width="max-w-3xl"
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {r.guestName} {statusBadge(f.status, en)}
        </span>
      }
      subtitle={`${r.roomType} · ${r.occupancy === 'triple' ? (en ? 'Triple' : '3인') : en ? 'Single / Double' : '1~2인'}`}
    >
      <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-[1.6fr_1fr_1fr_1fr] gap-3">
          <div className="rounded-xl border border-line p-3">
            <div className="text-[11.5px] text-muted">{en ? 'Stay' : '숙박 기간'}</div>
            <div className="text-[13.5px] font-semibold text-ink mt-0.5">{formatDateRange(r.checkIn, r.checkOut)}</div>
            <div className="text-[11px] text-muted">
              {r.nights} {en ? (r.nights === 1 ? 'night' : 'nights') : '박'}
            </div>
          </div>
          <Box label={en ? 'Total charges' : '총 청구액'} value={peso(f.total)} />
          <Box label={en ? 'Paid' : '결제액'} value={peso(f.paid)} tone="ok" />
          <Box label={en ? 'Balance' : '잔액'} value={peso(Math.max(f.balance, 0))} tone={f.balance > 0 ? 'bad' : undefined} />
        </div>

        {/* Charges */}
        <section>
          <h3 className="text-[13px] font-semibold text-ink flex items-center gap-1.5 mb-2">
            <Receipt className="w-4 h-4" /> {en ? 'Charges' : '청구 내역'}
          </h3>
          <div className="rounded-xl border border-line overflow-hidden">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{en ? 'Item' : '항목'}</th>
                  <th className="r">{en ? 'Qty × Price' : '수량 × 단가'}</th>
                  <th className="r">{en ? 'Amount' : '금액'}</th>
                  <th className="w-[80px]" />
                </tr>
              </thead>
              <tbody>
                {/* Room charge: total on the row, nights listed in a box underneath */}
                <tr className="!bg-info-soft/80">
                  <td className="!border-b-0 !pb-2">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-info-line text-info grid place-items-center shrink-0">
                        <BedDouble className="w-4 h-4" />
                      </span>
                      <div>
                        <div className="text-ink font-medium">{en ? 'Room charge' : '객실 요금'}</div>
                        <div className="text-[11.5px] text-muted">
                          {r.roomType} · {r.nights} {en ? (r.nights === 1 ? 'night' : 'nights') : '박'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="!border-b-0" />
                  <td className="!border-b-0 r num font-semibold text-ink">{peso(r.amount)}</td>
                  <td className="!border-b-0" />
                </tr>
                {nightly.length > 0 && (
                  <tr>
                    <td colSpan={4} className="!px-0 !pt-0 !pb-3">
                      <div className="fade-band text-[12.5px]">
                        {nightly.map((n, i) => (
                          <div key={n.date} className="fade-row flex items-center gap-3 pl-[60px] pr-[52px] py-2">
                            <span className="w-5 h-5 rounded-full bg-surface border border-line grid place-items-center text-[10.5px] font-semibold text-muted shrink-0">
                              {i + 1}
                            </span>
                            <span className="text-ink-2 flex-1 min-w-0 truncate">
                              {formatLongDate(n.date)}
                              <span className="text-muted ml-1.5">
                                {new Date(n.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}
                              </span>
                            </span>
                            <span className={`badge w-[72px] justify-center ${n.kind === 'weekday' ? 'badge-info' : n.kind === 'weekend' ? 'badge-warn' : 'badge-bad'}`}>
                              {n.kind === 'weekday' ? (en ? 'Weekday' : '평일') : n.kind === 'weekend' ? (en ? 'Weekend' : '주말') : en ? 'Holiday' : '공휴일'}
                            </span>
                            <span className="num w-[150px] text-right whitespace-nowrap">
                              {n.kind === 'holiday' && n.baseRate !== n.rate && <s className="text-faint text-[11px] mr-2">{peso(n.baseRate)}</s>}
                              <span className={n.kind === 'holiday' ? 'text-bad font-medium' : 'text-ink'}>{peso(n.rate)}</span>
                            </span>
                          </div>
                        ))}
                        {r.amount !== nightly.reduce((a, n) => a + n.rate, 0) && (
                          <div className="fade-row flex items-center gap-3 pl-[60px] pr-[52px] py-2 text-muted">
                            <span className="w-5 shrink-0" />
                            <span className="flex-1">{en ? 'Manual adjustment' : '수동 조정'}</span>
                            <span className="num w-[150px] text-right">
                              {(() => {
                                const d = r.amount - nightly.reduce((a, n) => a + n.rate, 0);
                                return `${d > 0 ? '+' : '−'}${peso(Math.abs(d))}`;
                              })()}
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {charges.map((c) => {
                  const Icon = c.category === 'buffet' ? UtensilsCrossed : c.category === 'extraBed' ? BedSingle : Tag;
                  const editing = editId === c.id;
                  return (
                    <tr key={c.id} className="!bg-warn-soft/80">
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-lg bg-warn-line text-warn grid place-items-center shrink-0">
                            <Icon className="w-4 h-4" />
                          </span>
                          {editing ? (
                            <div className="flex-1 min-w-0 space-y-1.5">
                              <div className="grid grid-cols-[minmax(170px,1fr)_140px] gap-2">
                                <select value={eKey} onChange={(e) => pickEditPreset(e.target.value)} className="input input-sm">
                                  {presets.map((p) => (
                                    <option key={p.key} value={p.key}>{p.label}</option>
                                  ))}
                                </select>
                                <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} className="input input-sm" />
                              </div>
                              {eKey === 'other' && (
                                <input
                                  value={eDesc}
                                  onChange={(e) => setEDesc(e.target.value)}
                                  placeholder={en ? 'Description' : '내역'}
                                  className="input input-sm w-full"
                                  autoFocus
                                />
                              )}
                            </div>
                          ) : (
                            <div>
                              <div className="text-ink font-medium">{c.description}</div>
                              <div className="text-[11.5px] text-muted">{formatLongDate(c.date)}</div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="r num text-muted whitespace-nowrap">
                        {editing ? (
                          <div className="inline-flex items-center gap-1.5">
                            <input
                              inputMode="numeric"
                              value={eQty}
                              onChange={(e) => setEQty(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                              className="input input-sm w-14 text-center num"
                            />
                            ×
                            <input
                              inputMode="numeric"
                              value={ePrice.toLocaleString('en-US')}
                              onChange={(e) => setEPrice(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                              className="input input-sm w-24 text-right num"
                            />
                          </div>
                        ) : (
                          <>
                            {c.qty} × {peso(c.unitPrice)}
                          </>
                        )}
                      </td>
                      <td className="r num font-semibold text-ink">{peso((editing ? eQty * ePrice : c.qty * c.unitPrice))}</td>
                      <td className="r whitespace-nowrap">
                        {editing ? (
                          <>
                            <button onClick={saveEdit} className="icon-btn hover:!text-ok" title={en ? 'Save' : '저장'}>
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setEditId(null)} className="icon-btn" title={en ? 'Cancel' : '취소'}>
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(c)} className="icon-btn hover:!text-accent" title={en ? 'Edit' : '수정'}>
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                update({ charges: charges.filter((x) => x.id !== c.id) });
                                toast(en ? 'Charge removed' : '청구 삭제됨', c.description, 'bad');
                              }}
                              className="icon-btn hover:!text-bad"
                              title={en ? 'Remove' : '삭제'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>{en ? 'Total charges' : '총 청구액'}</td>
                  <td className="r num">{peso(f.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* add charge */}
          <div className="mt-2 grid grid-cols-12 gap-2 items-end">
            <div className="col-span-6 sm:col-span-3">
              <label className="field-label">{en ? 'Item' : '항목'}</label>
              <select value={preset} onChange={(e) => pickPreset(e.target.value)} className="input input-sm">
                {presets.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="col-span-6 sm:col-span-3">
              <label className="field-label">{en ? 'Description' : '내역'}</label>
              <input value={chDesc} onChange={(e) => setChDesc(e.target.value)} placeholder={en ? 'e.g. Minibar' : '예: 미니바'} className="input input-sm" />
            </div>
            <div className="col-span-4 sm:col-span-2">
              <label className="field-label">{en ? 'Date' : '날짜'}</label>
              <input type="date" value={chDate} onChange={(e) => setChDate(e.target.value)} className="input input-sm" />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="field-label">{en ? 'Qty' : '수량'}</label>
              <input inputMode="numeric" value={chQty} onChange={(e) => setChQty(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)} className="input input-sm text-center num" />
            </div>
            <div className="col-span-4 sm:col-span-2">
              <label className="field-label">{en ? 'Amount' : '금액'}</label>
              {/* Qty × unit price. The preset sets the unit price; typing an amount sets unit price = amount ÷ qty. */}
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-faint">₱</span>
                <input
                  inputMode="numeric"
                  value={(chQty * chPrice).toLocaleString('en-US')}
                  onChange={(e) => {
                    const amt = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
                    setChPrice(chQty > 0 ? Math.round(amt / chQty) : amt);
                  }}
                  className="input input-sm text-right num font-semibold pl-6"
                />
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <button onClick={addCharge} className="btn btn-outline btn-sm w-full !h-[30px]" title={en ? 'Add charge' : '청구 추가'}>
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>

        {/* Payments */}
        <section>
          <h3 className="text-[13px] font-semibold text-ink flex items-center gap-1.5 mb-2">
            <CreditCard className="w-4 h-4" /> {en ? 'Payments from guest' : '손님 결제 내역'}
          </h3>
          <div className="rounded-xl border border-line overflow-hidden">
            <table className="dtable">
              <thead>
                <tr>
                  <th>{en ? 'Date' : '날짜'}</th>
                  <th>{en ? 'Method' : '결제 수단'}</th>
                  <th>{en ? 'Reference / OR no.' : '참조 / 영수증 번호'}</th>
                  <th className="r">{en ? 'Amount' : '금액'}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && (
                  <tr>
                    <td colSpan={5} className="!py-6 text-center text-muted">{en ? 'No payments yet' : '결제 내역 없음'}</td>
                  </tr>
                )}
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">{formatLongDate(p.date)}</td>
                    <td>{p.method}</td>
                    <td className="text-muted">{p.reference || '—'}</td>
                    <td className="r num font-medium text-ok">{peso(p.amount)}</td>
                    <td className="r">
                      <button
                        onClick={() => {
                          if (!confirm(en ? 'Remove this payment?' : '이 결제를 삭제하시겠습니까?')) return;
                          update({ payments: payments.filter((x) => x.id !== p.id) });
                          toast(en ? 'Payment removed' : '결제 삭제됨', `${peso(p.amount)} · ${p.method}`, 'bad');
                        }}
                        className="icon-btn hover:!text-bad"
                        title={en ? 'Remove' : '삭제'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {f.balance > 0 && (
            <div className="mt-2 grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6 sm:col-span-3">
                <label className="field-label">{en ? 'Date' : '날짜'}</label>
                <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} className="input input-sm" />
              </div>
              <div className="col-span-6 sm:col-span-3">
                <label className="field-label">{en ? 'Method' : '결제 수단'}</label>
                <select value={pMethod} onChange={(e) => setPMethod(e.target.value as PaymentMethod)} className="input input-sm">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-6 sm:col-span-3">
                <label className="field-label">{en ? 'Reference / OR no.' : '참조 번호'}</label>
                <input value={pRef} onChange={(e) => setPRef(e.target.value)} className="input input-sm" />
              </div>
              <div className="col-span-6 sm:col-span-3">
                <label className="field-label">{en ? 'Amount' : '금액'}</label>
                <div className="flex gap-2">
                  <input
                    inputMode="numeric"
                    value={pAmount.toLocaleString('en-US')}
                    onChange={(e) => setPAmount(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
                    className="input input-sm text-right num flex-1 min-w-0"
                  />
                  <button onClick={addPayment} disabled={pAmount <= 0} className="btn btn-primary btn-sm !h-[30px] shrink-0">
                    {en ? 'Add' : '추가'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="px-6 py-4 border-t border-line bg-sunken flex items-center justify-between gap-2">
        <button onClick={printFolio} className="btn btn-outline">
          <Printer className="w-4 h-4" />
          {en ? 'Print folio' : '청구서 인쇄'}
        </button>
        <button onClick={onClose} className="btn btn-primary">
          {en ? 'Done' : '완료'}
        </button>
      </div>
    </Dialog>
  );
};

export const FolioStatusBadge: React.FC<{ r: Reservation; en: boolean }> = ({ r, en }) => statusBadge(folioOf(r).status, en);

const Box: React.FC<{ label: string; value: string; tone?: 'ok' | 'bad' }> = ({ label, value, tone }) => (
  <div className="rounded-xl border border-line p-3">
    <div className="text-[11.5px] text-muted">{label}</div>
    <div className={`num text-[16px] font-semibold mt-0.5 ${tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-ink'}`}>{value}</div>
  </div>
);

/** Same item on the bill: description (case-insensitive), date and unit price. */
const sameItem = (a: FolioCharge, b: FolioCharge) =>
  a.description.trim().toLowerCase() === b.description.trim().toLowerCase() && a.date === b.date && a.unitPrice === b.unitPrice;
