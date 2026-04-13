import { Resend } from 'resend';

// Resend API Key (no app password needed — just an API key from resend.com)
let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    console.error('[Email] RESEND_API_KEY .env তে সেট করা নেই');
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

// ইমেইল পাঠানোর সোর্স (Resend দিয়ে ভেরিফাইড ডোমেইন বা onboarding)
function getFromEmail(): string {
  // ইউজার যদি কাস্টম ইমেইল সেট করে থাকে
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  // ডিফল্ট: Resend onboarding (ডোমেইন ভেরিফিকেশন ছাড়াই কাজ করে)
  return 'Meal Management <onboarding@resend.dev>';
}

// OTP ইমেইল পাঠান (Resend — app password লাগবে না)
export async function sendOTPEmail(to: string, otp: string): Promise<{ success: boolean; error?: string; testOtp?: string }> {
  const resend = getResendClient();

  if (!resend) {
    // RESEND_API_KEY না থাকলে — টেস্ট মোডে OTP ফেরত দিন
    console.log(`[Email] RESEND_API_KEY নেই — টেস্ট OTP: ${otp}`);
    return {
      success: true,
      testOtp: otp,
      error: 'RESEND_API_KEY সেট করা নেই। টেস্ট OTP রেসপন্সে দেওয়া হলো।'
    };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: getFromEmail(),
      to: [to],
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

    if (error) {
      console.error('[Resend] ইমেইল পাঠাতে ব্যর্থ:', error);
      return { success: false, error: error.message };
    }

    console.log('[Resend] OTP পাঠানো হয়েছে:', data?.id);
    return { success: true };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Resend] পাঠাতে ব্যর্থ:', msg);
    return { success: false, error: msg };
  }
}
