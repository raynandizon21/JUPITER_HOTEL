import { FolioPayment, PaymentMethod, Reservation, Settlement, VoucherSale, FolioCharge } from '../types/hotel';

export const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'Bank Transfer', 'GCash', 'Credit Card', 'Junket Account'];

export const uid = () => Math.random().toString(36).slice(2, 10);
/** Local date-time 'YYYY-MM-DD HH:MM:SS' — when a payment is recorded (FolioPayment.recordedAt). */
export const nowStamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export type BillStatus = 'paid' | 'partial' | 'unpaid';

/** Amount of one charge line — ₱0 when it is complimentary (free). */
export const chargeAmount = (c: FolioCharge) => (c.free ? 0 : c.qty * c.unitPrice);

/** Guest folio totals: room charge (reservation.amount) + extra charges − payments. */
export function folioOf(r: Reservation) {
  const extras = (r.charges || []).reduce((a, c) => a + chargeAmount(c), 0);
  const total = r.amount + extras;
  const paid = (r.payments || []).reduce((a, p) => a + p.amount, 0);
  const balance = total - paid;
  const status: BillStatus = balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { room: r.amount, extras, total, paid, balance, status };
}

/** Totals for a voucher-only purchase (same shape as folioOf, without a room charge). */
export function voucherTotals(v: VoucherSale) {
  const total = v.items.reduce((a, c) => a + chargeAmount(c), 0);
  const paid = v.payments.reduce((a, p) => a + p.amount, 0);
  const balance = total - paid;
  const status: BillStatus = balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { total, paid, balance, status, qty: v.items.reduce((a, c) => a + c.qty, 0) };
}

/** Keep the legacy paymentStatus field in step with the folio balance. */
export function syncStatus(r: Reservation): Reservation {
  return { ...r, paymentStatus: folioOf(r).balance <= 0 ? '결제완료' : '미결제' };
}

/**
 * Older saved bookings only had a Paid/Unpaid flag. Turn "Paid" into one full
 * payment so the folio balance matches what the user saw before.
 */
export function migrateReservation(r: Reservation): Reservation {
  if (r.payments) return r;
  const payments: FolioPayment[] =
    r.paymentStatus === '결제완료'
      ? [{ id: uid(), date: r.checkIn, amount: r.amount, method: 'Cash', reference: 'Opening balance' }]
      : [];
  return { ...r, charges: r.charges || [], payments };
}

export function settlementOf(settlements: Settlement[], month: string) {
  const s = settlements.find((x) => x.month === month);
  const payments = s?.payments || [];
  return { payments, paid: payments.reduce((a, p) => a + p.amount, 0) };
}

export const peso = (n: number) => '₱' + Math.round(n).toLocaleString('en-US');

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
export { esc as escapeHtml };

/**
 * Prints a simple document (folio / statement) from a hidden iframe in the same tab.
 * (A separate pop-up window could end up behind the app with its print dialog open,
 * which froze the app tab.)
 */
export function printDocument(title: string, bodyHtml: string) {
  document.getElementById('print-frame')?.remove();
  const frame = document.createElement('iframe');
  frame.id = 'print-frame';
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  *{box-sizing:border-box} body{font-family:'Segoe UI',system-ui,sans-serif;color:#111214;margin:40px;font-size:12.5px}
  h1{font-size:20px;margin:0} h2{font-size:13px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.06em;color:#34363c}
  .muted{color:#6b6e76} .row{display:flex;justify-content:space-between;gap:24px}
  table{width:100%;border-collapse:collapse;margin-top:4px} th,td{padding:7px 8px;border-bottom:1px solid #e3e4e8;text-align:left}
  th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#34363c;background:#f5f6f8}
  td.r,th.r{text-align:right} tfoot td{font-weight:700;border-top:2px solid #111214;border-bottom:0}
  .totals{margin-left:auto;width:320px;margin-top:14px} .totals div{display:flex;justify-content:space-between;padding:4px 0}
  .totals .grand{border-top:2px solid #111214;margin-top:6px;padding-top:8px;font-size:15px;font-weight:700}
  .sign{display:flex;gap:60px;margin-top:60px} .sign div{flex:1;border-top:1px solid #111214;padding-top:6px;text-align:center}
  @media print{body{margin:16mm}}
</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  // Give the frame a moment to lay out, then open the print dialog over the app.
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  }, 150);
}
