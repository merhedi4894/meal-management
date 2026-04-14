import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { query } from '@/lib/db';
import * as XLSX from 'xlsx';

// ===== Helpers =====

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

function parseBDDate(date: Date | string | number): Date {
  if (typeof date === 'number') return new Date(date);
  const s = String(date).trim();
  // Fix malformed dates missing 'T' separator
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

// ===== Style helpers for cells =====

function makeHeaderStyle(): XLSX.Alignment & XLSX.Font & XLSX.Fill & XLSX.Border {
  return {
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    font: { bold: true, sz: 11, name: 'Arial' },
    fill: { fgColor: { rgb: '4472C4' } },
    border: {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } },
    },
  };
}

function makeHeaderFontColor(): { rgb: string } {
  return { rgb: 'FFFFFF' };
}

function makeDefaultCellStyle(): XLSX.Alignment & XLSX.Border {
  return {
    alignment: { vertical: 'center', wrapText: true },
    border: {
      top: { style: 'thin', color: { rgb: 'D9D9D9' } },
      bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
      left: { style: 'thin', color: { rgb: 'D9D9D9' } },
      right: { style: 'thin', color: { rgb: 'D9D9D9' } },
    },
  };
}

// ===== Common: apply styles to a range =====

function applyStyleToRange(
  ws: XLSX.WorkSheet,
  range: string,
  alignment: XLSX.Alignment,
  font?: Partial<XLSX.Font>,
  fill?: Partial<XLSX.Fill>,
  border?: Partial<XLSX.Border>
) {
  if (!ws[range]) return;
  if (alignment) ws[range].s = { ...ws[range].s, alignment };
  if (font) ws[range].s = { ...ws[range].s, font };
  if (fill) ws[range].s = { ...ws[range].s, fill };
  if (border) ws[range].s = { ...ws[range].s, border };
}

// =============================================
// GET: Excel export — multiple report types
// =============================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'data'; // data | balance | monthly | daily
    const month = searchParams.get('month') || '';
    const year = searchParams.get('year') || '';
    const orderDate = searchParams.get('orderDate') || '';

    if (type === 'data') {
      return exportDataSheet(month, year);
    } else if (type === 'balance') {
      const balType = searchParams.get('balType') || 'due'; // due | advance
      return exportBalanceSheet(balType);
    } else if (type === 'monthly') {
      return exportMonthlyMealSheet(month, year);
    } else if (type === 'daily') {
      return exportDailyMealSheet(orderDate);
    }

    return NextResponse.json({ success: false, error: 'Invalid type' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// =============================================
// TYPE 1: Full Data Sheet (replaces CSV export)
// =============================================

async function exportDataSheet(month: string, year: string) {
  const whereExport: Record<string, unknown> = {};
  if (month && month !== 'all') whereExport.month = month;
  if (year) whereExport.year = year;

  const entries = await db.mealEntry.findMany({
    where: whereExport,
    orderBy: { entryDate: 'asc' }
  });

  // Also load MealUser for designation enrichment
  const usersResult = await query('SELECT officeId, name, mobile, designation FROM MealUser');
  const userMap = new Map<string, { name: string; mobile: string; designation: string }>();
  for (const row of usersResult.rows) {
    const r = row as any;
    if (r.officeId) userMap.set(r.officeId, r);
  }

  // Build worksheet data
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
      i + 1,
      formatDateDDMMYYYY(e.entryDate),
      `${e.month || ''} (${enMonth})`,
      e.year || '',
      e.officeId || '',
      e.name || '',
      e.designation || user?.designation || '',
      e.mobile || user?.mobile || '',
      Number(e.breakfastCount) || 0,
      Number(e.lunchCount) || 0,
      Number(e.morningSpecial) || 0,
      Number(e.lunchSpecial) || 0,
      Number(e.totalBill) || 0,
      Number(e.deposit) || 0,
      e.depositDate ? formatDateDDMMYYYY(e.depositDate) : '',
      Number(e.prevBalance) || 0,
      Number(e.curBalance) || 0,
    ]);
  }

  // Add totals row
  const totalBreakfast = entries.reduce((s, e: any) => s + Number(e.breakfastCount) || 0, 0);
  const totalLunch = entries.reduce((s, e: any) => s + Number(e.lunchCount) || 0, 0);
  const totalMS = entries.reduce((s, e: any) => s + Number(e.morningSpecial) || 0, 0);
  const totalLS = entries.reduce((s, e: any) => s + Number(e.lunchSpecial) || 0, 0);
  const totalBill = entries.reduce((s, e: any) => s + Number(e.totalBill) || 0, 0);
  const totalDeposit = entries.reduce((s, e: any) => s + Number(e.deposit) || 0, 0);
  rows.push([
    'মোট', '', '', '', '', '', '', '',
    totalBreakfast, totalLunch, totalMS, totalLS,
    totalBill, totalDeposit, '', '', ''
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Set column widths
  ws['!cols'] = [
    { wch: 6 },   // ক্রমিক
    { wch: 12 },  // তারিখ
    { wch: 22 },  // মাস
    { wch: 8 },   // বছর
    { wch: 12 },  // অফিস আইডি
    { wch: 25 },  // নাম
    { wch: 22 },  // পদবী
    { wch: 16 },  // মোবাইল
    { wch: 12 },  // সকাল নাস্তা
    { wch: 12 },  // দুপুর মিল
    { wch: 14 },  // সকাল স্পেশাল
    { wch: 14 },  // দুপুর স্পেশাল
    { wch: 14 },  // মোট বিল
    { wch: 14 },  // জমা
    { wch: 14 },  // জমার তারিখ
    { wch: 16 },  // পূর্বের ব্যালেন্স
    { wch: 18 },  // বর্তমান ব্যালেন্স
  ];

  // Apply print settings
  ws['!print'] = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  // Apply styles to header row
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) {
      cell.s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        font: { bold: true, sz: 11, name: 'Arial', color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '4472C4' } },
        border: {
          top: { style: 'thin', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: '000000' } },
          left: { style: 'thin', color: { rgb: '000000' } },
          right: { style: 'thin', color: { rgb: '000000' } },
        },
      };
    }
  }

  // Apply styles to data rows
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const isLastRow = r === range.e.r;
        cell.s = {
          alignment: { vertical: 'center', wrapText: true },
          font: { sz: 10, name: 'Arial', ...(isLastRow ? { bold: true } : {}) },
          fill: isLastRow ? { fgColor: { rgb: 'D6E4F0' } } : { fgColor: { rgb: (r % 2 === 0) ? 'F2F2F2' : 'FFFFFF' } },
          border: {
            top: { style: 'thin', color: { rgb: 'D9D9D9' } },
            bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
            left: { style: 'thin', color: { rgb: 'D9D9D9' } },
            right: { style: 'thin', color: { rgb: 'D9D9D9' } },
          },
        };
        // Right-align number columns (index 8-16)
        if (c >= 8) {
          cell.s.alignment = { ...cell.s.alignment, horizontal: 'right' };
        }
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'মিল ডাটা');

  // Generate file
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fileName = month && month !== 'all'
    ? `মিল_ডাটা_${month}_${year}.xlsx`
    : `মিল_ডাটা_${year}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}

// =============================================
// TYPE 2: Balance Sheet (Due / Advance)
// =============================================

async function exportBalanceSheet(balType: string) {
  // Fetch all MealEntries
  const allEntries = await db.mealEntry.findMany({ orderBy: { entryDate: 'asc' } });

  // Load price settings
  const allPriceSettings = await db.priceSetting.findMany();
  const priceMap = new Map<string, { breakfastPrice: number; lunchPrice: number; morningSpecial: number; lunchSpecial: number }>();
  for (const s of allPriceSettings) {
    priceMap.set(`${s.month}|${s.year}`, {
      breakfastPrice: s.breakfastPrice, lunchPrice: s.lunchPrice,
      morningSpecial: s.morningSpecial, lunchSpecial: s.lunchSpecial,
    });
  }

  // Dedup same-day entries per officeId
  const entryMap = new Map<string, Array<{
    officeId: string; name: string; mobile: string; designation: string;
    month: string; year: string; entryDate: Date | string;
    breakfastCount: number; lunchCount: number; morningSpecial: number; lunchSpecial: number;
    totalBill: number; deposit: number;
  }>>();

  for (const e of allEntries) {
    const oid = (e as any).officeId;
    if (!oid) continue;

    let entryMonth = (e as any).month || '';
    let entryYear = String((e as any).year || '');
    if (!MONTHS_BN.includes(entryMonth) && e.entryDate) {
      const dateStr = String(e.entryDate || '').substring(0, 10);
      const dp = dateStr.split('-');
      if (dp.length === 3) {
        const dateObj = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
        entryMonth = MONTHS_BN[dateObj.getMonth()];
        entryYear = dp[0];
      }
    }

    const dateStr = String(e.entryDate || '').substring(0, 10);
    if (!entryMap.has(oid)) entryMap.set(oid, []);

    const existingArr = entryMap.get(oid)!;
    const existingIdx = existingArr.findIndex(ex => {
      return String(ex.entryDate || '').substring(0, 10) === dateStr;
    });

    if (existingIdx >= 0) {
      const existing = existingArr[existingIdx];
      existing.breakfastCount += Number((e as any).breakfastCount || 0);
      existing.lunchCount += Number((e as any).lunchCount || 0);
      existing.morningSpecial += Number((e as any).morningSpecial || 0);
      existing.lunchSpecial += Number((e as any).lunchSpecial || 0);
      existing.deposit += Number((e as any).deposit || 0);
      if (!existing.name && (e as any).name) existing.name = (e as any).name || '';
      if (!existing.mobile || ((e as any).mobile && (e as any).mobile.length > existing.mobile.length)) existing.mobile = (e as any).mobile || '';
      if (!existing.designation || ((e as any).designation && (e as any).designation.length > existing.designation.length)) existing.designation = (e as any).designation || '';
      if (!existing.month && entryMonth) existing.month = entryMonth;
      if (!existing.year && entryYear) existing.year = entryYear;
    } else {
      entryMap.get(oid)!.push({
        officeId: oid, name: (e as any).name || '', mobile: (e as any).mobile || '',
        designation: (e as any).designation || '', month: entryMonth, year: entryYear,
        entryDate: e.entryDate,
        breakfastCount: Number((e as any).breakfastCount || 0), lunchCount: Number((e as any).lunchCount || 0),
        morningSpecial: Number((e as any).morningSpecial || 0), lunchSpecial: Number((e as any).lunchSpecial || 0),
        totalBill: Number((e as any).totalBill || 0), deposit: Number((e as any).deposit || 0),
      });
    }
  }

  // Calculate balance per officeId
  const balanceList: Array<{
    officeId: string; name: string; mobile: string; designation: string;
    totalBreakfast: number; totalLunch: number;
    totalMorningSpecial: number; totalLunchSpecial: number;
    totalBill: number; totalDeposit: number; curBalance: number;
  }> = [];

  for (const [oid, entries] of entryMap) {
    const sorted = [...entries].sort((a, b) => parseBDDate(a.entryDate).getTime() - parseBDDate(b.entryDate).getTime());
    const first = sorted[0];
    let runningBalance = 0;
    let tB = 0, tL = 0, tMS = 0, tLS = 0, tBill = 0, tDep = 0;

    for (const entry of sorted) {
      const price = priceMap.get(`${entry.month}|${entry.year}`);
      const bill = entry.breakfastCount * (price?.breakfastPrice || 0)
        + entry.lunchCount * (price?.lunchPrice || 0)
        + entry.morningSpecial * (price?.morningSpecial || 0)
        + entry.lunchSpecial * (price?.lunchSpecial || 0);
      runningBalance = runningBalance + entry.deposit - bill;
      tB += entry.breakfastCount;
      tL += entry.lunchCount;
      tMS += entry.morningSpecial;
      tLS += entry.lunchSpecial;
      tBill += bill;
      tDep += entry.deposit;
    }

    balanceList.push({
      officeId: oid, name: first.name, mobile: first.mobile, designation: first.designation,
      totalBreakfast: tB, totalLunch: tL, totalMorningSpecial: tMS, totalLunchSpecial: tLS,
      totalBill: tBill, totalDeposit: tDep, curBalance: runningBalance,
    });
  }

  // Filter by type
  const isDue = balType === 'due';
  const filtered = balanceList
    .filter(e => isDue ? e.curBalance < 0 : e.curBalance > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'bn'));

  const title = isDue ? 'বকেয়া টাকার হিসাব' : 'অগ্রিম টাকার হিসাব';

  // Build worksheet
  const titleRow = [title];
  const dateRow = [`তারিখ: ${formatDateDDMMYYYY(new Date())}`];
  const emptyRow = [''];
  const headers = ['ক্রমিক', 'অফিস আইডি', 'নাম', 'পদবী', 'মোবাইল', 'মোট সকাল নাস্তা', 'মোট দুপুর মিল', 'মোট বিল (টাকা)', 'মোট জমা (টাকা)', `${isDue ? 'বকেয়া পরিমাণ' : 'অগ্রিম পরিমাণ'} (টাকা)`];

  const rows: (string | number)[][] = [];
  let grandTotal = 0;
  for (let i = 0; i < filtered.length; i++) {
    const e = filtered[i];
    const amount = isDue ? Math.abs(e.curBalance) : e.curBalance;
    grandTotal += amount;
    rows.push([
      i + 1, e.officeId, e.name || '—', e.designation || '—', e.mobile || '—',
      e.totalBreakfast, e.totalLunch, e.totalBill, e.totalDeposit, amount,
    ]);
  }

  // Footer row
  rows.push(['মোট', '', '', '', '', '', '', '', '', grandTotal]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([titleRow, dateRow, emptyRow, headers, ...rows]);

  // Column widths
  ws['!cols'] = [
    { wch: 6 },   // ক্রমিক
    { wch: 12 },  // অফিস আইডি
    { wch: 25 },  // নাম
    { wch: 22 },  // পদবী
    { wch: 16 },  // মোবাইল
    { wch: 14 },  // মোট সকাল নাস্তা
    { wch: 14 },  // মোট দুপুর মিল
    { wch: 14 },  // মোট বিল
    { wch: 14 },  // মোট জমা
    { wch: 18 },  // পরিমাণ
  ];

  // Merge title row
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }];

  // Style title
  const titleCell = ws['A1'];
  if (titleCell) {
    titleCell.s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, sz: 16, name: 'Arial', color: { rgb: isDue ? 'C00000' : '006600' } },
    };
  }
  const dateCell = ws['A2'];
  if (dateCell) {
    dateCell.s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { sz: 10, name: 'Arial', italic: true, color: { rgb: '666666' } },
    };
  }

  // Style header row (row 3)
  for (let c = 0; c <= 9; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 3, c })];
    if (cell) {
      cell.s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        font: { bold: true, sz: 10, name: 'Arial', color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: isDue ? 'C00000' : '4472C4' } },
        border: {
          top: { style: 'thin', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: '000000' } },
          left: { style: 'thin', color: { rgb: '000000' } },
          right: { style: 'thin', color: { rgb: '000000' } },
        },
      };
    }
  }

  // Style data rows
  for (let r = 4; r < 4 + filtered.length; r++) {
    for (let c = 0; c <= 9; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const isLastRow = r === 4 + filtered.length;
        cell.s = {
          alignment: { vertical: 'center', wrapText: true },
          font: { sz: 10, name: 'Arial', ...(isLastRow ? { bold: true } : {}) },
          fill: isLastRow ? { fgColor: { rgb: 'D6E4F0' } } : { fgColor: { rgb: (r % 2 === 0) ? 'F9F9F9' : 'FFFFFF' } },
          border: {
            top: { style: 'thin', color: { rgb: 'D9D9D9' } },
            bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
            left: { style: 'thin', color: { rgb: 'D9D9D9' } },
            right: { style: 'thin', color: { rgb: 'D9D9D9' } },
          },
        };
        // Right-align number columns
        if (c >= 5) {
          cell.s.alignment = { ...cell.s.alignment, horizontal: 'right' };
        }
        // Color the amount column
        if (c === 9 && !isLastRow) {
          cell.s.font = { ...cell.s.font, bold: true, color: { rgb: isDue ? 'C00000' : '006600' } };
        }
      }
    }
  }

  // Print settings
  ws['!print'] = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  XLSX.utils.book_append_sheet(wb, ws, isDue ? 'বকেয়া টাকা' : 'অগ্রিম টাকা');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fileName = isDue ? 'বকেয়া_টাকা' : 'অগ্রিম_টাকা';
  const today = new Date().toISOString().split('T')[0];

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(`${fileName}_${today}.xlsx`)}"`,
    },
  });
}

// =============================================
// TYPE 3: Monthly Meal Summary
// =============================================

async function exportMonthlyMealSheet(month: string, year: string) {
  if (!month || !year) {
    return NextResponse.json({ success: false, error: 'মাস ও বছর দরকার' }, { status: 400 });
  }

  // Get prices
  const priceResult = await query('SELECT * FROM PriceSetting WHERE month = ? AND year = ?', [month, year]);
  const prices = priceResult.rows.length > 0 ? priceResult.rows[0] as any : null;
  const bp = Number(prices?.breakfastPrice) || 0;
  const lp = Number(prices?.lunchPrice) || 0;
  const ms = Number(prices?.morningSpecial) || 0;
  const ls = Number(prices?.lunchSpecial) || 0;

  // Get meal entries
  const result = await query(
    `SELECT officeId, MAX(name) as name, MAX(mobile) as mobile, MAX(designation) as designation,
            COALESCE(SUM(breakfastCount),0) as totalBreakfast,
            COALESCE(SUM(lunchCount),0) as totalLunch,
            COALESCE(SUM(morningSpecial),0) as totalMorningSpecial,
            COALESCE(SUM(lunchSpecial),0) as totalLunchSpecial
     FROM MealEntry WHERE month = ? AND year = ? AND officeId != '' AND officeId IS NOT NULL
     GROUP BY officeId ORDER BY name ASC`,
    [month, year]
  );

  const enMonth = BN_TO_EN[month] || month || '';
  const title = `মাসিক মিলের হিসাব — ${month} (${enMonth}), ${year}`;

  let grandB = 0, grandL = 0, grandMS = 0, grandLS = 0;
  const details: Array<{
    officeId: string; name: string; designation: string; mobile: string;
    totalBreakfast: number; totalLunch: number; totalMorningSpecial: number; totalLunchSpecial: number;
    totalBill: number;
  }> = [];

  for (const d of result.rows) {
    const r = d as any;
    const tB = Number(r.totalBreakfast) || 0;
    const tL = Number(r.totalLunch) || 0;
    const tMS = Number(r.totalMorningSpecial) || 0;
    const tLS = Number(r.totalLunchSpecial) || 0;
    grandB += tB; grandL += tL; grandMS += tMS; grandLS += tLS;
    details.push({
      officeId: r.officeId || '', name: r.name || '', designation: r.designation || '', mobile: r.mobile || '',
      totalBreakfast: tB, totalLunch: tL, totalMorningSpecial: tMS, totalLunchSpecial: tLS,
      totalBill: tB * bp + tL * lp + tMS * ms + tLS * ls,
    });
  }

  const grandTotal = grandB * bp + grandL * lp + grandMS * ms + grandLS * ls;
  const grandDeposit = await query(
    `SELECT COALESCE(SUM(deposit), 0) as total FROM MealEntry WHERE month = ? AND year = ?`,
    [month, year]
  );
  const totalDep = Number((grandDeposit.rows[0] as any)?.total) || 0;

  // Build worksheet
  const titleRow = [title];
  const priceRow = [`সকাল নাস্তা: ${bp} টাকা | দুপুর মিল: ${lp} টাকা | সকাল স্পেশাল: ${ms} টাকা | দুপুর স্পেশাল: ${ls} টাকা`];
  const emptyRow = [''];
  const headers = ['ক্রমিক', 'অফিস আইডি', 'নাম', 'পদবী', 'মোবাইল', 'সকাল নাস্তা', 'দুপুর মিল', 'সকাল স্পেশাল', 'দুপুর স্পেশাল', 'মোট বিল (টাকা)'];

  const rows: (string | number)[][] = [];
  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    rows.push([
      i + 1, d.officeId, d.name, d.designation || '—', d.mobile || '—',
      d.totalBreakfast, d.totalLunch, d.totalMorningSpecial, d.totalLunchSpecial, d.totalBill,
    ]);
  }

  // Grand total row
  rows.push(['মোট', '', '', '', '', grandB, grandL, grandMS, grandLS, grandTotal]);
  // Deposit row
  rows.push(['', '', '', '', '', '', '', '', 'মোট জমা:', totalDep]);
  rows.push(['', '', '', '', '', '', '', '', 'নিট বকেয়া:', grandTotal - totalDep]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([titleRow, priceRow, emptyRow, headers, ...rows]);

  ws['!cols'] = [
    { wch: 6 }, { wch: 12 }, { wch: 25 }, { wch: 22 }, { wch: 16 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  ];

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
  ];

  // Title style
  const titleCell = ws['A1'];
  if (titleCell) {
    titleCell.s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, sz: 14, name: 'Arial', color: { rgb: '1F4E79' } },
    };
  }
  const priceCell = ws['A2'];
  if (priceCell) {
    priceCell.s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { sz: 9, name: 'Arial', italic: true, color: { rgb: '666666' } },
    };
  }

  // Header style
  for (let c = 0; c <= 9; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 3, c })];
    if (cell) {
      cell.s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        font: { bold: true, sz: 10, name: 'Arial', color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '1F4E79' } },
        border: {
          top: { style: 'thin', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: '000000' } },
          left: { style: 'thin', color: { rgb: '000000' } },
          right: { style: 'thin', color: { rgb: '000000' } },
        },
      };
    }
  }

  // Data rows
  for (let r = 4; r <= 4 + details.length + 2; r++) {
    for (let c = 0; c <= 9; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const isSummary = r >= 4 + details.length;
        cell.s = {
          alignment: { vertical: 'center', wrapText: true },
          font: { sz: 10, name: 'Arial', ...(isSummary ? { bold: true } : {}) },
          fill: isSummary ? { fgColor: { rgb: 'D6E4F0' } } : { fgColor: { rgb: (r % 2 === 0) ? 'F2F2F2' : 'FFFFFF' } },
          border: {
            top: { style: 'thin', color: { rgb: 'D9D9D9' } },
            bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
            left: { style: 'thin', color: { rgb: 'D9D9D9' } },
            right: { style: 'thin', color: { rgb: 'D9D9D9' } },
          },
        };
        if (c >= 5) cell.s.alignment = { ...cell.s.alignment, horizontal: 'right' };
      }
    }
  }

  ws['!print'] = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  XLSX.utils.book_append_sheet(wb, ws, `মাসিক মিল ${month}`);

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fileName = `মাসিক_মিল_${month}_${year}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}

// =============================================
// TYPE 4: Daily Meal Order Sheet
// =============================================

async function exportDailyMealSheet(orderDate: string) {
  if (!orderDate) {
    return NextResponse.json({ success: false, error: 'তারিখ দরকার' }, { status: 400 });
  }

  const dateStr = orderDate.substring(0, 10);

  const result = await query(
    `SELECT officeId, MAX(name) as name, MAX(mobile) as mobile, MAX(designation) as designation,
            COALESCE(SUM(breakfastCount),0) as breakfast,
            COALESCE(SUM(lunchCount),0) as lunch,
            COALESCE(SUM(morningSpecial),0) as morningSpecial,
            COALESCE(SUM(lunchSpecial),0) as lunchSpecial
     FROM MealEntry WHERE substr(entryDate, 1, 10) = ? AND officeId != '' AND officeId IS NOT NULL
     GROUP BY officeId ORDER BY name ASC`,
    [dateStr]
  );

  // Get prices
  const { month, year } = (function() {
    const dp = dateStr.split('-');
    const dateObj = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
    return { month: MONTHS_BN[dateObj.getMonth()], year: dp[0] };
  })();

  const priceResult = await query('SELECT * FROM PriceSetting WHERE month = ? AND year = ?', [month, year]);
  const prices = priceResult.rows.length > 0 ? priceResult.rows[0] as any : null;
  const bp = Number(prices?.breakfastPrice) || 0;
  const lp = Number(prices?.lunchPrice) || 0;
  const msp = Number(prices?.morningSpecial) || 0;
  const lsp = Number(prices?.lunchSpecial) || 0;

  const title = `দৈনিক মিল অর্ডার — ${formatDateDDMMYYYY(dateStr)}`;
  const priceRow = [`সকাল নাস্তা: ${bp} টাকা | দুপুর মিল: ${lp} টাকা | সকাল স্পেশাল: ${msp} টাকা | দুপুর স্পেশাল: ${lsp} টাকা`];

  const headers = ['ক্রমিক', 'অফিস আইডি', 'নাম', 'পদবী', 'মোবাইল', 'সকাল নাস্তা', 'দুপুর মিল', 'সকাল স্পেশাল', 'দুপুর স্পেশাল', 'মোট বিল (টাকা)'];

  const orders = result.rows
    .filter((d: any) => Number(d.breakfast) > 0 || Number(d.lunch) > 0 || Number(d.morningSpecial) > 0 || Number(d.lunchSpecial) > 0)
    .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'bn'));

  let gB = 0, gL = 0, gMS = 0, gLS = 0, gTotal = 0;
  const rows: (string | number)[][] = [];
  for (let i = 0; i < orders.length; i++) {
    const d = orders[i] as any;
    const tB = Number(d.breakfast) || 0;
    const tL = Number(d.lunch) || 0;
    const tMS = Number(d.morningSpecial) || 0;
    const tLS = Number(d.lunchSpecial) || 0;
    const bill = tB * bp + tL * lp + tMS * msp + tLS * lsp;
    gB += tB; gL += tL; gMS += tMS; gLS += tLS; gTotal += bill;
    rows.push([
      i + 1, d.officeId, d.name, d.designation || '—', d.mobile || '—',
      tB, tL, tMS, tLS, bill,
    ]);
  }

  rows.push(['মোট', '', '', '', '', gB, gL, gMS, gLS, gTotal]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([titleRow, priceRow, [''], headers, ...rows]);

  ws['!cols'] = [
    { wch: 6 }, { wch: 12 }, { wch: 25 }, { wch: 22 }, { wch: 16 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
  ];

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
  ];

  const titleCell = ws['A1'];
  if (titleCell) {
    titleCell.s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { bold: true, sz: 14, name: 'Arial', color: { rgb: '1F4E79' } },
    };
  }
  const priceCell = ws['A2'];
  if (priceCell) {
    priceCell.s = {
      alignment: { horizontal: 'center', vertical: 'center' },
      font: { sz: 9, name: 'Arial', italic: true, color: { rgb: '666666' } },
    };
  }

  for (let c = 0; c <= 9; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 3, c })];
    if (cell) {
      cell.s = {
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        font: { bold: true, sz: 10, name: 'Arial', color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '2E75B6' } },
        border: {
          top: { style: 'thin', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: '000000' } },
          left: { style: 'thin', color: { rgb: '000000' } },
          right: { style: 'thin', color: { rgb: '000000' } },
        },
      };
    }
  }

  for (let r = 4; r <= 4 + orders.length; r++) {
    for (let c = 0; c <= 9; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) {
        const isLastRow = r === 4 + orders.length;
        cell.s = {
          alignment: { vertical: 'center', wrapText: true },
          font: { sz: 10, name: 'Arial', ...(isLastRow ? { bold: true } : {}) },
          fill: isLastRow ? { fgColor: { rgb: 'D6E4F0' } } : { fgColor: { rgb: (r % 2 === 0) ? 'F2F2F2' : 'FFFFFF' } },
          border: {
            top: { style: 'thin', color: { rgb: 'D9D9D9' } },
            bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
            left: { style: 'thin', color: { rgb: 'D9D9D9' } },
            right: { style: 'thin', color: { rgb: 'D9D9D9' } },
          },
        };
        if (c >= 5) cell.s.alignment = { ...cell.s.alignment, horizontal: 'right' };
      }
    }
  }

  ws['!print'] = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  XLSX.utils.book_append_sheet(wb, ws, `দৈনিক মিল ${dateStr}`);

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fileName = `দৈনিক_মিল_${dateStr}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  });
}
