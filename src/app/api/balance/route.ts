import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// entryDate পার্স করার হেল্পার
function parseEntryDate(date: Date | string): number {
  if (typeof date === 'number') return date;
  if (!date) return 0;
  const s = String(date).trim();
  if (/^\d{4}-\d{2}-\d{2}\d{2}:\d{2}/.test(s)) {
    const fixed = s.replace(/^(\d{4}-\d{2}-\d{2})(\d)/, '$1T$2');
    return new Date(fixed.includes('Z') || fixed.includes('+') ? fixed : fixed + '+06:00').getTime();
  }
  if (s.includes('Z') || s.includes('+') || s.includes('-06:00') || s.includes('-05:00')) return new Date(s).getTime();
  return new Date(s + '+06:00').getTime();
}

// বাংলা মাসের নাম
const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

// GET: সব কর্মীর অন-দ্য-ফ্লাই ব্যালেন্স (MealEntry থেকে only)
export async function GET() {
  try {
    // ১. সব MealEntry আনুন
    const allEntries = await db.mealEntry.findMany({
      orderBy: { entryDate: 'asc' }
    });

    // ২. সব PriceSetting আনুন
    const allPriceSettings = await db.priceSetting.findMany();
    const priceMap = new Map<string, { breakfastPrice: number; lunchPrice: number; morningSpecial: number; lunchSpecial: number }>();
    for (const s of allPriceSettings) {
      priceMap.set(`${s.month}|${s.year}`, {
        breakfastPrice: s.breakfastPrice, lunchPrice: s.lunchPrice,
        morningSpecial: s.morningSpecial, lunchSpecial: s.lunchSpecial,
      });
    }

    // ৩. প্রতিটি officeId এর জন্য রানিং ব্যালেন্স ক্যালকুলেট
    // ===== SAME-DAY DEDUP: একই officeId + একই দিনের multiple entry → merge করুন =====
    const entryMap = new Map<string, Array<{
      officeId: string; name: string; mobile: string; designation: string;
      month: string; year: string; entryDate: Date | string;
      breakfastCount: number; lunchCount: number; morningSpecial: number; lunchSpecial: number;
      totalBill: number; deposit: number;
    }>>();

    for (const e of allEntries) {
      const oid = e.officeId;
      if (!oid) continue;

      // ===== month/year অটো-ফিক্স: entryDate থেকে ডেরিভ (homepage এর মতো) =====
      let entryMonth = e.month || '';
      let entryYear = e.year || '';
      if ((!entryMonth || entryMonth === '' || !entryYear || entryYear === '') && e.entryDate) {
        const dateStr = String(e.entryDate || '').substring(0, 10);
        const dp = dateStr.split('-');
        if (dp.length === 3) {
          const dateObj = new Date(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]));
          if (!entryMonth || entryMonth === '') entryMonth = MONTHS_BN[dateObj.getMonth()];
          if (!entryYear || entryYear === '') entryYear = dp[0];
        }
      }

      // ===== DEDUP: same officeId + same date → merge into one entry =====
      const dateStr = String(e.entryDate || '').substring(0, 10); // "YYYY-MM-DD"

      if (!entryMap.has(oid)) entryMap.set(oid, []);

      const existingArr = entryMap.get(oid)!;
      const existingIdx = existingArr.findIndex(ex => {
        const exDateStr = String(ex.entryDate || '').substring(0, 10);
        return exDateStr === dateStr;
      });

      if (existingIdx >= 0) {
        // Same-day entry exists → merge counts + deposit
        const existing = existingArr[existingIdx];
        existing.breakfastCount += Number(e.breakfastCount || 0);
        existing.lunchCount += Number(e.lunchCount || 0);
        existing.morningSpecial += Number(e.morningSpecial || 0);
        existing.lunchSpecial += Number(e.lunchSpecial || 0);
        existing.deposit += Number(e.deposit || 0);
        // Keep better name/mobile/designation
        if (!existing.name && e.name) existing.name = e.name || '';
        if (!existing.mobile || (e.mobile && e.mobile.length > existing.mobile.length)) existing.mobile = e.mobile || '';
        if (!existing.designation || (e.designation && e.designation.length > existing.designation.length)) existing.designation = e.designation || '';
        // Keep better month/year
        if (!existing.month && entryMonth) existing.month = entryMonth;
        if (!existing.year && entryYear) existing.year = entryYear;
      } else {
        entryMap.get(oid)!.push({
          officeId: oid,
          name: e.name || '',
          mobile: e.mobile || '',
          designation: (e as any).designation || '',
          month: entryMonth,
          year: entryYear,
          entryDate: e.entryDate,
          breakfastCount: Number(e.breakfastCount || 0),
          lunchCount: Number(e.lunchCount || 0),
          morningSpecial: Number(e.morningSpecial || 0),
          lunchSpecial: Number(e.lunchSpecial || 0),
          totalBill: Number(e.totalBill || 0),
          deposit: Number(e.deposit || 0),
        });
      }
    }

    // ৪. প্রতিটি officeId এর জন্য মোট ব্যালেন্স ক্যালকুলেট
    const balanceMap = new Map<string, {
      officeId: string; name: string; mobile: string; designation: string;
      curBalance: number;
    }>();

    for (const [oid, entries] of entryMap) {
      const sorted = [...entries].sort((a, b) => parseEntryDate(a.entryDate) - parseEntryDate(b.entryDate));
      const first = sorted[0];
      let runningBalance = 0;

      for (const entry of sorted) {
        const price = priceMap.get(`${entry.month}|${entry.year}`);
        const bill = entry.breakfastCount * (price?.breakfastPrice || 0)
          + entry.lunchCount * (price?.lunchPrice || 0)
          + entry.morningSpecial * (price?.morningSpecial || 0)
          + entry.lunchSpecial * (price?.lunchSpecial || 0);
        runningBalance = runningBalance + entry.deposit - bill;
      }

      balanceMap.set(oid, {
        officeId: oid,
        name: first.name,
        mobile: first.mobile,
        designation: first.designation,
        curBalance: runningBalance,
      });
    }

    // ৫. রেজাল্ট তৈরি
    const result = [...balanceMap.values()].sort((a, b) => {
      return (a.name || '').localeCompare(b.name || '', 'bn');
    });

    return NextResponse.json({ success: true, employees: result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
