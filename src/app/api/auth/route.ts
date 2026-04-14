import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendOTPEmail } from '@/lib/email';
import bcrypt from 'bcryptjs';

// ===== Helpers =====

function bnToEn(str: string): string {
  const bnDigits = '০১২৩৪৫৬৭৮৯';
  const enDigits = '0123456789';
  let result = '';
  for (const ch of str) {
    const idx = bnDigits.indexOf(ch);
    result += idx >= 0 ? enDigits[idx] : ch;
  }
  return result;
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

// Email sending uses the shared @/lib/email utility (sendOTPEmail)
// Which reads EMAIL_USER and EMAIL_APP_PASSWORD from environment variables

// ===== Ensure MealUser table =====

let tableEnsured = false;
async function ensureTable() {
  if (tableEnsured) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS MealUser (
        id TEXT PRIMARY KEY,
        officeEmail TEXT DEFAULT '',
        officeId TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        designation TEXT DEFAULT '',
        mobile TEXT NOT NULL,
        password TEXT NOT NULL,
        otp TEXT DEFAULT '',
        otpExpiry TEXT DEFAULT '',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Create index for faster lookups
    await query('CREATE INDEX IF NOT EXISTS idx_mealuser_officeId ON MealUser(officeId)');
    await query('CREATE INDEX IF NOT EXISTS idx_mealuser_mobile ON MealUser(mobile)');
    await query('CREATE INDEX IF NOT EXISTS idx_mealuser_officeEmail ON MealUser(officeEmail)');
    // Add otp columns if they don't exist (for existing tables)
    try { await query('ALTER TABLE MealUser ADD COLUMN otp TEXT DEFAULT \'\'') } catch { /* column already exists */ }
    try { await query('ALTER TABLE MealUser ADD COLUMN otpExpiry TEXT DEFAULT \'\'') } catch { /* column already exists */ }
    tableEnsured = true;
  } catch (err) {
    console.error('Failed to create MealUser table:', err);
  }
}

// ===== GET =====

export async function GET(request: NextRequest) {
  try {
    await ensureTable();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || '';

    // ACTION: suggest — search MealUser AND MealEntry by name, officeId, mobile, designation
    if (action === 'suggest') {
      const q = (searchParams.get('query') || '').trim();
      if (q.length < 2) {
        return NextResponse.json({ success: true, users: [] });
      }

      const qLower = q.toLowerCase();
      const userMap = new Map<string, { officeId: string; name: string; mobile: string; designation: string }>();

      // Search MealUser
      const userResult = await query(
        'SELECT officeId, name, mobile, designation FROM MealUser WHERE LOWER(officeId) LIKE ? OR LOWER(name) LIKE ? OR mobile LIKE ? OR LOWER(designation) LIKE ?',
        [`%${qLower}%`, `%${qLower}%`, `%${q}%`, `%${qLower}%`]
      );
      for (const row of userResult.rows) {
        const r = row as any;
        const oid = (r.officeId || '').trim();
        if (!oid) continue;
        const key = oid.toLowerCase();
        if (!userMap.has(key)) {
          userMap.set(key, {
            officeId: oid,
            name: (r.name || '').trim(),
            mobile: (r.mobile || '').trim(),
            designation: (r.designation || '').trim(),
          });
        }
      }

      // Search MealEntry (for existing users who aren't in MealUser)
      {
        const entryResult = await query(
          "SELECT DISTINCT officeId, name, mobile, designation FROM MealEntry WHERE officeId != '' AND (LOWER(officeId) LIKE ? OR LOWER(name) LIKE ? OR mobile LIKE ? OR LOWER(designation) LIKE ?)",
          [`%${qLower}%`, `%${qLower}%`, `%${q}%`, `%${qLower}%`]
        );
        for (const row of entryResult.rows) {
          const r = row as any;
          const oid = (r.officeId || '').trim();
          if (!oid) continue;
          const key = oid.toLowerCase();
          if (!userMap.has(key)) {
            userMap.set(key, {
              officeId: oid,
              name: (r.name || '').trim(),
              mobile: (r.mobile || '').trim(),
              designation: (r.designation || '').trim(),
            });
          }
        }
      }

      return NextResponse.json({ success: true, users: [...userMap.values()] });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ===== POST =====

export async function POST(request: NextRequest) {
  try {
    await ensureTable();
    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || body.action || '';

    // ===== ACTION: signup =====
    if (action === 'signup') {
      const { officeEmail, officeId, name, designation, mobile, password } = body;

      // Validate required fields — email is now mandatory
      if (!officeEmail || !officeEmail.trim()) {
        return NextResponse.json({ success: false, error: 'অফিস ইমেইল আবশ্যক' }, { status: 400 });
      }
      // Basic email format validation
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(officeEmail.trim())) {
        return NextResponse.json({ success: false, error: 'সঠিক ইমেইল দিন' }, { status: 400 });
      }
      if (!name || !name.trim()) {
        return NextResponse.json({ success: false, error: 'নাম আবশ্যক' }, { status: 400 });
      }
      if (!designation || !designation.trim()) {
        return NextResponse.json({ success: false, error: 'পদবী আবশ্যক' }, { status: 400 });
      }
      if (!mobile || !mobile.trim()) {
        return NextResponse.json({ success: false, error: 'মোবাইল নম্বর আবশ্যক' }, { status: 400 });
      }
      if (!password || password.length < 4) {
        return NextResponse.json({ success: false, error: 'পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে' }, { status: 400 });
      }
      if (!officeId || !officeId.trim()) {
        return NextResponse.json({ success: false, error: 'অফিস আইডি আবশ্যক' }, { status: 400 });
      }

      // Convert Bangla digits to English
      const officeIdEn = bnToEn(officeId.trim());
      const mobileEn = bnToEn(mobile.trim());

      // Validate officeId: max 6 digits
      if (officeIdEn.length > 6 || !/^\d+$/.test(officeIdEn)) {
        return NextResponse.json({ success: false, error: 'অফিস আইডি সর্বোচ্চ ৬ সংখ্যার হতে হবে' }, { status: 400 });
      }

      // Check if officeId already exists in MealUser
      const existingUser = await query('SELECT id FROM MealUser WHERE officeId = ?', [officeIdEn]);
      if (existingUser.rows.length > 0) {
        return NextResponse.json({ success: false, error: 'এই অফিস আইডি আগে থেকে আছে' }, { status: 400 });
      }

      // Check if email already exists
      const existingEmail = await query('SELECT id FROM MealUser WHERE LOWER(officeEmail) = ?', [officeEmail.trim().toLowerCase()]);
      if (existingEmail.rows.length > 0) {
        return NextResponse.json({ success: false, error: 'এই ইমেইল আগে থেকে ব্যবহৃত হচ্ছে' }, { status: 400 });
      }

      // Insert into MealUser (password hashed)
      const id = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const hashedPassword = await bcrypt.hash(password, 12);
      await query(
        'INSERT INTO MealUser (id, officeEmail, officeId, name, designation, mobile, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, officeEmail.trim().toLowerCase(), officeIdEn, name.trim(), designation.trim(), mobileEn, hashedPassword]
      );

      // Also insert into MealEntry so user appears in existing dropdowns
      const bdNow = getBdNow();
      const bdDate = bdNow.date;
      const month = String(bdDate.split('-')[1]).padStart(2, '0');
      const year = bdDate.split('-')[0];

      const entryId = 'e_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      await query(
        `INSERT INTO MealEntry (id, entryDate, month, year, officeId, name, mobile, breakfastCount, lunchCount, morningSpecial, lunchSpecial, totalBill, deposit, depositDate, prevBalance, curBalance, designation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [entryId, bdDate, month, year, officeIdEn, name.trim(), mobileEn, 0, 0, 0, 0, 0, 0, '', 0, 0, designation.trim()]
      );

      return NextResponse.json({
        success: true,
        message: 'সাইন আপ সফল হয়েছে',
        user: {
          officeId: officeIdEn,
          name: name.trim(),
          mobile: mobileEn,
          designation: designation.trim(),
          officeEmail: officeEmail.trim(),
        },
      });
    }

    // ===== ACTION: signin =====
    if (action === 'signin') {
      const { username, password } = body;

      if (!username || !username.trim()) {
        return NextResponse.json({ success: false, error: 'অফিস আইডি বা মোবাইল দিন' }, { status: 400 });
      }
      if (!password) {
        return NextResponse.json({ success: false, error: 'পাসওয়ার্ড দিন' }, { status: 400 });
      }

      // Convert Bangla digits to English for username
      const usernameEn = bnToEn(username.trim());

      // Look up user by officeId or mobile
      const result = await query(
        'SELECT * FROM MealUser WHERE officeId = ? OR mobile = ?',
        [usernameEn, usernameEn]
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'এই অফিস আইডি/মোবাইলে কোনো একাউন্ট নেই' }, { status: 401 });
      }

      const user = result.rows[0] as any;

      // Check password matches (bcrypt দিয়ে verify)
      const isPasswordValid = await bcrypt.compare(password, user.password);
      // Fallback: পুরনো plaintext পাসওয়ার্ড সাপোর্ট
      const isLegacyMatch = user.password === password && !user.password.startsWith('$2');
      if (!isPasswordValid && !isLegacyMatch) {
        return NextResponse.json({ success: false, error: 'পাসওয়ার্ড ভুল হয়েছে' }, { status: 401 });
      }
      // Legacy password থাকলে auto-hash করুন
      if (isLegacyMatch && !isPasswordValid) {
        const newHash = await bcrypt.hash(password, 12);
        await query('UPDATE MealUser SET password = ? WHERE id = ?', [newHash, user.id]);
      }

      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          officeId: user.officeId,
          name: user.name,
          mobile: user.mobile,
          designation: user.designation || '',
          officeEmail: user.officeEmail || '',
        },
      });
    }

    // ===== ACTION: forgot_step1 — Send OTP to email =====
    if (action === 'forgot_step1') {
      const { email } = body;

      if (!email || !email.trim()) {
        return NextResponse.json({ success: false, error: 'ইমেইল দিন' }, { status: 400 });
      }

      const emailTrim = email.trim().toLowerCase();

      // Check if email exists
      const result = await query(
        'SELECT * FROM MealUser WHERE LOWER(officeEmail) = ?',
        [emailTrim]
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'এই ইমেইলে কোনো একাউন্ট নেই' }, { status: 404 });
      }

      const user = result.rows[0] as any;

      // Generate 6-digit OTP
      const otp = String(Math.floor(100000 + Math.random() * 900000));

      // Set OTP expiry to 5 minutes from now
      const now = new Date();
      const expiry = new Date(now.getTime() + 5 * 60 * 1000);
      const otpExpiry = expiry.toISOString();

      // Save OTP to DB
      await query(
        'UPDATE MealUser SET otp = ?, otpExpiry = ? WHERE id = ?',
        [otp, otpExpiry, user.id]
      );

      // Send OTP email using Resend (no app password needed)
      const emailResult = await sendOTPEmail(emailTrim, otp);

      if (!emailResult.success) {
        return NextResponse.json({ success: false, error: emailResult.error || 'ইমেইল পাঠাতে সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।' }, { status: 500 });
      }

      // টেস্ট মোড: RESEND_API_KEY না থাকলে OTP রেসপন্সে দেখাবে
      const response: any = {
        success: true,
        message: 'OTP ইমেইলে পাঠানো হয়েছে',
      };
      if (emailResult.testOtp) {
        response.testOtp = emailResult.testOtp;
        response.testMode = true;
      }

      return NextResponse.json(response);
    }

    // ===== ACTION: forgot_step2 — Verify OTP and set new password =====
    if (action === 'forgot_step2') {
      const { email, otp, newPassword } = body;

      if (!email || !email.trim()) {
        return NextResponse.json({ success: false, error: 'ইমেইল দিন' }, { status: 400 });
      }
      if (!otp || !otp.trim()) {
        return NextResponse.json({ success: false, error: 'OTP কোড দিন' }, { status: 400 });
      }
      if (!newPassword || newPassword.length < 4) {
        return NextResponse.json({ success: false, error: 'নতুন পাসওয়ার্ড কমপক্ষে ৪ অক্ষরের হতে হবে' }, { status: 400 });
      }

      const emailTrim = email.trim().toLowerCase();

      // Find user by email
      const result = await query(
        'SELECT * FROM MealUser WHERE LOWER(officeEmail) = ?',
        [emailTrim]
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'এই ইমেইলে কোনো একাউন্ট নেই' }, { status: 404 });
      }

      const user = result.rows[0] as any;

      // Check OTP matches
      if (!user.otp || user.otp !== otp.trim()) {
        return NextResponse.json({ success: false, error: 'OTP কোড ভুল হয়েছে' }, { status: 401 });
      }

      // Check OTP expiry
      if (!user.otpExpiry) {
        return NextResponse.json({ success: false, error: 'OTP মেয়াদ উত্তীর্ণ হয়েছে। আবার OTP নিন।' }, { status: 401 });
      }

      const otpExpiryDate = new Date(user.otpExpiry);
      if (new Date() > otpExpiryDate) {
        return NextResponse.json({ success: false, error: 'OTP মেয়াদ উত্তীর্ণ হয়েছে। আবার OTP নিন।' }, { status: 401 });
      }

      // Update password (hashed) and clear OTP
      const hashedNewPassword = await bcrypt.hash(newPassword, 12);
      await query(
        'UPDATE MealUser SET password = ?, otp = \'\', otpExpiry = \'\' WHERE id = ?',
        [hashedNewPassword, user.id]
      );

      return NextResponse.json({
        success: true,
        message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে',
      });
    }

    // ===== ACTION: check_officeid =====
    if (action === 'check_officeid') {
      const { officeId } = body;

      if (!officeId || !officeId.trim()) {
        return NextResponse.json({ success: false, error: 'অফিস আইডি দিন' }, { status: 400 });
      }

      const officeIdEn = bnToEn(officeId.trim());

      // ১. MealUser টেবিলে আছে কিনা চেক করুন
      const userResult = await query(
        'SELECT officeId, name, mobile, designation, officeEmail FROM MealUser WHERE officeId = ?',
        [officeIdEn]
      );

      if (userResult.rows.length > 0) {
        const r = userResult.rows[0] as any;
        return NextResponse.json({
          success: true,
          exists: true,
          source: 'mealuser',
          userData: {
            officeId: r.officeId || '',
            name: r.name || '',
            mobile: r.mobile || '',
            designation: r.designation || '',
            officeEmail: r.officeEmail || '',
          },
        });
      }

      // ২. MealUser-এ নেই → MealEntry টেবিলে আছে কিনা চেক করুন
      const entryResult = await query(
        "SELECT DISTINCT officeId, name, mobile, designation FROM MealEntry WHERE officeId = ? AND officeId != '' LIMIT 1",
        [officeIdEn]
      );

      if (entryResult.rows.length > 0) {
        const r = entryResult.rows[0] as any;
        return NextResponse.json({
          success: true,
          exists: true,
          source: 'mealentry',
          userData: {
            officeId: r.officeId || '',
            name: r.name || '',
            mobile: r.mobile || '',
            designation: r.designation || '',
            officeEmail: '',
          },
        });
      }

      // কোথাও পাওয়া যায়নি
      return NextResponse.json({ success: true, exists: false });
    }

    // ===== ACTION: check_signin_user =====
    // সাইন ইন ফর্মে টাইপ করার সময় রিয়েল-টাইম চেক — officeId বা mobile মেলে কিনা
    if (action === 'check_signin_user') {
      const { username } = body;

      if (!username || !username.trim()) {
        return NextResponse.json({ success: true, found: false });
      }

      const usernameEn = bnToEn(username.trim());

      const result = await query(
        'SELECT officeId, name, mobile FROM MealUser WHERE officeId = ? OR mobile = ? LIMIT 1',
        [usernameEn, usernameEn]
      );
      const found = result.rows.length > 0;

      return NextResponse.json({ success: true, found });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
