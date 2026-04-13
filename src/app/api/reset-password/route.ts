import { NextRequest, NextResponse } from 'next/server';
import { db, query } from '@/lib/db';
import { sendOTPEmail } from '@/lib/email';
import { createAdminSession, validateAdminSession, rateLimit } from '@/middleware';

// ইন-মেমরি OTP স্টোরেজ (OTP ৫ মিনিটে এক্সপায়ার)
const otpStore = new Map<string, { code: string; expiresAt: number; email: string }>();

function generateOTP(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// পাসওয়ার্ড পড়ুন (SystemSetting টেবিল থেকে, ডিফল্ট admin123)
async function getStoredPassword(): Promise<string> {
  try {
    const config = await db.systemSetting.findUnique({ where: { key: 'admin_password' } });
    if (config && config.value) return String(config.value);
  } catch { /* টেবিল না থাকলে ডিফল্ট ব্যবহার */ }
  return 'admin123';
}

// GET — শুধুমাত্র তথ্য দেখাবে
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ success: true, message: 'Admin password reset API' });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// POST — OTP পাঠানো, OTP যাচাই, পাসওয়ার্ড পরিবর্তন, অ্যাডমিন পাসওয়ার্ড যাচাই
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, email, otp, newPassword, password } = body;

    // ===== ACTION: verify_password — অ্যাডমিন পাসওয়ার্ড সার্ভারে যাচাই =====
    if (action === 'verify_password') {
      // Rate limiting
      const { allowed } = rateLimit(request, 30, 60 * 1000);
      if (!allowed) {
        return NextResponse.json({ success: false, error: 'খুব বেশি চেষ্টা। কিছুক্ষণ পর আবার চেষ্টা করুন।' }, { status: 429 });
      }

      if (!password || !password.trim()) {
        return NextResponse.json({ success: false, error: 'পাসওয়ার্ড দিন' }, { status: 400 });
      }

      const storedPassword = await getStoredPassword();
      if (password.trim() !== storedPassword) {
        return NextResponse.json({ success: false, error: 'ভুল পাসওয়ার্ড!' }, { status: 401 });
      }

      // Admin session token তৈরি করুন
      const token = createAdminSession();
      return NextResponse.json({ success: true, token });
    }

    // ===== ACTION: validate_token — অ্যাডমিন টোকেন যাচাই =====
    if (action === 'validate_token') {
      const authHeader = request.headers.get('x-admin-token');
      const isValid = validateAdminSession(authHeader);
      return NextResponse.json({ success: true, valid: isValid });
    }

    // ===== ACTION: send_code — যেকোনো ইমেইলে OTP পাঠানো =====
    if (action === 'send_code') {
      // ইমেইল যাচাই — এখন যেকোনো ইমেইলে OTP পাঠানো যাবে (Brevo SMTP)
      if (!email || !email.trim()) {
        return NextResponse.json({ success: false, error: 'ইমেইল দিন' }, { status: 400 });
      }

      // বেসিক ইমেইল ফরম্যাট যাচাই
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return NextResponse.json({ success: false, error: 'সঠিক ইমেইল দিন' }, { status: 400 });
      }

      // Rate limiting for OTP
      const { allowed } = rateLimit(request, 10, 60 * 1000);
      if (!allowed) {
        return NextResponse.json({ success: false, error: 'খুব বেশি OTP রিকোয়েস্ট। কিছুক্ষণ পর আবার চেষ্টা করুন।' }, { status: 429 });
      }

      // পুরনো OTP পরিষ্কার
      const now = Date.now();
      for (const [key, val] of otpStore.entries()) {
        if (val.expiresAt < now) otpStore.delete(key);
      }

      // নতুন OTP তৈরি
      const code = generateOTP();
      const otpKey = email.trim().toLowerCase();
      otpStore.set(otpKey, { code, expiresAt: now + 5 * 60 * 1000, email: email.trim() });

      // ইমেইলে OTP পাঠান (Brevo SMTP)
      const emailResult = await sendOTPEmail(email.trim(), code);
      if (!emailResult.success) {
        console.error('[OTP] ইমেইল পাঠাতে ব্যর্থ:', emailResult.error);
        return NextResponse.json({
          success: false,
          error: emailResult.error || 'ইমেইল পাঠাতে সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।'
        }, { status: 500 });
      }

      // সফল — টেস্ট মোডে OTP সহ, নরমাল মোডে ছাড়া
      const response: any = {
        success: true,
        message: 'ভেরিফিকেশন কোড আপনার ইমেইলে পাঠানো হয়েছে',
        otpSent: true
      };
      if (emailResult.testOtp) {
        response.otp = code;
        response.testMode = true;
      }

      return NextResponse.json(response);
    }

    // ===== ACTION: verify_and_reset — OTP যাচাই ও পাসওয়ার্ড রিসেট =====
    if (action === 'verify_and_reset') {
      if (!email || !email.trim()) {
        return NextResponse.json({ success: false, error: 'ইমেইল দিন' }, { status: 400 });
      }
      if (!otp || !newPassword) {
        return NextResponse.json({ success: false, error: 'কোড ও নতুন পাসওয়ার্ড দিন' }, { status: 400 });
      }
      if (newPassword.length < 4) {
        return NextResponse.json({ success: false, error: 'পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে' }, { status: 400 });
      }

      const otpKey = email.trim().toLowerCase();
      const stored = otpStore.get(otpKey);

      if (!stored) {
        return NextResponse.json({ success: false, error: 'কোডের মেয়াদ উত্তীর্ণ হয়েছে। আবার কোড পাঠান' }, { status: 400 });
      }
      if (stored.expiresAt < Date.now()) {
        otpStore.delete(otpKey);
        return NextResponse.json({ success: false, error: 'কোডের মেয়াদ উত্তীর্ণ হয়েছে। আবার কোড পাঠান' }, { status: 400 });
      }
      if (stored.code !== otp) {
        return NextResponse.json({ success: false, error: 'ভুল কোড!' }, { status: 400 });
      }

      // পাসওয়ার্ড আপডেট করুন (SystemSetting টেবিলে)
      try {
        try {
          await query('CREATE TABLE IF NOT EXISTS SystemSetting (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
        } catch { /* টেবিল ইতিমধ্যে আছে */ }

        await db.systemSetting.upsert({
          where: { key: 'admin_password' },
          update: { value: newPassword },
          create: { key: 'admin_password', value: newPassword }
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Password update error:', msg);
        return NextResponse.json({ success: false, error: 'পাসওয়ার্ড সেভ করা যায়নি: ' + msg }, { status: 500 });
      }

      // OTP মুছুন
      otpStore.delete(otpKey);

      return NextResponse.json({ success: true, message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে' });
    }

    return NextResponse.json({ success: false, error: 'অবৈধ অ্যাকশন' }, { status: 400 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
