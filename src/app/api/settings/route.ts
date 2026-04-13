import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET all settings
export async function GET() {
  try {
    const settings = await db.priceSetting.findMany({
      orderBy: [{ year: 'desc' }, { month: 'asc' }]
    });
    return NextResponse.json({ success: true, settings });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST create new price setting
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { month, year, breakfastPrice, lunchPrice, morningSpecial, lunchSpecial } = body;
    if (!month || !year) {
      return NextResponse.json({ success: false, error: 'মাস ও বছর দিন' }, { status: 400 });
    }

    const setting = await db.priceSetting.upsert({
      where: { month_year: { month, year } },
      update: { breakfastPrice, lunchPrice, morningSpecial, lunchSpecial },
      create: { month, year, breakfastPrice, lunchPrice, morningSpecial, lunchSpecial },
    });
    return NextResponse.json({ success: true, setting });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// PUT update price setting
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, breakfastPrice, lunchPrice, morningSpecial, lunchSpecial } = body;
    const setting = await db.priceSetting.update({
      where: { id },
      data: { breakfastPrice, lunchPrice, morningSpecial, lunchSpecial }
    });
    return NextResponse.json({ success: true, setting });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// DELETE price setting
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'ID দরকার' }, { status: 400 });
    await db.priceSetting.delete({ where: { id } });
    return NextResponse.json({ success: true, message: 'সেটিং ডিলিট হয়েছে' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
