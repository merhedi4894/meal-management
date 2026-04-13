import { NextRequest, NextResponse } from 'next/server';
import { query, db, batchQuery } from '@/lib/db';
import { validateAdminSession } from '@/middleware';

// =============================================
// HELPERS
// =============================================

// Helper: strip leading zeros
function stripLeadingZeros(s: string): string {
  return s.replace(/^0+/, '') || '0';
}

// Helper: get Bangladesh time as a Date object (UTC + 6 hours)
function getBdTime(): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const bdMs = utcMs + 6 * 60 * 60000;
  return new Date(bdMs);
}

// Helper: check if lunch deadline (10:00 AM BD time on orderDate) has passed
function isDeadlineExpired(orderDate: string): boolean {
  const now = new Date(); // Current UTC time
  const parts = orderDate.split('-').map(Number);
  const y = parts[0], m = parts[1], d = parts[2];
  // 10:00 AM BD time = 04:00 UTC
  const deadlineUtc = Date.UTC(y, m - 1, d, 4, 0, 0);
  return now.getTime() >= deadlineUtc;
}

// Helper: get Bangla month name and year from orderDate
function getBdMonthYear(orderDate: string): { month: string; year: string } {
  const MONTHS_BN = [
    'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
  ];
  const dp = orderDate.split('-');
  const dateObj = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
  return {
    month: MONTHS_BN[dateObj.getMonth()],
    year: dp[0],
  };
}

// Helper: parse entryDate (epoch number, ISO string, DD-MM-YYYY formats)
function parseEntryDate(d: any): number {
  if (!d) return 0;
  if (typeof d === 'number') return d;
  let s = String(d).trim();
  // Fix malformed dates missing 'T' separator (e.g. "2026-04-1319:50:15.000")
  if (/^\d{4}-\d{2}-\d{2}\d{2}:\d{2}/.test(s)) {
    s = s.replace(/^(\d{4}-\d{2}-\d{2})(\d)/, '$1T$2');
  }
  if (/^\d{4}-\d{2}/.test(s)) {
    const parsed = Date.parse(
      s.includes('Z') || s.includes('+') || s.includes('-06') || s.includes('-05')
        ? s
        : s + '+06:00'
    );
    return isNaN(parsed) ? 0 : parsed;
  }
  const ddMatch = s.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (ddMatch) return new Date(+ddMatch[3], +ddMatch[2] - 1, +ddMatch[1]).getTime();
  const parsed = Date.parse(s);
  return isNaN(parsed) ? 0 : parsed;
}

// Helper: create or update MealEntry for an order (raw SQL to include sourceOrderId)
async function createMealEntryForOrder(
  order: { officeId: string; name: string; mobile: string; designation: string; breakfast: number; lunch: number; morningSpecial: number; lunchSpecial: number },
  sourceOrderId: string,
  month: string,
  year: string,
  orderDate: string // অর্ডারের তারিখ (YYYY-MM-DD format)
) {
  // Get price setting
  const setting = await db.priceSetting.findUnique({
    where: { month_year: { month, year } }
  });
  const bp = setting?.breakfastPrice || 0;
  const lp = setting?.lunchPrice || 0;
  const ms = setting?.morningSpecial || 0;
  const ls = setting?.lunchSpecial || 0;

  const breakfast = order.breakfast || 0;
  const lunch = order.lunch || 0;
  const morningSpecial = order.morningSpecial || 0;
  const lunchSpecial = order.lunchSpecial || 0;
  const bill = breakfast * bp + lunch * lp + morningSpecial * ms + lunchSpecial * ls;

  // Check if a MealEntry already exists for this officeId linked to this sourceOrderId
  const existingEntry = await query(
    'SELECT * FROM MealEntry WHERE sourceOrderId = ?',
    [sourceOrderId]
  );

  if (existingEntry.rows.length > 0) {
    // Update existing entry — SET to MealOrder total values (NOT add)
    // MealOrder is the source of truth for order counts
    const entry = existingEntry.rows[0] as any;
    const newBill = breakfast * bp + lunch * lp + morningSpecial * ms + lunchSpecial * ls;

    await query(
      `UPDATE MealEntry
       SET breakfastCount = ?, lunchCount = ?,
           morningSpecial = ?, lunchSpecial = ?,
           totalBill = ?, name = ?, mobile = ?, designation = ?
       WHERE id = ?`,
      [breakfast, lunch, morningSpecial, lunchSpecial, newBill,
       order.name || entry.name, order.mobile || entry.mobile, order.designation || entry.designation,
       entry.id]
    );
    return;
  }

  // sourceOrderId দিয়ে পাওয়া যায়নি → একই officeId + একই দিনের কোনো entry আছে কিনা চেক করুন (duplicate prevention)
  const orderDateStr = (orderDate || '').substring(0, 10); // "YYYY-MM-DD"
  const sameDayEntries = await query(
    `SELECT * FROM MealEntry WHERE officeId = ? AND substr(entryDate, 1, 10) = ? ORDER BY rowid ASC`,
    [order.officeId, orderDateStr]
  );

  if (sameDayEntries.rows.length > 0) {
    // একই দিনের entry আছে → sourceOrderId আছে এমন entry খুঁজুন
    const withSource = sameDayEntries.rows.find((e: any) => e.sourceOrderId && e.sourceOrderId.length > 0);

    if (withSource) {
      // ভিন্ন sourceOrderId সহ entry — UPDATE করুন (নতুন entry তৈরি করবেন না)
      const targetEntry = withSource as any;
      const newBill = breakfast * bp + lunch * lp + morningSpecial * ms + lunchSpecial * ls;
      await query(
        `UPDATE MealEntry
         SET breakfastCount = ?, lunchCount = ?,
             morningSpecial = ?, lunchSpecial = ?,
             totalBill = ?, sourceOrderId = ?, name = ?, mobile = ?, designation = ?
         WHERE id = ?`,
        [breakfast, lunch, morningSpecial, lunchSpecial, newBill,
         sourceOrderId, order.name || targetEntry.name, order.mobile || targetEntry.mobile, order.designation || targetEntry.designation,
         targetEntry.id]
      );
      return;
    }

    // ===== MANUAL ENTRY EXISTS but no sourceOrderId entry =====
    // ম্যানুয়াল entry আপডেট করুন — MealOrder এখন source of truth
    // ম্যানুয়াল entry-তে counts SET করুন (যোগ করবেন না), sourceOrderId যুক্ত করুন
    const targetEntry = sameDayEntries.rows[0] as any;
    const newBill = breakfast * bp + lunch * lp + morningSpecial * ms + lunchSpecial * ls;
    await query(
      `UPDATE MealEntry
       SET breakfastCount = ?, lunchCount = ?,
           morningSpecial = ?, lunchSpecial = ?,
           totalBill = ?, sourceOrderId = ?, name = ?, mobile = ?, designation = ?
       WHERE id = ?`,
      [breakfast, lunch, morningSpecial, lunchSpecial, newBill,
       sourceOrderId, order.name || targetEntry.name, order.mobile || targetEntry.mobile, order.designation || targetEntry.designation,
       targetEntry.id]
    );
    return;
  }

  // No existing entry — create new one
  // entryDate অর্ডারের তারিখ ব্যবহার করুন, সময়টি বর্তমান BD সময় ব্যবহার হবে
  const bd = getBdTime();
  const entryDateStr = `${orderDateStr}T${String(bd.getHours()).padStart(2, '0')}:${String(bd.getMinutes()).padStart(2, '0')}:${String(bd.getSeconds()).padStart(2, '0')}.000`;

  // Get prevBalance from last MealEntry for this officeId
  const prevResult = await query(
    'SELECT curBalance FROM MealEntry WHERE officeId = ? ORDER BY rowid DESC LIMIT 1',
    [order.officeId]
  );
  const prevBal = prevResult.rows.length > 0 ? Number(prevResult.rows[0].curBalance) || 0 : 0;

  const id = 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2);

  // Use raw query to include sourceOrderId
  await query(
    `INSERT INTO MealEntry (id, entryDate, month, year, officeId, name, mobile, breakfastCount, lunchCount, morningSpecial, lunchSpecial, totalBill, deposit, depositDate, prevBalance, curBalance, designation, sourceOrderId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, entryDateStr, month, year, order.officeId,
      order.name || '', order.mobile || '',
      breakfast, lunch, morningSpecial, lunchSpecial,
      bill, 0, '', prevBal, prevBal - bill,
      order.designation || '', sourceOrderId
    ]
  );
}

// Helper: recalculate all balance fields for every MealEntry of an officeId
async function recalculateBalancesForOffice(officeId: string) {
  // Fetch all entries in insertion order
  const result = await query(
    'SELECT * FROM MealEntry WHERE officeId = ? ORDER BY rowid ASC',
    [officeId]
  );

  if (result.rows.length === 0) return;

  // Load all price settings
  const allSettings = await db.priceSetting.findMany();
  const settingMap = new Map<string, { breakfastPrice: number; lunchPrice: number; morningSpecial: number; lunchSpecial: number }>();
  for (const s of allSettings) {
    settingMap.set(`${s.month}|${s.year}`, {
      breakfastPrice: s.breakfastPrice,
      lunchPrice: s.lunchPrice,
      morningSpecial: s.morningSpecial,
      lunchSpecial: s.lunchSpecial,
    });
  }

  // Sort entries by entryDate
  const entries = [...result.rows].sort((a: any, b: any) => {
    return parseEntryDate(a.entryDate) - parseEntryDate(b.entryDate);
  });

  // Running balance calculation
  let runningBal = 0;
  const statements: Array<{ sql: string; args: any[] }> = [];

  for (const entry of entries) {
    const e = entry as any;
    const eB = Number(e.breakfastCount) || 0;
    const eL = Number(e.lunchCount) || 0;
    const eMS = Number(e.morningSpecial) || 0;
    const eLS = Number(e.lunchSpecial) || 0;
    const eDep = Number(e.deposit) || 0;

    const setting = settingMap.get(`${e.month}|${String(e.year)}`);
    const bp = setting?.breakfastPrice || 0;
    const lp = setting?.lunchPrice || 0;
    const ms = setting?.morningSpecial || 0;
    const ls = setting?.lunchSpecial || 0;
    const bill = eB * bp + eL * lp + eMS * ms + eLS * ls;
    const curBal = runningBal + eDep - bill;

    statements.push({
      sql: 'UPDATE MealEntry SET prevBalance = ?, curBalance = ?, totalBill = ? WHERE id = ?',
      args: [runningBal, curBal, bill, e.id]
    });

    runningBal = curBal;
  }

  // Batch update
  if (statements.length > 0) {
    try {
      await batchQuery(statements);
    } catch {
      // Fallback: one-by-one update
      for (const stmt of statements) {
        await query(stmt.sql, stmt.args);
      }
    }
  }
}

// =============================================
// GET HANDLER — অর্ডার লিস্ট, মাসিক সামারি, ইউজার সার্চ
// =============================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'list';
    const month = searchParams.get('month') || '';
    const year = searchParams.get('year') || '';
    const orderDate = searchParams.get('orderDate') || '';
    const officeId = searchParams.get('officeId') || '';

    // ===== ACTION: LIST — নির্দিষ্ট তারিখের অর্ডার =====
    if (action === 'list') {
      if (!orderDate) {
        return NextResponse.json({ success: false, error: 'তারিখ দিন' });
      }

      // ===== SINGLE SOURCE OF TRUTH: MealEntry only =====
      const dateStr = orderDate.substring(0, 10);
      const whereClause = officeId
        ? "substr(entryDate, 1, 10) = ? AND officeId = ? AND officeId != ''"
        : "substr(entryDate, 1, 10) = ? AND officeId != ''";
      const params = officeId ? [dateStr, officeId] : [dateStr];

      const result = await query(
        `SELECT officeId, MAX(name) as name, MAX(mobile) as mobile, MAX(designation) as designation,
                COALESCE(SUM(breakfastCount),0) as breakfast,
                COALESCE(SUM(lunchCount),0) as lunch,
                COALESCE(SUM(morningSpecial),0) as morningSpecial,
                COALESCE(SUM(lunchSpecial),0) as lunchSpecial
         FROM MealEntry WHERE ${whereClause}
         GROUP BY officeId ORDER BY name ASC`,
        params
      );

      const orders = result.rows
        .filter((d: any) => Number(d.breakfast) > 0 || Number(d.lunch) > 0 || Number(d.morningSpecial) > 0 || Number(d.lunchSpecial) > 0)
        .map((d: any) => ({
          officeId: d.officeId || '', name: d.name || '', mobile: d.mobile || '', designation: d.designation || '',
          breakfast: Number(d.breakfast) || 0, lunch: Number(d.lunch) || 0,
          morningSpecial: Number(d.morningSpecial) || 0, lunchSpecial: Number(d.lunchSpecial) || 0,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name, 'bn'));

      return NextResponse.json({ success: true, orders, total: orders.length });
    }

    // ===== ACTION: SUMMARY — মাসিক মিলের বিবরণ =====
    if (action === 'summary') {
      if (!month || !year) {
        return NextResponse.json({ success: false, error: 'মাস ও বছর দিন' });
      }

      // Get meal prices
      const priceResult = await query('SELECT * FROM PriceSetting WHERE month = ? AND year = ?', [month, year]);
      const prices = priceResult.rows.length > 0 ? priceResult.rows[0] as any : null;
      const bp = Number(prices?.breakfastPrice) || 0;
      const lp = Number(prices?.lunchPrice) || 0;
      const ms = Number(prices?.morningSpecial) || 0;
      const ls = Number(prices?.lunchSpecial) || 0;

      // ===== SINGLE SOURCE OF TRUTH: MealEntry only =====
      // Every MealOrder creates a linked MealEntry, so MealEntry contains all data
      const whereClause = officeId
        ? "month = ? AND year = ? AND officeId = ? AND officeId != ''"
        : "month = ? AND year = ? AND officeId != ''";
      const params = officeId ? [month, year, officeId] : [month, year];

      const result = await query(
        `SELECT officeId, MAX(name) as name, MAX(mobile) as mobile, MAX(designation) as designation,
                COALESCE(SUM(breakfastCount),0) as totalBreakfast,
                COALESCE(SUM(lunchCount),0) as totalLunch,
                COALESCE(SUM(morningSpecial),0) as totalMorningSpecial,
                COALESCE(SUM(lunchSpecial),0) as totalLunchSpecial
         FROM MealEntry WHERE ${whereClause}
         GROUP BY officeId ORDER BY name ASC`,
        params
      );

      let grandB = 0, grandL = 0, grandMS = 0, grandLS = 0;
      const details = result.rows
        .filter((d: any) => Number(d.totalBreakfast) > 0 || Number(d.totalLunch) > 0 || Number(d.totalMorningSpecial) > 0 || Number(d.totalLunchSpecial) > 0)
        .map((d: any) => {
          const tB = Number(d.totalBreakfast) || 0;
          const tL = Number(d.totalLunch) || 0;
          const tMS = Number(d.totalMorningSpecial) || 0;
          const tLS = Number(d.totalLunchSpecial) || 0;
          grandB += tB; grandL += tL; grandMS += tMS; grandLS += tLS;
          return {
            officeId: d.officeId || '', name: d.name || '', designation: d.designation || '', mobile: d.mobile || '',
            totalBreakfast: tB, totalLunch: tL, totalMorningSpecial: tMS, totalLunchSpecial: tLS,
            totalBill: tB * bp + tL * lp + tMS * ms + tLS * ls,
          };
        })
        .sort((a: any, b: any) => a.name.localeCompare(b.name, 'bn'));

      const grandTotal = grandB * bp + grandL * lp + grandMS * ms + grandLS * ls;

      return NextResponse.json({
        success: true,
        summary: { totalBreakfast: grandB, totalLunch: grandL, totalMorningSpecial: grandMS, totalLunchSpecial: grandLS, grandTotal, breakfastPrice: bp, lunchPrice: lp, morningSpecialPrice: ms, lunchSpecialPrice: ls },
        details,
      });
    }

    // ===== ACTION: SUGGEST — নাম/আইডি/মোবাইল সাজেশন =====
    if (action === 'suggest') {
      const q = (searchParams.get('query') || '').trim();
      if (q.length < 2) {
        return NextResponse.json({ success: true, users: [] });
      }

      const qLower = q.toLowerCase();
      const qClean = q.replace(/\D/g, '');
      const qStripped = stripLeadingZeros(qClean);

      // MealEntry থেকে খুঁজুন
      const result = await query(
        "SELECT DISTINCT officeId, name, mobile, designation FROM MealEntry WHERE officeId != '' ORDER BY name ASC"
      );

      const userMap = new Map<string, { officeId: string; name: string; mobile: string; designation: string }>();

      for (const row of result.rows) {
        const r = row as any;
        const oid = (r.officeId || '').trim();
        const name = (r.name || '').trim();
        const mobile = (r.mobile || '').trim();
        const desig = (r.designation || '').trim();
        if (!oid) continue;

        let matched = false;
        if (oid.toLowerCase().includes(qLower)) matched = true;
        if (!matched && name.toLowerCase().includes(qLower)) matched = true;
        if (!matched && qClean.length >= 3 && mobile) {
          const mobileClean = mobile.replace(/\D/g, '');
          const mobileStripped = stripLeadingZeros(mobileClean);
          if (mobileClean.includes(qClean) || mobileStripped.includes(qStripped)) matched = true;
        }

        if (matched && !userMap.has(oid.toLowerCase())) {
          userMap.set(oid.toLowerCase(), { officeId: oid, name, mobile, designation: desig });
        }
        if (userMap.size >= 10) break;
      }

      // MealUser থেকেও খুঁজুন ও পদবী ভরান
      try {
        const userResult = await query(
          'SELECT officeId, name, mobile, designation FROM MealUser'
        );
        for (const row of userResult.rows) {
          const r = row as any;
          const oid = (r.officeId || '').trim().toLowerCase();
          const name = (r.name || '').trim();
          const mobile = (r.mobile || '').trim();
          const desig = (r.designation || '').trim();
          if (!oid) continue;

          let matched = false;
          if (oid.includes(qLower)) matched = true;
          if (!matched && name.toLowerCase().includes(qLower)) matched = true;
          if (!matched && qClean.length >= 3 && mobile) {
            const mobileClean = mobile.replace(/\D/g, '');
            const mobileStripped = stripLeadingZeros(mobileClean);
            if (mobileClean.includes(qClean) || mobileStripped.includes(qStripped)) matched = true;
          }

          if (matched) {
            const existing = userMap.get(oid);
            if (!existing) {
              userMap.set(oid, { officeId: r.officeId.trim(), name, mobile, designation: desig });
            } else if ((!existing.designation || existing.designation.length === 0) && desig.length > 0) {
              existing.designation = desig;
            }
            if (userMap.size >= 10) break;
          }
        }
      } catch { /* silent */ }

      // MealOrder থেকেও পদবী ফিলার
      try {
        const orderResult = await query(
          'SELECT DISTINCT officeId, designation FROM MealOrder WHERE designation IS NOT NULL AND designation != \'\''
        );
        for (const row of orderResult.rows) {
          const r = row as any;
          const oid = (r.officeId || '').trim().toLowerCase();
          const desig = (r.designation || '').trim();
          const existing = userMap.get(oid);
          if (existing && (!existing.designation || existing.designation.length === 0) && desig.length > 0) {
            existing.designation = desig;
          }
        }
      } catch { /* silent */ }

      return NextResponse.json({ success: true, users: [...userMap.values()] });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// =============================================
// POST HANDLER — নতুন অর্ডার সেভ
// =============================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, name, mobile, designation, orderDate, breakfast, lunch, morningSpecial, lunchSpecial } = body;

    if (!officeId || !orderDate) {
      return NextResponse.json({ success: false, error: 'অফিস আইডি ও তারিখ দরকার' }, { status: 400 });
    }

    // Always derive month/year from orderDate
    const { month, year } = getBdMonthYear(orderDate);

    // Check if existing order for this officeId + orderDate
    const existing = await query(
      'SELECT * FROM MealOrder WHERE officeId = ? AND orderDate = ?',
      [officeId, orderDate]
    );

    if (existing.rows.length > 0) {
      // ===== EXISTING ORDER — update MealOrder + linked MealEntry =====
      const prev = existing.rows[0] as any;
      const addB = Number(breakfast || 0);
      const addL = Number(lunch || 0);
      const addMS = Number(morningSpecial || 0);
      const addLS = Number(lunchSpecial || 0);

      const newBreakfast = Number(prev.breakfast || 0) + addB;
      const newLunch = Number(prev.lunch || 0) + addL;
      const newMS = Number(prev.morningSpecial || 0) + addMS;
      const newLS = Number(prev.lunchSpecial || 0) + addLS;

      const updateMonth = prev.month || month;
      const updateYear = prev.year || year;

      // Update MealOrder
      await query(
        `UPDATE MealOrder SET name = ?, mobile = ?, designation = ?, breakfast = ?, lunch = ?, morningSpecial = ?, lunchSpecial = ?, month = ?, year = ?
         WHERE officeId = ? AND orderDate = ?`,
        [name || prev.name, mobile || prev.mobile, designation || prev.designation, newBreakfast, newLunch, newMS, newLS, updateMonth, updateYear, officeId, orderDate]
      );

      // Find linked MealEntry by sourceOrderId
      const linkedEntry = await query(
        'SELECT * FROM MealEntry WHERE sourceOrderId = ?',
        [prev.id]
      );

      if (linkedEntry.rows.length > 0) {
        // MealEntry found — SET to TOTAL values (not incremental)
        const entry = linkedEntry.rows[0] as any;
        const entryMonth = entry.month || updateMonth;
        const entryYear = entry.year || String(updateYear);

        const existingTimePart = (entry.entryDate || '').substring(11);
        const correctedEntryDate = `${orderDate}${existingTimePart || 'T00:00:00.000'}`;

        const priceSetting = await db.priceSetting.findUnique({
          where: { month_year: { month: entryMonth, year: entryYear } }
        });
        const bp = priceSetting?.breakfastPrice || 0;
        const lp = priceSetting?.lunchPrice || 0;
        const msp = priceSetting?.morningSpecial || 0;
        const lsp = priceSetting?.lunchSpecial || 0;
        const newBill = newBreakfast * bp + newLunch * lp + newMS * msp + newLS * lsp;

        await query(
          `UPDATE MealEntry
           SET breakfastCount = ?, lunchCount = ?,
               morningSpecial = ?, lunchSpecial = ?,
               name = ?, mobile = ?, designation = ?,
               totalBill = ?, month = ?, year = ?, entryDate = ?
           WHERE id = ?`,
          [
            newBreakfast, newLunch, newMS, newLS,
            name || entry.name, mobile || entry.mobile, designation || entry.designation,
            newBill, entryMonth, entryYear, correctedEntryDate, entry.id
          ]
        );
      } else {
        // No linked MealEntry — create one with TOTAL values
        await createMealEntryForOrder(
          {
            officeId,
            name: name || prev.name,
            mobile: mobile || prev.mobile,
            designation: designation || prev.designation,
            breakfast: newBreakfast,
            lunch: newLunch,
            morningSpecial: newMS,
            lunchSpecial: newLS,
          },
          prev.id, updateMonth, updateYear, orderDate
        );
      }

      // Recalculate balances for this officeId (non-critical — don't fail the whole request)
      try { await recalculateBalancesForOffice(officeId); } catch { /* silent — order already saved */ }

      // Designation sync for existing orders
      const updateDesignation = designation || (prev as any).designation || '';
      if (updateDesignation.trim()) {
        try {
          await query(
            'UPDATE MealEntry SET designation = ? WHERE officeId = ? AND (designation IS NULL OR designation = "")',
            [updateDesignation, officeId]
          );
        } catch { /* silent */ }
      }

      return NextResponse.json({
        success: true,
        message: 'অর্ডার আপডেট হয়েছে',
        updated: true,
      });
    }

    // ===== NEW ORDER — create MealOrder + linked MealEntry =====
    const id = 'order_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    // UPSERT: race condition এ duplicate রো তৈরি হবে না
    await query(
      `INSERT INTO MealOrder (id, officeId, name, mobile, designation, orderDate, month, year, breakfast, lunch, morningSpecial, lunchSpecial)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(officeId, orderDate) DO UPDATE SET
         name = COALESCE(excluded.name, MealOrder.name),
         mobile = COALESCE(excluded.mobile, MealOrder.mobile),
         designation = COALESCE(excluded.designation, MealOrder.designation),
         breakfast = MealOrder.breakfast + excluded.breakfast,
         lunch = MealOrder.lunch + excluded.lunch,
         morningSpecial = MealOrder.morningSpecial + excluded.morningSpecial,
         lunchSpecial = MealOrder.lunchSpecial + excluded.lunchSpecial,
         month = COALESCE(excluded.month, MealOrder.month),
         year = COALESCE(excluded.year, MealOrder.year)`,
      [
        id, officeId, name || '', mobile || '', designation || '', orderDate,
        month, year,
        Number(breakfast || 0), Number(lunch || 0), Number(morningSpecial || 0), Number(lunchSpecial || 0)
      ]
    );

    // আসল MealOrder রো পান (UPSERT এ existing row এর ID প্রয়োজন)
    const actualOrder = await query(
      'SELECT * FROM MealOrder WHERE officeId = ? AND orderDate = ?',
      [officeId, orderDate]
    );
    const actualOrderId = actualOrder.rows.length > 0 ? (actualOrder.rows[0] as any).id : id;

    // Create linked MealEntry with ACTUAL MealOrder values (total, not incremental)
    // This ensures MealEntry matches MealOrder exactly
    const actual = actualOrder.rows[0] as any;
    await createMealEntryForOrder(
      {
        officeId,
        name: name || actual.name || '',
        mobile: mobile || actual.mobile || '',
        designation: designation || actual.designation || '',
        breakfast: Number(actual.breakfast || 0),
        lunch: Number(actual.lunch || 0),
        morningSpecial: Number(actual.morningSpecial || 0),
        lunchSpecial: Number(actual.lunchSpecial || 0),
      },
      actualOrderId, month, year, orderDate
    );

    // Recalculate balances for this officeId (non-critical — don't fail the whole request)
    try { await recalculateBalancesForOffice(officeId); } catch { /* silent — order already saved */ }

    // Designation sync: এই officeId এর সব MealEntry তে designation আপডেট করুন
    if (designation && designation.trim()) {
      try {
        await query(
          'UPDATE MealEntry SET designation = ? WHERE officeId = ? AND (designation IS NULL OR designation = "")',
          [designation, officeId]
        );
      } catch { /* silent */ }
    }

    return NextResponse.json({
      success: true,
      message: 'অর্ডার সেভ হয়েছে',
      created: true,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// =============================================
// PUT HANDLER — অর্ডার আপডেট (Admin edit)
// =============================================

export async function PUT(request: NextRequest) {
  try {
    // Admin auth check — PUT only for admin edits
    const token = request.headers.get('x-admin-token');
    const adminPwd = request.headers.get('x-admin-password') || '';
    let isAdminAuth = false;
    if (validateAdminSession(token)) {
      isAdminAuth = true;
    } else if (adminPwd) {
      try {
        const config = await db.systemSetting.findUnique({ where: { key: 'admin_password' } });
        const storedPwd = (config && config.value) || 'admin123';
        if (adminPwd === storedPwd) isAdminAuth = true;
      } catch { /* fallback */ }
    }
    if (!isAdminAuth) {
      return NextResponse.json({ success: false, error: 'অনুমতি নেই। আবার লগইন করুন।' }, { status: 401 });
    }

    const body = await request.json();
    const { officeId, orderDate, breakfast, lunch, morningSpecial, lunchSpecial } = body;

    if (!officeId || !orderDate) {
      return NextResponse.json({ success: false, error: 'অফিস আইডি ও তারিখ দরকার' }, { status: 400 });
    }

    // Find existing MealOrder
    const orderResult = await query(
      'SELECT * FROM MealOrder WHERE officeId = ? AND orderDate = ?',
      [officeId, orderDate]
    );

    if (orderResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'অর্ডার পাওয়া যায়নি' });
    }

    const prev = orderResult.rows[0] as any;

    // Calculate old vs new diff
    const oldB = Number(prev.breakfast) || 0;
    const oldL = Number(prev.lunch) || 0;
    const oldMS = Number(prev.morningSpecial) || 0;
    const oldLS = Number(prev.lunchSpecial) || 0;

    const newB = Number(breakfast) || 0;
    const newL = Number(lunch) || 0;
    const newMS = Number(morningSpecial) || 0;
    const newLS = Number(lunchSpecial) || 0;

    // Update MealOrder with new counts
    await query(
      `UPDATE MealOrder SET breakfast = ?, lunch = ?, morningSpecial = ?, lunchSpecial = ?
       WHERE officeId = ? AND orderDate = ?`,
      [newB, newL, newMS, newLS, officeId, orderDate]
    );

    // Find linked MealEntry by sourceOrderId
    const linkedEntry = await query(
      'SELECT * FROM MealEntry WHERE sourceOrderId = ?',
      [prev.id]
    );

    if (linkedEntry.rows.length > 0) {
      // Update MealEntry — SET to new MealOrder values directly (not diff-based to avoid drift)
      const entry = linkedEntry.rows[0] as any;

      // totalBill রিক্যালকুলেট করুন
      const { month: m, year: y } = getBdMonthYear(orderDate);
      const priceSetting = await db.priceSetting.findUnique({
        where: { month_year: { month: entry.month || m, year: entry.year || String(y) } }
      });
      const bp = priceSetting?.breakfastPrice || 0;
      const lp = priceSetting?.lunchPrice || 0;
      const ms = priceSetting?.morningSpecial || 0;
      const ls = priceSetting?.lunchSpecial || 0;
      const newBill = newB * bp + newL * lp + newMS * ms + newLS * ls;

      await query(
        `UPDATE MealEntry
         SET breakfastCount = ?, lunchCount = ?,
             morningSpecial = ?, lunchSpecial = ?,
             totalBill = ?
         WHERE id = ?`,
        [newB, newL, newMS, newLS, newBill, entry.id]
      );
    } else {
      // No linked MealEntry (sourceOrderId was cleared from old deadline expiry)
      // Find the unlinked MealEntry for this officeId+month+year with matching old counts
      const { month: m, year: y } = getBdMonthYear(orderDate);
      const fallbackEntry = await query(
        `SELECT * FROM MealEntry WHERE officeId = ? AND month = ? AND year = ?
         AND (sourceOrderId IS NULL OR sourceOrderId = '')
         AND breakfastCount = ? AND lunchCount = ? AND morningSpecial = ? AND lunchSpecial = ?
         AND deposit = 0 ORDER BY rowid DESC LIMIT 1`,
        [officeId, m, y, oldB, oldL, oldMS, oldLS]
      );
      if (fallbackEntry.rows.length > 0) {
        const entry = fallbackEntry.rows[0] as any;

        // totalBill রিক্যালকুলেট করুন
        const priceSetting = await db.priceSetting.findUnique({
          where: { month_year: { month: entry.month || m, year: entry.year || String(y) } }
        });
        const bp = priceSetting?.breakfastPrice || 0;
        const lp = priceSetting?.lunchPrice || 0;
        const ms = priceSetting?.morningSpecial || 0;
        const ls = priceSetting?.lunchSpecial || 0;
        const newBill = newB * bp + newL * lp + newMS * ms + newLS * ls;

        await query(
          `UPDATE MealEntry
           SET breakfastCount = ?, lunchCount = ?,
               morningSpecial = ?, lunchSpecial = ?,
               totalBill = ?
           WHERE id = ?`,
          [newB, newL, newMS, newLS, newBill, entry.id]
        );
        // Re-link the MealEntry to this MealOrder
        await query('UPDATE MealEntry SET sourceOrderId = ? WHERE id = ?', [prev.id, entry.id]);
      }
    }

    // Recalculate balances (non-critical)
    try { await recalculateBalancesForOffice(officeId); } catch { /* silent */ }

    return NextResponse.json({ success: true, message: 'অর্ডার আপডেট হয়েছে' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// =============================================
// DELETE HANDLER — অর্ডার ডিলিট
// =============================================

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId') || '';
    const orderDate = searchParams.get('orderDate') || '';
    // Admin check — header থেকে token নিন, query param থেকে নয়
    const isAdminHeader = request.headers.get('x-admin-token');
    const isAdminPwdHeader = request.headers.get('x-admin-password') || '';
    let isAdmin = false;
    if (isAdminHeader && validateAdminSession(isAdminHeader)) {
      isAdmin = true;
    } else if (isAdminPwdHeader) {
      try {
        const config = await db.systemSetting.findUnique({ where: { key: 'admin_password' } });
        const storedPwd = (config && config.value) || 'admin123';
        if (isAdminPwdHeader === storedPwd) isAdmin = true;
      } catch { /* fallback */ }
    }

    if (!officeId || !orderDate) {
      return NextResponse.json({ success: false, error: 'অফিস আইডি ও তারিখ দরকার' }, { status: 400 });
    }

    // Find MealOrder
    const orderResult = await query(
      'SELECT * FROM MealOrder WHERE officeId = ? AND orderDate = ?',
      [officeId, orderDate]
    );

    if (orderResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'অর্ডার পাওয়া যায়নি' });
    }

    const order = orderResult.rows[0] as any;
    const expired = isDeadlineExpired(orderDate);

    // Find linked MealEntry by sourceOrderId
    const linkedEntry = await query(
      'SELECT * FROM MealEntry WHERE sourceOrderId = ?',
      [order.id]
    );

    // ===== ADMIN DELETE: always full cancellation (MealEntry + MealOrder) =====
    if (isAdmin) {
      // Delete linked MealEntry
      if (linkedEntry.rows.length > 0) {
        await query('DELETE FROM MealEntry WHERE id = ?', [(linkedEntry.rows[0] as any).id]);
      }
      // Also handle case where sourceOrderId was cleared (old orders)
      if (linkedEntry.rows.length === 0) {
        const { month, year } = getBdMonthYear(orderDate);
        // Find the unlinked MealEntry for this officeId+month+year with matching counts
        const fallbackEntry = await query(
          `SELECT * FROM MealEntry WHERE officeId = ? AND month = ? AND year = ?
           AND (sourceOrderId IS NULL OR sourceOrderId = '')
           AND breakfastCount = ? AND lunchCount = ? AND morningSpecial = ? AND lunchSpecial = ?
           AND deposit = 0 ORDER BY rowid DESC LIMIT 1`,
          [officeId, month, year,
           Number(order.breakfast) || 0, Number(order.lunch) || 0,
           Number(order.morningSpecial) || 0, Number(order.lunchSpecial) || 0]
        );
        if (fallbackEntry.rows.length > 0) {
          await query('DELETE FROM MealEntry WHERE id = ?', [(fallbackEntry.rows[0] as any).id]);
        }
      }
      // Delete MealOrder
      await query('DELETE FROM MealOrder WHERE officeId = ? AND orderDate = ?', [officeId, orderDate]);
      try { await recalculateBalancesForOffice(officeId); } catch { /* silent */ }
      return NextResponse.json({ success: true, message: 'অর্ডার ডিলিট হয়েছে — টোটাল মিল এন্ট্রি থেকে বাদ হয়েছে' });
    }

    // ===== USER DELETE =====
    if (!expired) {
      // BEFORE DEADLINE: full cancellation
      if (linkedEntry.rows.length > 0) {
        await query('DELETE FROM MealEntry WHERE id = ?', [(linkedEntry.rows[0] as any).id]);
      }
      await query('DELETE FROM MealOrder WHERE officeId = ? AND orderDate = ?', [officeId, orderDate]);
      try { await recalculateBalancesForOffice(officeId); } catch { /* silent */ }
      return NextResponse.json({ success: true, message: 'অর্ডার ডিলিট হয়েছে' });
    } else {
      // AFTER DEADLINE: keep MealEntry, unlink sourceOrderId
      if (linkedEntry.rows.length > 0) {
        await query("UPDATE MealEntry SET sourceOrderId = '' WHERE id = ?", [(linkedEntry.rows[0] as any).id]);
      }
      await query('DELETE FROM MealOrder WHERE officeId = ? AND orderDate = ?', [officeId, orderDate]);
      try { await recalculateBalancesForOffice(officeId); } catch { /* silent */ }
      return NextResponse.json({ success: true, message: 'সময় শেষ — মিল টোটাল এন্ট্রিতে যোগ হয়েছে' });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
