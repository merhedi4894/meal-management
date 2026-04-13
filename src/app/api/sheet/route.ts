import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const DEFAULT_SHEET_ID = '1CUAXM6Azw3R1o1LeADNM0lBxe69WwpeablpzNXIYjXc';

// Google Sheets-কে ব্লক না করার জন্য প্রয়োজনীয় হেডার
const GOOGLE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/csv,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

interface CsvRow {
  [key: string]: string;
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

function parseCsvRows(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

// CSV ডাটা পার্স করে headers ও rows দুটোই রিটার্ন করে
function parseCsvWithHeaders(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }
  return { headers, rows };
}

// একাধিক endpoint থেকে CSV ট্রাই করে — যেটি পাবে সেটি রিটার্ন করবে
async function fetchCsvFromSheet(sheetId: string, sheetName: string): Promise<{ headers: string[]; rows: CsvRow[] }> {
  // Method 1: gviz/tq CSV (প্রাইমারি — সবচেয়ে নির্ভরযোগ্য)
  const endpoints = [
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`,
  ];

  let lastError = '';
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        headers: GOOGLE_HEADERS,
        redirect: 'follow',
      });

      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }

      const text = await res.text();

      // gviz/tq কখনো এরর পেজ রিটার্ন করতে পারে — HTML চেক
      if (text.trimStart().startsWith('<!') || text.trimStart().startsWith('<html') || text.includes('<title>Error</title>')) {
        lastError = 'Google login redirect — শীট পাবলিক নয়';
        continue;
      }

      // ফাঁকা বা খুব ছোট রেসপন্স = সম্ভবত এরর
      if (text.trim().length < 5) {
        lastError = 'ফাঁকা রেসপন্স';
        continue;
      }

      const result = parseCsvWithHeaders(text);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(lastError || 'সব endpoint ব্যর্থ');
}

// লেগেসি — শুধু rows দরকার হলে
async function fetchSheet(sheetId: string, sheetName: string): Promise<CsvRow[]> {
  const { rows } = await fetchCsvFromSheet(sheetId, sheetName);
  return rows;
}

// Extract sheet ID from a Google Sheets URL — বিভিন্ন ফরম্যাট সাপোর্ট
function extractSheetId(url: string): string | null {
  // স্ট্যান্ডার্ড: /spreadsheets/d/{ID}/edit
  // কপি: /spreadsheets/d/{ID}/copy
  // পাবলিক: /spreadsheets/d/{ID}/pubhtml
  // মোবাইল: /spreadsheets/d/{ID}/
  // শর্ট: /d/{ID}/
  const patterns = [
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
    /\/d\/([a-zA-Z0-9-_]{20,})/,
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}

// gviz থেকে শীটের নাম আবিষ্কার করুন — query parameter থেকে
async function discoverSheetsFromHtml(sheetId: string): Promise<Array<{ name: string; gid: string }>> {
  const sheets: Array<{ name: string; gid: string }> = [];
  try {
    const htmlUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`;
    const res = await fetch(htmlUrl, {
      cache: 'no-store',
      headers: GOOGLE_HEADERS,
      redirect: 'follow',
    });
    if (res.ok) {
      const html = await res.text();
      // বিভিন্ন প্যাটার্নে শীট বাটন খুঁজুন
      const patterns = [
        /id="sheet-button-(\d+)"[^>]*title="([^"]*)"/g,
        /data-sheet-name="([^"]*)"[^>]*data-gid="(\d+)"/g,
        /tabindex="0"[^>]*aria-label="([^"]*)"[^>]*data-id="(\d+)"/g,
      ];
      for (const regex of patterns) {
        let match;
        while ((match = regex.exec(html)) !== null) {
          // প্যাটার্ন অনুযায়ী name/gid সিরিয়াল ভিন্ন হতে পারে
          const name = regex === patterns[0] ? match[2] : match[1];
          const gid = regex === patterns[0] ? match[1] : match[2];
          const exists = sheets.some(s => s.name === name || s.gid === gid);
          if (!exists && name) {
            sheets.push({ name, gid });
          }
        }
        if (sheets.length > 0) break;
      }

      // প্যাটার্ন ম্যাচ না পাওয়া গেলে raw HTML থেকে sheet title খুঁজুন
      if (sheets.length === 0) {
        // "Sheet1", "Data" ইত্যাদি নামের ক্লু
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        if (titleMatch) {
          const title = titleMatch[1].replace(/ - Google Sheets$/, '').trim();
          if (title && !title.includes('Error') && !title.includes('Sign in')) {
            sheets.push({ name: title, gid: '0' });
          }
        }
      }
    }
  } catch {
    // skip
  }
  return sheets;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'search';
    const query = searchParams.get('query') || '';
    const month = searchParams.get('month') || '';
    const year = searchParams.get('year') || '';
    const sheetId = searchParams.get('sheetId') || '';
    const sheetName = searchParams.get('sheetName') || '';

    // ===== ACTION: TEST - Verify sheet is accessible =====
    if (action === 'test') {
      if (!sheetId) {
        return NextResponse.json({ success: false, error: 'Sheet ID দিন — আপনার Google Sheet URL দিন' });
      }
      try {
        const { rows, headers } = await fetchCsvFromSheet(sheetId, sheetName || 'Data');
        return NextResponse.json({
          success: true,
          message: `✅ শীট পাওয়া গেছে — ${rows.length} রো, ${headers.length} কলাম`,
          rowCount: rows.length,
          colCount: headers.length,
          headers: headers.slice(0, 5),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({
          success: false,
          error: `❌ শীট থেকে ডাটা আনা যায়নি: ${msg}`,
          hint: 'নিশ্চিত করুন যে Google Sheet "Anyone with the link" দিয়ে শেয়ার করা আছে। Share → Anyone with the link → Viewer সিলেক্ট করুন।',
        });
      }
    }

    // ===== ACTION: SHEETS - Discover ACTUAL tab names from the sheet =====
    if (action === 'sheets') {
      if (!sheetId) {
        return NextResponse.json({ success: false, error: 'Sheet ID দিন' });
      }
      const sheets: Array<{ name: string; gid: string }> = [];

      // পদ্ধতি ১: HTML থেকে আসল ট্যাবের নাম আনুন
      const htmlSheets = await discoverSheetsFromHtml(sheetId);
      if (htmlSheets.length > 0) {
        sheets.push(...htmlSheets);
      }

      // পদ্ধতি ২: HTML থেকে নাম না পাওয়া গেলে gid দিয়ে আলাদা ট্যাব খুঁজুন
      if (sheets.length === 0) {
        const seenHeaders = new Set<string>();
        for (let gid = 0; gid <= 15; gid++) {
          try {
            const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
            const res = await fetch(url, {
              cache: 'no-store',
              headers: GOOGLE_HEADERS,
              redirect: 'follow',
            });
            if (!res.ok) continue;
            const text = await res.text();
            if (text.trimStart().startsWith('<!') || text.includes('<title>Error</title>')) continue;
            const { headers, rows } = parseCsvWithHeaders(text);
            if (headers.length === 0) continue;
            const headerKey = headers.join('|');
            if (seenHeaders.has(headerKey)) continue;
            seenHeaders.add(headerKey);
            if (rows.length === 0 && gid > 0) continue;
            sheets.push({ name: `ট্যাব ${gid + 1}`, gid: String(gid) });
          } catch { break; }
        }
      }

      if (sheets.length === 0) {
        try {
          const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
          const res = await fetch(url, { cache: 'no-store', headers: GOOGLE_HEADERS, redirect: 'follow' });
          if (!res.ok) {
            const text = await res.text();
            const isAuth = text.includes('Sign in') || text.includes('login') || text.includes('Error');
            return NextResponse.json({
              success: false,
              error: isAuth ? 'এই Google Sheet পাবলিক নয়। "Anyone with the link" দিয়ে শেয়ার করুন।' : 'শীট থেকে ডাটা আনা যায়নি।',
              hint: isAuth ? 'Share → General access → Anyone with the link → Viewer → Copy link' : 'শীটটি পাবলিক কিনা নিশ্চিত করুন',
            });
          }
          sheets.push({ name: 'ট্যাব ১', gid: '0' });
        } catch {
          return NextResponse.json({ success: false, error: 'শীটে কানেক্ট করা যায়নি', hint: 'ইন্টারনেট কানেকশন চেক করুন' });
        }
      }

      return NextResponse.json({ success: true, sheets });
    }

    // ===== ACTION: TRY_SHEET - Check if a specific sheet name exists =====
    if (action === 'try_sheet') {
      if (!sheetId || !sheetName) {
        return NextResponse.json({ success: false, error: 'Sheet ID ও নাম দিন' });
      }
      try {
        const { rows } = await fetchCsvFromSheet(sheetId, sheetName);
        return NextResponse.json({ success: true, exists: true, rowCount: rows.length });
      } catch {
        return NextResponse.json({ success: false, exists: false, error: `"${sheetName}" নামের শীট পাওয়া যায়নি` });
      }
    }

    // ===== ACTION: PREVIEW - Return sheet rows with headers for selection =====
    if (action === 'preview') {
      if (!sheetId) {
        return NextResponse.json({ success: false, error: 'Sheet ID দিন — আপনার Google Sheet URL দিন', hint: 'ইমপোর্ট ডায়ালগে সঠিক URL দিন' });
      }
      const gid = searchParams.get('gid') || '';
      const effectiveSheetName = sheetName || '';

      let dataRows: CsvRow[];
      let headers: string[] = [];
      try {
        let result;
        if (gid) {
          // gid দিয়ে ট্যাব লোড — সরাসরি gviz endpoint
          const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
          const res = await fetch(url, {
            cache: 'no-store',
            headers: GOOGLE_HEADERS,
            redirect: 'follow',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          if (text.trimStart().startsWith('<!') || text.includes('<title>Error</title>')) {
            throw new Error('গুগল লগইন রিডাইরেক্ট — শীট পাবলিক নয়');
          }
          result = parseCsvWithHeaders(text);
        } else if (effectiveSheetName) {
          // শীটের নাম দিয়ে লোড
          result = await fetchCsvFromSheet(sheetId, effectiveSheetName);
        } else {
          // ডিফল্ট — প্রথম ট্যাব
          const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
          const res = await fetch(url, {
            cache: 'no-store',
            headers: GOOGLE_HEADERS,
            redirect: 'follow',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          result = parseCsvWithHeaders(text);
        }
        headers = result.headers;
        dataRows = result.rows;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        const isAuthError = msg.toLowerCase().includes('login') || msg.toLowerCase().includes('sign in') || msg.toLowerCase().includes('private') || msg.toLowerCase().includes('error');
        return NextResponse.json({
          success: false,
          error: `"${effectiveSheetName}" শীট থেকে ডাটা আনা যায়নি`,
          detail: msg,
          hint: isAuthError
            ? 'শীটটি পাবলিক নয়। Share → Anyone with the link → Viewer করুন।'
            : 'শীটের নাম সঠিক কিনা নিশ্চিত করুন। Google Sheet-এর ট্যাবের নাম হুবহু লিখুন।',
        });
      }

      // কলাম নাম case-insensitive ও space-normalized খোঁজার হেল্পার
      const findCol = (row: CsvRow, ...names: string[]): string => {
        for (const name of names) {
          // প্রথমে সরাসরি ম্যাচ চেষ্টা করুন
          if (row[name] !== undefined && row[name] !== null) return row[name];
        }
        // তারপর case-insensitive + normalized-space ম্যাচ
        const normalizedMap = new Map<string, string>();
        for (const key of Object.keys(row)) {
          normalizedMap.set(key.toLowerCase().replace(/\s+/g, ' ').trim(), row[key]);
        }
        for (const name of names) {
          const normalized = name.toLowerCase().replace(/\s+/g, ' ').trim();
          const val = normalizedMap.get(normalized);
          if (val !== undefined && val !== null) return val;
        }
        return '';
      };

      // Return raw rows with all columns + mapped preview
      const preview = dataRows.map((row, idx) => ({
        _idx: idx,
        _raw: row, // raw data for column selection
        date: findCol(row, 'Date'),
        month: findCol(row, 'Month').trim(),
        year: findCol(row, 'Year').trim(),
        officeId: findCol(row, 'Office ID', 'Office Id', 'OfficeID', 'office_id', 'Office_Id').trim(),
        name: findCol(row, 'Name', 'name', 'নাম').trim(),
        mobile: findCol(row, 'Mobile', 'Mobile No', 'Mobile No.', 'Mobile Number', 'Mobile Number', 'Contact No', 'Contact No.', 'Contact', 'মোবাইল', 'Phone', 'Phone No', 'Phone No.', 'phone_number', 'Cell', 'Cell No').trim(),
        mBreakfast: parseInt(findCol(row, 'M_Breakfast', 'M Breakfast', 'Breakfast')) || 0,
        lunch: parseInt(findCol(row, 'Lunch', 'lunch')) || 0,
        mSpecial: parseInt(findCol(row, 'M_Special', 'M Special', 'Morning Special')) || 0,
        lSpecial: parseInt(findCol(row, 'L_Special', 'L Special', 'Lunch Special')) || 0,
        totalBill: Math.round(parseFloat(findCol(row, 'Total Bill', 'Total_Bill', 'TotalBill') || '0')),
        deposit: Math.round(parseFloat(findCol(row, 'Deposit ', 'Deposit') || '0')),
        depositDate: findCol(row, 'Deposit Date', 'Deposit_Date').trim(),
        designation: findCol(row, 'Designation', 'Designation ', 'designation', 'DESIGNATION', 'পদবী', 'Designation.', 'Post', 'Position', 'Title').trim(),
      }));
      return NextResponse.json({ success: true, rows: preview, total: preview.length, headers });
    }

    // Legacy search action (still works with default sheet)
    if (action === 'search') {
      if (!query) {
        return NextResponse.json({ success: false, error: 'অনুগ্রহ করে আইডি বা মোবাইল নম্বর দিন' });
      }

      const dataRows = await fetchSheet(DEFAULT_SHEET_ID, 'Data');
      const settingsRows = await fetchSheet(DEFAULT_SHEET_ID, 'Settings');

      const q = query.trim().toLowerCase();
      const qClean = q.replace(/\D/g, '');

      let foundUser = false;
      let userDetails: { id: string; name: string; mobile: string } = { id: query, name: '', mobile: '' };
      let latestBalance = 0;
      let latestDate = '';

      const summary = {
        total_mB: 0, total_lM: 0, total_mS: 0, total_lS: 0,
        total_bill: 0, total_deposit: 0, entryCount: 0
      };

      const monthlyEntries: CsvRow[] = [];
      const isAllMonth = !month || month === 'সকল মাস';
      const isAllYear = !year;

      for (const row of dataRows) {
        const rowId = (row['Office ID'] || '').trim().toLowerCase();
        const rowMobile = (row['Mobile'] || '').trim().toLowerCase();
        const rowMobileClean = rowMobile.replace(/\D/g, '');

        const idMatch = rowId === q;
        const mobileMatch = rowMobile === q || (qClean && rowMobileClean === qClean);

        if (idMatch || mobileMatch) {
          foundUser = true;
          if (!userDetails.name && row['Name']) userDetails.name = row['Name'];
          if (!userDetails.id && row['Office ID']) userDetails.id = row['Office ID'];
          if (!userDetails.mobile && row['Mobile']) userDetails.mobile = row['Mobile'];

          const rowDate = row['Date'] || '';
          if (rowDate && rowDate > latestDate) {
            latestDate = rowDate;
            latestBalance = parseFloat(row['Cur Balance']) || 0;
          }

          const rowMonth = (row['Month'] || '').trim();
          const rowYear = (row['Year'] || '').trim();
          const monthMatch = isAllMonth || rowMonth === month;
          const yearMatch = isAllYear || rowYear === year;

          if (monthMatch && yearMatch) {
            monthlyEntries.push(row);
            summary.total_mB += parseInt(row['M_Breakfast']) || 0;
            summary.total_lM += parseInt(row['Lunch']) || 0;
            summary.total_mS += parseInt(row['M_Special']) || 0;
            summary.total_lS += parseInt(row['L_Special']) || 0;
            summary.total_bill += parseFloat(row['Total Bill'] || '0');
            summary.total_deposit += parseFloat(row['Deposit '] || row['Deposit'] || '0') || 0;
            summary.entryCount++;
          }
        }
      }

      if (!foundUser) {
        return NextResponse.json({ success: false, error: `আইডি বা মোবাইল মিলে নাই: "${query}"` });
      }

      let prices = { M_Breakfast: 0, Lunch: 0, M_Special: 0, L_Special: 0 };
      if (!isAllMonth && year) {
        for (const s of settingsRows) {
          if ((s['Month'] || '').trim() === month && (s['Year'] || '').trim() === year) {
            prices.M_Breakfast = parseInt(s['M_Breakfast']) || 0;
            prices.Lunch = parseInt(s['Lunch']) || 0;
            prices.M_Special = parseInt(s['M_Special']) || 0;
            prices.L_Special = parseInt(s['L_Special']) || 0;
            break;
          }
        }
      }

      let allPrices: { month: string; year: string; M_Breakfast: number; Lunch: number; M_Special: number; L_Special: number }[] = [];
      if (isAllMonth) {
        for (const s of settingsRows) {
          allPrices.push({
            month: (s['Month'] || '').trim(), year: (s['Year'] || '').trim(),
            M_Breakfast: parseInt(s['M_Breakfast']) || 0, Lunch: parseInt(s['Lunch']) || 0,
            M_Special: parseInt(s['M_Special']) || 0, L_Special: parseInt(s['L_Special']) || 0,
          });
        }
      }

      return NextResponse.json({
        success: true, user: userDetails, summary, prices, allPrices, latestBalance,
        entries: monthlyEntries,
        searchParams: { month: isAllMonth ? 'সকল মাস' : month, year: isAllYear ? 'সব বছর' : year, isAllMonth }
      });
    }

    if (action === 'settings') {
      const settingsRows = await fetchSheet(DEFAULT_SHEET_ID, 'Settings');
      return NextResponse.json({ success: true, settings: settingsRows });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: 'সার্ভার এরর: ' + msg });
  }
}

function parseSheetDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const parts = dateStr.match(/(\d{2})-(\d{2})-(\d{4})\s*(\d{2}):(\d{2}):(\d{2})/);
  if (parts) return new Date(+parts[3], +parts[2] - 1, +parts[1], +parts[4], +parts[5], +parts[6]);
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  return new Date();
}

// সব settings একবারে লোড করে দ্রুত balance হিসাব করুন
// entryDate এর ফরম্যাট মিক্সড হতে পারে (epoch vs ISO), তাই parseEntryDate ব্যবহার
function parseEntryDate(d: any): number {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}/.test(s)) {
    const parsed = Date.parse(s.includes('Z') || s.includes('+') || s.includes('-06') || s.includes('-05') ? s : s + '+06:00');
    return isNaN(parsed) ? 0 : parsed;
  }
  const ddMatch = s.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (ddMatch) return new Date(+ddMatch[3], +ddMatch[2] - 1, +ddMatch[1]).getTime();
  const parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
}

async function recalculateAllBalances(officeId: string) {
  // rowid দিয়ে সর্ট — entryDate এর ফরম্যাট মিক্সড হতে পারে
  const { query: dbQuery } = await import('@/lib/db');
  const result = await dbQuery('SELECT * FROM MealEntry WHERE officeId = ? ORDER BY rowid ASC', [officeId]);
  const rawEntries = result.rows.map((row: any) => ({
    ...row,
    breakfastCount: Number(row.breakfastCount) || 0,
    lunchCount: Number(row.lunchCount) || 0,
    morningSpecial: Number(row.morningSpecial) || 0,
    lunchSpecial: Number(row.lunchSpecial) || 0,
    totalBill: Number(row.totalBill) || 0,
    deposit: Number(row.deposit) || 0,
    prevBalance: Number(row.prevBalance) || 0,
    curBalance: Number(row.curBalance) || 0,
  }));

  // entryDate অনুযায়ী সর্ট — epoch ও ISO দুই ফরম্যাটই handle করে
  const entries = [...rawEntries].sort((a, b) => parseEntryDate(a.entryDate) - parseEntryDate(b.entryDate));
  if (entries.length === 0) return;

  const allSettings = await db.priceSetting.findMany();
  const settingMap = new Map<string, { breakfastPrice: number; lunchPrice: number; morningSpecial: number; lunchSpecial: number }>();
  for (const s of allSettings) {
    settingMap.set(`${s.month}|${s.year}`, {
      breakfastPrice: s.breakfastPrice, lunchPrice: s.lunchPrice,
      morningSpecial: s.morningSpecial, lunchSpecial: s.lunchSpecial,
    });
  }

  // Build all update statements
  const statements: Array<{ sql: string; args: any[] }> = [];
  let prevBal = 0;
  for (const entry of entries) {
    const setting = settingMap.get(`${entry.month}|${entry.year}`);
    const bill = (entry.breakfastCount * (setting?.breakfastPrice || 0)) + (entry.lunchCount * (setting?.lunchPrice || 0)) + (entry.morningSpecial * (setting?.morningSpecial || 0)) + (entry.lunchSpecial * (setting?.lunchSpecial || 0));
    const curBal = prevBal + entry.deposit - bill;
    statements.push({
      sql: 'UPDATE MealEntry SET prevBalance = ?, curBalance = ?, totalBill = ? WHERE id = ?',
      args: [prevBal, curBal, bill, entry.id]
    });
    prevBal = curBal;
  }

  // Execute all updates in a single batch
  if (statements.length > 0) {
    try {
      const { batchQuery } = await import('@/lib/db');
      await batchQuery(statements);
    } catch {
      // Fallback: execute one by one
      for (const stmt of statements) {
        const { query } = await import('@/lib/db');
        await query(stmt.sql, stmt.args);
      }
    }
  }
}

// ===== POST: Import selected rows from sheet data into DB =====
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rows: Array<{
      date: string; month: string; year: string;
      officeId: string; name: string; mobile: string;
      mBreakfast: number; lunch: number; mSpecial: number; lSpecial: number;
      totalBill: number; deposit: number; depositDate: string;
    }> = body.rows || [];

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'কোনো রো সিলেক্ট করা হয়নি' });
    }

    // Also import settings if present
    const settingsRows = body.settings || [];
    for (const s of settingsRows) {
      const month = (s.month || '').trim();
      const year = (s.year || '').trim();
      if (!month || !year) continue;
      await db.priceSetting.upsert({
        where: { month_year: { month, year } },
        update: { breakfastPrice: s.breakfastPrice || 0, lunchPrice: s.lunchPrice || 0, morningSpecial: s.morningSpecial || 0, lunchSpecial: s.lunchSpecial || 0 },
        create: { month, year, breakfastPrice: s.breakfastPrice || 0, lunchPrice: s.lunchPrice || 0, morningSpecial: s.morningSpecial || 0, lunchSpecial: s.lunchSpecial || 0 }
      });
    }

    let imported = 0;
    let updated = 0;
    for (const row of rows) {
      if (!row.officeId && !row.name) continue;
      const rowOfficeId = row.officeId || '';
      const rowMonth = (row.month || '').trim();
      const rowYear = (row.year || '').trim();
      const rowDesignation = (row as any).designation || '';

      // Check if an entry with same officeId + month + year already exists
      const existing = await db.mealEntry.findMany({
        where: { officeId: rowOfficeId, month: rowMonth, year: rowYear },
        orderBy: { entryDate: 'asc' }
      });

      // Find matching entry by date
      const entryDate = parseSheetDate(row.date);
      const entryDateStr = (() => {
        try {
          return new Date(entryDate).toISOString().split('T')[0];
        } catch { return ''; }
      })();

      const matchDate = existing.find(e => {
        try {
          return new Date(e.entryDate).toISOString().split('T')[0] === entryDateStr;
        } catch { return false; }
      });

      if (matchDate) {
        // UPDATE existing entry — smart merge
        const updateData: any = {
          name: row.name || matchDate.name || '',
          mobile: (row.mobile || '').trim() || matchDate.mobile || '',
          breakfastCount: row.mBreakfast || matchDate.breakfastCount,
          lunchCount: row.lunch || matchDate.lunchCount,
          morningSpecial: row.mSpecial || matchDate.morningSpecial,
          lunchSpecial: row.lSpecial || matchDate.lunchSpecial,
          designation: rowDesignation || (matchDate as any).designation || '',
        };
        // Only update deposit if sheet has a value
        if (row.deposit) {
          updateData.deposit = row.deposit;
        }
        if (row.depositDate) {
          updateData.depositDate = row.depositDate;
        }
        await db.mealEntry.update({
          where: { id: matchDate.id },
          data: updateData
        });
        updated++;
      } else {
        // INSERT new entry
        await db.mealEntry.create({
          data: {
            entryDate: entryDate,
            month: rowMonth,
            year: rowYear,
            officeId: rowOfficeId,
            name: (row.name || '').trim(),
            mobile: (row.mobile || '').trim(),
            breakfastCount: row.mBreakfast || 0,
            lunchCount: row.lunch || 0,
            morningSpecial: row.mSpecial || 0,
            lunchSpecial: row.lSpecial || 0,
            totalBill: row.totalBill || 0,
            deposit: row.deposit || 0,
            depositDate: (row.depositDate || '').trim(),
            prevBalance: 0,
            curBalance: 0,
            designation: rowDesignation,
          }
        });
        imported++;
      }
    }

    // Recalculate balances — only for affected officeIds
    const affectedIds = new Set<string>();
    for (const row of rows) {
      if (row.officeId) affectedIds.add(row.officeId);
    }
    for (const oid of affectedIds) {
      await recalculateAllBalances(oid);
    }

    // ইমপোর্টের পর মোবাইল সিঙ্ক — যেসব entry-তে মোবাইল আছে সেগুলো থেকে অন্য entry-তে মোবাইল কপি
    try {
      const { query: dbQuery, batchQuery } = await import('@/lib/db');
      const allRows = await dbQuery('SELECT id, officeId, name, mobile FROM MealEntry', []);
      const mobileByOfficeId = new Map<string, string>();
      const mobileByName = new Map<string, string>();
      for (const r of allRows.rows) {
        const row = r as any;
        const mob = (row.mobile || '').trim();
        if (mob.length < 5) continue;
        const oid = (row.officeId || '').trim();
        const name = (row.name || '').trim();
        if (oid && mob.length > (mobileByOfficeId.get(oid) || '').length) mobileByOfficeId.set(oid, mob);
        if (name && mob.length > (mobileByName.get(name) || '').length) mobileByName.set(name, mob);
      }
      const updates: Array<{ sql: string; args: any[] }> = [];
      for (const r of allRows.rows) {
        const row = r as any;
        const curMob = (row.mobile || '').trim();
        if (curMob.length >= 5) continue;
        const oid = (row.officeId || '').trim();
        const name = (row.name || '').trim();
        const newMob = mobileByOfficeId.get(oid) || mobileByName.get(name) || '';
        if (newMob.length >= 5) {
          updates.push({ sql: 'UPDATE MealEntry SET mobile = ? WHERE id = ?', args: [newMob, row.id] });
        }
      }
      if (updates.length > 0) {
        try { await batchQuery(updates); } catch {
          for (const u of updates) { await dbQuery(u.sql, u.args); }
        }
      }
    } catch { /* sync failure non-critical */ }

    return NextResponse.json({ success: true, message: `${imported}টি নতুন রো ইমপোর্ট ও ${updated}টি রো আপডেট হয়েছে`, imported, updated });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: 'ইমপোর্ট এরর: ' + msg }, { status: 500 });
  }
}
