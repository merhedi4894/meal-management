import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Bangladesh timezone helper
function getBdToday(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const bdMs = utcMs + 6 * 60 * 60000;
  const bd = new Date(bdMs);
  const dd = String(bd.getDate()).padStart(2, '0');
  const mm = String(bd.getMonth() + 1).padStart(2, '0');
  const yyyy = bd.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

function getBdNow(): { date: string; hour: number; minute: number } {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const bdMs = utcMs + 6 * 60 * 60000;
  const bd = new Date(bdMs);
  return {
    date: `${bd.getFullYear()}-${String(bd.getMonth() + 1).padStart(2, '0')}-${String(bd.getDate()).padStart(2, '0')}`,
    hour: bd.getHours(),
    minute: bd.getMinutes(),
  };
}

// Ensure table exists
let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS SpecialMealSetting (
      id TEXT PRIMARY KEY,
      orderDate TEXT NOT NULL UNIQUE,
      morningSpecial INTEGER DEFAULT 0,
      lunchSpecial INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    tableEnsured = true;
  } catch (err) {
    console.error('Failed to create SpecialMealSetting table:', err);
  }
}

// GET
export async function GET(request: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';
    const orderDate = searchParams.get('orderDate') || '';

    if (action === 'status') {
      if (!orderDate) return NextResponse.json({ success: false, error: 'তারিখ দিন' });
      const result = await query('SELECT * FROM SpecialMealSetting WHERE orderDate = ?', [orderDate]);
      if (result.rows.length === 0) {
        return NextResponse.json({ success: true, morningSpecial: false, lunchSpecial: false, isActive: false, exists: false });
      }
      const row = result.rows[0] as any;
      const bdToday = getBdToday();
      const isActive = orderDate >= bdToday;
      return NextResponse.json({
        success: true,
        exists: true,
        morningSpecial: isActive ? (Number(row.morningSpecial) === 1) : false,
        lunchSpecial: isActive ? (Number(row.lunchSpecial) === 1) : false,
        isActive,
      });
    }

    // সময় উইন্ডো চেক — মিল অর্ডার পেজ থেকে কল হবে
    if (action === 'time_window') {
      if (!orderDate) return NextResponse.json({ success: false, error: 'তারিখ দিন' });
      const bdNow = getBdNow();

      // সকাল নাস্তা: পূর্বের দিন রাত ১২টা পর্যন্ত (অর্ডার তারিখের আগের দিনের শেষ)
      const prevDay = (() => {
        const d = new Date(orderDate + 'T00:00:00+06:00');
        d.setDate(d.getDate() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })();
      const breakfastOpen = bdNow.date <= prevDay || (bdNow.date === prevDay); // bdNow.date < orderDate
      const breakfastWindowOpen = bdNow.date < orderDate;

      // দুপুর মিল: ওই দিন সকাল ১১টা পর্যন্ত
      let lunchWindowOpen = false;
      if (bdNow.date < orderDate) {
        lunchWindowOpen = true;
      } else if (bdNow.date === orderDate && bdNow.hour < 11) {
        lunchWindowOpen = true;
      }

      return NextResponse.json({
        success: true,
        breakfastWindowOpen,
        lunchWindowOpen,
        bdNow,
      });
    }

    if (action === 'list') {
      const result = await query('SELECT * FROM SpecialMealSetting ORDER BY orderDate DESC');
      const bdToday = getBdToday();
      const settings = result.rows.map((row: any) => ({
        ...row,
        morningSpecial: Number(row.morningSpecial) === 1,
        lunchSpecial: Number(row.lunchSpecial) === 1,
        isActive: (row.orderDate as string) >= bdToday,
      }));
      return NextResponse.json({ success: true, settings });
    }

    if (action === 'cooking_view') {
      if (!orderDate) return NextResponse.json({ success: false, error: 'তারিখ দিন' });

      // সার্চ ফিল্টার (অফিস আইডি/নাম/মোবাইল)
      const search = (searchParams.get('search') || '').trim().toLowerCase();

      // Get special meal status for this date
      const specialResult = await query('SELECT * FROM SpecialMealSetting WHERE orderDate = ?', [orderDate]);
      const specialRow = specialResult.rows.length > 0 ? specialResult.rows[0] as any : null;
      const bdToday = getBdToday();
      const isActive = orderDate >= bdToday;
      const morningSpecialActive = isActive && specialRow && Number(specialRow.morningSpecial) === 1;
      const lunchSpecialActive = isActive && specialRow && Number(specialRow.lunchSpecial) === 1;

      // Get orders for this date — search থাকলে ফিল্টার করুন
      let ordersResult;
      if (search && search.length >= 2) {
        ordersResult = await query(
          'SELECT * FROM MealOrder WHERE orderDate = ? AND (officeId LIKE ? OR LOWER(name) LIKE ? OR mobile LIKE ?) ORDER BY name ASC',
          [orderDate, `%${search}%`, `%${search}%`, `%${search}%`]
        );
      } else {
        ordersResult = await query('SELECT * FROM MealOrder WHERE orderDate = ? ORDER BY name ASC', [orderDate]);
      }
      const orders = ordersResult.rows as any[];

      let breakfastCount = 0;
      let lunchCount = 0;
      let morningSpecialCount = 0;
      let lunchSpecialCount = 0;

      for (const o of orders) {
        breakfastCount += Number(o.breakfast) || 0;
        lunchCount += Number(o.lunch) || 0;
        morningSpecialCount += Number(o.morningSpecial) || 0;
        lunchSpecialCount += Number(o.lunchSpecial) || 0;
      }

      return NextResponse.json({
        success: true,
        morningSpecialActive,
        lunchSpecialActive,
        counts: { breakfastCount, lunchCount, morningSpecialCount, lunchSpecialCount, totalOrders: orders.length },
        orders: orders.map((o: any) => ({
          id: o.id || '',
          name: o.name || '',
          officeId: o.officeId || '',
          mobile: o.mobile || '',
          designation: o.designation || '',
          breakfast: Number(o.breakfast) || 0,
          lunch: Number(o.lunch) || 0,
          morningSpecial: Number(o.morningSpecial) || 0,
          lunchSpecial: Number(o.lunchSpecial) || 0,
        })),
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST - Upsert special meal setting + auto-convert existing orders
export async function POST(request: NextRequest) {
  try {
    await ensureTable();
    const body = await request.json();
    const { orderDate, morningSpecial, lunchSpecial } = body;

    if (!orderDate) {
      return NextResponse.json({ success: false, error: 'তারিখ দিন' }, { status: 400 });
    }

    // Only allow today or future dates
    const bdToday = getBdToday();
    if (orderDate < bdToday) {
      return NextResponse.json({ success: false, error: 'অতীত তারিখে স্পেশাল মিল এক্টিভ করা যায় না' }, { status: 400 });
    }

    // Check if already exists
    const existing = await query('SELECT * FROM SpecialMealSetting WHERE orderDate = ?', [orderDate]);

    if (existing.rows.length > 0) {
      // Update
      await query(
        'UPDATE SpecialMealSetting SET morningSpecial = ?, lunchSpecial = ? WHERE orderDate = ?',
        [morningSpecial ? 1 : 0, lunchSpecial ? 1 : 0, orderDate]
      );
    } else {
      // Insert
      const id = 'sm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      await query(
        'INSERT INTO SpecialMealSetting (id, orderDate, morningSpecial, lunchSpecial) VALUES (?, ?, ?, ?)',
        [id, orderDate, morningSpecial ? 1 : 0, lunchSpecial ? 1 : 0]
      );
    }

    // === অটো কনভার্ট: স্পেশাল এক্টিভ করলে আগের রেগুলার অর্ডার স্পেশালে রূপান্তর ===
    let convertedBreakfast = 0;
    let convertedLunch = 0;

    if (morningSpecial) {
      // যারা সকাল নাস্তা অর্ডার করেছে → সকাল স্পেশালে রূপান্তর
      const convertResult = await query(
        'UPDATE MealOrder SET morningSpecial = morningSpecial + breakfast, breakfast = 0 WHERE orderDate = ? AND breakfast > 0',
        [orderDate]
      );
      convertedBreakfast = convertResult.rowsAffected || 0;
    }

    if (lunchSpecial) {
      // যারা দুপুর মিল অর্ডার করেছে → দুপুর স্পেশালে রূপান্তর
      const convertResult = await query(
        'UPDATE MealOrder SET lunchSpecial = lunchSpecial + lunch, lunch = 0 WHERE orderDate = ? AND lunch > 0',
        [orderDate]
      );
      convertedLunch = convertResult.rowsAffected || 0;
    }

    const msg = existing.rows.length > 0 ? 'আপডেট হয়েছে' : 'সেভ হয়েছে';
    const convertedMsg = (convertedBreakfast > 0 || convertedLunch > 0)
      ? ` (${convertedBreakfast}টি সকাল নাস্তা → সকাল স্পেশাল, ${convertedLunch}টি দুপুর মিল → দুপুর স্পেশাল)`
      : '';

    return NextResponse.json({
      success: true,
      message: msg + convertedMsg,
      converted: { breakfast: convertedBreakfast, lunch: convertedLunch },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// PUT - এডমিন দ্বারা ইন্ডিভিজুয়াল অর্ডার এডিট
export async function PUT(request: NextRequest) {
  try {
    await ensureTable();
    const body = await request.json();
    const { officeId, orderDate, breakfast, lunch, morningSpecial, lunchSpecial } = body;

    if (!officeId || !orderDate) {
      return NextResponse.json({ success: false, error: 'অফিস আইডি ও তারিখ দরকার' }, { status: 400 });
    }

    // সব ফিল্ড এক্স্যাক্ট ভ্যালু সেট করুন (নতুন করে সেট)
    await query(
      'UPDATE MealOrder SET breakfast = ?, lunch = ?, morningSpecial = ?, lunchSpecial = ? WHERE officeId = ? AND orderDate = ?',
      [Number(breakfast || 0), Number(lunch || 0), Number(morningSpecial || 0), Number(lunchSpecial || 0), officeId, orderDate]
    );

    return NextResponse.json({ success: true, message: 'অর্ডার আপডেট হয়েছে' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE
export async function DELETE(request: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(request.url);
    const orderDate = searchParams.get('orderDate') || '';

    // admin_delete: এডমিন ইন্ডিভিজুয়াল অর্ডার ডিলিট
    const action = searchParams.get('action') || '';
    if (action === 'admin_delete') {
      const officeId = searchParams.get('officeId') || '';
      if (!officeId || !orderDate) {
        return NextResponse.json({ success: false, error: 'অফিস আইডি ও তারিখ দরকার' }, { status: 400 });
      }
      await query('DELETE FROM MealOrder WHERE officeId = ? AND orderDate = ?', [officeId, orderDate]);
      return NextResponse.json({ success: true, message: 'অর্ডার ডিলিট হয়েছে' });
    }

    // স্পেশাল মিল সেটিং ডিলিট
    if (!orderDate) return NextResponse.json({ success: false, error: 'তারিখ দিন' }, { status: 400 });
    await query('DELETE FROM SpecialMealSetting WHERE orderDate = ?', [orderDate]);
    return NextResponse.json({ success: true, message: 'ডিলিট হয়েছে' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
