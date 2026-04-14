import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { query, batchQuery } from '@/lib/db';
import { validateAdminSession } from '@/middleware';

// ===== Admin Auth Helper =====
function requireAdmin(request: NextRequest): NextResponse | null {
  const token = request.headers.get('x-admin-token');
  if (!validateAdminSession(token)) {
    return NextResponse.json({ success: false, error: 'অনুমতি নেই। আবার লগইন করুন।' }, { status: 401 });
  }
  return null;
}

// entryDate বাংলাদেশ সময়ে সেভ থাকে (ISO format, Z ছাড়া)
// ঠিকমতো পার্স করতে +06:00 যোগ করতে হবে
function parseBDDateStr(date: Date | string | number): Date {
  if (typeof date === 'number') return new Date(date);
  const s = typeof date === 'string' ? date.trim() : date.toISOString();
  if (s.includes('Z') || s.includes('+')) return new Date(s);
  return new Date(s + '+06:00');
}

// বাংলাদেশ সময় (GMT+6) এ ফরম্যাট করার হেল্পার — DD/MM/YYYY (Excel auto date recognize)
function formatDateBD(date: Date | string | number): string {
  const d = parseBDDateStr(date);
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const bdMs = utcMs + 6 * 60 * 60000;
  const bd = new Date(bdMs);
  const dd = String(bd.getDate()).padStart(2, '0');
  const mm = String(bd.getMonth() + 1).padStart(2, '0');
  const yyyy = bd.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// বাংলাদেশ সময়ে ISO ফরম্যাটে রূপান্তর
function getBDISOString(): string {
  const now = new Date();
  // বাংলাদেশ সময় পাওয়ার জন্য UTC থেকে +6 ঘন্টা যোগ
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const bdMs = utcMs + 6 * 60 * 60000;
  const bd = new Date(bdMs);
  // বাংলাদেশ সময়কে ISO string হিসেবে সেভ করা (Z ছাড়া, যাতে সরাসরি পড়তে পারা যায়)
  const yyyy = bd.getFullYear();
  const mm = String(bd.getMonth() + 1).padStart(2, '0');
  const dd = String(bd.getDate()).padStart(2, '0');
  const hh = String(bd.getHours()).padStart(2, '0');
  const min = String(bd.getMinutes()).padStart(2, '0');
  const ss = String(bd.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.000`;
}

// entryDate পার্স করার হেল্পার — epoch number ও ISO string দুই ফরম্যাটই handle করে
function parseEntryDate(d: any): number {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  let s = String(d).trim();
  // Fix malformed dates missing 'T' separator (e.g. "2026-04-1319:50:15.000")
  if (/^\d{4}-\d{2}-\d{2}\d{2}:\d{2}/.test(s)) {
    s = s.replace(/^(\d{4}-\d{2}-\d{2})(\d)/, '$1T$2');
  }
  // ISO string: "2026-04-04T21:59:01.000"
  if (/^\d{4}-\d{2}/.test(s)) {
    const parsed = Date.parse(s.includes('Z') || s.includes('+') || s.includes('-06') || s.includes('-05') ? s : s + '+06:00');
    return isNaN(parsed) ? 0 : parsed;
  }
  // DD-MM-YYYY format
  const ddMatch = s.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (ddMatch) return new Date(+ddMatch[3], +ddMatch[2] - 1, +ddMatch[1]).getTime();
  // fallback: try generic parse
  const parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
}

// সব entry থেকে officeId/name অনুযায়ী মোবাইল নম্বর সিঙ্ক করুন
// যেসব entry-তে মোবাইল আছে, সেগুলো থেকে অন্য entry-তে মোবাইল ভরান
async function syncMobileNumbers(db: any) {
  const { query: dbQuery, batchQuery } = await import('@/lib/db');
  const result = await dbQuery('SELECT id, officeId, name, mobile FROM MealEntry ORDER BY rowid ASC', []);
  const rows = result.rows;

  // officeId অনুযায়ী সেরা মোবাইল খুঁজুন
  const mobileByOfficeId = new Map<string, string>();
  for (const row of rows) {
    const oid = (row as any).officeId || '';
    const mob = (row as any).mobile || '';
    if (!oid || !mob || mob.length < 5) continue;
    const existing = mobileByOfficeId.get(oid);
    if (!existing || mob.length > existing.length) {
      mobileByOfficeId.set(oid, mob);
    }
  }

  // নাম অনুযায়ীও সেরা মোবাইল খুঁজুন (officeId না থাকলে)
  const mobileByName = new Map<string, string>();
  for (const row of rows) {
    const name = (row as any).name || '';
    const mob = (row as any).mobile || '';
    if (!name || !mob || mob.length < 5) continue;
    const existing = mobileByName.get(name);
    if (!existing || mob.length > existing.length) {
      mobileByName.set(name, mob);
    }
  }

  // মোবাইল মিসিং entry গুলো আপডেট করুন
  const updates: Array<{ id: string; mobile: string }> = [];
  for (const row of rows) {
    const id = (row as any).id;
    const oid = (row as any).officeId || '';
    const name = (row as any).name || '';
    const currentMobile = (row as any).mobile || '';
    if (currentMobile && currentMobile.length >= 5) continue; // ইতিমধ্যে মোবাইল আছে

    let newMobile = mobileByOfficeId.get(oid) || '';
    if (!newMobile) newMobile = mobileByName.get(name) || '';
    if (newMobile && newMobile.length >= 5) {
      updates.push({ id, mobile: newMobile });
    }
  }

  if (updates.length === 0) return 0;

  // ব্যাচ আপডেট
  try {
    const statements = updates.map(u => ({
      sql: 'UPDATE MealEntry SET mobile = ? WHERE id = ?',
      args: [u.mobile, u.id]
    }));
    await batchQuery(statements);
  } catch {
    for (const u of updates) {
      await db.mealEntry.update({ where: { id: u.id }, data: { mobile: u.mobile } });
    }
  }
  return updates.length;
}

// প্রথম এন্ট্রির prevBalance = 0
// এরপরের প্রতিটি এন্ট্রির prevBalance = আগের এন্ট্রির curBalance
// curBalance = prevBalance + deposit - totalBill
// entryDate এর ফরম্যাট মিক্সড (epoch number vs ISO string) হতে পারে
// তাই JavaScript-এ সব entryDate parse করে সর্ট করা হচ্ছে
async function recalculateAllBalances(officeId: string, db: any) {
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
  const entries = [...rawEntries].sort((a, b) => {
    const da = parseEntryDate(a.entryDate);
    const db = parseEntryDate(b.entryDate);
    return da - db;
  });

  if (entries.length === 0) return;

  // Pre-load all price settings
  const allSettings = await db.priceSetting.findMany();
  const settingMap = new Map<string, { breakfastPrice: number; lunchPrice: number; morningSpecial: number; lunchSpecial: number }>();
  for (const s of allSettings) {
    settingMap.set(`${s.month}|${s.year}`, {
      breakfastPrice: s.breakfastPrice, lunchPrice: s.lunchPrice,
      morningSpecial: s.morningSpecial, lunchSpecial: s.lunchSpecial,
    });
  }

  // Calculate all balances in memory
  const updates: Array<{ id: string; prevBalance: number; curBalance: number; totalBill: number }> = [];
  let prevBal = 0;
  for (const entry of entries) {
    const setting = settingMap.get(`${entry.month}|${entry.year}`);
    const bp = setting?.breakfastPrice || 0;
    const lp = setting?.lunchPrice || 0;
    const ms = setting?.morningSpecial || 0;
    const ls = setting?.lunchSpecial || 0;
    const bill = entry.breakfastCount * bp + entry.lunchCount * lp + entry.morningSpecial * ms + entry.lunchSpecial * ls;
    const curBal = prevBal + entry.deposit - bill;
    updates.push({ id: entry.id, prevBalance: prevBal, curBalance: curBal, totalBill: bill });
    prevBal = curBal;
  }

  // Batch update all entries
  try {
    const { batchQuery } = await import('@/lib/db');
    const statements = updates.map(u => ({
      sql: 'UPDATE MealEntry SET prevBalance = ?, curBalance = ?, totalBill = ? WHERE id = ?',
      args: [u.prevBalance, u.curBalance, u.totalBill, u.id]
    }));
    if (statements.length > 0) await batchQuery(statements);
  } catch {
    // Fallback: one by one
    for (const u of updates) {
      await db.mealEntry.update({
        where: { id: u.id },
        data: { prevBalance: u.prevBalance, curBalance: u.curBalance, totalBill: u.totalBill }
      });
    }
  }
}

// Helper: strip leading zeros from a phone string
function stripLeadingZeros(s: string): string {
  return s.replace(/^0+/, '') || '0';
}

// বাংলা মাসের নাম → English মাসের নাম map
const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

// orderDate (YYYY-MM-DD) থেকে বাংলা মাস ও বছর বের করুন
function getBdMonthYear(orderDate: string): { month: string; year: string } {
  const dp = orderDate.split('-');
  const dateObj = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
  return { month: MONTHS_BN[dateObj.getMonth()], year: dp[0] };
}

const BN_TO_EN_MONTH: Record<string, string> = {
  'জানুয়ারি': 'January', 'ফেব্রুয়ারি': 'February', 'মার্চ': 'March',
  'এপ্রিল': 'April', 'মে': 'May', 'জুন': 'June',
  'জুলাই': 'July', 'আগস্ট': 'August', 'সেপ্টেম্বর': 'September',
  'অক্টোবর': 'October', 'নভেম্বর': 'November', 'ডিসেম্বর': 'December'
};

// CSV রেসপন্স তৈরি (বাংলাদেশ সময় GMT+6 সহ)
function buildCsvResponse(entries: any[]) {
  const headers = ['Date', 'Month', 'Year', 'Office ID', 'Name', 'Mobile', 'M_Breakfast', 'Lunch', 'M_Special', 'L_Special', 'Total Bill', 'Deposit', 'Deposit Date', 'Prev Balance', 'Cur Balance'];
  const rows = entries.map(e => [
    formatDateBD(e.entryDate),
    BN_TO_EN_MONTH[e.month] || e.month, e.year, e.officeId, e.name, e.mobile,
    e.breakfastCount, e.lunchCount, e.morningSpecial, e.lunchSpecial,
    e.totalBill, e.deposit, e.depositDate,
    e.prevBalance, e.curBalance
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

  // UTF-8 BOM যোগ করা হচ্ছে যাতে Google Sheets/Excel-এ বাংলা ঠিকভাবে দেখায়
  const bom = '\uFEFF';
  const csv = [headers.join(','), ...rows].join('\n');
  const csvWithBom = bom + csv;
  const filename = `data_sheet_${new Date().toISOString().split('T')[0]}.csv`;

  return new NextResponse(csvWithBom, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}

// GET all entries + search + lookup + admin filter
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'all';
    const searchQuery = searchParams.get('query') || '';
    const field = searchParams.get('field') || '';
    const month = searchParams.get('month') || '';
    const year = searchParams.get('year') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100);

    // ===== ACTION: RECALCULATE ALL BALANCES =====
    if (action === 'recalculate_all') {
      const allEntries = await db.mealEntry.findMany({ orderBy: { entryDate: 'asc' } });
      const officeIds = [...new Set(allEntries.map((e: any) => e.officeId))];
      let recalcCount = 0;
      for (const oid of officeIds) {
        await recalculateAllBalances(oid, db);
        recalcCount++;
      }
      return NextResponse.json({ success: true, message: `${recalcCount} জন কর্মীর ব্যালেন্স রিক্যালকুলেট হয়েছে` });
    }

    // ===== ACTION: REPAIR DATA =====
    // ১. month/year ফাঁকা থাকলে entryDate থেকে ডেরিভ
    // ২. MealEntry ↔ MealOrder সিঙ্ক (sourceOrderId, counts)
    // ৩. অব্যবহৃত ফাঁকা entries (0 meals + 0 deposit) ডিলিট
    if (action === 'repair_data') {
      const results = { monthYearFixed: 0, ordersSynced: 0, emptyDeleted: 0 };

      // ১. month/year ফিক্স
      const allEntries = await query('SELECT id, entryDate, month, year FROM MealEntry');
      for (const row of allEntries.rows) {
        const e = row as any;
        if (!e.entryDate) continue;
        const dateStr = (e.entryDate || '').substring(0, 10);
        const dp = dateStr.split('-');
        if (dp.length !== 3) continue;
        const needFix = !e.month || e.month === '' || !MONTHS_BN.includes(e.month) || !e.year || e.year === '';
        if (!needFix) continue;
        const dateObj = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
        const fixedMonth = MONTHS_BN[dateObj.getMonth()];
        const fixedYear = dp[0];
        await query('UPDATE MealEntry SET month = ?, year = ? WHERE id = ?', [fixedMonth, fixedYear, e.id]);
        results.monthYearFixed++;
      }

      // ২. MealOrder ↔ MealEntry সিঙ্ক
      const allOrders = await query('SELECT id, officeId, orderDate, name, mobile, designation, breakfast, lunch, morningSpecial, lunchSpecial, month, year FROM MealOrder');
      for (const order of allOrders.rows) {
        const o = order as any;
        const orderDateStr = (o.orderDate || '').substring(0, 10);

        // Linked entry খুঁজুন
        const linked = await query('SELECT id, officeId FROM MealEntry WHERE sourceOrderId = ?', [o.id]);
        if (linked.rows.length > 0) continue; // Already linked

        // Unlinked entry খুঁজুন (একই officeId + একই দিন)
        const sameDay = await query(
          'SELECT id FROM MealEntry WHERE officeId = ? AND substr(entryDate, 1, 10) = ? AND (sourceOrderId IS NULL OR length(sourceOrderId) = 0) ORDER BY rowid ASC LIMIT 1',
          [o.officeId, orderDateStr]
        );
        if (sameDay.rows.length > 0) {
          const entryId = (sameDay.rows[0] as any).id;
          // sourceOrderId সেট করুন এবং counts সিঙ্ক করুন
          await query(
            'UPDATE MealEntry SET sourceOrderId = ?, breakfastCount = ?, lunchCount = ?, morningSpecial = ?, lunchSpecial = ?, name = COALESCE(NULLIF(?, ""), name), mobile = COALESCE(NULLIF(?, ""), mobile), designation = COALESCE(NULLIF(?, ""), designation) WHERE id = ?',
            [o.id, Number(o.breakfast) || 0, Number(o.lunch) || 0, Number(o.morningSpecial) || 0, Number(o.lunchSpecial) || 0, o.name || '', o.mobile || '', o.designation || '', entryId]
          );
          results.ordersSynced++;
        }
      }

      // ৩. ফাঁকা entries ডিলিট — শুধুমাত্র সম্পূর্ণ ফাঁকা এন্ট্রি (নাম ও officeId দুটিই নেই)
      // ⚠️ কোনো মেম্বার এন্ট্রি ডিলিট হবে না
      const emptyEntries = await query(
        "SELECT id FROM MealEntry WHERE breakfastCount = 0 AND lunchCount = 0 AND morningSpecial = 0 AND lunchSpecial = 0 AND deposit = 0 AND (sourceOrderId IS NULL OR length(sourceOrderId) = 0) AND (name IS NULL OR name = '') AND (officeId IS NULL OR officeId = '')"
      );
      let deletedCount = 0;
      for (const row of emptyEntries.rows) {
        try {
          // ডাবল চেক: শুধুমাত্র যাদের সত্যিই কোনো ডাটা নেই
          const entry = await query('SELECT name, officeId FROM MealEntry WHERE id = ?', [(row as any).id]);
          if (entry.rows.length > 0) {
            const e = entry.rows[0] as any;
            const hasName = e.name && e.name.trim().length > 0;
            const hasOid = e.officeId && e.officeId.trim().length > 0;
            if (!hasName && !hasOid) {
              await query('DELETE FROM MealEntry WHERE id = ?', [(row as any).id]);
              deletedCount++;
            }
          }
        } catch { /* skip */ }
      }
      results.emptyDeleted = deletedCount;

      // ৪. ব্যালেন্স রিক্যালকুলেট
      const fixedEntries = await db.mealEntry.findMany({ orderBy: { entryDate: 'asc' } });
      const officeIds = [...new Set(fixedEntries.map((e: any) => e.officeId))];
      for (const oid of officeIds) {
        try { await recalculateAllBalances(oid, db); } catch { /* skip */ }
      }

      return NextResponse.json({
        success: true,
        message: `ডাটা মেরামত: ${results.monthYearFixed}টি month/year ফিক্স, ${results.ordersSynced}টি অর্ডার সিঙ্ক, ${results.emptyDeleted}টি ফাঁকা এন্ট্রি ডিলিট`,
        results
      });
    }

    // ===== ACTION: MERGE DUPLICATES =====
    // একই officeId + একই দিনের multiple entry → একটিতে মার্জ + balance recalculate
    if (action === 'merge_duplicates') {
      const allEntries = await db.mealEntry.findMany({ orderBy: { entryDate: 'asc' } });
      
      // Group by officeId + dateStr
      const groups = new Map<string, any[]>();
      for (const e of allEntries) {
        const dateStr = (e.entryDate || '').substring(0, 10);
        const key = `${e.officeId}_${dateStr}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(e);
      }

      let mergedCount = 0;
      const toDelete: string[] = [];
      const toUpdate: Array<{ id: string; breakfastCount: number; lunchCount: number; morningSpecial: number; lunchSpecial: number; deposit: number; name: string; mobile: string; designation: string }> = [];

      for (const [key, entries] of groups) {
        if (entries.length <= 1) continue;
        
        // Keep first entry, merge others into it
        const keep = entries[0];
        let bSum = Number(keep.breakfastCount) || 0;
        let lSum = Number(keep.lunchCount) || 0;
        let msSum = Number(keep.morningSpecial) || 0;
        let lsSum = Number(keep.lunchSpecial) || 0;
        let depSum = Number(keep.deposit) || 0;
        let bestName = keep.name || '';
        let bestMobile = keep.mobile || '';
        let bestDesig = (keep as any).designation || '';
        
        for (let i = 1; i < entries.length; i++) {
          const dup = entries[i];
          bSum += Number(dup.breakfastCount) || 0;
          lSum += Number(dup.lunchCount) || 0;
          msSum += Number(dup.morningSpecial) || 0;
          lsSum += Number(dup.lunchSpecial) || 0;
          depSum += Number(dup.deposit) || 0;
          if (!bestName && dup.name) bestName = dup.name;
          if (!bestMobile || (dup.mobile && dup.mobile.length > bestMobile.length)) bestMobile = dup.mobile || bestMobile;
          if (!bestDesig && (dup as any).designation) bestDesig = (dup as any).designation;
          toDelete.push(dup.id);
        }
        
        toUpdate.push({ id: keep.id, breakfastCount: bSum, lunchCount: lSum, morningSpecial: msSum, lunchSpecial: lsSum, deposit: depSum, name: bestName, mobile: bestMobile, designation: bestDesig });
        mergedCount += entries.length - 1;
      }

      // Delete duplicates
      for (const id of toDelete) {
        try { await query('DELETE FROM MealEntry WHERE id = ?', [id]); } catch { /* skip */ }
      }
      // Update merged entries
      for (const u of toUpdate) {
        try {
          await query(
            `UPDATE MealEntry SET breakfastCount = ?, lunchCount = ?, morningSpecial = ?, lunchSpecial = ?, deposit = ?, name = ?, mobile = ?, designation = ? WHERE id = ?`,
            [u.breakfastCount, u.lunchCount, u.morningSpecial, u.lunchSpecial, u.deposit, u.name, u.mobile, u.designation, u.id]
          );
        } catch { /* skip */ }
      }

      // Recalculate all balances
      const uniqueOfficeIds = [...new Set(toUpdate.map(u => {
        const e = allEntries.find(a => a.id === u.id);
        return e?.officeId || '';
      }).filter(Boolean))];
      for (const oid of uniqueOfficeIds) {
        await recalculateAllBalances(oid, db);
      }

      return NextResponse.json({
        success: true,
        message: `${mergedCount}টি ডুপ্লিকেট এন্ট্রি মার্জ হয়েছে, ${uniqueOfficeIds.length} জনের ব্যালেন্স আপডেট হয়েছে`,
        mergedCount,
        balanceUpdated: uniqueOfficeIds.length,
      });
    }

    // ===== ACTION: SYNC MOBILE NUMBERS =====
    if (action === 'sync_mobile') {
      const count = await syncMobileNumbers(db);
      return NextResponse.json({ success: true, message: `${count}টি এন্ট্রির মোবাইল নম্বর আপডেট হয়েছে` });
    }

    // ===== ACTION: SEARCH ENTRIES (ডিলিট ডায়ালগ - Tab 1) =====
    if (action === 'search_entries') {
      if (!searchQuery) return NextResponse.json({ success: false, error: 'আইডি বা মোবাইল দিন' });

      const q = searchQuery.trim().toLowerCase();
      const qClean = q.replace(/\D/g, '');
      const qStripped = stripLeadingZeros(qClean);

      // সব এন্ট্রি নিন (entryDate desc order এ) এবং filter করুন
      const allEntries = await db.mealEntry.findMany({
        orderBy: { entryDate: 'desc' }
      });

      const filtered = allEntries.filter(e => {
        // officeId match
        const officeMatch = e.officeId.toLowerCase().includes(q);
        // mobile match (strip leading zeros)
        let mobileMatch = false;
        if (qClean.length >= 4 && e.mobile) {
          const mobileClean = e.mobile.replace(/\D/g, '');
          const mobileStripped = stripLeadingZeros(mobileClean);
          mobileMatch = mobileClean.includes(qClean) || mobileStripped.includes(qStripped);
        }
        // name match
        const nameMatch = q.length >= 2 && !/^\d+$/.test(q) && e.name && e.name.toLowerCase().includes(q);
        return officeMatch || mobileMatch || nameMatch;
      });

      // month/year filter
      const monthFiltered = month ? filtered.filter(e => e.month === month) : filtered;
      const result = year ? monthFiltered.filter(e => String(e.year) === String(year)) : monthFiltered;

      // ===== Duplicate dedup: একই officeId + একই দিনের multiple entry থাকলে merge করুন (DISPLAY ONLY — DB তে কিছু ডিলিট হবে না) =====
      const deduped: any[] = [];
      const seen = new Map<string, number>(); // key: "officeId_dateStr" → index in deduped
      for (const entry of result) {
        const entryAny = entry as any;
        const dateStr = (entryAny.entryDate || '').substring(0, 10); // "YYYY-MM-DD"
        const key = `${entryAny.officeId}_${dateStr}`;
        if (seen.has(key)) {
          // Merge into existing entry — DISPLAY ONLY, DB তে কোনো পরিবর্তন নয়
          const idx = seen.get(key)!;
          const existing = deduped[idx];
          existing.breakfastCount = Number(existing.breakfastCount || 0) + Number(entryAny.breakfastCount || 0);
          existing.lunchCount = Number(existing.lunchCount || 0) + Number(entryAny.lunchCount || 0);
          existing.morningSpecial = Number(existing.morningSpecial || 0) + Number(entryAny.morningSpecial || 0);
          existing.lunchSpecial = Number(existing.lunchSpecial || 0) + Number(entryAny.lunchSpecial || 0);
          existing.deposit = Number(existing.deposit || 0) + Number(entryAny.deposit || 0);
          existing.totalBill = Number(existing.totalBill || 0) + Number(entryAny.totalBill || 0);
          // name/mobile/designation সিঙ্ক — খালি থাকলে ভরান
          if (!existing.name && entryAny.name) existing.name = entryAny.name;
          if (!existing.mobile && entryAny.mobile) existing.mobile = entryAny.mobile;
          if (!existing.designation && entryAny.designation) existing.designation = entryAny.designation;
        } else {
          seen.set(key, deduped.length);
          deduped.push({ ...entryAny });
        }
      }

      // ===== Zero-meal entry filter: সব কাউন্ট ০ এবং বিল/জমা ০ থাকলে রেজাল্টে দেখাবে না =====
      // তবে member record (name/officeId আছে) ডিলিট হবে না — শুধু এই সার্চ রেজাল্টে বাদ যাবে
      const cleanedDeduped = deduped.filter((e: any) => {
        const hasMealOrDeposit =
          Number(e.breakfastCount || 0) > 0 || Number(e.lunchCount || 0) > 0 ||
          Number(e.morningSpecial || 0) > 0 || Number(e.lunchSpecial || 0) > 0 ||
          Number(e.deposit || 0) > 0 || Number(e.totalBill || 0) > 0;
        return hasMealOrDeposit;
      });
      deduped.length = 0;
      deduped.push(...cleanedDeduped);

      // ===== Designation sync: যেসব entry তে designation নেই, অন্য entry থেকে ভরান =====
      try {
        const allOids = [...new Set(deduped.map((e: any) => e.officeId).filter(Boolean))];
        for (const oid of allOids) {
          const oidEntries = deduped.filter((e: any) => e.officeId === oid);
          const withDesignation = oidEntries.find((e: any) => e.designation && e.designation.trim().length > 0);
          if (withDesignation) {
            for (const e of oidEntries) {
              if (!e.designation || e.designation.trim().length === 0) {
                e.designation = withDesignation.designation;
                try { await db.mealEntry.update({ where: { id: e.id }, data: { designation: withDesignation.designation } }); } catch { /* silent */ }
              }
            }
          }
        }
      } catch { /* silent */ }

      // ===== entryDate ঠিক করুন — MealOrder এর orderDate থেকে =====
      try {
        const entriesWithSource = deduped.filter((e: any) => e.sourceOrderId);
        if (entriesWithSource.length > 0) {
          const sourceIds = [...new Set(entriesWithSource.map((e: any) => e.sourceOrderId))];
          if (sourceIds.length > 0) {
            const placeholders = sourceIds.map(() => '?').join(',');
            const orderResults = await query(
              `SELECT id, orderDate FROM MealOrder WHERE id IN (${placeholders})`,
              sourceIds
            );
            const orderRows = (orderResults && orderResults.rows) ? orderResults.rows : [];
            // sourceOrderId → orderDate map
            const orderDateMap = new Map<string, string>();
            for (const row of orderRows) {
              const r = row as any;
              if (r.id && r.orderDate) orderDateMap.set(String(r.id), String(r.orderDate));
            }
            // entryDate ঠিক করুন এবং DB তেও আপডেট করুন
            for (const entry of deduped) {
              const e = entry as any;
              if (e.sourceOrderId && orderDateMap.has(String(e.sourceOrderId))) {
                const correctDate = orderDateMap.get(String(e.sourceOrderId))!;
                const currentDateStr = (e.entryDate || '').substring(0, 10);
                if (correctDate.substring(0, 10) !== currentDateStr) {
                  const timePart = (e.entryDate || '').substring(10) || 'T00:00:00.000';
                  const fixedDate = `${correctDate.substring(0, 10)}${timePart}`;
                  e.entryDate = fixedDate;
                  try { await query('UPDATE MealEntry SET entryDate = ? WHERE id = ?', [fixedDate, e.id]); } catch { /* silent */ }
                }
              }
            }
          }
        }
      } catch { /* entryDate correction failed — non-critical */ }

      // Dedup শুধুমাত্র display-এর জন্য — DB তে কোনো পরিবর্তন নয়, তাই recalculate এর দরকার নেই

      const total = deduped.length;
      const paginated = deduped.slice((page - 1) * limit, page * limit);

      return NextResponse.json({
        success: true,
        entries: paginated,
        total,
        page,
        totalPages: Math.ceil(total / limit)
      });
    }

    // ===== ACTION: PREVIEW YEAR DELETE (ডিলিট ডায়ালগ - Tab 2) =====
    if (action === 'preview_year_delete') {
      const delYear = searchParams.get('delYear') || '';
      const delQuery = searchParams.get('delQuery') || '';

      if (!delYear || !delQuery) {
        return NextResponse.json({ success: false, error: 'বছর এবং আইডি/মোবাইল দিন' }, { status: 400 });
      }

      const q = delQuery.trim().toLowerCase();
      const qClean = q.replace(/\D/g, '');
      const qStripped = stripLeadingZeros(qClean);

      const allEntries = await db.mealEntry.findMany({
        where: { year: delYear },
        orderBy: { entryDate: 'desc' }
      });

      // Query দিয়ে filter করুন
      const matched = allEntries.filter(e => {
        const officeMatch = e.officeId.toLowerCase().includes(q);
        let mobileMatch = false;
        if (qClean.length >= 4 && e.mobile) {
          const mobileClean = e.mobile.replace(/\D/g, '');
          const mobileStripped = stripLeadingZeros(mobileClean);
          mobileMatch = mobileClean.includes(qClean) || mobileStripped.includes(qStripped);
        }
        const nameMatch = q.length >= 2 && !/^\d+$/.test(q) && e.name && e.name.toLowerCase().includes(q);
        return officeMatch || mobileMatch || nameMatch;
      });

      if (matched.length === 0) {
        return NextResponse.json({ success: false, error: `${delYear} সালে এই আইডি/মোবাইলের কোনো ডাটা নেই` }, { status: 404 });
      }

      // প্রতিটি unique officeId এর জন্য check করুন অন্য বছরে এন্ট্রি আছে কিনা
      const uniqueOfficeIds = [...new Set(matched.map((e: any) => e.officeId))];
      const officeIdDetails: Array<{ officeId: string; name: string; designation: string; mobile: string; entryCount: number }> = [];

      for (const oid of uniqueOfficeIds) {
        const entriesForThisOffice = matched.filter((e: any) => e.officeId === oid);
        const name = entriesForThisOffice.find(e => e.name)?.name || '';
        const designation = (entriesForThisOffice.find((e: any) => (e as any).designation) as any)?.designation || '';
        const mobile = entriesForThisOffice.find(e => e.mobile && e.mobile.length >= 5)?.mobile || '';

        officeIdDetails.push({
          officeId: oid,
          name,
          designation,
          mobile,
          entryCount: entriesForThisOffice.length,
        });
      }

      return NextResponse.json({
        success: true,
        totalEntries: matched.length,
        officeIds: officeIdDetails,
        willZeroOutCount: uniqueOfficeIds.length,
        willDeleteCount: 0,
      });
    }

    // ===== ACTION: LOOKUP =====
    if (action === 'lookup') {
      if (!searchQuery) return NextResponse.json({ success: false, error: 'কোয়েরি দিন' });

      const q = searchQuery.trim();
      const qLower = q.toLowerCase();
      const qClean = q.replace(/\D/g, '');
      const likePattern = `%${qLower}%`;
      const mobilePattern = qClean.length >= 3 ? `%${qClean}%` : '';
      const qStripped = stripLeadingZeros(qClean);
      const mobileStrippedPattern = qStripped !== qClean && qStripped.length >= 3 ? `%${qStripped}%` : '';

      const userMap = new Map<string, { officeId: string; name: string; mobile: string; designation: string }>();

      // Helper: unique key generator — officeId থাকলে officeId, না থাকলে name+mobile
      const makeKey = (oid: string, name: string, mobile: string) => {
        if (oid) return oid.toLowerCase();
        const mobilePart = mobile ? `_${mobile.replace(/\D/g, '')}` : '';
        return `_${name.toLowerCase()}${mobilePart}`;
      };

      // Helper: best data merger
      const mergeUser = (existing: { officeId: string; name: string; mobile: string; designation: string }, newRow: { officeId: string; name: string; mobile: string; designation: string }) => {
        if (!existing.name && newRow.name) existing.name = newRow.name;
        if (!existing.officeId && newRow.officeId) existing.officeId = newRow.officeId;
        if ((!existing.mobile || existing.mobile.length < 5) && newRow.mobile && newRow.mobile.length >= 5) {
          existing.mobile = newRow.mobile;
        }
        if ((!existing.designation || existing.designation.length === 0) && newRow.designation && newRow.designation.length > 0) {
          existing.designation = newRow.designation;
        }
      };

      // ✅ সব ফিল্ডে সার্চ — officeId + name + mobile + designation
      const buildLookupSql = (tableName: string) => {
        let sql = `SELECT officeId, name, mobile, designation FROM ${tableName} WHERE (`;
        const params: string[] = [];
        sql += "LOWER(officeId) LIKE ? OR LOWER(name) LIKE ? OR LOWER(designation) LIKE ?";
        params.push(likePattern, likePattern, likePattern);
        if (mobilePattern) {
          sql += " OR mobile LIKE ?";
          params.push(mobilePattern);
        }
        if (mobileStrippedPattern) {
          sql += " OR mobile LIKE ?";
          params.push(mobileStrippedPattern);
        }
        sql += ")";
        return { sql, params };
      };

      // ১. MealEntry থেকে খুঁজুন
      try {
        const { sql, params } = buildLookupSql('MealEntry');
        const result = await query(sql, params);
        for (const row of result.rows) {
          const r = row as any;
          const oid = (r.officeId || '').trim();
          const rName = (r.name || '').trim();
          if (!oid && !rName) continue;
          const key = makeKey(oid, rName, (r.mobile || '').trim());
          if (!userMap.has(key)) {
            userMap.set(key, { officeId: oid, name: rName, mobile: (r.mobile || '').trim(), designation: (r.designation || '').trim() });
          } else {
            mergeUser(userMap.get(key)!, { officeId: oid, name: rName, mobile: (r.mobile || '').trim(), designation: (r.designation || '').trim() });
          }
        }
      } catch { /* silent */ }

      // ২. MealUser থেকেও খুঁজুন
      try {
        const { sql, params } = buildLookupSql('MealUser');
        const userResult = await query(sql, params);
        for (const row of userResult.rows) {
          const r = row as any;
          const oid = (r.officeId || '').trim();
          const rName = (r.name || '').trim();
          if (!oid && !rName) continue;
          const key = makeKey(oid, rName, (r.mobile || '').trim());
          if (!userMap.has(key)) {
            userMap.set(key, { officeId: oid, name: rName, mobile: (r.mobile || '').trim(), designation: (r.designation || '').trim() });
          } else {
            mergeUser(userMap.get(key)!, { officeId: oid, name: rName, mobile: (r.mobile || '').trim(), designation: (r.designation || '').trim() });
          }
        }
      } catch { /* silent */ }

      // ৩. MealOrder থেকেও খুঁজুন
      try {
        const { sql, params } = buildLookupSql('MealOrder');
        const orderResult = await query(sql, params);
        for (const row of orderResult.rows) {
          const r = row as any;
          const oid = (r.officeId || '').trim();
          const rName = (r.name || '').trim();
          if (!oid && !rName) continue;
          const key = makeKey(oid, rName, (r.mobile || '').trim());
          if (!userMap.has(key)) {
            userMap.set(key, { officeId: oid, name: rName, mobile: (r.mobile || '').trim(), designation: (r.designation || '').trim() });
          } else {
            mergeUser(userMap.get(key)!, { officeId: oid, name: rName, mobile: (r.mobile || '').trim(), designation: (r.designation || '').trim() });
          }
        }
      } catch { /* silent */ }

      if (userMap.size === 0) {
        return NextResponse.json({ success: false, error: 'কোনো তথ্য পাওয়া যায়নি' });
      }

      let users = [...userMap.values()];

      // মোবাইল নম্বর মিসিং হলে MealEntry থেকে ভরান
      for (const u of users) {
        if (!u.mobile || u.mobile.length < 5) {
          try {
            const fillerRows = await query(
              'SELECT mobile FROM MealEntry WHERE officeId = ? AND mobile IS NOT NULL AND length(mobile) >= 5 LIMIT 1',
              [u.officeId]
            );
            if (fillerRows.rows.length > 0) {
              u.mobile = (fillerRows.rows[0] as any).mobile;
            }
          } catch { /* silent */ }
        }
        // পদবী মিসিং হলে MealUser ও MealOrder টেবিল থেকেও পদবী খুঁজুন
        if (!u.designation || u.designation.length === 0) {
          try {
            if (u.officeId) {
              const tables = [
                'SELECT designation FROM MealUser WHERE officeId = ? AND designation IS NOT NULL AND designation != \'\' LIMIT 1',
                'SELECT designation FROM MealOrder WHERE officeId = ? AND designation IS NOT NULL AND designation != \'\' LIMIT 1',
              ];
              for (const sql of tables) {
                const rows = await query(sql, [u.officeId]);
                if (rows && rows.rows && rows.rows.length > 0 && (rows.rows[0] as any).designation) {
                  u.designation = (rows.rows[0] as any).designation;
                  break;
                }
              }
            }
          } catch { /* silent */ }
        }
      }

      return NextResponse.json({ success: true, users });
    }

    // ===== ACTION: CHECK-DUPLICATE — সদস্য যোগের জন্য MealEntry + MealOrder + MealUser তিন টেবিলে খুঁজুন =====
    // অফিস আইডি অথবা মোবাইল নম্বর — যেকোনো একটি ম্যাচ করলে ডুপ্লিকেট
    if (action === 'check-duplicate') {
      const checkOfficeId = (searchParams.get('officeId') || '').trim();
      const checkMobile = (searchParams.get('mobile') || '').trim();
      if (!checkOfficeId && !checkMobile) return NextResponse.json({ success: true, duplicate: false });

      const mobileDigits = checkMobile ? checkMobile.replace(/\D/g, '') : '';
      const mobileStripped = stripLeadingZeros(mobileDigits);

      // helper: best entry picker
      const pickBest = (list: Array<{ officeId: string; name: string; mobile: string; designation: string }>) => {
        if (list.length === 0) return null;
        let best = list[0];
        let bestScore = (best.name?.length || 0) + (best.mobile?.length || 0) + (best.designation?.length || 0) * 2;
        for (let i = 1; i < list.length; i++) {
          const s = (list[i].name?.length || 0) + (list[i].mobile?.length || 0) + (list[i].designation?.length || 0) * 2;
          if (s > bestScore) { best = list[i]; bestScore = s; }
        }
        return best;
      };

      // helper: mobile match checker
      const isMobileMatch = (storedMobile: string) => {
        if (!storedMobile || mobileDigits.length < 4) return false;
        const d = storedMobile.replace(/\D/g, '');
        const s = stripLeadingZeros(d);
        return s === mobileStripped || d === mobileDigits;
      };

      // ===== ১. MealEntry তে খুঁজুন =====
      const allEntries = await db.mealEntry.findMany({
        orderBy: { createdAt: 'desc' },
        select: { officeId: true, name: true, mobile: true, designation: true }
      });

      // অফিস আইডি দিয়ে ম্যাচ
      if (checkOfficeId) {
        const officeIdMatches = allEntries.filter(e => e.officeId && e.officeId.trim().toLowerCase() === checkOfficeId.trim().toLowerCase());
        if (officeIdMatches.length > 0) {
          const best = pickBest(officeIdMatches.map(e => ({ officeId: e.officeId, name: e.name || '', mobile: e.mobile || '', designation: e.designation || '' })));
          if (best) return NextResponse.json({ success: true, duplicate: true, matchedBy: 'officeId', user: best });
        }
      }
      // মোবাইল দিয়ে ম্যাচ
      if (mobileDigits.length >= 4) {
        const mobileMatches = allEntries.filter(e => isMobileMatch(e.mobile));
        if (mobileMatches.length > 0) {
          const best = pickBest(mobileMatches.map(e => ({ officeId: e.officeId, name: e.name || '', mobile: e.mobile || '', designation: e.designation || '' })));
          if (best) return NextResponse.json({ success: true, duplicate: true, matchedBy: 'mobile', user: best });
        }
      }

      // ===== ২. MealOrder টেবিলে খুঁজুন =====
      try {
        const orderResult = await query('SELECT officeId, name, mobile, designation FROM MealOrder WHERE officeId IS NOT NULL AND officeId != \'\'');
        if (orderResult && orderResult.rows && orderResult.rows.length > 0) {
          const rows = orderResult.rows as any[];
          // অফিস আইডি দিয়ে ম্যাচ
          if (checkOfficeId) {
            const matches = rows.filter(r => r.officeId && r.officeId.trim().toLowerCase() === checkOfficeId.trim().toLowerCase());
            if (matches.length > 0) {
              const best = pickBest(matches.map((r: any) => ({ officeId: r.officeId, name: r.name || '', mobile: r.mobile || '', designation: r.designation || '' })));
              if (best) return NextResponse.json({ success: true, duplicate: true, matchedBy: 'officeId', user: best });
            }
          }
          // মোবাইল দিয়ে ম্যাচ
          if (mobileDigits.length >= 4) {
            const matches = rows.filter(r => isMobileMatch(r.mobile));
            if (matches.length > 0) {
              const best = pickBest(matches.map((r: any) => ({ officeId: r.officeId, name: r.name || '', mobile: r.mobile || '', designation: r.designation || '' })));
              if (best) return NextResponse.json({ success: true, duplicate: true, matchedBy: 'mobile', user: best });
            }
          }
        }
      } catch { /* MealOrder table might not exist */ }

      // ===== ৩. MealUser টেবিলে খুঁজুন =====
      try {
        const userResult = await query('SELECT officeId, name, mobile, designation FROM MealUser WHERE officeId IS NOT NULL AND officeId != \'\'');
        if (userResult && userResult.rows && userResult.rows.length > 0) {
          const rows = userResult.rows as any[];
          // অফিস আইডি দিয়ে ম্যাচ
          if (checkOfficeId) {
            const matches = rows.filter(r => r.officeId && r.officeId.trim().toLowerCase() === checkOfficeId.trim().toLowerCase());
            if (matches.length > 0) {
              const best = pickBest(matches.map((r: any) => ({ officeId: r.officeId, name: r.name || '', mobile: r.mobile || '', designation: r.designation || '' })));
              if (best) return NextResponse.json({ success: true, duplicate: true, matchedBy: 'officeId', user: best });
            }
          }
          // মোবাইল দিয়ে ম্যাচ
          if (mobileDigits.length >= 4) {
            const matches = rows.filter(r => isMobileMatch(r.mobile));
            if (matches.length > 0) {
              const best = pickBest(matches.map((r: any) => ({ officeId: r.officeId, name: r.name || '', mobile: r.mobile || '', designation: r.designation || '' })));
              if (best) return NextResponse.json({ success: true, duplicate: true, matchedBy: 'mobile', user: best });
            }
          }
        }
      } catch { /* MealUser table might not exist */ }

      return NextResponse.json({ success: true, duplicate: false });
    }

    // ===== SUGGEST: নাম/আইডি/মোবাইল টাইপ করলে মিলে যাওয়া সব ইউজার দেখান =====
    // ✅ DISTINCT দিয়ে SQL লেভেলে ইউনিক
    // ✅ একই নাম থাকলে সবাই দেখাবে (officeId/name+mobile অনুযায়ী dedup)
    // ✅ MealEntry + MealUser + MealOrder তিন টেবিল থেকে খুঁজে
    if (action === 'suggest') {
      if (!searchQuery) {
        return NextResponse.json({ success: true, users: [] });
      }
      // designation allows 1 char, others need 2
      const isDesigField = field === 'designation';
      if (!isDesigField && searchQuery.trim().length < 2) {
        return NextResponse.json({ success: true, users: [] });
      }
      if (isDesigField && searchQuery.trim().length < 1) {
        return NextResponse.json({ success: true, users: [] });
      }

      const q = searchQuery.trim().toLowerCase();
      const qClean = q.replace(/\D/g, '');
      const likePattern = `%${q}%`;
      const mobilePattern = qClean.length >= 3 ? `%${qClean}%` : '';
      const qStripped = stripLeadingZeros(qClean);
      const mobileStrippedPattern = qStripped !== qClean && qStripped.length >= 3 ? `%${qStripped}%` : '';

      const dedupByDesignation = isDesigField;
      const userMap = new Map<string, { officeId: string; name: string; mobile: string; designation: string }>();

      // ✅ উন্নত dedup key — composite key (officeId / name+mobile)
      const makeKey = (oid: string, name: string, mobile: string, isDesig: boolean, desig: string) => {
        if (isDesig) {
          return (desig || `_${oid || name}`).toLowerCase();
        }
        if (oid) return `oid:${oid.toLowerCase()}`;
        const mobileClean = (mobile || '').replace(/\D/g, '');
        if (name && mobileClean.length >= 5) return `nm:${name.toLowerCase()}_${mobileClean}`;
        return `n:${name.toLowerCase()}`;
      };

      const mergeUser = (existing: { officeId: string; name: string; mobile: string; designation: string }, newRow: { officeId: string; name: string; mobile: string; designation: string }) => {
        if (!existing.name && newRow.name) existing.name = newRow.name;
        if (!existing.officeId && newRow.officeId) existing.officeId = newRow.officeId;
        if ((!existing.mobile || existing.mobile.length < 5) && newRow.mobile && newRow.mobile.length >= 5) {
          existing.mobile = newRow.mobile;
        }
        if ((!existing.designation || existing.designation.length === 0) && newRow.designation && newRow.designation.length > 0) {
          existing.designation = newRow.designation;
        }
      };

      // ✅ DISTINCT দিয়ে SQL লেভেলে ডুপ্লিকেট এড়ানো
      const buildSearchSql = (tableName: string) => {
        let sql = `SELECT DISTINCT officeId, name, mobile, designation FROM ${tableName} WHERE (`;
        const params: string[] = [];

        if (isDesigField) {
          sql += "LOWER(designation) LIKE ? OR LOWER(name) LIKE ?";
          params.push(likePattern, likePattern);
        } else {
          sql += "LOWER(officeId) LIKE ? OR LOWER(name) LIKE ? OR LOWER(designation) LIKE ?";
          params.push(likePattern, likePattern, likePattern);
          if (mobilePattern) {
            sql += " OR mobile LIKE ?";
            params.push(mobilePattern);
          }
          if (mobileStrippedPattern) {
            sql += " OR mobile LIKE ?";
            params.push(mobileStrippedPattern);
          }
        }
        sql += ")";
        return { sql, params };
      };

      const processRows = (rows: any[]) => {
        for (const row of rows) {
          const r = row as any;
          const oid = (r.officeId || '').trim();
          const rName = (r.name || '').trim();
          if (!oid && !rName) continue;
          const rMobile = (r.mobile || '').trim();
          const rDesig = (r.designation || '').trim();
          const key = makeKey(oid, rName, rMobile, dedupByDesignation, rDesig);
          if (!userMap.has(key)) {
            userMap.set(key, { officeId: oid, name: rName, mobile: rMobile, designation: rDesig });
          } else {
            mergeUser(userMap.get(key)!, { officeId: oid, name: rName, mobile: rMobile, designation: rDesig });
          }
        }
      };

      // ১. MealEntry থেকে খুঁজুন (সব ইম্পোর্টেড মেম্বার + মিল এন্ট্রি)
      try {
        const { sql, params } = buildSearchSql('MealEntry');
        const result = await query(sql, params);
        processRows(result.rows);
      } catch (err) {
        console.error('[suggest] MealEntry search error:', err);
      }

      // ২. MealUser থেকেও খুঁজুন (রেজিস্টার্ড ইউজার)
      try {
        const { sql, params } = buildSearchSql('MealUser');
        const userResult = await query(sql, params);
        processRows(userResult.rows);
      } catch (err) {
        console.error('[suggest] MealUser search error:', err);
      }

      // ৩. MealOrder থেকেও খুঁজুন (অর্ডার দেওয়া সব ইউজার)
      try {
        const { sql, params } = buildSearchSql('MealOrder');
        const orderResult = await query(sql, params);
        processRows(orderResult.rows);
      } catch (err) {
        console.error('[suggest] MealOrder search error:', err);
      }

      let users = [...userMap.values()];

      // মোবাইল নম্বর মিসিং হলে MealEntry থেকে মোবাইল ভরান
      for (const u of users) {
        if (!u.mobile || u.mobile.length < 5) {
          try {
            const fillerRows = await query(
              'SELECT mobile FROM MealEntry WHERE officeId = ? AND mobile IS NOT NULL AND length(mobile) >= 5 LIMIT 1',
              [u.officeId]
            );
            if (fillerRows.rows.length > 0) {
              u.mobile = (fillerRows.rows[0] as any).mobile;
            }
          } catch { /* skip */ }
        }
        // পদবী মিসিং হলে সব টেবিল থেকে ভরান
        if (!u.designation || u.designation.length === 0) {
          try {
            const tables = [
              'SELECT designation FROM MealEntry WHERE officeId = ? AND designation IS NOT NULL AND designation != \'\' LIMIT 1',
              'SELECT designation FROM MealUser WHERE officeId = ? AND designation IS NOT NULL AND designation != \'\' LIMIT 1',
              'SELECT designation FROM MealOrder WHERE officeId = ? AND designation IS NOT NULL AND designation != \'\' LIMIT 1',
            ];
            for (const sql of tables) {
              if (!u.officeId) break;
              const rows = await query(sql, [u.officeId]);
              if (rows && rows.rows && rows.rows.length > 0 && (rows.rows[0] as any).designation) {
                u.designation = (rows.rows[0] as any).designation;
                break;
              }
            }
          } catch { /* skip */ }
        }
      }

      users.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'bn'));
      return NextResponse.json({ success: true, users });
    }

    // ===== ACTION: SEARCH =====
    if (action === 'search') {
      if (!searchQuery) return NextResponse.json({ success: false, error: 'আইডি বা মোবাইল দিন' });

      const q = searchQuery.trim().toLowerCase();
      const qClean = q.replace(/\D/g, '');
      const qStripped = stripLeadingZeros(qClean);

      // ===== সব সোর্স থেকে সার্চ করুন: MealEntry + MealUser + MealOrder =====
      // Combine ALL match types (not just top scorer) + search MealUser/MealOrder
      const allEntries = await db.mealEntry.findMany({
        orderBy: { entryDate: 'asc' }
      });

      // MealUser এবং MealOrder থেকেও officeId পাওয়ার চেষ্টা করুন
      let extraOfficeIds: Array<{ officeId: string; name: string; mobile: string; designation: string }> = [];
      try {
        const mealUsers = await query('SELECT officeId, name, mobile, designation FROM MealUser');
        for (const row of mealUsers.rows) {
          const r = row as any;
          if (!r.officeId) continue;
          let matched = false;
          if (r.officeId.toLowerCase().includes(q)) matched = true;
          if (!matched && r.name && r.name.toLowerCase().includes(q)) matched = true;
          if (!matched && qClean.length >= 4 && r.mobile) {
            const mobileClean = r.mobile.replace(/\D/g, '');
            const mobileStripped = stripLeadingZeros(mobileClean);
            if (mobileStripped.includes(qClean) || mobileStripped.includes(qStripped) || qStripped.includes(mobileStripped)) matched = true;
          }
          if (matched) extraOfficeIds.push({ officeId: r.officeId, name: r.name || '', mobile: r.mobile || '', designation: r.designation || '' });
        }
      } catch { /* silent */ }
      try {
        const mealOrders = await query('SELECT DISTINCT officeId, name, mobile, designation FROM MealOrder');
        for (const row of mealOrders.rows) {
          const r = row as any;
          if (!r.officeId) continue;
          let matched = false;
          if (r.officeId.toLowerCase().includes(q)) matched = true;
          if (!matched && r.name && r.name.toLowerCase().includes(q)) matched = true;
          if (!matched && qClean.length >= 4 && r.mobile) {
            const mobileClean = r.mobile.replace(/\D/g, '');
            const mobileStripped = stripLeadingZeros(mobileClean);
            if (mobileStripped.includes(qClean) || mobileStripped.includes(qStripped) || qStripped.includes(mobileStripped)) matched = true;
          }
          if (matched) {
            const exists = extraOfficeIds.find(e => e.officeId.toLowerCase() === r.officeId.toLowerCase());
            if (!exists) extraOfficeIds.push({ officeId: r.officeId, name: r.name || '', mobile: r.mobile || '', designation: r.designation || '' });
          }
        }
      } catch { /* silent */ }

      // ===== COMBINE all match types (officeId + mobile + name) =====
      const matchedByOffice = allEntries.filter(e => e.officeId.toLowerCase().includes(q));
      const matchedByMobile = qClean.length >= 4 ? allEntries.filter(e => {
        const mobileClean = (e.mobile || '').replace(/\D/g, '');
        const mobileStripped = stripLeadingZeros(mobileClean);
        return mobileClean.includes(qClean) || mobileStripped.includes(qClean) || mobileStripped.includes(qStripped) || qStripped.includes(mobileStripped);
      }) : [];
      const matchedByName = q.length >= 2 && !/^\d+$/.test(q) ? allEntries.filter(e => e.name && e.name.toLowerCase().includes(q)) : [];

      // Combine all matches using a Set to avoid duplicates
      const matchedIds = new Set<string>();
      let allMatchingRaw: typeof allEntries = [];
      for (const e of [...matchedByOffice, ...matchedByMobile, ...matchedByName]) {
        if (!matchedIds.has(e.id)) {
          matchedIds.add(e.id);
          allMatchingRaw.push(e);
        }
      }

      // MealEntry তে না পাওয়া গেলে কিন্তু MealUser/MealOrder এ পাওয়া গেলে
      if (allMatchingRaw.length === 0 && extraOfficeIds.length > 0) {
        const targetOid = extraOfficeIds[0].officeId;
        allMatchingRaw = allEntries.filter(e => e.officeId && e.officeId.toLowerCase() === targetOid.toLowerCase());
      }

      const allMatching = allMatchingRaw;

      if (allMatching.length === 0 && extraOfficeIds.length === 0) {
        return NextResponse.json({ success: false, error: `মিলে নাই: "${searchQuery}"` });
      }

      // MealUser/MealOrder থেকে পাওয়া extra info ম্যাপ
      const extraMap = new Map<string, { name: string; mobile: string; designation: string }>();
      for (const e of extraOfficeIds) {
        const key = e.officeId.toLowerCase();
        const existing = extraMap.get(key);
        const score = e.name.length + e.mobile.length + e.designation.length * 2;
        const existingScore = existing ? (existing.name.length + existing.mobile.length + existing.designation.length * 2) : 0;
        if (!existing || score > existingScore) {
          extraMap.set(key, { name: e.name, mobile: e.mobile, designation: e.designation });
        }
      }

      // ===== Dedup: একই officeId + একই দিনের multiple entry থাকলে merge করুন =====
      // পাশাপাশি month/year খালি থাকলে entryDate থেকে ডেরিভ করুন
      const deduped: any[] = [];
      const seen = new Map<string, number>(); // key: "officeId_dateStr" → index in deduped
      for (const entry of allMatching) {
        const e = entry as any;
        // ===== month/year অটো-ফিক্স: entryDate থেকে ডেরিভ =====
        const needMFix = !e.month || e.month === '' || !MONTHS_BN.includes(e.month);
        const needYFix = !e.year || e.year === '';
        if ((needMFix || needYFix) && e.entryDate) {
          const dateStr = (e.entryDate || '').substring(0, 10);
          const dp = dateStr.split('-');
          if (dp.length === 3) {
            const dateObj = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
            if (needMFix) e.month = MONTHS_BN[dateObj.getMonth()];
            if (needYFix) e.year = dp[0];
          }
        }
        const dateStr = (e.entryDate || '').substring(0, 10); // "YYYY-MM-DD"
        const key = `${e.officeId}_${dateStr}`;
        if (seen.has(key)) {
          // Merge into existing entry — counts, deposit, totalBill যোগ হবে
          const idx = seen.get(key)!;
          const existing = deduped[idx];
          existing.breakfastCount = Number(existing.breakfastCount || 0) + Number(e.breakfastCount || 0);
          existing.lunchCount = Number(existing.lunchCount || 0) + Number(e.lunchCount || 0);
          existing.morningSpecial = Number(existing.morningSpecial || 0) + Number(e.morningSpecial || 0);
          existing.lunchSpecial = Number(existing.lunchSpecial || 0) + Number(e.lunchSpecial || 0);
          existing.deposit = Number(existing.deposit || 0) + Number(e.deposit || 0);
          existing.totalBill = Number(existing.totalBill || 0) + Number(e.totalBill || 0);
          // name/mobile/designation সিঙ্ক — খালি থাকলে ভরান
          if (!existing.name && e.name) existing.name = e.name;
          if (!existing.mobile && e.mobile) existing.mobile = e.mobile;
          if (!existing.designation && e.designation) existing.designation = e.designation;
        } else {
          seen.set(key, deduped.length);
          deduped.push({ ...e });
        }
      }

      // Get unique user info from deduped + extraMap (MealUser/MealOrder)
      const firstNamed = deduped.find(e => e.name);
      const firstWithDesignation = deduped.find(e => (e as any).designation);
      const firstWithMobile = deduped.find(e => e.mobile && e.mobile.length >= 5);
      const oidLower = deduped.length > 0 ? (deduped[0].officeId || '').toLowerCase() : '';
      const extraInfo = oidLower ? extraMap.get(oidLower) : null;
      const user = {
        id: deduped.length > 0 ? deduped[0].officeId : (extraOfficeIds.length > 0 ? extraOfficeIds[0].officeId : ''),
        name: firstNamed?.name || extraInfo?.name || '',
        mobile: firstWithMobile?.mobile || extraInfo?.mobile || deduped.find(e => e.mobile)?.mobile || '',
        designation: (firstWithDesignation as any)?.designation || extraInfo?.designation || (firstNamed as any)?.designation || ''
      };

      // Latest balance — সকল মাসের এন্ট্রি থেকে অন-দ্য-ফ্লাই ক্যালকুলেট
      const sortedAll = [...deduped].sort((a, b) => parseEntryDate(a.entryDate) - parseEntryDate(b.entryDate));

      // সব প্রাইস সেটিং লোড করুন
      const allPriceSettings = await db.priceSetting.findMany();
      const priceMap = new Map<string, { breakfastPrice: number; lunchPrice: number; morningSpecial: number; lunchSpecial: number }>();
      for (const s of allPriceSettings) {
        priceMap.set(`${s.month}|${s.year}`, {
          breakfastPrice: s.breakfastPrice, lunchPrice: s.lunchPrice,
          morningSpecial: s.morningSpecial, lunchSpecial: s.lunchSpecial,
        });
      }

      // অন-দ্য-ফ্লাই ক্যালকুলেট — প্রতিটি এন্ট্রির totalBill, prevBalance, curBalance রিক্যালকুলেট
      const enrichedEntries: Array<any> = [];
      let runningBalance = 0;
      for (const entry of sortedAll) {
        const price = priceMap.get(`${entry.month}|${String(entry.year)}`);
        const bill = Number(entry.breakfastCount || 0) * (price?.breakfastPrice || 0)
          + Number(entry.lunchCount || 0) * (price?.lunchPrice || 0)
          + Number(entry.morningSpecial || 0) * (price?.morningSpecial || 0)
          + Number(entry.lunchSpecial || 0) * (price?.lunchSpecial || 0);
        const prevBal = runningBalance;
        runningBalance = runningBalance + Number(entry.deposit || 0) - bill;
        enrichedEntries.push({
          ...entry,
          calculatedBill: bill,
          prevBalance: prevBal,
          curBalance: runningBalance,
        });
      }
      const latestBalance = runningBalance;

      // Filter by month/year
      const isAllMonth = !month || month === 'সকল মাস';
      const isAllYear = !year;

      const filtered = enrichedEntries.filter(e => {
        const mMatch = isAllMonth || e.month === month;
        const yMatch = isAllYear || String(e.year) === String(year);
        return mMatch && yMatch;
      });

      // শুধুমাত্র মিল বা জমা আছে এমন entries রাখুন
      const filteredWithActivity = filtered.filter(e =>
        Number(e.breakfastCount || 0) > 0 || Number(e.lunchCount || 0) > 0 ||
        Number(e.morningSpecial || 0) > 0 || Number(e.lunchSpecial || 0) > 0 ||
        Number(e.deposit || 0) > 0
      );

      const summary = {
        total_mB: 0, total_lM: 0, total_mS: 0, total_lS: 0,
        total_bill: 0, total_deposit: 0, entryCount: filteredWithActivity.length
      };
      for (const e of filteredWithActivity) {
        summary.total_mB += e.breakfastCount;
        summary.total_lM += e.lunchCount;
        summary.total_mS += e.morningSpecial;
        summary.total_lS += e.lunchSpecial;
        // অন-দ্য-ফ্লাই ক্যালকুলেট — প্রাইস সেটিং পরিবর্তনের পরেও সঠিক হিসাব
        summary.total_bill += e.calculatedBill;
        summary.total_deposit += Number(e.deposit || 0);
      }

      // NOTE: MealOrder থেকে আলাদা করে যোগ করা হচ্ছে না
      // কারণ MealOrder তৈরির সাথে সাথেই linked MealEntry (sourceOrderId সহ) তৈরি হয়
      // তাই MealEntry থেকেই সঠিক হিসাব পাওয়া যায় — আলাদা করলে double-counting হয়

      // Get prices for searched month
      let prices = { breakfastPrice: 0, lunchPrice: 0, morningSpecial: 0, lunchSpecial: 0 };
      if (!isAllMonth && year) {
        const s = await db.priceSetting.findUnique({
          where: { month_year: { month, year } }
        });
        if (s) {
          prices.breakfastPrice = s.breakfastPrice;
          prices.lunchPrice = s.lunchPrice;
          prices.morningSpecial = s.morningSpecial;
          prices.lunchSpecial = s.lunchSpecial;
        }
      }

      let allPrices = await db.priceSetting.findMany({
        orderBy: [{ year: 'desc' }, { month: 'asc' }]
      });

      // Month-by-month breakdown
      let monthlyBreakdown: Array<{
        month: string; year: string; totalBill: number; totalDeposit: number;
        netBalance: number; endBalance: number;
      }> = [];

      if (isAllMonth) {
        const grouped: Record<string, {
          month: string; year: string; entries: any[];
          totalBill: number; totalDeposit: number; endBalance: number;
        }> = {};

        for (const e of enrichedEntries) {
          const key = `${e.month}_${e.year}`;
          if (!grouped[key]) {
            grouped[key] = { month: e.month, year: e.year, entries: [], totalBill: 0, totalDeposit: 0, endBalance: 0 };
          }
          grouped[key].entries.push(e);
          grouped[key].totalBill += e.calculatedBill;
          grouped[key].totalDeposit += Number(e.deposit || 0);
          grouped[key].endBalance = e.curBalance;
        }

        monthlyBreakdown = Object.values(grouped).map(g => ({
          month: g.month, year: g.year,
          totalBill: g.totalBill, totalDeposit: g.totalDeposit,
          netBalance: g.totalDeposit - g.totalBill,
          endBalance: g.endBalance
        }));
      }

      // প্রাইস সেটিং চেক — সব প্রাইস ০ হলে ওয়ার্নিং
      const hasAnyPrice = allPrices.some((s: any) =>
        (s.breakfastPrice > 0 || s.lunchPrice > 0 || s.morningSpecial > 0 || s.lunchSpecial > 0)
      );
      const priceWarning = !hasAnyPrice ? 'মিলের দাম সেট করা হয়নি। প্রশাসন প্যানেল থেকে দাম সেট করুন।' : '';

      return NextResponse.json({
        success: true, user, summary, prices, allPrices, latestBalance, priceWarning,
        entries: filteredWithActivity.reverse().map((e: any) => ({
          ...e,
          entryDate: e.entryDate ? (parseEntryDate(e.entryDate) ? new Date(parseEntryDate(e.entryDate)).toISOString() : String(e.entryDate)) : '',
          prevBalance: Number(e.prevBalance) || 0,
          curBalance: Number(e.curBalance) || 0,
          totalBill: Number(e.calculatedBill) || 0,
          deposit: Number(e.deposit) || 0,
        })), monthlyBreakdown,
        searchParams: { month: isAllMonth ? 'সকল মাস' : month, year: isAllYear ? 'সব বছর' : year, isAllMonth }
      });
    }

    // ===== ACTION: EXPORT CSV (বাংলাদেশ সময় সহ) =====
    if (action === 'export') {
      const exportMonth = searchParams.get('adminMonth') || '';
      const exportYear = searchParams.get('adminYear') || '';
      const exportQuery = searchParams.get('adminQuery') || '';

      const whereExport: Record<string, unknown> = {};
      if (exportMonth && exportMonth !== 'all') whereExport.month = exportMonth;
      if (exportYear) whereExport.year = exportYear;

      if (exportQuery) {
        const eq = exportQuery.trim();
        const eqClean = eq.replace(/\D/g, '');
        if (/^\d+$/.test(eq) && eqClean.length > 5) {
          const eqStripped = stripLeadingZeros(eqClean);
          const allExportEntries = await db.mealEntry.findMany({
            where: {
              ...(exportMonth && exportMonth !== 'all' ? { month: exportMonth } : {}),
              ...(exportYear ? { year: exportYear } : {}),
            },
            orderBy: { entryDate: 'asc' }
          });
          const filteredExport = allExportEntries.filter(e => {
            const officeMatch = e.officeId.toLowerCase().includes(eq.toLowerCase());
            const mobileClean = e.mobile.replace(/\D/g, '');
            const mobileStripped = stripLeadingZeros(mobileClean);
            const mobileMatch = mobileClean.includes(eqClean) || mobileStripped.includes(eqStripped) || eqStripped.includes(mobileStripped);
            const nameMatch = e.name && e.name.toLowerCase().includes(eq.toLowerCase());
            return officeMatch || mobileMatch || nameMatch;
          });
          return buildCsvResponse(filteredExport);
        }
        const orConditions: Record<string, unknown>[] = [{ officeId: { contains: eq } }];
        if (eqClean.length > 5) {
          orConditions.push({ mobile: { contains: eqClean } });
        }
        whereExport.OR = orConditions;
      }

      const exportEntries = await db.mealEntry.findMany({
        where: whereExport,
        orderBy: { entryDate: 'asc' }
      });
      return buildCsvResponse(exportEntries);
    }

    // ===== DEFAULT: ADMIN FILTER / ALL ENTRIES =====
    const adminMonth = searchParams.get('adminMonth') || '';
    const adminYear = searchParams.get('adminYear') || '';
    const adminQuery = searchParams.get('adminQuery') || '';

    const where: Record<string, unknown> = {};
    if (adminMonth && adminMonth !== 'all') where.month = adminMonth;
    if (adminYear) where.year = adminYear;

    if (adminQuery) {
      const aq = adminQuery.trim();
      const aqClean = aq.replace(/\D/g, '');

      // If query is numeric and long enough, do manual filtering for stripped mobile
      if (/^\d+$/.test(aq) && aqClean.length > 5) {
        const aqStripped = stripLeadingZeros(aqClean);
        const allEntries = await db.mealEntry.findMany({
          where: {
            ...(adminMonth && adminMonth !== 'all' ? { month: adminMonth } : {}),
            ...(adminYear ? { year: adminYear } : {}),
          },
          orderBy: { entryDate: 'desc' }
        });

        const filtered = allEntries.filter(e => {
          const officeMatch = e.officeId.toLowerCase().includes(aq.toLowerCase());
          const mobileClean = e.mobile.replace(/\D/g, '');
          const mobileStripped = stripLeadingZeros(mobileClean);
          const mobileMatch = mobileClean.includes(aqClean) || mobileStripped.includes(aqStripped) || aqStripped.includes(mobileStripped);
          const nameMatch = e.name && e.name.toLowerCase().includes(aq.toLowerCase());
          return officeMatch || mobileMatch || nameMatch;
        });

        const total = filtered.length;
        const paginated = filtered.slice((page - 1) * limit, page * limit);

        return NextResponse.json({
          success: true, entries: paginated, total,
          page, totalPages: Math.ceil(total / limit)
        });
      }

      // For non-numeric or short queries, use Prisma contains
      const orConditions: Record<string, unknown>[] = [{ officeId: { contains: aq } }];
      if (aqClean.length > 5) {
        orConditions.push({ mobile: { contains: aqClean } });
      }
      // name search
      orConditions.push({ name: { contains: aq } });
      where.OR = orConditions;
    }

    const total = await db.mealEntry.count({ where });
    const entries = await db.mealEntry.findMany({
      where,
      orderBy: { entryDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit
    });

    return NextResponse.json({
      success: true, entries, total,
      page, totalPages: Math.ceil(total / limit)
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST create new entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      month, year, officeId, name, mobile,
      breakfastCount, lunchCount, morningSpecial, lunchSpecial,
      deposit, depositDate
    } = body;

    if ((!officeId && !name && !mobile) || !month || !year) {
      return NextResponse.json({ success: false, error: 'নাম, মোবাইল বা অফিস আইডি, মাস ও বছর দিন' }, { status: 400 });
    }

    // ===== মাস/বছর অটো-ডিটার্মিন: entryDate থেকে month/year ডেরিভ করুন =====
    // যদি month/year খালি থাকে বা entryDate থেকে আলাদা হয়, entryDate থেকে ঠিক করুন
    let finalMonth = month;
    let finalYear = year;
    const entryDateForDerive = (body as any).entryDate || depositDate || '';
    if (entryDateForDerive && entryDateForDerive.length >= 10) {
      const datePart = entryDateForDerive.substring(0, 10);
      const dp = datePart.split('-');
      if (dp.length === 3) {
        const dateObj = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
        const derivedMonth = MONTHS_BN[dateObj.getMonth()];
        const derivedYear = dp[0];
        // যদি month খালি হয় বা entryDate থেকে derived month আলাদা হয়
        if (!finalMonth || finalMonth === '') finalMonth = derivedMonth;
        if (!finalYear || finalYear === '') finalYear = derivedYear;
      }
    }

    // মিল কাউন্ট ও জমা parse করুন
    const bC = parseInt(breakfastCount) || 0;
    const lC = parseInt(lunchCount) || 0;
    const mS = parseInt(morningSpecial) || 0;
    const lS = parseInt(lunchSpecial) || 0;
    const dep = parseInt(deposit) || 0;

    const setting = await db.priceSetting.findUnique({
      where: { month_year: { month: finalMonth, year: finalYear } }
    });
    const bp = setting?.breakfastPrice || 0;
    const lp = setting?.lunchPrice || 0;
    const ms = setting?.morningSpecial || 0;
    const ls = setting?.lunchSpecial || 0;

    const bill = bC * bp + lC * lp + mS * ms + lS * ls;

    // entryDate: admin দেওয়া থাকলে সেটি ব্যবহার করুন
    // না থাকলে depositDate ব্যবহার করুন (টাকা জমা এন্ট্রি থেকে আসলে)
    // তাও না থাকলে বর্তমান BD সময়
    let entryDateVal = (body as any).entryDate || '';
    if (!entryDateVal && depositDate) {
      entryDateVal = depositDate; // "YYYY-MM-DD" format
    }
    if (!entryDateVal) {
      entryDateVal = getBDISOString();
    } else {
      // entryDate যদি YYYY-MM-DD হয়, তাহলে T00:00:00.000 যোগ করুন
      if (/^\d{4}-\d{2}-\d{2}$/.test(entryDateVal)) {
        entryDateVal = entryDateVal + 'T00:00:00.000';
      }
    }

    const orderDateStr = entryDateVal.substring(0, 10); // "YYYY-MM-DD"
    const balanceOfficeId = officeId || '';

    // ===== একই officeId + একই তারিখে আগে থেকেই entry আছে কিনা চেক করুন =====
    // Duplicate prevention: আগের entry তে counts যোগ করুন, নতুন entry তৈরি করবেন না
    const { query: prevQuery } = await import('@/lib/db');
    const sameDayResult = await prevQuery(
      'SELECT * FROM MealEntry WHERE officeId = ? AND substr(entryDate, 1, 10) = ? ORDER BY rowid ASC',
      [balanceOfficeId, orderDateStr]
    );

    let entry: any;
    if (sameDayResult.rows.length > 0) {
      // ===== আগে থেকেই entry আছে — counts যোগ করুন (UPDATE, not CREATE) =====
      const existing = sameDayResult.rows[sameDayResult.rows.length - 1] as any;
      const newB = Number(existing.breakfastCount || 0) + bC;
      const newL = Number(existing.lunchCount || 0) + lC;
      const newMS = Number(existing.morningSpecial || 0) + mS;
      const newLS = Number(existing.lunchSpecial || 0) + lS;
      const newDep = Number(existing.deposit || 0) + dep;
      const newBill = newB * bp + newL * lp + newMS * ms + newLS * ls;

      // month/year খালি থাকলে সেট করুন
      const updateMonth = existing.month || finalMonth;
      const updateYear = existing.year || finalYear;

      await query(
        `UPDATE MealEntry SET breakfastCount = ?, lunchCount = ?, morningSpecial = ?, lunchSpecial = ?,
         totalBill = ?, deposit = ?, depositDate = ?, name = ?, mobile = ?, designation = ?, month = ?, year = ?
         WHERE id = ?`,
        [newB, newL, newMS, newLS, newBill, newDep, depositDate || '', name || existing.name, mobile || existing.mobile, (body as any).designation || existing.designation || '', updateMonth, updateYear, existing.id]
      );
      entry = { ...existing, breakfastCount: newB, lunchCount: newL, morningSpecial: newMS, lunchSpecial: newLS, totalBill: newBill, deposit: newDep };
    } else {
      // ===== নতুন entry তৈরি করুন =====
      const allPrevResult = await prevQuery('SELECT * FROM MealEntry WHERE officeId = ? ORDER BY rowid ASC', [balanceOfficeId]);
      const allPrevEntries = allPrevResult.rows.map((row: any) => ({
        ...row,
        curBalance: Number(row.curBalance) || 0,
      }));

      let prevBal: number;
      if (allPrevEntries.length === 0) {
        prevBal = 0;
      } else {
        const lastEntry = allPrevEntries[allPrevEntries.length - 1];
        prevBal = lastEntry.curBalance;
      }

      entry = await db.mealEntry.create({
        data: {
          entryDate: entryDateVal,
          month: finalMonth, year: finalYear, officeId: balanceOfficeId,
          name: name || '',
          mobile: mobile || '',
          breakfastCount: bC, lunchCount: lC, morningSpecial: mS, lunchSpecial: lS,
          totalBill: bill, deposit: dep, depositDate: depositDate || '',
          prevBalance: prevBal, curBalance: prevBal + dep - bill,
          designation: (body as any).designation || ''
        }
      });
    }

    // সমস্ত এন্ট্রির ব্যালেন্স রিক্যালকুলেট করুন নির্ভুল ভ্যালু নিশ্চিত করতে
    if (balanceOfficeId) {
      await recalculateAllBalances(balanceOfficeId, db);
    }

    // ===== MealOrder সিঙ্ক: মিল কাউন্ট > 0 হলে MealOrder তে UPSERT করুন =====
    const totalMeals = bC + lC + mS + lS;
    if (totalMeals > 0 && balanceOfficeId) {
      try {
        const { month: bdMonth, year: bdYear } = getBdMonthYear(orderDateStr);

        // আগে থেকেই MealOrder আছে কিনা চেক করুন — থাকলে UPDATE, না থাকলে INSERT
        const existingOrder = await query(
          'SELECT * FROM MealOrder WHERE officeId = ? AND orderDate = ?',
          [balanceOfficeId, orderDateStr]
        );

        if (existingOrder.rows.length > 0) {
          // আগে থেকেই MealOrder আছে — শুধু name/mobile/designation আপডেট, counts যোগ করবেন না
          const prev = existingOrder.rows[0] as any;
          await query(
            `UPDATE MealOrder SET name = ?, mobile = ?, designation = ? WHERE officeId = ? AND orderDate = ?`,
            [name || prev.name, mobile || prev.mobile, (body as any).designation || prev.designation || '', balanceOfficeId, orderDateStr]
          );
        } else {
          // নতুন MealOrder তৈরি করুন
          const orderId = 'order_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          await query(
            `INSERT INTO MealOrder (id, officeId, name, mobile, designation, orderDate, month, year, breakfast, lunch, morningSpecial, lunchSpecial)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              orderId, balanceOfficeId, name || '', mobile || '', (body as any).designation || '',
              orderDateStr, bdMonth, bdYear,
              bC, lC, mS, lS
            ]
          );
        }
      } catch { /* MealOrder sync failed — non-critical for entry creation */ }
    }

    return NextResponse.json({ success: true, entry });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// PUT update entry / bulk update member info
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    // ===== ACTION: UPDATE MEMBER INFO (bulk update all entries for officeId) =====
    if (action === 'update_member') {
      const { targetOfficeId, name, mobile, designation } = body;
      if (!targetOfficeId) {
        return NextResponse.json({ success: false, error: 'অফিস আইডি দরকার' }, { status: 400 });
      }
      const result = await db.mealEntry.updateMany({
        where: { officeId: targetOfficeId },
        data: {
          name: name || '',
          mobile: mobile || '',
          designation: designation || '',
        }
      });

      // ===== MealOrder সিঙ্ক: নাম, মোবাইল, পদবী আপডেট করুন =====
      try {
        await query(
          `UPDATE MealOrder SET name = ?, mobile = ?, designation = ? WHERE officeId = ?`,
          [name || '', mobile || '', designation || '', targetOfficeId]
        );
      } catch { /* MealOrder sync failed — non-critical */ }

      return NextResponse.json({ success: true, message: `${result.count}টি এন্ট্রি আপডেট হয়েছে` });
    }

    const { id, month, year, officeId, name, mobile,
      breakfastCount, lunchCount, morningSpecial, lunchSpecial,
      deposit, depositDate } = body;

    const existing = await db.mealEntry.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ success: false, error: 'এন্ট্রি পাওয়া যায়নি' }, { status: 404 });

    const bC = breakfastCount !== undefined ? parseInt(breakfastCount) : existing.breakfastCount;
    const lC = lunchCount !== undefined ? parseInt(lunchCount) : existing.lunchCount;
    const mS = morningSpecial !== undefined ? parseInt(morningSpecial) : existing.morningSpecial;
    const lS = lunchSpecial !== undefined ? parseInt(lunchSpecial) : existing.lunchSpecial;
    const dep = deposit !== undefined ? parseInt(deposit) : existing.deposit;
    const eMonth = month || existing.month;
    const eYear = year || existing.year;

    const setting = await db.priceSetting.findUnique({
      where: { month_year: { month: eMonth, year: eYear } }
    });
    const bp = setting?.breakfastPrice || 0;
    const lp = setting?.lunchPrice || 0;
    const ms = setting?.morningSpecial || 0;
    const ls = setting?.lunchSpecial || 0;
    const bill = bC * bp + lC * lp + mS * ms + lS * ls;

    const updateData: Record<string, any> = {
      month: eMonth, year: eYear,
      officeId: officeId || existing.officeId,
      name: name !== undefined ? name : existing.name,
      mobile: mobile !== undefined ? mobile : existing.mobile,
      breakfastCount: bC, lunchCount: lC, morningSpecial: mS, lunchSpecial: lS,
      totalBill: bill, deposit: dep,
      depositDate: depositDate !== undefined ? depositDate : existing.depositDate,
    };
    // designation update থাকলে সেভ করুন
    if ((body as any).designation !== undefined) {
      updateData.designation = (body as any).designation;
    }

    await db.mealEntry.update({ where: { id }, data: updateData });

    const eOfficeId = officeId || existing.officeId;
    await recalculateAllBalances(eOfficeId, db);

    // ===== MealOrder সিঙ্ক: মিল কাউন্ট পরিবর্তন হলে MealOrder আপডেট করুন =====
    try {
      const oldB = existing.breakfastCount || 0;
      const oldL = existing.lunchCount || 0;
      const oldMS = existing.morningSpecial || 0;
      const oldLS = existing.lunchSpecial || 0;
      const newTotal = bC + lC + mS + lS;
      const oldTotal = oldB + oldL + oldMS + oldLS;

      // কাউন্ট পরিবর্তন হলে MealOrder আপডেট করুন
      if (oldTotal !== newTotal || oldB !== bC || oldL !== lC || oldMS !== mS || oldLS !== lS) {
        const existingAny = existing as any;
        // entryDate থেকে orderDate বের করুন
        const entryDateStr = String(existingAny.entryDate || '').substring(0, 10);
        if (entryDateStr && entryDateStr.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(entryDateStr)) {
          const diffB = bC - oldB;
          const diffL = lC - oldL;
          const diffMS = mS - oldMS;
          const diffLS = lS - oldLS;

          if (newTotal === 0) {
            // সব কাউন্ট ০ → MealOrder থেকে বিয়োগ করুন, মোট ০ হলে ডিলিট করুন
            const orderResult = await query(
              'SELECT * FROM MealOrder WHERE officeId = ? AND orderDate = ?',
              [eOfficeId, entryDateStr]
            );
            if (orderResult.rows.length > 0) {
              const orderRow = orderResult.rows[0] as any;
              const updatedB = Math.max(0, (Number(orderRow.breakfast) || 0) + diffB);
              const updatedL = Math.max(0, (Number(orderRow.lunch) || 0) + diffL);
              const updatedMS = Math.max(0, (Number(orderRow.morningSpecial) || 0) + diffMS);
              const updatedLS = Math.max(0, (Number(orderRow.lunchSpecial) || 0) + diffLS);

              if (updatedB === 0 && updatedL === 0 && updatedMS === 0 && updatedLS === 0) {
                await query('DELETE FROM MealOrder WHERE officeId = ? AND orderDate = ?', [eOfficeId, entryDateStr]);
              } else {
                await query(
                  'UPDATE MealOrder SET breakfast = ?, lunch = ?, morningSpecial = ?, lunchSpecial = ? WHERE officeId = ? AND orderDate = ?',
                  [updatedB, updatedL, updatedMS, updatedLS, eOfficeId, entryDateStr]
                );
              }
            }
          } else {
            // কিছু কাউন্ট আছে → MealOrder তে diff যোগ/বিয়োগ করুন
            const orderResult = await query(
              'SELECT * FROM MealOrder WHERE officeId = ? AND orderDate = ?',
              [eOfficeId, entryDateStr]
            );
            if (orderResult.rows.length > 0) {
              const orderRow = orderResult.rows[0] as any;
              const updatedB = Math.max(0, (Number(orderRow.breakfast) || 0) + diffB);
              const updatedL = Math.max(0, (Number(orderRow.lunch) || 0) + diffL);
              const updatedMS = Math.max(0, (Number(orderRow.morningSpecial) || 0) + diffMS);
              const updatedLS = Math.max(0, (Number(orderRow.lunchSpecial) || 0) + diffLS);

              if (updatedB === 0 && updatedL === 0 && updatedMS === 0 && updatedLS === 0) {
                await query('DELETE FROM MealOrder WHERE officeId = ? AND orderDate = ?', [eOfficeId, entryDateStr]);
              } else {
                await query(
                  'UPDATE MealOrder SET breakfast = ?, lunch = ?, morningSpecial = ?, lunchSpecial = ?, name = COALESCE(?, name), mobile = COALESCE(?, mobile), designation = COALESCE(?, designation) WHERE officeId = ? AND orderDate = ?',
                  [updatedB, updatedL, updatedMS, updatedLS, updateData.name || null, updateData.mobile || null, updateData.designation || null, eOfficeId, entryDateStr]
                );
              }
            }
          }
        }
      }
    } catch { /* MealOrder sync failed — non-critical */ }

    return NextResponse.json({ success: true, message: 'আপডেট হয়েছে ও ব্যালেন্স রিক্যালকুলেট হয়েছে' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE entry
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || '';

    // ===== ACTION: DELETE ALL (পুরা ডাটাবেজ ফাকা) — Admin auth required =====
    if (action === 'delete_all') {
      // Token check + fallback: password verify (serverless তে in-memory token share হয় না)
      const token = request.headers.get('x-admin-token');
      const adminPwd = request.headers.get('x-admin-password') || '';
      let isAuth = false;
      if (token && validateAdminSession(token)) {
        isAuth = true;
      } else if (adminPwd) {
        try {
          const config = await db.systemSetting.findUnique({ where: { key: 'admin_password' } });
          const storedPwd = (config && config.value) || 'admin123';
          if (adminPwd === storedPwd) isAuth = true;
        } catch { /* fallback */ }
      }
      if (!isAuth) {
        return NextResponse.json({ success: false, error: 'অনুমতি নেই। আবার লগইন করুন।' }, { status: 401 });
      }

      // ===== সব টেবিলের ডাটা গুনুন =====
      let mealCount = 0, settingCount = 0, orderCount = 0, specialCount = 0, marketCount = 0, userCount = 0;

      try { mealCount = await db.mealEntry.count(); } catch {}
      try { settingCount = await db.priceSetting.count(); } catch {}
      try {
        const r = await query('SELECT COUNT(*) as c FROM MealOrder');
        orderCount = Number((r as any).rows?.[0]?.c || 0);
      } catch {}
      try {
        const r = await query('SELECT COUNT(*) as c FROM SpecialMealSetting');
        specialCount = Number((r as any).rows?.[0]?.c || 0);
      } catch {}
      try {
        const r = await query('SELECT COUNT(*) as c FROM MarketExpense');
        marketCount = Number((r as any).rows?.[0]?.c || 0);
      } catch {}
      try {
        const r = await query('SELECT COUNT(*) as c FROM MealUser');
        userCount = Number((r as any).rows?.[0]?.c || 0);
      } catch {}

      // ===== batchQuery দিয়ে সব টেবিল একসাথে ফাকা করুন =====
      const statements = [
        { sql: 'DELETE FROM MealEntry', args: [] },
        { sql: 'DELETE FROM PriceSetting', args: [] },
        { sql: 'DELETE FROM MealOrder', args: [] },
        { sql: 'DELETE FROM SpecialMealSetting', args: [] },
        { sql: 'DELETE FROM MarketExpense', args: [] },
        { sql: 'DELETE FROM MealUser', args: [] },
      ];

      try {
        await batchQuery(statements);
      } catch (batchErr) {
        // batchQuery ফেইল হলে একটি একটি করে চেষ্টা করুন
        console.error('batchQuery failed, trying individually:', batchErr);
        const fallbacks = [
          { sql: 'DELETE FROM MealEntry', args: [], label: 'MealEntry' },
          { sql: 'DELETE FROM PriceSetting', args: [], label: 'PriceSetting' },
          { sql: 'DELETE FROM MealOrder', args: [], label: 'MealOrder' },
          { sql: 'DELETE FROM SpecialMealSetting', args: [], label: 'SpecialMealSetting' },
          { sql: 'DELETE FROM MarketExpense', args: [], label: 'MarketExpense' },
          { sql: 'DELETE FROM MealUser', args: [], label: 'MealUser' },
        ];
        for (const fb of fallbacks) {
          try { await query(fb.sql, fb.args); } catch (e) { console.error(`${fb.label} individual delete error:`, e); }
        }
      }

      return NextResponse.json({
        success: true,
        message: `পুরা ডাটাবেজ ফাকা করা হয়েছে। মিল এন্ট্রি: ${mealCount}, প্রাইস সেটিং: ${settingCount}, মিল অর্ডার: ${orderCount}, রান্নার সেটিং: ${specialCount}, বাজার খরচ: ${marketCount}, ইউজার: ${userCount} — সব ডিলিট হয়েছে।`
      });
    }

    // ===== ACTION: DELETE BULK (মাস/বছর অনুযায়ী সব ডাটা ডিলিট) — Admin auth required =====
    if (action === 'delete_bulk') {
      // Token check + fallback: password verify (serverless তে in-memory token share হয় না)
      const bulkToken = request.headers.get('x-admin-token');
      const bulkAdminPwd = request.headers.get('x-admin-password') || '';
      let isBulkAuth = false;
      if (bulkToken && validateAdminSession(bulkToken)) {
        isBulkAuth = true;
      } else if (bulkAdminPwd) {
        try {
          const config = await db.systemSetting.findUnique({ where: { key: 'admin_password' } });
          const storedPwd = (config && config.value) || 'admin123';
          if (bulkAdminPwd === storedPwd) isBulkAuth = true;
        } catch { /* fallback */ }
      }
      if (!isBulkAuth) {
        return NextResponse.json({ success: false, error: 'অনুমতি নেই। আবার লগইন করুন।' }, { status: 401 });
      }

      const month = searchParams.get('month') || '';
      const year = searchParams.get('year') || '';
      if (!month || !year) {
        return NextResponse.json({ success: false, error: 'মাস ও বছর দিন' }, { status: 400 });
      }

      // কতগুলো এন্ট্রি ডিলিট হবে তা আগে দেখুন
      const count = await db.mealEntry.count({ where: { month, year } });
      if (count === 0) {
        return NextResponse.json({ success: false, error: `${month} ${year} এর কোনো ডাটা নেই` }, { status: 404 });
      }

      // যেসব officeId আছে, সেগুলোর ব্যালেন্স রিক্যালকুলেট করতে হবে
      const entriesToDelete = await db.mealEntry.findMany({
        where: { month, year },
        select: { officeId: true }
      });
      const affectedOfficeIds = [...new Set(entriesToDelete.map((e: any) => e.officeId))];

      // ডিলিট করুন
      await db.mealEntry.deleteMany({ where: { month, year } });

      // ঐ মাসের MealOrder ও ডিলিট করুন
      await query('DELETE FROM MealOrder WHERE month = ? AND year = ?', [month, year]);

      // প্রভাবিত officeId গুলোর ব্যালেন্স রিক্যালকুলেট করুন
      for (const oid of affectedOfficeIds) {
        await recalculateAllBalances(oid, db);
      }

      return NextResponse.json({
        success: true,
        message: `${month} ${year} এর ${count}টি এন্ট্রি ডিলিট হয়েছে। MealOrder ও ডিলিট হয়েছে। ব্যালেন্স রিক্যালকুলেট হয়েছে`
      });
    }

    // ===== ACTION: DELETE YEAR MEMBER (বছরভিত্তিক ডিলিট) — Admin auth required =====
    if (action === 'delete_year_member') {
      // Token check + fallback: password verify (serverless তে in-memory token share হয় না)
      const delToken = request.headers.get('x-admin-token');
      const delAdminPwd = request.headers.get('x-admin-password') || '';
      let isDelAuth = false;
      if (delToken && validateAdminSession(delToken)) {
        isDelAuth = true;
      } else if (delAdminPwd) {
        try {
          const config = await db.systemSetting.findUnique({ where: { key: 'admin_password' } });
          const storedPwd = (config && config.value) || 'admin123';
          if (delAdminPwd === storedPwd) isDelAuth = true;
        } catch { /* fallback */ }
      }
      if (!isDelAuth) {
        return NextResponse.json({ success: false, error: 'অনুমতি নেই। আবার লগইন করুন।' }, { status: 401 });
      }

      const delYear = searchParams.get('delYear') || '';
      const delQuery = searchParams.get('delQuery') || '';

      if (!delYear || !delQuery) {
        return NextResponse.json({ success: false, error: 'বছর এবং আইডি/মোবাইল দিন' }, { status: 400 });
      }

      const q = delQuery.trim().toLowerCase();
      const qClean = q.replace(/\D/g, '');
      const qStripped = stripLeadingZeros(qClean);

      // ঐ বছরের সব এন্ট্রি
      const yearEntries = await db.mealEntry.findMany({
        where: { year: delYear },
        orderBy: { entryDate: 'desc' }
      });

      // Query দিয়ে filter
      const matched = yearEntries.filter(e => {
        const officeMatch = e.officeId.toLowerCase().includes(q);
        let mobileMatch = false;
        if (qClean.length >= 4 && e.mobile) {
          const mobileClean = e.mobile.replace(/\D/g, '');
          const mobileStripped = stripLeadingZeros(mobileClean);
          mobileMatch = mobileClean.includes(qClean) || mobileStripped.includes(qStripped);
        }
        const nameMatch = q.length >= 2 && !/^\d+$/.test(q) && e.name && e.name.toLowerCase().includes(q);
        return officeMatch || mobileMatch || nameMatch;
      });

      if (matched.length === 0) {
        return NextResponse.json({ success: false, error: `${delYear} সালে এই আইডি/মোবাইলের কোনো ডাটা নেই` }, { status: 404 });
      }

      const uniqueOfficeIds = [...new Set(matched.map((e: any) => e.officeId))];
      let deletedCount = 0;
      let zeroOutCount = 0;
      const affectedOfficeIds = new Set<string>();

      for (const oid of uniqueOfficeIds) {
        affectedOfficeIds.add(oid);

        // এই officeId এর সব এন্ট্রি দেখুন
        const allForOffice = await db.mealEntry.findMany({
          where: { officeId: oid },
          orderBy: { entryDate: 'desc' }
        });

        const entriesInThisYear = allForOffice.filter(e => e.year === delYear);

        if (entriesInThisYear.length === 0) continue;

        // মূল তথ্য সংগ্রহ (নাম, মোবাইল, পদবী) — সবচেয়ে সম্পূর্ণ এন্ট্রি থেকে নিন
        const bestEntry = entriesInThisYear.reduce((best, e) => {
          const score = (e.name?.length || 0) + (e.mobile?.length || 0) + (e.designation?.length || 0);
          const bestScore = (best.name?.length || 0) + (best.mobile?.length || 0) + (best.designation?.length || 0);
          return score > bestScore ? e : best;
        }, entriesInThisYear[0]);

        // বাকি সব এন্ট্রি ডিলিট করুন
        for (const entry of entriesInThisYear) {
          if (entry.id !== bestEntry.id) {
            await db.mealEntry.delete({ where: { id: entry.id } });
            deletedCount++;
          }
        }

        // একটি এন্ট্রি রেখে শুধু মূল তথ্য রাখুন, বাকি সব শূন্য করুন
        await db.mealEntry.update({
          where: { id: bestEntry.id },
          data: {
            breakfastCount: 0,
            lunchCount: 0,
            morningSpecial: 0,
            lunchSpecial: 0,
            totalBill: 0,
            deposit: 0,
            depositDate: '',
            prevBalance: 0,
            curBalance: 0,
            // name, officeId, mobile, designation রাখা হয়েছে
          }
        });
        zeroOutCount++;

        // এই officeId এর সব MealOrder ডিলিট করুন
        await query('DELETE FROM MealOrder WHERE officeId = ?', [oid]);
      }

      // প্রভাবিত officeId গুলোর ব্যালেন্স রিক্যালকুলেট করুন
      for (const oid of affectedOfficeIds) {
        await recalculateAllBalances(oid, db);
      }

      return NextResponse.json({
        success: true,
        message: `${delYear} সালের ${deletedCount}টি এন্ট্রি ডিলিট ও ${zeroOutCount}টি এন্ট্রির মিল/টাকা শূন্য করা হয়েছে। মূল তথ্য ও পূর্ব ব্যালেন্স(০) রাখা হয়েছে।`
      });
    }

    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID দরকার' }, { status: 400 });

    const entry = await db.mealEntry.findUnique({ where: { id } });
    if (!entry) return NextResponse.json({ success: false, error: 'এন্ট্রি পাওয়া যায়নি' }, { status: 404 });

    const entryAny = entry as any;
    const delB = Number(entry.breakfastCount) || 0;
    const delL = Number(entry.lunchCount) || 0;
    const delMS = Number(entry.morningSpecial) || 0;
    const delLS = Number(entry.lunchSpecial) || 0;
    const delTotalMeals = delB + delL + delMS + delLS;

    // Linked MealOrder থাকলে (sourceOrderId) → MealOrder ডিলিট করুন
    if (entryAny.sourceOrderId) {
      await query('DELETE FROM MealOrder WHERE id = ?', [entryAny.sourceOrderId]);
    } else if (delTotalMeals > 0) {
      // sourceOrderId নেই কিন্তু মিল কাউন্ট আছে → MealOrder থেকে বিয়োগ করুন
      try {
        const entryDateStr = String(entry.entryDate || '').substring(0, 10);
        if (entryDateStr && entryDateStr.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(entryDateStr)) {
          const orderResult = await query(
            'SELECT * FROM MealOrder WHERE officeId = ? AND orderDate = ?',
            [entry.officeId, entryDateStr]
          );
          if (orderResult.rows.length > 0) {
            const orderRow = orderResult.rows[0] as any;
            const updatedB = Math.max(0, (Number(orderRow.breakfast) || 0) - delB);
            const updatedL = Math.max(0, (Number(orderRow.lunch) || 0) - delL);
            const updatedMS = Math.max(0, (Number(orderRow.morningSpecial) || 0) - delMS);
            const updatedLS = Math.max(0, (Number(orderRow.lunchSpecial) || 0) - delLS);

            if (updatedB === 0 && updatedL === 0 && updatedMS === 0 && updatedLS === 0) {
              await query('DELETE FROM MealOrder WHERE officeId = ? AND orderDate = ?', [entry.officeId, entryDateStr]);
            } else {
              await query(
                'UPDATE MealOrder SET breakfast = ?, lunch = ?, morningSpecial = ?, lunchSpecial = ? WHERE officeId = ? AND orderDate = ?',
                [updatedB, updatedL, updatedMS, updatedLS, entry.officeId, entryDateStr]
              );
            }
          }
        }
      } catch { /* MealOrder sync failed — non-critical */ }
    }

    await db.mealEntry.delete({ where: { id } });
    await recalculateAllBalances(entry.officeId, db);

    return NextResponse.json({ success: true, message: 'এন্ট্রি ডিলিট হয়েছে ও ব্যালেন্স রিক্যালকুলেট হয়েছে' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
