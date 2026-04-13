import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// entryDate পার্স করার হেল্পার
function parseEntryDate(date: Date | string): number {
  if (typeof date === 'number') return date;
  if (!date) return 0;
  const s = String(date).trim();
  if (s.includes('Z') || s.includes('+') || s.includes('-06:00') || s.includes('-05:00')) return new Date(s).getTime();
  return new Date(s + '+06:00').getTime();
}

// GET: সব কর্মীর অন-দ্য-ফ্লাই ব্যালেন্স (MealEntry থেকে only)
// MealOrder-এর জন্য MealEntry-তে sourceOrderId দিয়ে linked entry তৈরি হয়
// তাই MealEntry থেকেই সঠিক ব্যালেন্স পাওয়া যায় — MealOrder আলাদা করে যোগ করলে double-counting হয়
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
      priceMap.set(`${s.month}|${String(s.year)}`, {
        breakfastPrice: s.breakfastPrice, lunchPrice: s.lunchPrice,
        morningSpecial: s.morningSpecial, lunchSpecial: s.lunchSpecial,
      });
    }

    // ৩. প্রতিটি officeId এর জন্য রানিং ব্যালেন্স ক্যালকুলেট
    const entryMap = new Map<string, Array<{
      officeId: string; name: string; mobile: string; designation: string;
      month: string; year: string; entryDate: Date | string;
      breakfastCount: number; lunchCount: number; morningSpecial: number; lunchSpecial: number;
      totalBill: number; deposit: number;
    }>>();

    for (const e of allEntries) {
      const oid = e.officeId;
      if (!oid) continue;
      if (!entryMap.has(oid)) entryMap.set(oid, []);
      entryMap.get(oid)!.push({
        officeId: oid,
        name: e.name || '',
        mobile: e.mobile || '',
        designation: (e as any).designation || '',
        month: e.month,
        year: String(e.year),
        entryDate: e.entryDate,
        breakfastCount: Number(e.breakfastCount || 0),
        lunchCount: Number(e.lunchCount || 0),
        morningSpecial: Number(e.morningSpecial || 0),
        lunchSpecial: Number(e.lunchSpecial || 0),
        totalBill: Number(e.totalBill || 0),
        deposit: Number(e.deposit || 0),
      });
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
