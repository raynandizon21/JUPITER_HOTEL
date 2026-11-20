import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, FileText } from 'lucide-react';
import { CasinoRatesConfig, HotelPurchase } from '../types/hotel';
import { formatLongDate, formatMonth, getDayCategory, getDaysInMonth } from '../utils/hotelHelpers';
import { peso, todayISO } from '../utils/billing';
import { itemLabel } from '../utils/inventory';
import { Language } from '../i18n/translations';
import { Dialog, MonthSelect, MONTHS, PageHeader, toast } from './ui';

/** One bought line on one day: item × unit cost (same item + same cost on the same day are added up). */
type BillLine = { kind: 'room' | 'voucher'; item: string; unitCost: number; qty: number; amt: number };
type DayBill = { date: string; lines: BillLine[]; roomN: number; pax: number; total: number };

/**
 * The hotel's bill to Jupiter, day by day = the Hotel Purchases dated that day (wholesale unit cost × qty),
 * so the month adds up to the Hotel Bill on the Dashboard.
 */
function buildBill(month: string, purchases: HotelPurchase[]): DayBill[] {
  const days = new Map<string, DayBill>(getDaysInMonth(month).map((date) => [date, { date, lines: [], roomN: 0, pax: 0, total: 0 }]));
  for (const p of purchases) {
    const d = days.get(p.date);
    if (!d) continue;
    for (const i of p.items) {
      if (!(i.qty > 0)) continue;
      const amt = i.qty * i.unitCost;
      const same = d.lines.find((l) => l.kind === i.kind && l.item === i.item && l.unitCost === i.unitCost);
      if (same) {
        same.qty += i.qty;
        same.amt += amt;
      } else d.lines.push({ kind: i.kind, item: i.item, unitCost: i.unitCost, qty: i.qty, amt });
      if (i.kind === 'room') d.roomN += i.qty;
      else d.pax += i.qty;
      d.total += amt;
    }
  }
  return [...days.values()];
}

const weekday = (date: string, en: boolean) =>
  new Date(date + 'T00:00:00Z').toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'long', timeZone: 'UTC' });

export const HotelBillingReport: React.FC<{
  purchases: HotelPurchase[];
  casinoRates: CasinoRatesConfig;
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
  language: Language;
}> = ({ purchases, casinoRates, selectedMonth, setSelectedMonth, language }) => {
  const en = language === 'en';
  const month = selectedMonth;
  const months = useMemo(() => {
    const s = new Set(MONTHS);
    purchases.forEach((p) => s.add(p.date.slice(0, 7)));
    s.add(month);
    return [...s].sort();
  }, [purchases, month]);
  const bill = useMonthBill(month, purchases);
  const roomNights = bill.reduce((a, d) => a + d.roomN, 0);
  const pax = bill.reduce((a, d) => a + d.pax, 0);
  const last = bill[bill.length - 1]?.date;

  return (
    <div className="flex-1 flex flex-col">
      <PageHeader
        title={en ? 'Hotel Billing Report' : '호텔 청구 보고서'}
        lede={
          en
            ? 'Hotel Purchases day by day (what Jupiter bought from the hotel, wholesale). Click a day for its breakdown.'
            : '호텔 구매 일별 내역 (도매가). 날짜를 누르면 상세 내역이 보입니다.'
        }
        actions={
          <>
            <MonthSelect value={month} onChange={setSelectedMonth} months={months} />
            <button onClick={() => excelMonth(month, bill, casinoRates, en)} className="btn btn-ghost">
              <FileSpreadsheet className="w-4 h-4" />
              Excel
            </button>
            <button onClick={() => runPdf(() => pdfMonth(month, bill, casinoRates, en), en)} className="btn btn-ghost" title={en ? 'Download as .pdf' : 'PDF 다운로드'}>
              <FileDown className="w-4 h-4" />
              PDF
            </button>
          </>
        }
      />

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex flex-wrap items-center gap-x-6 gap-y-1 text-[12.5px]">
          <span className="inline-flex items-center gap-2 font-semibold text-ink">
            <FileText className="w-4 h-4 text-accent" />
            {en ? 'Bill to: Jupiter' : '청구 대상: 주피터'}
          </span>
          <span className="text-muted">
            {en ? 'Booking date' : '예약 기간'}: <span className="text-ink-2">{last ? `${formatMonth(month).split(' ')[0]} 1 - ${Number(last.slice(8))}, ${month.slice(0, 4)}` : '—'}</span>
          </span>
          <span className="text-muted ml-auto">
            {en ? 'Room-nights bought' : '구매 객실 박수'} <b className="num text-ink">{roomNights}</b> · {en ? 'Vouchers bought' : '구매 바우처'} <b className="num text-ink">{pax}</b>
          </span>
        </div>
        <DailyBillList month={month} bill={bill} rates={casinoRates} en={en} />
      </div>
    </div>
  );
};

/** The hotel's bill for a month, from Hotel Purchases (memoised). */
export const useMonthBill = (month: string, purchases: HotelPurchase[]) => useMemo(() => buildBill(month, purchases), [month, purchases]);

/**
 * Every day of the month (two halves side by side, so it fits) with rooms / vouchers / amount bought and the
 * month total bar; clicking a day opens its breakdown in the hotel's sheet format.
 * Used by the Hotel Billing Report page and the Dashboard's Hotel Bill pop-up (Every day tab).
 */
export const DailyBillList: React.FC<{ month: string; bill: DayBill[]; rates: CasinoRatesConfig; en: boolean }> = ({ month, bill, rates, en }) => {
  const [open, setOpen] = useState<string | null>(null);
  const day = open ? bill.find((d) => d.date === open) : undefined;
  const last = bill[bill.length - 1]?.date;
  const total = bill.reduce((a, d) => a + d.total, 0);
  const half = Math.ceil(bill.length / 2);
  const DayTable = ({ rows }: { rows: DayBill[] }) => (
    <table className="dtable compact">
      <thead>
        <tr>
          <th>{en ? 'Date' : '날짜'}</th>
          <th className="c">{en ? 'Rooms' : '객실'}</th>
          <th className="c">{en ? 'Vouchers' : '바우처'}</th>
          <th className="r">{en ? 'Amount' : '금액'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d) => {
          const has = d.lines.length > 0;
          const wk = getDayCategory(d.date) === 'weekend';
          return (
            <tr key={d.date} onClick={() => setOpen(d.date)} className="cursor-pointer">
              <td className="whitespace-nowrap">
                <span className={`inline-block w-[34px] text-[11.5px] ${wk ? 'text-warn font-semibold' : 'text-muted'}`}>{weekday(d.date, en).slice(0, 3)}</span>
                <span className={has ? 'text-ink' : 'text-muted'}>{formatLongDate(d.date)}</span>
              </td>
              <td className="c num">{d.roomN ? d.roomN : <span className="text-faint">-</span>}</td>
              <td className="c num">{d.pax ? d.pax : <span className="text-faint">-</span>}</td>
              <td className="r num">{d.total ? <b className="text-ink">{peso(d.total)}</b> : has ? <span className="text-ok">{en ? 'Free' : '무료'}</span> : <span className="text-faint">-</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
  return (
    <>
      <div className="grid lg:grid-cols-2 lg:divide-x divide-line">
        <DayTable rows={bill.slice(0, half)} />
        <DayTable rows={bill.slice(half)} />
      </div>
      <div className="px-5 py-3 border-t border-line bg-ink text-white flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#e9c46a]">
          {en ? `Total bill for ${formatMonth(month).split(' ')[0]}` : `${formatMonth(month)} 총 청구액`}
        </span>
        <span className="num text-[16px] font-bold text-[#e9c46a]">{peso(total)}</span>
      </div>
      {day && (
        <DayBreakdown
          day={day}
          rates={rates}
          en={en}
          onClose={() => setOpen(null)}
          onPrev={bill[0].date < day.date ? () => setOpen(bill[bill.indexOf(day) - 1].date) : undefined}
          onNext={day.date < (last || '') ? () => setOpen(bill[bill.indexOf(day) + 1].date) : undefined}
        />
      )}
    </>
  );
};

const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type SheetRow = { name: string; rate: number; qty: number; amt: number };
type Section = { title: string; rateHead: string; qtyHead: string; rows: SheetRow[] };

/** A day's sheet sections (hotel format): rooms and vouchers bought that day, unit cost × qty = sub-total. */
function daySections(day: DayBill, rates: CasinoRatesConfig, en: boolean): Section[] {
  const order = (l: BillLine) => (l.kind === 'room' ? rates.rooms.findIndex((r) => r.id === l.item) : ['breakfast', 'dinner', 'extraBed'].indexOf(l.item));
  const rowsOf = (kind: 'room' | 'voucher') =>
    day.lines
      .filter((l) => l.kind === kind)
      .sort((x, y) => order(x) - order(y) || y.unitCost - x.unitCost)
      .map((l) => ({ name: itemLabel(l, rates, en), rate: l.unitCost, qty: l.qty, amt: l.amt }));
  const sections: Section[] = [
    { title: en ? 'Room Category' : '객실 종류', rateHead: en ? 'Unit Cost' : '단가', qtyHead: en ? 'No. of Rooms' : '객실 수', rows: rowsOf('room') },
    { title: en ? 'Voucher Category' : '바우처 종류', rateHead: en ? 'Unit Cost' : '단가', qtyHead: en ? 'No. of Pax' : '수량', rows: rowsOf('voucher') },
  ];
  return sections.filter((sec) => sec.rows.length > 0);
}

const dayTitle = (date: string, en: boolean) => `${weekday(date, en)}, ${formatLongDate(date)}`;
const monthName = (month: string) => formatMonth(month).split(' ')[0];

// ---------- PDF (downloaded .pdf file: each block is drawn with html2canvas and placed on A4 pages)
// scoped to .pdfdoc so the hidden render does not touch the app's own styles
const PDF_CSS = `<style>
  .pdfdoc{font-family:'Segoe UI',system-ui,sans-serif;color:#111214;font-size:12.5px;line-height:1.35}
  .pdfdoc h1{font-size:20px;margin:0} .pdfdoc h2{font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em;color:#34363c}
  .pdfdoc .muted{color:#6b6e76} .pdfdoc .row{display:flex;justify-content:space-between;gap:24px}
  .pdfdoc .sheet{border-collapse:collapse;width:100%} .pdfdoc .sheet td{border:1px solid #000000;padding:4px 8px;font-size:11.5px}
  .pdfdoc .sheet .h td{background:#3b4452;color:#e9c46a;font-weight:600;text-align:center} .pdfdoc .sheet .h td:first-child{text-align:left}
  .pdfdoc .r{text-align:right} .pdfdoc .c{text-align:center} .pdfdoc .peso{display:flex;justify-content:space-between}
  .pdfdoc .bar td{background:#111214;color:#e9c46a;font-weight:700}
  .pdfdoc .sign{display:flex;gap:60px;margin-top:50px} .pdfdoc .sign div{flex:1;border-top:1px solid #111214;padding-top:6px;text-align:center}
</style>`;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function dayHtml(day: DayBill, rates: CasinoRatesConfig, en: boolean) {
  const secs = daySections(day, rates, en);
  if (!secs.length) return '';
  const span = secs.reduce((a, s) => a + s.rows.length + 1, 0) - 1;
  let first = true;
  const body = secs
    .map((sec, si) => {
      const head = `<tr class="h"><td>${esc(sec.title)}</td><td>${esc(sec.rateHead)}</td><td>${esc(sec.qtyHead)}</td><td>${en ? 'Sub-total' : '소계'}</td>${si === 0 ? `<td>${en ? 'Daily Total' : '일일 합계'}</td>` : ''}</tr>`;
      const rows = sec.rows
        .map((r) => {
          const total = first
            ? `<td rowspan="${span}" style="vertical-align:middle;width:20%"><div class="peso" style="font-size:14px;font-weight:700"><span>₱</span><span>${money(day.total)}</span></div></td>`
            : '';
          first = false;
          return `<tr><td>${esc(r.name)}</td><td class="r">₱${money(r.rate)}</td><td class="c">${r.qty}</td><td><div class="peso"><span>₱</span><span>${money(r.amt)}</span></div></td>${total}</tr>`;
        })
        .join('');
      return head + rows;
    })
    .join('');
  return `<h2>${esc(dayTitle(day.date, en))}</h2><table class="sheet">${body}</table>`;
}

function headerHtml(month: string, last: string, en: boolean, title: string) {
  return `<div class="row"><div><h1>${title}</h1><div class="muted">${en ? 'Bill To: Jupiter' : '청구 대상: 주피터'}</div></div>
  <div class="muted" style="text-align:right">${en ? 'Booking Date' : '예약 기간'}: ${monthName(month)} 1 - ${Number(last.slice(8))}, ${month.slice(0, 4)}<br>${en ? 'Date' : '작성일'}: ${formatLongDate(todayISO())}</div></div>`;
}

/** Builds the .pdf with a toast while it works (it takes a second or two). */
function runPdf(make: () => Promise<void>, en: boolean) {
  toast(en ? 'Making the PDF…' : 'PDF 생성 중…', undefined, 'info');
  make()
    .then(() => toast(en ? 'PDF downloaded' : 'PDF 다운로드됨'))
    .catch(() => toast(en ? 'Could not make the PDF' : 'PDF 생성 실패', undefined, 'bad'));
}

/** Draws each HTML block and saves them as one A4 .pdf (a block that does not fit goes to the next page). */
async function savePdf(fileName: string, blocks: string[]) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas-pro')]);
  const host = document.createElement('div');
  host.className = 'pdfdoc';
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '760px', background: '#ffffff' });
  host.innerHTML = PDF_CSS + blocks.map((b) => `<div class="blk" style="padding:2px 0 14px">${b}</div>`).join('');
  document.body.appendChild(host);
  try {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const m = 36;
    const w = pw - m * 2;
    let y = m;
    for (const el of Array.from(host.querySelectorAll<HTMLElement>('.blk'))) {
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
      const h = (canvas.height * w) / canvas.width;
      if (y + h > ph - m && y > m) {
        pdf.addPage();
        y = m;
      }
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', m, y, w, h);
      y += h;
    }
    pdf.save(fileName);
  } finally {
    host.remove();
  }
}

async function pdfMonth(month: string, bill: DayBill[], rates: CasinoRatesConfig, en: boolean) {
  const total = bill.reduce((a, d) => a + d.total, 0);
  const last = bill[bill.length - 1]?.date || `${month}-01`;
  const list = bill
    .map((d) => `<tr><td class="r">${esc(dayTitle(d.date, true))}</td><td><div class="peso"><span>₱</span><span>${d.total ? money(d.total) : '-'}</span></div></td></tr>`)
    .join('');
  const summary = `${headerHtml(month, last, en, en ? 'Monthly Billing Report' : '월간 청구 보고서')}
  <table class="sheet" style="margin-top:14px"><tr class="h"><td style="text-align:center">${en ? 'Date' : '날짜'}</td><td>${en ? 'Amount' : '금액'}</td></tr>${list}
  <tr class="bar"><td>${en ? `Total bill for ${monthName(month)}` : `${formatMonth(month)} 총 청구액`}</td><td><div class="peso"><span>₱</span><span>${money(total)}</span></div></td></tr></table>
  <div class="sign"><div>${en ? 'Payment made by' : '지급자'}</div><div>${en ? 'Payment received by' : '수령자'}</div></div>`;
  const days = bill.map((d) => dayHtml(d, rates, en)).filter(Boolean);
  await savePdf(`Hotel_Billing_Report_${month}.pdf`, [summary, ...days]);
}

async function pdfDay(day: DayBill, rates: CasinoRatesConfig, en: boolean) {
  const head = `<h1>${en ? 'Daily Billing' : '일일 청구'}</h1><div class="muted">${en ? 'Bill To: Jupiter' : '청구 대상: 주피터'}</div>`;
  await savePdf(`Hotel_Billing_${day.date}.pdf`, [head, dayHtml(day, rates, en) || `<p class="muted">${en ? 'Nothing bought from the hotel on this day.' : '구매 없음'}</p>`]);
}

// ---------- Excel
async function sheetBook() {
  const ExcelJS = (await import('exceljs')).default;
  return new ExcelJS.Workbook();
}
const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF3B4452' } };
const PESO = '"₱"#,##0.00;-"₱"#,##0.00;"₱"  -';
const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

/** Writes one day's sheet block at `row`; returns the next free row. */
function writeDay(ws: import('exceljs').Worksheet, row: number, day: DayBill, rates: CasinoRatesConfig, en: boolean) {
  const secs = daySections(day, rates, en);
  ws.getCell(row, 1).value = dayTitle(day.date, en);
  ws.getCell(row, 1).font = { bold: true, size: 12 };
  row++;
  if (!secs.length) {
    ws.getCell(row, 1).value = en ? 'Nothing bought from the hotel on this day.' : '구매 없음';
    return row + 2;
  }
  const start = row;
  secs.forEach((sec, si) => {
    const h = ws.getRow(row);
    h.values = [sec.title, sec.rateHead, sec.qtyHead, en ? 'Sub-total' : '소계', ...(si === 0 ? [en ? 'Daily Total' : '일일 합계'] : [])];
    for (let c = 1; c <= (si === 0 ? 5 : 4); c++) {
      const cell = h.getCell(c);
      cell.fill = HEAD_FILL;
      cell.font = { bold: true, color: { argb: 'FFE9C46A' } };
      cell.alignment = { horizontal: c === 1 ? 'left' : 'center' };
      cell.border = box;
    }
    row++;
    sec.rows.forEach((r) => {
      const x = ws.getRow(row);
      x.values = [r.name, r.rate, r.qty, r.amt];
      x.getCell(2).numFmt = PESO;
      x.getCell(3).alignment = { horizontal: 'center' };
      x.getCell(4).numFmt = PESO;
      for (let c = 1; c <= 4; c++) x.getCell(c).border = box;
      row++;
    });
  });
  // Daily Total: one merged cell down the right, like the hotel's sheet
  if (row - 1 > start + 1) ws.mergeCells(start + 1, 5, row - 1, 5);
  const t = ws.getCell(start + 1, 5);
  t.value = day.total;
  t.numFmt = PESO;
  t.font = { bold: true, size: 12 };
  t.alignment = { vertical: 'middle', horizontal: 'right' };
  t.border = box;
  return row + 1;
}

async function download(wb: import('exceljs').Workbook, name: string) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function excelMonth(month: string, bill: DayBill[], rates: CasinoRatesConfig, en: boolean) {
  const wb = await sheetBook();
  const ws = wb.addWorksheet(en ? 'Monthly Billing Report' : '월간 청구');
  ws.columns = [{ width: 34 }, { width: 22 }];
  ws.addRow([en ? 'Monthly Billing Report' : '월간 청구 보고서']).font = { bold: true, size: 14 };
  const last = bill[bill.length - 1]?.date || `${month}-01`;
  ws.addRow([`${en ? 'Bill To: Jupiter' : '청구 대상: 주피터'}`, `${en ? 'Date' : '작성일'}: ${formatLongDate(todayISO())}`]);
  ws.addRow([`${en ? 'Booking Date' : '예약 기간'}: ${monthName(month)} 1 - ${Number(last.slice(8))}, ${month.slice(0, 4)}`]);
  ws.addRow([]);
  const h = ws.addRow([en ? 'Date' : '날짜', en ? 'Amount' : '금액']);
  h.eachCell((c) => {
    c.fill = HEAD_FILL;
    c.font = { bold: true, color: { argb: 'FFE9C46A' } };
    c.alignment = { horizontal: 'center' };
    c.border = box;
  });
  bill.forEach((d) => {
    const r = ws.addRow([dayTitle(d.date, true), d.total]);
    r.getCell(1).alignment = { horizontal: 'right' };
    r.getCell(2).numFmt = PESO;
    r.eachCell((c) => (c.border = box));
  });
  const t = ws.addRow([en ? `Total bill for ${monthName(month)}` : `${formatMonth(month)} 총 청구액`, bill.reduce((a, d) => a + d.total, 0)]);
  t.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111214' } };
    c.font = { bold: true, color: { argb: 'FFE9C46A' } };
    c.border = box;
  });
  t.getCell(2).numFmt = PESO;

  const ds = wb.addWorksheet(en ? 'Daily breakdown' : '일별 내역');
  ds.columns = [{ width: 34 }, { width: 22 }, { width: 14 }, { width: 18 }, { width: 18 }];
  let row = 1;
  for (const d of bill) if (d.lines.length) row = writeDay(ds, row, d, rates, en);
  await download(wb, `Hotel_Billing_Report_${month}.xlsx`);
}

async function excelDay(day: DayBill, rates: CasinoRatesConfig, en: boolean) {
  const wb = await sheetBook();
  const ws = wb.addWorksheet(day.date);
  ws.columns = [{ width: 34 }, { width: 22 }, { width: 14 }, { width: 18 }, { width: 18 }];
  writeDay(ws, 1, day, rates, en);
  await download(wb, `Hotel_Billing_${day.date}.xlsx`);
}

/** One day, in the same format as the hotel's daily sheet: Room Category sections (day rate · Outside Guaranteed ·
 *  Triple Sharing) and Buffet Category, each with rate × no. of rooms / pax = sub-total, and the Daily Total on the right. */
const DayBreakdown: React.FC<{
  day: DayBill;
  rates: CasinoRatesConfig;
  en: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}> = ({ day, rates, en, onClose, onPrev, onNext }) => {
  const shown = daySections(day, rates, en);
  const totalRows = shown.reduce((a, sec) => a + sec.rows.length + 1, 0);
  const B = 'border border-ink'; // black lines (light in dark mode)
  const HEAD = `${B} bg-[#3b4452] text-[#e9c46a] font-semibold px-2 py-[3px] text-[12px]`;
  const CELL = `${B} px-2 py-[1px] text-[12px] leading-[17px]`;
  const Nav = ({ go, children }: { go?: () => void; children: React.ReactNode }) => (
    <button disabled={!go} onClick={go} className="icon-btn !w-7 !h-7 disabled:opacity-30 disabled:cursor-default">
      {children}
    </button>
  );
  return (
    <Dialog
      width="max-w-5xl"
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <Nav go={onPrev}>
            <ChevronLeft className="w-4 h-4" />
          </Nav>
          <span>
            {weekday(day.date, en)}, {formatLongDate(day.date)}
          </span>
          <Nav go={onNext}>
            <ChevronRight className="w-4 h-4" />
          </Nav>
        </span>
      }
      subtitle={en ? 'Bill to: Jupiter · from Hotel Purchases (wholesale)' : '청구 대상: 주피터 · 호텔 구매 기준'}
    >
      <div className="px-6 py-3">
        {shown.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-muted">{en ? 'Nothing bought from the hotel on this day.' : '이 날 호텔 구매가 없습니다.'}</div>
        ) : (
        <table className="w-full border-collapse bg-surface text-ink">
          <colgroup>
            <col className="w-[27%]" />
            <col className="w-[18%]" />
            <col className="w-[15%]" />
            <col className="w-[19%]" />
            <col className="w-[21%]" />
          </colgroup>
          <tbody>
            {shown.map((sec, si) => (
              <React.Fragment key={si}>
                <tr>
                  <td className={HEAD}>{sec.title}</td>
                  <td className={`${HEAD} text-center`}>{sec.rateHead}</td>
                  <td className={`${HEAD} text-center`}>{sec.qtyHead}</td>
                  <td className={`${HEAD} text-center`}>{en ? 'Sub-total' : '소계'}</td>
                  {si === 0 && <td className={`${HEAD} text-center`}>{en ? 'Daily Total' : '일일 합계'}</td>}
                </tr>
                {sec.rows.map((r, ri) => (
                  <tr key={ri} className={r.qty ? 'bg-accent-soft/40' : ''}>
                    <td className={`${CELL} whitespace-nowrap`}>{r.name}</td>
                    <td className={`${CELL} text-right num`}>{r.rate !== null ? `₱${money(r.rate)}` : <span className="text-faint">-</span>}</td>
                    <td className={`${CELL} text-center num font-semibold`}>{r.qty || ''}</td>
                    <td className={`${CELL} num`}>
                      <span className="flex justify-between">
                        <span>₱</span>
                        <span className={r.amt ? 'font-semibold' : ''}>{r.amt ? money(r.amt) : '-'}</span>
                      </span>
                    </td>
                    {si === 0 && ri === 0 && (
                      <td rowSpan={totalRows - 1} className={`${B} align-middle`}>
                        <span className="flex justify-between items-center px-3 num text-[15px] font-bold">
                          <span>₱</span>
                          <span>{money(day.total)}</span>
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        )}
      </div>
      <div className="px-6 py-3 border-t border-line bg-sunken flex justify-end gap-2">
        <button onClick={() => excelDay(day, rates, en)} className="btn btn-ghost">
          <FileSpreadsheet className="w-4 h-4" />
          Excel
        </button>
        <button onClick={() => runPdf(() => pdfDay(day, rates, en), en)} className="btn btn-ghost" title={en ? 'Download as .pdf' : 'PDF 다운로드'}>
          <FileDown className="w-4 h-4" />
          PDF
        </button>
      </div>
    </Dialog>
  );
};
