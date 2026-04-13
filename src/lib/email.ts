import nodemailer from 'nodemailer';

// ===== Gmail SMTP Configuration =====
// এনভায়রনমেন্ট ভ্যারিয়েবল থেকে সেটিংস নেওয়া হয়
// GMAIL_USER, GMAIL_APP_PASSWORD সেট করলে Gmail দিয়ে ইমেইল পাঠানো যাবে

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.error('[Email] Gmail SMTP কনফিগারেশন পাওয়া যায়নি। GMAIL_USER, GMAIL_APP_PASSWORD সেট করুন।');
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });

    transporter.verify((error) => {
      if (error) {
        console.error('[Email] SMTP কানেকশন ত্রুটি:', error.message);
        transporter = null;
      } else {
        console.log('[Email] Gmail SMTP সাথে সংযোগ সফল');
      }
    });
  }
  return transporter;
}

function getFromEmail(): string {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  if (process.env.GMAIL_USER) return process.env.GMAIL_USER;
  return 'noreply@gmail.com';
}

// ===== OTP ইমেইল পাঠানোর ফাংশন =====
export async function sendOTPEmail(to: string, otp: string): Promise<{ success: boolean; error?: string; testOtp?: string }> {
  const transport = getTransporter();

  if (!transport) {
    // SMTP কনফিগারেশন না থাকলে — টেস্ট মোডে OTP ফেরত দিন
    console.log(`[Email] SMTP কনফিগ নেই — টেস্ট OTP: ${otp}`);
    return {
      success: true,
      testOtp: otp,
      error: 'Gmail SMTP কনফিগারেশন সেট করা নেই। টেস্ট OTP রেসপন্সে দেওয়া হলো।'
    };
  }

  try {
    const fromEmail = getFromEmail();
    const info = await transport.sendMail({
      from: `"মিল ম্যানেজমেন্ট" <${fromEmail}>`,
      to: to,
      subject: '🔐 পাসওয়ার্ড রিসেট - ভেরিফিকেশন কোড',
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 420px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background: #f9fafb;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #059669; margin: 0;">🍽️ মিল ম্যানেজমেন্ট</h2>
            <p style="color: #6b7280; font-size: 14px; margin: 5px 0 0;">পাসওয়ার্ড রিসেট কোড</p>
          </div>
          <div style="text-align: center; padding: 20px; background: #ffffff; border-radius: 8px; border: 2px dashed #059669;">
            <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px;">আপনার ভেরিফিকেশন কোড</p>
            <p style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #111827; margin: 0;">${otp}</p>
          </div>
          <div style="margin-top: 20px; padding: 12px; background: #fef3c7; border-radius: 6px; border-left: 4px solid #f59e0b;">
            <p style="color: #92400e; font-size: 13px; margin: 0;">
              ⏰ <strong>এই কোড ৫ মিনিটের মধ্যে ব্যবহার করুন।</strong><br>
              আপনি যদি পাসওয়ার্ড রিসেটের অনুরোধ না করে থাকেন, তবে এই ইমেইল উপেক্ষা করুন।
            </p>
          </div>
          <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
            <p>© ২০২৬ মিল ম্যানেজমেন্ট সিস্টেম</p>
          </div>
        </div>
      `
    });

    console.log('[Email] OTP সফলভাবে পাঠানো হয়েছে:', info.messageId, '→', to);
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Email] পাঠাতে ব্যর্থ:', msg);
    return { success: false, error: msg };
  }
}
