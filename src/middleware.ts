import { NextRequest, NextResponse } from 'next/server';

// ===== ইন-মেমরি Rate Limiter =====
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getRateLimitKey(request: NextRequest): string {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return ip;
}

export function rateLimit(request: NextRequest, maxRequests: number, windowMs: number): { allowed: boolean; remaining: number } {
  const key = getRateLimitKey(request);
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count };
}

// পুরনো entries পরিষ্কার (প্রতি ৫ মিনিটে)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

// ===== Auth Routes: সব প্রমাণীকরণ রুটে strict rate limit =====
const AUTH_ROUTES = ['/api/auth', '/api/reset-password'];

// ===== Admin Session Management =====
const adminSessions = new Map<string, { createdAt: number; expiresAt: number }>();
const ADMIN_SESSION_DURATION = 24 * 60 * 60 * 1000; // ২৪ ঘন্টা

export function createAdminSession(): string {
  const token = 'admin_' + Date.now() + '_' + Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15);
  const now = Date.now();
  adminSessions.set(token, { createdAt: now, expiresAt: now + ADMIN_SESSION_DURATION });
  return token;
}

export function validateAdminSession(token: string | null): boolean {
  if (!token || !token.startsWith('admin_')) return false;
  const session = adminSessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    adminSessions.delete(token);
    return false;
  }
  return true;
}

// Expired sessions পরিষ্কার (প্রতি ১০ মিনিটে)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of adminSessions.entries()) {
    if (now > val.expiresAt) adminSessions.delete(key);
  }
}, 10 * 60 * 1000);

export const config = {
  matcher: ['/api/:path*'],
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // Security headers add করুন (middleware level backup)
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // ===== Auth routes: strict rate limiting =====
  const isAuthRoute = AUTH_ROUTES.some(route => pathname.startsWith(route));
  if (isAuthRoute) {
    const { allowed, remaining } = rateLimit(request, 60, 60 * 1000); // ১ মিনিটে ৬০ রিকোয়েস্ট
    response.headers.set('X-RateLimit-Remaining', String(remaining));
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'খুব বেশি রিকোয়েস্ট। কিছুক্ষণ পর আবার চেষ্টা করুন।' },
        { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } }
      );
    }
  }

  // ===== সাধারণ API rate limiting =====
  if (pathname.startsWith('/api/')) {
    const { allowed } = rateLimit(request, 300, 60 * 1000); // ১ মিনিটে ৩০০ রিকোয়েস্ট
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'রিকোয়েস্ট সীমা অতিক্রম হয়েছে।' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
  }

  return response;
}
