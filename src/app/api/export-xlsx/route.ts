import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { query } from '@/lib/db';
import ExcelJS from 'exceljs';

// ===== Constants =====

const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

const BN_TO_EN: Record<string, string> = {
  'জানুয়ারি': 'January', 'ফেব্রুয়ারি': 'February', 'মার্চ': 'March',
  'এপ্রিল': 'April', 'মে': 'May', 'জুন': 'June',
  'জুলাই': 'July', 'আগস্ট': 'August', 'সেপ্টেম্বর': 'September',
  'অক্টোবর': 'October', 'নভেম্বর': 'November', 'ডিসেম্বর': 'December'
};

// ===== Helpers =====

function parseBDDate(date: Date | string | number): Date {
  if (typeof date === 'number') return new Date(date);
  const s = String(date).trim();
  // Pure date "YYYY-MM-DD" (10 chars) → parse directly with BD timezone
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(s + 'T00:00:00+06:00');
  }
  // ISO-like string without T separator: "YYYY-MM-DDHH:MM:SS" → insert T
  const fixed = s.replace(/^(\d{4}-\d{2}-\d{2})(\d{2})/, '$1T$2');
  if (fixed.includes('Z') || fixed.includes('+')) return new Date(fixed);
  return new Date(fixed + '+06:00');
}

function formatDateDDMMYYYY(date: Date | string | number): string {
  const d = parseBDDate(date);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ===== Style Helpers for exceljs =====

const THIN_BORDER = {
  top: { style: 'thin' as const, color: { argb: 'FF000000' } },
  bottom: { style: 'thin' as const, color: { argb: 'FF000000' } },
  left: { style: 'thin' as const, color: { argb: 'FF000000' } },
  right: { style: 'thin' as const, color: { argb: 'FF000000' } },
};

const LIGHT_BORDER = {
  top: { style: 'thin' as const, color: { argb: 'FFD9D9D9' } },
  bottom: { style: 'thin' as const, color: { argb: 'FFD9D9D9' } },
  left: { style: 'thin' as const, color: { argb: 'FFD9D9D9' } },
  right: { style: 'thin' as const, color: { argb: 'FFD9D9D9' } },
};

// Send workbook as downloadable xlsx response
async function sendWorkbook(wb: ExcelJS.Workbook, fileName: string) {
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}

// Setup print settings on a worksheet
function setupPrint(ws: ExcelJS.Worksheet, orientation: 'landscape' | 'portrait' = 'landscape') {
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.3, footer: 0.3 },
    printAreaRowStart: 1,
    printAreaRowEnd: ws.rowCount,
  };
  ws.printOptions = { showGridLines: true };
}

// Add title row with merged cells
function addTitleRow(ws: ExcelJS.Worksheet, text: string, colCount: number, color: string = '1F4E79', fontSize: number = 14) {
  const row = ws.addRow([text]);
  ws.mergeCells(1, 1, 1, colCount);
  const cell = row.getCell(1);
  cell.font = { bold: true, size: fontSize, name: 'Arial', color: { argb: 'FF' + color } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  row.height = 30;
  return row;
}

// Add subtitle row (e.g. price info, date)
function addSubtitleRow(ws: ExcelJS.Worksheet, text: string, colCount: number) {
  const row = ws.addRow([text]);
  ws.mergeCells(ws.rowCount, 1, ws.rowCount, colCount);
  const cell = row.getCell(1);
  cell.font = { size: 9, name: 'Arial', italic: true, color: { argb: 'FF666666' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  row.height = 20;
  return row;
}

// Add header row with styling
function addHeaderRow(ws: ExcelJS.Worksheet, headers: string[], color: string = '4472C4'): ExcelJS.Row {
  const row = ws.addRow(headers);
  row.height = 24;
  row.eachCell((cell, colNumber) => {
    cell.font = { bold: true, size: 10, name: 'Arial', color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + color } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = THIN_BORDER;
  });
  return row;
}

// Add data row with zebra striping
function addDataRow(ws: ExcelJS.Worksheet, data: (string | number)[], isFooter: boolean = false, footerColor: string = '4472C4', numColStart: number = 5) {
  const row = ws.addRow(data);
  row.height = 20;
  const rIdx = row.number;
  row.eachCell((cell, colNumber) => {
    if (isFooter) {
      cell.font = { bold: true, size: 10, name: 'Arial', color: { argb: 'FF' + footerColor } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF' + footerColor } },
        bottom: { style: 'thin', color: { argb: 'FF' + footerColor } },
        left: LIGHT_BORDER.left, right: LIGHT_BORDER.right,
      };
    } else {
      cell.font = { size: 10, name: 'Arial' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: (rIdx % 2 === 0) ? 'FFF2F2F2' : 'FFFFFFFF' } };
      cell.border = LIGHT_BORDER;
    }
    cell.alignment = { vertical: 'middle', wrapText: true };
    if (colNumber >= numColStart) {
      cell.alignment = { ...cell.alignment, horizontal: 'right' };
    }
  });
  return row;
}

// Add blank spacing row
function addBlankRow(ws: ExcelJS.Worksheet) {
  const row = ws.addRow([]);
  row.height = 8;
  return row;
}

// =============================================
// GET: Excel export — multiple report types
// =============================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'data';
    const month = searchParams.get('month') || '';
    const year = searchParams.get('year') || '';
    const orderDate = searchParams.get('orderDate') || '';

    if (type === 'data') return exportDataSheet(month, year);
    if (type === 'balance') return exportBalanceSheet(searchParams.get('balType') || 'due');
    if (type === 'monthly') return exportMonthlyMealSheet(month, year);
    if (type === 'daily') return exportDailyMealSheet(orderDate);
    if (type === 'market-expense') return exportMarketExpenseSheet(month, year);

    return NextResponse.json({ success: false, error: 'Invalid type' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// =============================================
// TYPE 1: Full Data Sheet
// =============================================

async function exportDataSheet(month: string, year: string) {
  const whereExport: Record<string, unknown> = {};
  if (month && month !== 'all') whereExport.month = month;
  if (year) whereExport.year = year;

  const entries = await db.mealEntry.findMany({ where: whereExport, orderBy: { entryDate: 'asc' } });

  const usersResult = await query('SELECT officeId, name, mobile, designation FROM MealUser');
  const userMap = new Map<string, { name: string; mobile: string; designation: string }>();
  for (const row of usersResult.rows) {
    const r = row as any;
    if (r.officeId) userMap.set(r.officeId, r);
  }

  // Pre-process: check which optional columns have any non-zero data
  let hasBreakfast = false, hasLunch = false, hasMorningSpecial = false, hasLunchSpecial = false;
  let hasTotalBill = false, hasDeposit = false, hasDepositDate = false, hasPrevBalance = false, hasCurBalance = false;

  for (const e of entries) {
    const entry = e as any;
    if (Number(entry.breakfastCount) > 0) hasBreakfast = true;
    if (Number(entry.lunchCount) > 0) hasLunch = true;
    if (Number(entry.morningSpecial) > 0) hasMorningSpecial = true;
    if (Number(entry.lunchSpecial) > 0) hasLunchSpecial = true;
    if (Number(entry.totalBill) > 0) hasTotalBill = true;
    if (Number(entry.deposit) > 0) hasDeposit = true;
    if (entry.depositDate) hasDepositDate = true;
    if (Number(entry.prevBalance) !== 0) hasPrevBalance = true;
    if (Number(entry.curBalance) !== 0) hasCurBalance = true;
  }

  // Build dynamic headers & column config
  const colDefs: { header: string; key: string; width: number }[] = [
    { header: 'ক্রমিক', key: 'serial', width: 6 },
    { header: 'তারিখ', key: 'date', width: 13 },
    { header: 'মাস', key: 'month', width: 16 },
    { header: 'বছর', key: 'year', width: 8 },
    { header: 'অফিস আইডি', key: 'officeId', width: 12 },
    { header: 'নাম', key: 'name', width: 25 },
    { header: 'পদবী', key: 'designation', width: 22 },
    { header: 'মোবাইল', key: 'mobile', width: 15 },
  ];

  if (hasBreakfast) colDefs.push({ header: 'সকাল নাস্তা', key: 'breakfast', width: 12 });
  if (hasLunch) colDefs.push({ header: 'দুপুর মিল', key: 'lunch', width: 12 });
  if (hasMorningSpecial) colDefs.push({ header: 'সকাল স্পেশাল', key: 'morningSpecial', width: 14 });
  if (hasLunchSpecial) colDefs.push({ header: 'দুপুর স্পেশাল', key: 'lunchSpecial', width: 14 });
  if (hasTotalBill) colDefs.push({ header: 'মোট বিল (টাকা)', key: 'totalBill', width: 14 });
  if (hasDeposit) colDefs.push({ header: 'জমা (টাকা)', key: 'deposit', width: 14 });
  if (hasDepositDate) colDefs.push({ header: 'জমার তারিখ', key: 'depositDate', width: 14 });
  if (hasPrevBalance) colDefs.push({ header: 'পূর্বের ব্যালেন্স', key: 'prevBalance', width: 16 });
  if (hasCurBalance) colDefs.push({ header: 'বর্তমান ব্যালেন্স', key: 'curBalance', width: 18 });

  const headers = colDefs.map(c => c.header);
  const numColStart = colDefs.findIndex(c => ['breakfast', 'lunch', 'morningSpecial', 'lunchSpecial', 'totalBill', 'deposit', 'prevBalance', 'curBalance'].includes(c.key));
  const firstNumCol = numColStart >= 0 ? numColStart + 1 : headers.length + 1;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('মিল ডাটা', { properties: { defaultRowHeight: 20 } });

  // Set column widths
  colDefs.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  // Title
  const titleText = month && month !== 'all' ? `মিল ডাটা — ${month}, ${year}` : `মিল ডাটা — ${year}`;
  addTitleRow(ws, titleText, headers.length, '1F4E79', 14);
  addBlankRow(ws);

  // Header row
  addHeaderRow(ws, headers, '4472C4');

  // Data rows
  let tB = 0, tL = 0, tMS = 0, tLS = 0, tBill = 0, tDep = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as any;
    const user = userMap.get(e.officeId);
    const enMonth = BN_TO_EN[e.month] || e.month || '';
    const rB = Number(e.breakfastCount) || 0;
    const rL = Number(e.lunchCount) || 0;
    const rMS = Number(e.morningSpecial) || 0;
    const rLS = Number(e.lunchSpecial) || 0;
    const bill = Number(e.totalBill) || 0;
    const dep = Number(e.deposit) || 0;
    tB += rB; tL += rL; tMS += rMS; tLS += rLS; tBill += bill; tDep += dep;

    const rowData: (string | number)[] = [
      i + 1, formatDateDDMMYYYY(e.entryDate),
      `${e.month || ''} (${enMonth})`, e.year || '',
      e.officeId || '', e.name || '', e.designation || user?.designation || '', e.mobile || user?.mobile || '',
    ];
    if (hasBreakfast) rowData.push(rB);
    if (hasLunch) rowData.push(rL);
    if (hasMorningSpecial) rowData.push(rMS);
    if (hasLunchSpecial) rowData.push(rLS);
    if (hasTotalBill) rowData.push(bill);
    if (hasDeposit) rowData.push(dep);
    if (hasDepositDate) rowData.push(e.depositDate ? formatDateDDMMYYYY(e.depositDate) : '');
    if (hasPrevBalance) rowData.push(Number(e.prevBalance) || 0);
    if (hasCurBalance) rowData.push(Number(e.curBalance) || 0);

    addDataRow(ws, rowData, false, '4472C4', firstNumCol);
  }

  // Totals row
  const totalRow: (string | number)[] = ['মোট', '', '', '', '', '', '', ''];
  if (hasBreakfast) totalRow.push(tB);
  if (hasLunch) totalRow.push(tL);
  if (hasMorningSpecial) totalRow.push(tMS);
  if (hasLunchSpecial) totalRow.push(tLS);
  if (hasTotalBill) totalRow.push(tBill);
  if (hasDeposit) totalRow.push(tDep);
  if (hasDepositDate) totalRow.push('');
  if (hasPrevBalance) totalRow.push('');
  if (hasCurBalance) totalRow.push('');
  addDataRow(ws, totalRow, true, '4472C4', firstNumCol);

  setupPrint(ws, 'landscape');

  const fileName = month && month !== 'all' ? `মিল_ডাটা_${month}_${year}.xlsx` : `মিল_ডাটা_${year}.xlsx`;
  return sendWorkbook(wb, fileName);
}

// =============================================
// TYPE 2: Balance Sheet (Due / Advance)
// =============================================

async function exportBalanceSheet(balType: string) {
  const allEntries = await db.mealEntry.findMany({ orderBy: { entryDate: 'asc' } });
  const allPriceSettings = await db.priceSetting.findMany();
  const priceMap = new Map<string, any>();
  for (const s of allPriceSettings) priceMap.set(`${s.month}|${s.year}`, s);

  // Dedup same-day entries per officeId
  const entryMap = new Map<string, Array<any>>();
  for (const e of allEntries) {
    const oid = (e as any).officeId;
    if (!oid) continue;
    let entryMonth = (e as any).month || '';
    let entryYear = String((e as any).year || '');
    if (!MONTHS_BN.includes(entryMonth) && e.entryDate) {
      const dateStr = String(e.entryDate || '').substring(0, 10);
      const dp = dateStr.split('-');
      if (dp.length === 3) {
        const d = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
        entryMonth = MONTHS_BN[d.getMonth()];
        entryYear = dp[0];
      }
    }
    const dateStr = String(e.entryDate || '').substring(0, 10);
    if (!entryMap.has(oid)) entryMap.set(oid, []);
    const arr = entryMap.get(oid)!;
    const idx = arr.findIndex((ex: any) => String(ex.entryDate || '').substring(0, 10) === dateStr);
    if (idx >= 0) {
      const existing = arr[idx];
      existing.breakfastCount += Number((e as any).breakfastCount || 0);
      existing.lunchCount += Number((e as any).lunchCount || 0);
      existing.morningSpecial += Number((e as any).morningSpecial || 0);
      existing.lunchSpecial += Number((e as any).lunchSpecial || 0);
      existing.deposit += Number((e as any).deposit || 0);
      if (!existing.name && (e as any).name) existing.name = (e as any).name;
      if (!existing.mobile || ((e as any).mobile && (e as any).mobile.length > existing.mobile.length)) existing.mobile = (e as any).mobile;
      if (!existing.designation || ((e as any).designation && (e as any).designation.length > existing.designation.length)) existing.designation = (e as any).designation;
      if (!existing.month && entryMonth) existing.month = entryMonth;
      if (!existing.year && entryYear) existing.year = entryYear;
    } else {
      arr.push({
        officeId: oid, name: (e as any).name || '', mobile: (e as any).mobile || '',
        designation: (e as any).designation || '', month: entryMonth, year: entryYear,
        entryDate: e.entryDate, breakfastCount: Number((e as any).breakfastCount || 0),
        lunchCount: Number((e as any).lunchCount || 0), morningSpecial: Number((e as any).morningSpecial || 0),
        lunchSpecial: Number((e as any).lunchSpecial || 0), totalBill: Number((e as any).totalBill || 0),
        deposit: Number((e as any).deposit || 0),
      });
    }
  }

  // Calculate balance per officeId
  const balanceList: any[] = [];
  for (const [oid, entries] of entryMap) {
    const sorted = [...entries].sort((a, b) => parseBDDate(a.entryDate).getTime() - parseBDDate(b.entryDate).getTime());
    let runningBalance = 0;
    let tB = 0, tL = 0, tBill = 0, tDep = 0;
    for (const entry of sorted) {
      const price = priceMap.get(`${entry.month}|${entry.year}`);
      const bill = entry.breakfastCount * (price?.breakfastPrice || 0) + entry.lunchCount * (price?.lunchPrice || 0) + entry.morningSpecial * (price?.morningSpecial || 0) + entry.lunchSpecial * (price?.lunchSpecial || 0);
      runningBalance = runningBalance + entry.deposit - bill;
      tB += entry.breakfastCount; tL += entry.lunchCount; tBill += bill; tDep += entry.deposit;
    }
    balanceList.push({ officeId: oid, name: sorted[0].name, mobile: sorted[0].mobile, designation: sorted[0].designation, totalBreakfast: tB, totalLunch: tL, totalBill: tBill, totalDeposit: tDep, curBalance: runningBalance });
  }

  const isDue = balType === 'due';
  const filtered = balanceList.filter(e => isDue ? e.curBalance < 0 : e.curBalance > 0).sort((a, b) => a.name.localeCompare(b.name, 'bn'));
  const title = isDue ? 'বকেয়া টাকার হিসাব' : 'অগ্রিম টাকার হিসাব';
  const color = isDue ? 'C00000' : '006600';

  const headers = ['ক্রমিক', 'অফিস আইডি', 'নাম', 'পদবী', 'মোবাইল', `${isDue ? 'বকেয়া' : 'অগ্রিম'} (টাকা)`];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(isDue ? 'বকেয়া টাকা' : 'অগ্রিম টাকা', { properties: { defaultRowHeight: 20 } });

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 25;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 18;

  addTitleRow(ws, title, headers.length, color, 16);
  addSubtitleRow(ws, `তারিখ: ${formatDateDDMMYYYY(new Date())}`, headers.length);
  addBlankRow(ws);
  addHeaderRow(ws, headers, color);

  let grandTotal = 0;
  for (let i = 0; i < filtered.length; i++) {
    const e = filtered[i];
    const amount = isDue ? Math.abs(e.curBalance) : e.curBalance;
    grandTotal += amount;
    const row = addDataRow(ws, [i + 1, e.officeId, e.name || '—', e.designation || '—', e.mobile || '—', amount], false, color, 6);
    // Highlight amount column
    const amtCell = row.getCell(6);
    amtCell.font = { bold: true, size: 10, name: 'Arial', color: { argb: 'FF' + color } };
  }

  addDataRow(ws, ['মোট', '', '', '', '', grandTotal], true, color, 6);

  setupPrint(ws, 'portrait');

  const today = new Date().toISOString().split('T')[0];
  const fileName = `${isDue ? 'বকেয়া_টাকা' : 'অগ্রিম_টাকা'}_${today}.xlsx`;
  return sendWorkbook(wb, fileName);
}

// =============================================
// TYPE 3: Monthly Meal Summary
// =============================================

async function exportMonthlyMealSheet(month: string, year: string) {
  if (!month || !year) return NextResponse.json({ success: false, error: 'মাস ও বছর দরকার' }, { status: 400 });

  const priceResult = await query('SELECT * FROM PriceSetting WHERE month = ? AND year = ?', [month, year]);
  const prices = priceResult.rows.length > 0 ? priceResult.rows[0] as any : null;
  const bp = Number(prices?.breakfastPrice) || 0, lp = Number(prices?.lunchPrice) || 0;
  const ms = Number(prices?.morningSpecial) || 0, ls = Number(prices?.lunchSpecial) || 0;

  const result = await query(
    `SELECT officeId, MAX(name) as name, MAX(mobile) as mobile, MAX(designation) as designation,
            COALESCE(SUM(breakfastCount),0) as totalBreakfast, COALESCE(SUM(lunchCount),0) as totalLunch,
            COALESCE(SUM(morningSpecial),0) as totalMorningSpecial, COALESCE(SUM(lunchSpecial),0) as totalLunchSpecial
     FROM MealEntry WHERE month = ? AND year = ? AND officeId != '' AND officeId IS NOT NULL
     GROUP BY officeId ORDER BY name ASC`, [month, year]
  );

  const enMonth = BN_TO_EN[month] || month || '';
  const title = `মাসিক মিলের হিসাব — ${month} (${enMonth}), ${year}`;
  const priceRow = `সকাল নাস্তা: ${bp} টাকা | দুপুর মিল: ${lp} টাকা | সকাল স্পেশাল: ${ms} টাকা | দুপুর স্পেশাল: ${ls} টাকা`;
  const headers = ['ক্রমিক', 'অফিস আইডি', 'নাম', 'পদবী', 'মোবাইল', 'সকাল নাস্তা', 'দুপুর মিল', 'সকাল স্পেশাল', 'দুপুর স্পেশাল', 'মোট বিল (টাকা)'];

  let gB = 0, gL = 0, gMS = 0, gLS = 0;
  const details: any[] = [];
  for (const d of result.rows) {
    const r = d as any;
    const tB = Number(r.totalBreakfast) || 0, tL = Number(r.totalLunch) || 0, tMS = Number(r.totalMorningSpecial) || 0, tLS = Number(r.totalLunchSpecial) || 0;
    gB += tB; gL += tL; gMS += tMS; gLS += tLS;
    details.push({ officeId: r.officeId, name: r.name, designation: r.designation, mobile: r.mobile, totalBreakfast: tB, totalLunch: tL, totalMorningSpecial: tMS, totalLunchSpecial: tLS, totalBill: tB * bp + tL * lp + tMS * ms + tLS * ls });
  }
  const grandTotal = gB * bp + gL * lp + gMS * ms + gLS * ls;

  const depResult = await query(`SELECT COALESCE(SUM(deposit), 0) as total FROM MealEntry WHERE month = ? AND year = ?`, [month, year]);
  const totalDep = Number((depResult.rows[0] as any)?.total) || 0;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`মাসিক মিল ${month}`, { properties: { defaultRowHeight: 20 } });

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 25;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 12;
  ws.getColumn(7).width = 12;
  ws.getColumn(8).width = 14;
  ws.getColumn(9).width = 14;
  ws.getColumn(10).width = 14;

  addTitleRow(ws, title, headers.length, '1F4E79', 14);
  addSubtitleRow(ws, priceRow, headers.length);
  addBlankRow(ws);
  addHeaderRow(ws, headers, '1F4E79');

  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    addDataRow(ws, [i + 1, d.officeId, d.name, d.designation || '—', d.mobile || '—', d.totalBreakfast, d.totalLunch, d.totalMorningSpecial, d.totalLunchSpecial, d.totalBill], false, '1F4E79', 6);
  }

  // Grand total
  addDataRow(ws, ['মোট', '', '', '', '', gB, gL, gMS, gLS, grandTotal], true, '1F4E79', 6);

  // Deposit & Net balance rows
  const depRow = ws.addRow(['', '', '', '', '', '', '', '', 'মোট জমা:', totalDep]);
  depRow.height = 20;
  depRow.eachCell((cell) => {
    cell.font = { size: 10, name: 'Arial', bold: true };
    cell.alignment = { vertical: 'middle' };
  });
  depRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };
  depRow.getCell(10).numFmt = '#,##0';

  const netRow = ws.addRow(['', '', '', '', '', '', '', '', 'নিট বকেয়া:', grandTotal - totalDep]);
  netRow.height = 20;
  netRow.eachCell((cell) => {
    cell.font = { size: 10, name: 'Arial', bold: true };
    cell.alignment = { vertical: 'middle' };
  });
  netRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };
  netRow.getCell(10).numFmt = '#,##0';

  setupPrint(ws, 'landscape');

  return sendWorkbook(wb, `মাসিক_মিল_${month}_${year}.xlsx`);
}

// =============================================
// TYPE 4: Daily Meal Order Sheet
// =============================================

async function exportDailyMealSheet(orderDate: string) {
  if (!orderDate) return NextResponse.json({ success: false, error: 'তারিখ দরকার' }, { status: 400 });
  const dateStr = orderDate.substring(0, 10);

  const result = await query(
    `SELECT officeId, MAX(name) as name, MAX(mobile) as mobile, MAX(designation) as designation,
            COALESCE(SUM(breakfastCount),0) as breakfast, COALESCE(SUM(lunchCount),0) as lunch,
            COALESCE(SUM(morningSpecial),0) as morningSpecial, COALESCE(SUM(lunchSpecial),0) as lunchSpecial
     FROM MealEntry WHERE substr(entryDate, 1, 10) = ? AND officeId != '' AND officeId IS NOT NULL
     GROUP BY officeId ORDER BY name ASC`, [dateStr]
  );

  const dp = dateStr.split('-');
  const mObj = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
  const bMonth = MONTHS_BN[mObj.getMonth()], bYear = dp[0];
  const priceResult = await query('SELECT * FROM PriceSetting WHERE month = ? AND year = ?', [bMonth, bYear]);
  const prices = priceResult.rows.length > 0 ? priceResult.rows[0] as any : null;
  const bp = Number(prices?.breakfastPrice) || 0, lp = Number(prices?.lunchPrice) || 0;
  const msp = Number(prices?.morningSpecial) || 0, lsp = Number(prices?.lunchSpecial) || 0;

  const title = `দৈনিক মিল অর্ডার — ${formatDateDDMMYYYY(dateStr)}`;
  const priceRow = `সকাল নাস্তা: ${bp} টাকা | দুপুর মিল: ${lp} টাকা | সকাল স্পেশাল: ${msp} টাকা | দুপুর স্পেশাল: ${lsp} টাকা`;
  const headers = ['ক্রমিক', 'অফিস আইডি', 'নাম', 'পদবী', 'মোবাইল', 'সকাল নাস্তা', 'দুপুর মিল', 'সকাল স্পেশাল', 'দুপুর স্পেশাল', 'মোট বিল (টাকা)'];

  const orders = result.rows.filter((d: any) => Number(d.breakfast) > 0 || Number(d.lunch) > 0 || Number(d.morningSpecial) > 0 || Number(d.lunchSpecial) > 0).sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'bn'));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`দৈনিক মিল ${dateStr}`, { properties: { defaultRowHeight: 20 } });

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 25;
  ws.getColumn(4).width = 22;
  ws.getColumn(5).width = 16;
  ws.getColumn(6).width = 12;
  ws.getColumn(7).width = 12;
  ws.getColumn(8).width = 14;
  ws.getColumn(9).width = 14;
  ws.getColumn(10).width = 14;

  addTitleRow(ws, title, headers.length, '1F4E79', 14);
  addSubtitleRow(ws, priceRow, headers.length);
  addBlankRow(ws);
  addHeaderRow(ws, headers, '2E75B6');

  let gB = 0, gL = 0, gMS = 0, gLS = 0, gTotal = 0;
  for (let i = 0; i < orders.length; i++) {
    const d = orders[i] as any;
    const tB = Number(d.breakfast) || 0, tL = Number(d.lunch) || 0, tMS = Number(d.morningSpecial) || 0, tLS = Number(d.lunchSpecial) || 0;
    const bill = tB * bp + tL * lp + tMS * msp + tLS * lsp;
    gB += tB; gL += tL; gMS += tMS; gLS += tLS; gTotal += bill;
    addDataRow(ws, [i + 1, d.officeId, d.name, d.designation || '—', d.mobile || '—', tB, tL, tMS, tLS, bill], false, '2E75B6', 6);
  }

  addDataRow(ws, ['মোট', '', '', '', '', gB, gL, gMS, gLS, gTotal], true, '2E75B6', 6);

  setupPrint(ws, 'landscape');

  return sendWorkbook(wb, `দৈনিক_মিল_${dateStr}.xlsx`);
}

// =============================================
// TYPE 5: Market Expense Sheet (বাজার খরচ)
// =============================================

async function exportMarketExpenseSheet(month: string, year: string) {
  if (!month || !year) return NextResponse.json({ success: false, error: 'মাস ও বছর দরকার' }, { status: 400 });

  const result = await query(
    `SELECT * FROM MarketExpense WHERE month = ? AND year = ? ORDER BY expenseDate ASC`,
    [month, year]
  );

  const expenses = result.rows as any[];
  const totalCost = expenses.reduce((sum: number, e: any) => sum + Number(e.totalCost || 0), 0);

  // Group expenses by date for daily subtotals
  const dailyMap = new Map<string, number>();
  for (const e of expenses) {
    const dateKey = e.expenseDate || 'Unknown';
    dailyMap.set(dateKey, (dailyMap.get(dateKey) || 0) + Number(e.totalCost || 0));
  }

  const enMonth = BN_TO_EN[month] || month || '';
  const title = `বাজার খরচের হিসাব — ${month} (${enMonth}), ${year}`;
  const dateRow = `ডাউনলোড তারিখ: ${formatDateDDMMYYYY(new Date())}`;

  const headers = ['ক্রমিক', 'তারিখ', 'মালের বিবরণ', 'খরচ (টাকা)', 'দৈনিক মোট (টাকা)'];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`বাজার খরচ ${month}`, { properties: { defaultRowHeight: 20 } });

  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 45;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 18;

  addTitleRow(ws, title, headers.length, 'C65102', 14);
  addSubtitleRow(ws, dateRow, headers.length);
  addBlankRow(ws);
  addHeaderRow(ws, headers, 'C65102');

  let serial = 1;
  const sortedExpenses = [...expenses].sort((a, b) => {
    const da = a.expenseDate || '';
    const db = b.expenseDate || '';
    return da.localeCompare(db);
  });

  for (let i = 0; i < sortedExpenses.length; i++) {
    const e = sortedExpenses[i];
    const dailyTotal = dailyMap.get(e.expenseDate || '') || 0;
    addDataRow(ws, [
      serial++,
      e.expenseDate ? formatDateDDMMYYYY(e.expenseDate) : '—',
      e.description || '—',
      Number(e.totalCost || 0),
      dailyTotal,
    ], false, 'C65102', 4);
  }

  // Monthly total footer
  const footerRow = addDataRow(ws, ['মোট', '', '', totalCost, totalCost], true, 'C65102', 4);

  setupPrint(ws, 'portrait');

  return sendWorkbook(wb, `বাজার_খরচ_${month}_${year}.xlsx`);
}
