import type { Reservation, FolioPayment } from '../types/hotel';
import { folioOf } from './billing';
import { formatMonth, getStayNights, getDayCategory } from './hotelHelpers';

const PESO = '"₱"#,##0.00';
const DATE = 'mmmm d, yyyy';
const INK = 'FF111214';
const BLUE = 'FF3567D6';
const SOFT = 'FFF5F6F8';

const toDate = (iso: string) => new Date(iso + 'T00:00:00Z');

/**
 * Builds and downloads "Jupiter_Hotel_Settlement_YYYY-MM.xlsx" with:
 * Summary · Bookings · Extra Charges · Guest Payments · Hotel Payments
 */
export async function exportSettlementExcel(month: string, bookings: Reservation[], hotelPayments: FolioPayment[]) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jupiter Hotel PMS';
  wb.created = new Date();

  const folios = bookings.map((r) => ({ r, f: folioOf(r) }));
  const billed = folios.reduce((a, x) => a + x.f.total, 0);
  const paidToHotel = hotelPayments.reduce((a, p) => a + p.amount, 0);
  const guestPaid = folios.reduce((a, x) => a + x.f.paid, 0);
  const nights = bookings.reduce((a, r) => a + r.nights, 0);

  const header = (ws: import('exceljs').Worksheet, row: number, color = INK) => {
    ws.getRow(row).eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = { bottom: { style: 'thin', color: { argb: 'FFD9DBE0' } } };
    });
    ws.getRow(row).height = 22;
  };
  const totalRow = (ws: import('exceljs').Worksheet, row: number) => {
    ws.getRow(row).eachCell((c) => {
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
      c.border = { top: { style: 'medium', color: { argb: INK } } };
    });
  };
  const title = (ws: import('exceljs').Worksheet, text: string, cols: number) => {
    ws.mergeCells(1, 1, 1, cols);
    const c = ws.getCell(1, 1);
    c.value = text;
    c.font = { bold: true, size: 15 };
    ws.mergeCells(2, 1, 2, cols);
    const s = ws.getCell(2, 1);
    s.value = `${formatMonth(month)} · Jupiter Junket → Hilton Hotel`;
    s.font = { color: { argb: 'FF6B6E76' } };
  };

  // ---------------- Transactions (one line per room booking / extra charge) ----------------
  const tx = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 4 }] });
  tx.columns = [{ width: 6 }, { width: 26 }, { width: 22 }, { width: 16 }, { width: 16 }, { width: 26 }, { width: 8 }, { width: 30 }];
  title(tx, 'Transactions', 8);
  tx.getRow(4).values = ['No.', 'Guest', 'Date of Transaction', 'Amount', 'Type', 'Rate / Type', 'Qty', 'Details'];
  header(tx, 4);

  const rateLabel = (r: Reservation) => {
    const holidays = r.holidayDates || [];
    const comps = r.compDates || [];
    let wd = 0, we = 0, ho = 0, co = 0;
    getStayNights(r.checkIn, r.checkOut).forEach((d) => {
      if (comps.includes(d)) co++;
      else if (getDayCategory(d) === 'weekend') we++;
      else if (holidays.includes(d)) ho++;
      else wd++;
    });
    const parts = [wd && 'WEEKDAY', we && 'WEEKEND', ho && 'HOLIDAY'].filter(Boolean) as string[];
    const label = parts.length ? `${parts.join(' + ')} RATE` : co ? 'COMPLIMENTARY' : 'ROOM RATE';
    return co && parts.length ? `${label} + ${co} FREE` : label;
  };
  type Line = { guest: string; date: string; amount: number; type: string; rate: string; qty: number; details: string };
  const lines: Line[] = [];
  bookings.forEach((r) => {
    lines.push({ guest: r.guestName, date: r.checkIn, amount: r.amount, type: 'ROOM BOOKING', rate: rateLabel(r), qty: r.nights, details: r.roomType });
    (r.charges || []).forEach((c) => {
      const cat = c.category || (/voucher|buffet|breakfast|dinner/i.test(c.description) ? 'buffet' : /extra bed/i.test(c.description) ? 'extraBed' : 'other');
      lines.push({
        guest: r.guestName,
        date: c.date,
        amount: c.free ? 0 : c.qty * c.unitPrice,
        type: cat === 'buffet' ? 'BUFFET' : cat === 'extraBed' ? 'EXTRA BED' : 'OTHER',
        rate: c.free ? 'COMPLIMENTARY' : cat === 'buffet' ? 'RESTAURANT' : cat === 'extraBed' ? 'ADD-ON' : 'MISC',
        qty: c.qty,
        details: c.free ? `${c.description} (free)` : c.description,
      });
    });
  });
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.guest.localeCompare(b.guest));
  const thin = { style: 'thin' as const, color: { argb: 'FF9A9DA5' } };
  lines.forEach((l, i) => {
    const row = tx.getRow(5 + i);
    row.values = [i + 1, l.guest, toDate(l.date), l.amount, l.type, l.rate, l.qty, l.details];
    row.getCell(3).numFmt = DATE;
    row.getCell(4).numFmt = PESO;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = { top: thin, left: thin, bottom: thin, right: thin };
      c.alignment = { horizontal: col === 4 ? 'right' : col === 2 || col === 8 ? 'left' : 'center', vertical: 'middle' };
    });
    row.getCell(5).font = { bold: true, color: { argb: l.type === 'ROOM BOOKING' ? 'FF3567D6' : 'FFC0662B' } };
  });
  const tEnd = 5 + lines.length;
  tx.getRow(tEnd).values = ['', `TOTAL · ${lines.length} transactions`, '', lines.length ? { formula: `SUM(D5:D${tEnd - 1})` } : 0, '', '', lines.length ? { formula: `SUM(G5:G${tEnd - 1})` } : 0, ''];
  tx.getCell(tEnd, 4).numFmt = PESO;
  totalRow(tx, tEnd);
  tx.getCell(tEnd, 7).alignment = { horizontal: 'center' };
  tx.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(tEnd - 1, 4), column: 8 } };

  // ---------------- Summary ----------------
  const sum = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 30 }, { width: 22 }, { width: 22 }, { width: 26 }];
  title(sum, 'Monthly Settlement Statement', 4);
  const rows: [string, number | string, string?][] = [
    ['Statement no.', `SET-${month.replace('-', '')}`],
    ['Settlement period', formatMonth(month)],
    ['Bookings', bookings.length],
    ['Room-nights', nights],
    ['Total hotel bill', billed, PESO],
    ['Paid to hotel', paidToHotel, PESO],
    ['Balance due to hotel', Math.max(billed - paidToHotel, 0), PESO],
    ['Status', billed > 0 && paidToHotel >= billed ? 'SETTLED' : 'OPEN'],
    ['', ''],
    ['Guest payments received', guestPaid, PESO],
    ['Unpaid by guests', billed - guestPaid, PESO],
  ];
  rows.forEach(([label, value, fmt], i) => {
    const r = sum.getRow(4 + i);
    r.getCell(1).value = label;
    r.getCell(1).font = { color: { argb: 'FF34363C' } };
    r.getCell(2).value = value;
    r.getCell(2).font = { bold: true };
    r.getCell(2).alignment = { horizontal: 'right' };
    if (fmt) r.getCell(2).numFmt = fmt;
  });
  const statusCell = sum.getCell(4 + 7, 2);
  statusCell.font = { bold: true, color: { argb: statusCell.value === 'SETTLED' ? 'FF2E7A57' : 'FFB4372C' } };
  const balCell = sum.getCell(4 + 6, 2);
  balCell.font = { bold: true, size: 13, color: { argb: billed - paidToHotel > 0 ? 'FFB4372C' : 'FF2E7A57' } };

  const ph = 4 + rows.length + 2;
  sum.getCell(ph - 1, 1).value = 'Payments to hotel';
  sum.getCell(ph - 1, 1).font = { bold: true, size: 12 };
  sum.getRow(ph).values = ['Date', 'Method', 'Reference', 'Amount', 'OIC', 'Remarks'];
  header(sum, ph, BLUE);
  hotelPayments.forEach((p, i) => {
    const r = sum.getRow(ph + 1 + i);
    r.values = [toDate(p.date), p.method, p.reference || '—', p.amount, p.oic || '—', p.remarks || ''];
    r.getCell(1).numFmt = DATE;
    r.getCell(4).numFmt = PESO;
  });
  const phEnd = ph + 1 + hotelPayments.length;
  sum.getRow(phEnd).values = ['Total paid', '', '', hotelPayments.length ? { formula: `SUM(D${ph + 1}:D${phEnd - 1})`, result: paidToHotel } : 0];
  sum.getCell(phEnd, 4).numFmt = PESO;
  totalRow(sum, phEnd);

  sum.getCell(phEnd + 4, 1).value = '______________________________';
  sum.getCell(phEnd + 5, 1).value = 'Prepared by (Hotel)';
  sum.getCell(phEnd + 4, 3).value = '______________________________';
  sum.getCell(phEnd + 5, 3).value = 'Received by (Jupiter)';

  // ---------------- Bookings ----------------
  const bk = wb.addWorksheet('Bookings', { views: [{ state: 'frozen', ySplit: 4 }] });
  bk.columns = [
    { width: 26 }, { width: 28 }, { width: 14 }, { width: 20 }, { width: 20 }, { width: 8 }, { width: 10 },
    { width: 15 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 11 }, { width: 34 },
  ];
  title(bk, 'Bookings', 14);
  bk.getRow(4).values = ['Guest', 'Room type', 'Occupancy', 'Check-in', 'Check-out', 'Nights', 'Holiday nights', 'Room charge', 'Extras', 'Total', 'Guest paid', 'Guest balance', 'Status', 'Remarks'];
  header(bk, 4);
  folios.forEach(({ r, f }, i) => {
    const row = bk.getRow(5 + i);
    row.values = [
      r.guestName,
      r.roomType,
      r.occupancy === 'triple' ? 'Triple' : 'Single/Double',
      toDate(r.checkIn),
      toDate(r.checkOut),
      r.nights,
      (r.holidayDates || []).length,
      r.amount,
      f.extras,
      f.total,
      f.paid,
      f.balance,
      f.status === 'paid' ? 'Paid' : f.status === 'partial' ? 'Partial' : 'Unpaid',
      r.remarks || '',
    ];
    row.getCell(4).numFmt = DATE;
    row.getCell(5).numFmt = DATE;
    [8, 9, 10, 11, 12].forEach((c) => (row.getCell(c).numFmt = PESO));
    row.getCell(13).font = { bold: true, color: { argb: f.status === 'paid' ? 'FF2E7A57' : f.status === 'partial' ? 'FFA86A12' : 'FFB4372C' } };
    if (i % 2) row.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFB' } }));
  });
  const bEnd = 5 + bookings.length;
  const colSum = (col: string) => (bookings.length ? { formula: `SUM(${col}5:${col}${bEnd - 1})` } : 0);
  bk.getRow(bEnd).values = ['TOTAL', `${bookings.length} bookings`, '', '', '', colSum('F'), colSum('G'), colSum('H'), colSum('I'), colSum('J'), colSum('K'), colSum('L'), '', ''];
  [8, 9, 10, 11, 12].forEach((c) => (bk.getCell(bEnd, c).numFmt = PESO));
  totalRow(bk, bEnd);
  bk.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(bEnd - 1, 4), column: 14 } };

  // ---------------- Extra Charges ----------------
  const ex = wb.addWorksheet('Extra Charges', { views: [{ state: 'frozen', ySplit: 4 }] });
  ex.columns = [{ width: 26 }, { width: 20 }, { width: 30 }, { width: 8 }, { width: 14 }, { width: 15 }];
  title(ex, 'Extra Charges', 6);
  ex.getRow(4).values = ['Guest', 'Date', 'Description', 'Qty', 'Unit price', 'Amount'];
  header(ex, 4);
  let er = 5;
  bookings.forEach((r) =>
    (r.charges || []).forEach((c) => {
      const row = ex.getRow(er++);
      row.values = c.free
        ? [r.guestName, toDate(c.date), `${c.description} (free)`, c.qty, c.unitPrice, 0]
        : [r.guestName, toDate(c.date), c.description, c.qty, c.unitPrice, { formula: `D${er - 1}*E${er - 1}`, result: c.qty * c.unitPrice }];
      row.getCell(2).numFmt = DATE;
      row.getCell(5).numFmt = PESO;
      row.getCell(6).numFmt = PESO;
    })
  );
  ex.getRow(er).values = ['TOTAL', '', '', '', '', er > 5 ? { formula: `SUM(F5:F${er - 1})` } : 0];
  ex.getCell(er, 6).numFmt = PESO;
  totalRow(ex, er);

  // ---------------- Guest Payments ----------------
  const gp = wb.addWorksheet('Guest Payments', { views: [{ state: 'frozen', ySplit: 4 }] });
  gp.columns = [{ width: 26 }, { width: 20 }, { width: 18 }, { width: 26 }, { width: 15 }];
  title(gp, 'Payments from Guests', 5);
  gp.getRow(4).values = ['Guest', 'Date', 'Method', 'Reference / OR no.', 'Amount'];
  header(gp, 4);
  let gr = 5;
  bookings.forEach((r) =>
    (r.payments || []).forEach((p) => {
      const row = gp.getRow(gr++);
      row.values = [r.guestName, toDate(p.date), p.method, p.reference || '—', p.amount];
      row.getCell(2).numFmt = DATE;
      row.getCell(5).numFmt = PESO;
    })
  );
  gp.getRow(gr).values = ['TOTAL', '', '', '', gr > 5 ? { formula: `SUM(E5:E${gr - 1})` } : 0];
  gp.getCell(gr, 5).numFmt = PESO;
  totalRow(gp, gr);

  // ---------------- Download ----------------
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Jupiter_Hotel_Settlement_${month}.xlsx` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Daily settlement sheet in the same layout as the original Excel dashboard:
 * title · note · month · bilingual 2-row header · one row per day · totals.
 * Units (건/명/박) are number formats, so cells stay numeric and SUM works.
 */
export async function exportDailyExcel(
  month: string,
  rows: { date: string; checkIns: number; inHouse: number; nights: number; total: number; roomAmount: number; extrasAmount: number; paid: number; paidAmount: number; unpaid: number; unpaidAmount: number; voucherAmount: number }[],
  roomsInUse: number
) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jupiter Hotel PMS';
  const ws = wb.addWorksheet('Daily Settlement', { views: [{ state: 'frozen', ySplit: 6, showGridLines: false }] });
  ws.columns = [{ width: 14 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 22 }];
  const NAVY = 'FF1F3A5F';
  const thin = { style: 'thin' as const, color: { argb: 'FFD0D3DA' } };

  ws.mergeCells('A1:I1');
  Object.assign(ws.getCell('A1'), { value: '일별 호텔 예약 & 결제 정산 대시보드  ·  Daily Hotel Reservation & Settlement' });
  ws.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  ws.mergeCells('A2:I2');
  ws.getCell('A2').value = '※ 예약 목록에 입력된 데이터가 자동으로 집계됩니다. 금액은 체크인 날짜 기준으로 집계됩니다. (Totals come from the Guest Ledger, counted on the check-in date.)';
  ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF6B6E76' } };

  ws.getCell('A3').value = '조회 월 (Month)';
  ws.getCell('A3').font = { bold: true };
  ws.getCell('B3').value = formatMonth(month);
  ws.getCell('B3').font = { bold: true, color: { argb: 'FF2350B5' } };
  ws.getCell('B3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  ws.mergeCells('B3:C3');
  ws.getCell('D3').value = '투숙 중 객실 (Occupied rooms)';
  ws.mergeCells('D3:E3');
  ws.getCell('F3').value = roomsInUse;
  ws.getCell('F3').numFmt = '0"실"';
  ws.getCell('F3').font = { bold: true };

  const ko = ['날짜', '체크인 목록', '계속 투숙', '객실 요금 (PHP)', '뷔페·추가 (PHP)', '총 금액 (PHP)', '결제 금액 (PHP)', '미결제 금액 (PHP)', '바우처 판매 (PHP)'];
  const enH = ['Date', 'Check-in List', 'Still Staying', 'Room', 'Buffet / Extras', 'Total Amount', 'Paid Amount', 'Unpaid Amount', 'Vouchers Sold (for record)'];
  ws.getRow(5).values = ko;
  ws.getRow(6).values = enH;
  [5, 6].forEach((r) => {
    ws.getRow(r).eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: r === 5 ? 11 : 9.5 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.getRow(r).height = 20;
  });

  const fmts = ['d-mmm-yy', '0"건"', '0"건"', PESO, PESO, PESO, PESO, PESO, PESO];
  rows.forEach((r, i) => {
    const row = ws.getRow(7 + i);
    row.values = [toDate(r.date), r.checkIns, r.inHouse - r.checkIns, r.roomAmount, r.extrasAmount, r.total, r.paidAmount, r.unpaidAmount, r.voucherAmount];
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.numFmt = fmts[col - 1];
      c.border = { top: thin, bottom: thin, left: thin, right: thin };
      c.alignment = { horizontal: col === 1 ? 'center' : 'right' };
      if (col === 1 && getDayCategory(r.date) === 'weekend') c.font = { color: { argb: 'FFC0662B' }, bold: true };
      if (col === 6 && r.total) c.font = { bold: true };
      if (col === 7 && r.paidAmount) c.font = { color: { argb: 'FF2E7A57' }, bold: true };
      if (col === 8 && r.unpaidAmount) c.font = { color: { argb: 'FFB4372C' }, bold: true };
      if (col === 9 && r.voucherAmount) c.font = { color: { argb: 'FFA86A12' }, bold: true };
    });
    if (r.checkIns) row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EFFC' } };
  });
  const end = 7 + rows.length;
  const S = (col: string) => ({ formula: `SUM(${col}7:${col}${end - 1})` });
  ws.getRow(end).values = ['총합계 (Grand total)', S('B'), '', S('D'), S('E'), S('F'), S('G'), S('H'), S('I')];
  ws.getRow(end).eachCell({ includeEmpty: true }, (c, col) => {
    c.numFmt = col === 1 ? '@' : fmts[col - 1];
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    c.border = { top: { style: 'medium', color: { argb: INK } } };
    c.alignment = { horizontal: col === 1 ? 'center' : 'right' };
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Daily_Settlement_${month}.xlsx` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Fund ledger → "Fund_YYYY-MM.xlsx" (or Fund_all.xlsx): date, description, fund, method, in, out, balance, status.
 * `rows` are oldest first, with the running balance already worked out (see FundPage).
 */
export async function exportFundExcel(
  month: string,
  fundLabel: string,
  rows: { date: string; label: string; sub: string; fund: 'room' | 'voucher'; method: string; dir: 'in' | 'out'; amount: number; balance: number; voided: boolean }[]
) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jupiter Hotel PMS';
  const ws = wb.addWorksheet('Fund ledger', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = [{ width: 20 }, { width: 42 }, { width: 11 }, { width: 16 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 10 }];

  ws.mergeCells('A1:H1');
  ws.getCell('A1').value = `Fund ledger — ${fundLabel}`;
  ws.getCell('A1').font = { bold: true, size: 15 };
  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = `${month ? formatMonth(month) : 'All months'} · Jupiter Junket`;
  ws.getCell('A2').font = { color: { argb: 'FF6B6E76' } };

  ws.getRow(4).values = ['Date', 'Description', 'Fund', 'Method', 'In', 'Out', 'Balance', 'Status'];
  ws.getRow(4).eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  ws.getRow(4).height = 22;

  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.values = [
      toDate(r.date),
      r.sub ? `${r.label} — ${r.sub}` : r.label,
      r.fund === 'room' ? 'Room' : 'Voucher',
      r.method,
      r.dir === 'in' ? r.amount : null,
      r.dir === 'out' ? r.amount : null,
      r.balance,
      r.voided ? 'VOIDED' : '',
    ];
    row.getCell(1).numFmt = DATE;
    [5, 6, 7].forEach((c) => (row.getCell(c).numFmt = PESO));
    row.getCell(5).font = { color: { argb: 'FF2E7A57' } };
    row.getCell(6).font = { color: { argb: 'FFB4372C' } };
    if (r.voided) row.eachCell((c) => (c.font = { ...(c.font || {}), strike: true, color: { argb: 'FF9A9DA5' } }));
  });

  const end = 5 + rows.length;
  const counted = rows.filter((r) => !r.voided);
  ws.getRow(end).values = [
    'TOTAL',
    `${rows.length} entries`,
    '',
    '',
    counted.filter((r) => r.dir === 'in').reduce((s, r) => s + r.amount, 0),
    counted.filter((r) => r.dir === 'out').reduce((s, r) => s + r.amount, 0),
    rows.length ? rows[rows.length - 1].balance : 0,
    '',
  ];
  [5, 6, 7].forEach((c) => (ws.getCell(end, c).numFmt = PESO));
  ws.getRow(end).eachCell((c) => {
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SOFT } };
    c.border = { top: { style: 'medium', color: { argb: INK } } };
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Fund_${month || 'all'}.xlsx` });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
