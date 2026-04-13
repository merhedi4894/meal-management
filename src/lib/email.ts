import nodemailer from 'nodemailer';

// ===== Brevo SMTP Configuration =====
// এনভায়রনমেন্ট ভ্যারিয়েবল থেকে SMTP সেটিংস নেওয়া হয়
// Brevo.com থেকে SMTP Key নিলে নিচের ভ্যারিয়েবলগুলো সেট করতে হবে:
// SMTP_HOST=smtp-relay.brevo.com
// SMTP_PORT=587
// SMTP_USER=your-brevo-login-email
// SMTP_PASS=xkeysib-xxxxxxxxxxxxxx (Brevo SMTP Key)
// EMAIL_FROM=your-sender-email (পাঠানোর ইমেইল)

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('[Email] SMTP কনফিগারেশন পাওয়া যায়নি। SMTP_HOST, SMTP_USER, SMTP_PASS সেট করুন।');
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: false, // TLS ব্যবহার করে (port 587 এর জন্য false)
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // টাইমআউট সেটিংস
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      // TLS অপশন
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: false,
      },
    });

    // কানেকশন ভেরিফাই (ঐচ্ছিক)
    transporter.verify((error) => {
      if (error) {
        console.error('[Email] SMTP কানেকশন ত্রুটি:', error.message);
        transporter = null;
      } else {
        console.log('[Email] SMTP সার্ভার সাথে সংযোগ সফল');
      }
    });
  }
  return transporter;
}

// পাঠানোর ইমেইল (From)
function getFromEmail(): string {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  if (process.env.SMTP_USER) return process.env.SMTP_USER;
  return 'noreply@brevo.com';
}

// ===== OTP ইমেইল পাঠানোর ফাংশন =====
// Brevo SMTP দিয়ে যেকোনো ইমেইলে OTP পাঠানো যায়
export async function sendOTPEmail(to: string, otp: string): Promise<{ success: boolean; error?: string; testOtp?: string }> {
  const transport = getTransporter();

  if (!transport) {
    // SMTP কনফিগারেশন না থাকলে — টেস্ট মোডে OTP ফেরত দিন
    console.log(`[Email] SMTP কনফিগ নেই — টেস্ট OTP: ${otp}`);
    return {
      success: true,
      testOtp: otp,
      error: 'SMTP কনফিগারেশন সেট করা নেই। টেস্ট OTP রেসপন্সে দেওয়া হলো।'
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

// ===== জেনেরিক ইমেইল পাঠানোর ফাংশন (ভবিষ্যতে ব্যবহারের জন্য) =====
export async function sendEmail(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
  const transport = getTransporter();

  if (!transport) {
    console.error('[Email] SMTP কনফিগারেশন নেই — ইমেইল পাঠানো যায়নি');
    return { success: false, error: 'SMTP কনফিগারেশন সেট করা নেই' };
  }

  try {
    const fromEmail = getFromEmail();
    const info = await transport.sendMail({
      from: `"মিল ম্যানেজমেন্ট" <${fromEmail}>`,
      to: to,
      subject: subject,
      html: html,
    });

    console.log('[Email] ইমেইল সফলভাবে পাঠানো হয়েছে:', info.messageId, '→', to);
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Email] পাঠাতে ব্যর্থ:', msg);
    return { success: false, error: msg };
  }
}
