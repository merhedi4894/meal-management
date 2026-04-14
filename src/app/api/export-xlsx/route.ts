import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { query } from '@/lib/db';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

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
  const fixed = s.replace(/^(\d{4}-\d{2}-\d{2})(\d)/, '$1T$2');
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

// Post-process XLSX buffer to inject print settings into XML
async function injectPrintSettings(xlsxBuffer: Buffer, orientation: 'landscape' | 'portrait' = 'landscape'): Promise<Buffer> {
  try {
    const zip = await JSZip.loadAsync(xlsxBuffer);
    const sheetFiles: string[] = [];
    zip.forEach((path) => {
      if (path.match(/^xl\/worksheets\/sheet\d+\.xml$/)) sheetFiles.push(path);
    });

    for (const sheetPath of sheetFiles) {
      let xml = await zip.file(sheetPath)?.async('string');
      if (!xml) continue;

      // Inject pageSetupPr with fitToPage
      if (!xml.includes('pageSetupPr')) {
        xml = xml.replace(
          '<sheetPr>',
          '<sheetPr><pageSetupPr fitToPage="1"/></sheetPr>'
        );
      }

      // Inject <pageSetup> with fit-to-page
      if (!xml.includes('<pageSetup')) {
        xml = xml.replace(
          '</worksheet>',
          `<pageSetup paperSize="9" orientation="${orientation}" fitToWidth="1" fitToHeight="0" fitToPage="1"/></worksheet>`
        );
      } else {
        xml = xml.replace(
          /<pageSetup[^/]*\/>/,
          `<pageSetup paperSize="9" orientation="${orientation}" fitToWidth="1" fitToHeight="0" fitToPage="1"/>`
        );
      }

      zip.file(sheetPath, xml);
    }

    return await zip.generateAsync({ type: 'nodebuffer' });
  } catch {
    return xlsxBuffer;
  }
}

// Apply header style to row 3 (index 3)
function styleHeaderRow(ws: XLSX.WorkSheet, colCount: number, headerRgb: string = '4472C4', startRow: number = 3) {
  for (let c = 0; c < colCount; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: startRow, c })];
    if (cell) {
      cell.s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        font: { bold: true, sz: 10, name: 'Arial', color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: headerRgb } },
        border: {
          top: { style: 'thin', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: '000000' } },
          left: { style: 'thin', color: { rgb: '000000' } },
          right: { style: 'thin', color: { rgb: '000000' } },
        },
      };
    }
  }
}

// Apply data row styles with zebra striping
function styleDataRows(ws: XLSX.WorkSheet, startRow: number, endRow: number, colCount: number, numColStart: number = 5, footerRowCount: number = 0) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = 0; c < colCount; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const isFooter = r > endRow - footerRowCount && footerRowCount > 0;
        cell.s = {
          alignment: { vertical: 'center', wrapText: true },
          font: { sz: 10, name: 'Arial', ...(isFooter ? { bold: true } : {}) },
          fill: isFooter
            ? { fgColor: { rgb: 'D6E4F0' } }
            : { fgColor: { rgb: (r % 2 === 0) ? 'F2F2F2' : 'FFFFFF' } },
          border: {
            top: { style: 'thin', color: { rgb: 'D9D9D9' } },
            bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
            left: { style: 'thin', color: { rgb: 'D9D9D9' } },
            right: { style: 'thin', color: { rgb: 'D9D9D9' } },
          },
        };
        if (c >= numColStart) {
          cell.s.alignment = { ...cell.s.alignment, horizontal: 'right' };
        }
      }
    }
  }
}

// Generate xlsx buffer with print settings and send as response
async function buildXlsxResponse(wb: XLSX.WorkBook, fileName: string, orientation: 'landscape' | 'portrait' = 'landscape') {
  const rawBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const buffer = await injectPrintSettings(rawBuffer, orientation);

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
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

  // Enrich with MealUser data
  const usersResult = await query('SELECT officeId, name, mobile, designation FROM MealUser');
  const userMap = new Map<string, { name: string; mobile: string; designation: string }>();
  for (const row of usersResult.rows) {
    const r = row as any;
    if (r.officeId) userMap.set(r.officeId, r);
  }

  const headers = [
    'ক্রমিক', 'তারিখ', 'মাস', 'বছর', 'অফিস আইডি', 'নাম', 'পদবী', 'মোবাইল',
    'সকাল নাস্তা', 'দুপুর মিল', 'সকাল স্পেশাল', 'দুপুর স্পেশাল',
    'মোট বিল (টাকা)', 'জমা (টাকা)', 'জমার তারিখ', 'পূর্বের ব্যালেন্স', 'বর্তমান ব্যালেন্স'
  ];

  const rows: (string | number)[][] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as any;
    const user = userMap.get(e.officeId);
    const enMonth = BN_TO_EN[e.month] || e.month || '';
    rows.push([
      i + 1, formatDateDDMMYYYY(e.entryDate),
      `${e.month || ''} (${enMonth})`, e.year || '',
      e.officeId || '', e.name || '', e.designation || user?.designation || '', e.mobile || user?.mobile || '',
      Number(e.breakfastCount) || 0, Number(e.lunchCount) || 0, Number(e.morningSpecial) || 0, Number(e.lunchSpecial) || 0,
      Number(e.totalBill) || 0, Number(e.deposit) || 0,
      e.depositDate ? formatDateDDMMYYYY(e.depositDate) : '',
      Number(e.prevBalance) || 0, Number(e.curBalance) || 0,
    ]);
  }

  // Totals row
  const tB = entries.reduce((s, e: any) => s + Number(e.breakfastCount) || 0, 0);
  const tL = entries.reduce((s, e: any) => s + Number(e.lunchCount) || 0, 0);
  const tMS = entries.reduce((s, e: any) => s + Number(e.morningSpecial) || 0, 0);
  const tLS = entries.reduce((s, e: any) => s + Number(e.lunchSpecial) || 0, 0);
  const tBill = entries.reduce((s, e: any) => s + Number(e.totalBill) || 0, 0);
  const tDep = entries.reduce((s, e: any) => s + Number(e.deposit) || 0, 0);
  rows.push(['মোট', '', '', '', '', '', '', '', tB, tL, tMS, tLS, tBill, tDep, '', '', '']);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 6 }, { wch: 12 }, { wch: 22 }, { wch: 8 }, { wch: 12 }, { wch: 25 },
    { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 18 },
  ];

  // Style header (row 0)
  for (let c = 0; c < headers.length; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) {
      cell.s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        font: { bold: true, sz: 10, name: 'Arial', color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '4472C4' } },
        border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } }, left: { style: 'thin', color: { rgb: '000000' } }, right: { style: 'thin', color: { rgb: '000000' } } },
      };
    }
  }

  // Style data rows
  const lastRow = rows.length;
  for (let r = 1; r <= lastRow; r++) {
    for (let c = 0; c < headers.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const isLast = r === lastRow;
        cell.s = {
          alignment: { vertical: 'center', wrapText: true },
          font: { sz: 10, name: 'Arial', ...(isLast ? { bold: true } : {}) },
          fill: isLast ? { fgColor: { rgb: 'D6E4F0' } } : { fgColor: { rgb: (r % 2 === 0) ? 'F2F2F2' : 'FFFFFF' } },
          border: { top: { style: 'thin', color: { rgb: 'D9D9D9' } }, bottom: { style: 'thin', color: { rgb: 'D9D9D9' } }, left: { style: 'thin', color: { rgb: 'D9D9D9' } }, right: { style: 'thin', color: { rgb: 'D9D9D9' } } },
        };
        if (c >= 8) cell.s.alignment = { ...cell.s.alignment, horizontal: 'right' };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'মিল ডাটা');

  const fileName = month && month !== 'all' ? `মিল_ডাটা_${month}_${year}.xlsx` : `মিল_ডাটা_${year}.xlsx`;
  return buildXlsxResponse(wb, fileName, 'landscape');
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

  const headers = ['ক্রমিক', 'অফিস আইডি', 'নাম', 'পদবী', 'মোবাইল', 'মোট সকাল নাস্তা', 'মোট দুপুর মিল', 'মোট বিল (টাকা)', 'মোট জমা (টাকা)', `${isDue ? 'বকেয়া' : 'অগ্রিম'} (টাকা)`];

  const rows: (string | number)[][] = [];
  let grandTotal = 0;
  for (let i = 0; i < filtered.length; i++) {
    const e = filtered[i];
    const amount = isDue ? Math.abs(e.curBalance) : e.curBalance;
    grandTotal += amount;
    rows.push([i + 1, e.officeId, e.name || '—', e.designation || '—', e.mobile || '—', e.totalBreakfast, e.totalLunch, e.totalBill, e.totalDeposit, amount]);
  }
  rows.push(['মোট', '', '', '', '', '', '', '', '', grandTotal]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[title], [`তারিখ: ${formatDateDDMMYYYY(new Date())}`], [''], headers, ...rows]);

  ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 25 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }];

  // Title
  const tc = ws['A1'];
  if (tc) tc.s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true, sz: 16, name: 'Arial', color: { rgb: isDue ? 'C00000' : '006600' } } };
  const dc = ws['A2'];
  if (dc) dc.s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { sz: 10, name: 'Arial', italic: true, color: { rgb: '666666' } } };

  styleHeaderRow(ws, headers.length, isDue ? 'C00000' : '4472C4', 3);
  styleDataRows(ws, 4, 4 + filtered.length, headers.length, 5, 1);

  // Color amount column
  for (let r = 4; r < 4 + filtered.length; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 9 })];
    if (cell) cell.s.font = { ...cell.s.font, bold: true, color: { rgb: isDue ? 'C00000' : '006600' } };
  }

  XLSX.utils.book_append_sheet(wb, ws, isDue ? 'বকেয়া টাকা' : 'অগ্রিম টাকা');
  const today = new Date().toISOString().split('T')[0];
  const fileName = `${isDue ? 'বকেয়া_টাকা' : 'অগ্রিম_টাকা'}_${today}.xlsx`;
  return buildXlsxResponse(wb, fileName, 'portrait');
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

  const rows: (string | number)[][] = details.map((d, i) => [i + 1, d.officeId, d.name, d.designation || '—', d.mobile || '—', d.totalBreakfast, d.totalLunch, d.totalMorningSpecial, d.totalLunchSpecial, d.totalBill]);
  rows.push(['মোট', '', '', '', '', gB, gL, gMS, gLS, grandTotal]);
  rows.push(['', '', '', '', '', '', '', '', 'মোট জমা:', totalDep]);
  rows.push(['', '', '', '', '', '', '', '', 'নিট বকেয়া:', grandTotal - totalDep]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[title], [priceRow], [''], headers, ...rows]);
  ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 25 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }];

  const tc = ws['A1'];
  if (tc) tc.s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true, sz: 14, name: 'Arial', color: { rgb: '1F4E79' } } };
  const pc = ws['A2'];
  if (pc) pc.s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { sz: 9, name: 'Arial', italic: true, color: { rgb: '666666' } } };

  styleHeaderRow(ws, headers.length, '1F4E79', 3);
  styleDataRows(ws, 4, 4 + details.length + 2, headers.length, 5, 3);

  XLSX.utils.book_append_sheet(wb, ws, `মাসিক মিল ${month}`);
  return buildXlsxResponse(wb, `মাসিক_মিল_${month}_${year}.xlsx`, 'landscape');
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

  let gB = 0, gL = 0, gMS = 0, gLS = 0, gTotal = 0;
  const rows: (string | number)[][] = [];
  for (let i = 0; i < orders.length; i++) {
    const d = orders[i] as any;
    const tB = Number(d.breakfast) || 0, tL = Number(d.lunch) || 0, tMS = Number(d.morningSpecial) || 0, tLS = Number(d.lunchSpecial) || 0;
    const bill = tB * bp + tL * lp + tMS * msp + tLS * lsp;
    gB += tB; gL += tL; gMS += tMS; gLS += tLS; gTotal += bill;
    rows.push([i + 1, d.officeId, d.name, d.designation || '—', d.mobile || '—', tB, tL, tMS, tLS, bill]);
  }
  rows.push(['মোট', '', '', '', '', gB, gL, gMS, gLS, gTotal]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[title], [priceRow], [''], headers, ...rows]);
  ws['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 25 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }];

  const tc = ws['A1'];
  if (tc) tc.s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { bold: true, sz: 14, name: 'Arial', color: { rgb: '1F4E79' } } };
  const pc = ws['A2'];
  if (pc) pc.s = { alignment: { horizontal: 'center', vertical: 'center' }, font: { sz: 9, name: 'Arial', italic: true, color: { rgb: '666666' } } };

  styleHeaderRow(ws, headers.length, '2E75B6', 3);
  styleDataRows(ws, 4, 4 + orders.length, headers.length, 5, 1);

  XLSX.utils.book_append_sheet(wb, ws, `দৈনিক মিল ${dateStr}`);
  return buildXlsxResponse(wb, `দৈনিক_মিল_${dateStr}.xlsx`, 'landscape');
}

// =============================================
// TYPE 5: Market Expense Sheet (বাজার খরচ)
// =============================================

async function exportMarketExpenseSheet(month: string, year: string) {
  if (!month || !year) return NextResponse.json({ success: false, error: 'মাস ও বছর দরকার' }, { status: 400 });

  // Fetch market expenses from database
  const result = await query(
    `SELECT * FROM MarketExpense WHERE month = ? AND year = ? ORDER BY expenseDate ASC`,
    [month, year]
  );

  const expenses = result.rows as any[];
  const totalCost = expenses.reduce((sum: number, e: any) => sum + Number(e.totalCost || 0), 0);

  const enMonth = BN_TO_EN[month] || month || '';
  const title = `বাজার খরচের হিসাব — ${month} (${enMonth}), ${year}`;
  const dateRow = `ডাউনলোড তারিখ: ${formatDateDDMMYYYY(new Date())}`;

  const headers = ['ক্রমিক', 'তারিখ', 'মালের বিবরণ', 'খরচ (টাকা)'];

  const rows: (string | number)[][] = [];
  for (let i = 0; i < expenses.length; i++) {
    const e = expenses[i];
    rows.push([
      i + 1,
      e.expenseDate ? formatDateDDMMYYYY(e.expenseDate) : '—',
      e.description || '—',
      Number(e.totalCost || 0),
    ]);
  }

  // Footer: total row
  rows.push(['মোট খরচ', '', '', totalCost]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[title], [dateRow], [''], headers, ...rows]);

  ws['!cols'] = [
    { wch: 8 },   // ক্রমিক
    { wch: 14 },  // তারিখ
    { wch: 45 },  // মালের বিবরণ
    { wch: 16 },  // খরচ
  ];

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
  ];

  // Title style
  const tc = ws['A1'];
  if (tc) tc.s = {
    alignment: { horizontal: 'center', vertical: 'center' },
    font: { bold: true, sz: 14, name: 'Arial', color: { rgb: 'C65102' } },
  };
  const dc = ws['A2'];
  if (dc) dc.s = {
    alignment: { horizontal: 'center', vertical: 'center' },
    font: { sz: 10, name: 'Arial', italic: true, color: { rgb: '666666' } },
  };

  // Header row (row 3)
  styleHeaderRow(ws, headers.length, 'C65102', 3);

  // Data rows
  for (let r = 4; r <= 4 + expenses.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const isFooter = r === 4 + expenses.length;
        cell.s = {
          alignment: { vertical: 'center', wrapText: true },
          font: { sz: 10, name: 'Arial', ...(isFooter ? { bold: true, color: { rgb: 'C65102' } } : {}) },
          fill: isFooter ? { fgColor: { rgb: 'FFF2CC' } } : { fgColor: { rgb: (r % 2 === 0) ? 'F2F2F2' : 'FFFFFF' } },
          border: {
            top: { style: 'thin', color: { rgb: isFooter ? 'C65102' : 'D9D9D9' } },
            bottom: { style: 'thin', color: { rgb: isFooter ? 'C65102' : 'D9D9D9' } },
            left: { style: 'thin', color: { rgb: 'D9D9D9' } },
            right: { style: 'thin', color: { rgb: 'D9D9D9' } },
          },
        };
        if (c === 3) cell.s.alignment = { ...cell.s.alignment, horizontal: 'right' };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, `বাজার খরচ ${month}`);
  return buildXlsxResponse(wb, `বাজার_খরচ_${month}_${year}.xlsx`, 'portrait');
}
