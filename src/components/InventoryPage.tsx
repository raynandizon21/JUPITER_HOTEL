import React, { useMemo, useState } from 'react';
import { BedDouble, Pencil, Plus, Receipt, Ticket, Trash2 } from 'lucide-react';
import { CasinoRatesConfig, HotelPurchase, PurchaseItem, Reservation, VoucherSale } from '../types/hotel';
import { peso, todayISO, uid } from '../utils/billing';
import { formatLongDate, formatMonth } from '../utils/hotelHelpers';
import { buildStock, itemLabel, purchaseTotal, VOUCHER_ITEMS, voucherItemLabel } from '../utils/inventory';
import { Language } from '../i18n/translations';
import { ConfirmDialog, Dialog, PageHeader, Pager, RowMenu, Select, toast } from './ui';
import { useFitRows } from '../utils/useFitRows';
import { FreeCheck } from './StayBreakdown';

/**
 * Hotel Purchases: what Jupiter buys from the hotel at the wholesale rate (purchases) and the stock
 * left after guest bookings / voucher sales used it. What Jupiter owes the hotel each month = the
 * purchases dated that month (Dashboard).
 */
export const InventoryPage: React.FC<{
  purchases: HotelPurchase[];
  setPurchases: React.Dispatch<React.SetStateAction<HotelPurchase[]>>;
  reservations: Reservation[];
  voucherSales: VoucherSale[];
  casinoRates: CasinoRatesConfig;
  language: Language;
}> = ({ purchases, setPurchases, reservations, voucherSales, casinoRates, language }) => {
  const en = language === 'en';
  const stock = useMemo(() => buildStock(purchases, reservations, voucherSales, casinoRates, en), [purchases, reservations, voucherSales, casinoRates, en]);
  // rows worth showing: everything bought or used, plus every room type / voucher so staff see what can be bought
  // revenue / cost / markup only for stock that was actually bought (no cost known otherwise)
  // Hilton side only: what was bought, and what is still available (rooms in room-nights).
  // Available never shows below 0 and is never red: used more than bought shows 0 (amber), and the
  // "N used up" badge says so.
  const totals = {
    cost: stock.reduce((a, r) => a + r.cost, 0),
    roomsLeft: stock.filter((r) => r.kind === 'room').reduce((a, r) => a + Math.max(r.left, 0), 0),
    vouchersLeft: stock.filter((r) => r.kind === 'voucher').reduce((a, r) => a + Math.max(r.left, 0), 0),
  };
  // Rooms / Vouchers tab — the stock table and the purchases list both follow it
  const [tab, setTab] = useState<'room' | 'voucher'>('room');
  const tabStock = stock.filter((r) => r.kind === tab);
  const shortCount = tabStock.filter((r) => r.left < 0).length;
  const shortOf = (k: 'room' | 'voucher') => stock.filter((r) => r.kind === k && r.left < 0).length;

  const [editing, setEditing] = useState<HotelPurchase | 'new' | null>(null);
  const [deleting, setDeleting] = useState<HotelPurchase | null>(null);
  const [page, setPage] = useState(0);
  const [stockPage, setStockPage] = useState(0);
  // purchases with at least one line of this tab's kind, showing only those lines
  const list = useMemo(
    () =>
      purchases
        .map((p) => ({ p, lines: p.items.filter((i) => i.kind === tab) }))
        .filter((x) => x.lines.length > 0)
        .sort((a, b) => b.p.date.localeCompare(a.p.date) || b.p.id.localeCompare(a.p.id)),
    [purchases, tab]
  );
  // both tables fill their card and page instead of scrolling
  const [listRef, size] = useFitRows({ rowSelector: 'tbody tr[data-row]', fallbackRow: 49, min: 2, deps: [tab, list.length] });
  const pages = Math.max(1, Math.ceil(list.length / size));
  const cur = Math.min(page, pages - 1);
  const pageRows = list.slice(cur * size, cur * size + size);
  const [stockRef, stockFit] = useFitRows({ rowSelector: 'tbody tr[data-row]', fallbackRow: 33, min: 2, deps: [tab] });
  const stockPages = Math.max(1, Math.ceil(tabStock.length / stockFit));
  const stockCur = Math.min(stockPage, stockPages - 1);
  const stockRows = tabStock.slice(stockCur * stockFit, stockCur * stockFit + stockFit);


  return (
    <div className="flex-1 flex flex-col">
      <PageHeader
        title={en ? 'Hotel Purchases' : '호텔 구매'}
        lede={
          en
            ? 'Rooms and vouchers bought from the hotel at the wholesale rate, and what guests have used'
            : '호텔에서 도매가로 구매한 객실·바우처와 손님 사용 현황'
        }
        actions={
          <button onClick={() => setEditing('new')} className="btn btn-primary">
            <Plus className="w-4 h-4" />
            {en ? 'New Purchase' : '새 구매'}
          </button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <Card Icon={Receipt} tone="info" label={en ? 'Hotel Bill' : '호텔 청구액'} value={peso(totals.cost)} hint={en ? `${purchases.length} purchases · wholesale` : `구매 ${purchases.length}건 · 도매가`} />
        <Card
          Icon={BedDouble}
          tone="ok"
          label={en ? 'Room-nights available' : '가용 객실 (박)'}
          value={totals.roomsLeft.toLocaleString('en-US')}
          hint={en ? 'All room types' : '전체 객실 타입'}
        />
        <Card
          Icon={Ticket}
          tone="warn"
          label={en ? 'Vouchers available' : '가용 바우처'}
          value={totals.vouchersLeft.toLocaleString('en-US')}
          hint={en ? 'Breakfast, dinner, extra bed' : '조식·석식·엑스트라 베드'}
        />
      </div>

      <div className="grid grid-cols-1 2xl:grid-cols-5 gap-4 flex-1 min-h-[420px]">
        {/* stock */}
        <div className="card overflow-hidden 2xl:col-span-3 flex flex-col">
          <div className="flex items-end gap-1 px-5 pt-3 border-b border-line" role="tablist">
            {(
              [
                { key: 'room', label: en ? 'Room purchases' : '객실 구매', Icon: BedDouble, icon: 'text-accent', line: 'border-accent', chip: 'bg-accent text-white' },
                { key: 'voucher', label: en ? 'Voucher purchases' : '바우처 구매', Icon: Ticket, icon: 'text-warn', line: 'border-warn', chip: 'bg-warn text-white' },
              ] as const
            ).map(({ key, label, Icon, icon, line, chip }) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => {
                  setTab(key);
                  setPage(0);
                  setStockPage(0);
                }}
                className={`-mb-px flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium border-b-2 cursor-pointer transition-colors ${
                  tab === key ? `${line} text-ink` : 'border-transparent text-muted hover:text-ink-2'
                }`}
              >
                <Icon className={`w-4 h-4 ${icon}`} strokeWidth={1.75} />
                {label}
                <span className={`num text-[11px] px-1.5 h-5 min-w-5 inline-grid place-items-center rounded-full ${tab === key ? chip : 'bg-canvas text-muted'}`}>
                  {purchases.filter((p) => p.items.some((i) => i.kind === key)).length}
                </span>
                {shortOf(key) > 0 && <span className="w-1.5 h-1.5 rounded-full bg-bad" title={en ? 'Some are used up — more used than bought' : '구매보다 많이 사용됨'} />}
              </button>
            ))}
          </div>
          <div className="card-head !py-3">
            <div>
              <h3 className="card-title">{tab === 'room' ? (en ? 'Available rooms' : '가용 객실') : en ? 'Available vouchers' : '가용 바우처'}</h3>
            </div>
            {shortCount > 0 && <span className="badge badge-bad badge-dot whitespace-nowrap">{shortCount} {en ? 'used up' : '소진'}</span>}
          </div>
          <div ref={stockRef} className="flex-1 relative min-h-[160px]">
          <div className="absolute inset-0 overflow-hidden">
          <table className="dtable compact">
            <thead>
              <tr>
                <th>{tab === 'room' ? (en ? 'Room type' : '객실 타입') : en ? 'Voucher' : '바우처'}</th>
                <th className="c">{en ? 'Bought' : '구매'}</th>
                <th className="c">{en ? 'Used' : '사용'}</th>
                <th className="c">{en ? 'Available' : '가용'}</th>
              </tr>
            </thead>
            <tbody>
              {stockRows.map((r) => (
                <tr key={r.key} data-row>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className={`w-5 h-5 rounded-md grid place-items-center shrink-0 ${r.kind === 'room' ? 'bg-info-soft text-info' : 'bg-warn-soft text-warn'}`}>
                        {r.kind === 'room' ? <BedDouble className="w-3 h-3" /> : <Ticket className="w-3 h-3" />}
                      </span>
                      <span className="font-medium text-ink">{r.label}</span>
                    </div>
                  </td>
                  <td className="c num">
                    {r.bought || <Dim />}
                    {r.free > 0 && <span className="ml-1 text-[11px] text-ok font-sans">({r.free} {en ? 'free' : '무료'})</span>}
                  </td>
                  <td className="c num">{r.used || <Dim />}</td>
                  <td className="c">
                    {r.bought || r.used ? (
                      <span
                        className={`num inline-grid place-items-center min-w-7 h-5 px-1.5 rounded-full text-[12px] font-semibold ${
                          r.left <= 0 ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'
                        }`}
                      >
                        {Math.max(r.left, 0)}
                      </span>
                    ) : (
                      <Dim />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
          {stockPages > 1 && <Pager page={stockCur} pages={stockPages} total={tabStock.length} size={stockFit} onPage={setStockPage} en={en} unitLabel={tab === 'room' ? (en ? 'room types' : '객실 타입') : en ? 'items' : '항목'} />}
        </div>

        {/* purchases */}
        <div className="card overflow-hidden 2xl:col-span-2 flex flex-col">
          <div className="card-head !py-3">
            <div>
              <h3 className="card-title">{tab === 'room' ? (en ? 'Room purchases' : '객실 구매 내역') : en ? 'Voucher purchases' : '바우처 구매 내역'}</h3>
              <p className="text-[12.5px] text-muted mt-0.5">
                {en ? 'Each purchase is billed to Jupiter in the month of its date (Dashboard).' : '구매일이 속한 월에 정산됩니다 (대시보드).'}
              </p>
            </div>
          </div>
          <div ref={listRef} className="flex-1 relative min-h-[160px]">
          <div className="absolute inset-0 overflow-hidden">
          <table className="dtable compact">
            <thead>
              <tr>
                <th>{en ? 'Date' : '날짜'}</th>
                <th>{en ? 'Items' : '항목'}</th>
                <th className="r">{en ? 'Cost' : '금액'}</th>
                <th className="w-[44px]" />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={4} className="!py-14 text-center text-muted">
                    {tab === 'room'
                      ? en
                        ? 'No room purchases yet. Click "New Purchase" to add what Jupiter bought from the hotel.'
                        : '객실 구매 내역이 없습니다. "새 구매"를 눌러 추가하세요.'
                      : en
                      ? 'No voucher purchases yet. Click "New Purchase" to add them.'
                      : '바우처 구매 내역이 없습니다. "새 구매"를 눌러 추가하세요.'}
                  </td>
                </tr>
              )}
              {pageRows.map(({ p, lines }) => (
                <tr key={p.id} data-row onClick={() => setEditing(p)} className="cursor-pointer">
                  <td className="whitespace-nowrap">
                    <div className="text-ink">{formatLongDate(p.date)}</div>
                    {p.reference && <div className="text-[11.5px] text-muted">{p.reference}</div>}
                    {p.id.startsWith('buy-') && <div className="text-[11.5px] text-accent">{p.remarks || (en ? 'With a booking' : '예약과 함께')}</div>}
                  </td>
                  <td className="text-[12.5px] text-ink-2">
                    {lines.map((i) => (
                      <div key={i.id}>
                        {itemLabel(i, casinoRates, en)} <span className="text-muted num">× {i.qty}</span>
                        {!i.unitCost && <span className="badge badge-ok ml-1.5 !h-[18px] !text-[10.5px]">{en ? 'Free' : '무료'}</span>}
                      </div>
                    ))}
                  </td>
                  <td className="r num font-semibold text-ink whitespace-nowrap">{peso(lines.reduce((a, i) => a + i.qty * i.unitCost, 0))}</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      title={en ? 'Actions' : '작업'}
                      items={[
                        { label: en ? 'Edit' : '수정', Icon: Pencil, onClick: () => setEditing(p) },
                        { label: en ? 'Delete' : '삭제', Icon: Trash2, onClick: () => setDeleting(p), danger: true },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
          {pages > 1 && <Pager page={cur} pages={pages} total={list.length} size={size} onPage={setPage} en={en} unitLabel={en ? 'purchases' : '건'} />}
        </div>
      </div>

      {editing && (
        <PurchaseDialog
          en={en}
          initial={editing === 'new' ? null : editing}
          defaultKind={tab}
          rates={casinoRates}
          onCancel={() => setEditing(null)}
          onSave={(p) => {
            const isNew = editing === 'new';
            setPurchases((prev) => (isNew ? [...prev, p] : prev.map((x) => (x.id === p.id ? p : x))));
            setEditing(null);
            toast(isNew ? (en ? 'Purchase saved' : '구매 저장됨') : en ? 'Purchase updated' : '구매 수정됨', `${formatMonth(p.date.slice(0, 7))} · ${peso(purchaseTotal(p))}`);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          danger
          title={en ? 'Delete this purchase?' : '이 구매를 삭제하시겠습니까?'}
          message={
            <>
              <b className="text-ink">{formatLongDate(deleting.date)}</b> · {peso(purchaseTotal(deleting))}
              <div className="mt-2 text-muted">
                {en ? 'Its rooms / vouchers and its cost on the hotel bill for that month are removed.' : '해당 객실·바우처와 그 달 호텔 청구액에서 제외됩니다.'}
              </div>
            </>
          }
          confirmLabel={en ? 'Delete' : '삭제'}
          cancelLabel={en ? 'Cancel' : '취소'}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            setPurchases((prev) => prev.filter((x) => x.id !== deleting.id));
            toast(en ? 'Purchase deleted' : '구매 삭제됨', `${formatLongDate(deleting.date)} · ${peso(purchaseTotal(deleting))}`, 'bad');
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
};

const Dim: React.FC = () => <span className="text-faint/70">·</span>;

const TONES = {
  info: { card: '!bg-info-soft !border-info-line', icon: 'bg-surface text-info', value: 'text-info' },
  warn: { card: '!bg-warn-soft !border-warn-line', icon: 'bg-surface text-warn', value: 'text-warn' },
  ok: { card: '!bg-ok-soft !border-ok-line', icon: 'bg-surface text-ok', value: 'text-ok' },
  bad: { card: '!bg-bad-soft !border-bad-line', icon: 'bg-surface text-bad', value: 'text-bad' },
  neutral: { card: '', icon: 'bg-ink/10 text-ink', value: 'text-ink' },
} as const;

const Card: React.FC<{ Icon: React.ElementType; tone: keyof typeof TONES; label: string; value: string; hint: string }> = ({ Icon, tone, label, value, hint }) => (
  <div className={`card px-3.5 py-2.5 flex items-center gap-3 ${TONES[tone].card}`}>
    <span className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${TONES[tone].icon}`}>
      <Icon className="w-4 h-4" />
    </span>
    <div className="min-w-0 flex-1 leading-tight">
      <div className="text-[12px] text-ink-2 truncate">{label}</div>
      <div className="text-[11px] text-muted truncate">{hint}</div>
    </div>
    <div className={`num text-[17px] font-semibold whitespace-nowrap ${TONES[tone].value}`}>{value}</div>
  </div>
);

/** Lines with the same item and unit cost become one line (qty added). */
const mergeLines = (lines: PurchaseItem[]) =>
  lines.reduce<PurchaseItem[]>((acc, l) => {
    const same = acc.find((x) => x.kind === l.kind && x.item === l.item && x.unitCost === l.unitCost);
    if (same) same.qty += l.qty;
    else acc.push({ ...l });
    return acc;
  }, []);

/** Add / edit one purchase: date, hotel reference, and lines of item × qty × wholesale cost. */
const PurchaseDialog: React.FC<{
  en: boolean;
  initial: HotelPurchase | null;
  rates: CasinoRatesConfig;
  /** the tab it was opened from: the first line starts as a room or a voucher */
  defaultKind: 'room' | 'voucher';
  onCancel: () => void;
  onSave: (p: HotelPurchase) => void;
}> = ({ en, initial, rates, defaultKind, onCancel, onSave }) => {
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [reference, setReference] = useState(initial?.reference ?? '');
  const [remarks, setRemarks] = useState(initial?.remarks ?? '');
  // a purchase is either rooms or vouchers (toggle at the top, same as New Booking)
  const [kind, setKind] = useState<'room' | 'voucher'>(initial?.items[0]?.kind ?? defaultKind);
  const optionsOf = (k: 'room' | 'voucher') =>
    k === 'room'
      ? rates.rooms.map((r) => ({ value: `room:${r.id}`, label: r.name }))
      : VOUCHER_ITEMS.map((v) => ({ value: `voucher:${v}`, label: voucherItemLabel(v, en) }));
  const options = optionsOf(kind);
  const newLine = (value = options[0]?.value ?? 'voucher:breakfast'): PurchaseItem => {
    const [kind, item] = value.split(':') as ['room' | 'voucher', string];
    return { id: uid(), kind, item, qty: 1, unitCost: 0 }; // no default cost — typed each time
  };
  const [items, setItems] = useState<PurchaseItem[]>(initial?.items.map((i) => ({ ...i })) ?? [newLine()]);
  const switchKind = (k: 'room' | 'voucher') => {
    if (k === kind) return;
    setKind(k);
    const first = optionsOf(k)[0]?.value ?? 'voucher:breakfast';
    const [ik, item] = first.split(':') as ['room' | 'voucher', string];
    setItems([{ id: uid(), kind: ik, item, qty: 1, unitCost: 0 }]); // lines of the other kind are cleared
    setFreeIds(new Set());
  };
  // lines given free by the hotel (e.g. 20 complimentary rooms): cost ₱0, still added to stock
  const [freeIds, setFreeIds] = useState<Set<string>>(() => new Set((initial?.items || []).filter((i) => !i.unitCost).map((i) => i.id)));
  const toggleFree = (i: PurchaseItem) => {
    const wasFree = freeIds.has(i.id);
    setFreeIds((prev) => {
      const next = new Set(prev);
      if (wasFree) next.delete(i.id);
      else next.add(i.id);
      return next;
    });
  };
  const costOf = (i: PurchaseItem) => (freeIds.has(i.id) ? 0 : i.unitCost);
  // one line per item: picking an item that is already listed (same Free setting) adds this qty to that line
  const pickItem = (line: PurchaseItem, value: string) => {
    const [kind, item] = value.split(':') as ['room' | 'voucher', string];
    const same = items.find((x) => x.id !== line.id && x.kind === kind && x.item === item && freeIds.has(x.id) === freeIds.has(line.id));
    if (same) {
      setItems((prev) => prev.filter((x) => x.id !== line.id).map((x) => (x.id === same.id ? { ...x, qty: x.qty + line.qty } : x)));
      toast(en ? 'Merged with the same item' : '같은 항목에 합쳐짐', `${itemLabel({ kind, item }, rates, en)} × ${same.qty + line.qty}`, 'info');
      return;
    }
    set(line.id, { kind, item });
  };
  // "Add line" starts with an item that is not listed yet
  const addLine = () => {
    const used = new Set(items.map((x) => `${x.kind}:${x.item}`));
    setItems((prev) => [...prev, newLine(options.find((o) => !used.has(o.value))?.value)]);
  };
  const set = (id: string, patch: Partial<PurchaseItem>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const total = items.reduce((a, i) => a + i.qty * costOf(i), 0);
  // every line needs a cost (or Free): an empty cost is not saved as ₱0 by mistake
  const valid = date && items.length > 0 && items.every((i) => i.qty > 0 && (freeIds.has(i.id) || i.unitCost > 0));
  const num = (v: string) => parseInt(v.replace(/\D/g, ''), 10) || 0;

  return (
    <Dialog
      title={initial ? (en ? 'Edit purchase' : '구매 수정') : en ? 'New purchase from hotel' : '새 호텔 구매'}
      subtitle={en ? `Billed to Jupiter in ${date ? formatMonth(date.slice(0, 7)) : '—'}` : `${date ? formatMonth(date.slice(0, 7)) : '—'} 정산`}
      onClose={onCancel}
      width="max-w-2xl"
    >
      <div className="px-6 pt-4">
        <div className="seg w-full">
          <button type="button" data-active={kind === 'room'} onClick={() => switchKind('room')} className="flex-1">
            {en ? 'Rooms' : '객실'}
          </button>
          <button type="button" data-active={kind === 'voucher'} onClick={() => switchKind('voucher')} className="flex-1">
            {en ? 'Vouchers' : '바우처'}
          </button>
        </div>
      </div>
      <div className="px-6 py-5 grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">{en ? 'Purchase date' : '구매일'}</label>
            <input id="purchase-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="field-label">{en ? 'Hotel reference / invoice no.' : '호텔 참조 / 송장 번호'}</label>
            <input id="purchase-ref" autoComplete="off" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={en ? 'Optional' : '선택'} className="input" />
          </div>
        </div>

        <div>
          <label className="field-label">{en ? 'Items' : '항목'}</label>
          <div className="rounded-xl border border-line overflow-hidden">
            <table className="dtable compact">
              <thead>
                <tr>
                  <th>{kind === 'room' ? (en ? 'Room type' : '객실 타입') : en ? 'Voucher' : '바우처'}</th>
                  <th className="c w-[90px]">{en ? 'Qty' : '수량'}</th>
                  <th className="c w-[60px]">{en ? 'Free' : '무료'}</th>
                  <th className="r w-[130px]">{en ? 'Unit cost' : '단가'}</th>
                  <th className="r w-[110px]">{en ? 'Amount' : '금액'}</th>
                  <th className="w-[40px]" />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Select
                        value={`${i.kind}:${i.item}`}
                        onChange={(e) => pickItem(i, e.target.value)}
                        className="input input-sm"
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="c">
                      <input inputMode="numeric" autoComplete="off" value={i.qty || ''} onChange={(e) => set(i.id, { qty: num(e.target.value) })} className="input input-sm num text-center" />
                    </td>
                    <td className="c">
                      <FreeCheck checked={freeIds.has(i.id)} onChange={() => toggleFree(i)} en={en} />
                    </td>
                    <td className="r">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-faint">₱</span>
                        <input
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder={en ? 'Required' : '필수'}
                          value={freeIds.has(i.id) ? '0' : i.unitCost ? i.unitCost.toLocaleString('en-US') : ''}
                          disabled={freeIds.has(i.id)}
                          onChange={(e) => set(i.id, { unitCost: num(e.target.value) })}
                          className="input input-sm num text-right pl-6 disabled:opacity-50"
                        />
                      </div>
                    </td>
                    <td className="r num font-medium text-ink whitespace-nowrap">{freeIds.has(i.id) ? <span className="text-ok">{en ? 'Free' : '무료'}</span> : peso(i.qty * i.unitCost)}</td>
                    <td className="r">
                      <button onClick={() => setItems((prev) => prev.filter((x) => x.id !== i.id))} className="icon-btn hover:!text-bad" title={en ? 'Remove line' : '삭제'}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    <button onClick={addLine} className="btn btn-outline btn-sm">
                      <Plus className="w-3.5 h-3.5" />
                      {en ? 'Add line' : '항목 추가'}
                    </button>
                  </td>
                  <td className="r num font-semibold text-ink">{peso(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="text-[11.5px] text-muted mt-1.5">
            {kind === 'room'
              ? en
                ? 'Qty = room-nights of that room type (any date). Unit cost = the wholesale price per night. Tick Free for rooms the hotel gives for free: they are added at ₱0.'
                : '수량 = 해당 객실 타입의 박 수 (날짜 무관). 단가 = 1박 도매가. 호텔이 무료로 준 객실은 무료를 체크하세요 (₱0로 추가).'
              : en
              ? 'Unit cost = the wholesale price per voucher. Tick Free for vouchers the hotel gives for free: they are added at ₱0.'
              : '단가 = 바우처 1장 도매가. 호텔이 무료로 준 바우처는 무료를 체크하세요 (₱0로 추가).'}
          </div>
        </div>

        <div>
          <label className="field-label">{en ? 'Remarks' : '비고'}</label>
          <input id="purchase-remarks" autoComplete="off" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="input" />
        </div>
      </div>
      <div className="px-6 py-4 border-t border-line bg-sunken flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted">
          {en ? 'Total' : '합계'} <b className="num text-ink text-[15px]">{peso(total)}</b>
        </span>
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn btn-ghost">
            {en ? 'Cancel' : '취소'}
          </button>
          <button
            onClick={() =>
              valid &&
              onSave({ id: initial?.id ?? `pur-${Date.now()}-${uid().slice(0, 4)}`, date, reference: reference.trim(), remarks: remarks.trim(), items: mergeLines(items.filter((i) => i.qty > 0).map((i) => ({ ...i, unitCost: costOf(i) }))) })
            }
            disabled={!valid}
            className="btn btn-primary"
          >
            {en ? 'Save purchase' : '저장'}
          </button>
        </div>
      </div>
    </Dialog>
  );
};
