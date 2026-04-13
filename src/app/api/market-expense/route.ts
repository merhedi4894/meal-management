import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { randomUUID } from 'crypto';

// ===== টেবিল তৈরি (idempotent) =====
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS MarketExpense (
      id TEXT PRIMARY KEY,
      expenseDate TEXT NOT NULL,
      description TEXT DEFAULT '',
      totalCost INTEGER DEFAULT 0,
      month TEXT DEFAULT '',
      year TEXT DEFAULT '',
      createdAt TEXT DEFAULT (datetime('now', '+6 hours')),
      updatedAt TEXT DEFAULT (datetime('now', '+6 hours'))
    )
  `);
}

// ===== GET — মাস ভিত্তিক খরচ লিস্ট =====
export async function GET(req: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (action === 'list') {
      const month = searchParams.get('month') || '';
      const year = searchParams.get('year') || '';
      if (!month || !year) {
        return NextResponse.json({ success: false, error: 'মাস ও বছর দিন' });
      }
      const result = await query(
        `SELECT * FROM MarketExpense WHERE month = ? AND year = ? ORDER BY expenseDate DESC`,
        [month, year]
      );
      const rows = (result as any).rows || [];
      const totalResult = await query(
        `SELECT COALESCE(SUM(totalCost), 0) as totalCost FROM MarketExpense WHERE month = ? AND year = ?`,
        [month, year]
      );
      const totalRow = ((totalResult as any).rows || [{}]);
      return NextResponse.json({
        success: true,
        expenses: rows,
        totalCost: totalRow[0]?.totalCost || 0,
        month,
        year,
      });
    }

    return NextResponse.json({ success: false, error: 'অজানা action' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'সার্ভার ত্রুটি' });
  }
}

// ===== POST — নতুন খরচ =====
export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { expenseDate, description, totalCost } = body;

    if (!expenseDate) {
      return NextResponse.json({ success: false, error: 'তারিখ দিন' });
    }
    const cost = parseInt(totalCost) || 0;

    // month/year compute from expenseDate
    const dateObj = new Date(expenseDate + 'T00:00:00+06:00');
    const monthNames = [
      'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
      'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
    ];
    const month = monthNames[dateObj.getMonth()] || '';
    const year = String(dateObj.getFullYear());

    const id = randomUUID();
    await query(
      `INSERT INTO MarketExpense (id, expenseDate, description, totalCost, month, year) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, expenseDate, description || '', cost, month, year]
    );

    return NextResponse.json({
      success: true,
      message: 'বাজার খরচ সেভ হয়েছে',
      expense: { id, expenseDate, description: description || '', totalCost: cost, month, year },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'সার্ভার ত্রুটি' });
  }
}

// ===== PUT — খরচ আপডেট =====
export async function PUT(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { id, expenseDate, description, totalCost } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'id দিন' });
    }

    // Build dynamic UPDATE
    const sets: string[] = ["updatedAt = datetime('now', '+6 hours')"];
    const params: any[] = [];

    if (expenseDate !== undefined) {
      sets.push('expenseDate = ?');
      params.push(expenseDate);
      // Recompute month/year
      const dateObj = new Date(expenseDate + 'T00:00:00+06:00');
      const monthNames = [
        'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
        'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
      ];
      sets.push('month = ?');
      params.push(monthNames[dateObj.getMonth()] || '');
      sets.push('year = ?');
      params.push(String(dateObj.getFullYear()));
    }
    if (description !== undefined) {
      sets.push('description = ?');
      params.push(description);
    }
    if (totalCost !== undefined) {
      sets.push('totalCost = ?');
      params.push(parseInt(totalCost) || 0);
    }

    params.push(id);
    await query(
      `UPDATE MarketExpense SET ${sets.join(', ')} WHERE id = ?`,
      params
    );

    return NextResponse.json({ success: true, message: 'বাজার খরচ আপডেট হয়েছে' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'সার্ভার ত্রুটি' });
  }
}

// ===== DELETE — খরচ ডিলিট =====
export async function DELETE(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'id দিন' });
    }

    await query(`DELETE FROM MarketExpense WHERE id = ?`, [id]);
    return NextResponse.json({ success: true, message: 'বাজার খরচ ডিলিট হয়েছে' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'সার্ভার ত্রুটি' });
  }
}
